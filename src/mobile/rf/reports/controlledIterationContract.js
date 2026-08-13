/**
 * Shared contract for BabyDragon-controlled automated engines
 * (Native HTTP, FTP, iPerf3). OOKLA/FCC external evidence is excluded.
 *
 * requested = total attempt slots that must be processed (not required successes).
 * attempted = completed + failed runtime iterations that started.
 * remaining = max(requested - attempted, 0).
 */

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

export function isControlledEngineTestType(testType) {
  const t = String(testType || "").toLowerCase();
  if (!t) return false;
  if (t.includes("ookla") || t.includes("fcc")) return false;
  return t.includes("http") || t.includes("native") || t.includes("ftp") || t.includes("iperf");
}

export function isFailedIterationRow(row = {}) {
  const s = String(row.status || row.overall_status || "").toLowerCase();
  if (s === "failed" || s === "error" || s === "failure" || s === "fail") return true;
  if (s === "partial_failure" || s === "partial") return true;
  // Authoritative success status must not be flipped by status-label pollution in error fields.
  if (s === "complete" || s === "success" || s === "ok" || s === "passed") {
    const code = cleanText(row.errorCode);
    if (code && !/^(OK|SUCCESS|COMPLETE|N\/A)$/i.test(code)) return true;
    return false;
  }
  const err = cleanText(row.error || row.errorMessage);
  if (!err) return false;
  const lower = err.toLowerCase();
  if (["complete", "success", "ok", "passed", "n/a", "na", "measured"].includes(lower)) return false;
  return true;
}

export function isPartialIterationRow(row = {}) {
  const s = String(row.status || row.overall_status || "").toLowerCase();
  if (s === "partial_failure" || s === "partial") return true;
  const dlOk = String(row.dl_status || row.dlStatus || "").toLowerCase() === "complete"
    || (getNumber(row.dlMbps) !== null && row.dlOk !== false && !isDirectionFailed(row, "dl"));
  const ulOk = String(row.ul_status || row.ulStatus || "").toLowerCase() === "complete"
    || (getNumber(row.ulMbps) !== null && row.ulOk !== false && !isDirectionFailed(row, "ul"));
  const dlFail = isDirectionFailed(row, "dl");
  const ulFail = isDirectionFailed(row, "ul");
  return (dlOk && ulFail) || (ulOk && dlFail);
}

function isDirectionFailed(row = {}, direction = "") {
  const dir = String(direction || "").toLowerCase();
  if (dir === "dl") {
    const st = String(row.dl_status || row.dlStatus || "").toLowerCase();
    if (st === "failed" || st === "error") return true;
    return Boolean(cleanText(row.dl_error)) || row.dlOk === false;
  }
  if (dir === "ul") {
    const st = String(row.ul_status || row.ulStatus || "").toLowerCase();
    if (st === "failed" || st === "error") return true;
    return Boolean(cleanText(row.ul_error)) || row.ulOk === false;
  }
  return false;
}

export function isCompletedIterationRow(row = {}) {
  if (isPartialIterationRow(row)) return false;
  if (isFailedIterationRow(row)) return false;
  const s = String(row.status || row.overall_status || "").toLowerCase();
  if (s === "complete" || s === "success" || s === "ok" || s === "passed") return true;
  return getNumber(row.dlMbps) !== null || getNumber(row.ulMbps) !== null;
}

/**
 * Successful-direction Mbps values (partial iterations may contribute).
 */
export function successfulDirectionMbps(row = {}, direction = "dl") {
  const dir = String(direction || "").toLowerCase();
  if (dir === "dl") {
    if (isDirectionFailed(row, "dl")) return null;
    return getNumber(row.dlMbps);
  }
  if (isDirectionFailed(row, "ul")) return null;
  return getNumber(row.ulMbps);
}

/**
 * Count requested / attempted / completed / failed / remaining from a data-test or session.
 */
