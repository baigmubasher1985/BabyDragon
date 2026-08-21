/**
 * F10C2 Phase 2 — Durable result upload orchestrator (mocked transport).
 * Extends mobile offline queue items of type field_test_result_submit.
 */

import {
  buildServerSubmissionManifest,
  validateServerSubmissionManifest,
  F10C2_SERVER_SUBMIT_ENABLED,
} from "../reports/serverSubmissionManifest.js";
import {
  PACKAGE_STATES,
  ARTIFACT_STATES,
  isPackageTerminal,
  isPackageSuccess,
  canResumePackage,
  nextPackageStateAfterArtifactProgress,
} from "./resultPackageStates.js";
import {
  MAX_UPLOAD_ATTEMPTS,
  backoffDelayMsWithJitter,
  classifyUploadError,
  sanitizeFeError,
  shouldGiveUp,
} from "./resultRetryPolicy.js";
import { evaluateResultAuthGate, stripSecretsFromPayload, assertNoSecretsInRecord } from "./resultAuthGate.js";
import { toServerArtifactDescriptor } from "./artifactLocalDescriptors.js";
import { adaptScenarioForSubmission, adaptUnifiedScenarios, buildScenarioConfigSnapshot } from "./scenarioResultAdapters.js";
import { getSharedMockResultTransport } from "./mockResultTransport.js";

/** Documented Phase 2 flag: mock packaging/upload path (not real Supabase). */
export const F10C2_MOCK_RESULT_UPLOAD_ENABLED = true;

export const RESULT_QUEUE_RECORD_VERSION = 1;

function nowIso() {
  return new Date().toISOString();
}

function transition(packageState, to, note = null) {
  return {
    ...packageState,
    state: to,
    updated_at: nowIso(),
    last_transition_note: note,
    history: [
      ...(Array.isArray(packageState.history) ? packageState.history : []),
      { from: packageState.state, to, at: nowIso(), note },
    ].slice(-40),
  };
}

/**
 * Build a versioned queue payload from report truth + local artifact refs.
 * Does NOT block report save; caller enqueues separately.
 */
export function buildResultPackagePayload({
  clientRunId,
  session = null,
  unifiedReport = null,
  taskContext = {},
  device = {},
  network = {},
  localArtifacts = [],
  reportName = null,
  ownerUserId = null,
  identityKey = null,
} = {}) {
  if (!clientRunId) throw new Error("client_run_id_required");
  if (!taskContext.taskId || !taskContext.projectId) {
    throw new Error("task_context_required");
  }

  const scenarioConfig = session
    ? buildScenarioConfigSnapshot(session)
    : { scenario_type: unifiedReport ? "unified_field_report" : null };

  const scenarioAdapter = unifiedReport
    ? { scenarios: adaptUnifiedScenarios(unifiedReport) }
    : session
      ? adaptScenarioForSubmission(session)
      : null;

  // Manifest artifacts require checksum — only include ready locals.
  const readyLocals = (localArtifacts || []).filter((a) => a?.checksum && !a.missing_local);
  const serverArtifacts = readyLocals.map((a) =>
    // object_key filled after register (field_test_run_id known); descriptor allows null key.
    ({
      artifact_id: a.artifact_id,
      artifact_type: a.artifact_type,
      bucket: a.bucket,
      object_key: a.object_key || null,
      original_file_name: a.original_file_name,
      mime_type: a.mime_type,
      size_bytes: a.size_bytes,
      checksum: a.checksum,
      safe_extension: a.safe_extension,
      upload_status: a.upload_status || "pending",
    }),
  );

  const manifest = buildServerSubmissionManifest({
    clientRunId,
    unifiedReport,
    session,
    taskContext,
    device,
    network,
    artifacts: serverArtifacts,
    config: {
      ...scenarioConfig,
      scenario_adapter: scenarioAdapter,
    },
    reportName,
  });

  const validation = validateServerSubmissionManifest(manifest);
  if (!validation.ok) {
    throw new Error(`invalid_manifest:${validation.errors.join(",")}`);
  }

  const payload = stripSecretsFromPayload({
    record_version: RESULT_QUEUE_RECORD_VERSION,
    client_run_id: clientRunId,
    identity_key: identityKey,
    owner_user_id: ownerUserId,
    package_state: PACKAGE_STATES.DRAFT,
    field_test_run_id: null,
    manifest,
    local_artifacts: (localArtifacts || []).map((a) => ({
      ...a,
      // Never embed binary content
      content: undefined,
      bytes: undefined,
      blob: undefined,
    })),
    attempts: 0,
    next_attempt_at: null,
    last_error: null,
    last_error_code: null,
    history: [],
    created_at: nowIso(),
    updated_at: nowIso(),
    transport_kind: "mock",
    flags: {
      F10C2_SERVER_SUBMIT: F10C2_SERVER_SUBMIT_ENABLED,
      F10C2_MOCK_RESULT_UPLOAD: F10C2_MOCK_RESULT_UPLOAD_ENABLED,
    },
  });

  const secretCheck = assertNoSecretsInRecord(payload);
  if (!secretCheck.ok) {
    throw new Error("secret_fields_rejected");
  }

  return payload;
}

