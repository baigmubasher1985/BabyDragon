/**
 * F10C2 CR1-B — evaluate a canonical run into an immutable snapshot.
 * Re-evaluation of the same profile/version returns the same snapshot identity.
 */

import { VERDICTS, combineDirectionVerdicts } from "./verdicts.js";
import { resolveAcceptanceProfile, snapshotFromProfile } from "./profileResolution.js";
import { evaluateDlUlRun, normalizeDlUlRules } from "./dlUlEvaluation.js";
import { evaluateMoMt, normalizeMoMtRules } from "./moMtEvaluation.js";
import { resolveScenarioApplicability, voiceDirectionsForScenario } from "./scenarioApplicability.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

export function evaluateFieldTestRun({
  run = {},
  iterations = [],
  callEvents = [],
  profiles = [],
  existingSnapshot = null,
  evaluatedAt = new Date().toISOString(),
} = {}) {
  if (existingSnapshot && existingSnapshot.profile_id && existingSnapshot.resolved_rules) {
    return {
      ok: true,
      idempotent: true,
      snapshot: existingSnapshot,
    };
  }

  const resolved = resolveAcceptanceProfile({
    taskId: run.task_id || run.taskId,
    projectId: run.project_id || run.projectId,
    tenantId: run.tenant_id || run.tenantId,
    scenarioType: run.scenario_type || run.scenarioType,
    profiles,
  });
  if (!resolved.ok) {
    return { ok: false, code: resolved.code, error: resolved };
  }

  const snapshotMeta = snapshotFromProfile(resolved.profile, resolved.scope, evaluatedAt);
  if (!resolved.profile) {
    const snapshot = {
      ...snapshotMeta,
      overall_verdict: VERDICTS.NOT_EVALUATED,
      dl_verdict: VERDICTS.NOT_EVALUATED,
      ul_verdict: VERDICTS.NOT_EVALUATED,
      mo_verdict: VERDICTS.NOT_EVALUATED,
      mt_verdict: VERDICTS.NOT_EVALUATED,
      counts: {
        requested: run.requested_iterations ?? null,
        attempted: run.attempted_iterations ?? null,
        completed: run.completed_iterations ?? null,
        execution_failed: run.failed_iterations ?? null,
        evaluable: 0,
      },
      iteration_evaluations: [],
      call_summary: null,
    };
    return { ok: true, idempotent: false, snapshot };
  }

  const rules = resolved.profile.rules || {};
  const applicability = resolveScenarioApplicability({
    scenarioType: run.scenario_type || run.scenarioType,
    iterations,
    callEvents,
    profile: resolved.profile,
  });

  const dlUlRules = applicability.evaluate_data
    ? (rules.dl_ul || rules.dlUl || rules)
    : { enabled_directions: [] };
  const dlUl = evaluateDlUlRun({
    iterations: applicability.evaluate_data ? iterations : [],
    rules: dlUlRules,
    scenarioType: run.scenario_type,
    requested: run.requested_iterations,
    attempted: run.attempted_iterations,
    completed: run.completed_iterations,
    failed: run.failed_iterations,
  });

  const moMtRules = applicability.evaluate_voice
    ? {
      ...(rules.mo_mt || rules.moMt || {}),
      enabled_directions: voiceDirectionsForScenario(run.scenario_type || run.scenarioType),
    }
    : { enabled_directions: [] };
  const moMt = evaluateMoMt({
    events: applicability.evaluate_voice ? callEvents : [],
    rules: moMtRules,
    labeledSynthetic: Boolean(run.synthetic_call_events),
  });

  const overallParts = [];
  if (applicability.evaluate_data) overallParts.push(dlUl.overall_verdict);
  if (applicability.evaluate_voice) overallParts.push(moMt.overall_verdict);

  const snapshot = {
    ...snapshotMeta,
    resolved_rules: clone({
      dl_ul: normalizeDlUlRules(dlUlRules),
      mo_mt: normalizeMoMtRules(moMtRules),
      excluded_rules: applicability.excluded,
      applicability,
    }),
    overall_verdict: combineDirectionVerdicts(overallParts, "AND"),
    dl_verdict: applicability.evaluate_data ? dlUl.dl_verdict : VERDICTS.NA,
    ul_verdict: applicability.evaluate_data ? dlUl.ul_verdict : VERDICTS.NA,
    mo_verdict: applicability.evaluate_voice ? moMt.mo.verdict : VERDICTS.NA,
    mt_verdict: applicability.evaluate_voice ? moMt.mt.verdict : VERDICTS.NA,
    counts: dlUl.counts,
    iteration_evaluations: dlUl.iterations,
    call_summary: applicability.evaluate_voice ? moMt : {
      ...moMt,
      overall_verdict: VERDICTS.NA,
      mo: { ...moMt.mo, verdict: VERDICTS.NA, required: null },
      mt: { ...moMt.mt, verdict: VERDICTS.NA, required: null },
    },
  };

  return { ok: true, idempotent: false, snapshot };
}

export default { evaluateFieldTestRun };
