/**
 * CR1-D — mock acceptance-profile provider. No live SQL.
 */

import {
  cloneProfile,
  createNewProfileVersion,
  findAmbiguousActiveAssignments,
  isProfileVersionSnapshotted,
  previewAcceptanceCalculator,
  previewAssignmentOverride,
  previewTaskAssignmentReplace,
} from "../profileManagement.js";
import { canMutateAcceptanceProfile } from "../permissions.js";
import { resolveAcceptanceProfile } from "../profileResolution.js";
import {
  RULE_UPDATED_TOAST,
  countAssignedTasks,
  isReusableSavedRule,
  libraryProfileFromForm,
  prepareSavedRuleUpdate,
  profileRulesFromForm,
  sanitizeAssignmentError,
  sanitizeProfileStatusError,
  taskAssignmentFromLibrary,
  validateSimpleRule,
} from "../simpleRuleUx.js";

function seedProfiles() {
  return [
    {
      id: "profile-standard-data",
      name: "Standard Data Test",
      description: "Typical download and upload pass/fail rule.",
      version: 1,
      scope_type: "library",
      scope_id: "profile-standard-data",
      tenant_id: "tenant-syn-1",
      scenario_family: null,
      is_active: true,
      is_default: false,
      rule_kind: "library",
      assigned_count: 0,
      created_at: "2026-08-20T12:00:00.000Z",
      updated_at: "2026-08-20T12:00:00.000Z",
      rules: {
        dl_ul: {
          enabled_directions: ["dl", "ul"],
          min_dl_mbps: 10,
          min_ul_mbps: 1,
          required_dl_passing_iterations: 20,
          required_ul_passing_iterations: 20,
          combine_mode: "AND",
        },
      },
    },
    {
      id: "profile-tenant-default",
      name: "Default Data + Voice",
      description: "Default data and voice pass/fail rule.",
      version: 1,
      scope_type: "tenant",
      scope_id: null,
      tenant_id: "tenant-syn-1",
      scenario_family: null,
      is_active: true,
      is_default: true,
      rule_kind: "library",
      assigned_count: 1,
      created_at: "2026-08-20T12:00:00.000Z",
      updated_at: "2026-08-20T12:00:00.000Z",
      rules: {
        dl_ul: {
          enabled_directions: ["dl", "ul"],
          min_dl_mbps: 50,
          min_ul_mbps: 20,
          required_completed_iterations: 1,
          combine_mode: "AND",
        },
        mo_mt: { enabled_directions: ["MO", "MT"], required_mo_success: 1, required_mt_success: 1 },
      },
    },
    {
      id: "profile-project-http",
      name: "HTTP Throughput Rule",
      description: "Download and upload rule for HTTP field tasks.",
      version: 2,
      scope_type: "project",
      scope_id: "proj-syn-001",
      tenant_id: "tenant-syn-1",
      scenario_family: "native_http",
      is_active: true,
      is_default: false,
      rule_kind: "library",
      assigned_count: 1,
      created_at: "2026-08-21T12:00:00.000Z",
      updated_at: "2026-08-22T12:00:00.000Z",
      rules: {
        dl_ul: {
          enabled_directions: ["dl", "ul"],
          min_dl_mbps: 80,
          min_ul_mbps: 10,
          required_completed_iterations: 3,
          combine_mode: "AND",
        },
      },
    },
  ];
}

function withAssignedCounts(list) {
  return list.map((p) => (
    isReusableSavedRule(p)
      ? { ...p, assigned_count: countAssignedTasks(p, list) }
      : { ...p }
  ));
}

