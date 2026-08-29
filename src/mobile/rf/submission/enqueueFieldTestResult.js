/**
 * F10C2 Phase 2 — Enqueue field-test result into existing mobile offline queue.
 * Duplicate client_run_id merges; completed packages are not re-queued.
 */

import {
  OFFLINE_ACTION_TYPES,
  readMobileQueue,
  saveMobileQueue,
  queueMobileAction,
} from "../../mobileOfflineQueue.js";
import {
  buildRunIdentityKey,
  getOrCreateClientRunId,
} from "./clientRunIdStore.js";
import { resolveScenarioKey } from "../reports/scenarioReportModel.js";

/** Local-only sentinels so unassigned Stop/Save can register without a live task. */
export const UNASSIGNED_LOCAL_PROJECT_ID = "00000000-0000-4000-8000-c01b00000001";
export const UNASSIGNED_LOCAL_TASK_ID = "00000000-0000-4000-8000-c01b00000002";
import {
  buildLocalArtifactsFromReportFiles,
  computeChecksumHex,
} from "./artifactLocalDescriptors.js";
import {
  buildResultPackagePayload,
  cancelResultPackageLocally,
  F10C2_MOCK_RESULT_UPLOAD_ENABLED,
  summarizeResultPackage,
} from "./resultUploadOrchestrator.js";
import { PACKAGE_STATES, isPackageSuccess } from "./resultPackageStates.js";
import { saveResultArtifactFile } from "../../mobileIndexedDb.js";

/**
 * Ensure artifacts have checksums (from in-memory content when available).
 */
export async function ensureArtifactChecksums(files = []) {
  const out = [];
  for (const file of files) {
    if (file.checksum) {
      out.push(file);
      continue;
    }
    if (file.content != null) {
      const checksum = await computeChecksumHex(file.content);
      out.push({ ...file, checksum, sizeBytes: file.sizeBytes ?? String(file.content).length });
      continue;
    }
    if (file.contentBase64) {
      const checksum = await computeChecksumHex(file.contentBase64);
      out.push({
        ...file,
        checksum,
        sizeBytes: file.sizeBytes ?? Math.floor(String(file.contentBase64).length * 0.75),
      });
      continue;
    }
    // Browser/native path without bytes — mark missing unless optional
    out.push({
      ...file,
      checksum: file.checksum || `sha256:pending-${file.fileName || file.name || "file"}`,
      missingLocal: Boolean(file.missingLocal),
    });
  }
  return out;
}

/**
 * Soft-enqueue after local report save. Never throws to caller of report save
 * when wrapped via tryEnqueueFieldTestResultAfterSave.
 */
