import { createMockAcceptanceProfilesProvider } from "./mockAcceptanceProfilesProvider.js";
import { createSupabaseAcceptanceProfilesProvider } from "./supabaseAcceptanceProfilesProvider.js";
import { isFieldResultsSupabaseProviderEnabled } from "../../lib/f10c2FeatureFlags.js";

export function createAcceptanceProfilesRepository(options = {}) {
  if (options.kind === "mock") {
    return createMockAcceptanceProfilesProvider();
  }
  if (options.kind === "supabase" || (options.supabase && isFieldResultsSupabaseProviderEnabled())) {
    try {
      return createSupabaseAcceptanceProfilesProvider(options);
    } catch {
      return createMockAcceptanceProfilesProvider();
    }
  }
  return createMockAcceptanceProfilesProvider();
}

export { createMockAcceptanceProfilesProvider, createSupabaseAcceptanceProfilesProvider };
