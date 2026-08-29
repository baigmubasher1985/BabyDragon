/**
 * CR1-D-R1 — simple admin-facing rule form mapped onto existing profiles/engine.
 * Versioning, scope, and assignment stay internal. Default UI stays operational.
 */

import { classifyScenarioFamily, SCENARIO_FAMILIES } from "./scenarioApplicability.js";
import { numericOrNull } from "./verdicts.js";
import { canEditProfileVersion, createNewProfileVersion } from "./profileManagement.js";
import { resolveAcceptanceProfile, inactiveAssignmentMessage } from "./profileResolution.js";

export const RULE_UPDATED_TOAST = "Rule updated. Previous completed results remain unchanged.";

export function emptySimpleRuleForm() {
  return {
    name: "",
    description: "",
    requireDl: false,
    dlMinMbps: "10",
    dlPassingCount: "20",
    requireUl: false,
    ulMinMbps: "1",
    ulPassingCount: "20",
    requireMo: false,
    moSuccessCount: "10",
    requireMt: false,
    mtSuccessCount: "10",
  };
}

function asBool(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function directionsOf(rules = {}) {
  const raw = rules.enabled_directions || rules.directions || rules.enabledDirections || [];
  if (Array.isArray(raw)) return raw.map((v) => String(v).toLowerCase());
  return String(raw || "").toLowerCase().split(/[,+|]/).map((v) => v.trim()).filter(Boolean);
}

export function formFromProfile(profile) {
  const form = emptySimpleRuleForm();
  if (!profile) return form;
  form.name = profile.name || "";
  form.description = profile.description || "";
  const rules = profile.rules || {};
  const dl = rules.dl_ul || rules.dlUl || rules;
  const mo = rules.mo_mt || rules.moMt || {};
  const dirs = directionsOf(dl);
  const moDirs = (mo.enabled_directions || []).map((v) => String(v).toUpperCase());
  form.requireDl = dirs.includes("dl") || dirs.includes("download") || numericOrNull(dl.min_dl_mbps) != null;
  form.requireUl = dirs.includes("ul") || dirs.includes("upload") || numericOrNull(dl.min_ul_mbps) != null;
  if (!dirs.length && (dl.min_dl_mbps != null || dl.min_ul_mbps != null)) {
    form.requireDl = dl.min_dl_mbps != null;
    form.requireUl = dl.min_ul_mbps != null;
  }
  if (numericOrNull(dl.min_dl_mbps) != null) form.dlMinMbps = String(dl.min_dl_mbps);
  if (numericOrNull(dl.min_ul_mbps) != null) form.ulMinMbps = String(dl.min_ul_mbps);
  const dlPass = numericOrNull(dl.required_dl_passing_iterations ?? dl.required_completed_iterations);
  const ulPass = numericOrNull(dl.required_ul_passing_iterations ?? dl.required_completed_iterations);
  if (dlPass != null) form.dlPassingCount = String(dlPass);
  if (ulPass != null) form.ulPassingCount = String(ulPass);
  form.requireMo = moDirs.includes("MO") || numericOrNull(mo.required_mo_success) > 0;
  form.requireMt = moDirs.includes("MT") || numericOrNull(mo.required_mt_success) > 0;
  if (numericOrNull(mo.required_mo_success) != null) form.moSuccessCount = String(mo.required_mo_success);
  if (numericOrNull(mo.required_mt_success) != null) form.mtSuccessCount = String(mo.required_mt_success);
  return form;
}

export function profileRulesFromForm(form = emptySimpleRuleForm()) {
  const dlDirs = [];
  if (asBool(form.requireDl)) dlDirs.push("dl");
  if (asBool(form.requireUl)) dlDirs.push("ul");
  const moDirs = [];
  if (asBool(form.requireMo)) moDirs.push("MO");
  if (asBool(form.requireMt)) moDirs.push("MT");
  const dlPass = asBool(form.requireDl) ? numericOrNull(form.dlPassingCount) : null;
  const ulPass = asBool(form.requireUl) ? numericOrNull(form.ulPassingCount) : null;
  const completed = [dlPass, ulPass].filter((n) => n != null);
  return {
    dl_ul: {
      enabled_directions: dlDirs,
      min_dl_mbps: asBool(form.requireDl) ? numericOrNull(form.dlMinMbps) : null,
      min_ul_mbps: asBool(form.requireUl) ? numericOrNull(form.ulMinMbps) : null,
      required_dl_passing_iterations: dlPass,
      required_ul_passing_iterations: ulPass,
      required_completed_iterations: completed.length ? Math.max(...completed) : null,
      combine_mode: "AND",
      completion_policy: "min_passing",
    },
    mo_mt: {
      enabled_directions: moDirs,
      required_mo_success: asBool(form.requireMo) ? numericOrNull(form.moSuccessCount) : null,
      required_mt_success: asBool(form.requireMt) ? numericOrNull(form.mtSuccessCount) : null,
      combine_mode: "AND",
    },
  };
}

function part(label, enabled, count, unit) {
  if (!enabled) return null;
  return `${label}: ${count} ${unit}`;
}

export function summarizeSimpleRule(formOrProfile) {
  const form = formOrProfile?.rules ? formFromProfile(formOrProfile) : { ...emptySimpleRuleForm(), ...formOrProfile };
  const parts = [];
  if (form.requireDl) {
    parts.push(`DL: ${form.dlPassingCount} passes at ${form.dlMinMbps} Mbps`);
  }
  if (form.requireUl) {
    parts.push(`UL: ${form.ulPassingCount} passes at ${form.ulMinMbps} Mbps`);
  }
  const mo = part("MO", form.requireMo, form.moSuccessCount, "successes");
  const mt = part("MT", form.requireMt, form.mtSuccessCount, "successes");
  if (mo) parts.push(mo);
  if (mt) parts.push(mt);
  if (parts.length === 0) return "No requirements selected";
  return parts.join(" · ");
}

export function dlIterationPassCopy(minMbps, passingCount = 20) {
  return `DL passes when ${passingCount} completed iterations each reach at least ${minMbps} Mbps.`;
}

export function ulIterationPassCopy(minMbps, passingCount = 20) {
  return `UL passes when ${passingCount} completed iterations each reach at least ${minMbps} Mbps.`;
}

export const DATA_THROUGHPUT_NOTE =
  "Only completed iterations meeting the threshold count as passes. Missing evidence is marked Incomplete.";

export function sanitizeAssignmentError(error, fallback = "Assignment could not be saved. Try again.") {
  const raw = error == null ? "" : (typeof error === "string" ? error : String(error.message || error.code || error.errors?.[0] || ""));
  const text = raw.trim();
  if (!text) return fallback;
  const lower = text.toLowerCase();
  if (/jwt|bearer|service_role|anon key|postgres:\/\//i.test(text)) return fallback;
  if (lower.includes("forbidden") || lower.includes("forbidden_role") || lower.includes("forbidden_not_admin")) {
    return "Only admin accounts can assign criteria.";
  }
  if (lower.includes("not_authenticated") || lower.includes("not authenticated")) {
    return "Sign in as an admin to assign criteria.";
  }
  if (lower.includes("ambiguous") || lower.includes("23505") || lower.includes("duplicate key") || lower.includes("unique")) {
    return "This task already has a conflicting assignment. Try Change Assignment again.";
  }
  if (lower.includes("not_found") || lower.includes("no longer")) {
    return "The selected rule is no longer available.";
  }
  if (lower.includes("validation")) return text;
  if (/rpc|sqlstate|postgres|permission denied|row-level/i.test(text)) return fallback;
  if (text.length > 160) return fallback;
  return text;
}

export function sanitizeProfileStatusError(error) {
  const fallback = "Rule status could not be changed. Try again.";
  const raw = error == null ? "" : (typeof error === "string" ? error : String(error.message || error.code || error.errors?.[0] || ""));
  const text = raw.trim();
  const lower = text.toLowerCase();
  if (!text) return fallback;
  if (/jwt|bearer|service_role|anon key|postgres:\/\//i.test(text)) return fallback;
  if (lower.includes("forbidden_cross_tenant") || lower.includes("cross-tenant") || lower.includes("cross_tenant")) {
    return "That rule belongs to another organization.";
  }
  if (lower.includes("forbidden") || lower.includes("forbidden_role") || lower.includes("forbidden_not_admin")) {
    return "Only admin accounts can change rule status.";
  }
  if (lower.includes("not_authenticated") || lower.includes("not authenticated")) {
    return "Sign in as an admin to change rule status.";
  }
  if (lower.includes("not_found") || lower.includes("no longer")) {
    return "The selected rule is no longer available.";
  }
  if (/rpc|sqlstate|postgres|permission denied|row-level|status_update_failed/i.test(text)) return fallback;
  if (text.length > 160) return fallback;
  return fallback;
}

export const REPLACE_INACTIVE_ASSIGNMENT_COPY = "Replace the inactive assignment with an active saved rule.";

export function deactivateAssignmentWarning(assignedCount) {
  const n = Number(assignedCount) || 0;
  if (n <= 0) return null;
  return `This rule is assigned to ${n} open task(s). Completed results keep their original rule. Open tasks will use the next active criterion until you replace the assignment. Deactivate anyway?`;
}

export function previewDeactivateImpact(profile, profiles = []) {
  const assignedCount = countAssignedTasks(profile, profiles);
  return {
    assignedCount,
    warning: deactivateAssignmentWarning(assignedCount),
    requiresConfirm: assignedCount > 0,
  };
}

function isWholeNumber(value) {
  if (value === "" || value == null) return false;
  const n = Number(value);
  return Number.isFinite(n) && Number.isInteger(n);
}

function isNonNegativeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0;
}

export function validateSimpleRule(form = {}, { profiles = [], editingId = null } = {}) {
  const errors = [];
  const name = String(form.name || "").trim();
  if (!name) errors.push("Enter a rule name.");
  const anyEnabled = form.requireDl || form.requireUl || form.requireMo || form.requireMt;
  if (!anyEnabled) errors.push("Turn on at least one requirement before saving.");

  function countError(enabled, value, label) {
    if (!enabled) return;
    if (!isNonNegativeNumber(value)) {
      errors.push(`${label} cannot be negative.`);
      return;
    }
    if (!isWholeNumber(value)) {
      errors.push(`${label} must be a whole number.`);
      return;
    }
    if (Number(value) === 0) {
      errors.push(`${label} must be at least 1 when this requirement is on.`);
    }
  }

  if (form.requireDl) {
    if (!isNonNegativeNumber(form.dlMinMbps)) errors.push("Download minimum cannot be negative.");
    countError(true, form.dlPassingCount, "Required passing download iterations");
  }
  if (form.requireUl) {
    if (!isNonNegativeNumber(form.ulMinMbps)) errors.push("Upload minimum cannot be negative.");
    countError(true, form.ulPassingCount, "Required passing upload iterations");
  }
  countError(form.requireMo, form.moSuccessCount, "Required successful mobile-originated calls");
  countError(form.requireMt, form.mtSuccessCount, "Required successful mobile-terminated calls");

  const dup = (profiles || []).find((p) => {
    if (!p || p.is_active === false) return false;
    if (editingId && String(p.id) === String(editingId)) return false;
    if (!isReusableSavedRule(p)) return false;
    return String(p.name || "").trim().toLowerCase() === name.toLowerCase();
  });
  if (dup) errors.push(`An active rule named “${name}” already exists.`);

  return { ok: errors.length === 0, errors };
}

export function isReusableSavedRule(profile) {
  if (!profile) return false;
  if (profile.rule_kind === "assignment" || profile.is_assignment === true) return false;
  const scope = String(profile.scope_type || "");
  if (scope === "task") return false;
  return true;
}

export function countAssignedTasks(profile, profiles = []) {
  if (!profile) return 0;
  return (profiles || []).filter((p) => {
    if (!p || p.is_active === false) return false;
    if (String(p.scope_type) !== "task") return false;
    return String(p.cloned_from_id || "") === String(profile.id)
      || (String(p.name || "") === String(profile.name || "") && String(p.id) !== String(profile.id));
  }).length;
}

export function persistedVendorName(task = {}, project = {}) {
  const fromTask = task.vendor_name || task.vendor || task.projects?.vendor_name || task.projects?.vendor
    || task.projects?.customer || task.customer;
  const fromProject = project.vendor_name || project.vendor || project.customer;
  const value = fromTask || fromProject;
  if (value == null || String(value).trim() === "") return "—";
  return String(value);
}

export function persistedFeName(task = {}, fieldEngineers = []) {
  const id = task.assigned_to || task.assigned_fe || task.assigned_fe_id || task.fe_id;
  const fe = (fieldEngineers || []).find((row) => String(row.id) === String(id));
  const name = fe?.full_name || fe?.name || task.assigned_fe_name || task.fe_name;
  if (name && !String(name).includes("@")) return name;
  if (name && String(name).includes("@")) {
    const local = String(name).split("@")[0].replace(/[._]/g, " ");
    return local || "Assigned";
  }
  if (id) return "Assigned";
  return "Unassigned";
}

export function taskDisplayName(task = {}) {
  return task.target_name || task.title || task.name || task.grid_name || "Untitled task";
}

export function taskTestType(task = {}, project = {}) {
  return task.test_type || task.testing_type || task.projects?.testing_type || project.testing_type || "";
}

export function isOpenTask(task = {}) {
  const status = String(task.status || "").toLowerCase();
  if (["completed", "cancelled", "canceled", "closed", "archived"].includes(status)) return false;
  if (task.completed_at || task.completed_date) return false;
  return true;
}

export function mapTestTypeToFamily(testType) {
  const raw = String(testType || "").trim().toLowerCase();
  if (!raw) return null;
  if (raw.includes("iperf")) return "iperf3";
  if (raw.includes("http")) return "native_http";
  if (raw.includes("ftp")) return "ftp";
  if (raw.includes("ookla")) return "ookla_app";
  if (raw.includes("fcc")) return "fcc_app";
  if (raw.includes("voice") && raw.includes("mo")) return "voice_mo";
  if (raw.includes("voice") && raw.includes("mt")) return "voice_mt";
  if (raw.includes("voice")) return "voice";
  if (raw.includes("rf")) return "rf_data";
  if (raw.includes("combined")) return "combined";
  return raw;
}

export function ruleCompatibility(formOrProfile, testType) {
  const form = formOrProfile?.rules ? formFromProfile(formOrProfile) : { ...emptySimpleRuleForm(), ...formOrProfile };
  const family = classifyScenarioFamily(mapTestTypeToFamily(testType) || testType);
  const hasData = Boolean(form.requireDl || form.requireUl);
  const hasVoice = Boolean(form.requireMo || form.requireMt);
  if (!testType) return { ok: true, message: null };
  if (family === SCENARIO_FAMILIES.VOICE && hasData && !hasVoice) {
    return { ok: false, message: "This data rule cannot be assigned to a voice-only task." };
  }
  if (family === SCENARIO_FAMILIES.DATA && hasVoice && !hasData) {
    return { ok: false, message: "This voice rule cannot be assigned to a data-only task." };
  }
  if (family === SCENARIO_FAMILIES.RF && (hasData || hasVoice)) {
    return { ok: false, message: "This rule does not apply to RF-only tasks." };
  }
  return { ok: true, message: null };
}

export function currentCriteriaName(task, profiles = [], project = {}) {
  const resolved = resolveAcceptanceProfile({
    taskId: task.id,
    projectId: task.project_id || project.id,
    tenantId: task.tenant_id || project.tenant_id,
    scenarioType: mapTestTypeToFamily(taskTestType(task, project)),
    profiles,
  });
  const name = resolved?.profile?.name || "None";
  const taskSpecific = String(resolved?.scope || "").startsWith("task");
  if (resolved?.inactiveAssigned) {
    const warning = resolved.message || inactiveAssignmentMessage(resolved.profile);
    return {
      name,
      taskSpecific,
      scope: resolved.scope || null,
      inactiveAssigned: true,
      assignedName: resolved.inactiveAssigned.name || null,
      warning,
      replacePrompt: true,
      replacePromptCopy: REPLACE_INACTIVE_ASSIGNMENT_COPY,
    };
  }
  if (!resolved?.profile) return { name: "None", taskSpecific: false, scope: resolved?.scope || null };
  return { name, taskSpecific, scope: resolved.scope };
}

export function prepareSavedRuleUpdate(profile, snapshots = [], actor = {}) {
  const edit = canEditProfileVersion(profile, snapshots, actor);
  if (edit.ok) {
    return { ok: true, profile, createdNewVersion: false, toast: RULE_UPDATED_TOAST };
  }
  if (edit.code === "version_snapshotted") {
    const next = createNewProfileVersion(profile);
    return {
      ok: true,
      profile: next.profile,
      createdNewVersion: true,
      toast: RULE_UPDATED_TOAST,
    };
  }
  return { ok: false, code: edit.code, message: edit.message };
}

export function libraryProfileFromForm(form, { tenantId = null, now = () => new Date().toISOString() } = {}) {
  const id = `profile-rule-${Date.now()}`;
  return {
    id,
    name: String(form.name || "").trim(),
    description: String(form.description || "").trim(),
    version: 1,
    scope_type: "library",
    scope_id: id,
    tenant_id: tenantId,
    scenario_family: null,
    is_active: true,
    is_default: false,
    rule_kind: "library",
    assigned_count: 0,
    created_at: now(),
    updated_at: now(),
    rules: profileRulesFromForm(form),
  };
}

export function taskAssignmentFromLibrary(library, task, { now = () => new Date().toISOString() } = {}) {
  return {
    ...library,
    id: `profile-task-${task.id}-${library.id}`,
    scope_type: "task",
    scope_id: task.id,
    tenant_id: library.tenant_id || task.tenant_id || null,
    is_default: false,
    is_active: true,
    rule_kind: "assignment",
    cloned_from_id: library.id,
    cloned_from_version: library.version,
    // Task default (NULL family) so one Current Criteria row wins regardless of test-type spelling.
    scenario_family: null,
    assigned_count: 1,
    updated_at: now(),
    created_at: now(),
  };
}

export default {
  RULE_UPDATED_TOAST,
  emptySimpleRuleForm,
  formFromProfile,
  profileRulesFromForm,
  summarizeSimpleRule,
  dlIterationPassCopy,
  ulIterationPassCopy,
  DATA_THROUGHPUT_NOTE,
  sanitizeAssignmentError,
  sanitizeProfileStatusError,
  REPLACE_INACTIVE_ASSIGNMENT_COPY,
  deactivateAssignmentWarning,
  previewDeactivateImpact,
  validateSimpleRule,
  isReusableSavedRule,
  countAssignedTasks,
  persistedVendorName,
  persistedFeName,
  taskDisplayName,
  taskTestType,
  isOpenTask,
  mapTestTypeToFamily,
  ruleCompatibility,
  currentCriteriaName,
  prepareSavedRuleUpdate,
  libraryProfileFromForm,
  taskAssignmentFromLibrary,
};
