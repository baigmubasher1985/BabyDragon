/**
 * F10C2 Phase 1+2 — Canonical server submission manifest.
 *
 * Adapts existing Unified Field Report / scenario models.
 * Does NOT recalculate RF or throughput math.
 *
 * Phase 1: pure export adapter + contracts.
 * Phase 2: same contract consumed by mobile packaging / mocked upload orchestrator.
 * Real Supabase submit remains OFF (F10C2_SERVER_SUBMIT_ENABLED = false).
 *
 * Callers must explicitly invoke buildServerSubmissionManifest().
 * Never accept client-supplied submitted_by / verified_user_id / reviewer_id / QC fields.
 */

import {
  SCENARIO_KEYS,
  resolveScenarioKey,
  scenarioDisplayName,
} from "./scenarioReportModel.js";
import { UNIFIED_FIELD_REPORT_VERSION } from "./unifiedFieldReportModel.js";

export const SERVER_SUBMISSION_MANIFEST_SCHEMA_VERSION = "1.0.0-f10c2-phase1";

/** Documented feature flag — OFF. Phase 2 may flip after RPC cutover. */
export const F10C2_SERVER_SUBMIT_ENABLED = false;

export const ARTIFACT_TYPES = Object.freeze({
  UNIFIED_JSON: "unified_json",
  RF_CSV: "rf_csv",
  GPS_CSV: "gps_csv",
  EVENTS_CSV: "events_csv",
  SCENARIO_CSV: "scenario_csv",
  EXCEL_PLOT: "excel_plot",
  OOKLA_EVIDENCE: "ookla_evidence",
  FCC_EVIDENCE: "fcc_evidence",
  PACKAGE_ZIP: "package_zip",
  OTHER: "other",
});

export const RESULT_ARTIFACTS_BUCKET = "result-artifacts";

const SAFE_EXTENSIONS = new Set(["json", "csv", "xlsx", "zip", "jpg", "jpeg", "png"]);

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function getNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Build private object_key (bucket stored separately).
 * {project_id}/{task_id}/{verified_user_id}/{field_test_run_id}/{artifact_id}.{ext}
 */
export function buildResultArtifactObjectKey({
  projectId,
  taskId,
  verifiedUserId,
  fieldTestRunId,
  artifactId,
  safeExtension,
}) {
  const ext = String(safeExtension || "")
    .toLowerCase()
    .replace(/^\./, "");
  if (!SAFE_EXTENSIONS.has(ext)) {
    throw new Error("unsafe_extension");
  }
  const normalized = ext === "jpeg" ? "jpg" : ext;
  for (const part of [projectId, taskId, verifiedUserId, fieldTestRunId, artifactId]) {
    if (!part) throw new Error("object_key_segment_required");
  }
  return `${projectId}/${taskId}/${verifiedUserId}/${fieldTestRunId}/${artifactId}.${normalized}`;
}

