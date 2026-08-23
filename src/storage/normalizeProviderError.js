/**
 * F10C2 Phase 4A — map provider errors to retryable/terminal codes.
 * Never include tokens, signed URLs, or secret material in sanitized text.
 */

const RETRYABLE = new Set([
  "network",
  "timeout",
  "offline",
  "temporary_5xx",
  "upload_interrupted",
  "auth_expired_retryable",
]);

const TERMINAL = new Set([
  "invalid_manifest",
  "invalid_mime",
  "oversized",
  "checksum_mismatch",
  "auth_forbidden",
  "not_assigned",
  "owner_mismatch",
  "provider_not_implemented",
  "retention_forbidden",
]);

function redact(text) {
  return String(text || "storage_error")
    .replace(/bearer\s+[a-z0-9\-._~+/]+=*/gi, "[redacted]")
    .replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, "[redacted]")
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/authorization\s*[:=]\s*\S+/gi, "authorization=[redacted]")
    .slice(0, 200);
}

export function normalizeProviderError(error) {
  if (!error) {
    return { kind: "retryable", code: "network", sanitized: "Temporary storage problem" };
  }
  const code = String(error.code || error.reason || "").toLowerCase();
  const message = String(error.message || error || "").toLowerCase();
  if (TERMINAL.has(code)) {
    return { kind: "terminal", code, sanitized: redact(error.message || code) };
  }
  if (RETRYABLE.has(code)) {
    return { kind: "retryable", code, sanitized: redact(error.message || code) };
  }
  if (message.includes("checksum") || message.includes("mime") || message.includes("oversized")) {
    return { kind: "terminal", code: "invalid_manifest", sanitized: redact(error.message) };
  }
  if (message.includes("forbidden") || message.includes("not_assigned")) {
    return { kind: "terminal", code: "auth_forbidden", sanitized: "Not authorized for this artifact" };
  }
  if (message.includes("not implemented") || message.includes("provider_not_implemented")) {
    return { kind: "terminal", code: "provider_not_implemented", sanitized: "Storage provider is not enabled" };
  }
  if (
    message.includes("network")
    || message.includes("timeout")
    || message.includes("failed to fetch")
    || message.includes("503")
  ) {
    return { kind: "retryable", code: "network", sanitized: "Temporary storage problem" };
  }
  return { kind: "retryable", code: "network", sanitized: redact(error.message) };
}

export default { normalizeProviderError };
