/**
 * F10C2 Phase 2 — Auth gate for result upload (no JWT/refresh storage).
 * Server remains authoritative for submitted_by.
 */

import { sanitizeFeError } from "./resultRetryPolicy.js";
import { PACKAGE_STATES } from "./resultPackageStates.js";

/**
 * Compare queued owner vs current session user. Never store tokens.
 *
 * @param {object} params
 * @param {{ id?: string, email?: string } | null} params.currentUser
 * @param {string | null} params.queuedOwnerUserId
 * @param {boolean} [params.sessionValid]
 */
export function evaluateResultAuthGate({
  currentUser = null,
  queuedOwnerUserId = null,
  sessionValid = true,
} = {}) {
  if (!currentUser?.id) {
    return {
      ok: false,
      state: PACKAGE_STATES.BLOCKED_AUTH,
      code: "auth_expired_retryable",
      sanitized: "Sign in to resume result upload",
    };
  }

  if (!sessionValid) {
    return {
      ok: false,
      state: PACKAGE_STATES.BLOCKED_AUTH,
      code: "auth_expired_retryable",
      sanitized: "Session expired — sign in to resume",
    };
  }

  if (queuedOwnerUserId && queuedOwnerUserId !== currentUser.id) {
    return {
      ok: false,
      state: PACKAGE_STATES.FAILED_PERMANENT,
      code: "owner_mismatch",
      sanitized: "Queued result belongs to a different user on this device",
    };
  }

  return {
    ok: true,
    state: null,
    code: null,
    sanitized: null,
    // Client hint only — server RPC forces auth.uid() as submitted_by.
    owner_user_id_hint: currentUser.id,
  };
}

/**
 * Strip any accidental secret fields from queue/manifest payloads.
 */
export function stripSecretsFromPayload(payload = {}) {
  if (!payload || typeof payload !== "object") return {};
  const banned = new Set([
    "access_token",
    "refresh_token",
    "jwt",
    "authorization",
    "Authorization",
    "service_role",
    "serviceRole",
    "supabaseKey",
    "anon_key",
    "apikey",
  ]);
  const out = {};
  for (const [key, value] of Object.entries(payload)) {
    if (banned.has(key)) continue;
    if (key.toLowerCase().includes("token") && typeof value === "string") continue;
    if (key === "headers" && value && typeof value === "object") {
      const headers = { ...value };
      delete headers.Authorization;
      delete headers.authorization;
      out.headers = headers;
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function assertNoSecretsInRecord(record = {}) {
  const blob = JSON.stringify(record);
  const hits = [];
  if (/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\./.test(blob)) hits.push("jwt_like");
  if (/service[_-]?role/i.test(blob)) hits.push("service_role");
  if (/Bearer\s+[A-Za-z0-9\-._~+/]+=*/i.test(blob)) hits.push("bearer");
  return { ok: hits.length === 0, hits, sanitized: hits.length ? sanitizeFeError("secret_fields_rejected") : null };
}

export default {
  evaluateResultAuthGate,
  stripSecretsFromPayload,
  assertNoSecretsInRecord,
};
