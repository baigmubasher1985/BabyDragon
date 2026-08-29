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
  resolveFieldResultsDashboardRole,
  F10C2_DASHBOARD_MOCK_ENABLED,
  artifactDownloadLabel,
  buildReportDownloadSlots,
  formatCountOrNA,
  fieldSectionEmptyCopy,
} from './models/fieldResultTypes.js';
export {
  computeTaskLevelQcOutcome,
  resolveRequiredScenarios,
  pickLatestValidRunPerScenario,
  TASK_FAIL_REASONS,
  F10C2_P4BU_E2E_REQUIRED_SCENARIOS,
} from './qc/taskLevelQcOutcome.js';
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
export { createSupabaseFieldResultsProvider } from './repository/supabaseFieldResultsProvider.js';
export { mapFieldTestRunRow } from './repository/mapFieldTestRunRow.js';
