/**
 * F10C2 CR1-B — canonical ingest from APK package / manifest into server records.
 * Does not create a second mobile queue. Idempotent on client_run_id + idempotency_key.
 * Missing measurements remain null — never coerced to zero.
 */

import { numericOrNull } from "./verdicts.js";
import { evaluateFieldTestRun } from "./evaluateRun.js";
import { isFailedIterationRow, isCompletedIterationRow } from "../mobile/rf/reports/controlledIterationContract.js";
import { coerceDeviceTimestamp } from "../mobile/rf/reports/serverSubmissionManifest.js";

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function identityOf(payload = {}) {
  const manifest = payload.manifest || {};
  return {
    client_run_id: payload.client_run_id || manifest.client_run_id,
    package_identity: payload.package_identity || payload.identity_key || manifest.package_identity || null,
    idempotency_key: payload.idempotency_key
      || payload.identity_key
      || (payload.client_run_id ? `run:${payload.client_run_id}` : null),
  };
}

function mapIteration(row = {}, index = 0, scenarioKind = null) {
  const dl = numericOrNull(row.dl_mbps ?? row.dlMbps);
  const ul = numericOrNull(row.ul_mbps ?? row.ulMbps);
  const failed = isFailedIterationRow(row);
  const completed = isCompletedIterationRow(row);
  let status = "incomplete";
  if (failed) status = "failed";
  else if (completed) status = "completed";
  else if (cleanText(row.status)) status = String(row.status).toLowerCase();

  return {
    iteration_number: numericOrNull(row.iteration_number ?? row.iterationNumber ?? row.iteration) ?? index + 1,
    scenario_kind: scenarioKind || row.scenario_kind || row.scenario_type || null,
    started_at: coerceDeviceTimestamp(row.started_at || row.startedAt || row.timestamp || row.started_at_iso),
    ended_at: coerceDeviceTimestamp(row.ended_at || row.endedAt || row.ended_at_iso),
    status,
    execution_failed: failed,
    dl_mbps: dl,
    ul_mbps: ul,
    http_latency_ms: numericOrNull(row.http_latency_ms ?? row.latencyMs ?? row.latency_ms),
    failure_reason: failed ? (cleanText(row.failure_reason) || cleanText(row.conciseReason) || cleanText(row.error) || "execution_failure") : null,
    incomplete_reason: !failed && !completed ? (cleanText(row.incomplete_reason) || cleanText(row.conciseReason) || "incomplete") : null,
    raw_measurement: {
      source: "persisted_iteration",
      has_dl: dl != null,
      has_ul: ul != null,
    },
  };
}

function collectIterations(payload = {}) {
  const manifest = payload.manifest || {};
  const data = manifest.data_summary || payload.data_summary || {};
  const adapter = manifest.config?.scenario_adapter || {};
  const scenarioKind = manifest.scenario_type || adapter.scenario_type || payload.scenario_type;

  const direct = payload.iterations || data.iterations || adapter.iterations || [];
  if (Array.isArray(direct) && direct.length) {
    return direct.map((row, i) => mapIteration(row, i, scenarioKind));
  }

  const fromScenarios = [];
  for (const scenario of data.scenarios || adapter.scenarios || []) {
    const kind = scenario.scenario_type || scenarioKind;
    const rows = scenario.iterations || scenario.appIterationResults || [];
    rows.forEach((row, i) => fromScenarios.push(mapIteration(row, i, kind)));
  }
  if (fromScenarios.length) return fromScenarios;

  const sessionRows = payload.session?.appIterationResults || [];
  return sessionRows.map((row, i) => mapIteration(row, i, scenarioKind));
}

function collectCallEvents(payload = {}) {
  const events = payload.call_events || payload.voice_events || payload.manifest?.events_summary?.call_events || [];
  if (!Array.isArray(events)) return [];
  return events.map((event) => ({
    direction: String(event.direction || "").toUpperCase(),
    event_type: event.event_type || event.status || event.outcome,
    occurred_at: coerceDeviceTimestamp(event.occurred_at || event.timestamp || null),
    payload: { labeled_synthetic: Boolean(event.synthetic || payload.synthetic_call_events) },
  }));
}

function countFromIterations(iterations, dataSummary = {}) {
  const scenario = (dataSummary.scenarios || [])[0] || {};
  const planned = numericOrNull(scenario.attempt_counts?.planned);
  const completedHint = numericOrNull(scenario.attempt_counts?.completed);
  const failedHint = numericOrNull(scenario.attempt_counts?.failed);
  return {
    requested: planned ?? iterations.length,
    attempted: iterations.filter((i) => i.status !== "not_attempted").length || (completedHint != null && failedHint != null ? completedHint + failedHint : iterations.length),
    completed: completedHint ?? iterations.filter((i) => i.status === "completed").length,
    failed: failedHint ?? iterations.filter((i) => i.status === "failed" || i.execution_failed).length,
  };
}

function sameIdentity(a, b) {
  return a.client_run_id === b.client_run_id
    && String(a.package_identity || "") === String(b.package_identity || "");
}

/**
 * In-memory canonical store used by unit tests and mock provider.
 * Live disposable persistence is the SQL twin (ingest_field_test_canonical_result).
 */
