/**
 * F10C2 CR1-B — role gates for profiles, QC, and verdict overrides.
 * Client UX only; SQL RLS/RPC remain authoritative.
 */

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

export function isAnonymousActor(actor = {}) {
  if (!actor) return true;
  const role = normalizeRole(actor.role);
  if (role === "anonymous" || role === "anon" || role === "public") return true;
  if (actor.anonymous === true) return true;
  if (!actor.id && !actor.role) return true;
  return false;
}

export function isAdminOrSuperAdmin(role) {
  const r = normalizeRole(role);
  return r === "admin" || r === "super_admin";
}

export function canMutateAcceptanceProfile(role) {
  return isAdminOrSuperAdmin(role);
}

export function canSubmitFieldResultQc(actor = {}) {
  if (isAnonymousActor(actor)) return false;
  const r = normalizeRole(actor.role);
  if (r === "fe" || r === "field_engineer") return false;
  return isAdminOrSuperAdmin(r) || r === "qc" || r === "qc_reviewer";
}

export function canOverrideAcceptanceVerdict(actor = {}) {
  if (isAnonymousActor(actor)) return false;
  return isAdminOrSuperAdmin(actor.role);
}

export function denyQcMutation(actor = {}) {
  if (isAnonymousActor(actor)) {
    return { ok: false, code: "forbidden_anonymous", message: "Anonymous users cannot mutate QC." };
  }
  const r = normalizeRole(actor.role);
  if (r === "fe" || r === "field_engineer") {
    return { ok: false, code: "forbidden_role", message: "FE users cannot submit Field Result QC." };
  }
  if (!canSubmitFieldResultQc(actor)) {
    return { ok: false, code: "forbidden_role", message: "QC mutation is not authorized for this role." };
  }
  return { ok: true };
}

export function denyOverride(actor = {}) {
  if (isAnonymousActor(actor)) {
    return { ok: false, code: "forbidden_anonymous", message: "Anonymous users cannot override verdicts." };
  }
  if (!canOverrideAcceptanceVerdict(actor)) {
    return { ok: false, code: "forbidden_role", message: "Only admin and super_admin may override acceptance verdicts." };
  }
  return { ok: true };
}

export default {
  isAnonymousActor,
  isAdminOrSuperAdmin,
  canMutateAcceptanceProfile,
  canSubmitFieldResultQc,
  canOverrideAcceptanceVerdict,
  denyQcMutation,
  denyOverride,
};
