/**
 * FCC App ZIP export import (Step 1I2A / 1I2B).
 * Parses FCC Mobile Speed Test ZIP, collapses LATENCY/DOWNLOAD/UPLOAD by test_id,
 * and truncates to the BabyDragon RF session time window across all source files.
 */

import JSZip from "jszip";

export const FCC_DEFAULT_BUFFER_SECONDS = 30;
export const FCC_EVIDENCE_RULE =
  "FCC App results are external imported evidence. BabyDragon RF/GPS/TrafficStats fields are context captured by BabyDragon and are not FCC official throughput.";

const MAIN_CSV_RE = /^FCC-Mobile-Speed-Test-ANDROID-.+\.csv$/i;
const TRACE_CSV_RE = /^FCC-Mobile-Speed-Test-Traces-ANDROID-.+\.csv$/i;
const MAIN_JSON_RE = /^FCC-Mobile-Speed-Test-ANDROID-.+\.json$/i;
const PACKAGE_ID_RE = /FCC-Mobile-Speed-Test-ANDROID-([a-zA-Z0-9_-]+)\.zip$/i;

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text || text === "null" || text === "undefined" || text === "N/A") return null;
  return text;
}

function cleanNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Number.isNaN(value)) return null;
    return value;
  }
  const text = String(value).trim().replace(/,/g, "");
  if (!text || text === "null" || text === "NaN" || text === "Infinity" || text === "-Infinity") return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function roundNumber(value, digits = null) {
  const number = cleanNumber(value);
  if (number === null) return null;
  if (digits === null || Number.isInteger(number)) return number;
  return Number(number.toFixed(digits));
}

function parseBoolFlag(value) {
  if (value === true || value === false) return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "true" || text === "1" || text === "yes") return true;
  if (text === "false" || text === "0" || text === "no") return false;
  return null;
}

/** Minimal RFC4180-ish CSV parse (quoted fields, commas, CRLF). */
export function parseCsvText(text = "") {
  const raw = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    const next = raw[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n" || (ch === "\r" && next === "\n")) {
      row.push(field);
      field = "";
      if (row.some((cell) => String(cell || "").trim() !== "")) rows.push(row);
      row = [];
      if (ch === "\r") i += 1;
      continue;
    }
    if (ch === "\r") {
      row.push(field);
      field = "";
      if (row.some((cell) => String(cell || "").trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  row.push(field);
  if (row.some((cell) => String(cell || "").trim() !== "")) rows.push(row);
  return rows;
}

function toEpochMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = cleanText(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
}

function bytesSecToMbps(bytesSec) {
  const n = cleanNumber(bytesSec);
  if (n === null) return null;
  return roundNumber((n * 8) / 1e6, 3);
}

function microToMs(value) {
  const n = cleanNumber(value);
  if (n === null) return null;
  return roundNumber(n / 1000, 3);
}

function microToSec(value) {
  const n = cleanNumber(value);
  if (n === null) return null;
  return roundNumber(n / 1e6, 6);
}

function normalizeConnectionType(...candidates) {
  for (const candidate of candidates) {
    const raw = cleanText(candidate);
    if (!raw) continue;
    const upper = raw.toUpperCase();
    if (upper === "NULL") continue;
    if (upper === "WIFI" || upper === "WI-FI") return "WIFI";
    if (upper === "CELL" || upper === "CELLULAR" || upper === "MOBILE") return "CELL";
    return upper;
  }
  return null;
}

function buildNetworkType(generation, subtype) {
  const gen = cleanText(generation);
  const sub = cleanText(subtype);
  if (gen && sub) return `${gen} / ${sub}`;
  return gen || sub || null;
}

function deriveLossPct(packetsSent, packetsReceived, packetLossRaw) {
  const sent = cleanNumber(packetsSent);
  const received = cleanNumber(packetsReceived);
  if (sent !== null && received !== null && sent > 0) {
    return roundNumber(((sent - received) / sent) * 100, 3);
  }
  // packet_loss unit is unclear — keep raw separately; do not trust as percent.
  void packetLossRaw;
  return null;
}

function stableHash(text) {
  const input = String(text || "");
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return `h${Math.abs(hash)}`;
}

export function buildFccDedupeKey(row = {}) {
  const testId = cleanText(row.fccTestId || row.test_id);
  if (testId) return `id:${testId}`;
  const ms = cleanNumber(row.fccTestAtMs);
  const dl = cleanNumber(row.fccDlMbps);
  const ul = cleanNumber(row.fccUlMbps);
  const ping = cleanNumber(row.fccPingMs);
  const conn = cleanText(row.fccConnectionType) || "";
  const server = cleanText(row.fccServerName) || "";
  if (ms !== null || dl !== null || ul !== null || ping !== null) {
    return `combo:${ms ?? ""}|${dl ?? ""}|${ul ?? ""}|${ping ?? ""}|${conn}|${server}`;
  }
  return `hash:${stableHash(JSON.stringify(row.rawRowRef || row))}`;
}

export function resolveFccWindowBounds(sessionStartMs, sessionEndMs, bufferSeconds = FCC_DEFAULT_BUFFER_SECONDS) {
  if (!Number.isFinite(sessionStartMs) || !Number.isFinite(sessionEndMs)) {
    return { windowStartMs: null, windowEndMs: null, bufferSeconds: Math.max(0, Number(bufferSeconds) || 0) };
  }
  const bufferMs = Math.max(0, Number(bufferSeconds) || 0) * 1000;
  return {
    windowStartMs: sessionStartMs - bufferMs,
    windowEndMs: sessionEndMs + bufferMs,
    bufferSeconds: Math.max(0, Number(bufferSeconds) || 0),
  };
}

/** Point-in-window helper (single timestamp). */
export function isInsideFccTimeWindow(timestampMs, sessionStartMs, sessionEndMs, bufferSeconds = FCC_DEFAULT_BUFFER_SECONDS) {
  if (!Number.isFinite(timestampMs)) return null;
  const { windowStartMs, windowEndMs } = resolveFccWindowBounds(sessionStartMs, sessionEndMs, bufferSeconds);
  if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs)) return null;
  return timestampMs >= windowStartMs && timestampMs <= windowEndMs;
}

/**
 * Overlap rule for collapsed FCC tests:
 * testEndMs >= windowStartMs AND testStartMs <= windowEndMs
 */
export function doesFccTestOverlapSessionWindow(testStartMs, testEndMs, sessionStartMs, sessionEndMs, bufferSeconds = FCC_DEFAULT_BUFFER_SECONDS) {
  if (!Number.isFinite(testStartMs) || !Number.isFinite(testEndMs)) return null;
  const { windowStartMs, windowEndMs } = resolveFccWindowBounds(sessionStartMs, sessionEndMs, bufferSeconds);
  if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs)) return null;
  return testEndMs >= windowStartMs && testStartMs <= windowEndMs;
}

