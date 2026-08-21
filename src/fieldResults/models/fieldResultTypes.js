/**
 * F10C2 Phase 3 — Field Results shared types / labels.
 * Aligns with Phase 1 dashboard-qc contracts + Phase 2 scenario keys.
 * Client UX only — server RLS/RPC remain mandatory for live deploy.
 */

export const F10C2_DASHBOARD_MOCK_ENABLED = true;

/** Human-readable scenario labels for list/detail (Phase 3 requirement). */
export const SCENARIO_LABELS = Object.freeze({
  native_http: 'Native HTTP',
  ftp: 'FTP',
  iperf3: 'iPerf3',
  ookla_app: 'OOKLA',
  fcc_app: 'FCC',
  rf_data: 'RF Only',
  unified_field_report: 'Unified Field Report',
  voice: 'Voice',
});

export function scenarioLabel(scenarioType) {
  return SCENARIO_LABELS[scenarioType] || String(scenarioType || 'Unknown');
}

/**
 * Field-result QC decisions (additive vs task-level QCReview.jsx).
 * Includes "Waiting for Processing" from Phase 3 contract.
 * Does NOT rename/remove existing task-level decisions.
 */
export const FIELD_RESULT_QC_DECISIONS = Object.freeze([
  'QC Passed',
  'QC Failed',
  'Needs Re-drive',
  'Waiting for Processing',
  'Waiting for Logs',
  'Log Naming Issue',
  'Missing Evidence',
]);

/** Waiting / non-final decisions allowed while processing incomplete. */
export const QC_WAITING_DECISIONS = Object.freeze([
  'Waiting for Processing',
  'Waiting for Logs',
  'Log Naming Issue',
  'Missing Evidence',
]);

export const UPLOAD_STATES = Object.freeze([
  'queued',
  'uploading',
  'uploaded',
  'partial',
  'failed',
  'cancelled',
]);

export const PROCESSING_STATES = Object.freeze([
  'pending',
  'processing',
  'ready',
  'failed',
  'incomplete',
]);

export const COMPLETION_STATUSES = Object.freeze([
  'success',
  'complete_with_failures',
  'failed',
  'interrupted',
]);

export const ARTIFACT_TYPES = Object.freeze([
  'unified_json',
  'rf_csv',
  'gps_csv',
  'events_csv',
  'scenario_csv',
  'excel_plot',
  'ookla_evidence',
  'fcc_evidence',
  'package_zip',
  'other',
]);

export function formatDurationMs(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return '—';
  const total = Math.max(0, Math.round(Number(ms) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatMetric(value, unit = '') {
  if (value === null || value === undefined || value === '') return 'unavailable';
  if (typeof value === 'number' && !Number.isFinite(value)) return 'unavailable';
  return unit ? `${value} ${unit}` : String(value);
}

export function isAdminOrQcRole(role) {
  const r = String(role || '').toLowerCase();
  return r === 'admin' || r === 'super_admin' || r === 'qc' || r === 'qc_reviewer';
}

export function canAccessFieldResultsNav(role) {
  return isAdminOrQcRole(role);
}

export function canPerformFieldResultQc(role) {
  return isAdminOrQcRole(role);
}
