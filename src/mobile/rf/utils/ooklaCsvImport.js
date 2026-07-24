/**
 * OOKLA CSV batch import (Step 1H3D).
 * Parses Ookla Speedtest CSV exports and filters by BabyDragon session time window.
 */

export function extractResultIdFromUrl(resultUrl = "") {
  const url = String(resultUrl || "").trim();
  if (!url) return null;
  const match = url.match(/speedtest\.net\/(?:my-)?result\/(?:a\/|s\/)?(\d{6,})/i)
    || url.match(/ookla\.com\/(?:my-)?result\/(?:a\/)?(\d{6,})/i)
    || url.match(/\/(\d{10,})\/?$/);
  return match?.[1] || null;
}

/** Monitor/display: Result ID only (never the full URL). */
export function resolveOoklaDisplayResultId(evidence = {}) {
  const direct = String(evidence?.resultId || "").trim();
  if (direct) return direct;
  const fromUrl = extractResultIdFromUrl(evidence?.resultUrl);
  return fromUrl || null;
}

function toEpochMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function isCsvImportedIteration(item = {}) {
  const src = String(item?.evidenceSource || item?.source || "");
  return src.includes("csv") || Boolean(item?.csvImportMeta);
}

function resolveIterationOoklaDateMs(item = {}) {
  if (Number.isFinite(item?.ooklaDateTimeMs)) return item.ooklaDateTimeMs;
  if (Number.isFinite(item?.csvImportMeta?.ooklaDateTimeMs)) return item.csvImportMeta.ooklaDateTimeMs;
  const parsed = parseOoklaCsvDateLocal(item?.ooklaDateTime || item?.testDateTime || "");
  return parsed.ms;
}

/**
 * Classify CSV row vs final BabyDragon session window for export.
 * Returns "yes" | "no" | "unknown" (never N/A).
 */
export function classifyOoklaCsvTimeWindow(dateMs, sessionStartMs, sessionEndMs, bufferSeconds = 60) {
  if (!Number.isFinite(dateMs)) return "unknown";
  if (!Number.isFinite(sessionStartMs) || !Number.isFinite(sessionEndMs)) return "unknown";
  const inside = isInsideTimeWindow(dateMs, sessionStartMs, sessionEndMs, bufferSeconds);
  if (inside === null) return "unknown";
  return inside ? "yes" : "no";
}

/**
 * Recalculate CSV time-window flags on export using final session start/end.
 * Does not drop selected iterations. Safe to call when no CSV import exists.
 */
