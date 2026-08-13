import { buildOoklaIterationSummary, resolveOoklaIterations } from "./externalEvidenceSummary.js";
import { buildOoklaOcrDebugPayload, formatSuggestionLabel } from "../utils/ooklaOcrAssist.js";
import { finalizeOoklaCsvTimeWindowOnExport } from "../utils/ooklaCsvImport.js";
import {
  DEFAULT_KPI_WARMUP_DURATION_SEC,
  assignOoklaTrafficStatsWarmupEstimates,
  estimateOoklaTrafficStatsWarmup,
  flattenWarmupEstimateForCsv,
  resolveKpiWarmupDurationSec,
} from "../utils/ooklaTrafficStatsWarmup.js";
import {
  classifyEvidenceMatchTier,
  EVIDENCE_MATCH_TIERS,
  isFreshOrRestoredGpsStatus,
  gpsMatchConfidence,
} from "./externalEvidenceMatchTiers.js";

export const OOKLA_REPORT_VERSION = "1.1.12-ookla-warmup-empty-guard";

/** Default: normal OOKLA ZIP excludes developer debug files. */
export const INCLUDE_DEVELOPER_DEBUG_EXPORT_DEFAULT = false;

const OOKLA_RF_MATCH_WINDOW_MS = EVIDENCE_MATCH_TIERS.NEAR_MAX_MS;

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
  if (!timestamp) return null;
  try {
    return new Date(timestamp).toISOString();
  } catch {
    return null;
  }
}

function formatLocalDateTime(timestamp) {
  if (!timestamp) return "N/A";
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return "N/A";
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

export function exportCsvValue(value, digits = null) {
  if (value === null || value === undefined) return "N/A";
  if (typeof value === "number" && !Number.isFinite(value)) return "N/A";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "NaN" || trimmed === "Infinity" || trimmed === "-Infinity") return "N/A";
    if (digits !== null && !Number.isNaN(Number(trimmed))) {
      const n = Number(trimmed);
      return Number.isFinite(n) ? n.toFixed(digits) : "N/A";
    }
    return trimmed;
  }
  if (typeof value === "number" && digits !== null) return value.toFixed(digits);
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
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

function jsonScreenshot(screenshot) {
  if (!screenshot) return null;
  return {
    role: jsonText(screenshot.role),
    fileName: jsonText(screenshot.fileName),
    mimeType: jsonText(screenshot.mimeType),
    sizeBytes: jsonNumber(screenshot.sizeBytes),
    capturedAt: jsonTimestamp(screenshot.capturedAt),
    storageKey: jsonText(screenshot.storageKey),
    exportRelativePath: jsonText(screenshot.exportRelativePath),
  };
}

export function isOoklaSession(session = {}) {
  if (session.appTestType === "ookla_app") return true;
  if (session.appExternalEvidenceProvider === "ookla_app") return true;
  if (session.appOoklaEvidence?.source) return true;
  if (Array.isArray(session.appOoklaEvidenceIterations) && session.appOoklaEvidenceIterations.length) return true;
  return false;
}

function hasOoklaIterationContent(iteration = {}) {
  return iteration.dlMbps !== null
    || iteration.ulMbps !== null
    || iteration.pingMs !== null
    || iteration.jitterMs !== null
    || Boolean(
      iteration.serverName
      || iteration.resultUrl
      || iteration.resultId
      || iteration.notes
      || iteration.mainScreenshot
      || iteration.detailedScreenshot
      || iteration.screenshot,
    );
}

function evidenceSourceLabel(evidence = {}) {
  return evidence.confirmation === "fe_confirmed"
    ? "OOKLA App Manual FE-Confirmed"
    : "OOKLA App Manual Draft";
}

function buildRfSnapshotSummary(session = {}) {
  const stats = session.stats || {};
  const trafficStatsDl = stats?.trafficStatsDl || {};
  const trafficStatsUl = stats?.trafficStatsUl || {};
  return {
    rat: session.rat || null,
    lte: {
      avg_rsrp_dbm: jsonNumber(stats?.lteRsrp?.avg ?? session.avgLteRsrp, 1),
      avg_rsrq_db: jsonNumber(stats?.lteRsrq?.avg ?? session.avgLteRsrq, 1),
      avg_sinr_db: jsonNumber(stats?.lteSinr?.avg ?? session.avgLteSinr, 1),
      avg_rssi_dbm: jsonNumber(stats?.lteRssi?.avg ?? session.avgLteRssi, 1),
    },
    nr: {
      avg_ss_rsrp_dbm: jsonNumber(stats?.nrRsrp?.avg ?? session.avgNrRsrp, 1),
      avg_ss_rsrq_db: jsonNumber(stats?.nrRsrq?.avg ?? session.avgNrRsrq, 1),
      avg_ss_sinr_db: jsonNumber(stats?.nrSinr?.avg ?? session.avgNrSinr, 1),
    },
    sample_count: jsonNumber(session.sampleCount),
    gps_points: jsonNumber(session.gpsCount),
    traffic_stats: {
      supported: session.trafficStatsSupported === true,
      source: "mobile",
      avg_dl_mbps: jsonNumber(session.trafficStatsAvgDlMbps ?? trafficStatsDl.avg, 2),
      avg_ul_mbps: jsonNumber(session.trafficStatsAvgUlMbps ?? trafficStatsUl.avg, 2),
      min_dl_mbps: jsonNumber(trafficStatsDl.min, 2),
      max_dl_mbps: jsonNumber(trafficStatsDl.max, 2),
      min_ul_mbps: jsonNumber(trafficStatsUl.min, 2),
      max_ul_mbps: jsonNumber(trafficStatsUl.max, 2),
      sample_count: jsonNumber(session.trafficStatsSampleCount ?? trafficStatsDl.count),
      summary_rule: "Android mobile byte deltas; not OOKLA result; not BabyDragon engine THP",
      note: "android_mobile_byte_delta",
    },
  };
}