export function classifyFccTimeWindow(row = {}, sessionStartMs = null, sessionEndMs = null, bufferSeconds = FCC_DEFAULT_BUFFER_SECONDS) {
  const startMs = cleanNumber(row.testStartMs)
    ?? cleanNumber(row.fccTestAtMs)
    ?? toEpochMs(row.fccLatencyTestAt)
    ?? toEpochMs(row.fccDownloadTestAt)
    ?? toEpochMs(row.fccUploadTestAt);
  const endMs = cleanNumber(row.testEndMs)
    ?? cleanNumber(row.fccTestAtMs)
    ?? toEpochMs(row.fccUploadTestAt)
    ?? toEpochMs(row.fccDownloadTestAt)
    ?? toEpochMs(row.fccLatencyTestAt)
    ?? startMs;

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "unknown";
  if (!Number.isFinite(sessionStartMs) || !Number.isFinite(sessionEndMs)) return "unknown";

  const overlaps = doesFccTestOverlapSessionWindow(startMs, endMs, sessionStartMs, sessionEndMs, bufferSeconds);
  if (overlaps === null) return "unknown";
  return overlaps ? "yes" : "no";
}

function collectTimestampCandidates(row = {}) {
  const fields = [
    row.test_time,
    row.device_timestamp,
    row.beginning_location_time,
    row.end_location_time,
    row.beginning_cellular_cell_network_time,
    row.end_cellular_cell_network_time,
    row.cell_network_time,
    row.timestamp,
  ];
  return fields
    .map((value) => {
      const original = cleanText(value);
      const ms = toEpochMs(original);
      return original && Number.isFinite(ms) ? { original, ms } : null;
    })
    .filter(Boolean);
}

function extractPackageId(fileName = "") {
  const match = String(fileName || "").match(PACKAGE_ID_RE);
  return match?.[1] || null;
}

function rowObject(headers, cells, sourceRowNumber) {
  const obj = { __sourceRowNumber: sourceRowNumber };
  headers.forEach((header, index) => {
    obj[header] = cells[index] ?? "";
  });
  return obj;
}

function pickPhase(phaseRows, name) {
  return phaseRows.find((row) => String(row.tests || "").trim().toUpperCase() === name) || null;
}

