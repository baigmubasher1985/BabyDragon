/**
 * Normalize Native HTTP / data-engine test outcome for customer-facing reports.
 * Does not change transfer execution — presentation and persistence helpers only.
 */

import {
  countControlledIterations,
  deriveControlledRunStatus,
  formatControlledRunStatusLabel,
  isControlledEngineTestType,
  isFailedIterationRow,
} from "./controlledIterationContract.js";

function pickFailedIterationReason(row = {}) {
  return cleanText(row.conciseReason)
    || cleanText(row.error)
    || cleanText(row.errorMessage)
    || cleanText(row.failureReason)
    || cleanText(row.failure_reason)
    || cleanText(row.message)
    || "";
}

function isGenericContinuousStopMessage(text = "") {
  const t = String(text || "").toLowerCase();
  return t.includes("continuous")
    && (t.includes("stopped and saved") || t.includes("stopped.") || t.includes("attempted"));
}

/** Session wrap-up success text must never become Failure Summary. */
function isGenericSuccessPollutionMessage(text = "") {
  const t = String(text || "").toLowerCase().trim();
  if (!t) return false;
  if (t.includes("fail")) return false;
  return /(http|ftp|iperf3?|native)\s+test\s+completed\.?$/.test(t)
    || t === "test completed."
    || t === "test completed";
}

function getNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

export function classifyNativeHttpFailure(message = "") {
  const m = String(message || "").toLowerCase();
  if (!m) {
    return {
      errorCode: "NATIVE_HTTP_FAILED",
      failureStage: "before_transfer",
      conciseReason: "Failed before transfer",
      customerLabel: "Native HTTP — Failed before transfer",
    };
  }
  if (
    m.includes("unable to resolve host")
    || m.includes("unknownhost")
    || m.includes("nodename nor servname")
    || m.includes("name or service not known")
    || (m.includes("dns") && m.includes("fail"))
  ) {
    return {
      errorCode: "DNS_RESOLUTION_FAILED",
      failureStage: "before_transfer",
      conciseReason: "DNS Resolution Failed",
      customerLabel: "Native HTTP — Failed before transfer",
    };
  }
  if (m.includes("timeout") || m.includes("timed out")) {
    return {
      errorCode: "TIMEOUT",
      failureStage: m.includes("connect") ? "before_transfer" : "during_transfer",
      conciseReason: "Connection Timed Out",
      customerLabel: "Native HTTP — Failed before transfer",
    };
  }
  if (m.includes("network is unreachable") || m.includes("enotconn") || m.includes("econnrefused")) {
    return {
      errorCode: "NO_USABLE_DATA_PATH",
      failureStage: "before_transfer",
      conciseReason: "No Usable Data Path",
      customerLabel: "Native HTTP — Failed before transfer",
    };
  }
  if (m.includes("ssl") || m.includes("certificate")) {
    return {
      errorCode: "TLS_FAILED",
      failureStage: "before_transfer",
      conciseReason: "TLS/Certificate Failed",
      customerLabel: "Native HTTP — Failed before transfer",
    };
  }
  return {
    errorCode: "NATIVE_HTTP_FAILED",
    failureStage: "before_transfer",
    conciseReason: "Failed before transfer",
    customerLabel: "Native HTTP — Failed before transfer",
  };
}

function isFailedStatus(status) {
  const s = String(status || "").toLowerCase();
  return s === "error" || s === "failed" || s === "failure" || s === "fail";
}

/**
 * Derive attempt/completed/failed/remaining counts and customer-facing outcome from a saved session.
 */