function formatMissingFieldsList(missingFields = []) {
  if (!Array.isArray(missingFields) || !missingFields.length) return "N/A";
  return missingFields.map((key) => formatSuggestionLabel(key)).join("; ");
}

function parseOoklaIterationTimeMs(iteration = {}) {
  const candidates = [
    iteration.ooklaDateTime,
    iteration.testDateTime,
    iteration.savedAt,
    iteration.capturedAt,
  ];
  for (const value of candidates) {
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const ms = Date.parse(String(value));
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

function isActiveRfSample(sample = {}) {
  if (sample.recordState === "paused") return false;
  return sample.recorded !== false;
}

function emptyMatchedRfFields() {
  return {
    matchedRfStatus: "no_nearby_rf_sample",
    matchedRfTimestamp: null,
    matchedRfTimeDeltaSec: null,
    matchedLatitude: null,
    matchedLongitude: null,
    matchedGpsAccuracyM: null,
    matchedRat: null,
    matchedLteRsrp: null,
    matchedLteRsrq: null,
    matchedLteSinr: null,
    matchedLtePci: null,
    matchedLteEarfcn: null,
    matchedNrRsrp: null,
    matchedNrRsrq: null,
    matchedNrSinr: null,
    matchedNrPci: null,
    matchedNrArfcn: null,
    matchedTrafficStatsDlMbps: null,
    matchedTrafficStatsUlMbps: null,
  };
}

/**
 * Match nearest active RF sample to OOKLA iteration time (60s window).
 * Uses ooklaDateTime first, then save/capture time.
 */
export function matchNearestActiveRfSample(session = {}, iteration = {}, maxDeltaMs = OOKLA_RF_MATCH_WINDOW_MS) {
  const targetMs = parseOoklaIterationTimeMs(iteration);
  if (!Number.isFinite(targetMs)) return emptyMatchedRfFields();

  const samples = (session.exportSamples || session.traceSamples || []).filter(isActiveRfSample);
  if (!samples.length) return emptyMatchedRfFields();

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

  const tierInfo = classifyEvidenceMatchTier(minDelta);
  if (!nearest || !tierInfo.matched || minDelta > maxDeltaMs) {
    return {
      ...emptyMatchedRfFields(),
      matchedRfStatus: "unmatched",
      matchedRfTimeDeltaSec: nearest ? Number((minDelta / 1000).toFixed(3)) : null,
      matchTier: tierInfo.tier,
      matchConfidence: "unmatched",
    };
  }

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
  const gpsStatus = nearest.gps?.gps_status;
  const gpsOk = !gpsStatus || isFreshOrRestoredGpsStatus(gpsStatus);
  const conf = gpsMatchConfidence({ tier: tierInfo.tier, gpsStatus, source: "babydragon_session_rf" });

  return {
    matchedRfStatus: conf.status,
    matchTier: tierInfo.tier,
    matchConfidence: conf.confidence,
    matchedRfTimestamp: nearest.timestamp ? new Date(nearest.timestamp).toISOString() : null,
    matchedRfTimeDeltaSec: Number((minDelta / 1000).toFixed(3)),
    matchedLatitude: gpsOk ? jsonNumber(nearest.gps?.lat, 7) : null,
    matchedLongitude: gpsOk ? jsonNumber(nearest.gps?.lng, 7) : null,
    matchedGpsAccuracyM: gpsOk ? jsonNumber(nearest.gps?.accuracy, 1) : null,
    matchedGpsStatus: gpsStatus || null,
    matchedGpsFreshness: gpsOk ? "fresh_or_restored" : "rejected_stale_or_lost",
    matchedRat: jsonText(rat),
    matchedLteRsrp: jsonNumber(lte.rsrp ?? lte.dbm, 1),
    matchedLteRsrq: jsonNumber(lte.rsrq, 1),
    matchedLteSinr: jsonNumber(lte.sinr ?? lte.rssnr, 1),
    matchedLtePci: jsonNumber(lte.pci),
    matchedLteEarfcn: jsonNumber(lte.earfcn ?? lte.channel),
    matchedNrRsrp: jsonNumber(nr.ssRsrp ?? nr.rsrp, 1),
    matchedNrRsrq: jsonNumber(nr.ssRsrq ?? nr.rsrq, 1),
    matchedNrSinr: jsonNumber(nr.ssSinr ?? nr.sinr, 1),
    matchedNrPci: jsonNumber(nr.pci),
    matchedNrArfcn: jsonNumber(nr.nrarfcn ?? nr.channel),
    // Sample traffic uses trafficStatsDlMbps / trafficStatsUlMbps; keep 0.0 (do not treat as missing).
    matchedTrafficStatsDlMbps: jsonNumber(
      traffic.trafficStatsDlMbps ?? traffic.dlMbps ?? traffic.traffic_stats_dl_mbps,
      2,
    ),
    matchedTrafficStatsUlMbps: jsonNumber(
      traffic.trafficStatsUlMbps ?? traffic.ulMbps ?? traffic.traffic_stats_ul_mbps,
      2,
    ),
  };
}

function jsonIteration(iteration = {}) {
  const mainScreenshot = iteration.mainScreenshot || iteration.screenshot || null;
  const detailedScreenshot = iteration.detailedScreenshot || null;
  const csvMeta = iteration.csvImportMeta || {};
  return {
    iterationNumber: jsonNumber(iteration.iterationNumber),
    provider: jsonText(iteration.provider) || "ookla_app",
    source: jsonText(iteration.source),
    evidenceSource: jsonText(iteration.evidenceSource) || jsonText(iteration.source),
    evidenceType: jsonText(iteration.evidenceType),
    confirmation: jsonText(iteration.confirmation),
    capturedAt: jsonTimestamp(iteration.capturedAt),
    savedAt: jsonTimestamp(iteration.savedAt),
    feConfirmedAt: jsonTimestamp(iteration.feConfirmedAt),
    ooklaDateTime: jsonText(iteration.ooklaDateTime || iteration.testDateTime),
    dlMbps: jsonNumber(iteration.dlMbps, 2),
    ulMbps: jsonNumber(iteration.ulMbps, 2),
    pingMs: jsonNumber(iteration.pingMs, 1),
    jitterMs: jsonNumber(iteration.jitterMs, 1),
    serverName: jsonText(iteration.serverName),
    serverLocation: jsonText(iteration.serverLocation),
    providerName: jsonText(iteration.providerName),
    resultUrl: jsonText(iteration.resultUrl),
    resultId: jsonText(iteration.resultId),
    testDateTime: jsonText(iteration.testDateTime || iteration.ooklaDateTime),
    connectionType: jsonText(iteration.connectionType),
    deviceName: jsonText(iteration.deviceName),
    connectionsMode: jsonText(iteration.connectionsMode),
    packetLossPercent: jsonNumber(iteration.packetLossPercent, 2),
    ooklaUserLatitude: jsonNumber(iteration.ooklaUserLatitude, 6),
    ooklaUserLongitude: jsonNumber(iteration.ooklaUserLongitude, 6),
    downloadSizeBytes: jsonNumber(iteration.downloadSizeBytes),
    uploadSizeBytes: jsonNumber(iteration.uploadSizeBytes),
    internalIp: jsonText(iteration.internalIp),
    externalIp: jsonText(iteration.externalIp),
    notes: jsonText(iteration.notes),
    ocrAssistUsed: iteration.ocrAssistUsed === true,
    mainOcrAssistUsed: iteration.mainOcrAssistUsed === true,
    detailedOcrAssistUsed: iteration.detailedOcrAssistUsed === true,
    ocrConfidence: jsonNumber(iteration.ocrConfidence),
    ocrSource: jsonText(iteration.ocrSource),
    ocrExtractedFields: iteration.ocrExtractedFields || {},
    detailedOcrExtractedFields: iteration.detailedOcrExtractedFields || {},
    userConfirmedFields: iteration.userConfirmedFields || {},
    ocrRawTextPreview: jsonText(iteration.ocrRawTextPreview),
    detailedOcrRawTextPreview: jsonText(iteration.detailedOcrRawTextPreview),
    mainOcrDebug: iteration.mainOcrDebug || iteration.ocrDebug || null,
    detailedOcrDebug: iteration.detailedOcrDebug || null,
    ocrDebug: iteration.mainOcrDebug || iteration.ocrDebug || null,
    urlFetchStatus: jsonText(iteration.urlFetchStatus) || "not_attempted",
    urlExtractedFields: iteration.urlExtractedFields || {},
    urlAssistUsed: iteration.urlAssistUsed === true,
    valueSource: jsonText(iteration.valueSource) || "manual",
    fieldSources: iteration.fieldSources || {},
    evidenceCompleteness: jsonText(iteration.evidenceCompleteness) || "partial",
    requiredEvidenceStatus: jsonText(iteration.requiredEvidenceStatus || iteration.evidenceCompleteness) || "partial",
    optionalMissingFields: Array.isArray(iteration.optionalMissingFields)
      ? iteration.optionalMissingFields
      : (Array.isArray(iteration.missingFields) ? iteration.missingFields : []),
    missingFields: Array.isArray(iteration.optionalMissingFields)
      ? iteration.optionalMissingFields
      : (Array.isArray(iteration.missingFields) ? iteration.missingFields : []),
    mainScreenshot: jsonScreenshot(mainScreenshot),
    detailedScreenshot: jsonScreenshot(detailedScreenshot),
    mainScreenshotStorageKey: jsonText(mainScreenshot?.storageKey),
    detailedScreenshotStorageKey: jsonText(detailedScreenshot?.storageKey),
    csvSourceFileName: jsonText(csvMeta.sourceFileName || iteration.csvSourceFileName),
    csvOriginalRowNumber: jsonNumber(csvMeta.originalRowNumber ?? iteration.csvOriginalRowNumber),
    insideBabyDragonTimeWindow: csvMeta.insideBabyDragonTimeWindow ?? iteration.insideBabyDragonTimeWindow ?? null,
    csvImportMeta: Object.keys(csvMeta).length ? csvMeta : null,
    trafficStatsWarmupEstimate: iteration.trafficStatsWarmupEstimate || null,
    screenshot: jsonScreenshot(mainScreenshot),
    nearestSample: iteration.nearestSample || null,
  };
}

function buildScreenshotOcrDebugJson(model = {}, {
  debugType,
  assistKey,
  debugKey,
  extractedKey,
  previewKey,
} = {}) {
  const iterations = model.iterations?.length ? model.iterations : (model.evidence?.source ? [model.evidence] : []);
  const debugIterations = iterations
    .map((iteration, index) => {
      const debug = iteration?.[debugKey] || (debugKey === "mainOcrDebug" ? iteration?.ocrDebug : null);
      const assistUsed = iteration?.[assistKey] || (assistKey === "mainOcrAssistUsed" && iteration?.ocrAssistUsed);
      if (!assistUsed && !debug) return null;
      const payload = buildOoklaOcrDebugPayload(debug, {
        ...iteration,
        ...(iteration?.[extractedKey] || {}),
      });
      if (!payload) return null;
      return {
        iterationNumber: iteration.iterationNumber ?? (index + 1),
        resultId: iteration.resultId || null,
        resultUrl: iteration.resultUrl || null,
        ocrRawTextPreview: iteration?.[previewKey] || null,
        ...payload,
      };
    })
    .filter(Boolean);

  if (!debugIterations.length) return null;

  return JSON.stringify({
    babyDragonReportVersion: OOKLA_REPORT_VERSION,
    owner: "MobbiTech Global LLC",
    source: "ookla_app_manual_v1h3",
    debugType,
    sessionId: model.sessionId || null,
    generatedAtIso: jsonTimestamp(Date.now()),
    iterations: debugIterations,
  }, null, 2);
}

export function buildOoklaMainScreenshotOcrDebugJson(model = {}) {
  return buildScreenshotOcrDebugJson(model, {
    debugType: "ookla_main_screenshot_ocr_debug",
    assistKey: "mainOcrAssistUsed",
    debugKey: "mainOcrDebug",
    extractedKey: "ocrExtractedFields",
    previewKey: "ocrRawTextPreview",
  });
}

export function buildOoklaDetailedScreenshotOcrDebugJson(model = {}) {
  return buildScreenshotOcrDebugJson(model, {
    debugType: "ookla_detailed_screenshot_ocr_debug",
    assistKey: "detailedOcrAssistUsed",
    debugKey: "detailedOcrDebug",
    extractedKey: "detailedOcrExtractedFields",
    previewKey: "detailedOcrRawTextPreview",
  });
}

/** @deprecated Prefer buildOoklaMainScreenshotOcrDebugJson */
export function buildOoklaOcrDebugJson(model = {}) {
  return buildOoklaMainScreenshotOcrDebugJson(model);
}

export function extractOoklaReportModel(session = {}, user = {}, taskHelpers = {}) {
  const getTaskLabel = taskHelpers.getTaskLabel || (() => "Active field task");
  const getTaskGrid = taskHelpers.getTaskGrid || (() => "Grid pending");
  const activeTask = taskHelpers.activeTask || null;
  const rawIterations = resolveOoklaIterations(session);
  const exportStopMs = Number.isFinite(taskHelpers.exportStopMs) ? taskHelpers.exportStopMs : Date.now();
  const finalized = finalizeOoklaCsvTimeWindowOnExport({
    iterations: rawIterations,
    csvImportDebug: session.appOoklaCsvImportDebug || null,
    sessionStartMs: session.startedAt ?? null,
    sessionEndMs: session.endedAt ?? null,
    bufferSeconds: session.appOoklaCsvImportDebug?.bufferSeconds ?? 60,
    exportStopMs,
  });
  const kpiWarmupDurationSec = resolveKpiWarmupDurationSec(session, DEFAULT_KPI_WARMUP_DURATION_SEC);
  const iterations = assignOoklaTrafficStatsWarmupEstimates(session, finalized.iterations, {
    kpiWarmupDurationSec,
  });
  const csvImportDebug = finalized.csvImportDebug;
  const evidence = session.appOoklaEvidence || iterations[iterations.length - 1] || {};

  return {
    session,
    sessionId: session.id || null,
    feEmail: user?.email || null,
    task: session.taskLabel || getTaskLabel(activeTask),
    grid: session.grid || getTaskGrid(activeTask),
    reportLogName: session.reportLogName || null,
    sessionStartedAt: session.startedAt || null,
    sessionEndedAt: session.endedAt || null,
    exportStatus: session.appExportStatus || null,
    kpiWarmupDurationSec,
    iterations,
    evidence,
    summary: buildOoklaIterationSummary(iterations, csvImportDebug),
    csvImportDebug,
    rfSnapshotSummary: buildRfSnapshotSummary(session),
  };
}

export function buildOoklaFileBaseName(session = {}, taskHelpers = {}) {
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
  return cleanFilePart(`${taskOrGrid}_OOKLA_${formatFileDateTime(timestamp)}`, "BabyDragon_OOKLA");
}

export function buildOoklaCsv(model = {}) {
  return buildOoklaEvidenceCsv(model);
}

export function buildOoklaEvidenceCsv(model = {}) {
  const session = model.session || {};
  const iterations = model.iterations?.length ? model.iterations : (model.evidence?.source ? [model.evidence] : []);
  const headers = [
    "iterationNumber",
    "evidenceSource",
    "ooklaDateTime",
    "dlMbps",
    "ulMbps",
    "pingMs",
    "jitterMs",
    "resultId",
    "resultUrl",
    "providerName",
    "serverName",
    "serverLocation",
    "connectionType",
    "deviceName",
    "connectionsMode",
    "packetLossPercent",
    "ooklaUserLatitude",
    "ooklaUserLongitude",
    "downloadSizeBytes",
    "uploadSizeBytes",
    "internalIp",
    "externalIp",
    "mainScreenshotFileName",
    "mainScreenshotStorageKey",
    "detailedScreenshotFileName",
    "detailedScreenshotStorageKey",
    "csvSourceFileName",
    "csvOriginalRowNumber",
    "insideBabyDragonTimeWindow",
    "evidenceCompleteness",
    "requiredEvidenceStatus",
    "optionalMissingFields",
    "missingFields",
    "fieldSources",
    "matchedRfStatus",
    "matchedRfTimestamp",
    "matchedRfTimeDeltaSec",
    "matchedLatitude",
    "matchedLongitude",
    "matchedGpsAccuracyM",
    "matchedRat",
    "matchedLteRsrp",
    "matchedLteRsrq",
    "matchedLteSinr",
    "matchedLtePci",
    "matchedLteEarfcn",
    "matchedNrRsrp",
    "matchedNrRsrq",
    "matchedNrSinr",
    "matchedNrPci",
    "matchedNrArfcn",
    "matchedTrafficStatsDlMbps",
    "matchedTrafficStatsUlMbps",
    "kpi_warmup_duration_sec",
    "trafficstats_warmup_source",
    "trafficstats_warmup_rule",
    "trafficstats_warmup_status",
    "trafficstats_warmup_confidence",
    "trafficstats_dl_burst_start",
    "trafficstats_dl_burst_end",
    "trafficstats_dl_warmup_sec",
    "trafficstats_dl_warmup_bytes",
    "trafficstats_dl_warmup_mbps",
    "trafficstats_dl_measured_sec",
    "trafficstats_dl_measured_bytes",
    "trafficstats_dl_measured_mbps",
    "trafficstats_ul_burst_start",
    "trafficstats_ul_burst_end",
    "trafficstats_ul_warmup_sec",
    "trafficstats_ul_warmup_bytes",
    "trafficstats_ul_warmup_mbps",
    "trafficstats_ul_measured_sec",
    "trafficstats_ul_measured_bytes",
    "trafficstats_ul_measured_mbps",
  ];

  const emptyMatched = emptyMatchedRfFields();
  const emptyRow = Object.fromEntries(headers.map((key) => [key, key === "missingFields" ? "No OOKLA iterations saved." : "N/A"]));
  Object.assign(emptyRow, {
    matchedRfStatus: emptyMatched.matchedRfStatus,
  });

  const kpiWarmupDurationSec = resolveKpiWarmupDurationSec(
    { ...session, kpiWarmupDurationSec: model.kpiWarmupDurationSec ?? session?.kpiWarmupDurationSec },
    DEFAULT_KPI_WARMUP_DURATION_SEC,
  );

  const rows = iterations.map((evidence) => {
    const mainScreenshot = evidence.mainScreenshot || evidence.screenshot || null;
    const detailedScreenshot = evidence.detailedScreenshot || null;
    const matched = matchNearestActiveRfSample(session, evidence);
    const warmup = evidence.trafficStatsWarmupEstimate
      || estimateOoklaTrafficStatsWarmup(session, evidence, { kpiWarmupDurationSec });
    const warmupCsv = flattenWarmupEstimateForCsv(warmup);
    return {
      iterationNumber: exportCsvValue(evidence.iterationNumber),
      evidenceSource: exportCsvValue(evidence.evidenceSource || evidence.source || "manual"),
      ooklaDateTime: exportCsvValue(evidence.ooklaDateTime || evidence.testDateTime),
      dlMbps: exportCsvValue(evidence.dlMbps, 2),
      ulMbps: exportCsvValue(evidence.ulMbps, 2),
      pingMs: exportCsvValue(evidence.pingMs, 1),
      jitterMs: exportCsvValue(evidence.jitterMs, 1),
      resultId: exportCsvValue(evidence.resultId),
      resultUrl: exportCsvValue(evidence.resultUrl),
      providerName: exportCsvValue(evidence.providerName),
      serverName: exportCsvValue(evidence.serverName),
      serverLocation: exportCsvValue(evidence.serverLocation),
      connectionType: exportCsvValue(evidence.connectionType),
      deviceName: exportCsvValue(evidence.deviceName),
      connectionsMode: exportCsvValue(evidence.connectionsMode),
      packetLossPercent: exportCsvValue(evidence.packetLossPercent, 2),
      ooklaUserLatitude: exportCsvValue(evidence.ooklaUserLatitude, 6),
      ooklaUserLongitude: exportCsvValue(evidence.ooklaUserLongitude, 6),
      downloadSizeBytes: exportCsvValue(evidence.downloadSizeBytes),
      uploadSizeBytes: exportCsvValue(evidence.uploadSizeBytes),
      internalIp: exportCsvValue(evidence.internalIp),
      externalIp: exportCsvValue(evidence.externalIp),
      mainScreenshotFileName: exportCsvValue(mainScreenshot?.fileName),
      mainScreenshotStorageKey: exportCsvValue(mainScreenshot?.storageKey),
      detailedScreenshotFileName: exportCsvValue(detailedScreenshot?.fileName),
      detailedScreenshotStorageKey: exportCsvValue(detailedScreenshot?.storageKey),
      csvSourceFileName: exportCsvValue(evidence.csvImportMeta?.sourceFileName || evidence.csvSourceFileName),
      csvOriginalRowNumber: exportCsvValue(evidence.csvImportMeta?.originalRowNumber ?? evidence.csvOriginalRowNumber),
      insideBabyDragonTimeWindow: exportCsvValue(
        evidence.csvImportMeta?.insideBabyDragonTimeWindow ?? evidence.insideBabyDragonTimeWindow,
      ),
      evidenceCompleteness: exportCsvValue(evidence.evidenceCompleteness || evidence.requiredEvidenceStatus || "partial"),
      requiredEvidenceStatus: exportCsvValue(evidence.requiredEvidenceStatus || evidence.evidenceCompleteness || "partial"),
      optionalMissingFields: formatMissingFieldsList(evidence.optionalMissingFields || evidence.missingFields),
      missingFields: formatMissingFieldsList(evidence.optionalMissingFields || evidence.missingFields),
      fieldSources: exportCsvValue(
        evidence.fieldSources && Object.keys(evidence.fieldSources).length
          ? JSON.stringify(evidence.fieldSources)
          : "",
      ),
      matchedRfStatus: exportCsvValue(matched.matchedRfStatus),
      matchedRfTimestamp: exportCsvValue(matched.matchedRfTimestamp),
      matchedRfTimeDeltaSec: exportCsvValue(matched.matchedRfTimeDeltaSec, 3),
      matchedLatitude: exportCsvValue(matched.matchedLatitude, 7),
      matchedLongitude: exportCsvValue(matched.matchedLongitude, 7),
      matchedGpsAccuracyM: exportCsvValue(matched.matchedGpsAccuracyM, 1),
      matchedRat: exportCsvValue(matched.matchedRat),
      matchedLteRsrp: exportCsvValue(matched.matchedLteRsrp, 1),
      matchedLteRsrq: exportCsvValue(matched.matchedLteRsrq, 1),
      matchedLteSinr: exportCsvValue(matched.matchedLteSinr, 1),
      matchedLtePci: exportCsvValue(matched.matchedLtePci),
      matchedLteEarfcn: exportCsvValue(matched.matchedLteEarfcn),
      matchedNrRsrp: exportCsvValue(matched.matchedNrRsrp, 1),
      matchedNrRsrq: exportCsvValue(matched.matchedNrRsrq, 1),
      matchedNrSinr: exportCsvValue(matched.matchedNrSinr, 1),
      matchedNrPci: exportCsvValue(matched.matchedNrPci),
      matchedNrArfcn: exportCsvValue(matched.matchedNrArfcn),
      matchedTrafficStatsDlMbps: exportCsvValue(matched.matchedTrafficStatsDlMbps, 2),
      matchedTrafficStatsUlMbps: exportCsvValue(matched.matchedTrafficStatsUlMbps, 2),
      kpi_warmup_duration_sec: exportCsvValue(warmupCsv.kpi_warmup_duration_sec),
      trafficstats_warmup_source: exportCsvValue(warmupCsv.trafficstats_warmup_source),
      trafficstats_warmup_rule: exportCsvValue(warmupCsv.trafficstats_warmup_rule),
      trafficstats_warmup_status: exportCsvValue(warmupCsv.trafficstats_warmup_status),
      trafficstats_warmup_confidence: exportCsvValue(warmupCsv.trafficstats_warmup_confidence),
      trafficstats_dl_burst_start: exportCsvValue(warmupCsv.trafficstats_dl_burst_start),
      trafficstats_dl_burst_end: exportCsvValue(warmupCsv.trafficstats_dl_burst_end),
      trafficstats_dl_warmup_sec: exportCsvValue(warmupCsv.trafficstats_dl_warmup_sec, 3),
      trafficstats_dl_warmup_bytes: exportCsvValue(warmupCsv.trafficstats_dl_warmup_bytes),
      trafficstats_dl_warmup_mbps: exportCsvValue(warmupCsv.trafficstats_dl_warmup_mbps, 2),
      trafficstats_dl_measured_sec: exportCsvValue(warmupCsv.trafficstats_dl_measured_sec, 3),
      trafficstats_dl_measured_bytes: exportCsvValue(warmupCsv.trafficstats_dl_measured_bytes),
      trafficstats_dl_measured_mbps: exportCsvValue(warmupCsv.trafficstats_dl_measured_mbps, 2),
      trafficstats_ul_burst_start: exportCsvValue(warmupCsv.trafficstats_ul_burst_start),
      trafficstats_ul_burst_end: exportCsvValue(warmupCsv.trafficstats_ul_burst_end),
      trafficstats_ul_warmup_sec: exportCsvValue(warmupCsv.trafficstats_ul_warmup_sec, 3),
      trafficstats_ul_warmup_bytes: exportCsvValue(warmupCsv.trafficstats_ul_warmup_bytes),
      trafficstats_ul_warmup_mbps: exportCsvValue(warmupCsv.trafficstats_ul_warmup_mbps, 2),
      trafficstats_ul_measured_sec: exportCsvValue(warmupCsv.trafficstats_ul_measured_sec, 3),
      trafficstats_ul_measured_bytes: exportCsvValue(warmupCsv.trafficstats_ul_measured_bytes),
      trafficstats_ul_measured_mbps: exportCsvValue(warmupCsv.trafficstats_ul_measured_mbps, 2),
    };
  });

  return `\uFEFF${makeCsvSection(headers, rows.length ? rows : [emptyRow])}`;
}

export function buildOoklaJson(model = {}) {
  const iterations = model.iterations?.length ? model.iterations : (model.evidence?.source ? [model.evidence] : []);
  const evidence = model.evidence || iterations[iterations.length - 1] || {};
  const summary = model.summary || buildOoklaIterationSummary(iterations);

  return JSON.stringify({
    babyDragonReportVersion: OOKLA_REPORT_VERSION,
    owner: "MobbiTech Global LLC",
    source: evidence.source || "ookla_app_manual_v1h3",
    evidenceType: evidence.evidenceType || "external_manual",
    testType: "OOKLA App Manual",
    sessionId: model.sessionId,
    generatedAtIso: jsonTimestamp(Date.now()),
    task: jsonText(model.task),
    grid: jsonText(model.grid),
    reportLogName: jsonText(model.reportLogName),
    feEmail: jsonText(model.feEmail),
    session: {
      startedAtIso: jsonTimestamp(model.sessionStartedAt),
      endedAtIso: jsonTimestamp(model.sessionEndedAt),
      startedAtLocal: formatLocalDateTime(model.sessionStartedAt) === "N/A" ? null : formatLocalDateTime(model.sessionStartedAt),
      endedAtLocal: formatLocalDateTime(model.sessionEndedAt) === "N/A" ? null : formatLocalDateTime(model.sessionEndedAt),
      exportStatus: jsonText(model.exportStatus),
      kpiWarmupDurationSec: jsonNumber(model.kpiWarmupDurationSec ?? DEFAULT_KPI_WARMUP_DURATION_SEC),
    },
    summary: {
      ...summary,
      confirmation: jsonText(evidence.confirmation),
      passClaim: false,
      evidenceSource: evidenceSourceLabel(evidence),
    },
    iterations: iterations.map(jsonIteration),
    evidence: jsonIteration(evidence),
    rfSnapshotSummary: model.rfSnapshotSummary || null,
    errors: {
      message: iterations.some((item) => item.confirmation === "fe_confirmed")
        ? null
        : "Evidence saved as draft or partial manual entry.",
    },
  }, null, 2);
}

/**
 * Normal OOKLA export: only OOKLA_Evidence.csv (paired with Report.json + RF_GPS_Trace.csv by caller).
 * Debug files are separate and off by default.
 */
export function buildOoklaEvidenceExportFile({
  session,
  user,
  activeTask,
  getTaskLabel,
  getTaskGrid,
  baseName,
}) {
  const taskHelpers = { activeTask, getTaskLabel, getTaskGrid };
  const model = extractOoklaReportModel(session, user, taskHelpers);
  const fileBase = baseName || buildOoklaFileBaseName(session, taskHelpers);
  return {
    fileName: `${fileBase}_OOKLA_Evidence.csv`,
    reportLabel: "OOKLA Evidence CSV",
    mimeType: "text/csv",
    content: buildOoklaEvidenceCsv(model),
  };
}

export function buildOoklaDeveloperDebugFiles({
  session,
  user,
  activeTask,
  getTaskLabel,
  getTaskGrid,
}) {
  const taskHelpers = { activeTask, getTaskLabel, getTaskGrid };
  const model = extractOoklaReportModel(session, user, taskHelpers);
  const files = [];

  const mainDebug = buildOoklaMainScreenshotOcrDebugJson(model);
  if (mainDebug) {
    files.push({
      fileName: "debug/OOKLA_Main_Screenshot_OCR_Debug.json",
      reportLabel: "OOKLA Main Screenshot OCR Debug",
      mimeType: "application/json",
      content: mainDebug,
    });
  }

  const detailedDebug = buildOoklaDetailedScreenshotOcrDebugJson(model);
  if (detailedDebug) {
    files.push({
      fileName: "debug/OOKLA_Detailed_Screenshot_OCR_Debug.json",
      reportLabel: "OOKLA Detailed Screenshot OCR Debug",
      mimeType: "application/json",
      content: detailedDebug,
    });
  }

  if (model.csvImportDebug) {
    files.push({
      fileName: "debug/OOKLA_CSV_Import_Debug.json",
      reportLabel: "OOKLA CSV Import Debug",
      mimeType: "application/json",
      content: JSON.stringify({
        babyDragonReportVersion: OOKLA_REPORT_VERSION,
        owner: "MobbiTech Global LLC",
        debugType: "ookla_csv_import_debug",
        sessionId: model.sessionId || null,
        generatedAtIso: jsonTimestamp(Date.now()),
        ...model.csvImportDebug,
      }, null, 2),
    });
  }

  return files;
}

/** @deprecated Prefer buildOoklaEvidenceExportFile + buildOoklaDeveloperDebugFiles */
export function buildOoklaReportFiles({
  session,
  user,
  activeTask,
  getTaskLabel,
  getTaskGrid,
  baseName,
  includeDeveloperDebugExport = INCLUDE_DEVELOPER_DEBUG_EXPORT_DEFAULT,
}) {
  const files = [
    buildOoklaEvidenceExportFile({
      session,
      user,
      activeTask,
      getTaskLabel,
      getTaskGrid,
      baseName,
    }),
  ];
  if (includeDeveloperDebugExport) {
    files.push(...buildOoklaDeveloperDebugFiles({
      session,
      user,
      activeTask,
      getTaskLabel,
      getTaskGrid,
    }));
  }
  return files;
}

export function mapOoklaExportStatus(status, evidence = {}, iterations = null) {
  const safeEvidence = evidence || {};
  const list = Array.isArray(iterations) && iterations.length
    ? iterations
    : resolveOoklaIterations({ appOoklaEvidence: safeEvidence, appOoklaEvidenceIterations: Array.isArray(iterations) ? iterations : [] });
  const key = String(status || "").toLowerCase();
  if (key === "evidence_saved") return "saved";
  if (key === "evidence_partial") return "partial";
  if (key === "evidence_draft") return "draft";
  if (!list.length) {
    if (safeEvidence.confirmation === "fe_confirmed") return "saved";
    return "draft";
  }
  const confirmed = list.filter((item) => item.confirmation === "fe_confirmed");
  const complete = list.filter((item) => {
    const completeness = String(item.evidenceCompleteness || "").toLowerCase();
    const source = String(item.evidenceSource || item.source || "").toLowerCase();
    return completeness === "complete"
      || source.includes("csv")
      || (hasOoklaIterationContent(item) && (item.dlMbps != null || item.ulMbps != null) && (item.resultId || item.ooklaDateTime || item.capturedAt));
  });
  if (confirmed.length === list.length || complete.length === list.length) return "saved";
  if (confirmed.length > 0 || complete.length > 0) return "partial";
  if (list.some(hasOoklaIterationContent)) return "partial";
  return "draft";
}
