const FALLBACK = "Login failed. Check your email and password and try again.";

function asText(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  return String(error.message || error.code || "");
}

function looksLikeInternalDetail(text) {
  const raw = String(text || "");
  return (
    /jwt|bearer\s+[a-z0-9\-._~+/]+=*|service_role|anon key|supabase\.co|eyJ[A-Za-z0-9_-]{10,}|postgres|connection string/i.test(
      raw
    )
  );
}

export function sanitizeLoginError(error) {
  const raw = asText(error).trim();
  if (!raw || looksLikeInternalDetail(raw)) return FALLBACK;

  const lower = raw.toLowerCase();

  if (
    lower.includes("invalid login") ||
    lower.includes("invalid credentials") ||
    lower.includes("invalid email or password") ||
    lower.includes("wrong password") ||
    lower.includes("user not found")
  ) {
    return "Invalid email or password.";
  }

  if (
    lower.includes("email not confirmed") ||
    lower.includes("not confirmed") ||
    lower.includes("user banned") ||
    lower.includes("disabled") ||
    lower.includes("inactive") ||
    lower.includes("account is not active")
  ) {
    return "This account is inactive. Contact an administrator.";
  }

  if (
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("failed to fetch") ||
    lower.includes("network") ||
    lower.includes("offline") ||
    lower.includes("err_internet") ||
    lower.includes("load failed")
  ) {
    return "Network error. Check your connection and try again.";
  }

  if (
    lower.includes("no role") ||
    lower.includes("unknown role") ||
    lower.includes("not authorized") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden")
  ) {
    return "This account is not authorized for BabyDragon.";
  }

  return FALLBACK;
}

export const LOGIN_ERROR_FALLBACK = FALLBACK;