export function classifyFtpFailure(message = "", opts = {}) {
  const m = String(message || "").toLowerCase();
  const explicitStage = String(opts.failureStage || "").trim();
  const dir = String(opts.direction || "").toLowerCase();
  const openFileDl = m.includes("failed to open file")
    || m.includes("retr")
    || m.includes("download")
    || m.includes("passive data");
  const resolveStage = () => {
    if (explicitStage) return explicitStage;
    if (opts.ulFailed === true && opts.dlFailed !== true) return "ftp_upload";
    if (opts.dlFailed === true && opts.ulFailed !== true) return "ftp_download";
    if (openFileDl) return "ftp_download";
    if (dir === "ul") return "ftp_upload";
    if (dir === "dl") return "ftp_download";
    return "during_transfer";
  };

  if (m.includes("550") || m.includes("access denied") || m.includes("access denied.") || m.includes("failed to open file")) {
    return {
      errorCode: "FTP_550_ACCESS_DENIED",
      failureStage: resolveStage() === "during_transfer" ? "ftp_download" : resolveStage(),
      conciseReason: "Access Denied (550)",
      customerLabel: "FTP — Access Denied (550)",
    };
  }
  if (m.includes("530") || m.includes("login") || m.includes("authentication")) {
    return {
      errorCode: "FTP_AUTH_FAILED",
      failureStage: explicitStage || "ftp_authorization",
      conciseReason: "Authentication Failed",
      customerLabel: "FTP — Authentication Failed",
    };
  }
  if (m.includes("passive") && (m.includes("timeout") || m.includes("timed out") || m.includes("data connection"))) {
    return {
      errorCode: "PASSIVE_DATA_CONNECTION",
      failureStage: explicitStage || "ftp_download",
      conciseReason: "Passive data connection timeout",
      customerLabel: "FTP — Passive data connection timeout",
    };
  }
  if (m.includes("timeout") || m.includes("timed out") || m.includes("after 15000ms") || m.includes("after 15000")) {
    return {
      errorCode: "FTP_TIMEOUT",
      failureStage: resolveStage(),
      conciseReason: "Connection Timed Out",
      customerLabel: "FTP — Connection Timed Out",
    };
  }
  if (
    m.includes("ftp_connect_failed")
    || m.includes("failed to connect")
    || m.includes("connect failed")
    || m.includes("connection refused")
  ) {
    return {
      errorCode: "FTP_CONNECT_FAILED",
      failureStage: resolveStage(),
      conciseReason: "Connection Failed",
      customerLabel: "FTP — Connection Failed",
    };
  }
  return {
    errorCode: "FTP_FAILED",
    failureStage: resolveStage(),
    conciseReason: cleanText(message) || "Failed",
    customerLabel: `FTP — ${cleanText(message) || "Failed"}`,
  };
}