export function createMockAcceptanceProfilesProvider() {
  let profiles = seedProfiles();
  const snapshots = [
    { run_id: "run-native-http-success", profile_id: "profile-project-http", profile_version: 2 },
  ];

  return {
    kind: "mock",
    async listProfiles() {
      return { ok: true, profiles: withAssignedCounts(profiles) };
    },
    async resolveForContext(input = {}) {
      return resolveAcceptanceProfile({ ...input, profiles });
    },
    async clone(profileId, actor = {}) {
      if (!canMutateAcceptanceProfile(actor.role)) {
        return { ok: false, code: "forbidden_role" };
      }
      const src = profiles.find((p) => p.id === profileId);
      const cloned = cloneProfile(src);
      if (!cloned.ok) return cloned;
      profiles = [...profiles, cloned.profile];
      return cloned;
    },
    async createNewVersion(profileId, actor = {}) {
      if (!canMutateAcceptanceProfile(actor.role)) {
        return { ok: false, code: "forbidden_role" };
      }
      const src = profiles.find((p) => p.id === profileId);
      const next = createNewProfileVersion(src);
      if (!next.ok) return next;
      profiles = profiles.map((p) => (p.id === profileId ? next.profile : p));
      return next;
    },
    async saveRule(form, actor = {}) {
      if (!canMutateAcceptanceProfile(actor.role)) return { ok: false, code: "forbidden_role" };
      const named = String(form.name || "").trim().toLowerCase();
      const existingNamed = profiles.find((p) => (
        isReusableSavedRule(p)
        && p.is_active !== false
        && String(p.name || "").trim().toLowerCase() === named
      ));
      const check = validateSimpleRule(form, { profiles, editingId: existingNamed?.id || null });
      if (!check.ok) return { ok: false, code: "validation_failed", errors: check.errors, message: check.errors[0] };
      if (existingNamed) {
        return this.updateRule(existingNamed.id, form, actor);
      }
      const profile = libraryProfileFromForm(form, { tenantId: "tenant-syn-1" });
      profiles = [...profiles, profile];
      return { ok: true, profile, toast: "Rule saved." };
    },
    async updateRule(profileId, form, actor = {}) {
      if (!canMutateAcceptanceProfile(actor.role)) return { ok: false, code: "forbidden_role" };
      const src = profiles.find((p) => p.id === profileId);
      if (!src) return { ok: false, code: "not_found" };
      const check = validateSimpleRule(form, { profiles, editingId: profileId });
      if (!check.ok) return { ok: false, code: "validation_failed", errors: check.errors, message: check.errors[0] };
      const prepared = prepareSavedRuleUpdate(src, snapshots, actor);
      if (!prepared.ok) return prepared;
      const next = {
        ...prepared.profile,
        name: String(form.name || "").trim(),
        description: String(form.description || "").trim(),
        rules: profileRulesFromForm(form),
        updated_at: new Date().toISOString(),
      };
      profiles = profiles.map((p) => (p.id === profileId ? next : p));
      return { ok: true, profile: next, createdNewVersion: prepared.createdNewVersion, toast: RULE_UPDATED_TOAST };
    },
    async setActive(profileId, isActive, actor = {}) {
      if (!canMutateAcceptanceProfile(actor.role)) {
        return { ok: false, code: "forbidden_role", message: sanitizeProfileStatusError("forbidden_role") };
      }
      const src = profiles.find((p) => p.id === profileId);
      if (!src) return { ok: false, code: "not_found", message: sanitizeProfileStatusError("not_found") };
      const assigned = countAssignedTasks(src, profiles);
      const nextActive = Boolean(isActive);
      const unchanged = src.is_active === nextActive;
      let deactivatedAssignments = 0;
      profiles = profiles.map((p) => {
        if (p.id === profileId) return { ...p, is_active: nextActive };
        if (
          !nextActive
          && src.scope_type !== "task"
          && String(p.scope_type) === "task"
          && p.is_active !== false
          && (
            String(p.cloned_from_id || "") === String(profileId)
            || String(p.name || "") === String(src.name || "")
          )
        ) {
          deactivatedAssignments += 1;
          return { ...p, is_active: false };
        }
        return p;
      });
      return {
        ok: true,
        profile_id: profileId,
        is_active: nextActive,
        unchanged,
        active_assignment_count: assigned,
        deactivated_assignment_count: deactivatedAssignments,
      };
    },
    async assignToTasks(profileId, tasks = [], actor = {}) {
      if (!canMutateAcceptanceProfile(actor.role)) {
        return { ok: false, code: "forbidden_role", message: sanitizeAssignmentError("forbidden_role") };
      }
      const src = profiles.find((p) => p.id === profileId);
      if (!src) return { ok: false, code: "not_found", message: sanitizeAssignmentError("not_found") };
      const created = [];
      for (const task of tasks) {
        const candidate = taskAssignmentFromLibrary(src, task);
        const preview = previewTaskAssignmentReplace({
          profiles,
          taskId: task.id,
          projectId: task.project_id,
          scenarioType: candidate.scenario_family,
          candidate,
        });
        if (!preview.ok) {
          return {
            ok: false,
            code: "ambiguous_profile_resolution",
            message: sanitizeAssignmentError("ambiguous_profile_resolution"),
            preview,
          };
        }
        profiles = profiles.map((p) => {
          if (String(p.scope_type) === "task" && String(p.scope_id) === String(task.id) && p.is_active !== false) {
            return { ...p, is_active: false };
          }
          return p;
        });
        profiles = [...profiles, candidate];
        created.push(candidate);
      }
      return { ok: true, assigned: created.length };
    },
    async assign(profile, context, actor = {}) {
      if (!canMutateAcceptanceProfile(actor.role)) {
        return { ok: false, code: "forbidden_role" };
      }
      const preview = previewAssignmentOverride({
        profiles,
        ...context,
        candidate: profile,
      });
      if (!preview.ok) return { ok: false, code: "ambiguous_profile_resolution", preview };
      profiles = profiles.map((p) => (
        p.id === profile.id ? { ...p, ...profile, is_active: true } : p
      ));
      return { ok: true, preview };
    },
    async previewCalculator(input) {
      return previewAcceptanceCalculator(input);
    },
    isVersionLocked(profile) {
      return isProfileVersionSnapshotted(profile, snapshots);
    },
    ambiguousAssignments() {
      return findAmbiguousActiveAssignments(profiles);
    },
  };
}

export default { createMockAcceptanceProfilesProvider };
