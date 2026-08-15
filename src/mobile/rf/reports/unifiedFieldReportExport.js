/**
 * F10A/F10B — Unified Field Report export helpers (naming, package hydrate, file build).
 */

import { createUnifiedFieldReportModel, UNIFIED_FIELD_REPORT_VERSION } from "./unifiedFieldReportModel.js";
import { buildUnifiedFieldReportWorkbookBuffer } from "./unifiedFieldReportWorkbook.js";
import { normalizeConnectivitySnapshot } from "./connectivitySnapshot.js";

function cleanFilePart(value, fallback = "BabyDragon") {
  const text = String(value || fallback).trim() || fallback;
  return text
    .replace(/[^a-z0-9._-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || fallback;
}

function formatFileDateTime(value = Date.now()) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "unknown_time";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function buildUnifiedFieldReportFileBaseName(model = {}, timestamp = Date.now()) {
  const name = cleanFilePart(model?.reportIdentity?.reportName || model?.fieldContext?.task || "BabyDragon", "BabyDragon");
  return `${name}_Unified_Field_Test_Report_${formatFileDateTime(timestamp)}`;
}

function parseCsv(text = "") {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });
    return row;
  });
}

function splitCsvLine(line = "") {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapEngineId(type = "") {
  const t = String(type || "").toLowerCase();
  if (t.includes("iperf")) return "iperf3";
  if (t.includes("ftp")) return "ftp";
  if (t.includes("http") || t.includes("native")) return "native_http";
  if (t.includes("ookla")) return "ookla_external";
  if (t.includes("fcc")) return "fcc_external";
  return "rf_only";
}

function mapIterationFromReport(iter = {}) {
  const errorMessage = iter.error_message || iter.errorMessage || iter.failure_reason || iter.failureReason || null;
  const error = iter.error || iter.dl?.error || iter.ul?.error || errorMessage || null;
  return {
    iteration: iter.iteration ?? null,
    status: iter.status || null,
    startedAt: Date.parse(iter.started_at_iso) || null,
    endedAt: Date.parse(iter.ended_at_iso) || null,
    wall_seconds: num(iter.wall_seconds),
    direction: iter.direction || null,
    dlMbps: num(iter.dl?.mbps ?? iter.dl_mbps),
    ulMbps: num(iter.ul?.mbps ?? iter.ul_mbps),
    dlMeasuredBytes: num(iter.dl?.measured_bytes ?? iter.dl_bytes),
    ulMeasuredBytes: num(iter.ul?.measured_bytes ?? iter.ul_bytes),
    error,
    errorMessage,
    errorCode: iter.error_code || iter.errorCode || null,
    failureStage: iter.failure_stage || iter.failureStage || null,
    failureReason: iter.failure_reason || iter.failureReason || errorMessage || null,
    conciseReason: iter.concise_reason || iter.conciseReason || error || null,
  };
}

function mapRfCsvRowToSample(row = {}, sessionId = null) {
  const timestamp = Date.parse(row.timestamp_iso) || num(row.sample_id) || Date.now();
  return {
    id: row.sample_id || `sample-${row.sample_index}`,
    timestamp,
    isoTime: row.timestamp_iso || null,
    sessionId: row.session_id || sessionId,
    recordState: row.record_state || "active",
    recorded: String(row.recorded || "").toLowerCase() !== "no",
    mode: row.mode || "data",
    gps: {
      lat: num(row.latitude),
      lon: num(row.longitude),
      accuracy: num(row.gps_accuracy_m),
      speed: num(row.gps_speed_mps),
      status: row.gps_status || null,
      provider: row.gps_provider || null,
    },
    snapshot: {
      rat: row.rat || null,
      lteRsrp: num(row.lte_rsrp_dbm),
      lteRsrq: num(row.lte_rsrq_db),
      lteSinr: num(row.lte_sinr_db),
      ltePci: num(row.lte_pci),
      lteEarfcn: num(row.lte_earfcn),
      nrSsRsrp: num(row.nr_ss_rsrp_dbm),
      nrSsRsrq: num(row.nr_ss_rsrq_db),
      nrSsSinr: num(row.nr_ss_sinr_db),
      nrPci: num(row.nr_pci),
      nrNrarfcn: num(row.nr_nrarfcn),
    },
    trafficStats: {
      dlMbps: num(row.traffic_stats_dl_mbps),
      ulMbps: num(row.traffic_stats_ul_mbps),
      totalDlMbps: num(row.traffic_stats_total_dl_mbps),
      totalUlMbps: num(row.traffic_stats_total_ul_mbps),
    },
  };
}

function mapWireConnectivity(block = null) {
  if (!block || typeof block !== "object") return null;
  return normalizeConnectivitySnapshot({
    wifiConnected: block.wifi_connected ?? block.wifiConnected,
    cellularConnected: block.cellular_connected ?? block.cellularConnected,
    mobileDataActive: block.mobile_data_active ?? block.mobileDataActive,
    defaultTransport: block.default_transport ?? block.defaultTransport,
    internetCapable: block.internet_capable ?? block.internetCapable,
    internetValidated: block.internet_validated ?? block.internetValidated,
    wifiStatus: block.wifi_status ?? block.wifiStatus,
    mobileDataStatus: block.mobile_data_status ?? block.mobileDataStatus,
    activeTransport: block.active_transport ?? block.activeTransport,
    internetConnectivity: block.internet_connectivity ?? block.internetConnectivity,
    timestamp: block.timestamp_ms ?? block.timestamp,
    source: block.source,
  });
}

function attachConnectivityFromReport(session, report = {}) {
  const conn = report.connectivity || report.session?.connectivity || null;
  if (!conn || conn.recorded === false) {
    return {
      ...session,
      connectivityStart: null,
      connectivityEnd: null,
      connectivitySnapshot: null,
      connectivityRecorded: false,
    };
  }
  const start = mapWireConnectivity(conn.connectivity_start || conn.connectivityStart);
  const end = mapWireConnectivity(conn.connectivity_end || conn.connectivityEnd);
  return {
    ...session,
    connectivityStart: start,
    connectivityEnd: end || start,
    connectivitySnapshot: end || start,
    connectivityRecorded: Boolean(start || end),
  };
}

/**
 * Hydrate a BabyDragon saved-session-like object from exported Report.json + RF_GPS_Trace.csv text.
 * F10A/F10B reload path for explicit package selection / Node smoke.
 * Legacy packages without connectivity remain accepted (Not recorded).
 */
export function hydrateSessionFromReportPackage({
  reportJson,
  rfGpsTraceCsv = "",
  sourcePackage = null,
} = {}) {
  const report = typeof reportJson === "string" ? JSON.parse(reportJson) : (reportJson || {});
  const sessionBlock = report.session || {};
  const dataTest = report.data_test || {};
  const sessionId = sessionBlock.session_id || `bd-rf-${Date.now()}`;
  const samples = parseCsv(rfGpsTraceCsv).map((row) => mapRfCsvRowToSample(row, sessionId));
  const iterations = Array.isArray(dataTest.iterations)
    ? dataTest.iterations.map(mapIterationFromReport)
    : [];
  const engineId = dataTest.engine_id || mapEngineId(dataTest.type);
  const status = dataTest.status || null;
  const runMode = String(status || "").toLowerCase().includes("continuous")
    || String(dataTest.message || "").toLowerCase().includes("continuous")
    || String(dataTest.run_mode || "").toLowerCase() === "continuous"
    ? "continuous"
    : (String(engineId).includes("ookla") || String(engineId).includes("fcc") ? "external" : "fixed");

  const base = {
    id: sessionId,
    mode: sessionBlock.mode || "data",
    taskLabel: sessionBlock.task || null,
    grid: sessionBlock.grid || null,
    reportLogName: sessionBlock.report_log_name || report.report?.display_name || null,
    startedAt: Date.parse(sessionBlock.started_at_iso) || null,
    endedAt: Date.parse(sessionBlock.ended_at_iso) || null,
    durationMs: num(sessionBlock.duration_ms),
    sampleCount: samples.length || num(sessionBlock.sample_count) || 0,
    rat: sessionBlock.rat || null,
    exportSamples: samples,
    traceSamples: samples.slice(-240),
    appEngineId: engineId,
    appTestType: dataTest.type || engineId,
    appRunMode: runMode === "external" ? "external" : runMode,
    appRunModeLabel: runMode === "continuous"
      ? "Continuous"
      : (runMode === "external" ? "External Evidence" : "Fixed"),
    appDirection: dataTest.direction || null,
    appDirectionLabel: dataTest.direction || null,
    appTestStatus: status,
    appTestMessage: dataTest.message || null,
    appTestError: dataTest.error || "",
    appEndReason: runMode === "continuous" ? "user_stopped_continuous" : null,
    appDlMbps: num(dataTest.averages?.dl_mbps),
    appUlMbps: num(dataTest.averages?.ul_mbps),
    appDownloadBytes: iterations.reduce((sum, row) => sum + (num(row.dlMeasuredBytes) || 0), 0),
    appUploadBytes: iterations.reduce((sum, row) => sum + (num(row.ulMeasuredBytes) || 0), 0),
    appIterationsRequested: runMode === "continuous" ? null : num(dataTest.requested?.iterations),
    appCompletedIterations: num(dataTest.completed_iterations),
    appAttemptedIterations: num(dataTest.attempted_iterations),
    appFailedIterations: num(dataTest.failed_iterations),
    appRemainingIterations: runMode === "continuous" ? null : null,
    appIterationResults: iterations,
    appSetupSnapshot: {
      testType: dataTest.type,
      runMode,
      direction: dataTest.direction,
      iterations: dataTest.requested?.iterations,
      durationSeconds: dataTest.requested?.duration_sec,
      waitSeconds: dataTest.requested?.wait_between_iterations_sec,
      warmupSeconds: dataTest.requested?.warmup_sec,
      intervalSeconds: dataTest.requested?.interval_sec,
    },
    sourcePackage: sourcePackage || report.report?.display_name || null,
  };
  return attachConnectivityFromReport(base, report);
}

function mapOoklaCsvRow(row = {}, index = 0) {
  return {
    iteration: num(row.iterationNumber) ?? (index + 1),
    iterationNumber: num(row.iterationNumber) ?? (index + 1),
    evidenceSource: row.evidenceSource || "ookla_csv_import",
    ooklaDateTime: row.ooklaDateTime || null,
    dlMbps: num(row.dlMbps),
    ulMbps: num(row.ulMbps),
    pingMs: num(row.pingMs),
    jitterMs: num(row.jitterMs),
    resultId: row.resultId || null,
    resultUrl: row.resultUrl || null,
    connectionType: row.connectionType || null,
    serverLocation: row.serverLocation || null,
    providerName: row.providerName || null,
    insideBabyDragonTimeWindow: row.insideBabyDragonTimeWindow || null,
    matchedRfStatus: row.matchedRfStatus || null,
  };
}

/**
 * Hydrate OOKLA 3-file package (Report.json + RF + OOKLA_Evidence.csv).
 */
export function hydrateSessionFromOoklaPackage({
  reportJson,
  rfGpsTraceCsv = "",
  ooklaEvidenceCsv = "",
  sourcePackage = null,
} = {}) {
  const session = hydrateSessionFromReportPackage({ reportJson, rfGpsTraceCsv, sourcePackage });
  const rows = parseCsv(ooklaEvidenceCsv).map(mapOoklaCsvRow);
  return {
    ...session,
    appEngineId: "ookla_external",
    appTestType: "ookla_app_external",
    appRunMode: "external",
    appRunModeLabel: "External Evidence",
    appOoklaEvidenceIterations: rows,
    appOoklaEvidence: rows[rows.length - 1] || null,
    appTestStatus: rows.length ? "evidence_saved" : (session.appTestStatus || "draft"),
  };
}

/**
 * Hydrate FCC 3-file package (no Report.json by contract).
 */
export function hydrateSessionFromFccPackage({
  evidenceJson = null,
  metadataJson = null,
  sourcePackage = null,
} = {}) {
  const evidence = typeof evidenceJson === "string" ? JSON.parse(evidenceJson) : (evidenceJson || {});
  const metadata = typeof metadataJson === "string" ? JSON.parse(metadataJson) : (metadataJson || {});
  const iterations = Array.isArray(evidence.appFccEvidenceIterations)
    ? evidence.appFccEvidenceIterations
    : (Array.isArray(evidence.iterations) ? evidence.iterations : []);
  const startedAt = Date.parse(metadata.sessionWindowSummary?.sessionStartIso)
    || Date.parse(evidence.sessionStartedAtIso)
    || null;
  const endedAt = Date.parse(metadata.sessionWindowSummary?.sessionEndIso)
    || Date.parse(evidence.sessionEndedAtIso)
    || null;
  return {
    id: evidence.sessionId || `bd-fcc-${Date.now()}`,
    mode: "data",
    taskLabel: evidence.task || metadata.task || null,
    grid: evidence.grid || metadata.grid || null,
    reportLogName: evidence.reportLogName || metadata.reportLogName || null,
    startedAt,
    endedAt,
    durationMs: startedAt != null && endedAt != null ? Math.max(0, endedAt - startedAt) : null,
    sampleCount: 0,
    exportSamples: [],
    traceSamples: [],
    appEngineId: "fcc_external",
    appTestType: "fcc_app",
    appRunMode: "external",
    appRunModeLabel: "External Evidence",
    appDirection: null,
    appDirectionLabel: null,
    appTestStatus: iterations.length ? "evidence_saved" : (evidence.exportStatus || "saved"),
    appFccEvidenceIterations: iterations,
    appFccImport: evidence.appFccImport || metadata.fccImport || {
      status: iterations.length ? "imported" : "parsed",
      stats: {
        collapsedTestCount: metadata.originalSourceSummary?.collapsedTestsTotal ?? null,
        insideWindowCount: metadata.sessionWindowSummary?.collapsedTestsInsideWindow ?? null,
        savedCount: iterations.length,
        wifiCount: metadata.originalSourceSummary?.wifiTestsTotal ?? null,
        cellCount: metadata.originalSourceSummary?.cellTestsTotal ?? null,
      },
    },
    appFccGeneratedEvidence: evidence.generatedEvidence || null,
    connectivityStart: null,
    connectivityEnd: null,
    connectivitySnapshot: null,
    connectivityRecorded: false,
    sourcePackage: sourcePackage || evidence.sessionId || null,
  };
}

export async function buildUnifiedFieldReportFile({
  scenarios = [],
  fieldContext = {},
  deviceContext = {},
  user = null,
  skipMaps = false,
} = {}) {
  const model = createUnifiedFieldReportModel({
    scenarios,
    fieldContext,
    deviceContext,
    user,
  });
  const built = await buildUnifiedFieldReportWorkbookBuffer(model, { skipMaps });
  const baseName = buildUnifiedFieldReportFileBaseName(model);
  const bytes = built.buffer instanceof ArrayBuffer
    ? new Uint8Array(built.buffer)
    : new Uint8Array(built.buffer?.buffer || built.buffer);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  const base64 = typeof btoa === "function"
    ? btoa(binary)
    : Buffer.from(bytes).toString("base64");

  return {
    model,
    fileName: `${baseName}.xlsx`,
    baseName,
    base64,
    buffer: built.buffer,
    createdSheets: built.createdSheets,
    scenarioPlotSheets: built.scenarioPlotSheets || [],
    version: UNIFIED_FIELD_REPORT_VERSION,
  };
}

export default {
  buildUnifiedFieldReportFileBaseName,
  hydrateSessionFromReportPackage,
  hydrateSessionFromOoklaPackage,
  hydrateSessionFromFccPackage,
  buildUnifiedFieldReportFile,
};
