/**
 * CR1-D — acceptance profile management helpers (clone, version, assign, preview).
 * Does not persist field-test runs. Snapshotted versions stay immutable.
 */

import { evaluateFieldTestRun } from "./evaluateRun.js";
import { canMutateAcceptanceProfile } from "./permissions.js";
import {
  PROFILE_SCOPES,
  PROFILE_RESOLUTION_ORDER,
  profileScenarioFamily,
  resolveAcceptanceProfile,
  snapshotFromProfile,
} from "./profileResolution.js";

export const RF_RULES_SUPPORTED = false;

export function describeAssignmentKey(input = {}) {
  const scope = String(input.scope_type || input.scope || "").trim();
  const scopeId = input.scope_id == null ? "" : String(input.scope_id);
  const scenario = profileScenarioFamily(input) || "";
  return `${scope}::${scopeId}::${scenario}`;
}

export function findAmbiguousActiveAssignments(profiles = []) {
  const groups = new Map();
  for (const profile of profiles || []) {
    if (!profile || profile.is_active === false || profile.active === false) continue;
    const key = describeAssignmentKey(profile);
    const list = groups.get(key) || [];
    list.push(profile);
    groups.set(key, list);
  }
  const ambiguous = [];
  for (const [key, list] of groups) {
    if (list.length > 1) ambiguous.push({ key, matches: list.length, profiles: list });
  }
  return ambiguous;
}

export function isProfileVersionSnapshotted(profile, snapshots = []) {
  if (!profile?.id) return false;
  const version = profile.version ?? profile.profile_version;
  return (snapshots || []).some((snap) => (
    String(snap.profile_id) === String(profile.id)
    && Number(snap.profile_version) === Number(version)
  ));
}

export function canEditProfileVersion(profile, snapshots = [], actor = {}) {
  if (!canMutateAcceptanceProfile(actor.role || actor)) {
    return { ok: false, code: "forbidden_role" };
  }
  if (isProfileVersionSnapshotted(profile, snapshots)) {
    return { ok: false, code: "version_snapshotted", message: "Create a new version instead of editing a snapshotted profile." };
  }
  return { ok: true };
}

export function cloneProfile(profile, { nameSuffix = " (copy)", now = () => new Date().toISOString() } = {}) {
  if (!profile) return { ok: false, code: "profile_required" };
  const cloned = {
    ...profile,
    id: `profile-clone-${Date.now()}`,
    name: `${profile.name || "Profile"}${nameSuffix}`,
    version: 1,
    is_active: false,
    cloned_from_id: profile.id,
    cloned_from_version: profile.version ?? profile.profile_version ?? 1,
    created_at: now(),
    updated_at: now(),
    assigned_count: 0,
  };
  return { ok: true, profile: cloned };
}

export function createNewProfileVersion(profile, { now = () => new Date().toISOString() } = {}) {
  if (!profile) return { ok: false, code: "profile_required" };
  const nextVersion = Number(profile.version ?? profile.profile_version ?? 1) + 1;
  return {
    ok: true,
    profile: {
      ...profile,
      version: nextVersion,
      updated_at: now(),
      previous_version: profile.version ?? 1,
    },
  };
}

export function previewAssignmentOverride({
  profiles = [],
  taskId,
  projectId,
  tenantId,
  scenarioType,
  candidate,
} = {}) {
  const next = candidate ? [...(profiles || []), { ...candidate, is_active: true }] : (profiles || []);
  const current = resolveAcceptanceProfile({ taskId, projectId, tenantId, scenarioType, profiles });
  const preview = resolveAcceptanceProfile({ taskId, projectId, tenantId, scenarioType, profiles: next });
  const ambiguous = findAmbiguousActiveAssignments(next);
  return {
    ok: ambiguous.length === 0 && preview.ok,
    current,
    preview,
    would_override: Boolean(
      current.profile
      && preview.profile
      && current.profile.id !== preview.profile.id,
    ),
    ambiguous,
  };
}

function sameScopeId(a, b) {
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

/**
 * Replace (do not stack) active task-scoped assignments for one task.
 * Change Assignment must deactivate prior task rows so 215 unique(scope, family) cannot block.
 */
export function replaceActiveTaskAssignments(profiles = [], candidate) {
  if (!candidate) return [...(profiles || [])];
  const taskId = candidate.scope_id;
  const withoutActive = (profiles || []).map((p) => {
    if (!p || p.is_active === false) return p;
    if (String(p.scope_type || "") !== "task") return p;
    if (!sameScopeId(p.scope_id, taskId)) return p;
    return { ...p, is_active: false };
  });
  return [...withoutActive, { ...candidate, is_active: true }];
}

export function previewTaskAssignmentReplace({
  profiles = [],
  taskId,
  projectId,
  tenantId,
  scenarioType,
  candidate,
} = {}) {
  const next = replaceActiveTaskAssignments(profiles, candidate);
  const current = resolveAcceptanceProfile({ taskId, projectId, tenantId, scenarioType, profiles });
  const preview = resolveAcceptanceProfile({ taskId, projectId, tenantId, scenarioType, profiles: next });
  const candidateKey = describeAssignmentKey({ ...candidate, is_active: true });
  const ambiguous = findAmbiguousActiveAssignments(next).filter((group) => group.key === candidateKey);
  return {
    ok: ambiguous.length === 0 && preview.ok !== false,
    current,
    preview,
    would_override: Boolean(
      current.profile
      && preview.profile
      && current.profile.id !== preview.profile.id,
    ),
    ambiguous,
  };
}

/**
 * Manual sample preview. Does not persist a field-test run.
 */
export function previewAcceptanceCalculator({
  profile,
  scenarioType = "native_http",
  iterations = [],
  callEvents = [],
  requested,
  attempted,
  completed,
  failed,
} = {}) {
  if (!profile) {
    return { ok: false, code: "profile_required", persisted: false };
  }
  const evaluated = evaluateFieldTestRun({
    run: {
      task_id: profile.scope_type === "task" ? profile.scope_id : "preview-task",
      project_id: profile.scope_type === "project" ? profile.scope_id : "preview-project",
      tenant_id: profile.tenant_id || "preview-tenant",
      scenario_type: scenarioType,
      requested_iterations: requested ?? iterations.length,
      attempted_iterations: attempted ?? iterations.length,
      completed_iterations: completed ?? iterations.filter((i) => String(i.status || "").includes("complete")).length,
      failed_iterations: failed ?? iterations.filter((i) => String(i.status || "") === "failed").length,
    },
    iterations,
    callEvents,
    profiles: [{ ...profile, is_active: true }],
  });
  return {
    ...evaluated,
    persisted: false,
    rf_verdict: "N/A",
    rf_supported: RF_RULES_SUPPORTED,
  };
}

export function countAssignments(profile, profiles = []) {
  if (!profile) return 0;
  const key = describeAssignmentKey(profile);
  return (profiles || []).filter((p) => p.is_active !== false && describeAssignmentKey(p) === key).length;
}

export {
  PROFILE_SCOPES,
  PROFILE_RESOLUTION_ORDER,
  profileScenarioFamily,
  resolveAcceptanceProfile,
  snapshotFromProfile,
};

export default {
  RF_RULES_SUPPORTED,
  describeAssignmentKey,
  findAmbiguousActiveAssignments,
  isProfileVersionSnapshotted,
  canEditProfileVersion,
  cloneProfile,
  createNewProfileVersion,
  previewAssignmentOverride,
  replaceActiveTaskAssignments,
  previewTaskAssignmentReplace,
  previewAcceptanceCalculator,
  countAssignments,
};
