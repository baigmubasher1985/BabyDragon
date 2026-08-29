/**
 * F10C2 CR1-B — DL/UL acceptance against persisted measurements.
 * Execution failure is INCOMPLETE, never a zero-throughput FAIL.
 */

import {
  VERDICTS,
  numericOrNull,
  compareThreshold,
  combineDirectionVerdicts,
} from "./verdicts.js";

export const DL_UL_DIRECTIONS = Object.freeze(["dl", "ul"]);

function asList(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).toLowerCase());
  if (value == null || value === "") return ["dl", "ul"];
  return String(value)
    .split(/[,+|]/)
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

export function normalizeDlUlRules(rules = {}) {
  const enabled = asList(rules.enabled_directions || rules.directions || rules.enabledDirections);
  const hasDl = enabled.includes("dl") || enabled.includes("download");
  const hasUl = enabled.includes("ul") || enabled.includes("upload");
  return {
    min_dl_mbps: numericOrNull(rules.min_dl_mbps ?? rules.minDlMbps),
    min_ul_mbps: numericOrNull(rules.min_ul_mbps ?? rules.minUlMbps),
    dl_enabled: hasDl,
    ul_enabled: hasUl,
    combine_mode: String(rules.combine_mode || rules.combineMode || "AND").toUpperCase() === "OR" ? "OR" : "AND",
    required_completed_iterations: numericOrNull(
      rules.required_completed_iterations ?? rules.requiredCompletedIterations,
    ),
    required_dl_passing_iterations: numericOrNull(
      rules.required_dl_passing_iterations ?? rules.requiredDlPassingIterations,
    ),
    required_ul_passing_iterations: numericOrNull(
      rules.required_ul_passing_iterations ?? rules.requiredUlPassingIterations,
    ),
    completion_policy: String(rules.completion_policy || rules.completionPolicy || "min_completed"),
  };
}

function countBasedDirectionVerdict({ enabled, passCount, incompleteCount, requiredPassing }) {
  if (!enabled) return VERDICTS.NA;
  if (requiredPassing == null) return null;
  if (passCount >= requiredPassing) return VERDICTS.PASS;
  if (passCount + incompleteCount >= requiredPassing) return VERDICTS.INCOMPLETE;
  return VERDICTS.FAIL;
}

function iterationExecutionFailed(iteration = {}) {
  const status = String(iteration.status || iteration.execution_status || "").toLowerCase();
  if (["failed", "error", "execution_failed", "exec_failed"].includes(status)) return true;
  return Boolean(iteration.execution_failed || iteration.exec_failed);
}

function iterationUnsupported(iteration = {}, scenarioType = "") {
  const kind = String(iteration.scenario_kind || iteration.scenario_type || scenarioType || "").toLowerCase();
  if (iteration.unsupported === true) return true;
  if (kind.includes("ookla") || kind.includes("fcc")) return true;
  if (kind === "unsupported") return true;
  return false;
}

export function evaluateDlUlIteration(iteration = {}, rulesInput = {}, scenarioType = "") {
  const rules = normalizeDlUlRules(rulesInput);
  if (iterationUnsupported(iteration, scenarioType)) {
    return {
      iteration_number: iteration.iteration_number ?? iteration.iterationNumber ?? null,
      actual_dl_mbps: numericOrNull(iteration.dl_mbps ?? iteration.dlMbps),
      actual_ul_mbps: numericOrNull(iteration.ul_mbps ?? iteration.ulMbps),
      dl_threshold: rules.dl_enabled ? rules.min_dl_mbps : null,
      ul_threshold: rules.ul_enabled ? rules.min_ul_mbps : null,
      dl_verdict: VERDICTS.NOT_EVALUATED,
      ul_verdict: VERDICTS.NOT_EVALUATED,
      overall_verdict: VERDICTS.NOT_EVALUATED,
      incomplete_reason: "unsupported_scenario",
    };
  }

  const actualDl = numericOrNull(iteration.dl_mbps ?? iteration.dlMbps);
  const actualUl = numericOrNull(iteration.ul_mbps ?? iteration.ulMbps);
  const execFailed = iterationExecutionFailed(iteration);

  let dlVerdict;
  let ulVerdict;
  let dlReason = null;
  let ulReason = null;

  if (!rules.dl_enabled) {
    dlVerdict = VERDICTS.NA;
  } else if (execFailed) {
    dlVerdict = VERDICTS.INCOMPLETE;
    dlReason = iteration.failure_reason || iteration.incomplete_reason || "execution_failure";
  } else {
    const cmp = compareThreshold(actualDl, rules.min_dl_mbps);
    dlVerdict = cmp.verdict;
    dlReason = cmp.reason;
  }

  if (!rules.ul_enabled) {
    ulVerdict = VERDICTS.NA;
  } else if (execFailed) {
    ulVerdict = VERDICTS.INCOMPLETE;
    ulReason = iteration.failure_reason || iteration.incomplete_reason || "execution_failure";
  } else {
    const cmp = compareThreshold(actualUl, rules.min_ul_mbps);
    ulVerdict = cmp.verdict;
    ulReason = cmp.reason;
  }

  const overall = combineDirectionVerdicts(
    [rules.dl_enabled ? dlVerdict : VERDICTS.NA, rules.ul_enabled ? ulVerdict : VERDICTS.NA],
    rules.combine_mode,
  );
  const incompleteReason =
    overall === VERDICTS.INCOMPLETE
      ? (dlReason === "missing_measurement" || ulReason === "missing_measurement"
        ? "missing_measurement"
        : dlReason || ulReason || iteration.incomplete_reason || iteration.failure_reason || "incomplete")
      : iteration.incomplete_reason || null;

  return {
    iteration_id: iteration.id || iteration.iteration_id || null,
    iteration_number: iteration.iteration_number ?? iteration.iterationNumber ?? null,
    timestamp: iteration.started_at || iteration.ended_at || iteration.timestamp || null,
    actual_dl_mbps: actualDl,
    actual_ul_mbps: actualUl,
    dl_threshold: rules.dl_enabled ? rules.min_dl_mbps : null,
    ul_threshold: rules.ul_enabled ? rules.min_ul_mbps : null,
    dl_verdict: dlVerdict,
    ul_verdict: ulVerdict,
    overall_verdict: overall,
    incomplete_reason: overall === VERDICTS.INCOMPLETE ? incompleteReason : null,
    failure_reason: overall === VERDICTS.FAIL ? (iteration.failure_reason || "below_threshold") : null,
  };
}