function collapsePhaseGroup(testId, phaseRows, sourceFile) {
  const latency = pickPhase(phaseRows, "LATENCY");
  const download = pickPhase(phaseRows, "DOWNLOAD");
  const upload = pickPhase(phaseRows, "UPLOAD");
  const any = download || upload || latency || phaseRows[0] || {};

  const latencyTestAt = cleanText(latency?.test_time);
  const downloadTestAt = cleanText(download?.test_time);
  const uploadTestAt = cleanText(upload?.test_time);

  const allTs = [];
  phaseRows.forEach((row) => {
    collectTimestampCandidates(row).forEach((item) => allTs.push(item));
  });
  allTs.sort((a, b) => a.ms - b.ms);
  const earliest = allTs[0] || null;
  const latest = allTs.length ? allTs[allTs.length - 1] : null;
  const testStartMs = earliest?.ms ?? null;
  const testEndMs = latest?.ms ?? null;

  const fccTestAt = latencyTestAt || earliest?.original || null;
  const fccTestAtMs = toEpochMs(fccTestAt) ?? testStartMs;

  const packetsSent = cleanNumber(latency?.packets_sent);
  const packetsReceived = cleanNumber(latency?.packets_received);
  const packetLossRaw = cleanNumber(latency?.packet_loss);

  const connectionType = normalizeConnectionType(
    download?.connection_type,
    upload?.connection_type,
    latency?.connection_type,
  );

  const sourceRowNumbers = phaseRows
    .map((row) => row.__sourceRowNumber)
    .filter((value) => Number.isFinite(value));

  const phasesPresent = phaseRows
    .map((row) => cleanText(row.tests)?.toUpperCase())
    .filter(Boolean);

  const sourceFiles = [...new Set(
    phaseRows.map((row) => cleanText(row.__sourceFile) || sourceFile).filter(Boolean),
  )];

  const phaseTimestampDetails = phaseRows.map((row) => {
    const stamps = collectTimestampCandidates(row);
    return {
      sourceFile: cleanText(row.__sourceFile) || sourceFile,
      sourceRowNumber: row.__sourceRowNumber ?? null,
      phase: cleanText(row.tests)?.toUpperCase() || null,
      originalTimestamp: stamps[0]?.original || cleanText(row.test_time),
      timestampMs: stamps[0]?.ms ?? toEpochMs(row.test_time),
    };
  });

  return {
    provider: "fcc_app",
    evidenceType: "external_import",
    evidenceSource: "fcc_export_zip_csv",
    fccTestId: cleanText(testId),
    fccDlMbps: bytesSecToMbps(download?.bytes_sec),
    fccUlMbps: bytesSecToMbps(upload?.bytes_sec),
    fccPingMs: microToMs(latency?.["round_trip_time(micro second)"]),
    fccJitterMs: microToMs(latency?.jitter),
    fccLossPct: deriveLossPct(packetsSent, packetsReceived, packetLossRaw),
    fccPacketLossRaw: packetLossRaw,
    fccPacketsSent: packetsSent,
    fccPacketsReceived: packetsReceived,
    fccTestAt,
    fccTestAtMs: Number.isFinite(fccTestAtMs) ? fccTestAtMs : null,
    testStartMs: Number.isFinite(testStartMs) ? testStartMs : null,
    testEndMs: Number.isFinite(testEndMs) ? testEndMs : null,
    fccTestStartAt: earliest?.original || null,
    fccTestEndAt: latest?.original || null,
    fccDownloadTestAt: downloadTestAt,
    fccUploadTestAt: uploadTestAt,
    fccLatencyTestAt: latencyTestAt,
    fccCarrier: cleanText(any.provider_name),
    fccConnectionType: connectionType,
    fccNetworkType: buildNetworkType(
      download?.beginning_network_generation || upload?.beginning_network_generation || latency?.beginning_network_generation,
      download?.beginning_network_subtype || upload?.beginning_network_subtype || latency?.beginning_network_subtype,
    ),
    fccServerName: cleanText(download?.targets || upload?.targets || latency?.targets),
    fccServerLocation: null,
    fccLat: cleanNumber(download?.beginning_latitude ?? upload?.beginning_latitude ?? latency?.beginning_latitude),
    fccLon: cleanNumber(download?.beginning_longitude ?? upload?.beginning_longitude ?? latency?.beginning_longitude),
    fccGpsAccuracy: cleanNumber(
      download?.beginning_horizontal_accuracy
      ?? upload?.beginning_horizontal_accuracy
      ?? latency?.beginning_horizontal_accuracy,
    ),
    phaseSuccess: {
      latency: parseBoolFlag(latency?.success_flag),
      download: parseBoolFlag(download?.success_flag),
      upload: parseBoolFlag(upload?.success_flag),
    },
    warmup: {
      dlWarmupDurationSec: microToSec(download?.warmup_duration),
      dlWarmupBytes: cleanNumber(download?.warmup_bytes_transferred),
      ulWarmupDurationSec: microToSec(upload?.warmup_duration),
      ulWarmupBytes: cleanNumber(upload?.warmup_bytes_transferred),
    },
    measured: {
      dlDurationSec: microToSec(download?.duration),
      dlBytesTransferred: cleanNumber(download?.bytes_transferred),
      ulDurationSec: microToSec(upload?.duration),
      ulBytesTransferred: cleanNumber(upload?.bytes_transferred),
      dlBytesSec: cleanNumber(download?.bytes_sec),
      ulBytesSec: cleanNumber(upload?.bytes_sec),
    },
    appVersion: cleanText(any.app_version),
    deviceModel: cleanText(any.model),
    operatingSystem: cleanText(any.operating_system),
    cycleDate: cleanText(any.cycle_date),
    rawRowRef: {
      sourceFile: sourceFiles[0] || sourceFile,
      sourceFiles,
      sourceRowNumbers,
      phasesPresent,
      phaseTimestampDetails,
    },
    include: false,
    manualInclude: false,
    addedToIterations: false,
    status: "parsed",
    insideBabyDragonTimeWindow: "unknown",
    hasValidTimestamp: Number.isFinite(testStartMs) && Number.isFinite(testEndMs),
  };
}

export function parseFccMainCsv(csvText = "", {
  sourceFile = "FCC-Mobile-Speed-Test.csv",
  sessionStartMs = null,
  sessionEndMs = null,
  bufferSeconds = FCC_DEFAULT_BUFFER_SECONDS,
} = {}) {
  const warnings = [];
  const table = parseCsvText(csvText);
  if (table.length < 2) {
    return {
      ok: false,
      errors: ["FCC main CSV is empty or missing data rows."],
      warnings,
      phaseRows: [],
      rows: [],
      stats: emptyStats(),
    };
  }

  const headers = table[0].map((header) => String(header || "").trim());
  const required = ["test_id", "tests", "test_time", "bytes_sec", "connection_type"];
  const missing = required.filter((name) => !headers.includes(name));
  if (missing.length) {
    warnings.push(`Missing expected columns: ${missing.join(", ")}`);
  }
  if (!headers.includes("round_trip_time(micro second)")) {
    warnings.push("Missing round_trip_time(micro second) column.");
  }

  const phaseRows = [];
  for (let i = 1; i < table.length; i += 1) {
    const obj = rowObject(headers, table[i], i + 1);
    obj.__sourceFile = sourceFile;
    const stamps = collectTimestampCandidates(obj);
    obj.__originalTimestamp = stamps[0]?.original || cleanText(obj.test_time);
    obj.__timestampMs = stamps[0]?.ms ?? toEpochMs(obj.test_time);
    phaseRows.push(obj);
  }

  const groups = new Map();
  phaseRows.forEach((row) => {
    const testId = cleanText(row.test_id) || `row-${row.__sourceRowNumber}`;
    if (!groups.has(testId)) groups.set(testId, []);
    groups.get(testId).push(row);
  });

  const rows = [...groups.entries()].map(([testId, group]) => {
    const collapsed = collapsePhaseGroup(testId, group, sourceFile);
    const windowStatus = classifyFccTimeWindow(collapsed, sessionStartMs, sessionEndMs, bufferSeconds);
    const autoSelect = windowStatus === "yes";
    return {
      ...collapsed,
      insideBabyDragonTimeWindow: windowStatus,
      include: autoSelect,
      manualInclude: false,
      status: autoSelect ? "selected" : (windowStatus === "no" ? "outside_window" : (windowStatus === "unknown" ? "no_timestamp" : "parsed")),
      dedupeKey: buildFccDedupeKey(collapsed),
    };
  });

  rows.sort((a, b) => {
    const aMs = cleanNumber(a.testStartMs) ?? cleanNumber(a.fccTestAtMs) ?? 0;
    const bMs = cleanNumber(b.testStartMs) ?? cleanNumber(b.fccTestAtMs) ?? 0;
    return aMs - bMs;
  });

  return {
    ok: true,
    errors: [],
    warnings,
    headers,
    phaseRows,
    rows,
    stats: buildStats(rows, phaseRows, sessionStartMs, sessionEndMs, bufferSeconds),
  };
}

