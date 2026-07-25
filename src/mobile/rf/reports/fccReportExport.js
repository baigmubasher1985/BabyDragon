import {
  FCC_DEFAULT_BUFFER_SECONDS,
  FCC_EVIDENCE_RULE,
  finalizeFccTimeWindowOnExport,
  resolveFccIterations,
} from "../utils/fccExportImport.js";

export const FCC_REPORT_VERSION = "1.1.5-fcc-external-evidence";

const FCC_RF_MATCH_WINDOW_MS = 60_000;

function getNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return null;
}

function cleanFilePart(value, fallback = "babydragon") {
  const text = String(value || fallback).trim() || fallback;
  return text
    .replace(/[^a-z0-9._-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || fallback;
}

function formatFileDateTime(timestamp) {
  const date = timestamp ? new Date(timestamp) : new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function formatIso(timestamp) {
  if (timestamp === null || timestamp === undefined || timestamp === "") return null;
  try {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  } catch {
    return null;
  }
}

function csvValue(value) {
  if (value === null || value === undefined) return "";
  const text = String(value).replace(/\r?\n/g, " ");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function makeCsvSection(headers, rows) {
  const line = (row) => headers.map((header) => csvValue(row[header])).join(",");
  return [headers.join(","), ...rows.map(line)].join("\n");
}

function jsonNumber(value, digits = null) {
  const number = getNumber(value);
  if (number === null) return null;
  if (digits === null || Number.isInteger(number)) return number;
  return Number(number.toFixed(digits));
}

function jsonText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text || text === "N/A") return null;
  return text;
}

function jsonTimestamp(value) {
  return formatIso(value);
}

function csvNumber(value, digits = null) {
  const number = getNumber(value);
  if (number === null) return "";
  if (digits === null || Number.isInteger(number)) return number;
  return Number(number.toFixed(digits));
}

function csvText(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function csvBool(value) {
  if (value === true) return "true";
  if (value === false) return "false";
  return "";
}

export function isFccSession(session = {}) {
  if (session.appTestType === "fcc_app") return true;
  if (session.appExternalEvidenceProvider === "fcc_app") return true;
  if (session.appFccGeneratedEvidence?.provider === "fcc_app") return true;
  if (Array.isArray(session.appFccEvidenceIterations) && session.appFccEvidenceIterations.length) return true;
  return false;
}

export function mapFccExportStatus(session = {}) {
  const status = String(session?.appExportStatus || session?.appTestStatus || "").toLowerCase();
  if (status === "saved" || status === "evidence_saved") return "saved";
  if (status === "partial" || status === "evidence_partial") return "partial";
  if (resolveFccIterations(session).length > 0) return "saved";
  if (session?.sampleCount > 0) return "saved";
  return "draft";
}

function isActiveRfSample(sample = {}) {
  if (!sample || typeof sample !== "object") return false;
  if (sample.recordState === "paused" || sample.paused === true) return false;
  if (sample.isPaused === true || sample.gpsOnly === true) return false;
  return true;
}

function emptyMatchedContext() {
  return {
    matchedRfStatus: "unmatched",
    matchedRfTimeDeltaSec: null,
    bdGpsLatitude: null,
    bdGpsLongitude: null,
    bdGpsAccuracyM: null,
    bdRat: null,
    bdLteRsrp: null,
    bdLteRsrq: null,
    bdLteSinr: null,
    bdNrSsRsrp: null,
    bdNrSsRsrq: null,
    bdNrSsSinr: null,
    bdTrafficStatsSupported: null,
    bdTrafficStatsDlMbps: null,
    bdTrafficStatsUlMbps: null,
    bdTrafficStatsTotalDlMbps: null,
    bdTrafficStatsTotalUlMbps: null,
  };
}

/**
 * Summarize BabyDragon RF/GPS/TrafficStats context already attached to saved FCC rows.
 * Counts only existing matchedRfStatus / context fields — does not invent matches.
 */
export function buildFccSavedEvidenceRfContextSummary(iterations = []) {
  let rfContextMatched = 0;
  let rfContextUnmatched = 0;
  let gpsContextMatched = 0;
  let trafficStatsContextMatched = 0;

  (Array.isArray(iterations) ? iterations : []).forEach((item) => {
    const matched = item?.matchedContext
      || item?.babyDragonContext
      || emptyMatchedContext();
    const status = String(matched.matchedRfStatus || "").toLowerCase();
    if (status === "matched") {
      rfContextMatched += 1;
      if (getNumber(matched.bdGpsLatitude) !== null && getNumber(matched.bdGpsLongitude) !== null) {
        gpsContextMatched += 1;
      }
      const hasTraffic = matched.bdTrafficStatsSupported === true
        || getNumber(matched.bdTrafficStatsDlMbps) !== null
        || getNumber(matched.bdTrafficStatsUlMbps) !== null
        || getNumber(matched.bdTrafficStatsTotalDlMbps) !== null
        || getNumber(matched.bdTrafficStatsTotalUlMbps) !== null;
      if (hasTraffic) {
        trafficStatsContextMatched += 1;
      }
    } else {
      rfContextUnmatched += 1;
    }
  });

  return {
    rfContextMatched,
    rfContextUnmatched,
    gpsContextMatched,
    trafficStatsContextMatched,
  };
}

export function matchNearestFccContextSample(session = {}, iteration = {}, maxDeltaMs = FCC_RF_MATCH_WINDOW_MS) {
  const targetMs = getNumber(iteration?.fccTestAtMs)
    ?? (() => {
      const parsed = Date.parse(String(iteration?.fccTestAt || ""));
      return Number.isNaN(parsed) ? null : parsed;
    })();
  if (!Number.isFinite(targetMs)) return emptyMatchedContext();

  const samples = (session.exportSamples || session.traceSamples || []).filter(isActiveRfSample);
  if (!samples.length) return emptyMatchedContext();

  let nearest = null;
  let minDelta = Infinity;
  samples.forEach((sample) => {
    const sampleTs = getNumber(sample?.timestamp);
    if (sampleTs === null) return;
    const delta = Math.abs(sampleTs - targetMs);
    if (delta < minDelta) {
      minDelta = delta;
      nearest = sample;
    }
  });

  if (!nearest || minDelta > maxDeltaMs) return emptyMatchedContext();

  const snapshot = nearest.snapshot || {};
  const serving = snapshot.serving && typeof snapshot.serving === "object" ? snapshot.serving : {};
  const lte = snapshot.lteAnchor && typeof snapshot.lteAnchor === "object"
    ? snapshot.lteAnchor
    : (String(serving.rat || "").toUpperCase() === "LTE" ? serving : {});
  const nr = snapshot.nrSecondary && typeof snapshot.nrSecondary === "object"
    ? snapshot.nrSecondary
    : (String(serving.rat || "").toUpperCase() === "NR" ? serving : {});
  const rat = snapshot.currentRatName || serving.technology || snapshot.dataNetworkTypeName || null;
  const traffic = nearest.trafficStats || {};

  return {
    matchedRfStatus: "matched",
    matchedRfTimeDeltaSec: Number((minDelta / 1000).toFixed(3)),
    bdGpsLatitude: jsonNumber(nearest.gps?.lat, 7),
    bdGpsLongitude: jsonNumber(nearest.gps?.lng, 7),
    bdGpsAccuracyM: jsonNumber(nearest.gps?.accuracy, 1),
    bdRat: jsonText(rat),
    bdLteRsrp: jsonNumber(lte.rsrp ?? lte.dbm, 1),
    bdLteRsrq: jsonNumber(lte.rsrq, 1),
    bdLteSinr: jsonNumber(lte.sinr ?? lte.rssnr, 1),
    bdNrSsRsrp: jsonNumber(nr.ssRsrp ?? nr.rsrp, 1),
    bdNrSsRsrq: jsonNumber(nr.ssRsrq ?? nr.rsrq, 1),
    bdNrSsSinr: jsonNumber(nr.ssSinr ?? nr.sinr, 1),
    bdTrafficStatsSupported: traffic.trafficStatsSupported === true
      || traffic.trafficStatsMobileSupported === true
      || traffic.trafficStatsTotalSupported === true
      || null,
    bdTrafficStatsDlMbps: jsonNumber(
      traffic.trafficStatsDlMbps ?? traffic.dlMbps ?? traffic.traffic_stats_dl_mbps,
      2,
    ),
    bdTrafficStatsUlMbps: jsonNumber(
      traffic.trafficStatsUlMbps ?? traffic.ulMbps ?? traffic.traffic_stats_ul_mbps,
      2,
    ),
    bdTrafficStatsTotalDlMbps: jsonNumber(
      traffic.trafficStatsTotalDlMbps ?? traffic.totalDlMbps ?? traffic.traffic_stats_total_dl_mbps,
      2,
    ),
    bdTrafficStatsTotalUlMbps: jsonNumber(
      traffic.trafficStatsTotalUlMbps ?? traffic.totalUlMbps ?? traffic.traffic_stats_total_ul_mbps,
      2,
    ),
  };
}

export function buildFccGeneratedEvidenceSnapshot(session = {}, taskHelpers = {}) {
  const getTaskLabel = taskHelpers.getTaskLabel || (() => "Active field task");
  const getTaskGrid = taskHelpers.getTaskGrid || (() => "Grid pending");
  const activeTask = taskHelpers.activeTask || null;
  const stats = session?.stats || {};
  const recordingSummary = session?.recordingStateSummary || {};
  const trafficStatsDl = stats?.trafficStatsDl || {};
  const trafficStatsUl = stats?.trafficStatsUl || {};
  const iterations = resolveFccIterations(session);
  const fccImport = session?.appFccImport || {};

  return {
    provider: "fcc_app",
    source: "fcc_app_external_evidence_v1i2",
    evidenceType: "babydragon_context",
    generatedAt: new Date().toISOString(),
    sessionId: session?.id || null,
    reportLogName: String(session?.reportLogName || "").trim() || null,
    taskLabel: session?.taskLabel || getTaskLabel(activeTask),
    grid: session?.grid || getTaskGrid(activeTask),
    startedAt: session?.startedAt || null,
    endedAt: session?.endedAt || null,
    sampleCount: session?.sampleCount ?? null,
    activeSampleCount: session?.activeSampleCount ?? null,
    gpsCount: session?.gpsCount ?? null,
    firstGps: session?.firstGps || null,
    lastGps: session?.lastGps || null,
    rat: session?.rat || null,
    rfSummary: {
      avgLteRsrp: stats?.lteRsrp?.avg ?? session?.avgLteRsrp ?? null,
      avgLteRsrq: stats?.lteRsrq?.avg ?? session?.avgLteRsrq ?? null,
      avgLteSinr: stats?.lteSinr?.avg ?? session?.avgLteSinr ?? null,
      avgNrRsrp: stats?.nrRsrp?.avg ?? session?.avgNrRsrp ?? null,
      avgNrRsrq: stats?.nrRsrq?.avg ?? session?.avgNrRsrq ?? null,
      avgNrSinr: stats?.nrSinr?.avg ?? session?.avgNrSinr ?? null,
    },
    trafficStats: {
      supported: session?.trafficStatsSupported === true,
      source: "mobile",
      avgDlMbps: session?.trafficStatsAvgDlMbps ?? trafficStatsDl.avg ?? null,
      avgUlMbps: session?.trafficStatsAvgUlMbps ?? trafficStatsUl.avg ?? null,
      minDlMbps: trafficStatsDl.min ?? null,
      maxDlMbps: trafficStatsDl.max ?? null,
      minUlMbps: trafficStatsUl.min ?? null,
      maxUlMbps: trafficStatsUl.max ?? null,
      sampleCount: session?.trafficStatsSampleCount ?? trafficStatsDl.count ?? null,
      summaryRule: "Android mobile byte deltas; observation only; not FCC App result; not BabyDragon engine THP",
    },
    pauseSummary: {
      activeDurationMs: recordingSummary.activeDurationMs ?? session?.activeRecordingDurationMs ?? null,
      pausedDurationMs: recordingSummary.pausedDurationMs ?? session?.pausedDurationMs ?? null,
      pauseSegmentCount: recordingSummary.pauseSegmentCount ?? session?.pauseSegmentCount ?? null,
    },
    importStatus: fccImport.status || (iterations.length ? "imported" : "not_imported"),
    importRule: FCC_EVIDENCE_RULE,
    fccEvidenceIterationCount: iterations.length,
  };
}

export function buildFccFileBaseName(session = {}, taskHelpers = {}) {
  const getTaskLabel = taskHelpers.getTaskLabel || (() => "Active field task");
  const getTaskGrid = taskHelpers.getTaskGrid || (() => "Grid pending");
  const activeTask = taskHelpers.activeTask || null;
  const reportName = String(session?.reportLogName || "").trim();
  const taskOrGrid = reportName
    ? cleanFilePart(reportName, "BabyDragon")
    : cleanFilePart(
      session.taskLabel || getTaskLabel(activeTask) || session.grid || getTaskGrid(activeTask),
      "BabyDragon",
    );
  const timestamp = session.endedAt || session.startedAt || Date.now();
  return cleanFilePart(`${taskOrGrid}_${formatFileDateTime(timestamp)}`, "BabyDragon_FCC");
}

function iterationCsvRow(item = {}, matched = {}) {
  const sourceRows = Array.isArray(item.rawRowRef?.sourceRowNumbers)
    ? item.rawRowRef.sourceRowNumbers.join("|")
    : "";
  return {
    fcc_test_id: csvText(item.fccTestId),
    fcc_test_time: csvText(item.fccTestAt),
    fcc_test_time_iso: csvText(formatIso(item.fccTestAtMs ?? item.fccTestAt)),
    fcc_test_start_ms: csvNumber(item.testStartMs),
    fcc_test_end_ms: csvNumber(item.testEndMs),
    fcc_test_start_at: csvText(item.fccTestStartAt),
    fcc_test_end_at: csvText(item.fccTestEndAt),
    fcc_connection_type: csvText(item.fccConnectionType),
    fcc_carrier: csvText(item.fccCarrier),
    fcc_network_type: csvText(item.fccNetworkType),
    fcc_server_name: csvText(item.fccServerName),
    fcc_dl_mbps: csvNumber(item.fccDlMbps, 3),
    fcc_ul_mbps: csvNumber(item.fccUlMbps, 3),
    fcc_ping_ms: csvNumber(item.fccPingMs, 3),
    fcc_jitter_ms: csvNumber(item.fccJitterMs, 3),
    fcc_loss_pct: csvNumber(item.fccLossPct, 3),
    fcc_packet_loss_raw: csvNumber(item.fccPacketLossRaw),
    fcc_packets_sent: csvNumber(item.fccPacketsSent),
    fcc_packets_received: csvNumber(item.fccPacketsReceived),
    fcc_dl_success: csvBool(item.phaseSuccess?.download),
    fcc_ul_success: csvBool(item.phaseSuccess?.upload),
    fcc_latency_success: csvBool(item.phaseSuccess?.latency),
    fcc_dl_warmup_duration_sec: csvNumber(item.warmup?.dlWarmupDurationSec, 6),
    fcc_dl_warmup_bytes: csvNumber(item.warmup?.dlWarmupBytes),
    fcc_ul_warmup_duration_sec: csvNumber(item.warmup?.ulWarmupDurationSec, 6),
    fcc_ul_warmup_bytes: csvNumber(item.warmup?.ulWarmupBytes),
    fcc_dl_duration_sec: csvNumber(item.measured?.dlDurationSec, 6),
    fcc_dl_bytes_transferred: csvNumber(item.measured?.dlBytesTransferred),
    fcc_ul_duration_sec: csvNumber(item.measured?.ulDurationSec, 6),
    fcc_ul_bytes_transferred: csvNumber(item.measured?.ulBytesTransferred),
    fcc_latitude: csvNumber(item.fccLat, 7),
    fcc_longitude: csvNumber(item.fccLon, 7),
    fcc_gps_accuracy_m: csvNumber(item.fccGpsAccuracy, 3),
    fcc_app_version: csvText(item.appVersion),
    fcc_device_model: csvText(item.deviceModel),
    fcc_cycle_date: csvText(item.cycleDate),
    inside_babydragon_time_window: csvText(item.insideBabyDragonTimeWindow),
    source_file: csvText(item.rawRowRef?.sourceFile),
    source_row_numbers: sourceRows,
    evidence_source: csvText(item.evidenceSource || "fcc_export_zip_csv"),
    matched_rf_status: csvText(matched.matchedRfStatus),
    matched_rf_time_delta_sec: csvNumber(matched.matchedRfTimeDeltaSec, 3),
    bd_gps_latitude: csvNumber(matched.bdGpsLatitude, 7),
    bd_gps_longitude: csvNumber(matched.bdGpsLongitude, 7),
    bd_gps_accuracy_m: csvNumber(matched.bdGpsAccuracyM, 1),
    bd_rat: csvText(matched.bdRat),
    bd_lte_rsrp: csvNumber(matched.bdLteRsrp, 1),
    bd_lte_rsrq: csvNumber(matched.bdLteRsrq, 1),
    bd_lte_sinr: csvNumber(matched.bdLteSinr, 1),
    bd_nr_ss_rsrp: csvNumber(matched.bdNrSsRsrp, 1),
    bd_nr_ss_rsrq: csvNumber(matched.bdNrSsRsrq, 1),
    bd_nr_ss_sinr: csvNumber(matched.bdNrSsSinr, 1),
    bd_traffic_stats_supported: matched.bdTrafficStatsSupported === true
      ? "yes"
      : (matched.bdTrafficStatsSupported === false ? "no" : ""),
    bd_traffic_stats_dl_mbps: csvNumber(matched.bdTrafficStatsDlMbps, 2),
    bd_traffic_stats_ul_mbps: csvNumber(matched.bdTrafficStatsUlMbps, 2),
    bd_traffic_stats_total_dl_mbps: csvNumber(matched.bdTrafficStatsTotalDlMbps, 2),
    bd_traffic_stats_total_ul_mbps: csvNumber(matched.bdTrafficStatsTotalUlMbps, 2),
  };
}

const FCC_EVIDENCE_CSV_HEADERS = [
  "fcc_test_id",
  "fcc_test_time",
  "fcc_test_time_iso",
  "fcc_test_start_ms",
  "fcc_test_end_ms",
  "fcc_test_start_at",
  "fcc_test_end_at",
  "fcc_connection_type",
  "fcc_carrier",
  "fcc_network_type",
  "fcc_server_name",
  "fcc_dl_mbps",
  "fcc_ul_mbps",
  "fcc_ping_ms",
  "fcc_jitter_ms",
  "fcc_loss_pct",
  "fcc_packet_loss_raw",
  "fcc_packets_sent",
  "fcc_packets_received",
  "fcc_dl_success",
  "fcc_ul_success",
  "fcc_latency_success",
  "fcc_dl_warmup_duration_sec",
  "fcc_dl_warmup_bytes",
  "fcc_ul_warmup_duration_sec",
  "fcc_ul_warmup_bytes",
  "fcc_dl_duration_sec",
  "fcc_dl_bytes_transferred",
  "fcc_ul_duration_sec",
  "fcc_ul_bytes_transferred",
  "fcc_latitude",
  "fcc_longitude",
  "fcc_gps_accuracy_m",
  "fcc_app_version",
  "fcc_device_model",
  "fcc_cycle_date",
  "inside_babydragon_time_window",
  "source_file",
  "source_row_numbers",
  "evidence_source",
  "matched_rf_status",
  "matched_rf_time_delta_sec",
  "bd_gps_latitude",
  "bd_gps_longitude",
  "bd_gps_accuracy_m",
  "bd_rat",
  "bd_lte_rsrp",
  "bd_lte_rsrq",
  "bd_lte_sinr",
  "bd_nr_ss_rsrp",
  "bd_nr_ss_rsrq",
  "bd_nr_ss_sinr",
  "bd_traffic_stats_supported",
  "bd_traffic_stats_dl_mbps",
  "bd_traffic_stats_ul_mbps",
  "bd_traffic_stats_total_dl_mbps",
  "bd_traffic_stats_total_ul_mbps",
];

export function buildFccEvidenceCsv(model = {}) {
  const iterations = Array.isArray(model.iterations) ? model.iterations : [];
  const rows = iterations.map((item) => {
    const matched = item.matchedContext || matchNearestFccContextSample(model.session || {}, item);
    return iterationCsvRow(item, matched);
  });
  // Machine-import friendly: BOM + header row first (evidence rule lives in JSON/metadata only).
  return `\uFEFF${makeCsvSection(FCC_EVIDENCE_CSV_HEADERS, rows)}`;
}

function jsonIteration(item = {}, matched = {}) {
  return {
    provider: "fcc_app",
    evidenceType: jsonText(item.evidenceType) || "external_import",
    evidenceSource: jsonText(item.evidenceSource) || "fcc_export_zip_csv",
    iterationNumber: jsonNumber(item.iterationNumber),
    fccTestId: jsonText(item.fccTestId),
    fccTestAt: jsonText(item.fccTestAt),
    fccTestAtIso: jsonTimestamp(item.fccTestAtMs ?? item.fccTestAt),
    testStartMs: jsonNumber(item.testStartMs),
    testEndMs: jsonNumber(item.testEndMs),
    fccTestStartAt: jsonText(item.fccTestStartAt),
    fccTestEndAt: jsonText(item.fccTestEndAt),
    fccConnectionType: jsonText(item.fccConnectionType),
    fccCarrier: jsonText(item.fccCarrier),
    fccNetworkType: jsonText(item.fccNetworkType),
    fccServerName: jsonText(item.fccServerName),
    fccServerLocation: null,
    fccDlMbps: jsonNumber(item.fccDlMbps, 3),
    fccUlMbps: jsonNumber(item.fccUlMbps, 3),
    fccPingMs: jsonNumber(item.fccPingMs, 3),
    fccJitterMs: jsonNumber(item.fccJitterMs, 3),
    fccLossPct: jsonNumber(item.fccLossPct, 3),
    fccPacketLossRaw: jsonNumber(item.fccPacketLossRaw),
    fccPacketsSent: jsonNumber(item.fccPacketsSent),
    fccPacketsReceived: jsonNumber(item.fccPacketsReceived),
    phaseSuccess: item.phaseSuccess || null,
    warmup: item.warmup || null,
    measured: item.measured || null,
    fccLatitude: jsonNumber(item.fccLat, 7),
    fccLongitude: jsonNumber(item.fccLon, 7),
    fccGpsAccuracyM: jsonNumber(item.fccGpsAccuracy, 3),
    appVersion: jsonText(item.appVersion),
    deviceModel: jsonText(item.deviceModel),
    operatingSystem: jsonText(item.operatingSystem),
    cycleDate: jsonText(item.cycleDate),
    insideBabyDragonTimeWindow: jsonText(item.insideBabyDragonTimeWindow),
    rawRowRef: item.rawRowRef || null,
    babyDragonContext: {
      label: "BabyDragon RF/GPS/TrafficStats context",
      matchedRfStatus: jsonText(matched.matchedRfStatus),
      matchedRfTimeDeltaSec: jsonNumber(matched.matchedRfTimeDeltaSec, 3),
      bdGpsLatitude: jsonNumber(matched.bdGpsLatitude, 7),
      bdGpsLongitude: jsonNumber(matched.bdGpsLongitude, 7),
      bdGpsAccuracyM: jsonNumber(matched.bdGpsAccuracyM, 1),
      bdRat: jsonText(matched.bdRat),
      bdLteRsrp: jsonNumber(matched.bdLteRsrp, 1),
      bdLteRsrq: jsonNumber(matched.bdLteRsrq, 1),
      bdLteSinr: jsonNumber(matched.bdLteSinr, 1),
      bdNrSsRsrp: jsonNumber(matched.bdNrSsRsrp, 1),
      bdNrSsRsrq: jsonNumber(matched.bdNrSsRsrq, 1),
      bdNrSsSinr: jsonNumber(matched.bdNrSsSinr, 1),
      bdTrafficStatsSupported: matched.bdTrafficStatsSupported === true
        ? true
        : (matched.bdTrafficStatsSupported === false ? false : null),
      bdTrafficStatsDlMbps: jsonNumber(matched.bdTrafficStatsDlMbps, 2),
      bdTrafficStatsUlMbps: jsonNumber(matched.bdTrafficStatsUlMbps, 2),
      bdTrafficStatsTotalDlMbps: jsonNumber(matched.bdTrafficStatsTotalDlMbps, 2),
      bdTrafficStatsTotalUlMbps: jsonNumber(matched.bdTrafficStatsTotalUlMbps, 2),
    },
    capturedAtIso: jsonTimestamp(item.capturedAt),
    savedAtIso: jsonTimestamp(item.savedAt),
  };
}

export function buildFccEvidenceJson(model = {}) {
  const evidence = model.generatedEvidence || {};
  const iterations = Array.isArray(model.iterations) ? model.iterations : [];
  const savedEvidenceSummary = model.fccImportSummary?.savedEvidenceSummary || {
    savedFccIterations: iterations.length,
    ...buildFccSavedEvidenceRfContextSummary(iterations),
  };
  return JSON.stringify({
    babyDragonReportVersion: FCC_REPORT_VERSION,
    owner: "MobbiTech Global LLC",
    testType: "fcc_app",
    data_test: {
      type: "fcc_app",
      label: "FCC App External Evidence",
      appDlMbps: null,
      appUlMbps: null,
    },
    evidence_rule: FCC_EVIDENCE_RULE,
    sessionId: model.sessionId || evidence.sessionId || null,
    generatedAtIso: jsonTimestamp(Date.now()),
    task: jsonText(model.task || evidence.taskLabel),
    grid: jsonText(model.grid || evidence.grid),
    reportLogName: jsonText(model.reportLogName || evidence.reportLogName),
    exportStatus: jsonText(model.exportStatus),
    savedEvidenceSummary: {
      savedFccIterations: jsonNumber(savedEvidenceSummary.savedFccIterations ?? iterations.length),
      savedWifi: jsonNumber(savedEvidenceSummary.savedWifi),
      savedCell: jsonNumber(savedEvidenceSummary.savedCell),
      rfContextMatched: jsonNumber(savedEvidenceSummary.rfContextMatched),
      rfContextUnmatched: jsonNumber(savedEvidenceSummary.rfContextUnmatched),
      gpsContextMatched: jsonNumber(savedEvidenceSummary.gpsContextMatched),
      trafficStatsContextMatched: jsonNumber(savedEvidenceSummary.trafficStatsContextMatched),
    },
    generatedEvidence: {
      ...evidence,
      startedAtIso: jsonTimestamp(evidence.startedAt),
      endedAtIso: jsonTimestamp(evidence.endedAt),
      generatedAtIso: jsonTimestamp(evidence.generatedAt),
      importRule: FCC_EVIDENCE_RULE,
    },
    appFccImport: model.fccImportSummary || null,
    appFccEvidenceIterations: iterations.map((item) => {
      const matched = item.matchedContext || matchNearestFccContextSample(model.session || {}, item);
      return jsonIteration(item, matched);
    }),
  }, null, 2);
}

export function buildFccImportMetadataJson(model = {}) {
  const fccImport = model.fccImport || {};
  const summary = model.fccImportSummary || {};
  const original = summary.originalSourceSummary || fccImport.originalSourceSummary || {};
  const sessionWindow = summary.sessionWindowSummary || fccImport.sessionWindowSummary || {};
  const saved = summary.savedEvidenceSummary || fccImport.savedEvidenceSummary || {};
  return JSON.stringify({
    babyDragonReportVersion: FCC_REPORT_VERSION,
    owner: "MobbiTech Global LLC",
    sessionId: model.sessionId || null,
    reportLogName: jsonText(model.reportLogName),
    generatedAtIso: jsonTimestamp(Date.now()),
    evidence_rule: FCC_EVIDENCE_RULE,
    truncation_rule: "Only FCC tests overlapping BabyDragon sessionStart-buffer to sessionEnd+buffer are eligible evidence. Original ZIP may contain full historical FCC data.",
    originalSourceSummary: {
      sourceFileCount: jsonNumber(original.sourceFileCount ?? (summary.filesDetected || fccImport.filesDetected || []).length),
      phaseRowsTotal: jsonNumber(original.phaseRowsTotal ?? summary.phaseRowCount ?? fccImport.stats?.phaseRowCount),
      collapsedTestsTotal: jsonNumber(original.collapsedTestsTotal ?? summary.collapsedTestCount ?? fccImport.stats?.collapsedTestCount),
      wifiTestsTotal: jsonNumber(original.wifiTestsTotal ?? summary.wifiCount ?? fccImport.stats?.wifiCount),
      cellTestsTotal: jsonNumber(original.cellTestsTotal ?? summary.cellCount ?? fccImport.stats?.cellCount),
      sourceFiles: original.sourceFiles || summary.filesDetected || fccImport.filesDetected || [],
      perFile: original.perFile || fccImport.sourceFileSummaries || [],
    },
    sessionWindowSummary: {
      bufferSec: jsonNumber(sessionWindow.bufferSec ?? summary.timestampBufferSeconds ?? fccImport.timestampBufferSeconds ?? FCC_DEFAULT_BUFFER_SECONDS),
      sessionStartIso: jsonText(sessionWindow.sessionStartIso) || jsonTimestamp(summary.sessionStartMs ?? fccImport.sessionStartMs ?? model.sessionStartedAt),
      sessionEndIso: jsonText(sessionWindow.sessionEndIso) || jsonTimestamp(summary.sessionEndMs ?? fccImport.sessionEndMs ?? model.sessionEndedAt),
      windowStartIso: jsonText(sessionWindow.windowStartIso),
      windowEndIso: jsonText(sessionWindow.windowEndIso),
      phaseRowsInsideWindow: jsonNumber(sessionWindow.phaseRowsInsideWindow ?? fccImport.stats?.phaseRowsInsideWindow),
      collapsedTestsInsideWindow: jsonNumber(sessionWindow.collapsedTestsInsideWindow ?? summary.insideWindowCount ?? fccImport.stats?.insideWindowCount),
      wifiTestsInsideWindow: jsonNumber(sessionWindow.wifiTestsInsideWindow ?? fccImport.stats?.wifiTestsInsideWindow),
      cellTestsInsideWindow: jsonNumber(sessionWindow.cellTestsInsideWindow ?? fccImport.stats?.cellTestsInsideWindow),
      rowsWithoutTimestamp: jsonNumber(sessionWindow.rowsWithoutTimestamp ?? fccImport.stats?.phaseRowsWithoutTimestamp),
      testsWithoutTimestamp: jsonNumber(sessionWindow.testsWithoutTimestamp ?? fccImport.stats?.testsWithoutTimestamp),
    },
    savedEvidenceSummary: {
      savedFccIterations: jsonNumber(saved.savedFccIterations ?? model.iterations?.length ?? 0),
      savedWifi: jsonNumber(saved.savedWifi ?? 0),
      savedCell: jsonNumber(saved.savedCell ?? 0),
      rfContextMatched: jsonNumber(saved.rfContextMatched),
      rfContextUnmatched: jsonNumber(saved.rfContextUnmatched),
      gpsContextMatched: jsonNumber(saved.gpsContextMatched),
      trafficStatsContextMatched: jsonNumber(saved.trafficStatsContextMatched),
    },
    fccImport: {
      sourceType: jsonText(summary.sourceType || fccImport.sourceType) || "file",
      importMode: jsonText(summary.importMode || fccImport.importMode)
        || ((summary.sourceType || fccImport.sourceType) === "url" ? "url_zip" : "manual_zip"),
      sourceUrl: jsonText(summary.sourceUrl || fccImport.sourceUrl),
      downloadedFilename: jsonText(summary.downloadedFilename || fccImport.downloadedFilename),
      downloadedSizeBytes: jsonNumber(summary.downloadedSizeBytes ?? fccImport.downloadedSizeBytes),
      downloadedAtIso: jsonTimestamp(summary.downloadedAtIso || fccImport.downloadedAtIso),
      contentType: jsonText(summary.contentType || fccImport.contentType),
      statusCode: jsonNumber(summary.statusCode ?? fccImport.statusCode),
      packageName: jsonText(summary.fileName || fccImport.fileName),
      packageId: jsonText(summary.packageId || fccImport.packageId),
      filesDetected: summary.filesDetected || fccImport.filesDetected || [],
      mainCsvName: jsonText(summary.mainCsvName || fccImport.mainCsvName),
      traceCsvDetected: Boolean(summary.traceCsvDetected ?? fccImport.traceCsvDetected),
      jsonDetected: Boolean(summary.jsonDetected ?? fccImport.jsonDetected),
      duplicateSkippedCount: jsonNumber(summary.duplicateSkippedCount ?? fccImport.duplicateSkippedCount ?? fccImport.stats?.duplicateSkippedCount ?? 0),
      selectedCount: jsonNumber(summary.selectedCount ?? fccImport.selectedCount ?? fccImport.stats?.selectedCount),
      parseWarnings: summary.warnings || fccImport.warnings || [],
      parseErrors: summary.errors || fccImport.errors || [],
      parseStatus: jsonText(summary.parseStatus || fccImport.parseStatus || fccImport.status) || "not_imported",
      status: jsonText(summary.status || fccImport.status) || "not_imported",
      importedAtIso: jsonTimestamp(summary.importedAt || fccImport.importedAt),
    },
  }, null, 2);
}

export function extractFccReportModel(session = {}, user = {}, taskHelpers = {}) {
  const finalized = finalizeFccTimeWindowOnExport({
    iterations: resolveFccIterations(session),
    fccImport: session.appFccImport || null,
    sessionStartMs: session.startedAt,
    sessionEndMs: session.endedAt,
    bufferSeconds: session.appFccImport?.timestampBufferSeconds ?? session.appFccImport?.bufferSeconds,
  });

  const iterations = (finalized.iterations || []).map((item) => ({
    ...item,
    matchedContext: item.matchedContext || matchNearestFccContextSample(session, item),
  }));

  const generatedEvidence = {
    ...(session.appFccGeneratedEvidence || buildFccGeneratedEvidenceSnapshot(session, taskHelpers)),
    importStatus: iterations.length ? "imported" : (session.appFccImport?.status || "not_imported"),
    importRule: FCC_EVIDENCE_RULE,
    fccEvidenceIterationCount: iterations.length,
  };

  const fccImport = finalized.fccImport || session.appFccImport || { status: "not_imported" };
  const importMode = (fccImport.importMode === "url_zip" || fccImport.sourceType === "url")
    ? "url_zip"
    : "manual_zip";
  const rfContextSummary = buildFccSavedEvidenceRfContextSummary(iterations);
  const fccImportSummary = {
    sourceType: fccImport.sourceType || (importMode === "url_zip" ? "url" : "file"),
    importMode,
    sourceUrl: fccImport.sourceUrl || null,
    downloadedFilename: fccImport.downloadedFilename || null,
    downloadedSizeBytes: fccImport.downloadedSizeBytes ?? null,
    downloadedAtIso: fccImport.downloadedAtIso || null,
    contentType: fccImport.contentType || null,
    statusCode: fccImport.statusCode ?? null,
    fileName: fccImport.fileName || null,
    packageId: fccImport.packageId || null,
    filesDetected: fccImport.filesDetected || [],
    mainCsvName: fccImport.mainCsvName || null,
    traceCsvDetected: Boolean(fccImport.traceCsvDetected),
    jsonDetected: Boolean(fccImport.jsonDetected),
    sourceFileSummaries: fccImport.sourceFileSummaries || [],
    phaseRowCount: fccImport.stats?.phaseRowCount ?? fccImport.phaseRowCount ?? null,
    collapsedTestCount: fccImport.stats?.collapsedTestCount ?? fccImport.collapsedTestCount ?? null,
    wifiCount: fccImport.stats?.wifiCount ?? fccImport.wifiCount ?? null,
    cellCount: fccImport.stats?.cellCount ?? fccImport.cellCount ?? null,
    nullConnectionCount: fccImport.stats?.nullConnectionCount ?? fccImport.nullConnectionCount ?? null,
    duplicateSkippedCount: fccImport.stats?.duplicateSkippedCount ?? fccImport.duplicateSkippedCount ?? 0,
    selectedCount: fccImport.stats?.selectedCount ?? fccImport.selectedCount ?? null,
    savedCount: iterations.length,
    sessionStartMs: finalized.sessionStartMs,
    sessionEndMs: finalized.sessionEndMs,
    timestampBufferSeconds: finalized.bufferSeconds,
    insideWindowCount: fccImport.stats?.insideWindowCount ?? null,
    originalSourceSummary: fccImport.originalSourceSummary || null,
    sessionWindowSummary: fccImport.sessionWindowSummary || null,
    savedEvidenceSummary: {
      savedFccIterations: iterations.length,
      savedWifi: iterations.filter((item) => String(item?.fccConnectionType || "").toUpperCase() === "WIFI").length,
      savedCell: iterations.filter((item) => String(item?.fccConnectionType || "").toUpperCase() === "CELL").length,
      rfContextMatched: rfContextSummary.rfContextMatched,
      rfContextUnmatched: rfContextSummary.rfContextUnmatched,
      gpsContextMatched: rfContextSummary.gpsContextMatched,
      trafficStatsContextMatched: rfContextSummary.trafficStatsContextMatched,
    },
    warnings: fccImport.warnings || [],
    errors: fccImport.errors || [],
    parseStatus: fccImport.parseStatus || fccImport.status || null,
    status: iterations.length ? "imported" : (fccImport.status || "not_imported"),
    importedAt: fccImport.importedAt || null,
  };

  return {
    session,
    sessionId: session.id || null,
    feEmail: user?.email || null,
    task: session.taskLabel || taskHelpers.getTaskLabel?.(taskHelpers.activeTask) || "Active field task",
    grid: session.grid || taskHelpers.getTaskGrid?.(taskHelpers.activeTask) || "Grid pending",
    reportLogName: session.reportLogName || null,
    sessionStartedAt: session.startedAt || null,
    sessionEndedAt: session.endedAt || null,
    exportStatus: mapFccExportStatus(session),
    generatedEvidence,
    fccImport,
    fccImportSummary,
    iterations,
  };
}

export function buildFccReportFiles({
  session,
  user,
  activeTask,
  getTaskLabel,
  getTaskGrid,
  baseName = null,
}) {
  const taskHelpers = { activeTask, getTaskLabel, getTaskGrid };
  const model = extractFccReportModel(session, user, taskHelpers);
  // Prefer package/folder baseName from buildReportPackage so files land in the same Reports subfolder.
  const fileBase = String(baseName || "").trim() || buildFccFileBaseName(session, taskHelpers);
  return [
    {
      fileName: `${fileBase}_FCC_Evidence.csv`,
      reportLabel: "FCC External Evidence CSV",
      mimeType: "text/csv",
      content: buildFccEvidenceCsv(model),
    },
    {
      fileName: `${fileBase}_FCC_Evidence.json`,
      reportLabel: "FCC External Evidence JSON",
      mimeType: "application/json",
      content: buildFccEvidenceJson(model),
    },
    {
      fileName: `${fileBase}_FCC_Import_Metadata.json`,
      reportLabel: "FCC Import Metadata JSON",
      mimeType: "application/json",
      content: buildFccImportMetadataJson(model),
    },
  ];
}
