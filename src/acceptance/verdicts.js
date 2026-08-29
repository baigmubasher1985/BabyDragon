/**
 * F10C2 CR1-B — server-authoritative acceptance verdicts.
 * Missing/failed measurements stay null. Never coerce to zero.
 */

export const VERDICTS = Object.freeze({
  PASS: "PASS",
  FAIL: "FAIL",
  INCOMPLETE: "INCOMPLETE",
  NOT_EVALUATED: "NOT_EVALUATED",
  NA: "N/A",
});

export const ACCEPTANCE_VERDICT_SET = Object.freeze([
  VERDICTS.PASS,
  VERDICTS.FAIL,
  VERDICTS.INCOMPLETE,
  VERDICTS.NOT_EVALUATED,
]);

export function numericOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function isAcceptanceVerdict(value) {
  return ACCEPTANCE_VERDICT_SET.includes(value) || value === VERDICTS.NA;
}

/**
 * Threshold compare: equal and above pass; below fails.
 * Null actual is INCOMPLETE (never treated as 0).
 */
export function compareThreshold(actual, min) {
  const a = numericOrNull(actual);
  const t = numericOrNull(min);
  if (t === null) {
    return { verdict: VERDICTS.NOT_EVALUATED, reason: "no_threshold" };
  }
  if (a === null) {
    return { verdict: VERDICTS.INCOMPLETE, reason: "missing_measurement" };
  }
  if (a >= t) {
    return { verdict: VERDICTS.PASS, reason: a === t ? "equal" : "above" };
  }
  return { verdict: VERDICTS.FAIL, reason: "below" };
}

export function combineDirectionVerdicts(verdicts, mode = "AND") {
  const enabled = (verdicts || []).filter((v) => v && v !== VERDICTS.NA);
  if (enabled.length === 0) return VERDICTS.NOT_EVALUATED;
  if (enabled.includes(VERDICTS.NOT_EVALUATED) && enabled.every((v) => v === VERDICTS.NOT_EVALUATED || v === VERDICTS.NA)) {
    return VERDICTS.NOT_EVALUATED;
  }
  if (enabled.includes(VERDICTS.INCOMPLETE)) return VERDICTS.INCOMPLETE;
  const combine = String(mode || "AND").toUpperCase() === "OR" ? "OR" : "AND";
  if (combine === "OR") {
    if (enabled.includes(VERDICTS.PASS)) return VERDICTS.PASS;
    if (enabled.includes(VERDICTS.NOT_EVALUATED) && !enabled.includes(VERDICTS.FAIL)) {
      return VERDICTS.NOT_EVALUATED;
    }
    if (enabled.every((v) => v === VERDICTS.FAIL)) return VERDICTS.FAIL;
    if (enabled.includes(VERDICTS.FAIL)) return VERDICTS.FAIL;
    return VERDICTS.NOT_EVALUATED;
  }
  if (enabled.includes(VERDICTS.NOT_EVALUATED)) return VERDICTS.NOT_EVALUATED;
  if (enabled.includes(VERDICTS.FAIL)) return VERDICTS.FAIL;
  if (enabled.every((v) => v === VERDICTS.PASS)) return VERDICTS.PASS;
  return VERDICTS.NOT_EVALUATED;
}

export default {
  VERDICTS,
  ACCEPTANCE_VERDICT_SET,
  numericOrNull,
  isAcceptanceVerdict,
  compareThreshold,
  combineDirectionVerdicts,
};
