/**
 * Map field_test_* rows + joins into the Phase 3 Field Results view-model shape.
 * Missing numeric metrics stay null/unavailable — never coerced to zero.
 */

import { scenarioLabel } from "../models/fieldResultTypes.js";

function clean(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
}

function durationMs(start, end) {
  if (!start || !end) return null;
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return b - a;
}

function conciseRf(rf = {}) {
  if (!rf || typeof rf !== "object") return "unavailable";
  const avg = rf.serving_rsrp_avg ?? rf.rsrp_avg ?? rf.lte?.rsrp?.avg;
  const count = rf.sample_count;
  const parts = [];
  if (count != null) parts.push(`${count} samples`);
  if (avg != null) parts.push(`RSRP ${avg}`);
  return parts.length ? parts.join(" · ") : (rf.notes || "unavailable");
}

function conciseData(data = {}, scenarioType) {
  if (data?.field_status) return String(data.field_status);
  if (scenarioType) return scenarioLabel(scenarioType);
  return "unavailable";
}

function mapUploadState(run, artifacts = []) {
  const status = String(run.run_status || "").toLowerCase();
  if (status === "ready") return "uploaded";
  if (status === "failed") return "failed";
  if (status === "partial") return "partial";
  const complete = artifacts.filter((a) => a.upload_status === "complete").length;
  if (artifacts.length > 0 && complete === artifacts.length) return "uploaded";
  if (complete > 0) return "partial";
  if (status === "submitted" || status === "submitting") return "uploading";
  return "queued";
}

function mapProcessing(run) {
  return run.processing_status || run.processing_state || "pending";
}

function mapArtifact(row) {
  const complete = row.upload_status === "complete";
  return {
    artifact_id: row.id,
    artifact_type: row.artifact_type,
    filename: row.original_file_name || row.object_key?.split("/").pop() || row.artifact_type,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    checksum: row.checksum,
    checksum_status: complete ? "verified" : "pending",
    upload_status: complete ? "uploaded" : row.upload_status || "pending",
    required: true,
    available: complete,
    missing: !complete,
    bucket: row.bucket,
    object_key: row.object_key,
    object_key_hint: row.object_key,
    tenant_id: row.tenant_id || null,
    storage_connection_id: row.storage_connection_id || null,
    provider_object_id: row.provider_object_id || null,
    processing_status: row.processing_status || null,
    sha256: row.sha256 || row.checksum || null,
  };
}

function mapQcHistory(review) {
  if (!review) return [];
  return [
    {
      id: review.id,
      decision: review.qc_decision,
      reviewer_id: review.reviewer_id,
      reviewer_name: review.reviewer_name || review.reviewer_id,
      decided_at: review.reviewed_at || review.updated_at,
      notes: review.qc_notes || "",
      missing_evidence: review.missing_evidence || [],
      redrive_reason: review.redrive_reason || "",
      redrive_task_id: review.redrive_task_id || null,
      previous_decision: null,
    },
  ];
}

export function mapFieldTestRunRow({
  run,
  artifacts = [],
  qcReview = null,
  task = null,
  project = null,
  grid = null,
  profile = null,
} = {}) {
  if (!run) return null;
  const rf = run.rf_summary && typeof run.rf_summary === "object" ? run.rf_summary : {};
  const data = run.data_summary && typeof run.data_summary === "object" ? run.data_summary : {};
  const gps = run.gps_summary && typeof run.gps_summary === "object" ? run.gps_summary : {};
  const events = run.events_summary && typeof run.events_summary === "object" ? run.events_summary : {};
  const started = run.started_at_device || run.started_at_server || run.created_at;
  const ended = run.ended_at_device || run.ended_at_server || null;
  const mappedArtifacts = artifacts.map(mapArtifact);
  const qc = qcReview || null;
  const latestQc = qc?.qc_decision || run.latest_qc_status || "Waiting for Review";
  const attempt = data.scenarios?.[0]?.attempt_counts || {};

  return {
    id: run.id,
    client_run_id: run.client_run_id,
    tenant_id: run.tenant_id || null,
    report_name: run.report_name,
    task_id: run.task_id,
    task_name: task?.title || task?.name || run.task_id,
    project_id: run.project_id,
    project_name: project?.name || run.project_id,
    grid_id: run.grid_id,
    grid_name: grid?.name || run.grid_id || "—",
    market: task?.market || project?.market || grid?.market || null,
    field_engineer: {
      id: run.submitted_by,
      name: profile?.full_name || profile?.email || run.submitted_by,
      email: profile?.email || null,
    },
    scenario_type: run.scenario_type,
    started_at: started,
    ended_at: ended,
    duration_ms: durationMs(started, ended),
    completion_status: data.field_status || (run.run_status === "ready" ? "success" : run.run_status),
    attempt_counts: {
      requested: clean(attempt.planned),
      attempted: clean(attempt.completed) != null && clean(attempt.failed) != null
        ? Number(attempt.completed) + Number(attempt.failed)
        : clean(attempt.planned),
      completed: clean(attempt.completed),
      failed: clean(attempt.failed),
      remaining: null,
    },
    upload_state: mapUploadState(run, artifacts),
    processing_state: mapProcessing(run),
    latest_qc_status: latestQc,
    redrive_needed: Boolean(qc?.redrive_needed),
    redrive_task_id: qc?.redrive_task_id || null,
    rf_summary_concise: conciseRf(rf),
    data_summary_concise: conciseData(data, run.scenario_type),
    device: {
      app_version: run.app_version,
      build: run.build_number,
      model: run.device_model,
    },
    test_summary: {
      truth: data.field_status || null,
      config: data.config || null,
      metrics: data.metrics || null,
      failure_summary: data.failure_truth?.conciseReason || data.failure_summary || null,
    },
    rf_summary: rf,
    gps_summary: gps,
    events_summary: events,
    scenario_details: {
      scenario_type: run.scenario_type,
      applicable_only: true,
      data_summary: data,
      unavailable_note: "Values not present remain unavailable — never coerced to zero.",
    },
    artifacts: mappedArtifacts,
    qc_history: mapQcHistory(qc),
    has_failures: Number(attempt.failed || 0) > 0,
  };
}

export default { mapFieldTestRunRow };
