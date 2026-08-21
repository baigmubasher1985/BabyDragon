/**
 * F10C2 Phase 2 — Scenario adapters over existing truth (no KPI recalculation).
 * Covers Native HTTP, FTP, iPerf3, OOKLA, FCC, RF-only + edge cases.
 */

import {
  SCENARIO_KEYS,
  resolveScenarioKey,
  scenarioDisplayName,
} from "../reports/scenarioReportModel.js";

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

function outcomeFromSession(session = {}) {
  const outcome = session.dataTestOutcome || session.outcome || {};
  return {
    normalizedStatus:
      cleanText(outcome.normalizedStatus)
      || cleanText(outcome.status)
      || cleanText(session.status)
      || null,
    plannedIterations: getNumber(outcome.plannedIterations),
    completedIterations: getNumber(outcome.completedIterations) ?? getNumber(session.appIterationResults?.length),
    failedIterations: getNumber(outcome.failedIterations),
    conciseReason: cleanText(outcome.conciseReason) || cleanText(outcome.failureReason) || null,
    failureTruth: cleanText(outcome.failureTruth) || cleanText(outcome.errorMessage) || null,
    interrupted: Boolean(outcome.interrupted || outcome.normalizedStatus === "interrupted"),
  };
}

function countSamples(session = {}) {
  if (Array.isArray(session.samples)) return session.samples.length;
  if (typeof session.sampleCount === "number") return session.sampleCount;
  return 0;
}

function detectNrMode(session = {}) {
  const rat = cleanText(session.networkRat || session.rat || session.lastServingRat);
  const mode = cleanText(session.nrMode || session.nr_sa_nsa);
  if (mode) return mode;
  if (!rat) return null;
  const upper = rat.toUpperCase();
  if (upper.includes("NSA")) return "NR_NSA";
  if (upper.includes("SA") || upper === "NR" || upper === "5G") return "NR_SA_OR_UNSPECIFIED";
  return null;
}

function baseAdapter(session = {}) {
  const scenarioKey = resolveScenarioKey(session);
  const outcome = outcomeFromSession(session);
  const rfCount = countSamples(session);
  const gpsCount = Array.isArray(session.gpsTrace)
    ? session.gpsTrace.length
    : getNumber(session.gpsSampleCount) ?? 0;
  const voiceCount = Array.isArray(session.voiceEvents)
    ? session.voiceEvents.length
    : getNumber(session.voiceEventCount) ?? 0;

  return {
    scenario_type: scenarioKey,
    scenario_label: scenarioDisplayName(scenarioKey),
    attempt_counts: {
      planned: outcome.plannedIterations,
      completed: outcome.completedIterations,
      failed: outcome.failedIterations,
    },
    outcome_status: outcome.normalizedStatus,
    interrupted: outcome.interrupted,
    failure_truth: {
      conciseReason: outcome.conciseReason,
      failureTruth: outcome.failureTruth,
    },
    rf: {
      sample_count: rfCount,
      missing: rfCount === 0,
    },
    gps: {
      sample_count: gpsCount,
      missing: gpsCount === 0,
    },
    voice: {
      event_count: voiceCount,
      missing: voiceCount === 0,
    },
    nr_mode: detectNrMode(session),
    zero_external_iterations: false,
    scenario_fields: {},
  };
}

function adaptNativeHttp(session) {
  const base = baseAdapter(session);
  const iterations = Array.isArray(session.appIterationResults) ? session.appIterationResults : [];
  return {
    ...base,
    zero_external_iterations: iterations.length === 0,
    scenario_fields: {
      engine: "native_http",
      iteration_count: iterations.length,
      avg_download_mbps: getNumber(session.httpAvgDownloadMbps),
      avg_upload_mbps: getNumber(session.httpAvgUploadMbps),
      avg_latency_ms: getNumber(session.httpAvgLatencyMs),
    },
  };
}

function adaptFtp(session) {
  const base = baseAdapter(session);
  const iterations = Array.isArray(session.appIterationResults) ? session.appIterationResults : [];
  return {
    ...base,
    zero_external_iterations: iterations.length === 0,
    scenario_fields: {
      engine: "ftp",
      iteration_count: iterations.length,
      direction: cleanText(session.ftpDirection) || cleanText(session.appFtpDirection),
      avg_throughput_mbps: getNumber(session.ftpAvgThroughputMbps),
    },
  };
}