export function countControlledIterations({
  requested,
  iterationResults = [],
  completedIterations,
  failedIterations,
  status,
} = {}) {
  const rows = Array.isArray(iterationResults) ? iterationResults : [];
  let completed = rows.filter(isCompletedIterationRow).length;
  let failed = rows.filter((r) => isFailedIterationRow(r) && !isPartialIterationRow(r)).length;
  let partial = rows.filter(isPartialIterationRow).length;
  const savedCompleted = getNumber(completedIterations);
  const savedFailed = getNumber(failedIterations);
  if (savedCompleted !== null && savedCompleted >= 0 && rows.length === 0) {
    completed = savedCompleted;
  }
  if (savedFailed !== null && savedFailed >= 0 && rows.length === 0) {
    failed = savedFailed;
  }
  // Prefer row truth when rows exist
  if (rows.length) {
    completed = rows.filter(isCompletedIterationRow).length;
    partial = rows.filter(isPartialIterationRow).length;
    failed = rows.filter((r) => isFailedIterationRow(r) && !isPartialIterationRow(r)).length;
  }

  let attempted = rows.length;
  if (attempted === 0) {
    const st = String(status || "").toLowerCase();
    if (st === "error" || st === "failed" || st === "stopped" || st === "incomplete") {
      attempted = Math.max(completed + failed + partial, completed > 0 || failed > 0 || partial > 0 ? completed + failed + partial : 0);
    }
  }

  const req = getNumber(requested);
  const requestedSafe = req !== null && req > 0 ? Math.round(req) : null;
  const remaining = requestedSafe !== null
    ? Math.max(requestedSafe - attempted, 0)
    : null;

  return {
    requestedIterations: requestedSafe,
    attemptedIterations: attempted,
    completedIterations: completed,
    partialIterations: partial,
    failedIterations: failed + partial, // customer "failed" includes partial full-iteration failures
    failedTotalIterations: failed,
    remainingIterations: remaining,
  };
}

/**
 * Derive normalized run status after attempt slots are known.
 *
 * complete | complete_with_failures | failed | incomplete | cancelled |
 * failed_before_start | running | paused | idle
 */
/**
 * Continuous-mode outcome from observed attempt counts (F9C).
 * Continuous ending ≠ automatic success.
 */
export function deriveContinuousOutcomeStatus({
  attempted = 0,
  completed = 0,
  failed = 0,
  attemptedIterations,
  completedIterations,
  failedIterations,
} = {}) {
  // Accept both {attempted,completed,failed} and countControlledIterations keys.
  const att = getNumber(attemptedIterations ?? attempted) ?? 0;
  const ok = getNumber(completedIterations ?? completed) ?? 0;
  const bad = getNumber(failedIterations ?? failed) ?? 0;
  if (att <= 0 && ok <= 0 && bad <= 0) return "cancelled";
  if (ok > 0 && bad === 0) return "continuous_complete";
  if (ok > 0 && bad > 0) return "complete_with_failures";
  if (ok === 0 && bad > 0) return "failed";
  return "cancelled";
}

export function deriveControlledRunStatus({
  requested,
  attempted,
  completed,
  failed,
  remaining,
  rawStatus,
  endReason,
  userCancelled = false,
} = {}) {
  const st = String(rawStatus || "").toLowerCase();
  const reason = String(endReason || "").toLowerCase();

  const reqEarly = getNumber(requested);
  const attEarly = getNumber(attempted) ?? 0;
  const okEarly = getNumber(completed) ?? 0;
  const badEarly = getNumber(failed) ?? 0;

  if (st === "continuous_complete" || reason === "user_stopped_continuous") {
    return deriveContinuousOutcomeStatus({
      attempted: attEarly,
      completed: okEarly,
      failed: badEarly,
    });
  }
  if (userCancelled || st === "cancelled" || reason === "cancelled") return "cancelled";
  if (st === "failed_before_start" || reason === "failed_before_start") return "failed_before_start";
  if (st === "idle") return "idle";
  if (st === "paused" || st === "session_paused") return "paused";
  if (st === "running") return "running";

  const req = reqEarly;
  const att = attEarly;
  const ok = okEarly;
  const bad = badEarly;
  const rem = getNumber(remaining);
  const allSlotsProcessed = req !== null && rem !== null ? rem === 0 && att >= req : (req !== null && att >= req);

  if (st === "stopped" || st === "incomplete" || reason === "user_stopped_incomplete") {
    if (allSlotsProcessed) {
      // stop arrived after last slot finished — treat as finished
    } else {
      return "incomplete";
    }
  }

  if (allSlotsProcessed) {
    if (ok > 0 && bad > 0) return "complete_with_failures";
    if (ok > 0 && bad === 0) return "complete";
    if (ok === 0 && bad > 0) return "failed";
    if (ok === 0 && bad === 0) return "failed";
  }

  if (st === "complete" || st === "complete_with_failures" || st === "failed" || st === "incomplete") {
    return st;
  }
  if (st === "error" || st === "failed") {
    if (allSlotsProcessed && ok > 0) return "complete_with_failures";
    if (allSlotsProcessed) return "failed";
    return ok > 0 ? "incomplete" : "failed";
  }
  if (st === "partial") {
    return allSlotsProcessed && ok > 0 && bad > 0 ? "complete_with_failures" : "incomplete";
  }

  return st || "idle";
}