export function createCanonicalIngestStore({ profiles = [], now = () => new Date().toISOString() } = {}) {
  const runs = new Map();
  const byIdempotency = new Map();
  const qcByRun = new Map();
  const overridesByRun = new Map();
  let serverSeq = 0;

  function ingest(payload = {}) {
    const ids = identityOf(payload);
    if (!ids.client_run_id) {
      return { ok: false, code: "client_run_id_required" };
    }
    if (!ids.idempotency_key) {
      return { ok: false, code: "idempotency_key_required" };
    }

    const existingByKey = byIdempotency.get(ids.idempotency_key);
    if (existingByKey) {
      if (!sameIdentity(existingByKey, ids)) {
        return { ok: false, code: "idempotency_key_reuse" };
      }
      return { ok: true, idempotent: true, run: existingByKey };
    }

    const existingByClient = runs.get(ids.client_run_id);
    if (existingByClient) {
      if (existingByClient.idempotency_key && existingByClient.idempotency_key !== ids.idempotency_key) {
        return { ok: false, code: "idempotency_key_reuse" };
      }
      return { ok: true, idempotent: true, run: existingByClient };
    }

    const manifest = payload.manifest || {};
    const iterations = collectIterations(payload);
    const callEvents = collectCallEvents(payload);
    const counts = countFromIterations(iterations, manifest.data_summary || payload.data_summary || {});
    serverSeq += 1;
    const run = {
      id: payload.server_run_id || `server-run-${serverSeq}`,
      client_run_id: ids.client_run_id,
      package_identity: ids.package_identity,
      idempotency_key: ids.idempotency_key,
      tenant_id: payload.tenant_id || manifest.tenant_id || null,
      project_id: payload.project_id || manifest.project_id,
      task_id: payload.task_id || manifest.task_id,
      grid_id: payload.grid_id || manifest.grid_id || null,
      submitted_by: payload.submitted_by || null,
      scenario_type: payload.scenario_type || manifest.scenario_type,
      device_model: manifest.device?.model || payload.device?.model || null,
      app_version: manifest.device?.app_version || payload.device?.app_version || null,
      build_number: manifest.device?.build_number || payload.device?.build_number || null,
      report_name: manifest.report_name || payload.report_name || null,
      requested_iterations: counts.requested,
      attempted_iterations: counts.attempted,
      completed_iterations: counts.completed,
      failed_iterations: counts.failed,
      upload_state: "uploaded",
      upload_started_at: payload.upload_started_at || now(),
      upload_completed_at: now(),
      incomplete_reason: payload.incomplete_reason || null,
      failure_reason: payload.failure_reason || null,
      synthetic_call_events: Boolean(payload.synthetic_call_events),
      rf_summary: manifest.rf_summary || payload.rf_summary || {},
      data_summary: manifest.data_summary || payload.data_summary || {},
      gps_summary: manifest.gps_summary || payload.gps_summary || {},
      events_summary: manifest.events_summary || payload.events_summary || {},
      artifacts: payload.artifacts || manifest.artifacts || [],
      iterations,
      call_events: callEvents,
      created_at: now(),
    };

    const evaluated = evaluateFieldTestRun({
      run,
      iterations,
      callEvents,
      profiles,
      evaluatedAt: now(),
    });
    if (!evaluated.ok) return evaluated;
    run.acceptance_snapshot = evaluated.snapshot;
    run.acceptance_verdict = evaluated.snapshot.overall_verdict;

    runs.set(run.client_run_id, run);
    byIdempotency.set(run.idempotency_key, run);
    return { ok: true, idempotent: false, run };
  }

  function reevaluate(clientRunId) {
    const run = runs.get(clientRunId);
    if (!run) return { ok: false, code: "run_not_found" };
    const evaluated = evaluateFieldTestRun({
      run,
      iterations: run.iterations,
      callEvents: run.call_events,
      profiles,
      existingSnapshot: run.acceptance_snapshot,
      evaluatedAt: now(),
    });
    if (!evaluated.ok) return evaluated;
    return { ok: true, idempotent: true, snapshot: evaluated.snapshot, run };
  }

  function saveQc(runId, decisionInput, actor) {
    const run = [...runs.values()].find((r) => r.id === runId || r.client_run_id === runId);
    if (!run) return { ok: false, code: "run_not_found" };
    const existing = qcByRun.get(run.id);
    const entry = {
      id: existing?.id || `qc-${run.id}`,
      field_test_run_id: run.id,
      qc_decision: decisionInput.decision,
      qc_notes: decisionInput.notes || "",
      missing_evidence: decisionInput.missingEvidence || [],
      reviewer_id: actor?.id || null,
      reviewed_at: now(),
    };
    qcByRun.set(run.id, entry);
    run.latest_qc_status = entry.qc_decision;
    run.qc_review = entry;
    return { ok: true, review: entry, created: !existing };
  }

  function overrideVerdict(runId, { verdict, reason }, actor) {
    const run = [...runs.values()].find((r) => r.id === runId || r.client_run_id === runId);
    if (!run) return { ok: false, code: "run_not_found" };
    const row = {
      run_id: run.id,
      snapshot_id: run.acceptance_snapshot?.profile_id || null,
      computed_verdict: run.acceptance_snapshot?.overall_verdict || null,
      override_verdict: verdict,
      reason,
      actor_id: actor?.id || null,
      created_at: now(),
    };
    overridesByRun.set(run.id, row);
    run.acceptance_override = row;
    return { ok: true, override: row };
  }

  return {
    ingest,
    reevaluate,
    saveQc,
    overrideVerdict,
    getByClientRunId: (id) => runs.get(id) || null,
    list: () => [...runs.values()],
    getQc: (runId) => qcByRun.get(runId) || null,
    getOverride: (runId) => overridesByRun.get(runId) || null,
  };
}

export function extractCanonicalMeasurements(payload) {
  return {
    identity: identityOf(payload),
    iterations: collectIterations(payload),
    call_events: collectCallEvents(payload),
  };
}

export default {
  createCanonicalIngestStore,
  extractCanonicalMeasurements,
};