export function classifyIperfFailure(message = "") {
  const raw = cleanText(message) || "";
  const m = raw.toLowerCase();
  if (m.includes("server is busy") || /\bbusy\b/.test(m)) {
    return {
      errorCode: "IPERF_SERVER_BUSY",
      failureStage: "server_busy",
      conciseReason: "Server Busy",
      customerLabel: "iPerf3 — Server Busy",
      failureClass: "SERVER_BUSY",
    };
  }
  if (
    m.includes("name or service not known")
    || m.includes("getaddrinfo")
    || m.includes("nodename nor servname")
    || (m.includes("dns") && (m.includes("fail") || m.includes("error")))
  ) {
    return {
      errorCode: "IPERF_DNS_FAILED",
      failureStage: "dns_resolution",
      conciseReason: "DNS resolution failed",
      customerLabel: "iPerf3 — DNS failed",
      failureClass: "DNS",
    };
  }
  if (m.includes("connection refused") || m.includes("connect: connection refused")) {
    return {
      errorCode: "IPERF_CONNECTION_REFUSED",
      failureStage: "server_connection",
      conciseReason: "Connection refused",
      customerLabel: "iPerf3 — Connection refused",
      failureClass: "CONNECTION_REFUSED",
    };
  }
  if (m.includes("no route to host")) {
    return {
      errorCode: "IPERF_NO_ROUTE",
      failureStage: "network_connection",
      conciseReason: "No route to host",
      customerLabel: "iPerf3 — No route to host",
      failureClass: "NO_ROUTE",
    };
  }
  if (m.includes("network is unreachable") || m.includes("network unreachable")) {
    return {
      errorCode: "IPERF_NETWORK_UNREACHABLE",
      failureStage: "network_connection",
      conciseReason: "Network unreachable",
      customerLabel: "iPerf3 — Network unreachable",
      failureClass: "NETWORK_UNREACHABLE",
    };
  }
  if (m.includes("timeout") || m.includes("timed out")) {
    const connectish = m.includes("connect") || m.includes("connection");
    return {
      errorCode: connectish ? "IPERF_CONNECTION_TIMEOUT" : "TIMEOUT",
      failureStage: connectish ? "server_connection" : "transfer",
      conciseReason: connectish ? "Connection timed out" : "Timed out",
      customerLabel: connectish ? "iPerf3 — Connection timed out" : "iPerf3 — Timeout",
      failureClass: "TIMEOUT",
    };
  }
  if (m.includes("connect failed") || m.includes("unable to connect") || m.includes("failed to connect")) {
    return {
      errorCode: "TCP_CONNECT",
      failureStage: "server_connection",
      conciseReason: "TCP connect failed",
      customerLabel: "iPerf3 — TCP connect failed",
      failureClass: "TCP_CONNECT",
    };
  }
  if (m.includes("unsupported") || m.includes("unknown option") || m.includes("invalid argument")) {
    return {
      errorCode: "SERVER_UNSUPPORTED_MODE",
      failureStage: "command",
      conciseReason: "Unsupported mode/option",
      customerLabel: "iPerf3 — Unsupported mode",
      failureClass: "SERVER_UNSUPPORTED_MODE",
    };
  }
  if (m.includes("permission denied") || m.includes("auth")) {
    return {
      errorCode: "AUTHORIZATION",
      failureStage: "before_transfer",
      conciseReason: "Authorization failed",
      customerLabel: "iPerf3 — Authorization failed",
      failureClass: "AUTHORIZATION",
    };
  }
  if (m.includes("cannot execute") || m.includes("error 13") || m.includes("binary") || m.includes("no such file")) {
    return {
      errorCode: "BINARY",
      failureStage: "process_launch",
      conciseReason: "Binary/process launch failed",
      customerLabel: "iPerf3 — Binary/process launch failed",
      failureClass: m.includes("error 13") || m.includes("cannot execute") ? "PROCESS_LAUNCH" : "BINARY",
    };
  }
  if (m.includes("direction") && (m.includes("mismatch") || m.includes("-r") || m.includes("bidir"))) {
    return {
      errorCode: "COMMAND_DIRECTION",
      failureStage: "command",
      conciseReason: "Direction/command mismatch",
      customerLabel: "iPerf3 — Direction mismatch",
      failureClass: "COMMAND_DIRECTION",
    };
  }
  const fallback = raw || "Failed";
  return {
    errorCode: "UNKNOWN_WITH_RAW_ERROR",
    failureStage: "transfer",
    conciseReason: fallback,
    customerLabel: `iPerf3 — ${fallback}`,
    failureClass: "UNKNOWN_WITH_RAW_ERROR",
  };
}