function emptyStats() {
  return {
    phaseRowCount: 0,
    collapsedTestCount: 0,
    wifiCount: 0,
    cellCount: 0,
    nullConnectionCount: 0,
    insideWindowCount: 0,
    outsideWindowCount: 0,
    unknownWindowCount: 0,
    selectedCount: 0,
    duplicateSkippedCount: 0,
    savedCount: 0,
    testsWithoutTimestamp: 0,
    phaseRowsWithoutTimestamp: 0,
    phaseRowsInsideWindow: 0,
    wifiTestsInsideWindow: 0,
    cellTestsInsideWindow: 0,
  };
}

function countPhaseRowsInsideWindow(phaseRows = [], sessionStartMs = null, sessionEndMs = null, bufferSeconds = FCC_DEFAULT_BUFFER_SECONDS) {
  let inside = 0;
  let missing = 0;
  phaseRows.forEach((row) => {
    const ms = cleanNumber(row.__timestampMs) ?? toEpochMs(row.test_time || row.cell_network_time);
    if (!Number.isFinite(ms)) {
      missing += 1;
      return;
    }
    if (isInsideFccTimeWindow(ms, sessionStartMs, sessionEndMs, bufferSeconds) === true) inside += 1;
  });
  return { inside, missing };
}

function buildStats(rows = [], phaseRows = [], sessionStartMs = null, sessionEndMs = null, bufferSeconds = FCC_DEFAULT_BUFFER_SECONDS) {
  const wifiCount = rows.filter((row) => row.fccConnectionType === "WIFI").length;
  const cellCount = rows.filter((row) => row.fccConnectionType === "CELL").length;
  const nullConnectionCount = rows.filter((row) => !row.fccConnectionType).length;
  const insideRows = rows.filter((row) => row.insideBabyDragonTimeWindow === "yes");
  const phaseWindow = countPhaseRowsInsideWindow(phaseRows, sessionStartMs, sessionEndMs, bufferSeconds);
  return {
    phaseRowCount: phaseRows.length,
    collapsedTestCount: rows.length,
    wifiCount,
    cellCount,
    nullConnectionCount,
    insideWindowCount: insideRows.length,
    outsideWindowCount: rows.filter((row) => row.insideBabyDragonTimeWindow === "no").length,
    unknownWindowCount: rows.filter((row) => row.insideBabyDragonTimeWindow === "unknown").length,
    selectedCount: rows.filter((row) => row.include).length,
    duplicateSkippedCount: 0,
    savedCount: rows.filter((row) => row.addedToIterations).length,
    testsWithoutTimestamp: rows.filter((row) => row.hasValidTimestamp === false || row.insideBabyDragonTimeWindow === "unknown").length,
    phaseRowsWithoutTimestamp: phaseWindow.missing,
    phaseRowsInsideWindow: phaseWindow.inside,
    wifiTestsInsideWindow: insideRows.filter((row) => row.fccConnectionType === "WIFI").length,
    cellTestsInsideWindow: insideRows.filter((row) => row.fccConnectionType === "CELL").length,
  };
}

export function buildFccTruncationSummaries({
  rows = [],
  phaseRows = [],
  filesDetected = [],
  sessionStartMs = null,
  sessionEndMs = null,
  bufferSeconds = FCC_DEFAULT_BUFFER_SECONDS,
  savedIterations = [],
  sourceFileSummaries = [],
} = {}) {
  const stats = buildStats(rows, phaseRows, sessionStartMs, sessionEndMs, bufferSeconds);
  const { windowStartMs, windowEndMs } = resolveFccWindowBounds(sessionStartMs, sessionEndMs, bufferSeconds);
  const toIso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
  const saved = Array.isArray(savedIterations) ? savedIterations : [];

  return {
    originalSourceSummary: {
      sourceFileCount: (filesDetected || []).length,
      phaseRowsTotal: stats.phaseRowCount,
      collapsedTestsTotal: stats.collapsedTestCount,
      wifiTestsTotal: stats.wifiCount,
      cellTestsTotal: stats.cellCount,
      sourceFiles: filesDetected || [],
      perFile: sourceFileSummaries,
    },
    sessionWindowSummary: {
      bufferSec: Math.max(0, Number(bufferSeconds) || 0),
      sessionStartIso: toIso(sessionStartMs),
      sessionEndIso: toIso(sessionEndMs),
      windowStartIso: toIso(windowStartMs),
      windowEndIso: toIso(windowEndMs),
      phaseRowsInsideWindow: stats.phaseRowsInsideWindow,
      collapsedTestsInsideWindow: stats.insideWindowCount,
      wifiTestsInsideWindow: stats.wifiTestsInsideWindow,
      cellTestsInsideWindow: stats.cellTestsInsideWindow,
      rowsWithoutTimestamp: stats.phaseRowsWithoutTimestamp,
      testsWithoutTimestamp: stats.testsWithoutTimestamp,
    },
    savedEvidenceSummary: {
      savedFccIterations: saved.length,
      savedWifi: saved.filter((item) => String(item?.fccConnectionType || "").toUpperCase() === "WIFI").length,
      savedCell: saved.filter((item) => String(item?.fccConnectionType || "").toUpperCase() === "CELL").length,
    },
  };
}

