import { buildIperf3CommandFromSetup } from "../../testEngines/iperf3CommandParser";

export const IPERF3_REPORT_VERSION = "1.1.3-iperf3";

const DIRECTION_FILE_PARTS = {
  dl_ul: "DL_UL",
  dl: "DL_only",
  ul: "UL_only",
};

const DIRECTION_LABELS = {
  dl_ul: "DL + UL",
  dl: "DL only",
  ul: "UL only",
};

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

export function mapIperfExportStatus(status) {
  const key = String(status || "").toLowerCase();
  if (key === "complete") return "saved";
  if (key === "stopped") return "cancelled";
  if (key === "partial") return "partial";
  if (key === "error") return "error";
  if (key === "saved" || key === "cancelled") return key;
  return key || "idle";
}

export function isIperf3Session(session = {}) {
  if (session.appTestType === "iperf") return true;
  const rows = Array.isArray(session.appIterationResults) ? session.appIterationResults : [];
  return rows.some((row) => String(row?.source || "").includes("iperf"));
}

function directionFilePart(direction) {
  return DIRECTION_FILE_PARTS[String(direction || "").toLowerCase()] || cleanFilePart(direction, "unknown");
}

function directionLabel(direction) {
  return DIRECTION_LABELS[String(direction || "").toLowerCase()] || String(direction || "N/A");
}

function commandIncludesReverseFlag(command = "") {
  const tokens = String(command || "").trim().split(/\s+/).filter(Boolean);
  return tokens.includes("-R") || tokens.includes("--reverse");
}

function commandIncludesBidirFlag(command = "") {
  const tokens = String(command || "").trim().split(/\s+/).filter(Boolean);
  return tokens.includes("--bidir");
}

export function resolveIperfExportModes(command = "", setup = {}) {
  const commandText = String(command || "").trim();
  if (commandText) {
    return {
      reverseMode: commandIncludesReverseFlag(commandText),
      bidirMode: commandIncludesBidirFlag(commandText),
    };
  }
  return {
    reverseMode: setup.reverseMode === true,
    bidirMode: setup.bidirMode === true,
  };
}

function resolveCommandString(session = {}) {
  if (session.appCommand) return String(session.appCommand).trim();
  const setup = session.appSetupSnapshot || {};
  const customer = String(setup.customerCommand || setup.rawCommand || "").trim();
  if (customer) return customer;
  const rows = Array.isArray(session.appIterationResults) ? session.appIterationResults : [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const command = rows[index]?.command;
    if (Array.isArray(command) && command.length) return command.join(" ");
    if (typeof command === "string" && command.trim()) return command.trim();
  }
  try {
    return buildIperf3CommandFromSetup(setup);
  } catch {
    return "N/A";
  }
}

function pickDiagnosticIteration(session = {}) {
  const rows = Array.isArray(session.appIterationResults) ? session.appIterationResults : [];
  if (!rows.length) return null;
  const failed = rows.find((row) => row?.status === "error" || row?.jsonParseFailed);
  return failed || rows[rows.length - 1];
}

function trimDiagnosticText(value, maxLen = 1200) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

function flattenIntervalRows(session = {}) {
  const rows = Array.isArray(session.appIterationResults) ? session.appIterationResults : [];
  const flat = [];
  for (const row of rows) {
    if (!Array.isArray(row.intervalSamples)) continue;
    for (const sample of row.intervalSamples) {
      flat.push({
        iteration: row.iteration,
        intervalIndex: sample.index,
        seconds: sample.seconds,
        dlMbps: sample.dlMbps,
        ulMbps: sample.ulMbps,
      });
    }
  }
  return flat;
}

function buildRfSnapshotSummary(session = {}) {
  const stats = session.stats || {};
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
  };
}

