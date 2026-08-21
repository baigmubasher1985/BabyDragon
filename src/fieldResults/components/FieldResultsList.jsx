/**
 * F10C2 Phase 3 — Field Results list (admin/QC).
 * Data via repository only — no direct table queries.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { emptyListFilters } from '../selectors/fieldResultSelectors.js';
import { scenarioLabel } from '../models/fieldResultTypes.js';
import './FieldResults.css';

function badgeClassForQc(decision) {
  if (decision === 'QC Passed') return 'bdfr-badge bdfr-badge-pass';
  if (decision === 'QC Failed') return 'bdfr-badge bdfr-badge-fail';
  if (decision === 'Needs Re-drive') return 'bdfr-badge bdfr-badge-redrive';
  if (decision === 'Log Naming Issue' || decision === 'Missing Evidence') {
    return 'bdfr-badge bdfr-badge-warn';
  }
  return 'bdfr-badge bdfr-badge-wait';
}

function badgeClassForUpload(state) {
  if (state === 'uploaded') return 'bdfr-badge bdfr-badge-ok';
  if (state === 'partial' || state === 'uploading' || state === 'queued') {
    return 'bdfr-badge bdfr-badge-partial';
  }
  if (state === 'failed') return 'bdfr-badge bdfr-badge-fail';
  return 'bdfr-badge bdfr-badge-wait';
}

export default function FieldResultsList({
  repository,
  filterOptions,
  onOpenResult,
}) {
  const [filters, setFilters] = useState(() => emptyListFilters());
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await repository.listFieldResults(filters, { page, pageSize: 8 });
      if (!res.ok) {
        setError(res.error?.message || 'Failed to load field results.');
        setData(null);
      } else {
        setData(res);
      }
    } catch (err) {
      setError(err?.message || 'Unexpected list error.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [repository, filters, page]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        const res = await repository.listFieldResults(filters, { page, pageSize: 8 });
        if (cancelled) return;
        if (!res.ok) {
          setError(res.error?.message || 'Failed to load field results.');
          setData(null);
        } else {
          setData(res);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || 'Unexpected list error.');
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repository, filters, page]);

  function updateFilter(key, value) {
    setPage(1);
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function resetFilters() {
    setPage(1);
    setFilters(emptyListFilters());
  }

  function toggleSort(col) {
    setFilters((prev) => {
      if (prev.sortBy === col) {
        return { ...prev, sortDir: prev.sortDir === 'asc' ? 'desc' : 'asc' };
      }
      return { ...prev, sortBy: col, sortDir: 'desc' };
    });
  }

  const options = filterOptions || {
    projects: [],
    markets: [],
    grids: [],
    fieldEngineers: [],
    scenarios: [],
  };

  const rows = data?.rows || [];

  const scenarioOptions = useMemo(
    () => options.scenarios.map((s) => ({ id: s, label: scenarioLabel(s) })),
    [options.scenarios],
  );

  return (
    <div>
      <div className="bdfr-filters" role="search" aria-label="Field Results filters">
        <label>
          Search
          <input
            aria-label="Search report, task, or grid"
            value={filters.search}
            onChange={(e) => updateFilter('search', e.target.value)}
            placeholder="Report / task / grid"
          />
        </label>
        <label>
          Project
          <select
            aria-label="Filter by project"
            value={filters.project}
            onChange={(e) => updateFilter('project', e.target.value)}
          >
            <option value="">All</option>
            {options.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Market
          <select
            aria-label="Filter by market"
            value={filters.market}
            onChange={(e) => updateFilter('market', e.target.value)}
          >
            <option value="">All</option>
            {options.markets.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label>
          Grid
          <select
            aria-label="Filter by grid"
            value={filters.grid}
            onChange={(e) => updateFilter('grid', e.target.value)}
          >
            <option value="">All</option>
            {options.grids.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          FE
          <select
            aria-label="Filter by field engineer"
            value={filters.fe}
            onChange={(e) => updateFilter('fe', e.target.value)}
          >
            <option value="">All</option>
            {options.fieldEngineers.map((fe) => (
              <option key={fe.id} value={fe.id}>
                {fe.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Scenario
          <select
            aria-label="Filter by scenario"
            value={filters.scenario}
            onChange={(e) => updateFilter('scenario', e.target.value)}
          >
            <option value="">All</option>
            {scenarioOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Start date
          <input
            type="date"
            aria-label="Start date"
            value={filters.dateFrom}
            onChange={(e) => updateFilter('dateFrom', e.target.value)}
          />
        </label>
        <label>
          End date
          <input
            type="date"
            aria-label="End date"
            value={filters.dateTo}
            onChange={(e) => updateFilter('dateTo', e.target.value)}
          />
        </label>
        <label>
          Upload
          <select
            aria-label="Filter by upload state"
            value={filters.upload_state}
            onChange={(e) => updateFilter('upload_state', e.target.value)}
          >
            <option value="">All</option>
            <option value="uploaded">uploaded</option>
            <option value="partial">partial</option>
            <option value="uploading">uploading</option>
            <option value="queued">queued</option>
            <option value="failed">failed</option>
          </select>
        </label>
        <label>
          Processing
          <select
            aria-label="Filter by processing state"
            value={filters.processing_state}
            onChange={(e) => updateFilter('processing_state', e.target.value)}
          >
            <option value="">All</option>
            <option value="ready">ready</option>
            <option value="processing">processing</option>
            <option value="pending">pending</option>
            <option value="incomplete">incomplete</option>
            <option value="failed">failed</option>
          </select>
        </label>
        <label>
          QC decision
          <select
            aria-label="Filter by QC decision"
            value={filters.qc_decision}
            onChange={(e) => updateFilter('qc_decision', e.target.value)}
          >
            <option value="">All</option>
            <option value="QC Passed">QC Passed</option>
            <option value="QC Failed">QC Failed</option>
            <option value="Needs Re-drive">Needs Re-drive</option>
            <option value="Waiting for Processing">Waiting for Processing</option>
            <option value="Waiting for Logs">Waiting for Logs</option>
            <option value="Log Naming Issue">Log Naming Issue</option>
            <option value="Missing Evidence">Missing Evidence</option>
          </select>
        </label>
        <label>
          Failures
          <select
            aria-label="Filter by failures present"
            value={filters.failures_present}
            onChange={(e) => updateFilter('failures_present', e.target.value)}
          >
            <option value="">All</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label>
          Re-drive
          <select
            aria-label="Filter by re-drive required"
            value={filters.redrive_required}
            onChange={(e) => updateFilter('redrive_required', e.target.value)}
          >
            <option value="">All</option>
            <option value="yes">Required</option>
            <option value="no">Not required</option>
          </select>
        </label>
        <div className="bdfr-filter-actions">
          <button type="button" className="bdfr-btn bdfr-btn-secondary" onClick={resetFilters}>
            Reset filters
          </button>
          <button type="button" className="bdfr-btn bdfr-btn-secondary" onClick={load}>
            Refresh
          </button>
        </div>
      </div>

      {loading && (
        <div className="bdfr-skeleton" aria-busy="true" aria-label="Loading field results">
          <div className="bdfr-skeleton-row" />
          <div className="bdfr-skeleton-row" />
          <div className="bdfr-skeleton-row" />
        </div>
      )}

      {!loading && error && (
        <div className="bdfr-state" role="alert">
          <p>{error}</p>
          <button type="button" className="bdfr-btn" onClick={load}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && data?.status === 'empty' && (
        <div className="bdfr-state">
          <p>No field results match the current filters.</p>
          <button type="button" className="bdfr-btn bdfr-btn-secondary" onClick={resetFilters}>
            Clear filters
          </button>
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <>
          <div className="bdfr-table-wrap">
            <table className="bdfr-table">
              <thead>
                <tr>
                  <th onClick={() => toggleSort('report_name')} scope="col">
                    Report
                  </th>
                  <th scope="col">Task</th>
                  <th scope="col">Project</th>
                  <th scope="col">Grid</th>
                  <th scope="col">Market</th>
                  <th scope="col">FE</th>
                  <th onClick={() => toggleSort('scenario_type')} scope="col">
                    Scenario
                  </th>
                  <th onClick={() => toggleSort('started_at')} scope="col">
                    Started
                  </th>
                  <th scope="col">Duration</th>
                  <th scope="col">Status</th>
                  <th scope="col">Attempts</th>
                  <th scope="col">Upload</th>
                  <th scope="col">Processing</th>
                  <th scope="col">QC</th>
                  <th scope="col">Re-drive</th>
                  <th scope="col">Summary</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <button
                        type="button"
                        className="bdfr-link"
                        onClick={() => onOpenResult(row.id)}
                      >
                        {row.report_name}
                      </button>
                    </td>
                    <td>{row.task_name}</td>
                    <td>{row.project_name}</td>
                    <td>{row.grid_name}</td>
                    <td>{row.market || '—'}</td>
                    <td>{row.field_engineer_name}</td>
                    <td>{row.scenario_label || scenarioLabel(row.scenario_type)}</td>
                    <td>{row.started_at ? new Date(row.started_at).toLocaleString() : '—'}</td>
                    <td>{row.duration_label}</td>
                    <td>{row.completion_status}</td>
                    <td>
                      {row.attempted}/{row.completed}/{row.failed}
                    </td>
                    <td>
                      <span className={badgeClassForUpload(row.upload_state)}>
                        {row.upload_state}
                      </span>
                    </td>
                    <td>{row.processing_state}</td>
                    <td>
                      <span className={badgeClassForQc(row.latest_qc_status)}>
                        {row.latest_qc_status}
                      </span>
                    </td>
                    <td>{row.redrive_needed ? 'Yes' : 'No'}</td>
                    <td>
                      <div>{row.data_summary_concise}</div>
                      <div>{row.rf_summary_concise}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bdfr-cards">
            {rows.map((row) => (
              <article key={row.id} className="bdfr-card">
                <h3>
                  <button
                    type="button"
                    className="bdfr-link"
                    onClick={() => onOpenResult(row.id)}
                  >
                    {row.report_name}
                  </button>
                </h3>
                <div className="bdfr-card-meta">
                  <div>Scenario: {row.scenario_label}</div>
                  <div>FE: {row.field_engineer_name}</div>
                  <div>Task: {row.task_name}</div>
                  <div>Grid: {row.grid_name}</div>
                  <div>
                    QC:{' '}
                    <span className={badgeClassForQc(row.latest_qc_status)}>
                      {row.latest_qc_status}
                    </span>
                  </div>
                  <div>Upload: {row.upload_state}</div>
                </div>
              </article>
            ))}
          </div>

          <div className="bdfr-pagination">
            <span>
              Page {data.page} of {data.totalPages} · {data.total} results
            </span>
            <div className="bdfr-filter-actions">
              <button
                type="button"
                className="bdfr-btn bdfr-btn-secondary"
                disabled={!data.hasPrev}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                className="bdfr-btn bdfr-btn-secondary"
                disabled={!data.hasNext}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