export function finalizeOoklaCsvTimeWindowOnExport({
  iterations = [],
  csvImportDebug = null,
  sessionStartMs = null,
  sessionEndMs = null,
  bufferSeconds = null,
  exportStopMs = null,
} = {}) {
  const startMs = toEpochMs(sessionStartMs)
    ?? toEpochMs(csvImportDebug?.sessionStartTime)
    ?? null;
  const endMs = toEpochMs(sessionEndMs)
    ?? toEpochMs(exportStopMs)
    ?? toEpochMs(csvImportDebug?.sessionEndTime)
    ?? null;
  const buffer = Number.isFinite(Number(bufferSeconds))
    ? Number(bufferSeconds)
    : (Number.isFinite(Number(csvImportDebug?.bufferSeconds))
      ? Number(csvImportDebug.bufferSeconds)
      : 60);

  const sessionStartIso = Number.isFinite(startMs) ? new Date(startMs).toISOString() : null;
  const sessionEndIso = Number.isFinite(endMs) ? new Date(endMs).toISOString() : null;

  const nextIterations = (iterations || []).map((item) => {
    if (!isCsvImportedIteration(item)) return item;
    const dateMs = resolveIterationOoklaDateMs(item);
    const windowStatus = classifyOoklaCsvTimeWindow(dateMs, startMs, endMs, buffer);
    const prevMeta = item.csvImportMeta && typeof item.csvImportMeta === "object" ? item.csvImportMeta : {};
    return {
      ...item,
      insideBabyDragonTimeWindow: windowStatus,
      csvImportMeta: {
        ...prevMeta,
        insideBabyDragonTimeWindow: windowStatus,
        bufferSeconds: buffer,
        sessionStartTime: sessionStartIso || prevMeta.sessionStartTime || null,
        sessionEndTime: sessionEndIso || prevMeta.sessionEndTime || null,
        ooklaDateTimeMs: Number.isFinite(dateMs) ? dateMs : (prevMeta.ooklaDateTimeMs ?? null),
      },
    };
  });

  if (!csvImportDebug) {
    return {
      iterations: nextIterations,
      csvImportDebug: null,
      sessionStartMs: startMs,
      sessionEndMs: endMs,
      bufferSeconds: buffer,
    };
  }

  const rows = (csvImportDebug.rows || []).map((row) => {
    const dateMs = Number.isFinite(row?.ooklaDateTimeMs)
      ? row.ooklaDateTimeMs
      : parseOoklaCsvDateLocal(row?.ooklaDateTime).ms;
    return {
      ...row,
      insideBabyDragonTimeWindow: classifyOoklaCsvTimeWindow(dateMs, startMs, endMs, buffer),
    };
  });

  const insideFromRows = rows.filter((row) => row.insideBabyDragonTimeWindow === "yes").length;
  const outsideFromRows = rows.filter((row) => row.insideBabyDragonTimeWindow === "no").length;
  const unknownFromRows = rows.filter((row) => row.insideBabyDragonTimeWindow === "unknown").length;
  const selectedCsvIters = nextIterations.filter(isCsvImportedIteration);
  const insideFromIters = selectedCsvIters.filter((item) => {
    const value = item.csvImportMeta?.insideBabyDragonTimeWindow ?? item.insideBabyDragonTimeWindow;
    return value === "yes" || value === true;
  }).length;

  const csvRowsImported = csvImportDebug.stats?.imported
    ?? csvImportDebug.csvRowsImported
    ?? (rows.length || null);
  const csvRowsInsideWindow = rows.length ? insideFromRows : insideFromIters;
  const csvRowsSelected = csvImportDebug.stats?.selected
    ?? csvImportDebug.csvRowsSelected
    ?? selectedCsvIters.length;
  const duplicates = csvImportDebug.stats?.duplicates ?? csvImportDebug.duplicates ?? 0;

  const nextDebug = {
    ...csvImportDebug,
    bufferSeconds: buffer,
    sessionStartTime: sessionStartIso,
    sessionEndTime: sessionEndIso,
    sessionStartLocal: Number.isFinite(startMs) ? new Date(startMs).toLocaleString() : null,
    sessionEndLocal: Number.isFinite(endMs) ? new Date(endMs).toLocaleString() : null,
    provisionalEnd: false,
    finalizedOnExport: true,
    rows,
    stats: {
      ...(csvImportDebug.stats || {}),
      imported: csvRowsImported,
      insideWindow: csvRowsInsideWindow,
      outsideWindow: rows.length ? outsideFromRows : (csvImportDebug.stats?.outsideWindow ?? null),
      unknownWindow: rows.length ? unknownFromRows : null,
      selected: csvRowsSelected,
      duplicates,
    },
    csvRowsImported,
    csvRowsInsideWindow,
    csvRowsSelected,
    duplicates,
  };

  return {
    iterations: nextIterations,
    csvImportDebug: nextDebug,
    sessionStartMs: startMs,
    sessionEndMs: endMs,
    bufferSeconds: buffer,
  };
}

export const OOKLA_CSV_COLUMN_MAP = {
  Date: "ooklaDateTime",
  ConnType: "connectionType",
  Lat: "ooklaUserLatitude",
  Lon: "ooklaUserLongitude",
  "Download Speed": "dlMbps",
  "Download Size": "downloadSizeBytes",
  "Upload Speed": "ulMbps",
  "Upload Size": "uploadSizeBytes",
  Latency: "pingMs",
  Jitter: "jitterMs",
  Server: "serverLocation",
  InternalIp: "internalIp",
  ExternalIp: "externalIp",
  URL: "resultUrl",
};