export function durableArtifactRef(bucket, objectKey) {
  if (!bucket || !objectKey) throw new Error("bucket_and_object_key_required");
  if (/^https?:\/\//i.test(objectKey)) throw new Error("signed_or_public_url_not_durable");
  return { bucket, object_key: objectKey };
}

function summarizeOutcome(outcome = {}) {
  return {
    normalizedStatus: cleanText(outcome.normalizedStatus) || cleanText(outcome.status) || null,
    plannedIterations: getNumber(outcome.plannedIterations),
    completedIterations: getNumber(outcome.completedIterations),
    failedIterations: getNumber(outcome.failedIterations),
    conciseReason: cleanText(outcome.conciseReason) || cleanText(outcome.failureReason) || null,
    failureTruth: cleanText(outcome.failureTruth) || cleanText(outcome.errorMessage) || null,
  };
}

function summarizeScenarioEntry(entry = {}) {
  const session = entry.session || {};
  const scenarioKey = entry.scenarioKey || resolveScenarioKey(session);
  const outcome = entry.outcome || {};
  return {
    scenarioId: entry.scenarioId || null,
    scenario_type: scenarioKey,
    scenario_label: entry.scenarioLabel || scenarioDisplayName(scenarioKey),
    source_family: entry.sourceFamily || null,
    run_mode_label: entry.runModeLabel || null,
    started_at: entry.startedAt || session.startedAt || null,
    ended_at: entry.endedAt || session.endedAt || null,
    duration_ms: getNumber(entry.durationMs),
    status: cleanText(entry.status) || null,
    attempt_counts: {
      planned: getNumber(outcome.plannedIterations),
      completed: getNumber(outcome.completedIterations),
      failed: getNumber(outcome.failedIterations),
    },
    failure_truth: summarizeOutcome(outcome),
    report_log_name: cleanText(entry.reportLogName) || cleanText(session.reportLogName),
    rf_sample_count: Array.isArray(entry.rfRows) ? entry.rfRows.length : 0,
    event_count: Array.isArray(entry.events) ? entry.events.length : 0,
  };
}

function summarizeRf(unified = {}) {
  const rf = unified.rf || unified.rfSummary || {};
  return {
    sample_count: getNumber(rf.sampleCount) ?? getNumber(rf.uniqueSampleCount) ?? null,
    serving_rsrp_avg: getNumber(rf.servingRsrpAvg) ?? getNumber(rf.rsrpAvg) ?? null,
    serving_rsrq_avg: getNumber(rf.servingRsrqAvg) ?? getNumber(rf.rsrqAvg) ?? null,
    notes: cleanText(rf.notes),
  };
}

function summarizeGps(unified = {}) {
  const gps = unified.gps || unified.gpsSummary || unified.route || {};
  return {
    sample_count: getNumber(gps.sampleCount) ?? getNumber(gps.gpsSampleCount) ?? null,
    route_quality: cleanText(gps.routeQuality) || cleanText(gps.route_status) || null,
    notes: cleanText(gps.notes),
  };
}

function summarizeData(unified = {}, scenarios = []) {
  return {
    scenario_count: scenarios.length,
    field_status: cleanText(unified.fieldStatus) || cleanText(unified.evidenceCollectionStatus) || null,
    scenarios: scenarios.map(summarizeScenarioEntry),
  };
}

function summarizeEvents(unified = {}) {
  const events = unified.events || unified.eventsSummary || {};
  return {
    radio_event_count: getNumber(events.radioEventCount) ?? getNumber(events.radioCount) ?? null,
    data_event_count: getNumber(events.dataEventCount) ?? getNumber(events.dataCount) ?? null,
    voice_event_count: getNumber(events.voiceEventCount) ?? getNumber(events.voiceCount) ?? null,
  };
}

/**
 * Normalize an artifact descriptor for the manifest (no signed URLs).
 */
export function buildArtifactDescriptor({
  artifactId,
  artifactType,
  originalFileName = null,
  mimeType,
  sizeBytes,
  checksum,
  safeExtension,
  uploadStatus = "pending",
  objectKey = null,
  bucket = RESULT_ARTIFACTS_BUCKET,
} = {}) {
  if (!artifactId) throw new Error("artifact_id_required");
  if (!artifactType) throw new Error("artifact_type_required");
  if (!mimeType) throw new Error("mime_type_required");
  if (typeof sizeBytes !== "number" || sizeBytes < 0) throw new Error("size_bytes_invalid");
  if (!checksum) throw new Error("checksum_required");
  if (/^https?:\/\//i.test(String(objectKey || ""))) {
    throw new Error("signed_or_public_url_not_durable");
  }
  return {
    artifact_id: artifactId,
    artifact_type: artifactType,
    bucket,
    object_key: objectKey,
    original_file_name: cleanText(originalFileName),
    mime_type: mimeType,
    size_bytes: sizeBytes,
    checksum,
    safe_extension: cleanText(safeExtension),
    upload_status: uploadStatus,
  };
}

/**
 * Canonical server submission manifest.
 *
 * @param {object} params
 * @param {string} params.clientRunId - Client idempotency UUID (required)
 * @param {object} [params.unifiedReport] - Output-shaped unified field report model (optional)
 * @param {object} [params.session] - Single-scenario session when unified report absent
 * @param {object} params.taskContext - { taskId, projectId, gridId }
 * @param {object} [params.device] - Device / app / build metadata
 * @param {object} [params.network] - Network / RAT snapshot
 * @param {object[]} [params.artifacts] - Artifact descriptors
 * @param {object} [params.config] - Scenario config snapshot (non-secret)
 */
export function buildServerSubmissionManifest({
  clientRunId,
  unifiedReport = null,
  session = null,
  taskContext = {},
  device = {},
  network = {},
  artifacts = [],
  config = {},
  reportName = null,
  startedAtDevice = null,
  endedAtDevice = null,
} = {}) {
  if (!F10C2_SERVER_SUBMIT_ENABLED) {
    // Flag documents OFF cutover; building the manifest for export/tests is still allowed.
  }

  if (!clientRunId) throw new Error("client_run_id_required");
  if (!taskContext.taskId) throw new Error("task_id_required");
  if (!taskContext.projectId) throw new Error("project_id_required");

  const scenarios = Array.isArray(unifiedReport?.scenarios)
    ? unifiedReport.scenarios
    : session
      ? [{ session, scenarioKey: resolveScenarioKey(session), outcome: session.dataTestOutcome || {} }]
      : [];

  const primaryScenario =
    scenarios[0]?.scenarioKey
    || (session ? resolveScenarioKey(session) : SCENARIO_KEYS.RF_ONLY);

  const isUnified = scenarios.length > 1
    || cleanText(unifiedReport?.reportKind) === "unified_field_report"
    || Boolean(unifiedReport?.scenarios);

  const scenarioType = isUnified && scenarios.length > 1
    ? "unified_field_report"
    : primaryScenario;

  const normalizedArtifacts = (Array.isArray(artifacts) ? artifacts : []).map((a) => {
    if (a?.artifact_id && a?.artifact_type && a?.mime_type && a?.checksum) {
      // Already a canonical descriptor (snake_case) — pass through after URL check.
      if (a.object_key && /^https?:\/\//i.test(String(a.object_key))) {
        throw new Error("signed_or_public_url_not_durable");
      }
      return {
        artifact_id: a.artifact_id,
        artifact_type: a.artifact_type,
        bucket: a.bucket || RESULT_ARTIFACTS_BUCKET,
        object_key: a.object_key || null,
        original_file_name: a.original_file_name || null,
        mime_type: a.mime_type,
        size_bytes: a.size_bytes,
        checksum: a.checksum,
        safe_extension: a.safe_extension || null,
        upload_status: a.upload_status || "pending",
      };
    }
    return buildArtifactDescriptor(a);
  });

  return {
    schema_version: SERVER_SUBMISSION_MANIFEST_SCHEMA_VERSION,
    client_run_id: clientRunId,
    task_id: taskContext.taskId,
    project_id: taskContext.projectId,
    grid_id: taskContext.gridId || null,
    scenario_type: scenarioType,
    scenario_version: UNIFIED_FIELD_REPORT_VERSION,
    config: config && typeof config === "object" ? { ...config } : {},
    started_at_device: startedAtDevice
      || unifiedReport?.startedAt
      || session?.startedAt
      || null,
    ended_at_device: endedAtDevice
      || unifiedReport?.endedAt
      || session?.endedAt
      || null,
    report_name: cleanText(reportName)
      || cleanText(unifiedReport?.reportName)
      || cleanText(session?.reportLogName)
      || null,
    device: {
      model: cleanText(device.model) || cleanText(device.deviceModel) || null,
      platform: cleanText(device.platform) || null,
      os_version: cleanText(device.osVersion) || null,
      app_version: cleanText(device.appVersion) || null,
      build_number: cleanText(device.buildNumber) || null,
    },
    network: {
      rat: cleanText(network.rat) || cleanText(network.networkType) || null,
      operator: cleanText(network.operator) || cleanText(network.carrier) || null,
      band: cleanText(network.band) || null,
      connectivity: cleanText(network.connectivity) || null,
    },
    rf_summary: summarizeRf(unifiedReport || {}),
    gps_summary: summarizeGps(unifiedReport || {}),
    data_summary: summarizeData(unifiedReport || {}, scenarios),
    events_summary: summarizeEvents(unifiedReport || {}),
    artifacts: normalizedArtifacts,
    feature_flags: {
      F10C2_SERVER_SUBMIT: F10C2_SERVER_SUBMIT_ENABLED,
    },
    // Explicit: submitted_by is NEVER taken from client — server RPC forces auth.uid().
    ownership: {
      submitted_by_client_supplied: null,
      submitted_by_authoritative_source: "auth.uid_via_rpc",
    },
  };
}

/**
 * Validate manifest shape for contract tests / local preflight (no network).
 */
export function validateServerSubmissionManifest(manifest = {}) {
  const errors = [];
  if (manifest.schema_version !== SERVER_SUBMISSION_MANIFEST_SCHEMA_VERSION) {
    errors.push("schema_version_mismatch");
  }
  if (!manifest.client_run_id) errors.push("client_run_id_required");
  if (!manifest.task_id) errors.push("task_id_required");
  if (!manifest.project_id) errors.push("project_id_required");
  if (!manifest.scenario_type) errors.push("scenario_type_required");
  if (manifest.ownership?.submitted_by_client_supplied != null) {
    errors.push("client_must_not_supply_submitted_by");
  }
  // Reject client-supplied server/QC/authorship fields if smuggled into config/root.
  for (const banned of [
    "submitted_by",
    "verified_user_id",
    "reviewer_id",
    "qc_decision",
    "qc_status",
    "processing_status",
  ]) {
    if (manifest[banned] != null) errors.push(`client_must_not_supply_${banned}`);
  }
  for (const art of manifest.artifacts || []) {
    if (!art.checksum) errors.push("artifact_checksum_required");
    if (art.object_key && /^https?:\/\//i.test(art.object_key)) {
      errors.push("artifact_signed_url_forbidden");
    }
    if (art.object_key && (String(art.object_key).includes("..") || String(art.object_key).startsWith("/"))) {
      errors.push("artifact_object_key_unsafe");
    }
    if (art.bucket && art.bucket !== RESULT_ARTIFACTS_BUCKET) {
      errors.push("artifact_bucket_must_be_result_artifacts");
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Phase 2 helper — strip absolute paths / URLs from artifact file names before packaging.
 */
export function sanitizeArtifactFileName(fileName) {
  if (fileName == null) return null;
  let name = String(fileName).replace(/\\/g, "/");
  if (/^https?:\/\//i.test(name)) return null;
  name = name.replace(/^[a-zA-Z]:\//, "");
  const parts = name.split("/");
  const base = parts[parts.length - 1] || null;
  if (!base || base.includes("..")) return null;
  return base;
}

export default {
  SERVER_SUBMISSION_MANIFEST_SCHEMA_VERSION,
  F10C2_SERVER_SUBMIT_ENABLED,
  ARTIFACT_TYPES,
  RESULT_ARTIFACTS_BUCKET,
  buildResultArtifactObjectKey,
  durableArtifactRef,
  buildArtifactDescriptor,
  buildServerSubmissionManifest,
  validateServerSubmissionManifest,
  sanitizeArtifactFileName,
};
