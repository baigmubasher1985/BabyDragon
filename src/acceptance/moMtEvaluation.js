/**
 * F10C2 CR1-B — MO/MT acceptance from persisted immutable call events.
 * Disabled directions display N/A, never PASS.
 */

import { VERDICTS, numericOrNull, combineDirectionVerdicts } from "./verdicts.js";

function asList(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).toUpperCase()).filter(Boolean);
  if (value == null || value === "") return ["MO", "MT"];
  return String(value)
    .split(/[,+|]/)
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean);
}

export function normalizeMoMtRules(rules = {}) {
  const enabled = asList(rules.enabled_directions || rules.directions || rules.enabledDirections);
  return {
    mo_enabled: enabled.includes("MO"),
    mt_enabled: enabled.includes("MT"),
    combine_mode: String(rules.combine_mode || rules.combineMode || "AND").toUpperCase() === "OR" ? "OR" : "AND",
    required_mo_success: numericOrNull(rules.required_mo_success ?? rules.requiredMoSuccess) ?? 0,
    required_mt_success: numericOrNull(rules.required_mt_success ?? rules.requiredMtSuccess) ?? 0,
  };
}

function eventDirection(event = {}) {
  return String(event.direction || event.call_direction || "").toUpperCase();
}

function eventOutcome(event = {}) {
  const t = String(event.event_type || event.outcome || event.status || "").toLowerCase();
  if (["success", "successful", "connected", "completed"].includes(t)) return "successful";
  if (["fail", "failed", "failure", "dropped"].includes(t)) return "failed";
  if (["incomplete", "timeout", "no_answer", "busy"].includes(t)) return "incomplete";
  if (["attempt", "attempted", "originated", "terminated"].includes(t)) return "attempted";
  return "attempted";
}

/**
 * Count from persisted events only — never from editable FE summary fields.
 */
export function summarizeCallEvents(events = []) {
  const empty = {
    attempted: 0,
    successful: 0,
    failed: 0,
    incomplete: 0,
  };
  const mo = { ...empty };
  const mt = { ...empty };

  for (const event of events || []) {
    const dir = eventDirection(event);
    const bucket = dir === "MO" ? mo : dir === "MT" ? mt : null;
    if (!bucket) continue;
    bucket.attempted += 1;
    const outcome = eventOutcome(event);
    if (outcome === "successful") bucket.successful += 1;
    else if (outcome === "failed") bucket.failed += 1;
    else if (outcome === "incomplete") bucket.incomplete += 1;
  }

  return { mo, mt };
}

function directionVerdict(enabled, actualSuccess, requiredSuccess) {
  if (!enabled) return VERDICTS.NA;
  const required = numericOrNull(requiredSuccess) ?? 0;
  const actual = numericOrNull(actualSuccess) ?? 0;
  if (required <= 0) return VERDICTS.NOT_EVALUATED;
  if (actual >= required) return VERDICTS.PASS;
  return VERDICTS.FAIL;
}

export function evaluateMoMt({ events = [], rules: rulesInput = {}, labeledSynthetic = false } = {}) {
  const rules = normalizeMoMtRules(rulesInput);
  const counts = summarizeCallEvents(events);
  const moVerdict = directionVerdict(rules.mo_enabled, counts.mo.successful, rules.required_mo_success);
  const mtVerdict = directionVerdict(rules.mt_enabled, counts.mt.successful, rules.required_mt_success);

  let overall;
  if (!rules.mo_enabled && !rules.mt_enabled) {
    overall = VERDICTS.NOT_EVALUATED;
  } else {
    overall = combineDirectionVerdicts(
      [rules.mo_enabled ? moVerdict : VERDICTS.NA, rules.mt_enabled ? mtVerdict : VERDICTS.NA],
      rules.combine_mode,
    );
  }

  return {
    rules,
    labeled_synthetic: labeledSynthetic === true,
    mo: {
      ...counts.mo,
      required: rules.mo_enabled ? rules.required_mo_success : null,
      actual: counts.mo.successful,
      verdict: moVerdict,
    },
    mt: {
      ...counts.mt,
      required: rules.mt_enabled ? rules.required_mt_success : null,
      actual: counts.mt.successful,
      verdict: mtVerdict,
    },
    overall_verdict: overall,
  };
}

export default {
  normalizeMoMtRules,
  summarizeCallEvents,
  evaluateMoMt,
};