function rate(part, whole) {
  const p = numericOrNull(part);
  const w = numericOrNull(whole);
  if (p == null || w == null || w === 0) return null;
  return p / w;
}

export function evaluateDlUlRun({
  iterations = [],
  rules: rulesInput = {},
  scenarioType = "",
  requested = null,
  attempted = null,
  completed = null,
  failed = null,
} = {}) {
  const rules = normalizeDlUlRules(rulesInput);
  const evals = (iterations || []).map((it) => evaluateDlUlIteration(it, rules, scenarioType));
  const requestedN = numericOrNull(requested) ?? evals.length;
  const completedN = numericOrNull(completed)
    ?? evals.filter((e) => e.overall_verdict === VERDICTS.PASS || e.overall_verdict === VERDICTS.FAIL).length;
  const execFailedN = numericOrNull(failed)
    ?? evals.filter((e) => e.incomplete_reason === "execution_failure").length;
  const evaluable = evals.filter((e) => e.overall_verdict !== VERDICTS.NOT_EVALUATED && e.overall_verdict !== VERDICTS.NA);

  const dlPass = evals.filter((e) => e.dl_verdict === VERDICTS.PASS).length;
  const dlFail = evals.filter((e) => e.dl_verdict === VERDICTS.FAIL).length;
  const ulPass = evals.filter((e) => e.ul_verdict === VERDICTS.PASS).length;
  const ulFail = evals.filter((e) => e.ul_verdict === VERDICTS.FAIL).length;
  const overallPass = evals.filter((e) => e.overall_verdict === VERDICTS.PASS).length;
  const overallFail = evals.filter((e) => e.overall_verdict === VERDICTS.FAIL).length;

  const dlIncomplete = evals.filter((e) => e.dl_verdict === VERDICTS.INCOMPLETE).length;
  const ulIncomplete = evals.filter((e) => e.ul_verdict === VERDICTS.INCOMPLETE).length;
  const countDl = countBasedDirectionVerdict({
    enabled: rules.dl_enabled,
    passCount: dlPass,
    incompleteCount: dlIncomplete,
    requiredPassing: rules.required_dl_passing_iterations,
  });
  const countUl = countBasedDirectionVerdict({
    enabled: rules.ul_enabled,
    passCount: ulPass,
    incompleteCount: ulIncomplete,
    requiredPassing: rules.required_ul_passing_iterations,
  });
  const usingPassingCounts = countDl != null || countUl != null;

  let runVerdict;
  if (!rules.dl_enabled && !rules.ul_enabled) {
    runVerdict = VERDICTS.NOT_EVALUATED;
  } else if (evals.some((e) => e.overall_verdict === VERDICTS.NOT_EVALUATED) && evals.every((e) => e.overall_verdict === VERDICTS.NOT_EVALUATED)) {
    runVerdict = VERDICTS.NOT_EVALUATED;
  } else if (usingPassingCounts) {
    const parts = [];
    if (rules.dl_enabled) parts.push(countDl);
    if (rules.ul_enabled) parts.push(countUl);
    runVerdict = combineDirectionVerdicts(parts, rules.combine_mode);
  } else if (evals.some((e) => e.overall_verdict === VERDICTS.INCOMPLETE)) {
    runVerdict = VERDICTS.INCOMPLETE;
  } else if (rules.required_completed_iterations != null && completedN < rules.required_completed_iterations) {
    runVerdict = VERDICTS.INCOMPLETE;
  } else {
    runVerdict = combineDirectionVerdicts(evals.map((e) => e.overall_verdict), rules.combine_mode);
  }

  return {
    rules,
    iterations: evals,
    counts: {
      requested: requestedN,
      attempted: numericOrNull(attempted) ?? evals.length,
      completed: completedN,
      execution_failed: execFailedN,
      evaluable: evaluable.length,
      dl_pass: dlPass,
      dl_fail: dlFail,
      ul_pass: ulPass,
      ul_fail: ulFail,
      overall_pass: overallPass,
      overall_fail: overallFail,
      dl_pass_rate: rate(dlPass, evaluable.length),
      ul_pass_rate: rate(ulPass, evaluable.length),
      overall_pass_rate: rate(overallPass, evaluable.length),
    },
    dl_verdict: rules.dl_enabled
      ? (countDl || combineDirectionVerdicts(evals.map((e) => e.dl_verdict), "AND"))
      : VERDICTS.NA,
    ul_verdict: rules.ul_enabled
      ? (countUl || combineDirectionVerdicts(evals.map((e) => e.ul_verdict), "AND"))
      : VERDICTS.NA,
    overall_verdict: runVerdict,
  };
}

export default {
  DL_UL_DIRECTIONS,
  normalizeDlUlRules,
  evaluateDlUlIteration,
  evaluateDlUlRun,
};
