/**
 * F10C2 Phase 4 — fail-closed disposable target identity.
 *
 * Never prints secrets. Never treats the app VITE_SUPABASE_URL as disposable.
 * Production / unknown hosts are denied for apply, storage DDL, and live validation scripts.
 */

export const DISPOSABLE_CONFIRM_VALUE = "yes";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function trimStr(value) {
  return String(value || "").trim();
}

export function redactProjectRef(ref) {
  const raw = trimStr(ref);
  if (!raw) return "(none)";
  if (raw.length < 8) return `${raw.slice(0, 2)}…`;
  return `${raw.slice(0, 4)}…${raw.slice(-4)}`;
}

export function hostnameFromUrl(url) {
  const raw = trimStr(url);
  if (!raw) return "";
  try {
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return new URL(normalized).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function projectRefFromHostname(hostname) {
  const host = trimStr(hostname).toLowerCase();
  if (!host) return "";
  if (LOCAL_HOSTS.has(host) || host.endsWith(".local")) return "local-disposable";
  if (host.endsWith(".supabase.co")) return host.split(".")[0];
  return host.split(".")[0] || "";
}

export function isLocalDisposableHostname(hostname) {
  const host = trimStr(hostname).toLowerCase();
  return LOCAL_HOSTS.has(host) || host.endsWith(".supabase.redacted.local");
}

/**
 * @param {object} input
 * @param {string} [input.disposableUrl]
 * @param {string} [input.appViteUrl]  VITE_SUPABASE_URL — treated as denied for apply
 * @param {string} [input.confirmed]   must be "yes"
 * @param {string} [input.deniedProductionRef]
 * @param {string} [input.explicitDisposableRef]
 */
export function evaluateDisposableTarget(input = {}) {
  const disposableUrl = trimStr(input.disposableUrl);
  const appViteUrl = trimStr(input.appViteUrl);
  const confirmed = trimStr(input.confirmed).toLowerCase();
  const deniedProductionRef = trimStr(input.deniedProductionRef).toLowerCase();
  const explicitDisposableRef = trimStr(input.explicitDisposableRef).toLowerCase();

  const disposableHost = hostnameFromUrl(disposableUrl);
  const appHost = hostnameFromUrl(appViteUrl);
  const disposableRef = projectRefFromHostname(disposableHost);
  const appRef = projectRefFromHostname(appHost);

  const reasons = [];

  if (confirmed !== DISPOSABLE_CONFIRM_VALUE) {
    reasons.push("F10C2_DISPOSABLE_CONFIRMED must be exactly 'yes'");
  }
  if (!disposableUrl) {
    reasons.push("F10C2_DISPOSABLE_SUPABASE_URL is required");
  }
  if (!disposableHost) {
    reasons.push("disposable URL hostname could not be parsed");
  }
  if (appHost && disposableHost && appHost === disposableHost) {
    reasons.push("disposable hostname matches VITE_SUPABASE_URL hostname (denied app/production target)");
  }
  if (appRef && disposableRef && appRef === disposableRef && disposableRef !== "local-disposable") {
    reasons.push("disposable project ref matches app VITE project ref (denied)");
  }
  if (deniedProductionRef && disposableRef && disposableRef === deniedProductionRef) {
    reasons.push("disposable project ref matches explicit denied production ref");
  }
  if (explicitDisposableRef && disposableRef && disposableRef !== explicitDisposableRef && disposableRef !== "local-disposable") {
    reasons.push("disposable project ref does not match F10C2_DISPOSABLE_PROJECT_REF");
  }

  const local = isLocalDisposableHostname(disposableHost);
  const proven = reasons.length === 0 && Boolean(disposableHost);

  return {
    ok: proven,
    disposable: proven,
    local,
    hostname: disposableHost || null,
    projectRef: disposableRef || null,
    projectRefRedacted: redactProjectRef(disposableRef),
    appHostRedacted: appHost ? redactProjectRef(projectRefFromHostname(appHost)) : "(none)",
    reasons,
    commandCategory: input.commandCategory || "unspecified",
    changesDisposableProject: input.changesDisposableProject === true,
  };
}

export function assertDisposableTarget(input = {}) {
  const result = evaluateDisposableTarget(input);
  if (!result.ok) {
    const error = new Error(
      `disposable_target_rejected: ${result.reasons.join("; ") || "unknown"}`,
    );
    error.code = "disposable_target_rejected";
    error.reasons = result.reasons;
    throw error;
  }
  return result;
}

export default {
  DISPOSABLE_CONFIRM_VALUE,
  redactProjectRef,
  hostnameFromUrl,
  projectRefFromHostname,
  isLocalDisposableHostname,
  evaluateDisposableTarget,
  assertDisposableTarget,
};