export function extractIperf3ReportModel(session = {}, user = {}, taskHelpers = {}) {
  const getTaskLabel = taskHelpers.getTaskLabel || (() => "Active field task");
  const getTaskGrid = taskHelpers.getTaskGrid || (() => "Grid pending");
  const activeTask = taskHelpers.activeTask || null;
  const diagnostic = pickDiagnosticIteration(session);
  const setup = session.appSetupSnapshot || {};
  const command = resolveCommandString(session);
  const exportModes = resolveIperfExportModes(command, setup);

  return {
    testType: "iPerf3 Native",
    sessionId: session.id || null,
    feEmail: user?.email || null,
    task: session.taskLabel || getTaskLabel(activeTask),
    grid: session.grid || getTaskGrid(activeTask),
    startedAt: session.appTestStartedAt ?? session.startedAt ?? null,
    endedAt: session.appTestEndedAt ?? session.endedAt ?? null,
    server: session.appServer ?? setup.server ?? null,
    port: session.appPort ?? setup.port ?? null,
    protocol: session.appProtocol ?? setup.protocol ?? "TCP",
    direction: session.appDirectionLabel || directionLabel(session.appDirection),
    directionKey: session.appDirection || setup.direction || null,
    streams: session.appStreams ?? setup.streams ?? null,
    durationSeconds: session.appDurationSeconds ?? setup.durationSeconds ?? null,
    intervalSeconds: session.appIntervalSeconds ?? setup.intervalSeconds ?? null,
    iterationsRequested: session.appIterationsRequested ?? null,
    iterationsCompleted: session.appCompletedIterations ?? null,
    waitSeconds: session.appWaitSeconds ?? setup.waitSeconds ?? null,
    warmupSeconds: session.appWarmupSeconds ?? setup.warmupSeconds ?? null,
    command,
    reverseMode: exportModes.reverseMode,
    bidirMode: exportModes.bidirMode,
    avgDlMbps: session.appDlMbps,
    avgUlMbps: session.appUlMbps,
    dlBytes: session.appDownloadBytes ?? null,
    ulBytes: session.appUploadBytes ?? null,
    resultStatus: mapIperfExportStatus(session.appExportStatus || session.appTestStatus),
    message: session.appTestMessage || session.appTestError || null,
    stderrSummary: session.appStderrSummary || trimDiagnosticText(diagnostic?.stderr),
    stdoutSummary: session.appStdoutSummary || trimDiagnosticText(diagnostic?.stdout),
    exitCode: diagnostic?.exitCode ?? null,
    intervals: flattenIntervalRows(session),
    rfSnapshotSummary: buildRfSnapshotSummary(session),
  };
}

export function buildIperf3FileBaseName(session = {}, taskHelpers = {}) {
  const getTaskLabel = taskHelpers.getTaskLabel || (() => "Active field task");
  const getTaskGrid = taskHelpers.getTaskGrid || (() => "Grid pending");
  const activeTask = taskHelpers.activeTask || null;
  const taskOrGrid = cleanFilePart(
    session.taskLabel || getTaskLabel(activeTask) || session.grid || getTaskGrid(activeTask),
    "BabyDragon",
  );
  const direction = directionFilePart(session.appDirection);
  const timestamp = session.appTestEndedAt || session.endedAt || Date.now();
  return cleanFilePart(`${taskOrGrid}_iPerf3_${direction}_${formatFileDateTime(timestamp)}`, "BabyDragon_iPerf3");
}

export function buildIperf3Csv(model = {}) {
  const summaryHeaders = [
    "Test Type",
    "Timestamp Start",
    "Timestamp End",
    "Task",
    "Grid",
    "FE Email",
    "Server Host",
    "Port",
    "Protocol",
    "Direction",
    "Streams",
    "Duration (sec)",
    "Interval (sec)",
    "Iterations Requested",
    "Iterations Completed",
    "Wait (sec)",
    "Warmup Sec Metadata",
    "Command",
    "Reverse Mode",
    "Bidirectional Mode",
    "Avg DL Mbps",
    "Avg UL Mbps",
    "DL Bytes",
    "UL Bytes",
    "Result Status",
    "Message",
    "Stderr Summary",
    "Stdout Summary",
  ];

  const summaryRow = {
    "Test Type": exportCsvValue(model.testType),
    "Timestamp Start": formatLocalDateTime(model.startedAt),
    "Timestamp End": formatLocalDateTime(model.endedAt),
    Task: exportCsvValue(model.task),
    Grid: exportCsvValue(model.grid),
    "FE Email": exportCsvValue(model.feEmail),
    "Server Host": exportCsvValue(model.server),
    Port: exportCsvValue(model.port),
    Protocol: exportCsvValue(model.protocol),
    Direction: exportCsvValue(model.direction),
    Streams: exportCsvValue(model.streams),
    "Duration (sec)": exportCsvValue(model.durationSeconds),
    "Interval (sec)": exportCsvValue(model.intervalSeconds),
    "Iterations Requested": exportCsvValue(model.iterationsRequested),
    "Iterations Completed": exportCsvValue(model.iterationsCompleted),
    "Wait (sec)": exportCsvValue(model.waitSeconds),
    "Warmup Sec Metadata": exportCsvValue(model.warmupSeconds),
    Command: exportCsvValue(model.command),
    "Reverse Mode": model.reverseMode ? "yes" : "no",
    "Bidirectional Mode": model.bidirMode ? "yes" : "no",
    "Avg DL Mbps": exportCsvValue(model.avgDlMbps, 2),
    "Avg UL Mbps": exportCsvValue(model.avgUlMbps, 2),
    "DL Bytes": exportCsvValue(model.dlBytes),
    "UL Bytes": exportCsvValue(model.ulBytes),
    "Result Status": exportCsvValue(model.resultStatus),
    Message: exportCsvValue(model.message),
    "Stderr Summary": exportCsvValue(model.stderrSummary),
    "Stdout Summary": exportCsvValue(model.stdoutSummary),
  };

  const intervalHeaders = [
    "Iteration",
    "Interval",
    "Seconds",
    "DL Mbps",
    "UL Mbps",
    "Missing Note",
  ];

  const intervalRows = (model.intervals || []).map((row) => {
    const dl = getNumber(row.dlMbps);
    const ul = getNumber(row.ulMbps);
    const missingNote = (dl === null || ul === null) && (dl !== null || ul !== null)
      ? "missing from iperf JSON"
      : (dl === null && ul === null ? "missing from iperf JSON" : "N/A");
    return {
      Iteration: exportCsvValue(row.iteration),
      Interval: exportCsvValue(row.intervalIndex),
      Seconds: exportCsvValue(getNumber(row.seconds), 2),
      "DL Mbps": exportCsvValue(dl, 2),
      "UL Mbps": exportCsvValue(ul, 2),
      "Missing Note": missingNote,
    };
  });

  const parts = [
    "[iPerf3 Summary]",
    makeCsvSection(summaryHeaders, [summaryRow]),
    "",
    "[iPerf3 Intervals]",
    makeCsvSection(intervalHeaders, intervalRows.length ? intervalRows : [{
      Iteration: "N/A",
      Interval: "N/A",
      Seconds: "N/A",
      "DL Mbps": "N/A",
      "UL Mbps": "N/A",
      "Missing Note": intervalRows.length ? "N/A" : "No interval rows captured",
    }]),
  ];

  return `\uFEFF${parts.join("\n")}`;
}

