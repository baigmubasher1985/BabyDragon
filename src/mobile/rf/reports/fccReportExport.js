export const FCC_REPORT_VERSION = "1.1.3-fcc-context";

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

export function isFccSession(session = {}) {
  if (session.appTestType === "fcc_app") return true;
  if (session.appExternalEvidenceProvider === "fcc_app") return true;
  if (session.appFccGeneratedEvidence?.provider === "fcc_app") return true;
  return false;
}

export function mapFccExportStatus(session = {}) {
  const status = String(session?.appExportStatus || session?.appTestStatus || "").toLowerCase();
  if (status === "saved" || status === "evidence_saved") return "saved";
  if (status === "partial" || status === "evidence_partial") return "partial";
  if (session?.sampleCount > 0) return "saved";
  return "draft";
}

const FCC_IMPORT_RULE = "Actual FCC App export import/truncate requires FCC export file sample and is handled in the FCC import step.";

export function buildFccGeneratedEvidenceSnapshot(session = {}, taskHelpers = {}) {
  const getTaskLabel = taskHelpers.getTaskLabel || (() => "Active field task");
  const getTaskGrid = taskHelpers.getTaskGrid || (() => "Grid pending");
  const activeTask = taskHelpers.activeTask || null;
  const stats = session?.stats || {};
  const recordingSummary = session?.recordingStateSummary || {};
  const trafficStatsDl = stats?.trafficStatsDl || {};
  const trafficStatsUl = stats?.trafficStatsUl || {};

  return {
    provider: "fcc_app",
    source: "fcc_app_context_v1h3",
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
    importStatus: "not_imported",
    importRule: FCC_IMPORT_RULE,
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

export function buildFccEvidenceCsv(model = {}) {
  const evidence = model.generatedEvidence || {};
  const fccImport = model.fccImport || {};
  const headers = [
    "Evidence Source",
    "Test Type",
    "Task",
    "Grid",
    "Session ID",
    "Report Log Name",
    "Session Started",
    "Session Ended",
    "RF Sample Count",
    "GPS Points",
    "RAT",
    "Avg LTE RSRP dBm",
    "Avg NR SS-RSRP dBm",
    "TrafficStats Avg DL Mbps",
    "TrafficStats Avg UL Mbps",
    "TrafficStats Supported",
    "Import Status",
    "Import Rule",
    "Import File Name",
    "Import MIME Type",
    "Import Size Bytes",
    "Import Detected Format",
    "Import Parse Status",
    "Truncate Status",
    "Timestamp Buffer Sec",
    "Raw Preview Available",
    "Generated At",
  ];
  const row = {
    "Evidence Source": "BabyDragon FCC Context",
    "Test Type": "FCC App Session Context",
    Task: evidence.taskLabel || model.task || "",
    Grid: evidence.grid || model.grid || "",
    "Session ID": evidence.sessionId || model.sessionId || "",
    "Report Log Name": evidence.reportLogName || model.reportLogName || "",
    "Session Started": formatLocalDateTime(evidence.startedAt || model.sessionStartedAt),
    "Session Ended": formatLocalDateTime(evidence.endedAt || model.sessionEndedAt),
    "RF Sample Count": evidence.sampleCount ?? "",
    "GPS Points": evidence.gpsCount ?? "",
    RAT: evidence.rat || "",
    "Avg LTE RSRP dBm": evidence.rfSummary?.avgLteRsrp ?? "",
    "Avg NR SS-RSRP dBm": evidence.rfSummary?.avgNrRsrp ?? "",
    "TrafficStats Avg DL Mbps": evidence.trafficStats?.avgDlMbps ?? "",
    "TrafficStats Avg UL Mbps": evidence.trafficStats?.avgUlMbps ?? "",
    "TrafficStats Supported": evidence.trafficStats?.supported ? "yes" : "no",
    "Import Status": fccImport.status || evidence.importStatus || "not_imported",
    "Import Rule": evidence.importRule || FCC_IMPORT_RULE,
    "Import File Name": fccImport.fileName || "",
    "Import MIME Type": fccImport.mimeType || "",
    "Import Size Bytes": fccImport.sizeBytes ?? "",
    "Import Detected Format": fccImport.detectedFormat || "",
    "Import Parse Status": fccImport.parseStatus || "",
    "Truncate Status": fccImport.truncateStatus || "not_run",
    "Timestamp Buffer Sec": fccImport.timestampBufferSeconds ?? "",
    "Raw Preview Available": fccImport.rawTextPreview ? "yes" : "no",
    "Generated At": formatLocalDateTime(evidence.generatedAt),
  };
  return `\uFEFF[BabyDragon FCC Context Evidence]\n${makeCsvSection(headers, [row])}`;
}

export function buildFccImportMetadataJson(model = {}) {
  const fccImport = model.fccImport || { status: "not_imported", truncate_status: "not_run" };
  return JSON.stringify({
    babyDragonReportVersion: FCC_REPORT_VERSION,
    owner: "MobbiTech Global LLC",
    sessionId: model.sessionId || null,
    reportLogName: jsonText(model.reportLogName),
    generatedAtIso: jsonTimestamp(Date.now()),
    fccImport: {
      status: jsonText(fccImport.status) || "not_imported",
      truncate_status: jsonText(fccImport.truncateStatus || fccImport.truncate_status) || "not_run",
      fileName: jsonText(fccImport.fileName),
      mimeType: jsonText(fccImport.mimeType),
      sizeBytes: jsonNumber(fccImport.sizeBytes),
      importedAtIso: jsonTimestamp(fccImport.importedAt),
      detectedFormat: jsonText(fccImport.detectedFormat),
      parseStatus: jsonText(fccImport.parseStatus),
      rowCount: jsonNumber(fccImport.rowCount),
      truncatedRowCount: jsonNumber(fccImport.truncatedRowCount),
      timestampColumn: jsonText(fccImport.timestampColumn),
      timestampBufferSeconds: jsonNumber(fccImport.timestampBufferSeconds),
      rawTextPreview: jsonText(fccImport.rawTextPreview),
      message: jsonText(fccImport.message),
    },
  }, null, 2);
}

export function buildFccEvidenceJson(model = {}) {
  const evidence = model.generatedEvidence || {};
  return JSON.stringify({
    babyDragonReportVersion: FCC_REPORT_VERSION,
    owner: "MobbiTech Global LLC",
    testType: "FCC App Session Context",
    sessionId: model.sessionId || evidence.sessionId || null,
    generatedAtIso: jsonTimestamp(Date.now()),
    task: jsonText(model.task || evidence.taskLabel),
    grid: jsonText(model.grid || evidence.grid),
    reportLogName: jsonText(model.reportLogName || evidence.reportLogName),
    exportStatus: jsonText(model.exportStatus),
    generatedEvidence: {
      ...evidence,
      startedAtIso: jsonTimestamp(evidence.startedAt),
      endedAtIso: jsonTimestamp(evidence.endedAt),
      generatedAtIso: jsonTimestamp(evidence.generatedAt),
      firstGps: evidence.firstGps || null,
      lastGps: evidence.lastGps || null,
      rfSummary: evidence.rfSummary || null,
      trafficStats: evidence.trafficStats || null,
      pauseSummary: evidence.pauseSummary || null,
      importStatus: evidence.importStatus || "not_imported",
      importRule: evidence.importRule || FCC_IMPORT_RULE,
    },
    fccImport: {
      ...(model.fccImport || { status: "not_imported", truncateStatus: "not_run" }),
      truncate_status: jsonText(model.fccImport?.truncateStatus || model.fccImport?.truncate_status) || "not_run",
      status: jsonText(model.fccImport?.status) || "not_imported",
      importedAtIso: jsonTimestamp(model.fccImport?.importedAt),
      rawPreviewAvailable: Boolean(model.fccImport?.rawTextPreview),
    },
  }, null, 2);
}

export function extractFccReportModel(session = {}, user = {}, taskHelpers = {}) {
  const generatedEvidence = session.appFccGeneratedEvidence
    || buildFccGeneratedEvidenceSnapshot(session, taskHelpers);
  return {
    sessionId: session.id || null,
    feEmail: user?.email || null,
    task: session.taskLabel || taskHelpers.getTaskLabel?.(taskHelpers.activeTask) || "Active field task",
    grid: session.grid || taskHelpers.getTaskGrid?.(taskHelpers.activeTask) || "Grid pending",
    reportLogName: session.reportLogName || null,
    sessionStartedAt: session.startedAt || null,
    sessionEndedAt: session.endedAt || null,
    exportStatus: mapFccExportStatus(session),
    generatedEvidence,
    fccImport: session.appFccImport || { status: "not_imported" },
  };
}

export function buildFccReportFiles({ session, user, activeTask, getTaskLabel, getTaskGrid }) {
  const taskHelpers = { activeTask, getTaskLabel, getTaskGrid };
  const model = extractFccReportModel(session, user, taskHelpers);
  const baseName = buildFccFileBaseName(session, taskHelpers);
  return [
    {
      fileName: `${baseName}_FCC_Evidence.csv`,
      reportLabel: "FCC Context Evidence CSV",
      mimeType: "text/csv",
      content: buildFccEvidenceCsv(model),
    },
    {
      fileName: `${baseName}_FCC_Evidence.json`,
      reportLabel: "FCC Context Evidence JSON",
      mimeType: "application/json",
      content: buildFccEvidenceJson(model),
    },
    {
      fileName: `${baseName}_FCC_Import_Metadata.json`,
      reportLabel: "FCC Import Metadata JSON",
      mimeType: "application/json",
      content: buildFccImportMetadataJson(model),
    },
  ];
}