export function reapplyFccTimeWindow(importState, {
  sessionStartMs = null,
  sessionEndMs = null,
  bufferSeconds = FCC_DEFAULT_BUFFER_SECONDS,
  preserveManualIncludes = true,
  savedIterations = null,
} = {}) {
  if (!importState) return null;
  const rows = (importState.rows || []).map((row) => {
    if (row.addedToIterations) {
      return {
        ...row,
        insideBabyDragonTimeWindow: classifyFccTimeWindow(row, sessionStartMs, sessionEndMs, bufferSeconds),
      };
    }
    const windowStatus = classifyFccTimeWindow(row, sessionStartMs, sessionEndMs, bufferSeconds);
    let include = false;
    if (windowStatus === "yes") {
      if (preserveManualIncludes && row.manualInclude) include = Boolean(row.include);
      else include = true;
    } else {
      // Outside / unknown: never keep default selection.
      include = false;
    }
    return {
      ...row,
      insideBabyDragonTimeWindow: windowStatus,
      include,
      status: include
        ? "selected"
        : (windowStatus === "no" ? "outside_window" : (windowStatus === "unknown" ? "no_timestamp" : row.status || "parsed")),
    };
  });

  const stats = {
    ...buildStats(rows, importState.phaseRows || [], sessionStartMs, sessionEndMs, bufferSeconds),
    duplicateSkippedCount: importState.stats?.duplicateSkippedCount ?? 0,
  };
  const summaries = buildFccTruncationSummaries({
    rows,
    phaseRows: importState.phaseRows || [],
    filesDetected: importState.filesDetected || [],
    sessionStartMs,
    sessionEndMs,
    bufferSeconds,
    savedIterations: savedIterations || rows.filter((row) => row.addedToIterations),
    sourceFileSummaries: importState.sourceFileSummaries || [],
  });

  return {
    ...importState,
    sessionStartMs,
    sessionEndMs,
    bufferSeconds,
    timestampBufferSeconds: bufferSeconds,
    rows,
    stats,
    ...summaries,
  };
}

export function finalizeFccTimeWindowOnExport({
  iterations = [],
  fccImport = null,
  sessionStartMs = null,
  sessionEndMs = null,
  bufferSeconds = null,
} = {}) {
  const buffer = Number.isFinite(Number(bufferSeconds))
    ? Number(bufferSeconds)
    : (Number.isFinite(Number(fccImport?.timestampBufferSeconds ?? fccImport?.bufferSeconds))
      ? Number(fccImport.timestampBufferSeconds ?? fccImport.bufferSeconds)
      : FCC_DEFAULT_BUFFER_SECONDS);
  const startMs = toEpochMs(sessionStartMs) ?? toEpochMs(fccImport?.sessionStartMs) ?? null;
  const endMs = toEpochMs(sessionEndMs) ?? toEpochMs(fccImport?.sessionEndMs) ?? null;

  const nextIterations = (iterations || []).map((item) => {
    const windowStatus = classifyFccTimeWindow(item, startMs, endMs, buffer);
    return {
      ...item,
      insideBabyDragonTimeWindow: windowStatus,
    };
  });

  let nextImport = fccImport;
  if (fccImport?.rows) {
    nextImport = reapplyFccTimeWindow(fccImport, {
      sessionStartMs: startMs,
      sessionEndMs: endMs,
      bufferSeconds: buffer,
      preserveManualIncludes: true,
      savedIterations: nextIterations,
    });
  } else if (fccImport) {
    const summaries = buildFccTruncationSummaries({
      rows: [],
      phaseRows: fccImport.phaseRows || [],
      filesDetected: fccImport.filesDetected || [],
      sessionStartMs: startMs,
      sessionEndMs: endMs,
      bufferSeconds: buffer,
      savedIterations: nextIterations,
      sourceFileSummaries: fccImport.sourceFileSummaries || [],
    });
    nextImport = {
      ...fccImport,
      sessionStartMs: startMs,
      sessionEndMs: endMs,
      timestampBufferSeconds: buffer,
      bufferSeconds: buffer,
      ...summaries,
    };
  }

  return {
    iterations: nextIterations,
    fccImport: nextImport,
    sessionStartMs: startMs,
    sessionEndMs: endMs,
    bufferSeconds: buffer,
  };
}

function summarizeTimestampedRows(rows = [], sessionStartMs = null, sessionEndMs = null, bufferSeconds = FCC_DEFAULT_BUFFER_SECONDS) {
  let total = rows.length;
  let inside = 0;
  let missing = 0;
  rows.forEach((row) => {
    const ms = cleanNumber(row.__timestampMs);
    if (!Number.isFinite(ms)) {
      missing += 1;
      return;
    }
    if (isInsideFccTimeWindow(ms, sessionStartMs, sessionEndMs, bufferSeconds) === true) inside += 1;
  });
  return { total, inside, missing };
}

async function parseFccTraceCsvForWindow(csvText = "", sourceFile = "", sessionStartMs = null, sessionEndMs = null, bufferSeconds = FCC_DEFAULT_BUFFER_SECONDS) {
  const table = parseCsvText(csvText);
  if (table.length < 2) {
    return { sourceFile, role: "trace_csv", rowCount: 0, rowsInsideWindow: 0, rowsWithoutTimestamp: 0, uniqueTestIds: [] };
  }
  const headers = table[0].map((header) => String(header || "").trim());
  const rows = [];
  const testIds = new Set();
  for (let i = 1; i < table.length; i += 1) {
    const obj = rowObject(headers, table[i], i + 1);
    obj.__sourceFile = sourceFile;
    const stamps = collectTimestampCandidates({
      ...obj,
      cell_network_time: obj.cell_network_time,
      test_time: obj.cell_network_time,
    });
    obj.__originalTimestamp = stamps[0]?.original || cleanText(obj.cell_network_time);
    obj.__timestampMs = stamps[0]?.ms ?? toEpochMs(obj.cell_network_time);
    const testId = cleanText(obj.test_id);
    if (testId) testIds.add(testId);
    rows.push(obj);
  }
  const summary = summarizeTimestampedRows(rows, sessionStartMs, sessionEndMs, bufferSeconds);
  return {
    sourceFile,
    role: "trace_csv",
    rowCount: summary.total,
    rowsInsideWindow: summary.inside,
    rowsWithoutTimestamp: summary.missing,
    uniqueTestIds: [...testIds],
    truncated: true,
  };
}