const MAX_SAFE_MBPS = 10000;

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text || null;
}

function cleanNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Number.isNaN(value)) return null;
    return value;
  }
  const text = String(value).trim().replace(/,/g, "");
  if (!text || text === "NaN" || text === "Infinity" || text === "-Infinity") return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
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

/**
 * Parse Ookla CSV Date using local timezone (no silent UTC shift).
 * Supports: M/D/YYYY H:MM[:SS] [AM|PM], ISO-like, YYYY-MM-DD HH:mm:ss
 */
export function parseOoklaCsvDateLocal(value) {
  const text = cleanText(value);
  if (!text) return { ms: null, display: null, warning: "Empty Date" };

  const ampm = text.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i,
  );
  if (ampm) {
    let year = Number(ampm[3]);
    if (year < 100) year += 2000;
    let hour = Number(ampm[4]);
    const minute = Number(ampm[5]);
    const second = Number(ampm[6] || 0);
    const meridian = (ampm[7] || "").toUpperCase();
    if (meridian === "PM" && hour < 12) hour += 12;
    if (meridian === "AM" && hour === 12) hour = 0;
    const date = new Date(year, Number(ampm[1]) - 1, Number(ampm[2]), hour, minute, second);
    if (!Number.isNaN(date.getTime())) {
      return { ms: date.getTime(), display: date.toLocaleString(), warning: null };
    }
  }

  const isoLocal = text.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/,
  );
  if (isoLocal) {
    const date = new Date(
      Number(isoLocal[1]),
      Number(isoLocal[2]) - 1,
      Number(isoLocal[3]),
      Number(isoLocal[4]),
      Number(isoLocal[5]),
      Number(isoLocal[6] || 0),
    );
    if (!Number.isNaN(date.getTime())) {
      return { ms: date.getTime(), display: date.toLocaleString(), warning: null };
    }
  }

  const fallback = Date.parse(text);
  if (!Number.isNaN(fallback)) {
    return {
      ms: fallback,
      display: new Date(fallback).toLocaleString(),
      warning: "Date parsed with browser Date.parse; verify timezone",
    };
  }

  return { ms: null, display: text, warning: `Unrecognized Date format: ${text}` };
}

function normalizeHeader(header = "") {
  return String(header || "").replace(/\uFEFF/g, "").trim();
}

function mapHeaders(headerRow = []) {
  const mapping = {};
  const unknown = [];
  headerRow.forEach((header, index) => {
    const name = normalizeHeader(header);
    if (!name) return;
    const target = OOKLA_CSV_COLUMN_MAP[name];
    if (target) mapping[target] = index;
    else unknown.push(name);
  });
  return { mapping, unknown };
}

function validateSpeed(value, fieldName) {
  const number = cleanNumber(value);
  if (number === null) return { value: null, error: `${fieldName} missing or not a number` };
  if (number < 0) return { value: null, error: `${fieldName} negative` };
  if (number > MAX_SAFE_MBPS) return { value: null, error: `${fieldName} above ${MAX_SAFE_MBPS} Mbps` };
  if (!Number.isFinite(number) || Number.isNaN(number)) return { value: null, error: `${fieldName} invalid` };
  return { value: number, error: null };
}

export function getMissingCsvRequiredFields(row = {}) {
  const missing = [];
  if (row.dlMbps === null || row.dlMbps === undefined || row.dlMbps === "") missing.push("dlMbps");
  if (row.ulMbps === null || row.ulMbps === undefined || row.ulMbps === "") missing.push("ulMbps");
  if (!cleanText(row.resultUrl) && !cleanText(row.resultId)) missing.push("resultIdentity");
  if (!cleanText(row.ooklaDateTime) && !row.ooklaDateTimeMs) missing.push("ooklaDateTime");
  return missing;
}

