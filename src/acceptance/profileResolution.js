/**
 * F10C2 CR1-B / CR1-D / CR1-E — profile resolution.
 * Priority: task+scenario → task default → project+scenario → project default
 * → tenant+scenario → tenant default. Ambiguous matches at the winning level are rejected.
 *
 * Inactive profiles never win for new runs. Open tasks with an inactive assignment
 * fall back to the next active criterion and surface replace-assignment copy.
 * Completed-run snapshots stay outside this resolver (evaluateRun is idempotent).
 */

export const PROFILE_SCOPES = Object.freeze(["task", "project", "tenant"]);

export const PROFILE_RESOLUTION_ORDER = Object.freeze([
  "task+scenario",
  "task",
  "project+scenario",
  "project",
  "tenant+scenario",
  "tenant",
]);

export function inactiveAssignmentMessage(effectiveProfile) {
  const fallback = effectiveProfile?.name ? String(effectiveProfile.name) : "None";
  return `Assigned criterion is inactive; effective criterion is ${fallback}.`;
}

function sameId(a, b) {
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

function isRowActive(profile) {
  return Boolean(profile) && profile.is_active !== false && profile.active !== false;
}

function clonedFromId(profile) {
  return profile?.cloned_from_id
    || profile?.units?.cloned_from_id
    || profile?.rules?.cloned_from_id
    || profile?.rules?.dl_ul?.cloned_from_id
    || null;
}

function isEffectivelyActive(profile, all = []) {
  if (!isRowActive(profile)) return false;
  const parentId = clonedFromId(profile);
  if (!parentId) return true;
  const parent = (all || []).find((p) => sameId(p.id, parentId));
  if (!parent) return true;
  return isRowActive(parent);
}

function activeProfiles(profiles = []) {
  return (profiles || []).filter((p) => isEffectivelyActive(p, profiles));
}

export function profileScenarioFamily(profile) {
  if (!profile) return null;
  const value = profile.scenario_family
    || profile.scenarioFamily
    || profile.scenario_type
    || profile.test_type
    || profile.units?.scenario_family
    || profile.rules?.scenario_family
    || null;
  const text = value == null ? "" : String(value).trim();
  return text || null;
}

function scopeTypeOf(profile) {
  return String(profile?.scope_type || profile?.scope || "");
}

function isTenantDefault(profile) {
  return profile?.is_default === true || profile?.default === true;
}

function pickUnique(matches, scopeLabel) {
  if (matches.length > 1) {
    return { ok: false, code: "ambiguous_profile_resolution", scope: scopeLabel, matches: matches.length };
  }
  if (matches.length === 1) {
    return { ok: true, profile: matches[0], scope: scopeLabel };
  }
  return null;
}

function atScope(profiles, type, scopeId, tenantId) {
  return profiles.filter((p) => {
    if (scopeTypeOf(p) !== type) return false;
    if (type === "tenant") {
      if (tenantId && p.tenant_id && !sameId(p.tenant_id, tenantId)) return false;
      return true;
    }
    return sameId(p.scope_id, scopeId);
  });
}

function resolutionLevels(input = {}) {
  const taskId = input.taskId || input.task_id;
  const projectId = input.projectId || input.project_id;
  const tenantId = input.tenantId || input.tenant_id;
  return {
    taskId,
    projectId,
    tenantId,
    scenario: input.scenarioType || input.scenario_type || input.scenarioFamily || input.scenario_family || null,
    levels: [
      { type: "task", id: taskId, label: "task", tenantDefaultOnly: false },
      { type: "project", id: projectId, label: "project", tenantDefaultOnly: false },
      { type: "tenant", id: tenantId, label: "tenant", tenantDefaultOnly: true },
    ],
  };
}

function candidatesAtLevel(profiles, level, tenantId, scenario) {
  const scoped = atScope(profiles, level.type, level.id, tenantId);
  const tenantScoped = level.tenantDefaultOnly
    ? scoped.filter((p) => isTenantDefault(p) || profileScenarioFamily(p))
    : scoped;
  const buckets = [];
  if (scenario) {
    buckets.push({
      label: `${level.label}+scenario`,
      matches: tenantScoped.filter((p) => profileScenarioFamily(p) === String(scenario)),
    });
  }
  const defaults = tenantScoped.filter((p) => !profileScenarioFamily(p));
  const defaultPool = level.tenantDefaultOnly ? defaults.filter(isTenantDefault) : defaults;
  buckets.push({ label: level.label, matches: defaultPool });
  return buckets;
}

function walkActive(profiles, input = {}) {
  const { tenantId, scenario, levels } = resolutionLevels(input);
  for (const level of levels) {
    if (level.type !== "tenant" && !level.id) continue;
    for (const bucket of candidatesAtLevel(profiles, level, tenantId, scenario)) {
      const hit = pickUnique(bucket.matches, bucket.label);
      if (hit) return hit;
    }
  }
  return { ok: true, profile: null, scope: null, code: "no_profile" };
}

function findInactiveAssigned(allProfiles, input = {}) {
  const { tenantId, scenario, levels } = resolutionLevels(input);
  for (const level of levels) {
    if (level.type !== "tenant" && !level.id) continue;
    for (const bucket of candidatesAtLevel(allProfiles, level, tenantId, scenario)) {
      const active = bucket.matches.filter((p) => isEffectivelyActive(p, allProfiles));
      const inactive = bucket.matches.filter((p) => !isEffectivelyActive(p, allProfiles));
      if (active.length > 1) {
        return { ok: false, code: "ambiguous_profile_resolution", scope: bucket.label, matches: active.length };
      }
      if (active.length === 1) return null;
      if (inactive.length === 1) {
        return { ok: true, profile: inactive[0], scope: bucket.label };
      }
    }
  }
  return null;
}

/**
 * @param {object} input
 * @param {string} [input.taskId]
 * @param {string} [input.projectId]
 * @param {string} [input.tenantId]
 * @param {string} [input.scenarioType]
 * @param {object[]} input.profiles
 */
export function resolveAcceptanceProfile(input = {}) {
  const all = input.profiles || [];
  const result = walkActive(activeProfiles(all), input);
  if (result.ok === false) return result;

  const inactiveHit = findInactiveAssigned(all, input);
  if (inactiveHit && inactiveHit.ok === false) return inactiveHit;
  if (inactiveHit?.profile) {
    return {
      ...result,
      inactiveAssigned: inactiveHit.profile,
      inactiveAssignedScope: inactiveHit.scope,
      code: result.profile ? "inactive_assignment_fallback" : "inactive_assignment_no_fallback",
      message: inactiveAssignmentMessage(result.profile),
    };
  }
  return result;
}

export function snapshotFromProfile(profile, scope, evaluatedAt = new Date().toISOString()) {
  if (!profile) {
    return {
      profile_id: null,
      profile_version: null,
      scope: null,
      resolved_rules: null,
      units: { throughput: "Mbps" },
      effective_configuration: null,
      evaluated_at: evaluatedAt,
    };
  }
  const rules = profile.rules || profile.resolved_rules || {};
  return {
    profile_id: profile.id,
    profile_version: profile.version ?? profile.profile_version ?? 1,
    scope: scope || profile.scope_type || null,
    resolved_rules: { ...rules },
    units: profile.units || rules.units || { throughput: "Mbps" },
    effective_configuration: {
      name: profile.name || null,
      is_active: profile.is_active !== false,
      scope: scope || profile.scope_type || null,
      scope_id: profile.scope_id || null,
      tenant_id: profile.tenant_id || null,
      scenario_family: profileScenarioFamily(profile),
    },
    evaluated_at: evaluatedAt,
  };
}

export default {
  PROFILE_SCOPES,
  PROFILE_RESOLUTION_ORDER,
  inactiveAssignmentMessage,
  profileScenarioFamily,
  resolveAcceptanceProfile,
  snapshotFromProfile,
};