async function parseFccJsonForWindow(jsonText = "", sourceFile = "", sessionStartMs = null, sessionEndMs = null, bufferSeconds = FCC_DEFAULT_BUFFER_SECONDS) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { sourceFile, role: "json", rowCount: 0, rowsInsideWindow: 0, rowsWithoutTimestamp: 0, uniqueTestIds: [], parseError: true };
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const rows = [];
  const testIds = new Set();
  items.forEach((item) => {
    (item?.submissions || []).forEach((submission) => {
      const testId = cleanText(submission?.test_id);
      if (testId) testIds.add(testId);
      const tests = submission?.tests || {};
      ["latency", "download", "upload"].forEach((phase) => {
        const block = tests[phase];
        if (!block || typeof block !== "object") return;
        const original = cleanText(block.timestamp) || cleanText(submission.device_timestamp);
        const ms = toEpochMs(original);
        rows.push({
          __sourceFile: sourceFile,
          __originalTimestamp: original,
          __timestampMs: ms,
          test_id: testId,
          tests: phase.toUpperCase(),
        });
      });
    });
  });
  const summary = summarizeTimestampedRows(rows, sessionStartMs, sessionEndMs, bufferSeconds);
  return {
    sourceFile,
    role: "json",
    rowCount: summary.total,
    rowsInsideWindow: summary.inside,
    rowsWithoutTimestamp: summary.missing,
    uniqueTestIds: [...testIds],
    truncated: true,
  };
}

/**
 * Parse FCC ZIP (ArrayBuffer / Uint8Array / Blob-compatible buffer).
 * Applies BabyDragon session-window truncation across all detected source files.
 */
/**
 * Validate a pasted FCC ZIP download URL before native fetch.
 * Rejects empty / non-HTTPS. Soft-warns when path does not look like .zip
 * (native response Content-Type / PK magic still decide acceptance).
 */