export function getMissingCsvRecommendedFields(row = {}) {
  const keys = [
    "pingMs",
    "jitterMs",
    "serverLocation",
    "serverName",
    "connectionType",
    "connectionsMode",
    "packetLossPercent",
    "ooklaUserLatitude",
    "ooklaUserLongitude",
    "providerName",
  ];
  return keys.filter((key) => {
    const value = row[key];
    if (value === null || value === undefined) return true;
    return String(value).trim() === "";
  });
}

export function computeCsvRowCompleteness(row = {}) {
  const requiredMissing = getMissingCsvRequiredFields(row);
  const optionalMissing = getMissingCsvRecommendedFields(row);
  // Required-field completeness only for CSV rows (DL/UL + identity + datetime).
  const requiredEvidenceStatus = requiredMissing.length ? "partial" : "complete";
  return {
    evidenceCompleteness: requiredEvidenceStatus,
    requiredEvidenceStatus,
    optionalMissingFields: optionalMissing,
    missingFields: optionalMissing,
  };
}

export function isInsideTimeWindow(dateMs, sessionStartMs, sessionEndMs, bufferSeconds = 60) {
  if (!Number.isFinite(dateMs)) return false;
  if (!Number.isFinite(sessionStartMs) || !Number.isFinite(sessionEndMs)) return null;
  const bufferMs = Math.max(0, Number(bufferSeconds) || 0) * 1000;
  return dateMs >= (sessionStartMs - bufferMs) && dateMs <= (sessionEndMs + bufferMs);
}

function buildFieldSources(row = {}) {
  const sources = {};
  const keys = [
    "dlMbps", "ulMbps", "pingMs", "jitterMs", "ooklaDateTime", "connectionType",
    "ooklaUserLatitude", "ooklaUserLongitude", "serverLocation", "resultUrl", "resultId",
    "downloadSizeBytes", "uploadSizeBytes", "internalIp", "externalIp",
  ];
  keys.forEach((key) => {
    const value = row[key];
    if (value === null || value === undefined || String(value).trim() === "") {
      if (key === "jitterMs") {
        sources[key] = { value: "", source: "missing", confidence: null, reason: "CSV sample has no Jitter column" };
      }
      return;
    }
    sources[key] = {
      value: String(value),
      source: "ookla_csv_import",
      confidence: "high",
      reason: "Imported from OOKLA CSV",
    };
  });
  return sources;
}

/**
 * Parse full OOKLA CSV export text into review rows.
 */
