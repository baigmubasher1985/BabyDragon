/**
 * F10C2 Phase 3 — Field Results list/detail selectors (pure).
 * Components must not query tables; they consume provider + these view models.
 */

import { formatDurationMs, scenarioLabel } from '../models/fieldResultTypes.js';

const DEFAULT_PAGE_SIZE = 10;

export function emptyListFilters() {
  return {
    project: '',
    vendor: '',
    market: '',
    grid: '',
    fe: '',
    scenario: '',
    dateFrom: '',
    dateTo: '',
    upload_state: '',
    processing_state: '',
    qc_decision: '',
    acceptance_verdict: '',
    failures_present: '',
    redrive_required: '',
    search: '',
    task: '',
    sortBy: 'started_at',
    sortDir: 'desc',
  };
}

function matchesText(hay, needle) {
  if (!needle) return true;
  return String(hay || '').toLowerCase().includes(String(needle).toLowerCase());
}

function inDateRange(iso, from, to) {
  if (!from && !to) return true;
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  if (from) {
    const f = new Date(from).getTime();
    if (!Number.isNaN(f) && t < f) return false;
  }
  if (to) {
    const end = new Date(to);
    if (!Number.isNaN(end.getTime())) {
      end.setHours(23, 59, 59, 999);
      if (t > end.getTime()) return false;
    }
  }
  return true;
}

function looksLikeUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function taskGridLabel(run) {
  const task = looksLikeUuid(run.task_name) ? null : (run.task_name || null);
  const grid = looksLikeUuid(run.grid_name) ? null : (run.grid_name || null);
  if (task && grid) return `${task} · ${grid}`;
  return task || grid || '—';
}

export function toListRow(run) {
  const counts = run.attempt_counts || {};
  return {
    id: run.id,
    client_run_id: run.client_run_id,
    canonical_package_id: run.canonical_package_id || run.package_identity || null,
    package_identity: run.package_identity || run.canonical_package_id || null,
    labeled_synthetic: run.labeled_synthetic === true,
    report_name: run.report_name,
    task_id: run.task_id,
    task_name: run.task_name,
    task_grid_label: taskGridLabel(run),
    project_id: run.project_id,
    project_name: run.project_name,
    vendor_name: run.vendor_name || run.customer || run.project_customer || '—',
    grid_id: run.grid_id,
    grid_name: run.grid_name,
    market: run.market,
    field_engineer_id: run.field_engineer?.id || null,
    field_engineer_name: run.field_engineer?.name || '—',
    scenario_type: run.scenario_type,
    scenario_label: scenarioLabel(run.scenario_type),
    started_at: run.started_at,
    ended_at: run.ended_at,
    duration_ms: run.duration_ms,
    duration_label: formatDurationMs(run.duration_ms),
    completion_status: run.completion_status,
    attempted: counts.attempted ?? null,
    completed: counts.completed ?? null,
    failed: counts.failed ?? null,
    requested: counts.requested ?? null,
    upload_state: run.upload_state,
    processing_state: run.processing_state,
    latest_qc_status: run.latest_qc_status,
    redrive_needed: !!run.redrive_needed,
    redrive_task_id: run.redrive_task_id || null,
    rf_summary_concise: run.rf_summary_concise || '—',
    data_summary_concise: run.data_summary_concise || '—',
    has_failures: !!run.has_failures,
    acceptance_verdict: run.acceptance_verdict || run.acceptance?.overall_verdict || null,
    acceptance_profile_version: run.acceptance?.profile_version || null,
    superseded: run.superseded === true || run.is_superseded === true,
    run_status: run.run_status || null,
    // Explicitly omit raw traces
    has_raw_rf_samples: false,
  };
}

export function filterRuns(runs, filters = {}) {
  const f = { ...emptyListFilters(), ...filters };
  return runs.filter((run) => {
    if (f.project && run.project_id !== f.project && run.project_name !== f.project) {
      if (!matchesText(run.project_name, f.project) && run.project_id !== f.project) return false;
    }
    if (f.vendor && !matchesText(run.vendor_name || run.customer, f.vendor) && run.vendor_name !== f.vendor) return false;
    if (f.market && !matchesText(run.market, f.market)) return false;
    if (f.grid && run.grid_id !== f.grid && !matchesText(run.grid_name, f.grid)) return false;
    if (f.fe) {
      const feId = run.field_engineer?.id;
      const feName = run.field_engineer?.name;
      if (feId !== f.fe && !matchesText(feName, f.fe)) return false;
    }
    if (f.task && run.task_id !== f.task && !matchesText(run.task_name, f.task)) return false;
    if (f.scenario && run.scenario_type !== f.scenario) return false;
    if (!inDateRange(run.started_at, f.dateFrom, f.dateTo)) return false;
    if (f.upload_state && run.upload_state !== f.upload_state) return false;
    if (f.processing_state && run.processing_state !== f.processing_state) return false;
    if (f.qc_decision && run.latest_qc_status !== f.qc_decision) return false;
    if (f.acceptance_verdict) {
      const verdict = run.acceptance_verdict || run.acceptance?.overall_verdict;
      if (verdict !== f.acceptance_verdict) return false;
    }
    if (f.failures_present === 'yes' && !run.has_failures) return false;
    if (f.failures_present === 'no' && run.has_failures) return false;
    if (f.redrive_required === 'yes' && !run.redrive_needed) return false;
    if (f.redrive_required === 'no' && run.redrive_needed) return false;
    if (f.search) {
      const blob = [
        run.report_name,
        run.task_name,
        run.grid_name,
        run.project_name,
        run.vendor_name,
        run.market,
        run.client_run_id,
        run.canonical_package_id,
        run.package_identity,
        run.id,
      ].join(' ');
      if (!matchesText(blob, f.search)) return false;
    }
    return true;
  });
}

