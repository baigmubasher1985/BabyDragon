/**
 * F10C2 CR1-D — simplified Field Results list (ops-friendly).
 * Data via repository only — no direct table queries. No long UUIDs in default table.
 */

import { useCallback, useEffect, useMemo, useState, Fragment } from 'react';
import { emptyListFilters } from '../selectors/fieldResultSelectors.js';
import { formatCountOrNA, scenarioLabel } from '../models/fieldResultTypes.js';
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
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [moreFilters, setMoreFilters] = useState(false);

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

  function toggleExpanded(id) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
          <select aria-label="Filter by project" value={filters.project} onChange={(e) => updateFilter('project', e.target.value)}>
            <option value="">All</option>
            {options.projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label>
          Vendor
          <select aria-label="Filter by vendor" value={filters.vendor || ''} onChange={(e) => updateFilter('vendor', e.target.value)}>
            <option value="">All</option>
            {(options.vendors || []).map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          FE
          <select aria-label="Filter by field engineer" value={filters.fe} onChange={(e) => updateFilter('fe', e.target.value)}>
            <option value="">All</option>
            {options.fieldEngineers.map((fe) => (
              <option key={fe.id} value={fe.id}>{fe.name}</option>
            ))}
          </select>
        </label>
        <label>
          Test Type
          <select aria-label="Filter by test type" value={filters.scenario} onChange={(e) => updateFilter('scenario', e.target.value)}>
            <option value="">All</option>
            {scenarioOptions.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </label>
        <label>
          Date
          <input type="date" aria-label="Start date" value={filters.dateFrom} onChange={(e) => updateFilter('dateFrom', e.target.value)} />
        </label>
        <label>
          Acceptance
          <select aria-label="Filter by acceptance verdict" value={filters.acceptance_verdict} onChange={(e) => updateFilter('acceptance_verdict', e.target.value)}>
            <option value="">All</option>
            <option value="PASS">PASS</option>
            <option value="FAIL">FAIL</option>
            <option value="INCOMPLETE">INCOMPLETE</option>
            <option value="NOT_EVALUATED">NOT_EVALUATED</option>
          </select>
        </label>
        <label>
          QC
          <select aria-label="Filter by QC decision" value={filters.qc_decision} onChange={(e) => updateFilter('qc_decision', e.target.value)}>
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
        <div className="bdfr-filter-actions">
          <button type="button" className="bdfr-btn bdfr-btn-secondary" onClick={() => setMoreFilters((v) => !v)}>
            {moreFilters ? 'Fewer Filters' : 'More Filters'}
          </button>
          <button type="button" className="bdfr-btn bdfr-btn-secondary" onClick={resetFilters}>Reset filters</button>
          <button type="button" className="bdfr-btn bdfr-btn-secondary" onClick={load}>Refresh</button>
        </div>
      </div>

      {moreFilters && (
        <div className="bdfr-filters bdfr-filters-more" role="search" aria-label="More Field Results filters">
          <label>
            Market
            <select aria-label="Filter by market" value={filters.market} onChange={(e) => updateFilter('market', e.target.value)}>
              <option value="">All</option>
              {options.markets.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <label>
            End date
            <input type="date" aria-label="End date" value={filters.dateTo} onChange={(e) => updateFilter('dateTo', e.target.value)} />
          </label>
          <label>
            Grid
            <select aria-label="Filter by grid" value={filters.grid} onChange={(e) => updateFilter('grid', e.target.value)}>
              <option value="">All</option>
              {options.grids.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </label>
          <label>
            Upload
            <select aria-label="Filter by upload state" value={filters.upload_state} onChange={(e) => updateFilter('upload_state', e.target.value)}>
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
            <select aria-label="Filter by processing state" value={filters.processing_state} onChange={(e) => updateFilter('processing_state', e.target.value)}>
              <option value="">All</option>
              <option value="ready">ready</option>
              <option value="processing">processing</option>
              <option value="pending">pending</option>
              <option value="incomplete">incomplete</option>
              <option value="failed">failed</option>
            </select>
          </label>
          <label>
            Failures
            <select aria-label="Filter by failures present" value={filters.failures_present} onChange={(e) => updateFilter('failures_present', e.target.value)}>
              <option value="">All</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <label>
            Re-drive
            <select aria-label="Filter by re-drive required" value={filters.redrive_required} onChange={(e) => updateFilter('redrive_required', e.target.value)}>
              <option value="">All</option>
              <option value="yes">Required</option>
              <option value="no">Not required</option>
            </select>
          </label>
        </div>
      )}

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
          <button type="button" className="bdfr-btn" onClick={load}>Retry</button>
        </div>
      )}

      {!loading && !error && data?.status === 'empty' && (
        <div className="bdfr-state">
          <p>No field results match the current filters.</p>
          <button type="button" className="bdfr-btn bdfr-btn-secondary" onClick={resetFilters}>Clear filters</button>
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <>
          <div className="bdfr-table-wrap">
            <table className="bdfr-table">
              <thead>
                <tr>
                  <th scope="col"> </th>
                  <th onClick={() => toggleSort('report_name')} scope="col">Report</th>
                  <th scope="col">Project</th>
                  <th scope="col">Task / Grid</th>
                  <th scope="col">Vendor</th>
                  <th scope="col">FE</th>
                  <th onClick={() => toggleSort('scenario_type')} scope="col">Test Type</th>
                  <th onClick={() => toggleSort('started_at')} scope="col">Date</th>
                  <th scope="col">Iterations</th>
                  <th scope="col">Acceptance</th>
                  <th scope="col">QC</th>
                  <th scope="col">View</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                  <tr onClick={() => onOpenResult(row.id)} style={{ cursor: 'pointer' }}>
                    <td>
                      <button
                        type="button"
                        className="bdfr-expand"
                        aria-expanded={expandedIds.has(row.id)}
                        aria-label={expandedIds.has(row.id) ? 'Collapse run details' : 'Expand run details'}
                        onClick={(e) => { e.stopPropagation(); toggleExpanded(row.id); }}
                      >
                        {expandedIds.has(row.id) ? '▾' : '▸'}
                      </button>
                    </td>
                    <td>
                      <button type="button" className="bdfr-link" onClick={(e) => { e.stopPropagation(); onOpenResult(row.id); }}>
                        {row.report_name}
                      </button>
                      {row.labeled_synthetic && (
                        <span className="bdfr-badge bdfr-badge-synth">SYNTHETIC</span>
                      )}
                    </td>
                    <td>{row.project_name || '—'}</td>
                    <td>{row.task_grid_label || row.grid_name || '—'}</td>
                    <td>{row.vendor_name && row.vendor_name !== row.project_id ? row.vendor_name : '—'}</td>
                    <td>{row.field_engineer_name}</td>
                    <td>{row.scenario_label || scenarioLabel(row.scenario_type)}</td>
                    <td>{row.started_at ? new Date(row.started_at).toLocaleDateString() : '—'}</td>
                    <td>{formatCountOrNA(row.completed)}/{formatCountOrNA(row.requested ?? row.attempted)}</td>
                    <td>
                      <span className={
                        row.acceptance_verdict === 'PASS'
                          ? 'bdfr-badge bdfr-badge-pass'
                          : row.acceptance_verdict === 'FAIL'
                            ? 'bdfr-badge bdfr-badge-fail'
                            : row.acceptance_verdict === 'INCOMPLETE'
                              ? 'bdfr-badge bdfr-badge-warn'
                              : 'bdfr-badge bdfr-badge-wait'
                      }>
                        {row.acceptance_verdict || '—'}
                      </span>
                    </td>
                    <td>
                      <span className={badgeClassForQc(row.latest_qc_status)}>{row.latest_qc_status}</span>
                    </td>
                    <td>
                      <button type="button" className="bdfr-link" onClick={(e) => { e.stopPropagation(); onOpenResult(row.id); }}>View</button>
                    </td>
                  </tr>
                  {expandedIds.has(row.id) && (
                    <tr className="bdfr-expand-row">
                      <td colSpan={12}>
                        <div className="bdfr-expand-grid">
                          <div><span>Advanced Details</span><strong title={row.id}>Copy IDs from overview</strong></div>
                          <div><span>Run ID</span><strong className="bdfr-id-sub" title={row.id}>{row.id}</strong></div>
                          <div><span>Session</span><strong className="bdfr-id-sub">{row.client_run_id || '—'}</strong></div>
                          <div><span>Canonical</span><strong className="bdfr-id-sub">{row.canonical_package_id || '—'}</strong></div>
                          <div><span>RF</span><strong>{row.rf_summary_concise}</strong></div>
                          <div><span>Profile</span><strong>{row.acceptance_profile_version || '—'}</strong></div>
                          <button type="button" className="bdfr-link" onClick={() => onOpenResult(row.id)}>
                            Open technical detail
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bdfr-cards">
            {rows.map((row) => (
              <article key={row.id} className="bdfr-card">
                <h3>
                  <button type="button" className="bdfr-link" onClick={() => onOpenResult(row.id)}>
                    {row.report_name}
                  </button>
                </h3>
                {row.labeled_synthetic && (
                  <span className="bdfr-badge bdfr-badge-synth">SYNTHETIC</span>
                )}
                <div className="bdfr-card-meta">
                  <div>Scenario: {row.scenario_label}</div>
                  <div>FE: {row.field_engineer_name}</div>
                  <div>Task: {row.task_name}</div>
                  <div>Grid: {row.grid_name}</div>
                  <div>
                    QC:{' '}
                    <span className={badgeClassForQc(row.latest_qc_status)}>{row.latest_qc_status}</span>
                  </div>
                  <div>Upload: {row.upload_state}</div>
                </div>
              </article>
            ))}
          </div>

          <div className="bdfr-pagination">
            <span>Page {data.page} of {data.totalPages} · {data.total} results</span>
            <div className="bdfr-filter-actions">
              <button type="button" className="bdfr-btn bdfr-btn-secondary" disabled={!data.hasPrev} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
              <button type="button" className="bdfr-btn bdfr-btn-secondary" disabled={!data.hasNext} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