export function parseOoklaCsvImport(csvText = "", {
  fileName = "ookla-export.csv",
  sessionStartMs = null,
  sessionEndMs = null,
  bufferSeconds = 60,
  provisionalEnd = false,
} = {}) {
  const warnings = [];
  const errors = [];
  const importedAt = new Date().toISOString();
  const table = parseCsvText(csvText);

  if (table.length < 2) {
    return {
      ok: false,
      fileName,
      importedAt,
      mapping: {},
      unknownHeaders: [],
      warnings: ["CSV has no data rows"],
      errors: ["CSV parse failed: need header + at least one data row"],
      rows: [],
      sessionStartMs,
      sessionEndMs,
      bufferSeconds,
      provisionalEnd: Boolean(provisionalEnd),
    };
  }

  const { mapping, unknown } = mapHeaders(table[0]);
  if (unknown.length) warnings.push(`Unrecognized columns ignored: ${unknown.join(", ")}`);
  if (mapping.dlMbps == null || mapping.ulMbps == null) {
    errors.push("CSV missing required columns: Download Speed and/or Upload Speed");
  }
  if (mapping.ooklaDateTime == null) warnings.push("CSV missing Date column — time-window filter limited");
  if (mapping.resultUrl == null) warnings.push("CSV missing URL column — Result ID/URL may be incomplete");

  const seenResultIds = new Map();
  const rows = [];

  for (let r = 1; r < table.length; r += 1) {
    const cells = table[r] || [];
    const originalRowNumber = r + 1; // 1-based including header
    const get = (field) => {
      const index = mapping[field];
      if (index == null) return "";
      return cells[index] ?? "";
    };

    const dateRaw = get("ooklaDateTime");
    const dateParsed = parseOoklaCsvDateLocal(dateRaw);
    if (dateParsed.warning) warnings.push(`Row ${originalRowNumber}: ${dateParsed.warning}`);

    const dlCheck = validateSpeed(get("dlMbps"), "Download Speed");
    const ulCheck = validateSpeed(get("ulMbps"), "Upload Speed");
    const ping = cleanNumber(get("pingMs"));
    const jitter = mapping.jitterMs != null ? cleanNumber(get("jitterMs")) : null;
    const resultUrl = cleanText(get("resultUrl"));
    const resultId = resultUrl ? (extractResultIdFromUrl(resultUrl) || null) : null;
    const lat = cleanNumber(get("ooklaUserLatitude"));
    const lon = cleanNumber(get("ooklaUserLongitude"));

    const rowErrors = [];
    if (dlCheck.error) rowErrors.push(dlCheck.error);
    if (ulCheck.error) rowErrors.push(ulCheck.error);

    const row = {
      originalRowNumber,
      include: false,
      ooklaDateTime: dateParsed.display || dateRaw || null,
      ooklaDateTimeRaw: dateRaw || null,
      ooklaDateTimeMs: dateParsed.ms,
      connectionType: cleanText(get("connectionType")),
      ooklaUserLatitude: lat,
      ooklaUserLongitude: lon,
      dlMbps: dlCheck.value,
      ulMbps: ulCheck.value,
      downloadSizeBytes: cleanNumber(get("downloadSizeBytes")),
      uploadSizeBytes: cleanNumber(get("uploadSizeBytes")),
      pingMs: ping,
      jitterMs: jitter,
      serverLocation: cleanText(get("serverLocation")),
      serverName: null,
      internalIp: cleanText(get("internalIp")),
      externalIp: cleanText(get("externalIp")),
      resultUrl,
      resultId,
      parseErrors: rowErrors,
    };

    const requiredMissing = getMissingCsvRequiredFields(row);
    const completeness = computeCsvRowCompleteness(row);
    const inside = isInsideTimeWindow(row.ooklaDateTimeMs, sessionStartMs, sessionEndMs, bufferSeconds);

    let status = "selected";
    let duplicate = false;
    if (row.resultId) {
      if (seenResultIds.has(row.resultId)) {
        duplicate = true;
        status = "duplicate_result_id";
      } else {
        seenResultIds.set(row.resultId, originalRowNumber);
      }
    }
    if (requiredMissing.length || rowErrors.length) {
      status = "missing_required";
    } else if (duplicate) {
      status = "duplicate_result_id";
    } else if (inside === false) {
      status = "outside_window";
    } else if (inside === true) {
      status = "inside_window";
    } else {
      status = "inside_window"; // window unknown — not auto-selected
    }

    const autoSelect = status === "inside_window"
      && Number.isFinite(sessionStartMs)
      && Number.isFinite(sessionEndMs)
      && !duplicate
      && !requiredMissing.length
      && !rowErrors.length;

    rows.push({
      ...row,
      include: autoSelect,
      status: autoSelect ? "selected" : status,
      insideBabyDragonTimeWindow: inside,
      evidenceCompleteness: completeness.evidenceCompleteness,
      missingFields: completeness.missingFields,
      fieldSources: buildFieldSources(row),
      evidenceSource: "ookla_csv_import",
    });
  }

  if (!Number.isFinite(sessionStartMs) || !Number.isFinite(sessionEndMs)) {
    warnings.push("BabyDragon session time window is unavailable. Please manually select matching OOKLA rows.");
  } else if (provisionalEnd) {
    warnings.push("Session end time is provisional (recording still active). Selection will refresh when Stop/Save happens.");
  }

  return {
    ok: errors.length === 0 && rows.length > 0,
    fileName,
    importedAt,
    mapping,
    unknownHeaders: unknown,
    warnings,
    errors,
    rows,
    sessionStartMs,
    sessionEndMs,
    bufferSeconds: Number(bufferSeconds) || 60,
    provisionalEnd: Boolean(provisionalEnd),
    stats: {
      imported: rows.length,
      insideWindow: rows.filter((row) => row.insideBabyDragonTimeWindow === true).length,
      outsideWindow: rows.filter((row) => row.insideBabyDragonTimeWindow === false).length,
      selected: rows.filter((row) => row.include).length,
      missingRequired: rows.filter((row) => row.status === "missing_required").length,
      duplicates: rows.filter((row) => row.status === "duplicate_result_id").length,
    },
  };
}

