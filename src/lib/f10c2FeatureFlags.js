/**
 * F10C2 Phase 4 — runtime feature flags.
 *
 * Compile-time defaults remain Phase 2/3 safe:
 *   F10C2_SERVER_SUBMIT_ENABLED = false
 *   F10C2_MOCK_RESULT_UPLOAD_ENABLED = true
 *   dashboard provider = mock
 *
 * Live Supabase transport/provider activate only when Vite env explicitly opts in.
 * Never read service-role keys here (client bundle).
 */

function isVitestRuntime() {
  try {
    const proc = globalThis.process;
    return Boolean(proc?.env?.VITEST);
  } catch {
    return false;
  }
}

function readEnvRaw(name) {
  // Unit tests must not inherit dashboard/APK .env.local live flags.
  // Opt in with F10C2_TEST_ALLOW_LIVE_FLAGS=yes when a test is asserting live-provider wiring.
  if (isVitestRuntime()) {
    try {
      const allow = String(globalThis.process?.env?.F10C2_TEST_ALLOW_LIVE_FLAGS || "").toLowerCase() === "yes";
      if (!allow) return "";
      const fromProcess = globalThis.process?.env?.[name];
      if (fromProcess != null && String(fromProcess).trim() !== "") {
        return String(fromProcess).trim();
      }
    } catch {
      // process.env unavailable
    }
    return "";
  }
  try {
    const meta = import.meta.env;
    if (meta && meta[name] != null && String(meta[name]).trim() !== "") {
      return String(meta[name]).trim();
    }
  } catch {
    // import.meta.env unavailable
  }
  return "";
}

function asBoolean(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
  if (v === "false" || v === "0" || v === "no" || v === "off" || v === "") return false;
  return false;
}

/** Compile-time source-of-truth remains false; this is explicit runtime opt-in. */
export function isF10C2ServerSubmitRuntimeEnabled() {
  return asBoolean(readEnvRaw("VITE_F10C2_SERVER_SUBMIT_ENABLED"));
}

export function isF10C2MockResultUploadEnabled() {
  const raw = readEnvRaw("VITE_F10C2_MOCK_RESULT_UPLOAD_ENABLED");
  if (!raw) return true;
  return asBoolean(raw);
}

/**
 * Dashboard/QC provider kind. Default mock. "supabase" only when explicitly set.
 */
export function getFieldResultsProviderKind() {
  const v = readEnvRaw("VITE_F10C2_FIELD_RESULTS_PROVIDER").toLowerCase();
  if (v === "supabase") return "supabase";
  return "mock";
}

export function isFieldResultsSupabaseProviderEnabled() {
  return getFieldResultsProviderKind() === "supabase";
}

export const F10C2_SIGNED_URL_TTL_SECONDS = 120;

export default {
  isF10C2ServerSubmitRuntimeEnabled,
  isF10C2MockResultUploadEnabled,
  getFieldResultsProviderKind,
  isFieldResultsSupabaseProviderEnabled,
  F10C2_SIGNED_URL_TTL_SECONDS,
};
