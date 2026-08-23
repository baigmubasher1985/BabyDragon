/**
 * F10C2 Phase 2 — MOCKED result transport only.
 * Deterministic failure simulation. Replaceable by real Supabase transport later.
 * NO network calls. NO Storage. NO Auth mutation.
 */

import { makeUuid } from "./clientRunIdStore.js";

export const MOCK_TRANSPORT_KIND = "mock_f10c2_phase2";

/**
 * Failure mode keys for tests / manual injection.
 */
export const MOCK_FAILURE_MODES = Object.freeze({
  NONE: "none",
  SUCCESS: "success",
  DUPLICATE_REGISTRATION: "duplicate_registration",
  EXPIRED_AUTH: "expired_auth",
  RETRYABLE_NETWORK: "retryable_network",
  PERMANENT_VALIDATION: "permanent_validation",
  INTERRUPTED_ARTIFACT: "interrupted_artifact",
  ALREADY_CONFIRMED_ARTIFACT: "already_confirmed_artifact",
  FINALIZATION_FAILURE: "finalization_failure",
  STATUS_RECOVERY: "status_recovery",
});

function err(code, message, extra = {}) {
  const error = new Error(message || code);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

/**
 * Create a deterministic in-memory mock transport.
 *
 * @param {object} [options]
 * @param {string} [options.defaultFailureMode]
 * @param {Map|object} [options.scriptedFailures] per-op overrides
 * @param {() => number} [options.now]
 */
export function createMockResultTransport(options = {}) {
  const state = {
    runsByClientRunId: new Map(),
    artifactsById: new Map(),
    uploadProgress: new Map(),
    callLog: [],
    defaultFailureMode: options.defaultFailureMode || MOCK_FAILURE_MODES.NONE,
    scriptedFailures: options.scriptedFailures instanceof Map
      ? options.scriptedFailures
      : new Map(Object.entries(options.scriptedFailures || {})),
    opCounters: new Map(),
    now: typeof options.now === "function" ? options.now : () => Date.now(),
  };

  function nextMode(opName) {
    const count = (state.opCounters.get(opName) || 0) + 1;
    state.opCounters.set(opName, count);
    const scripted = state.scriptedFailures.get(`${opName}:${count}`)
      || state.scriptedFailures.get(opName)
      || state.defaultFailureMode;
    return scripted;
  }

  function log(op, detail) {
    state.callLog.push({ op, at: state.now(), ...detail });
  }

  async function registerResult(manifest) {
    const mode = nextMode("registerResult");
    log("registerResult", { mode, client_run_id: manifest?.client_run_id });

    if (mode === MOCK_FAILURE_MODES.EXPIRED_AUTH) {
      throw err("auth_expired_retryable", "Mock auth expired");
    }
    if (mode === MOCK_FAILURE_MODES.RETRYABLE_NETWORK) {
      throw err("network", "Mock network failure on register");
    }
    if (mode === MOCK_FAILURE_MODES.PERMANENT_VALIDATION) {
      throw err("invalid_manifest", "Mock permanent validation failure");
    }

    if (!manifest?.client_run_id) throw err("invalid_manifest", "client_run_id_required");
    if (!manifest?.task_id || !manifest?.project_id) {
      throw err("invalid_manifest", "task_or_project_required");
    }

    const existing = state.runsByClientRunId.get(manifest.client_run_id);
    if (existing || mode === MOCK_FAILURE_MODES.DUPLICATE_REGISTRATION) {
      const row = existing || {
        id: makeUuid(),
        client_run_id: manifest.client_run_id,
        task_id: manifest.task_id,
        project_id: manifest.project_id,
        status: "registered",
        created_at: new Date(state.now()).toISOString(),
      };
      if (!existing) state.runsByClientRunId.set(manifest.client_run_id, row);
      return { ok: true, reason: "idempotent_success", field_test_run_id: row.id, run: row };
    }

    const row = {
      id: makeUuid(),
      client_run_id: manifest.client_run_id,
      task_id: manifest.task_id,
      project_id: manifest.project_id,
      scenario_type: manifest.scenario_type,
      status: "registered",
      created_at: new Date(state.now()).toISOString(),
      finalized: false,
    };
    state.runsByClientRunId.set(manifest.client_run_id, row);
    return { ok: true, reason: "created", field_test_run_id: row.id, run: row };
  }

  async function requestArtifactUpload({
    fieldTestRunId,
    artifact,
  } = {}) {
    const mode = nextMode("requestArtifactUpload");
    log("requestArtifactUpload", { mode, artifact_id: artifact?.artifact_id });

    if (mode === MOCK_FAILURE_MODES.EXPIRED_AUTH) {
      throw err("auth_expired_retryable", "Mock auth expired on upload request");
    }
    if (mode === MOCK_FAILURE_MODES.RETRYABLE_NETWORK) {
      throw err("network", "Mock network failure on upload request");
    }
    if (mode === MOCK_FAILURE_MODES.PERMANENT_VALIDATION) {
      throw err("invalid_mime", "Mock permanent MIME rejection");
    }

    if (!fieldTestRunId || !artifact?.artifact_id) {
      throw err("invalid_manifest", "artifact_register_args_required");
    }

    const existing = state.artifactsById.get(artifact.artifact_id);
    if (existing) {
      return {
        ok: true,
        reason: "idempotent_success",
        upload_ticket: existing.upload_ticket,
        object_key: existing.object_key,
        upload_plan: {
          provider_type: "mock",
          method: "mock_local_put",
          object_key: existing.object_key,
          expires_in_seconds: 120,
          authorization: { mode: "mock_ticket" },
          public_url: null,
        },
        artifact: existing,
      };
    }

    const objectKey = artifact.object_key || `mock/${fieldTestRunId}/${artifact.artifact_id}.${artifact.safe_extension || "bin"}`;
    const ticket = {
      upload_ticket: `mock-ticket-${artifact.artifact_id}`,
      // Intentionally NOT a durable signed URL for storage — mock only.
      mock_upload_token: `mock-upload-${artifact.artifact_id}`,
      object_key: objectKey,
      expires_at: new Date(state.now() + 15 * 60 * 1000).toISOString(),
      upload_plan: {
        provider_type: "mock",
        method: "mock_local_put",
        object_key: objectKey,
        expires_in_seconds: 120,
        authorization: { mode: "mock_ticket" },
        public_url: null,
      },
    };

    const row = {
      id: artifact.artifact_id,
      field_test_run_id: fieldTestRunId,
      artifact_type: artifact.artifact_type,
      object_key: objectKey,
      checksum: artifact.checksum,
      upload_status: "pending",
      upload_ticket: ticket.upload_ticket,
    };
    state.artifactsById.set(artifact.artifact_id, row);
    return { ok: true, reason: "created", ...ticket, artifact: row };
  }

  async function uploadArtifact({
    artifactId,
    uploadTicket,
    bytesHint = 0,
    resumeFromByte = 0,
  } = {}) {
    const mode = nextMode("uploadArtifact");
    log("uploadArtifact", { mode, artifactId, resumeFromByte });

    if (mode === MOCK_FAILURE_MODES.EXPIRED_AUTH) {
      throw err("auth_expired_retryable", "Mock upload auth expired");
    }
    if (mode === MOCK_FAILURE_MODES.RETRYABLE_NETWORK) {
      throw err("network", "Mock network failure during upload");
    }
    if (mode === MOCK_FAILURE_MODES.INTERRUPTED_ARTIFACT) {
      const partial = Math.max(resumeFromByte, Math.floor(Number(bytesHint || 100) / 2));
      state.uploadProgress.set(artifactId, partial);
      throw err("upload_interrupted", "Mock interrupted artifact upload", {
        bytes_uploaded: partial,
      });
    }

    const art = state.artifactsById.get(artifactId);
    if (!art) throw err("invalid_manifest", "artifact_not_registered");
    if (uploadTicket && art.upload_ticket && uploadTicket !== art.upload_ticket) {
      throw err("auth_expired_retryable", "Mock upload ticket mismatch");
    }

    state.uploadProgress.set(artifactId, Number(bytesHint || 0));
    art.upload_status = "uploaded_bytes";
    return {
      ok: true,
      reason: "uploaded",
      artifact_id: artifactId,
      bytes_uploaded: Number(bytesHint || 0),
    };
  }

  async function confirmArtifact({
    artifactId,
    checksum,
  } = {}) {
    const mode = nextMode("confirmArtifact");
    log("confirmArtifact", { mode, artifactId });

    const art = state.artifactsById.get(artifactId);
    if (!art) throw err("invalid_manifest", "artifact_not_found");

    if (mode === MOCK_FAILURE_MODES.ALREADY_CONFIRMED_ARTIFACT || art.upload_status === "complete") {
      art.upload_status = "complete";
      return { ok: true, reason: "idempotent_success", artifact: art };
    }
    if (mode === MOCK_FAILURE_MODES.RETRYABLE_NETWORK) {
      throw err("network", "Mock network failure on confirm");
    }
    if (mode === MOCK_FAILURE_MODES.PERMANENT_VALIDATION) {
      throw err("checksum_mismatch", "Mock checksum mismatch");
    }
    if (checksum && art.checksum && checksum !== art.checksum) {
      throw err("checksum_mismatch", "Checksum mismatch");
    }

    art.upload_status = "complete";
    return { ok: true, reason: "completed", artifact: art };
  }

  async function finalizeResult({
    clientRunId,
    fieldTestRunId,
  } = {}) {
    const mode = nextMode("finalizeResult");
    log("finalizeResult", { mode, clientRunId, fieldTestRunId });

    if (mode === MOCK_FAILURE_MODES.FINALIZATION_FAILURE) {
      throw err("finalize_temporary", "Mock finalization failure");
    }
    if (mode === MOCK_FAILURE_MODES.RETRYABLE_NETWORK) {
      throw err("network", "Mock network failure on finalize");
    }
    if (mode === MOCK_FAILURE_MODES.EXPIRED_AUTH) {
      throw err("auth_expired_retryable", "Mock auth expired on finalize");
    }
    if (mode === MOCK_FAILURE_MODES.PERMANENT_VALIDATION) {
      throw err("rejected_contract_version", "Mock rejected contract version");
    }

    const run = state.runsByClientRunId.get(clientRunId)
      || [...state.runsByClientRunId.values()].find((r) => r.id === fieldTestRunId);
    if (!run) throw err("invalid_manifest", "run_not_found");

    run.finalized = true;
    run.status = "uploaded";
    run.finalized_at = new Date(state.now()).toISOString();
    return { ok: true, reason: "finalized", run };
  }

  async function fetchSubmissionStatus({ clientRunId } = {}) {
    const mode = nextMode("fetchSubmissionStatus");
    log("fetchSubmissionStatus", { mode, clientRunId });

    if (mode === MOCK_FAILURE_MODES.RETRYABLE_NETWORK) {
      throw err("network", "Mock network failure on status");
    }
    if (mode === MOCK_FAILURE_MODES.EXPIRED_AUTH) {
      throw err("auth_expired_retryable", "Mock auth expired on status");
    }

    const run = state.runsByClientRunId.get(clientRunId) || null;
    if (!run) {
      return { ok: true, reason: "not_found", run: null, artifacts: [] };
    }

    if (mode === MOCK_FAILURE_MODES.STATUS_RECOVERY) {
      return {
        ok: true,
        reason: "recovered",
        run: { ...run, status: run.finalized ? "uploaded" : run.status },
        artifacts: [...state.artifactsById.values()].filter((a) => a.field_test_run_id === run.id),
      };
    }

    return {
      ok: true,
      reason: "ok",
      run,
      artifacts: [...state.artifactsById.values()].filter((a) => a.field_test_run_id === run.id),
    };
  }

  return {
    kind: MOCK_TRANSPORT_KIND,
    registerResult,
    requestArtifactUpload,
    uploadArtifact,
    confirmArtifact,
    finalizeResult,
    fetchSubmissionStatus,
    /** Test/introspection helpers */
    __state: state,
    setDefaultFailureMode(mode) {
      state.defaultFailureMode = mode;
    },
    setScriptedFailure(key, mode) {
      state.scriptedFailures.set(key, mode);
    },
    resetCounters() {
      state.opCounters.clear();
    },
  };
}

/** Shared singleton for app wiring (mock only). */
let sharedMockTransport = null;

export function getSharedMockResultTransport() {
  if (!sharedMockTransport) {
    sharedMockTransport = createMockResultTransport();
  }
  return sharedMockTransport;
}

export function __resetSharedMockResultTransport() {
  sharedMockTransport = createMockResultTransport();
  return sharedMockTransport;
}

export default {
  MOCK_TRANSPORT_KIND,
  MOCK_FAILURE_MODES,
  createMockResultTransport,
  getSharedMockResultTransport,
  __resetSharedMockResultTransport,
};