export function validateFccZipDownloadUrl(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!url) {
    return { ok: false, error: "empty", message: "Invalid URL: HTTPS FCC ZIP URL required" };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "invalid", message: "Invalid URL: HTTPS FCC ZIP URL required" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, error: "https_required", message: "Invalid URL: HTTPS FCC ZIP URL required" };
  }
  const host = String(parsed.hostname || "").toLowerCase();
  if (!host) {
    return { ok: false, error: "invalid_host", message: "Invalid URL: HTTPS FCC ZIP URL required" };
  }
  const preferredHost = host === "fccapi.mozark.ai" || host.endsWith(".mozark.ai");
  const pathLooksZip = /\.zip($|[?#])/i.test(parsed.pathname || "") || /download-zip/i.test(parsed.pathname || "");
  return {
    ok: true,
    url,
    host,
    preferredHost,
    pathLooksZip,
    warning: pathLooksZip
      ? null
      : "URL does not look like a .zip download; continuing if the server returns a ZIP.",
  };
}

export function base64ToArrayBuffer(base64) {
  const text = String(base64 || "");
  if (typeof atob === "function") {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }
  // Node smoke / SSR fallback
  const buf = Buffer.from(text, "base64");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

export async function parseFccExportZip(zipInput, {
  fileName = "fcc-export.zip",
  sessionStartMs = null,
  sessionEndMs = null,
  bufferSeconds = FCC_DEFAULT_BUFFER_SECONDS,
  importMode = "manual_zip",
  sourceType = null,
  sourceUrl = null,
  downloadedFilename = null,
  downloadedSizeBytes = null,
  downloadedAtIso = null,
  contentType = null,
  statusCode = null,
} = {}) {
  const warnings = [];
  const errors = [];
  let zip;
  try {
    zip = await JSZip.loadAsync(zipInput);
  } catch (error) {
    return {
      ok: false,
      errors: [`Unable to open FCC ZIP: ${String(error?.message || error || "unknown error")}`],
      warnings,
      rows: [],
      stats: emptyStats(),
      filesDetected: [],
    };
  }

  const filesDetected = Object.keys(zip.files || {})
    .filter((name) => !zip.files[name].dir)
    .map((name) => name.replace(/^.*\//, ""));

  const mainCsvName = filesDetected.find((name) => MAIN_CSV_RE.test(name) && !TRACE_CSV_RE.test(name)) || null;
  const traceCsvName = filesDetected.find((name) => TRACE_CSV_RE.test(name)) || null;
  const jsonName = filesDetected.find((name) => MAIN_JSON_RE.test(name)) || null;
  const sourceFileSummaries = [];

  if (!mainCsvName) {
    return {
      ok: false,
      errors: ["FCC ZIP is missing main CSV (FCC-Mobile-Speed-Test-ANDROID-*.csv)."],
      warnings,
      rows: [],
      stats: emptyStats(),
      filesDetected,
      mainCsvName: null,
      traceCsvDetected: Boolean(traceCsvName),
      jsonDetected: Boolean(jsonName),
      packageId: extractPackageId(fileName),
      fileName,
    };
  }

  const mainEntry = zip.file(mainCsvName)
    || Object.values(zip.files).find((entry) => !entry.dir && entry.name.endsWith(mainCsvName));
  if (!mainEntry) {
    return {
      ok: false,
      errors: [`Unable to read main CSV entry: ${mainCsvName}`],
      warnings,
      rows: [],
      stats: emptyStats(),
      filesDetected,
      mainCsvName,
      traceCsvDetected: Boolean(traceCsvName),
      jsonDetected: Boolean(jsonName),
      packageId: extractPackageId(fileName),
      fileName,
    };
  }

  const csvText = await mainEntry.async("string");
  const parsed = parseFccMainCsv(csvText, {
    sourceFile: mainCsvName,
    sessionStartMs,
    sessionEndMs,
    bufferSeconds,
  });

  sourceFileSummaries.push({
    sourceFile: mainCsvName,
    role: "main_csv",
    rowCount: (parsed.phaseRows || []).length,
    rowsInsideWindow: parsed.stats?.phaseRowsInsideWindow ?? 0,
    rowsWithoutTimestamp: parsed.stats?.phaseRowsWithoutTimestamp ?? 0,
    collapsedTests: (parsed.rows || []).length,
    collapsedTestsInsideWindow: parsed.stats?.insideWindowCount ?? 0,
    truncated: true,
    kpiSource: true,
  });

  if (traceCsvName) {
    try {
      const traceEntry = zip.file(traceCsvName)
        || Object.values(zip.files).find((entry) => !entry.dir && entry.name.endsWith(traceCsvName));
      if (traceEntry) {
        const traceText = await traceEntry.async("string");
        const traceSummary = await parseFccTraceCsvForWindow(
          traceText,
          traceCsvName,
          sessionStartMs,
          sessionEndMs,
          bufferSeconds,
        );
        sourceFileSummaries.push(traceSummary);
        warnings.push(`Trace CSV truncated by BabyDragon session window (${traceSummary.rowsInsideWindow}/${traceSummary.rowCount} rows inside). KPI evidence still uses main CSV.`);
      }
    } catch (error) {
      warnings.push(`Trace CSV window scan failed: ${String(error?.message || error)}`);
    }
  }

  if (jsonName) {
    try {
      const jsonEntry = zip.file(jsonName)
        || Object.values(zip.files).find((entry) => !entry.dir && entry.name.endsWith(jsonName));
      if (jsonEntry) {
        const jsonText = await jsonEntry.async("string");
        const jsonSummary = await parseFccJsonForWindow(
          jsonText,
          jsonName,
          sessionStartMs,
          sessionEndMs,
          bufferSeconds,
        );
        sourceFileSummaries.push(jsonSummary);
        warnings.push(`JSON truncated by BabyDragon session window (${jsonSummary.rowsInsideWindow}/${jsonSummary.rowCount} phase stamps inside). KPI evidence still uses main CSV.`);
      }
    } catch (error) {
      warnings.push(`JSON window scan failed: ${String(error?.message || error)}`);
    }
  }

  const summaries = buildFccTruncationSummaries({
    rows: parsed.rows || [],
    phaseRows: parsed.phaseRows || [],
    filesDetected,
    sessionStartMs,
    sessionEndMs,
    bufferSeconds,
    savedIterations: [],
    sourceFileSummaries,
  });

  const resolvedImportMode = importMode === "url_zip" ? "url_zip" : "manual_zip";
  const resolvedSourceType = sourceType || (resolvedImportMode === "url_zip" ? "url" : "file");

  return {
    ok: parsed.ok,
    errors: [...errors, ...(parsed.errors || [])],
    warnings: [...warnings, ...(parsed.warnings || [])],
    fileName,
    packageId: extractPackageId(fileName),
    sourceType: resolvedSourceType,
    importMode: resolvedImportMode,
    sourceUrl: sourceUrl || null,
    downloadedFilename: downloadedFilename || (resolvedImportMode === "url_zip" ? fileName : null),
    downloadedSizeBytes: Number.isFinite(Number(downloadedSizeBytes)) ? Number(downloadedSizeBytes) : null,
    downloadedAtIso: downloadedAtIso || null,
    contentType: contentType || null,
    statusCode: Number.isFinite(Number(statusCode)) ? Number(statusCode) : null,
    detectedFormat: "zip",
    filesDetected,
    mainCsvName,
    traceCsvName,
    jsonName,
    traceCsvDetected: Boolean(traceCsvName),
    jsonDetected: Boolean(jsonName),
    sourceFileSummaries,
    headers: parsed.headers || [],
    phaseRows: parsed.phaseRows || [],
    rows: parsed.rows || [],
    stats: parsed.stats || emptyStats(),
    ...summaries,
    sessionStartMs,
    sessionEndMs,
    bufferSeconds,
    timestampBufferSeconds: bufferSeconds,
    parseStatus: parsed.ok ? "parsed" : "parse_failed",
    status: parsed.ok ? "parsed" : "parse_failed",
    importedAt: new Date().toISOString(),
    evidenceRule: FCC_EVIDENCE_RULE,
  };
}

export function previewRowToEvidenceIteration(row = {}, {
  iterationNumber = 1,
  matchedContext = null,
  savedAt = null,
} = {}) {
  const nowIso = savedAt || new Date().toISOString();
  return {
    provider: "fcc_app",
    evidenceType: "external_import",
    evidenceSource: "fcc_export_zip_csv",
    iterationNumber,
    confirmation: "imported",
    fccTestId: row.fccTestId ?? null,
    fccDlMbps: row.fccDlMbps ?? null,
    fccUlMbps: row.fccUlMbps ?? null,
    fccPingMs: row.fccPingMs ?? null,
    fccJitterMs: row.fccJitterMs ?? null,
    fccLossPct: row.fccLossPct ?? null,
    fccPacketLossRaw: row.fccPacketLossRaw ?? null,
    fccPacketsSent: row.fccPacketsSent ?? null,
    fccPacketsReceived: row.fccPacketsReceived ?? null,
    fccTestAt: row.fccTestAt ?? null,
    fccTestAtMs: row.fccTestAtMs ?? null,
    testStartMs: row.testStartMs ?? null,
    testEndMs: row.testEndMs ?? null,
    fccTestStartAt: row.fccTestStartAt ?? null,
    fccTestEndAt: row.fccTestEndAt ?? null,
    fccDownloadTestAt: row.fccDownloadTestAt ?? null,
    fccUploadTestAt: row.fccUploadTestAt ?? null,
    fccLatencyTestAt: row.fccLatencyTestAt ?? null,
    fccCarrier: row.fccCarrier ?? null,
    fccConnectionType: row.fccConnectionType ?? null,
    fccNetworkType: row.fccNetworkType ?? null,
    fccServerName: row.fccServerName ?? null,
    fccServerLocation: null,
    fccLat: row.fccLat ?? null,
    fccLon: row.fccLon ?? null,
    fccGpsAccuracy: row.fccGpsAccuracy ?? null,
    phaseSuccess: row.phaseSuccess || { latency: null, download: null, upload: null },
    warmup: row.warmup || {},
    measured: row.measured || {},
    appVersion: row.appVersion ?? null,
    deviceModel: row.deviceModel ?? null,
    operatingSystem: row.operatingSystem ?? null,
    cycleDate: row.cycleDate ?? null,
    rawRowRef: row.rawRowRef || null,
    insideBabyDragonTimeWindow: row.insideBabyDragonTimeWindow ?? "unknown",
    matchedContext: matchedContext || null,
    dedupeKey: row.dedupeKey || buildFccDedupeKey(row),
    capturedAt: row.fccTestAt || nowIso,
    savedAt: nowIso,
  };
}

export function buildFccImportDebugPayload(importState = null) {
  if (!importState) return null;
  const summaries = importState.originalSourceSummary
    ? {
      originalSourceSummary: importState.originalSourceSummary,
      sessionWindowSummary: importState.sessionWindowSummary,
      savedEvidenceSummary: importState.savedEvidenceSummary,
    }
    : buildFccTruncationSummaries({
      rows: importState.rows || [],
      phaseRows: importState.phaseRows || [],
      filesDetected: importState.filesDetected || [],
      sessionStartMs: importState.sessionStartMs,
      sessionEndMs: importState.sessionEndMs,
      bufferSeconds: importState.timestampBufferSeconds ?? importState.bufferSeconds ?? FCC_DEFAULT_BUFFER_SECONDS,
      savedIterations: (importState.rows || []).filter((row) => row.addedToIterations),
      sourceFileSummaries: importState.sourceFileSummaries || [],
    });

  const importMode = importState.importMode === "url_zip" ? "url_zip" : (importState.sourceType === "url" ? "url_zip" : "manual_zip");
  return {
    status: importState.status || importState.parseStatus || "not_imported",
    parseStatus: importState.parseStatus || importState.status || null,
    sourceType: importState.sourceType || (importMode === "url_zip" ? "url" : "file"),
    importMode,
    sourceUrl: importState.sourceUrl || null,
    downloadedFilename: importState.downloadedFilename || null,
    downloadedSizeBytes: Number.isFinite(Number(importState.downloadedSizeBytes))
      ? Number(importState.downloadedSizeBytes)
      : null,
    downloadedAtIso: importState.downloadedAtIso || null,
    contentType: importState.contentType || null,
    statusCode: Number.isFinite(Number(importState.statusCode)) ? Number(importState.statusCode) : null,
    fileName: importState.fileName || null,
    packageId: importState.packageId || null,
    detectedFormat: importState.detectedFormat || "zip",
    filesDetected: importState.filesDetected || [],
    mainCsvName: importState.mainCsvName || null,
    traceCsvDetected: Boolean(importState.traceCsvDetected),
    jsonDetected: Boolean(importState.jsonDetected),
    sourceFileSummaries: importState.sourceFileSummaries || [],
    phaseRowCount: importState.stats?.phaseRowCount ?? summaries.originalSourceSummary?.phaseRowsTotal ?? null,
    collapsedTestCount: importState.stats?.collapsedTestCount ?? summaries.originalSourceSummary?.collapsedTestsTotal ?? null,
    wifiCount: importState.stats?.wifiCount ?? summaries.originalSourceSummary?.wifiTestsTotal ?? null,
    cellCount: importState.stats?.cellCount ?? summaries.originalSourceSummary?.cellTestsTotal ?? null,
    nullConnectionCount: importState.stats?.nullConnectionCount ?? null,
    duplicateSkippedCount: importState.stats?.duplicateSkippedCount ?? 0,
    selectedCount: importState.stats?.selectedCount ?? null,
    savedCount: importState.stats?.savedCount ?? summaries.savedEvidenceSummary?.savedFccIterations ?? null,
    insideWindowCount: importState.stats?.insideWindowCount ?? summaries.sessionWindowSummary?.collapsedTestsInsideWindow ?? null,
    sessionStartMs: importState.sessionStartMs ?? null,
    sessionEndMs: importState.sessionEndMs ?? null,
    timestampBufferSeconds: importState.timestampBufferSeconds ?? importState.bufferSeconds ?? FCC_DEFAULT_BUFFER_SECONDS,
    bufferSeconds: importState.bufferSeconds ?? FCC_DEFAULT_BUFFER_SECONDS,
    warnings: importState.warnings || [],
    errors: importState.errors || [],
    evidenceRule: FCC_EVIDENCE_RULE,
    importedAt: importState.importedAt || null,
    rows: importState.rows || [],
    phaseRows: importState.phaseRows || [],
    stats: importState.stats || emptyStats(),
    ...summaries,
  };
}

export function resolveFccIterations(session = {}) {
  if (Array.isArray(session.appFccEvidenceIterations) && session.appFccEvidenceIterations.length) {
    return session.appFccEvidenceIterations;
  }
  return [];
}
