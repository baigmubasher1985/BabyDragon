/**
 * F10C2 Phase 3 — replaceable Field Results repository interface.
 *
 * Components MUST use this boundary — never query field_test_* tables directly.
 * Phase 3 ships mock/local provider only (no Supabase).
 */

import { createMockFieldResultsProvider } from './mockFieldResultsProvider.js';

export const FIELD_RESULTS_PROVIDER_KINDS = Object.freeze({
  MOCK: 'mock',
  // Future: SUPABASE: 'supabase' — not implemented in Phase 3
});

/**
 * @typedef {object} FieldResultsRepository
 * @property {string} kind
 * @property {(filters: object, pagination: object) => Promise<object>} listFieldResults
 * @property {(resultId: string) => Promise<object>} getFieldResult
 * @property {(resultId: string) => Promise<object>} listResultArtifacts
 * @property {(resultId: string) => Promise<object>} getResultQcHistory
 * @property {(resultId: string, decision: object, actor: object) => Promise<object>} saveResultQcDecision
 * @property {(resultId: string, reason: string, actor: object) => Promise<object>} createOrLinkRedrive
 * @property {(resultId: string, artifactId: string, actor: object) => Promise<object>} requestArtifactAccess
 * @property {() => Promise<object>} getFilterOptions
 * @property {(sim: object) => void} [setSimulation]
 * @property {() => void} [reset]
 */

/**
 * Factory — Phase 3 always returns mock provider.
 * Future Supabase provider can be selected here without rewriting pages.
 */
export function createFieldResultsRepository(options = {}) {
  const kind = options.kind || FIELD_RESULTS_PROVIDER_KINDS.MOCK;
  if (kind !== FIELD_RESULTS_PROVIDER_KINDS.MOCK) {
    throw new Error(
      `Field Results provider "${kind}" is not available in Phase 3 (mock-only).`,
    );
  }
  return createMockFieldResultsProvider(options);
}

/** Singleton used by dashboard UI (mock). */
let shared = null;

export function getFieldResultsRepository(options = {}) {
  if (!shared || options.forceNew) {
    shared = createFieldResultsRepository(options);
  }
  return shared;
}

export function resetFieldResultsRepository() {
  if (shared?.reset) shared.reset();
  shared = null;
}