function adaptIperf3(session) {
  const base = baseAdapter(session);
  const iterations = Array.isArray(session.appIterationResults) ? session.appIterationResults : [];
  return {
    ...base,
    zero_external_iterations: iterations.length === 0,
    scenario_fields: {
      engine: "iperf3",
      iteration_count: iterations.length,
      protocol: cleanText(session.iperfProtocol) || cleanText(session.appIperfProtocol),
      avg_throughput_mbps: getNumber(session.iperfAvgThroughputMbps),
      reverse: Boolean(session.iperfReverse),
    },
  };
}

function adaptOokla(session) {
  const base = baseAdapter(session);
  const evidence = Array.isArray(session.appOoklaEvidenceIterations)
    ? session.appOoklaEvidenceIterations
    : session.appOoklaEvidence
      ? [session.appOoklaEvidence]
      : [];
  return {
    ...base,
    zero_external_iterations: evidence.length === 0,
    scenario_fields: {
      engine: "ookla_app",
      evidence_iteration_count: evidence.length,
      has_main_screenshot: evidence.some((e) => e?.mainScreenshot || e?.screenshot),
      has_detailed_screenshot: evidence.some((e) => e?.detailedScreenshot),
    },
  };
}

function adaptFcc(session) {
  const base = baseAdapter(session);
  const evidence = Array.isArray(session.appFccEvidenceIterations)
    ? session.appFccEvidenceIterations
    : session.appFccGeneratedEvidence
      ? [session.appFccGeneratedEvidence]
      : [];
  return {
    ...base,
    zero_external_iterations: evidence.length === 0,
    scenario_fields: {
      engine: "fcc_app",
      evidence_iteration_count: evidence.length,
      has_generated_evidence: Boolean(session.appFccGeneratedEvidence || evidence.length),
    },
  };
}

function adaptRfOnly(session) {
  const base = baseAdapter(session);
  return {
    ...base,
    zero_external_iterations: true,
    scenario_fields: {
      engine: "rf_data",
      rf_only: true,
      sample_count: base.rf.sample_count,
    },
  };
}

const ADAPTERS = Object.freeze({
  [SCENARIO_KEYS.NATIVE_HTTP]: adaptNativeHttp,
  [SCENARIO_KEYS.FTP]: adaptFtp,
  [SCENARIO_KEYS.IPERF3]: adaptIperf3,
  [SCENARIO_KEYS.OOKLA]: adaptOokla,
  [SCENARIO_KEYS.FCC]: adaptFcc,
  [SCENARIO_KEYS.RF_ONLY]: adaptRfOnly,
});

/**
 * Adapt a single session into scenario submission fields (existing truth only).
 */
export function adaptScenarioForSubmission(session = {}) {
  const key = resolveScenarioKey(session);
  const adapter = ADAPTERS[key] || adaptRfOnly;
  return adapter(session);
}

/**
 * Adapt unified multi-scenario report entries.
 */
export function adaptUnifiedScenarios(unifiedReport = {}) {
  const scenarios = Array.isArray(unifiedReport.scenarios) ? unifiedReport.scenarios : [];
  return scenarios.map((entry) => {
    const session = entry.session || entry;
    const adapted = adaptScenarioForSubmission(session);
    return {
      ...adapted,
      scenario_id: entry.scenarioId || entry.draftId || null,
      source_family: entry.sourceFamily || null,
      status: cleanText(entry.status) || adapted.outcome_status,
    };
  });
}

/**
 * Non-secret config snapshot for manifest.config.
 */
export function buildScenarioConfigSnapshot(session = {}) {
  const key = resolveScenarioKey(session);
  return {
    scenario_type: key,
    planned_iterations: getNumber(session.plannedIterations) ?? getNumber(session.appPlannedIterations),
    mode: cleanText(session.mode) || cleanText(session.selectedMode),
    // Explicitly omit credentials / hosts with passwords / tokens.
  };
}

export default {
  adaptScenarioForSubmission,
  adaptUnifiedScenarios,
  buildScenarioConfigSnapshot,
  ADAPTERS,
};