export async function enqueueFieldTestResultSubmit({
  session = null,
  unifiedReport = null,
  taskContext = {},
  device = {},
  network = {},
  files = [],
  reportName = null,
  ownerUserId = null,
  forceNewRunId = false,
  identityKey = null,
  allowUnassigned = false,
} = {}) {
  if (!F10C2_MOCK_RESULT_UPLOAD_ENABLED) {
    return { ok: false, reason: "mock_upload_disabled" };
  }

  let resolvedTaskContext = taskContext;
  const missingTask = !taskContext?.taskId || !taskContext?.projectId;
  if (missingTask) {
    if (!allowUnassigned) {
      return { ok: false, reason: "task_context_unavailable" };
    }
    resolvedTaskContext = {
      taskId: UNASSIGNED_LOCAL_TASK_ID,
      projectId: UNASSIGNED_LOCAL_PROJECT_ID,
      gridId: taskContext?.gridId || null,
      unassigned: true,
    };
  }

  const resolvedIdentityKey = identityKey || buildRunIdentityKey({
    sessionId: session?.id || unifiedReport?.sessionId || reportName,
    scenarioKey: session?.scenarioKey || session?.canonicalPackageId?.split?.("::")?.[1] || resolveScenarioKey(session || {}),
    taskId: resolvedTaskContext.taskId,
    reportName: reportName || session?.reportLogName || unifiedReport?.reportName,
    startedAt: session?.startedAt || unifiedReport?.startedAt,
  });

  const { client_run_id: clientRunId } = getOrCreateClientRunId(resolvedIdentityKey, {
    forceNew: forceNewRunId,
  });

  // Merge if already queued / completed for this client_run_id
  const existingQueue = readMobileQueue();
  const existing = existingQueue.find(
    (item) =>
      item.type === OFFLINE_ACTION_TYPES.FIELD_TEST_RESULT_SUBMIT
      && item.payload?.client_run_id === clientRunId,
  );

  if (existing && isPackageSuccess(existing.payload?.package_state)) {
    return {
      ok: true,
      reason: "already_uploaded_no_resubmit",
      client_run_id: clientRunId,
      queue_item_id: existing.id,
      summary: summarizeResultPackage(existing.payload),
    };
  }

  const filesWithChecksum = await ensureArtifactChecksums(files);
  const localArtifacts = buildLocalArtifactsFromReportFiles({
    clientRunId,
    files: filesWithChecksum,
  });

  for (let i = 0; i < localArtifacts.length; i += 1) {
    const file = filesWithChecksum[i];
    const art = localArtifacts[i];
    const body = file?.content ?? file?.contentBase64 ?? file?.blob ?? file?.file ?? null;
    if (!art?.artifact_id || body == null) continue;
    try {
      const saved = await saveResultArtifactFile(art.artifact_id, {
        blob: body,
        name: art.original_file_name,
        type: art.mime_type,
        size: art.size_bytes,
      });
      if (saved?.id) {
        localArtifacts[i] = { ...art, local_file_ref: saved.id };
      }
    } catch {
      // IndexedDB may be unavailable in unit tests; queue metadata still persists.
    }
  }

  const payload = buildResultPackagePayload({
    clientRunId,
    session,
    unifiedReport,
    taskContext: resolvedTaskContext,
    device,
    network,
    localArtifacts,
    reportName,
    ownerUserId,
    identityKey: resolvedIdentityKey,
  });
  payload.package_state = PACKAGE_STATES.QUEUED;
  if (resolvedTaskContext.unassigned) {
    payload.flags = { ...(payload.flags || {}), unassigned_local: true };
  }

  if (existing) {
    // Merge: keep run id / attempts / confirmed artifacts where possible
    const mergedPayload = {
      ...payload,
      field_test_run_id: existing.payload?.field_test_run_id || null,
      attempts: existing.payload?.attempts || 0,
      package_state:
        existing.payload?.package_state === PACKAGE_STATES.CANCELLED_LOCAL_ONLY
          ? PACKAGE_STATES.QUEUED
          : existing.payload?.package_state && existing.payload.package_state !== PACKAGE_STATES.DRAFT
            ? existing.payload.package_state
            : PACKAGE_STATES.QUEUED,
      local_artifacts: mergeArtifacts(existing.payload?.local_artifacts, payload.local_artifacts),
      updated_at: new Date().toISOString(),
    };

    const next = existingQueue.map((item) =>
      (item.id === existing.id
        ? {
            ...item,
            payload: mergedPayload,
            last_error: "",
            meta: {
              ...(item.meta || {}),
              client_run_id: clientRunId,
              record_version: mergedPayload.record_version,
            },
          }
        : item),
    );
    saveMobileQueue(next);
    return {
      ok: true,
      reason: "merged_existing",
      client_run_id: clientRunId,
      queue_item_id: existing.id,
      summary: summarizeResultPackage(mergedPayload),
    };
  }

  const item = queueMobileAction(
    OFFLINE_ACTION_TYPES.FIELD_TEST_RESULT_SUBMIT,
    payload,
    {
      client_run_id: clientRunId,
      task_id: resolvedTaskContext.taskId,
      record_version: payload.record_version,
    },
  );

  return {
    ok: true,
    reason: "queued",
    client_run_id: clientRunId,
    queue_item_id: item.id,
    summary: summarizeResultPackage(payload),
  };
}

function mergeArtifacts(existing = [], incoming = []) {
  const byId = new Map();
  for (const a of existing || []) {
    if (a?.artifact_id) byId.set(a.artifact_id, a);
  }
  for (const a of incoming || []) {
    if (!a?.artifact_id) continue;
    const prev = byId.get(a.artifact_id);
    if (!prev) {
      byId.set(a.artifact_id, a);
      continue;
    }
    byId.set(a.artifact_id, {
      ...a,
      upload_status: prev.upload_status === "uploaded" ? prev.upload_status : a.upload_status,
      object_key: prev.object_key || a.object_key,
      bytes_uploaded: prev.bytes_uploaded || a.bytes_uploaded,
    });
  }
  return [...byId.values()];
}

/**
 * Never blocks / never fails the report save path.
 */
export async function tryEnqueueFieldTestResultAfterSave(args) {
  try {
    return await enqueueFieldTestResultSubmit(args);
  } catch (error) {
    console.warn("BabyDragon result enqueue skipped:", error?.message || error);
    return { ok: false, reason: "enqueue_error", error: String(error?.message || error) };
  }
}

export function cancelQueuedFieldTestResult(clientRunId) {
  const queue = readMobileQueue();
  let changed = false;
  const next = queue.map((item) => {
    if (
      item.type === OFFLINE_ACTION_TYPES.FIELD_TEST_RESULT_SUBMIT
      && item.payload?.client_run_id === clientRunId
    ) {
      changed = true;
      return {
        ...item,
        payload: cancelResultPackageLocally(item.payload),
      };
    }
    return item;
  });
  if (changed) saveMobileQueue(next);
  return { ok: changed, reason: changed ? "cancelled" : "not_found" };
}

export function listFieldTestResultQueueItems() {
  return readMobileQueue()
    .filter((item) => item.type === OFFLINE_ACTION_TYPES.FIELD_TEST_RESULT_SUBMIT)
    .map((item) => ({
      id: item.id,
      created_at: item.created_at,
      attempts: item.attempts,
      last_error: item.last_error,
      summary: summarizeResultPackage(item.payload || {}),
      payload: item.payload,
    }));
}