export function formatControlledRunStatusLabel(status, { continuous = false } = {}) {
  const key = String(status || "").toLowerCase();
  if (continuous && key === "complete_with_failures") return "Stopped with failures";
  if (continuous && key === "failed") return "Failed";
  const map = {
    idle: "Idle",
    running: "Running",
    paused: "Paused",
    complete: "Complete",
    complete_with_failures: "Completed with failures",
    failed: "Failed",
    continuous_complete: "Continuous complete",
    incomplete: "Incomplete",
    cancelled: "Cancelled",
    failed_before_start: "Failed before start",
    stopped: "Incomplete",
    error: "Failed",
    partial: "Incomplete",
  };
  return map[key] || String(status || "Unknown");
}

/**
 * Canonical Continuous stop outcome (status + message + error) from frozen counts.
 * Call only after the final iteration list has settled.
 */
export function buildContinuousCanonicalOutcome({
  attempted = 0,
  completed = 0,
  failed = 0,
  engineLabel = "Data test",
  failureReason = "",
} = {}) {
  const att = getNumber(attempted) ?? 0;
  const ok = getNumber(completed) ?? 0;
  const bad = getNumber(failed) ?? 0;
  const status = deriveContinuousOutcomeStatus({ attempted: att, completed: ok, failed: bad });
  const reason = cleanText(failureReason) || "";
  let message;
  if (status === "failed") {
    message = `Continuous ${engineLabel} failed. Attempted ${att}, completed ${ok}, failed ${bad}.${reason ? ` ${reason}` : ""}`;
  } else if (status === "complete_with_failures") {
    message = `Continuous ${engineLabel} stopped with failures. Attempted ${att}, completed ${ok}, failed ${bad}.${reason ? ` ${reason}` : ""}`;
  } else if (status === "cancelled") {
    message = `Continuous ${engineLabel} stopped with no attempts.`;
  } else {
    message = `Continuous ${engineLabel} stopped and saved. Attempted ${att}, completed ${ok}, failed ${bad}.`;
  }
  return {
    status,
    message,
    error: (status === "continuous_complete" || status === "cancelled") ? "" : reason,
    endReason: "user_stopped_continuous",
    overall: formatControlledRunStatusLabel(status, { continuous: true }),
    attempted: att,
    completed: ok,
    failed: bad,
  };
}

/**
 * Live / saved iteration counter text.
 * Continuous: completed only (no denominator). Fixed: completed/requested.
 */
export function formatControlledIterationsDisplay({
  runMode,
  completed = 0,
  requested = null,
  status,
  endReason,
} = {}) {
  const continuous = String(runMode || "").toLowerCase() === "continuous"
    || String(status || "").toLowerCase() === "continuous_complete"
    || String(endReason || "").toLowerCase() === "user_stopped_continuous";
  const done = Math.max(0, Math.round(getNumber(completed) ?? 0));
  if (continuous) return String(done);
  const req = getNumber(requested);
  if (req === null || req <= 0) return String(done);
  return `${done}/${Math.round(req)}`;
}

export function controlledEngineDisplayName(testType) {
  const t = String(testType || "").toLowerCase();
  if (t.includes("ftp")) return "FTP";
  if (t.includes("iperf")) return "iPerf3";
  if (t.includes("http") || t.includes("native")) return "Native HTTP";
  return "Data test";
}

export function isControlledTestIncomplete(dataTest = {}) {
  if (!isControlledEngineTestType(dataTest.testType)) return false;
  if (String(dataTest.runMode || "").toLowerCase() === "continuous") return false;
  const st = String(dataTest.status || "").toLowerCase();
  if (st !== "running" && st !== "paused") return false;
  const counts = countControlledIterations({
    requested: dataTest.iterationsRequested,
    iterationResults: dataTest.iterationResults,
    completedIterations: dataTest.completedIterations,
    failedIterations: dataTest.failedIterations,
    status: dataTest.status,
  });
  return counts.requestedIterations != null
    && counts.attemptedIterations < counts.requestedIterations;
}

export default {
  isControlledEngineTestType,
  isFailedIterationRow,
  isCompletedIterationRow,
  countControlledIterations,
  deriveContinuousOutcomeStatus,
  deriveControlledRunStatus,
  formatControlledRunStatusLabel,
  buildContinuousCanonicalOutcome,
  formatControlledIterationsDisplay,
  controlledEngineDisplayName,
  isControlledTestIncomplete,
};