/** Re-apply time window + auto-select after buffer/session times change. */
export function reapplyOoklaCsvTimeWindow(importState, {
  sessionStartMs = null,
  sessionEndMs = null,
  bufferSeconds = 60,
  provisionalEnd = false,
  preserveManualIncludes = false,
} = {}) {
  if (!importState?.rows?.length) return importState;
  const seen = new Set();
  const rows = importState.rows.map((row) => {
    const inside = isInsideTimeWindow(row.ooklaDateTimeMs, sessionStartMs, sessionEndMs, bufferSeconds);
    const requiredMissing = getMissingCsvRequiredFields(row);
    const rowErrors = Array.isArray(row.parseErrors) ? row.parseErrors : [];
    let duplicate = false;
    if (row.resultId) {
      if (seen.has(row.resultId)) duplicate = true;
      else seen.add(row.resultId);
    }

    let status = "inside_window";
    if (requiredMissing.length || rowErrors.length) status = "missing_required";
    else if (duplicate) status = "duplicate_result_id";
    else if (inside === false) status = "outside_window";
    else if (inside === true) status = "inside_window";

    const autoSelect = status === "inside_window"
      && Number.isFinite(sessionStartMs)
      && Number.isFinite(sessionEndMs)
      && !duplicate
      && !requiredMissing.length
      && !rowErrors.length;

    let include = autoSelect;
    if (preserveManualIncludes && row.manualInclude != null) include = Boolean(row.manualInclude);
    else if (preserveManualIncludes && row.include && status !== "missing_required" && !duplicate) {
      include = true;
    }

    return {
      ...row,
      insideBabyDragonTimeWindow: inside,
      status: include ? "selected" : (status === "inside_window" && !include ? "excluded" : status),
      include,
    };
  });

  const warnings = [...(importState.warnings || [])].filter((item) => (
    !/session time window|provisional/i.test(item)
  ));
  if (!Number.isFinite(sessionStartMs) || !Number.isFinite(sessionEndMs)) {
    warnings.push("BabyDragon session time window is unavailable. Please manually select matching OOKLA rows.");
  } else if (provisionalEnd) {
    warnings.push("Session end time is provisional (recording still active). Selection will refresh when Stop/Save happens.");
  }

  return {
    ...importState,
    sessionStartMs,
    sessionEndMs,
    bufferSeconds: Number(bufferSeconds) || 60,
    provisionalEnd: Boolean(provisionalEnd),
    warnings,
    rows,
    stats: {
      imported: rows.length,
      insideWindow: rows.filter((row) => row.insideBabyDragonTimeWindow === true).length,
      outsideWindow: rows.filter((row) => row.insideBabyDragonTimeWindow === false).length,
      selected: rows.filter((row) => row.include).length,
      missingRequired: rows.filter((row) => row.status === "missing_required").length,
      duplicates: rows.filter((row) => row.status === "duplicate_result_id").length,
    },
  };
}

