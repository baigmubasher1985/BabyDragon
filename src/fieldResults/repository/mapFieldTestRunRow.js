/**
 * Map field_test_* rows + joins into the Phase 3 Field Results view-model shape.
 * Missing numeric metrics stay null/unavailable — never coerced to zero.
 */

import { scenarioLabel } from "../models/fieldResultTypes.js";
import { displayAcceptanceFromSnapshot } from "../../acceptance/scenarioApplicability.js";
import { aggregateCompletedIterationThroughput } from "../../mobile/testEngines/iperf3ResultMapper.js";

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

function displayCanonicalPackageId(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (text.includes("::")) return text;
  const sessionMatch = text.match(/^session:([^|]+)\|scenario:(.+)$/i);
  if (sessionMatch) return `${sessionMatch[1]}::${sessionMatch[2]}`;
  return text;
}

function firstFiniteCount(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function recoverRfSampleCount(rf = {}, data = {}) {
  const scenario = (data.scenarios || [])[0] || {};
  return firstFiniteCount(
    rf.sample_count,
    rf.sampleCount,
    data.session?.sample_count,
    data.session?.sampleCount,
    data.trace?.sample_count,
    scenario.rf_sample_count,
  );
}

function recoverGpsSampleCount(gps = {}, data = {}) {
  const scenario = (data.scenarios || [])[0] || {};
  return firstFiniteCount(
    gps.sample_count,
    gps.sampleCount,
    gps.valid_count,
    data.session?.gps_points,
    data.session?.gpsPoints,
    data.trace?.sample_count,
    scenario.gps_sample_count,
  );
}

function deriveCompletedThroughput(iterations = [], metrics = {}) {
  const hasAvg = metrics.dl_mbps_avg != null || metrics.ul_mbps_avg != null
    || metrics.dl_mbps != null || metrics.ul_mbps != null;
  const mapped = (iterations || []).map((row) => ({
    status: row.status || row.overall_verdict,
    dlMbps: row.dl_mbps ?? row.dlMbps ?? row.actual_dl_mbps,
    ulMbps: row.ul_mbps ?? row.ulMbps ?? row.actual_ul_mbps,
  }));
  const summary = aggregateCompletedIterationThroughput(mapped);
  return {
    dl_mbps_avg: metrics.dl_mbps_avg ?? metrics.dl_mbps ?? summary.avgDlMbps ?? null,
    ul_mbps_avg: metrics.ul_mbps_avg ?? metrics.ul_mbps ?? summary.avgUlMbps ?? null,
    derived_from_completed_iterations: !hasAvg && summary.completed > 0,
    completed_used: summary.completed || null,
  };
}

function conciseRf(rf = {}) {
  if (!rf || typeof rf !== "object") return "unavailable";
  const avg = rf.serving_rsrp_avg ?? rf.rsrp_avg ?? rf.lte?.rsrp?.avg ?? rf.nr?.ss_rsrp?.avg ?? rf.nr?.avg_ss_rsrp_dbm;
  const count = Object.prototype.hasOwnProperty.call(rf, "sample_count") ? rf.sample_count : null;
  const parts = [];
  if (count != null) parts.push(`${count} samples`);
  if (avg != null) parts.push(`RSRP ${avg}`);
  return parts.length ? parts.join(" · ") : (rf.notes || rf.unavailable_reason || "unavailable");
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

function scenarioDashboard(run, data, rf, gps, events) {
  const type = run.scenario_type;
  const scenario = (data.scenarios || [])[0] || {};
  const iterations = scenario.iterations || data.iterations || [];
  const metrics = data.metrics || {};
  const common = {
    result_id: run.id,
    client_run_id: run.client_run_id,
    scenario_type: type,
    scenario_label: scenarioLabel(type),
    project_id: run.project_id,
    task_id: run.task_id,
    grid_id: run.grid_id,
    field_engineer_id: run.submitted_by,
    device_model: run.device_model,
    app_version: run.app_version,
    started_at: run.started_at_device || run.started_at_server || run.created_at,
    ended_at: run.ended_at_device || run.ended_at_server || null,
  };
  const rfGps = {
    rf_sample_count: recoverRfSampleCount(rf, data),
    serving_rsrp_avg: rf.serving_rsrp_avg ?? rf.rsrp_avg ?? rf.lte?.rsrp?.avg ?? rf.nr?.avg_ss_rsrp_dbm ?? null,
    serving_rsrq_avg: rf.serving_rsrq_avg ?? rf.rsrq_avg ?? rf.lte?.rsrq?.avg ?? rf.nr?.avg_ss_rsrq_db ?? null,
    serving_sinr_avg: rf.serving_sinr_avg ?? rf.sinr_avg ?? rf.lte?.sinr?.avg ?? rf.nr?.avg_ss_sinr_db ?? null,
    rat: rf.rat || rf.nr_mode || data.session?.rat || null,
    gps_sample_count: recoverGpsSampleCount(gps, data),
    gps_start: gps.start || null,
    gps_end: gps.end || null,
  };
  const http = type === "native_http" ? {
    dl_mbps: metrics.dl_mbps_avg ?? iterations[0]?.dl_mbps ?? null,
    ul_mbps: metrics.ul_mbps_avg ?? iterations[0]?.ul_mbps ?? null,
    latency_ms: metrics.http_latency_ms ?? iterations[0]?.http_latency_ms ?? null,
    iteration_count: iterations.length || run.completed_iterations || null,
  } : null;
  const ftp = type === "ftp" ? {
    dl_mbps: metrics.dl_mbps ?? metrics.throughput_mbps_avg ?? null,
    ul_mbps: metrics.ul_mbps ?? null,
    bytes: metrics.bytes ?? null,
    duration_ms: metrics.duration_ms ?? null,
  } : null;
  const derivedThp = deriveCompletedThroughput(iterations, metrics);
  const iperf = type === "iperf3" ? {
    dl_mbps: derivedThp.dl_mbps_avg,
    ul_mbps: derivedThp.ul_mbps_avg,
    reverse_receiver: metrics.reverse_receiver ?? true,
    iteration_count: iterations.length || run.completed_iterations || null,
    average_source: derivedThp.derived_from_completed_iterations
      ? "derived_completed_iterations"
      : (metrics.dl_mbps_avg != null || metrics.ul_mbps_avg != null ? "persisted_metrics" : null),
  } : null;
  const ookla = (type === "ookla" || type === "ookla_app") ? {
    dl_mbps: metrics.dl_mbps ?? metrics.download_mbps ?? null,
    ul_mbps: metrics.ul_mbps ?? metrics.upload_mbps ?? null,
    ping_ms: metrics.ping_ms ?? metrics.latency_ms ?? null,
    jitter_ms: metrics.jitter_ms ?? null,
    packet_loss_pct: metrics.packet_loss_pct ?? null,
  } : null;
  const fcc = (type === "fcc" || type === "fcc_app") ? {
    dl_mbps: metrics.dl_mbps ?? metrics.download_mbps ?? null,
    ul_mbps: metrics.ul_mbps ?? metrics.upload_mbps ?? null,
    latency_ms: metrics.latency_ms ?? null,
  } : null;
  const rfOnly = (type === "rf_only" || type === "rf_data") ? {
    data_verdict: "N/A",
    voice_verdict: "N/A",
    note: "RF-only — data and voice not applicable unless configured.",
  } : null;
  const mo = (type === "voice_mo" || type === "mo") ? {
    direction: "MO",
    events: events.call_events || events.counts?.voice_mo || null,
  } : null;
  const mt = (type === "voice_mt" || type === "mt") ? {
    direction: "MT",
    events: events.call_events || events.counts?.voice_mt || null,
  } : null;
  const combined = (type === "combined" || type === "unified_field_report") ? {
    data_family: true,
    voice_family: true,
  } : null;
  return {
    common,
    rf_gps: rfGps,
    native_http: http,
    ftp,
    iperf3: iperf,
    ookla,
    fcc,
    rf_only: rfOnly,
    voice_mo: mo,
    voice_mt: mt,
    combined,
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
  acceptanceSnapshot = null,
  iterationEvaluations = [],
  callSummary = null,
  acceptanceOverride = null,
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
  const rawAcceptance = acceptanceSnapshot || run.acceptance || null;
  const displayedAcceptance = displayAcceptanceFromSnapshot({
    snapshot: rawAcceptance,
    scenarioType: run.scenario_type,
    iterations: iterationEvaluations || run.iteration_evaluations || [],
    callEvents: callSummary?.events || [],
    profile: { rules: rawAcceptance?.resolved_rules || {} },
  }) || rawAcceptance;
  const displayedCallSummary = displayedAcceptance && displayedAcceptance.mo_verdict === "N/A"
    ? {
      ...(callSummary || run.call_summary || {}),
      mo_verdict: "N/A",
      mt_verdict: "N/A",
      overall_verdict: "N/A",
      mo: { required: null, actual: (callSummary || {}).mo_successful ?? null, verdict: "N/A" },
      mt: { required: null, actual: (callSummary || {}).mt_successful ?? null, verdict: "N/A" },
    }
    : (callSummary || run.call_summary || null);
  const canonicalPackageId = displayCanonicalPackageId(
    run.package_identity
    || run.client_package_identity?.canonical_package_id
    || run.canonical_package_id
    || null,
  );
  const labeledSynthetic = run.labeled_synthetic === true
    || run.source_kind === "synthetic"
    || /^synthetic[_-]/i.test(String(run.report_name || ""));

  const recoveredRfCount = recoverRfSampleCount(rf, data);
  const recoveredGpsCount = recoverGpsSampleCount(gps, data);
  const rfView = {
    ...rf,
    sample_count: recoveredRfCount,
  };
  const gpsView = {
    ...gps,
    sample_count: recoveredGpsCount,
  };
  const iterationRows = data.scenarios?.[0]?.iterations || data.iterations || run.iteration_evaluations || [];
  const derivedThp = deriveCompletedThroughput(iterationRows, data.metrics || {});
  const mergedMetrics = {
    ...(data.metrics || {}),
    dl_mbps_avg: data.metrics?.dl_mbps_avg ?? derivedThp.dl_mbps_avg,
    ul_mbps_avg: data.metrics?.ul_mbps_avg ?? derivedThp.ul_mbps_avg,
    average_source: derivedThp.derived_from_completed_iterations ? "derived_completed_iterations" : data.metrics?.average_source,
  };

  return {
    id: run.id,
    client_run_id: run.client_run_id,
    package_identity: canonicalPackageId,
    canonical_package_id: canonicalPackageId,
    labeled_synthetic: labeledSynthetic,
    source_kind: labeledSynthetic ? "synthetic" : (run.source_kind || "apk"),
    superseded: run.superseded === true || run.is_superseded === true,
    tenant_id: run.tenant_id || null,
    report_name: run.report_name,
    task_id: run.task_id,
    task_name: task?.title || task?.name || run.task_id,
    project_id: run.project_id,
    project_name: project?.name || run.project_id,
    vendor_name: project?.customer || project?.vendor_name || project?.vendor || task?.vendor_name || task?.vendor || null,
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
      requested: clean(run.requested_iterations ?? attempt.planned),
      attempted: clean(run.attempted_iterations)
        ?? (clean(attempt.completed) != null && clean(attempt.failed) != null
          ? Number(attempt.completed) + Number(attempt.failed)
          : clean(attempt.planned)),
      completed: clean(run.completed_iterations ?? attempt.completed),
      failed: clean(run.failed_iterations ?? attempt.failed),
      remaining: null,
    },
    upload_state: mapUploadState(run, artifacts),
    processing_state: mapProcessing(run),
    latest_qc_status: latestQc,
    redrive_needed: Boolean(qc?.redrive_needed),
    redrive_task_id: qc?.redrive_task_id || null,
    rf_summary_concise: conciseRf(rfView),
    data_summary_concise: conciseData(data, run.scenario_type),
    device: {
      app_version: run.app_version,
      build: run.build_number,
      model: run.device_model,
    },
    test_summary: {
      truth: data.field_status || null,
      config: data.config || null,
      metrics: mergedMetrics,
      failure_summary: data.failure_truth?.conciseReason || data.failure_summary || null,
    },
    rf_summary: rfView,
    gps_summary: gpsView,
    gps_trace_points: run.gps_trace_points || null,
    events_summary: events,
    scenario_details: {
      scenario_type: run.scenario_type,
      applicable_only: true,
      data_summary: data,
      dashboard: scenarioDashboard(run, { ...data, metrics: mergedMetrics }, rfView, gpsView, events),
      unavailable_note: "Values not present remain unavailable — never coerced to zero.",
    },
    artifacts: mappedArtifacts,
    qc_history: mapQcHistory(qc),
    has_failures: Number(attempt.failed || 0) > 0,
    acceptance: displayedAcceptance,
    iteration_evaluations: iterationEvaluations || run.iteration_evaluations || [],
    call_summary: displayedCallSummary,
    acceptance_override: acceptanceOverride || run.acceptance_override || null,
    acceptance_verdict: displayedAcceptance?.overall_verdict || run.acceptance_verdict || null,
  };
}

export default { mapFieldTestRunRow };
