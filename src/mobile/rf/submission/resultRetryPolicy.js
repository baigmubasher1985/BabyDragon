/**
 * F10C2 Phase 2 — Bounded exponential backoff + error classification.
 * Contract: 1s / 5s / 15s / 60s cap; max 8 attempts. Jitter on delays.
 */

export const MAX_UPLOAD_ATTEMPTS = 8;

const BASE_DELAYS_MS = Object.freeze({
  1: 1000,
  2: 5000,
  3: 15000,
});

export const RETRYABLE_ERROR_CODES = Object.freeze([
  "offline",
  "network",
  "timeout",
  "temporary_5xx",
  "auth_expired_retryable",
  "upload_interrupted",
  "finalize_temporary",
]);

export const PERMANENT_ERROR_CODES = Object.freeze([
  "invalid_manifest",
  "foreign_task",
  "invalid_mime",
  "invalid_artifact_type",
  "oversized",
  "checksum_mismatch",
  "missing_required_local_artifact",
  "rejected_contract_version",
  "auth_forbidden",
  "not_assigned",
  "owner_mismatch",
]);

/**
 * Contract backoff (attempt 1 = first retry after failure).
 * @param {number} attempt
 * @returns {number}
 */
export function backoffDelayMs(attempt) {
  if (attempt <= 0) return BASE_DELAYS_MS[1];
  if (attempt >= 4) return 60000;
  return BASE_DELAYS_MS[attempt] || 60000;
}

/**
 * Backoff with deterministic-friendly jitter (±20%).
 * @param {number} attempt
 * @param {() => number} [rng] returns 0..1
 */
export function backoffDelayMsWithJitter(attempt, rng = Math.random) {
  const base = backoffDelayMs(attempt);
  const factor = 0.8 + (typeof rng === "function" ? rng() : Math.random()) * 0.4;
  return Math.max(250, Math.round(base * factor));
}

export function classifyUploadError(error) {
  if (!error) return { kind: "retryable", code: "network", sanitized: "Temporary sync problem" };

  const code = String(error.code || error.reason || "").toLowerCase();
  const message = String(error.message || error || "").toLowerCase();

  if (PERMANENT_ERROR_CODES.includes(code)) {
    return { kind: "permanent", code, sanitized: sanitizeFeError(error) };
  }
  if (RETRYABLE_ERROR_CODES.includes(code)) {
    return { kind: "retryable", code, sanitized: sanitizeFeError(error) };
  }

  if (
    message.includes("checksum") ||
    message.includes("invalid_manifest") ||
    message.includes("oversized") ||
    message.includes("mime") ||
    message.includes("foreign_task") ||
    message.includes("not_assigned") ||
    message.includes("forbidden")
  ) {
    const inferred = PERMANENT_ERROR_CODES.find((c) => message.includes(c)) || "invalid_manifest";
    return { kind: "permanent", code: inferred, sanitized: sanitizeFeError(error) };
  }

  if (
    message.includes("offline") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("failed to fetch") ||
    message.includes("5xx") ||
    message.includes("503") ||
    message.includes("interrupted")
  ) {
    return { kind: "retryable", code: "network", sanitized: sanitizeFeError(error) };
  }

  if (message.includes("auth") || message.includes("jwt") || message.includes("session")) {
    return { kind: "retryable", code: "auth_expired_retryable", sanitized: "Sign in again to resume upload" };
  }

  return { kind: "retryable", code: "network", sanitized: sanitizeFeError(error) };
}

/**
 * FE-safe error text — never include tokens / Authorization / raw stack.
 */
export function sanitizeFeError(error) {
  const raw = String(error?.message || error?.sanitized || error || "Upload failed");
  let text = raw
    .replace(/bearer\s+[a-z0-9\-._~+/]+=*/gi, "[redacted]")
    .replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, "[redacted]")
    .replace(/authorization\s*[:=]\s*\S+/gi, "authorization=[redacted]")
    .replace(/refresh[_-]?token\s*[:=]\s*\S+/gi, "refresh_token=[redacted]")
    .replace(/service[_-]?role\s*[:=]\s*\S+/gi, "[redacted]")
    .slice(0, 240);
  if (!text.trim()) text = "Upload failed";
  return text;
}

export function shouldGiveUp({ attempts, classification }) {
  if (classification?.kind === "permanent") return true;
  return Number(attempts || 0) >= MAX_UPLOAD_ATTEMPTS;
}

export default {
  MAX_UPLOAD_ATTEMPTS,
  RETRYABLE_ERROR_CODES,
  PERMANENT_ERROR_CODES,
  backoffDelayMs,
  backoffDelayMsWithJitter,
  classifyUploadError,
  sanitizeFeError,
  shouldGiveUp,
};