function markArtifact(payload, artifactId, patch) {
  const local_artifacts = (payload.local_artifacts || []).map((a) =>
    (a.artifact_id === artifactId ? { ...a, ...patch } : a),
  );
  return { ...payload, local_artifacts, updated_at: nowIso() };
}

/**
 * Advance one package through the state machine using the given transport.
 */
export async function processResultPackagePayload(payload, {
  transport = getSharedMockResultTransport(),
  currentUser = null,
  sessionValid = true,
  manualRetry = false,
  rng = Math.random,
} = {}) {
  let pkg = { ...payload };
  if (!pkg.record_version) pkg.record_version = RESULT_QUEUE_RECORD_VERSION;

  if (pkg.package_state === PACKAGE_STATES.CANCELLED_LOCAL_ONLY) {
    return { done: true, keep: true, payload: pkg, reason: "cancelled_local_only" };
  }
  if (isPackageSuccess(pkg.package_state)) {
    return { done: true, keep: false, payload: pkg, reason: "already_uploaded" };
  }
  if (pkg.package_state === PACKAGE_STATES.FAILED_PERMANENT && !manualRetry) {
    return { done: true, keep: true, payload: pkg, reason: "failed_permanent" };
  }

  if (!manualRetry && pkg.next_attempt_at) {
    const due = Date.parse(pkg.next_attempt_at);
    if (Number.isFinite(due) && due > Date.now()) {
      return { done: false, keep: true, payload: pkg, reason: "retry_wait" };
    }
  }

  const auth = evaluateResultAuthGate({
    currentUser,
    queuedOwnerUserId: pkg.owner_user_id,
    sessionValid,
  });
  if (!auth.ok) {
    pkg = transition(
      { ...pkg, package_state: pkg.package_state },
      auth.state,
      auth.code,
    );
    pkg.package_state = auth.state;
    pkg.last_error = auth.sanitized;
    pkg.last_error_code = auth.code;
    return { done: false, keep: true, payload: pkg, reason: auth.code };
  }

  try {
    // Recover status after restart if we already have a run id
    if (pkg.field_test_run_id || pkg.package_state === PACKAGE_STATES.RETRY_WAIT) {
      try {
        const status = await transport.fetchSubmissionStatus({
          clientRunId: pkg.client_run_id,
        });
        if (status?.run?.finalized || status?.run?.status === "uploaded") {
          pkg = {
            ...pkg,
            package_state: PACKAGE_STATES.UPLOADED,
            field_test_run_id: status.run.id,
            updated_at: nowIso(),
          };
          return { done: true, keep: false, payload: pkg, reason: "status_recovered_uploaded" };
        }
        if (status?.run?.id && !pkg.field_test_run_id) {
          pkg.field_test_run_id = status.run.id;
        }
        for (const remoteArt of status?.artifacts || []) {
          if (remoteArt.upload_status === "complete") {
            pkg = markArtifact(pkg, remoteArt.id, {
              upload_status: ARTIFACT_STATES.UPLOADED,
              object_key: remoteArt.object_key,
            });
          }
        }
      } catch {
        // Status probe failures are non-fatal; continue orchestration.
      }
    }

    if (!pkg.field_test_run_id) {
      pkg = { ...pkg, package_state: PACKAGE_STATES.REGISTERING, updated_at: nowIso() };
      const registered = await transport.registerResult(pkg.manifest);
      pkg.field_test_run_id = registered.field_test_run_id;
      pkg = {
        ...pkg,
        package_state: PACKAGE_STATES.REGISTERED,
        updated_at: nowIso(),
      };
    }

    const artifacts = [...(pkg.local_artifacts || [])];
    let confirmed = artifacts.filter((a) => a.upload_status === ARTIFACT_STATES.UPLOADED).length;
    const required = artifacts.filter((a) => !a.optional);
    const missingRequired = required.some((a) => a.missing_local || a.upload_status === ARTIFACT_STATES.MISSING_LOCAL);
    if (missingRequired) {
      throw Object.assign(new Error("Missing required local artifact"), {
        code: "missing_required_local_artifact",
      });
    }

    pkg = {
      ...pkg,
      package_state: nextPackageStateAfterArtifactProgress({
        current: pkg.package_state,
        confirmedCount: confirmed,
        totalCount: artifacts.filter((a) => !a.missing_local).length,
        anyMissing: false,
      }),
    };

    for (const art of artifacts) {
      if (art.missing_local && art.optional) continue;
      if (art.upload_status === ARTIFACT_STATES.UPLOADED) continue;

      pkg = { ...pkg, package_state: PACKAGE_STATES.UPLOADING, updated_at: nowIso() };
      pkg = markArtifact(pkg, art.artifact_id, { upload_status: ARTIFACT_STATES.UPLOADING });

      const serverArt = toServerArtifactDescriptor(
        { ...art, object_key: art.object_key },
        {
          projectId: pkg.manifest.project_id,
          taskId: pkg.manifest.task_id,
          verifiedUserId: auth.owner_user_id_hint,
          fieldTestRunId: pkg.field_test_run_id,
        },
      );

      const ticket = await transport.requestArtifactUpload({
        fieldTestRunId: pkg.field_test_run_id,
        artifact: serverArt,
      });

      pkg = markArtifact(pkg, art.artifact_id, {
        object_key: ticket.object_key || serverArt.object_key,
        upload_ticket: ticket.upload_ticket,
      });

      const current = (pkg.local_artifacts || []).find((a) => a.artifact_id === art.artifact_id);
      await transport.uploadArtifact({
        artifactId: art.artifact_id,
        uploadTicket: ticket.upload_ticket,
        bytesHint: current?.size_bytes || 0,
        resumeFromByte: current?.bytes_uploaded || 0,
      });

      await transport.confirmArtifact({
        artifactId: art.artifact_id,
        checksum: art.checksum,
      });

      pkg = markArtifact(pkg, art.artifact_id, {
        upload_status: ARTIFACT_STATES.UPLOADED,
        bytes_uploaded: current?.size_bytes || 0,
      });
      confirmed += 1;
    }

    const pendingLeft = (pkg.local_artifacts || []).filter(
      (a) => !a.optional && !a.missing_local && a.upload_status !== ARTIFACT_STATES.UPLOADED,
    );
    if (pendingLeft.length > 0) {
      pkg = {
        ...pkg,
        package_state: PACKAGE_STATES.PARTIALLY_UPLOADED,
        updated_at: nowIso(),
      };
      return { done: false, keep: true, payload: pkg, reason: "partial" };
    }

    pkg = { ...pkg, package_state: PACKAGE_STATES.FINALIZING, updated_at: nowIso() };
    await transport.finalizeResult({
      clientRunId: pkg.client_run_id,
      fieldTestRunId: pkg.field_test_run_id,
    });

    pkg = {
      ...pkg,
      package_state: PACKAGE_STATES.UPLOADED,
      last_error: null,
      last_error_code: null,
      updated_at: nowIso(),
    };

    return { done: true, keep: false, payload: pkg, reason: "uploaded" };
  } catch (error) {
    const classification = classifyUploadError(error);
    const attempts = Number(pkg.attempts || 0) + 1;
    const giveUp = shouldGiveUp({ attempts, classification });

    let nextState = PACKAGE_STATES.RETRY_WAIT;
    if (classification.code === "auth_expired_retryable") {
      nextState = PACKAGE_STATES.BLOCKED_AUTH;
    } else if (giveUp || classification.kind === "permanent") {
      nextState = PACKAGE_STATES.FAILED_PERMANENT;
    } else if (classification.code === "upload_interrupted") {
      nextState = PACKAGE_STATES.PARTIALLY_UPLOADED;
    }

    const delay = backoffDelayMsWithJitter(Math.min(attempts, 4), rng);
    pkg = {
      ...pkg,
      attempts,
      package_state: nextState,
      last_error: sanitizeFeError(classification.sanitized || error),
      last_error_code: classification.code,
      next_attempt_at: new Date(Date.now() + delay).toISOString(),
      updated_at: nowIso(),
    };

    if (error.bytes_uploaded != null && error.artifactId) {
      pkg = markArtifact(pkg, error.artifactId, {
        bytes_uploaded: error.bytes_uploaded,
        upload_status: ARTIFACT_STATES.RETRY_WAIT,
      });
    }

    return {
      done: giveUp || nextState === PACKAGE_STATES.FAILED_PERMANENT,
      keep: true,
      payload: pkg,
      reason: classification.code,
      retry_in_ms: delay,
      max_attempts: MAX_UPLOAD_ATTEMPTS,
    };
  }
}