export function sortRuns(runs, sortBy = 'started_at', sortDir = 'desc') {
  const dir = sortDir === 'asc' ? 1 : -1;
  const key = sortBy || 'started_at';
  return [...runs].sort((a, b) => {
    let av = a[key];
    let bv = b[key];
    if (key === 'field_engineer_name') {
      av = a.field_engineer?.name;
      bv = b.field_engineer?.name;
    }
    if (key === 'scenario_label') {
      av = scenarioLabel(a.scenario_type);
      bv = scenarioLabel(b.scenario_type);
    }
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
}

export function paginate(items, page = 1, pageSize = DEFAULT_PAGE_SIZE) {
  const size = Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE);
  const p = Math.max(1, Number(page) || 1);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const safePage = Math.min(p, totalPages);
  const start = (safePage - 1) * size;
  return {
    items: items.slice(start, start + size),
    page: safePage,
    pageSize: size,
    total,
    totalPages,
    hasNext: safePage < totalPages,
    hasPrev: safePage > 1,
  };
}

export function buildListViewModel(runs, filters, pagination = {}) {
  const filtered = filterRuns(runs, filters);
  const sorted = sortRuns(filtered, filters.sortBy, filters.sortDir);
  const page = paginate(sorted, pagination.page, pagination.pageSize);
  return {
    ...page,
    rows: page.items.map(toListRow),
    filters: { ...emptyListFilters(), ...filters },
  };
}

/**
 * Detail view model — summarized sections only.
 */
export function buildDetailViewModel(run) {
  if (!run) return null;
  const rf = run.rf_summary;
  return {
    id: run.id,
    overview: {
      report_name: run.report_name,
      result_id: run.id,
      client_run_id: run.client_run_id,
      canonical_package_id: run.canonical_package_id || run.package_identity || null,
      package_identity: run.package_identity || run.canonical_package_id || null,
      labeled_synthetic: run.labeled_synthetic === true,
      source_kind: run.source_kind || (run.labeled_synthetic ? 'synthetic' : null),
      scenario_type: run.scenario_type,
      scenario_label: scenarioLabel(run.scenario_type),
      task_name: run.task_name,
      task_id: run.task_id,
      project_name: run.project_name,
      vendor_name: run.vendor_name || run.customer || null,
      project_id: run.project_id,
      grid_name: run.grid_name,
      grid_id: run.grid_id,
      market: run.market,
      field_engineer: run.field_engineer,
      started_at: run.started_at,
      ended_at: run.ended_at,
      duration_label: formatDurationMs(run.duration_ms),
      device: run.device,
      upload_state: run.upload_state,
      processing_state: run.processing_state,
      latest_qc_status: run.latest_qc_status,
      redrive_needed: !!run.redrive_needed,
      redrive_task_id: run.redrive_task_id,
    },
    test_summary: run.test_summary || {},
    attempt_counts: run.attempt_counts || {},
    completion_status: run.completion_status,
    acceptance: run.acceptance || null,
    iteration_evaluations: run.iteration_evaluations || [],
    call_summary: run.call_summary || null,
    acceptance_override: run.acceptance_override || null,
    acceptance_verdict: run.acceptance_verdict || run.acceptance?.overall_verdict || null,
    rf_summary: rf
      ? {
          ...rf,
          // Ensure unavailable stay unavailable in presentation helpers
          presentation_note: rf.unavailable_reason || null,
        }
      : null,
    gps_summary: run.gps_summary,
    gps_trace_points: run.gps_trace_points || null,
    events_summary: run.events_summary,
    scenario_details: run.scenario_details,
    scenario_dashboard: run.scenario_details?.dashboard || null,
    artifacts: (run.artifacts || []).map((a) => ({
      ...a,
      // Never expose constructed public/signed URLs from selector
      public_url: undefined,
      signed_url: undefined,
      downloadable: a.available === true && a.missing !== true && a.upload_status === 'uploaded',
    })),
    qc_history: run.qc_history || [],
    has_raw_rf_samples: false,
  };
}

export function collectFilterOptions(runs) {
  const projects = new Map();
  const vendors = new Set();
  const markets = new Set();
  const grids = new Map();
  const fes = new Map();
  const scenarios = new Set();
  for (const r of runs) {
    projects.set(r.project_id, r.project_name);
    const vendor = r.vendor_name || r.customer;
    if (vendor && vendor !== '—') vendors.add(vendor);
    if (r.market) markets.add(r.market);
    grids.set(r.grid_id, r.grid_name);
    if (r.field_engineer?.id) fes.set(r.field_engineer.id, r.field_engineer.name);
    if (r.scenario_type) scenarios.add(r.scenario_type);
  }
  return {
    projects: [...projects.entries()].map(([id, name]) => ({ id, name })),
    vendors: [...vendors].sort(),
    markets: [...markets].sort(),
    grids: [...grids.entries()].map(([id, name]) => ({ id, name })),
    fieldEngineers: [...fes.entries()].map(([id, name]) => ({ id, name })),
    scenarios: [...scenarios].sort(),
  };
}
