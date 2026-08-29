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
  ookla: 'OOKLA',
  fcc_app: 'FCC',
  fcc: 'FCC',
  rf_data: 'RF Only',
  rf_only: 'RF Only',
  unified_field_report: 'Unified Field Report',
  voice: 'Voice',
  voice_mo: 'Voice MO',
  voice_mt: 'Voice MT',
  combined: 'Combined data + voice',
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

/** Human labels for report download slots. */
export const ARTIFACT_DOWNLOAD_LABELS = Object.freeze({
  unified_json: 'JSON',
  excel_plot: 'Excel Plot',
  scenario_csv: 'CSV',
  package_zip: 'Unified ZIP',
  rf_csv: 'RF raw trace',
  gps_csv: 'GPS/route trace',
  events_csv: 'Events CSV',
  ookla_evidence: 'OOKLA evidence',
  fcc_evidence: 'FCC evidence',
  other: 'Other',
});

export const EXPECTED_REPORT_DOWNLOAD_SLOTS = Object.freeze([
  'unified_json',
  'excel_plot',
  'scenario_csv',
  'package_zip',
  'rf_csv',
  'gps_csv',
]);

export function artifactDownloadLabel(artifactType) {
  return ARTIFACT_DOWNLOAD_LABELS[artifactType] || String(artifactType || 'Other');
}

/**
 * Present expected report downloads without fabricating artifacts.
 * Missing/pending slots are labeled; download stays hidden until a real uploaded artifact exists.
 */
export function buildReportDownloadSlots(artifacts = []) {
  const list = Array.isArray(artifacts) ? artifacts : [];
  const byType = new Map();
  for (const art of list) {
    const type = art?.artifact_type || 'other';
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(art);
  }
  const slots = [];
  const seen = new Set();
  for (const type of EXPECTED_REPORT_DOWNLOAD_SLOTS) {
    seen.add(type);
    const matches = byType.get(type) || [];
    if (matches.length === 0) {
      slots.push({
        slot_type: type,
        label: artifactDownloadLabel(type),
        status: 'missing',
        downloadable: false,
        artifact: null,
      });
      continue;
    }
    for (const art of matches) {
      const uploaded = art.available === true && art.missing !== true && art.upload_status === 'uploaded';
      const pending = !uploaded && (art.upload_status === 'pending' || art.upload_status === 'uploading' || art.processing_status === 'pending');
      slots.push({
        slot_type: type,
        label: artifactDownloadLabel(type),
        status: uploaded ? 'available' : pending ? 'pending' : 'missing',
        downloadable: uploaded,
        artifact: art,
      });
    }
  }
  for (const art of list) {
    const type = art?.artifact_type || 'other';
    if (seen.has(type)) continue;
    const uploaded = art.available === true && art.missing !== true && art.upload_status === 'uploaded';
    slots.push({
      slot_type: type,
      label: artifactDownloadLabel(type),
      status: uploaded ? 'available' : 'pending',
      downloadable: uploaded,
      artifact: art,
    });
  }
  return slots;
}

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

/** Sample counts: missing stays N/A — never coerced to 0. Persisted 0 remains 0. */
export function formatCountOrNA(value) {
  if (value === null || value === undefined || value === '') return 'N/A';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'N/A';
  }
  const numeric = Number(value);
  if (String(value).trim() !== '' && Number.isFinite(numeric)) return String(numeric);
  return 'N/A';
}

export function sanitizeUnavailableReason(reason) {
  const text = String(reason || '')
    .replace(/jwt|bearer\s+\S+|service_role|anon key|postgres(?:ql)?:\/\/\S+|rpc\b|sqlstate/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.slice(0, 120);
}

/**
 * Empty-state copy for Field Results sections. Missing never renders as zero.
 */
export function fieldSectionEmptyCopy(input = {}) {
  if (input.loading) return 'Loading…';
  if (input.hasData) return null;
  const sanitized = sanitizeUnavailableReason(input.reason);
  if (sanitized) return `Unavailable due to ${sanitized}`;
  const processing = String(input.processing || '').toLowerCase();
  if (processing && /process|pending|queued/.test(processing)) return 'Processing';
  const uploaded = input.uploaded;
  if (uploaded === false || /not[_ ]upload|pending upload/i.test(String(uploaded || ''))) {
    return 'Not uploaded';
  }
  if (input.synthetic && input.kind === 'throughput') {
    return 'No throughput samples were uploaded for this synthetic validation result.';
  }
  return 'Not collected for this test';
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

/**
 * AdminDashboard is admin/super_admin only, but the Auth user object often
 * carries JWT role "authenticated". That must not hide QC controls.
 * Explicit FE/anon roles stay denied.
 */
export function resolveFieldResultsDashboardRole(role, user) {
  const raw = String(role || user?.role || user?.appRole || 'admin').trim().toLowerCase();
  if (isAdminOrQcRole(raw)) return raw;
  if (raw === 'fe' || raw === 'field_engineer' || raw === 'anon' || raw === 'anonymous') {
    return raw;
  }
  if (raw === 'authenticated' || raw === '') return 'admin';
  return raw || 'admin';
}