export function cancelResultPackageLocally(payload) {
  return {
    ...payload,
    package_state: PACKAGE_STATES.CANCELLED_LOCAL_ONLY,
    last_error: null,
    last_error_code: "cancelled_local_only",
    updated_at: nowIso(),
    // Local report artifacts remain on device; cancel ≠ failure.
  };
}

export function summarizeResultPackage(payload = {}) {
  const arts = Array.isArray(payload.local_artifacts) ? payload.local_artifacts : [];
  const uploaded = arts.filter((a) => a.upload_status === ARTIFACT_STATES.UPLOADED).length;
  return {
    client_run_id: payload.client_run_id,
    report_name: payload.manifest?.report_name || null,
    scenario_type: payload.manifest?.scenario_type || null,
    package_state: payload.package_state,
    attempts: payload.attempts || 0,
    artifact_progress: { uploaded, total: arts.length },
    last_error: payload.last_error || null,
    field_test_run_id: payload.field_test_run_id || null,
    is_uploaded: isPackageSuccess(payload.package_state),
    is_queued_not_uploaded: canResumePackage(payload.package_state)
      || payload.package_state === PACKAGE_STATES.QUEUED
      || payload.package_state === PACKAGE_STATES.DRAFT,
    can_resume: canResumePackage(payload.package_state),
    terminal: isPackageTerminal(payload.package_state),
  };
}

export default {
  F10C2_MOCK_RESULT_UPLOAD_ENABLED,
  RESULT_QUEUE_RECORD_VERSION,
  buildResultPackagePayload,
  processResultPackagePayload,
  cancelResultPackageLocally,
  summarizeResultPackage,
};