export function buildDataTestOutcome(session = {}) {
  const engineId = String(session.appEngineId || session.engineId || "").toLowerCase();
  const testType = String(session.appTestType || session.appSetupSnapshot?.testType || "").toLowerCase();
  const isFtp = engineId === "ftp" || testType.includes("ftp");
  const isIperf = engineId.includes("iperf") || testType.includes("iperf");
  const isNativeHttp = engineId === "native_http"
    || ((testType.includes("http") || testType.includes("native")) && !isFtp && !isIperf);
  // Never treat empty/unknown type as Native HTTP when no controlled iterations exist.
  const rows = Array.isArray(session.appIterationResults) ? session.appIterationResults : [];
  const status = String(session.appTestStatus || "").toLowerCase();
  const errorMessage = cleanText(session.appTestError || session.appTestMessage);
  const endReason = cleanText(session.appEndReason || session.appTestEndReason);

  const counts = countControlledIterations({
    requested: (() => {
      const runMode = String(session.appRunMode || session.appSetupSnapshot?.runMode || "").toLowerCase();
      const continuous = runMode === "continuous"
        || status === "continuous_complete"
        || endReason === "user_stopped_continuous";
      return continuous ? null : (session.appIterationsRequested ?? session.appIterations);
    })(),
    iterationResults: rows,
    completedIterations: session.appCompletedIterations,
    failedIterations: session.appFailedIterations,
    status,
  });

  const runMode = String(session.appRunMode || session.appSetupSnapshot?.runMode || "").toLowerCase();
  const isContinuous = runMode === "continuous"
    || status === "continuous_complete"
    || endReason === "user_stopped_continuous";
  if (isContinuous) {
    counts.requestedIterations = null;
    counts.remainingIterations = null;
  }

  const normalizedStatus = deriveControlledRunStatus({
    requested: counts.requestedIterations,
    attempted: counts.attemptedIterations,
    completed: counts.completedIterations,
    failed: counts.failedIterations,
    remaining: counts.remainingIterations,
    rawStatus: status,
    endReason,
  });

  const failedRow = rows.find(isFailedIterationRow);
  // Prefer per-iteration native/classified reason over session stop summary text.
  const iterationFailureText = pickFailedIterationReason(failedRow);
  const sessionFailureText = errorMessage
    && !isGenericContinuousStopMessage(errorMessage)
    && !isGenericSuccessPollutionMessage(errorMessage)
    ? errorMessage
    : "";
  const failureText = iterationFailureText
    || sessionFailureText
    || (errorMessage && !isGenericSuccessPollutionMessage(errorMessage) ? errorMessage : "")
    || "";
  const classif = (normalizedStatus === "failed"
    || normalizedStatus === "complete_with_failures"
    || normalizedStatus === "failed_before_start"
    || isFailedStatus(status)
    || counts.failedIterations > 0)
    ? (isFtp
      ? classifyFtpFailure(
        pickFailedIterationReason(failedRow) || failureText || cleanText(failedRow?.errorCode) || "",
        {
          direction: failedRow?.direction,
          failureStage: failedRow?.failureStage,
          dlFailed: failedRow?.dlOk === false || String(failedRow?.dl_status || "").toLowerCase() === "failed",
          ulFailed: failedRow?.ulOk === false || String(failedRow?.ul_status || "").toLowerCase() === "failed",
        },
      )
      : isIperf
        ? classifyIperfFailure(failureText || cleanText(failedRow?.errorCode) || "")
        : classifyNativeHttpFailure(failureText || cleanText(failedRow?.errorCode) || ""))
    : null;

  const successfulDl = rows
    .map((row) => {
      if (String(row.dl_status || row.dlStatus || "").toLowerCase() === "failed") return null;
      if (row.dlOk === false) return null;
      return getNumber(row.dlMbps);
    })
    .filter((v) => v !== null);
  const successfulUl = rows
    .map((row) => {
      if (String(row.ul_status || row.ulStatus || "").toLowerCase() === "failed") return null;
      if (row.ulOk === false) return null;
      return getNumber(row.ulMbps);
    })
    .filter((v) => v !== null);

  const hasSuccessfulAppThroughput = successfulDl.length > 0 || successfulUl.length > 0;

  const engineLabel = isNativeHttp
    ? "Native HTTP"
    : (isFtp ? "FTP" : isIperf ? "iPerf3" : "Data test");

  let customerStatus = formatControlledRunStatusLabel(normalizedStatus, { continuous: isContinuous });
  let customerScenario = `${engineLabel} — ${customerStatus}`;

  if (normalizedStatus === "failed" || normalizedStatus === "failed_before_start") {
    // Prefer specific native reason (e.g. Connection refused) over generic Failed.
    customerScenario = classif?.customerLabel || `${engineLabel} — Failed`;
    if (isContinuous && classif?.conciseReason) {
      customerScenario = `${engineLabel} — Failed (${classif.conciseReason})`;
    }
  } else if (normalizedStatus === "complete_with_failures") {
    customerScenario = isContinuous
      ? `${engineLabel} stopped with failures: ${counts.attemptedIterations} attempted, ${counts.completedIterations} completed, ${counts.failedIterations} failed.`
      : `${engineLabel} completed with failures: ${counts.attemptedIterations} attempted, ${counts.completedIterations} completed, ${counts.failedIterations} failed.`;
  } else if (normalizedStatus === "incomplete") {
    customerScenario = `${engineLabel} — Incomplete`;
  } else if (normalizedStatus === "continuous_complete") {
    customerScenario = `${engineLabel} — Continuous complete`;
  } else if (normalizedStatus === "complete") {
    customerScenario = `${engineLabel} — Complete`;
  } else if (normalizedStatus === "running") {
    customerScenario = `${engineLabel} — Running`;
  }

  // Do not label Partial merely because one iteration failed when remaining never ran.
  if (customerStatus === "Partial") {
    customerStatus = formatControlledRunStatusLabel(normalizedStatus);
  }

  const failureTimeMs = getNumber(session.appTestEndedAt)
    ?? (rows.length ? getNumber(rows[rows.length - 1]?.endedAt) : null)
    ?? getNumber(session.endedAt);

  const errorSummary = rows
    .filter(isFailedIterationRow)
    .map((row) => {
      const code = cleanText(row.errorCode) || classifyNativeHttpFailure(row.error || row.errorMessage).errorCode;
      const msg = cleanText(row.error || row.errorMessage) || cleanText(row.conciseReason) || "failed";
      return `Iter ${row.iteration}: ${code} — ${msg}`;
    })
    .slice(0, 5)
    .join("; ");

  return {
    testType: engineLabel,
    engineKey: isNativeHttp ? "native_http" : isFtp ? "ftp" : isIperf ? "iperf3" : (testType || engineId || "data"),
    status: customerStatus,
    normalizedStatus,
    // Continuous: raw must match finalized canonical outcome (never leak stale cancelled).
    rawStatus: isContinuous ? (normalizedStatus || session.appTestStatus || null) : (session.appTestStatus || null),
    customerScenario,
    direction: cleanText(session.appDirection) || null,
    requestedIterations: counts.requestedIterations,
    attemptedIterations: counts.attemptedIterations,
    completedIterations: counts.completedIterations,
    partialIterations: counts.partialIterations ?? 0,
    failedIterations: counts.failedIterations,
    failedTotalIterations: counts.failedTotalIterations ?? counts.failedIterations,
    remainingIterations: counts.remainingIterations,
    successfulDlDirectionCount: successfulDl.length,
    successfulUlDirectionCount: successfulUl.length,
    successfulDlAvgMbps: successfulDl.length
      ? Number((successfulDl.reduce((a, b) => a + b, 0) / successfulDl.length).toFixed(2))
      : null,
    successfulUlAvgMbps: successfulUl.length
      ? Number((successfulUl.reduce((a, b) => a + b, 0) / successfulUl.length).toFixed(2))
      : null,
    hasSuccessfulAppThroughput,
    errorCode: classif?.errorCode || null,
    errorMessage: (counts.failedIterations > 0 || isFailedStatus(status)
      || normalizedStatus === "failed"
      || normalizedStatus === "complete_with_failures")
      ? (classif?.conciseReason || iterationFailureText || errorMessage || errorSummary || null)
      : null,
    errorSummary: errorSummary || null,
    failureStage: classif?.failureStage || failedRow?.failureStage || null,
    conciseReason: classif?.conciseReason || null,
    failureReason: classif?.conciseReason || iterationFailureText || null,
    failureTimeMs,
    appDlUlAvailable: hasSuccessfulAppThroughput,
    averagesBasedOnCompletedOnly: true,
    endReason: endReason || (normalizedStatus === "incomplete" ? "user_stopped_incomplete" : null),
    isControlledEngine: isControlledEngineTestType(testType || (isNativeHttp ? "native_http" : "")),
  };
}

export function formatCustomerScenario(session = {}, fallbackScenario = "") {
  const outcome = buildDataTestOutcome(session);
  const fb = String(fallbackScenario || "").toLowerCase();
  if (
    outcome.isControlledEngine
    || outcome.engineKey === "native_http"
    || fb.includes("native")
    || fb.includes("ftp")
    || fb.includes("iperf")
  ) {
    return outcome.customerScenario;
  }
  if (fb.includes("ookla")) return "OOKLA External Evidence";
  if (fb.includes("fcc")) return "FCC External Evidence";
  if (fallbackScenario === "rf_data" || fallbackScenario === "data") {
    return outcome.customerScenario || "RF Only";
  }
  return outcome.customerScenario || fallbackScenario || "RF Only";
}

export default {
  classifyNativeHttpFailure,
  classifyFtpFailure,
  classifyIperfFailure,
  buildDataTestOutcome,
  formatCustomerScenario,
};
