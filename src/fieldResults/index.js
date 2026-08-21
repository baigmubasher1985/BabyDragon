/**
 * F10C2 Phase 3 — Field Results dashboard public exports.
 */

export { default as FieldResultsPage } from './components/FieldResultsPage.jsx';
export {
  createFieldResultsRepository,
  getFieldResultsRepository,
  resetFieldResultsRepository,
  FIELD_RESULTS_PROVIDER_KINDS,
} from './repository/fieldResultsRepository.js';
export {
  FIELD_RESULT_QC_DECISIONS,
  SCENARIO_LABELS,
  scenarioLabel,
  canAccessFieldResultsNav,
  canPerformFieldResultQc,
  F10C2_DASHBOARD_MOCK_ENABLED,
} from './models/fieldResultTypes.js';
export {
  validateFieldResultQcDecision,
  buildAppendQcHistoryEntry,
} from './qc/qcValidation.js';
export {
  buildListViewModel,
  buildDetailViewModel,
  emptyListFilters,
  toListRow,
} from './selectors/fieldResultSelectors.js';
export { buildFieldResultsFixtures, cloneFixtures } from './fixtures/fieldResultsFixtures.js';
