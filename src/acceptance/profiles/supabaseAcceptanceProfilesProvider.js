/**
 * CR1-D — live acceptance-profile provider against existing CR1-B tables.
 * Additive scenario_family SQL is optional; missing columns degrade to mock-compatible JSON config.
 */

import { canMutateAcceptanceProfile } from "../permissions.js";
import { resolveAcceptanceProfile } from "../profileResolution.js";
import {
  findAmbiguousActiveAssignments,
  isProfileVersionSnapshotted,
  previewAcceptanceCalculator,
  previewAssignmentOverride,
  previewTaskAssignmentReplace,
} from "../profileManagement.js";
import {
  RULE_UPDATED_TOAST,
  isReusableSavedRule,
  libraryProfileFromForm,
  profileRulesFromForm,
  sanitizeAssignmentError,
  sanitizeProfileStatusError,
  taskAssignmentFromLibrary,
  validateSimpleRule,
} from "../simpleRuleUx.js";

function profileRulesPayload(profile, extra = {}) {
  const family = Object.prototype.hasOwnProperty.call(extra, "scenario_family")
    ? extra.scenario_family
    : (profile?.scenario_family ?? null);
  const clonedFromId = extra.cloned_from_id ?? profile?.cloned_from_id ?? null;
  const clonedFromVersion = extra.cloned_from_version ?? profile?.cloned_from_version ?? null;
  const description = extra.description ?? profile?.description ?? "";
  const dl = {
    ...(profile?.rules?.dl_ul || {}),
    scenario_family: family,
    cloned_from_id: clonedFromId,
    cloned_from_version: clonedFromVersion,
    description,
  };
  return {
    ...(profile?.rules || {}),
    dl_ul: dl,
    scenario_family: family,
    description,
    cloned_from_id: clonedFromId,
    cloned_from_version: clonedFromVersion,
  };
}

function newLibraryScopeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `00000000-0000-4000-8000-${String(Date.now()).padStart(12, "0").slice(-12)}`;
}

function upsertError(error, extra = {}) {
  const message = sanitizeAssignmentError(error);
  if (/ambiguous_profile_resolution|23505|duplicate key/i.test(error?.message || "")) {
    return { ok: false, code: "ambiguous_profile_resolution", message, ...extra };
  }
  if (/forbidden/i.test(error?.message || error?.code || "")) {
    return { ok: false, code: "forbidden_role", message, ...extra };
  }
  return { ok: false, code: "sql_unavailable", message, ...extra };
}

function rulesForVersion(row, rules = []) {
  const version = Number(row?.version);
  const matching = (rules || []).filter((r) => Number(r.profile_version) === version);
  return matching.length ? matching : (rules || []);
}

function mapRow(row, rules = []) {
  const versioned = rulesForVersion(row, rules);
  const dl = versioned.find((r) => r.rule_type === "dl_ul") || {};
  const mo = versioned.find((r) => r.rule_type === "mo_mt") || {};
  const familyFromColumn = (row?.scenario_family == null || String(row.scenario_family).trim() === "")
    ? null
    : row.scenario_family;
  return {
    id: row.id,
    name: row.name,
    description: row.description || row.units?.description || dl.config?.description || "",
    version: row.version,
    scope_type: row.scope_type,
    scope_id: row.scope_id,
    tenant_id: row.tenant_id,
    // Column is source of truth. Config leftovers must not turn a task-default
    // (NULL family) into a scenario-specific row that the resolver then skips.
    scenario_family: familyFromColumn,
    is_active: row.is_active,
    is_default: row.is_default,
    assigned_count: null,
    cloned_from_id: row.cloned_from_id || dl.config?.cloned_from_id || null,
    cloned_from_version: row.cloned_from_version || dl.config?.cloned_from_version || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    units: row.units || { throughput: "Mbps" },
    rules: {
      dl_ul: {
        enabled_directions: dl.enabled_directions,
        min_dl_mbps: dl.min_dl_mbps,
        min_ul_mbps: dl.min_ul_mbps,
        required_completed_iterations: dl.required_completed_iterations,
        required_dl_passing_iterations: dl.config?.required_dl_passing_iterations ?? dl.required_dl_passing_iterations,
        required_ul_passing_iterations: dl.config?.required_ul_passing_iterations ?? dl.required_ul_passing_iterations,
        combine_mode: dl.combine_mode,
        completion_policy: dl.completion_policy,
      },
      mo_mt: {
        enabled_directions: mo.enabled_directions,
        required_mo_success: mo.required_mo_success,
        required_mt_success: mo.required_mt_success,
        combine_mode: mo.combine_mode,
      },
    },
  };
}