export function buildOoklaCsvImportDebugPayload(importState = {}) {
  if (!importState?.rows) return null;
  return {
    sourceFileName: importState.fileName || null,
    importedAt: importState.importedAt || null,
    parsedColumnMapping: importState.mapping || {},
    unknownHeaders: importState.unknownHeaders || [],
    parseWarnings: importState.warnings || [],
    parseErrors: importState.errors || [],
    sessionStartTime: Number.isFinite(importState.sessionStartMs)
      ? new Date(importState.sessionStartMs).toISOString()
      : null,
    sessionEndTime: Number.isFinite(importState.sessionEndMs)
      ? new Date(importState.sessionEndMs).toISOString()
      : null,
    sessionStartLocal: Number.isFinite(importState.sessionStartMs)
      ? new Date(importState.sessionStartMs).toLocaleString()
      : null,
    sessionEndLocal: Number.isFinite(importState.sessionEndMs)
      ? new Date(importState.sessionEndMs).toLocaleString()
      : null,
    bufferSeconds: importState.bufferSeconds ?? 60,
    provisionalEnd: Boolean(importState.provisionalEnd),
    stats: importState.stats || {},
    rows: (importState.rows || []).map((row) => ({
      originalRowNumber: row.originalRowNumber,
      include: Boolean(row.include),
      status: row.status,
      insideBabyDragonTimeWindow: row.insideBabyDragonTimeWindow,
      ooklaDateTime: row.ooklaDateTime,
      ooklaDateTimeMs: row.ooklaDateTimeMs,
      dlMbps: row.dlMbps,
      ulMbps: row.ulMbps,
      pingMs: row.pingMs,
      jitterMs: row.jitterMs,
      resultId: row.resultId,
      resultUrl: row.resultUrl,
      parseErrors: row.parseErrors || [],
      missingFields: row.missingFields || [],
    })),
    rejectedRows: (importState.rows || [])
      .filter((row) => row.status === "missing_required" || (row.parseErrors || []).length)
      .map((row) => ({
        originalRowNumber: row.originalRowNumber,
        status: row.status,
        reasons: [...(row.parseErrors || []), ...(row.missingFields || [])],
      })),
  };
}

export function csvRowToEvidenceDraft(row = {}, {
  fileName = "",
  importedAt = "",
  bufferSeconds = 60,
  sessionStartMs = null,
  sessionEndMs = null,
  feConfirmed = false,
} = {}) {
  const completeness = computeCsvRowCompleteness(row);
  return {
    dlMbps: row.dlMbps ?? "",
    ulMbps: row.ulMbps ?? "",
    pingMs: row.pingMs ?? "",
    jitterMs: row.jitterMs ?? "",
    serverName: row.serverName || "",
    serverLocation: row.serverLocation || "",
    providerName: row.providerName || row.connectionType || "",
    resultUrl: row.resultUrl || "",
    resultId: row.resultId || "",
    testDateTime: row.ooklaDateTime || "",
    ooklaDateTime: row.ooklaDateTime || "",
    connectionType: row.connectionType || "",
    deviceName: "",
    connectionsMode: "",
    packetLossPercent: "",
    ooklaUserLatitude: row.ooklaUserLatitude ?? "",
    ooklaUserLongitude: row.ooklaUserLongitude ?? "",
    downloadSizeBytes: row.downloadSizeBytes ?? "",
    uploadSizeBytes: row.uploadSizeBytes ?? "",
    internalIp: row.internalIp || "",
    externalIp: row.externalIp || "",
    notes: "",
    feConfirmed: Boolean(feConfirmed),
    evidenceSource: "ookla_csv_import",
    evidenceCompleteness: completeness.evidenceCompleteness,
    requiredEvidenceStatus: completeness.requiredEvidenceStatus,
    optionalMissingFields: completeness.optionalMissingFields,
    missingFields: completeness.missingFields,
    fieldSources: row.fieldSources || buildFieldSources(row),
    valueSource: "ookla_csv_import",
    csvImportMeta: {
      sourceFileName: fileName || null,
      importedAt: importedAt || new Date().toISOString(),
      originalRowNumber: row.originalRowNumber ?? null,
      insideBabyDragonTimeWindow: row.insideBabyDragonTimeWindow,
      bufferSeconds,
      sessionStartTime: Number.isFinite(sessionStartMs) ? new Date(sessionStartMs).toISOString() : null,
      sessionEndTime: Number.isFinite(sessionEndMs) ? new Date(sessionEndMs).toISOString() : null,
    },
  };
}