export const PROTECTED_QUEUE_SESSION_ID = "bd-rf-1787606300946";

function identityBlob(item = {}) {
  const payload = item.payload || {};
  const manifest = payload.manifest || {};
  return [
    payload.identity_key,
    payload.client_run_id,
    manifest.client_run_id,
    manifest.report_name,
    payload.package_identity,
    payload.canonical_id,
    manifest.config?.scenario_adapter?.canonical_id,
  ].filter(Boolean).join(" ").toLowerCase();
}

function targetNeedles(canonicalId) {
  const canonical = String(canonicalId || "").trim();
  const [session, scenario] = canonical.split("::");
  return {
    canonical: canonical.toLowerCase(),
    session: String(session || "").toLowerCase(),
    scenario: String(scenario || "").toLowerCase(),
    identityKey: session && scenario ? `session:${session}|scenario:${scenario}`.toLowerCase() : "",
  };
}

function itemMatchesCanonical(item, canonicalId) {
  const needles = targetNeedles(canonicalId);
  if (!needles.session || !needles.scenario) return false;
  const blob = identityBlob(item);
  if (blob.includes(needles.canonical) || blob.includes(needles.identityKey)) return true;
  return blob.includes(needles.session) && blob.includes(needles.scenario);
}

function itemTouchesProtected(item) {
  const blob = identityBlob(item);
  return blob.includes(PROTECTED_QUEUE_SESSION_ID.toLowerCase());
}

/**
 * Fail-closed selector: exactly the requested canonical packages, never the protected session.
 */
export function selectFieldTestQueueTargets(canonicalIds = [], queue = readMobileQueue()) {
  const targets = [...new Set((canonicalIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (targets.length === 0) {
    return { ok: false, code: "selective_targets_required", matches: [] };
  }
  if (targets.some((id) => id.toLowerCase().includes(PROTECTED_QUEUE_SESSION_ID.toLowerCase()))) {
    return { ok: false, code: "protected_package_denied", matches: [] };
  }

  const submitItems = (queue || []).filter(
    (item) => item.type === OFFLINE_ACTION_TYPES.FIELD_TEST_RESULT_SUBMIT,
  );
  const matches = [];
  const seen = new Set();
  for (const target of targets) {
    const found = submitItems.filter((item) => itemMatchesCanonical(item, target));
    if (found.length !== 1) {
      return {
        ok: false,
        code: "selective_target_ambiguous_or_missing",
        target,
        count: found.length,
        matches: [],
      };
    }
    const item = found[0];
    if (itemTouchesProtected(item)) {
      return { ok: false, code: "protected_package_denied", matches: [] };
    }
    if (seen.has(item.id)) {
      return { ok: false, code: "selective_target_duplicate_item", target, matches: [] };
    }
    seen.add(item.id);
    matches.push({ target, item });
  }
  return { ok: true, matches };
}

/**
 * Retry ONLY the listed canonical packages. Does not walk the rest of the offline queue.
 * @param {object} args
 * @param {string[]} args.canonicalIds
 * @param {(item: object) => Promise<object>} args.processItem
 */
export async function processSelectedFieldTestResultQueue({
  canonicalIds = [],
  processItem,
} = {}) {
  if (typeof processItem !== "function") {
    return { ok: false, code: "process_item_required" };
  }
  const queue = readMobileQueue();
  const selected = selectFieldTestQueueTargets(canonicalIds, queue);
  if (!selected.ok) return selected;

  const byId = new Map(queue.map((item) => [item.id, item]));
  const results = [];
  for (const { target, item } of selected.matches) {
    const result = await processItem({
      ...item,
      meta: { ...(item.meta || {}), manual_retry: true },
    });
    results.push({
      target,
      client_run_id: item.payload?.client_run_id || null,
      reason: result?.reason || null,
      package_state: result?.payload?.package_state || item.payload?.package_state || null,
      field_test_run_id: result?.payload?.field_test_run_id || item.payload?.field_test_run_id || null,
      keep: result?.keep !== false,
    });
    if (result?.keep === false) {
      byId.delete(item.id);
    } else if (result?.payload) {
      byId.set(item.id, {
        ...item,
        payload: result.payload,
        attempts: Number(result.payload?.attempts ?? item.attempts ?? 0),
        last_error: result.payload?.last_error || item.last_error || "",
        meta: { ...(item.meta || {}), manual_retry: false },
      });
    }
  }

  const next = queue.map((item) => byId.get(item.id)).filter(Boolean);
  saveMobileQueue(next);
  return { ok: true, results, pending: next.length };
}

export default {
  enqueueFieldTestResultSubmit,
  tryEnqueueFieldTestResultAfterSave,
  cancelQueuedFieldTestResult,
  listFieldTestResultQueueItems,
  ensureArtifactChecksums,
};