export function createSupabaseAcceptanceProfilesProvider({ supabase } = {}) {
  if (!supabase) throw new Error("supabase_client_required");

  async function loadProfiles() {
    const { data, error } = await supabase.from("acceptance_profiles").select("*").order("updated_at", { ascending: false });
    if (error) return { ok: false, code: "query_failed", message: error.message, profiles: [] };
    const ids = (data || []).map((p) => p.id);
    const rulesRes = ids.length
      ? await supabase.from("acceptance_rules").select("*").in("profile_id", ids)
      : { data: [] };
    const byProfile = new Map();
    for (const rule of rulesRes.data || []) {
      const list = byProfile.get(rule.profile_id) || [];
      list.push(rule);
      byProfile.set(rule.profile_id, list);
    }
    return { ok: true, profiles: (data || []).map((row) => mapRow(row, byProfile.get(row.id) || [])) };
  }

  return {
    kind: "supabase",
    async listProfiles() {
      return loadProfiles();
    },
    async resolveForContext(input = {}) {
      const loaded = await loadProfiles();
      if (!loaded.ok) return loaded;
      return resolveAcceptanceProfile({ ...input, profiles: loaded.profiles });
    },
    async clone(profileId, actor = {}) {
      if (!canMutateAcceptanceProfile(actor.role)) return { ok: false, code: "forbidden_role" };
      const loaded = await loadProfiles();
      const src = loaded.profiles.find((p) => p.id === profileId);
      if (!src) return { ok: false, code: "not_found" };
      const { data, error } = await supabase.rpc("upsert_acceptance_profile", {
        p_scope_type: src.scope_type,
        p_scope_id: src.scope_id,
        p_tenant_id: src.tenant_id,
        p_name: `${src.name} (copy)`,
        p_is_default: false,
        p_rules: profileRulesPayload(src),
      });
      if (error) return upsertError(error);
      return { ok: true, profile: data, sql_limited: true };
    },
    async createNewVersion(profileId, actor = {}) {
      if (!canMutateAcceptanceProfile(actor.role)) return { ok: false, code: "forbidden_role" };
      const loaded = await loadProfiles();
      const src = loaded.profiles.find((p) => p.id === profileId);
      if (!src) return { ok: false, code: "not_found" };
      const { data, error } = await supabase.rpc("upsert_acceptance_profile", {
        p_scope_type: src.scope_type,
        p_scope_id: src.scope_id,
        p_tenant_id: src.tenant_id,
        p_name: src.name,
        p_is_default: src.is_default,
        p_rules: profileRulesPayload(src),
      });
      if (error) return upsertError(error);
      return { ok: true, profile: data };
    },
    async saveRule(form, actor = {}) {
      if (!canMutateAcceptanceProfile(actor.role)) return { ok: false, code: "forbidden_role" };
      const loaded = await loadProfiles();
      const built = libraryProfileFromForm(form, { tenantId: actor.tenantId || null });
      const existingNamed = (loaded.profiles || []).find((p) => (
        isReusableSavedRule(p)
        && p.is_active !== false
        && String(p.name || "").trim().toLowerCase() === String(built.name).toLowerCase()
      ));
      const check = validateSimpleRule(form, { profiles: loaded.profiles || [], editingId: existingNamed?.id || null });
      if (!check.ok) return { ok: false, code: "validation_failed", errors: check.errors, message: check.errors[0] };
      if (existingNamed && (existingNamed.scope_type === "project" || existingNamed.scope_type === "tenant")) {
        const nextRules = profileRulesFromForm(form);
        const { data, error } = await supabase.rpc("upsert_acceptance_profile", {
          p_scope_type: existingNamed.scope_type,
          p_scope_id: existingNamed.scope_id,
          p_tenant_id: existingNamed.tenant_id,
          p_name: built.name,
          p_is_default: existingNamed.is_default === true,
          p_rules: profileRulesPayload({ ...existingNamed, rules: nextRules, description: form.description }),
        });
        if (error) return upsertError(error);
        return { ok: true, profile: data, createdNewVersion: true, toast: RULE_UPDATED_TOAST };
      }
      const scopeId = newLibraryScopeId();
      const { data, error } = await supabase.rpc("upsert_acceptance_profile", {
        p_scope_type: "project",
        p_scope_id: scopeId,
        p_tenant_id: built.tenant_id,
        p_name: built.name,
        p_is_default: false,
        p_rules: profileRulesPayload(built),
      });
      if (error) return upsertError(error);
      return { ok: true, profile: data, toast: "Rule saved." };
    },
    async updateRule(profileId, form, actor = {}) {
      if (!canMutateAcceptanceProfile(actor.role)) return { ok: false, code: "forbidden_role" };
      const loaded = await loadProfiles();
      const src = loaded.profiles.find((p) => p.id === profileId);
      if (!src) return { ok: false, code: "not_found" };
      const check = validateSimpleRule(form, { profiles: loaded.profiles, editingId: profileId });
      if (!check.ok) return { ok: false, code: "validation_failed", errors: check.errors, message: check.errors[0] };
      const nextRules = profileRulesFromForm(form);
      const { data, error } = await supabase.rpc("upsert_acceptance_profile", {
        p_scope_type: src.scope_type,
        p_scope_id: src.scope_id,
        p_tenant_id: src.tenant_id,
        p_name: String(form.name || "").trim(),
        p_is_default: src.is_default === true,
        p_rules: profileRulesPayload({ ...src, rules: nextRules, description: form.description }),
      });
      if (error) return upsertError(error);
      return { ok: true, profile: data, createdNewVersion: true, toast: RULE_UPDATED_TOAST };
    },
    async setActive(profileId, isActive, actor = {}) {
      if (!canMutateAcceptanceProfile(actor.role)) {
        return { ok: false, code: "forbidden_role", message: sanitizeProfileStatusError("forbidden_role") };
      }
      const { data, error } = await supabase.rpc("set_acceptance_profile_active", {
        p_profile_id: profileId,
        p_is_active: Boolean(isActive),
      });
      if (error) {
        return { ok: false, code: "status_update_failed", message: sanitizeProfileStatusError(error) };
      }
      if (!data || data.ok === false) {
        return {
          ok: false,
          code: data?.code || "status_update_failed",
          message: sanitizeProfileStatusError(data?.code || "status_update_failed"),
        };
      }
      return {
        ok: true,
        profile_id: data.profile_id || profileId,
        is_active: data.is_active,
        unchanged: data.unchanged === true,
        active_assignment_count: data.active_assignment_count ?? 0,
        deactivated_assignment_count: data.deactivated_assignment_count ?? 0,
        updated_by: data.updated_by || null,
        updated_at: data.updated_at || null,
      };
    },
    async assignToTasks(profileId, tasks = [], actor = {}) {
      if (!canMutateAcceptanceProfile(actor.role)) {
        return { ok: false, code: "forbidden_role", message: sanitizeAssignmentError("forbidden_role") };
      }
      let loaded = await loadProfiles();
      const src = loaded.profiles.find((p) => p.id === profileId);
      if (!src) return { ok: false, code: "not_found", message: sanitizeAssignmentError("not_found") };
      for (const task of tasks) {
        const candidate = taskAssignmentFromLibrary(src, {
          ...task,
          tenant_id: src.tenant_id || actor.tenantId || task.tenant_id,
        });
        const preview = previewTaskAssignmentReplace({
          profiles: loaded.profiles,
          taskId: task.id,
          projectId: task.project_id,
          tenantId: candidate.tenant_id,
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
        const existing = (loaded.profiles || []).filter((p) => (
          String(p.scope_type) === "task"
          && String(p.scope_id) === String(task.id)
          && p.is_active !== false
        ));
        for (const extra of existing) {
          await supabase
            .from("acceptance_profiles")
            .update({ is_active: false })
            .eq("id", extra.id);
        }
        const families = [];
        const seen = new Set();
        const addFamily = (value) => {
          const key = value == null || String(value).trim() === "" ? "" : String(value);
          if (seen.has(key)) return;
          seen.add(key);
          families.push(key === "" ? null : value);
        };
        addFamily(null);
        for (const row of existing) addFamily(row.scenario_family || null);
        for (const family of families) {
          const { error } = await supabase.rpc("upsert_acceptance_profile", {
            p_scope_type: "task",
            p_scope_id: task.id,
            p_tenant_id: candidate.tenant_id,
            p_name: src.name,
            p_is_default: false,
            p_rules: profileRulesPayload(candidate, {
              scenario_family: family,
              cloned_from_id: src.id,
              cloned_from_version: src.version,
            }),
          });
          if (error) return upsertError(error, { preview });
        }
        loaded = await loadProfiles();
        const saved = (loaded.profiles || []).some((p) => (
          String(p.scope_type) === "task"
          && String(p.scope_id) === String(task.id)
          && p.is_active !== false
          && String(p.name) === String(src.name)
        ));
        if (!saved) {
          return {
            ok: false,
            code: "assign_mismatch",
            message: "Assignment could not be saved. Try again.",
            preview,
          };
        }
      }
      return { ok: true, assigned: tasks.length };
    },
    async assign(profile, context, actor = {}) {
      if (!canMutateAcceptanceProfile(actor.role)) return { ok: false, code: "forbidden_role" };
      const loaded = await loadProfiles();
      const preview = previewAssignmentOverride({
        profiles: loaded.profiles,
        ...context,
        candidate: profile,
      });
      if (!preview.ok) return { ok: false, code: "ambiguous_profile_resolution", preview };
      const { error } = await supabase.rpc("upsert_acceptance_profile", {
        p_scope_type: profile.scope_type,
        p_scope_id: profile.scope_id,
        p_tenant_id: profile.tenant_id,
        p_name: profile.name,
        p_is_default: profile.is_default === true,
        p_rules: profileRulesPayload(profile, {
          scenario_family: profile.scenario_family || context.scenarioType || null,
        }),
      });
      if (error) return upsertError(error, { preview });
      return { ok: true, preview };
    },
    async previewCalculator(input) {
      return previewAcceptanceCalculator(input);
    },
    async isVersionLocked(profile) {
      const { data } = await supabase
        .from("field_test_run_acceptance_snapshots")
        .select("profile_id,profile_version")
        .eq("profile_id", profile.id)
        .eq("profile_version", profile.version)
        .limit(1);
      return isProfileVersionSnapshotted(profile, data || []);
    },
    async ambiguousAssignments() {
      const loaded = await loadProfiles();
      return findAmbiguousActiveAssignments(loaded.profiles || []);
    },
  };
}

export default { createSupabaseAcceptanceProfilesProvider };