export function buildIperf3Json(model = {}) {
  return JSON.stringify({
    babyDragonReportVersion: IPERF3_REPORT_VERSION,
    owner: "MobbiTech Global LLC",
    testType: model.testType || "iPerf3 Native",
    sessionId: model.sessionId,
    generatedAtIso: jsonTimestamp(Date.now()),
    testConfig: {
      task: jsonText(model.task),
      grid: jsonText(model.grid),
      feEmail: jsonText(model.feEmail),
      server: jsonText(model.server),
      port: jsonNumber(model.port),
      protocol: jsonText(model.protocol),
      direction: jsonText(model.direction),
      directionKey: jsonText(model.directionKey),
      streams: jsonNumber(model.streams),
      durationSeconds: jsonNumber(model.durationSeconds),
      intervalSeconds: jsonNumber(model.intervalSeconds),
      iterationsRequested: jsonNumber(model.iterationsRequested),
      waitSeconds: jsonNumber(model.waitSeconds),
      warmupSeconds: jsonNumber(model.warmupSeconds),
      command: jsonText(model.command),
      reverseMode: Boolean(model.reverseMode),
      bidirMode: Boolean(model.bidirMode),
    },
    summary: {
      startedAtIso: jsonTimestamp(model.startedAt),
      endedAtIso: jsonTimestamp(model.endedAt),
      startedAtLocal: formatLocalDateTime(model.startedAt) === "N/A" ? null : formatLocalDateTime(model.startedAt),
      endedAtLocal: formatLocalDateTime(model.endedAt) === "N/A" ? null : formatLocalDateTime(model.endedAt),
      avgDlMbps: jsonNumber(model.avgDlMbps, 2),
      avgUlMbps: jsonNumber(model.avgUlMbps, 2),
      dlBytes: jsonNumber(model.dlBytes),
      ulBytes: jsonNumber(model.ulBytes),
      iterationsCompleted: jsonNumber(model.iterationsCompleted),
      resultStatus: jsonText(model.resultStatus),
      message: jsonText(model.message),
      passClaim: false,
    },
    intervals: (model.intervals || []).map((row) => ({
      iteration: jsonNumber(row.iteration),
      interval: jsonNumber(row.intervalIndex),
      seconds: jsonNumber(row.seconds, 2),
      dlMbps: jsonNumber(row.dlMbps, 2),
      ulMbps: jsonNumber(row.ulMbps, 2),
    })),
    rfSnapshotSummary: model.rfSnapshotSummary || null,
    errors: {
      exitCode: jsonNumber(model.exitCode),
      message: jsonText(model.message),
      stderr: jsonText(model.stderrSummary),
      stdout: jsonText(model.stdoutSummary),
    },
  }, null, 2);
}

export function buildIperf3ReportFiles({ session, user, activeTask, getTaskLabel, getTaskGrid }) {
  const taskHelpers = { activeTask, getTaskLabel, getTaskGrid };
  const model = extractIperf3ReportModel(session, user, taskHelpers);
  const baseName = buildIperf3FileBaseName(session, taskHelpers);
  return [
    {
      fileName: `${baseName}.csv`,
      reportLabel: "iPerf3 CSV",
      mimeType: "text/csv",
      content: buildIperf3Csv(model),
    },
    {
      fileName: `${baseName}.json`,
      reportLabel: "iPerf3 JSON",
      mimeType: "application/json",
      content: buildIperf3Json(model),
    },
  ];
}
