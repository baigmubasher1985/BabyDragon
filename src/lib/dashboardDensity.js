/**
 * CR1-D — user-selectable dashboard density.
 * Compact (default desktop) / Comfortable. localStorage only — not tenant business data.
 */

export const DASHBOARD_DENSITY_STORAGE_KEY = "bd-dashboard-density";
export const DASHBOARD_DENSITY_COMPACT = "compact";
export const DASHBOARD_DENSITY_COMFORTABLE = "comfortable";
export const DASHBOARD_DENSITY_OPTIONS = Object.freeze([
  DASHBOARD_DENSITY_COMPACT,
  DASHBOARD_DENSITY_COMFORTABLE,
]);

export function normalizeDashboardDensity(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === DASHBOARD_DENSITY_COMFORTABLE) return DASHBOARD_DENSITY_COMFORTABLE;
  return DASHBOARD_DENSITY_COMPACT;
}

export function readStoredDashboardDensity() {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return DASHBOARD_DENSITY_COMPACT;
    }
    return normalizeDashboardDensity(window.localStorage.getItem(DASHBOARD_DENSITY_STORAGE_KEY));
  } catch {
    return DASHBOARD_DENSITY_COMPACT;
  }
}

export function persistDashboardDensity(value) {
  const next = normalizeDashboardDensity(value);
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(DASHBOARD_DENSITY_STORAGE_KEY, next);
    }
  } catch {
    // localStorage may be unavailable; in-memory density still applies.
  }
  return next;
}

export function densityLabel(value) {
  return normalizeDashboardDensity(value) === DASHBOARD_DENSITY_COMFORTABLE
    ? "Comfortable"
    : "Compact";
}

export default {
  DASHBOARD_DENSITY_STORAGE_KEY,
  DASHBOARD_DENSITY_COMPACT,
  DASHBOARD_DENSITY_COMFORTABLE,
  normalizeDashboardDensity,
  readStoredDashboardDensity,
  persistDashboardDensity,
  densityLabel,
};
