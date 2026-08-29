/**
 * F10C2 Phase 3 — Field Result detail + QC workspace tabs.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { artifactDownloadLabel, buildReportDownloadSlots, fieldSectionEmptyCopy, formatCountOrNA, formatMetric } from '../models/fieldResultTypes.js';
import GpsRouteMap from './GpsRouteMap.jsx';
import './FieldResults.css';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'advanced', label: 'Advanced Details' },
];

const ADVANCED_TABS = [
  { id: 'identity', label: 'Identity' },
  { id: 'test', label: 'Data' },
  { id: 'acceptance', label: 'Acceptance' },
  { id: 'rf', label: 'RF Summary' },
  { id: 'gps', label: 'GPS / Route' },
  { id: 'events', label: 'Events' },
  { id: 'scenario', label: 'Scenario Details' },
  { id: 'artifacts', label: 'Downloads' },
  { id: 'qc', label: 'QC Summary' },
];

function Metric({ label, value, unit }) {
  return (
    <div className="bdfr-meta-item">
      <span>{label}</span>
      <strong>{formatMetric(value, unit)}</strong>
    </div>
  );
}

function verdictClass(verdict) {
  if (verdict === 'PASS') return 'bdfr-badge bdfr-badge-pass';
  if (verdict === 'FAIL') return 'bdfr-badge bdfr-badge-fail';
  if (verdict === 'INCOMPLETE') return 'bdfr-badge bdfr-badge-warn';
  if (verdict === 'NOT_EVALUATED') return 'bdfr-badge bdfr-badge-wait';
  return 'bdfr-badge bdfr-badge-partial';
}

function collectIterationRows(result) {
  const details = result?.scenario_details || {};
  if (Array.isArray(details.iterations) && details.iterations.length) return details.iterations;
  const nested = details.data_summary?.scenarios?.[0]?.iterations;
  if (Array.isArray(nested) && nested.length) return nested;
  if (Array.isArray(result?.iteration_evaluations) && result.iteration_evaluations.length) {
    return result.iteration_evaluations;
  }
  return [];
}

function hasNumeric(value) {
  if (value === null || value === undefined || value === '') return false;
  const n = Number(value);
  return Number.isFinite(n);
}

function EmptyNote({ loading, hasData, synthetic, kind, processing, uploaded, reason, children }) {
  const copy = fieldSectionEmptyCopy({
    loading,
    hasData,
    synthetic,
    kind,
    processing,
    uploaded,
    reason,
  });
  if (!copy) return children || null;
  return <p className="bdfr-empty-copy" role="status">{copy}</p>;
}

function looksLikeUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(value || '').trim(),
  );
}

function compactRf(result) {
  const rf = result.rf_summary || {};
  const dash = result.scenario_dashboard?.rf_gps || result.scenario_details?.dashboard?.rf_gps || {};
  return {
    samples: rf.sample_count ?? dash.rf_sample_count,
    rat: rf.rat || dash.rat || rf.nr_mode,
    avg: rf.serving_rsrp_avg ?? dash.serving_rsrp_avg ?? rf.lte?.rsrp?.avg ?? rf.nr?.avg_ss_rsrp_dbm,
    min: rf.lte?.rsrp?.min ?? rf.nr?.min_ss_rsrp_dbm ?? rf.serving_rsrp_min,
    max: rf.lte?.rsrp?.max ?? rf.nr?.max_ss_rsrp_dbm ?? rf.serving_rsrp_max,
  };
}

function OpsOverviewPanel({ result, repository, actor, onOpenQcReview, onNotice }) {
  const o = result.overview || {};
  const snap = result.acceptance || {};
  const rf = compactRf(result);
  const t = result.test_summary || {};
  const c = result.attempt_counts || {};
  const call = result.call_summary;
  const isVoice = String(o.scenario_type || '').includes('voice');
  return (
    <div>
      <div className="bdfr-panel">
        <h3>Test Summary</h3>
        <div className="bdfr-meta-grid">
          <Metric label="Report" value={o.report_name} />
          <Metric label="Project" value={looksLikeUuid(o.project_name) ? '—' : o.project_name} />
          <Metric label="Task" value={looksLikeUuid(o.task_name) ? '—' : o.task_name} />
          <Metric label="Grid" value={looksLikeUuid(o.grid_name) ? '—' : o.grid_name} />
          <Metric label="Vendor" value={o.vendor_name && !looksLikeUuid(o.vendor_name) ? o.vendor_name : '—'} />
          <Metric label="FE" value={o.field_engineer?.name} />
          <Metric label="Test Type" value={o.scenario_label} />
          <Metric label="Date" value={o.started_at} />
          <Metric label="Duration" value={o.duration_label} />
          <Metric label="Iterations" value={`${formatCountOrNA(c.completed)}/${formatCountOrNA(c.requested)}`} />
        </div>
      </div>

      <div className="bdfr-panel">
        <h3>Pass/Fail Results</h3>
        <div className="bdfr-verdict-cards">
          <div className="bdfr-verdict-card">
            <span>Overall</span>
            <strong className={verdictClass(snap.overall_verdict || result.acceptance_verdict)}>
              {snap.overall_verdict || result.acceptance_verdict || 'NOT_EVALUATED'}
            </strong>
          </div>
          <div className="bdfr-verdict-card">
            <span>Download</span>
            <strong className={verdictClass(snap.dl_verdict)}>{snap.dl_verdict || 'N/A'}</strong>
          </div>
          <div className="bdfr-verdict-card">
            <span>Upload</span>
            <strong className={verdictClass(snap.ul_verdict)}>{snap.ul_verdict || 'N/A'}</strong>
          </div>
          <div className="bdfr-verdict-card">
            <span>MO</span>
            <strong className={verdictClass(snap.mo_verdict)}>{snap.mo_verdict || 'N/A'}</strong>
          </div>
          <div className="bdfr-verdict-card">
            <span>MT</span>
            <strong className={verdictClass(snap.mt_verdict)}>{snap.mt_verdict || 'N/A'}</strong>
          </div>
          <div className="bdfr-verdict-card">
            <span>QC</span>
            <strong>{o.latest_qc_status || '—'}</strong>
          </div>
        </div>
      </div>

      <div className="bdfr-panel">
        <h3>{isVoice ? 'Call Summary' : 'Throughput Summary'}</h3>
        {(() => {
          const iterRows = collectIterationRows(result);
          const hasThp = !isVoice && (
            hasNumeric(t.metrics?.dl_mbps_avg ?? t.metrics?.dl_mbps)
            || hasNumeric(t.metrics?.ul_mbps_avg ?? t.metrics?.ul_mbps)
            || iterRows.length > 0
          );
          const hasCall = isVoice && (call?.mo_successful != null || call?.mt_successful != null || call?.mo?.actual != null);
          if (!isVoice && !hasThp) {
            return (
              <EmptyNote
                synthetic={Boolean(o.labeled_synthetic)}
                kind="throughput"
                processing={o.processing_state}
                uploaded={o.upload_state}
              />
            );
          }
          if (isVoice && !hasCall) {
            return (
              <EmptyNote
                kind="voice"
                processing={o.processing_state}
                uploaded={o.upload_state}
              />
            );
          }
          return (
            <>
              {!isVoice && (
                <div className="bdfr-meta-grid">
                  <Metric label="Status" value={t.truth || result.completion_status} />
                  <Metric label="Average download" value={t.metrics?.dl_mbps_avg ?? t.metrics?.dl_mbps} unit="Mbps" />
                  <Metric label="Average upload" value={t.metrics?.ul_mbps_avg ?? t.metrics?.ul_mbps} unit="Mbps" />
                  {t.metrics?.average_source === 'derived_completed_iterations' && (
                    <Metric label="Average source" value="derived from completed iterations only" />
                  )}
                </div>
              )}
              {isVoice && (
                <div className="bdfr-meta-grid">
                  <Metric label="MO successful" value={call?.mo_successful ?? call?.mo?.actual} />
                  <Metric label="MT successful" value={call?.mt_successful ?? call?.mt?.actual} />
                </div>
              )}
              {!isVoice && iterRows.length > 0 && (
                <>
                  <h3 style={{ marginTop: 16 }}>Per-iteration DL / UL</h3>
                  <div className="bdfr-table-wrap">
                    <table className="bdfr-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Status</th>
                          <th>DL Mbps</th>
                          <th>UL Mbps</th>
                        </tr>
                      </thead>
                      <tbody>
                        {iterRows.map((row, idx) => (
                          <tr key={row.n || row.iteration_number || idx}>
                            <td>{row.n || row.iteration_number || idx + 1}</td>
                            <td>{row.status || row.overall_verdict || '—'}</td>
                            <td>{formatMetric(row.dl_mbps ?? row.actual_dl_mbps)}</td>
                            <td>{formatMetric(row.ul_mbps ?? row.actual_ul_mbps)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          );
        })()}
      </div>

      <div className="bdfr-panel">
        <h3>GPS Driven Route</h3>
        <GpsRouteMap result={result} repository={repository} actor={actor} />
      </div>

      <div className="bdfr-panel">
        <h3>RF Summary</h3>
        {hasNumeric(rf.samples) || rf.rat || hasNumeric(rf.avg) ? (
          <>
            <p className="bdfr-hint">Missing RF metrics stay N/A — never coerced to zero.</p>
            <div className="bdfr-meta-grid">
              <Metric label="Samples" value={formatCountOrNA(rf.samples)} />
              <Metric label="Radio type" value={rf.rat} />
              <Metric label="Key average" value={rf.avg} unit="dBm" />
              <Metric label="Min" value={rf.min} unit="dBm" />
              <Metric label="Max" value={rf.max} unit="dBm" />
            </div>
          </>
        ) : (
          <EmptyNote
            kind="rf"
            processing={o.processing_state}
            uploaded={o.upload_state}
            reason={result.rf_summary?.unavailable_reason}
          />
        )}
      </div>

      <ArtifactsPanel result={result} repository={repository} actor={actor} onNotice={onNotice || (() => {})} />
      <QcReadOnly result={result} onOpenQcReview={onOpenQcReview} />
    </div>
  );
}

function OverviewPanel({ result }) {
  const o = result.overview || {};
  return (
    <div className="bdfr-panel">
      <h3>Identity</h3>
      {o.labeled_synthetic && (
        <p className="bdfr-synth-note" role="status">SYNTHETIC fixture — not physical APK proof.</p>
      )}
      <div className="bdfr-meta-grid">
        <Metric label="Report" value={o.report_name} />
        <Metric label="Run ID" value={o.result_id} />
        <Metric label="Client run / session" value={o.client_run_id} />
        <Metric label="Canonical package ID" value={o.canonical_package_id} />
        <Metric label="Scenario" value={o.scenario_label} />
        <Metric label="Task" value={o.task_name} />
        <Metric label="Project" value={o.project_name} />
        <Metric label="Grid" value={o.grid_name} />
        <Metric label="Market" value={o.market} />
        <Metric label="FE" value={o.field_engineer?.name} />
        <Metric label="Started" value={o.started_at} />
        <Metric label="Ended" value={o.ended_at} />
        <Metric label="Duration" value={o.duration_label} />
        <Metric label="App / build" value={`${o.device?.app_version || '—'} / ${o.device?.build || '—'}`} />
        <Metric label="Device" value={o.device?.model} />
        <Metric label="Upload" value={o.upload_state} />
        <Metric label="Processing" value={o.processing_state} />
        <Metric label="QC" value={o.latest_qc_status} />
        <Metric label="Acceptance" value={result.acceptance_verdict || result.acceptance?.overall_verdict} />
        <Metric label="Profile" value={result.acceptance?.profile_id} />
        <Metric label="Profile version" value={result.acceptance?.profile_version} />
        <Metric label="Re-drive needed" value={o.redrive_needed ? 'yes' : 'no'} />
        <Metric label="Original task" value={o.task_id} />
        <Metric label="Linked re-drive task" value={o.redrive_task_id || 'none'} />
      </div>
    </div>
  );
}

function TestSummaryPanel({ result }) {
  const t = result.test_summary || {};
  const c = result.attempt_counts || {};
  const iterRows = Array.isArray(result.scenario_details?.iterations)
    ? result.scenario_details.iterations
    : (Array.isArray(result.scenario_details?.data_summary?.scenarios?.[0]?.iterations)
      ? result.scenario_details.data_summary.scenarios[0].iterations
      : []);
  return (
    <div className="bdfr-panel">
      <h3>Data</h3>
      <div className="bdfr-meta-grid">
        <Metric label="Truth" value={t.truth || result.completion_status} />
        <Metric label="Requested" value={c.requested} />
        <Metric label="Attempted" value={c.attempted} />
        <Metric label="Completed" value={c.completed} />
        <Metric label="Failed" value={c.failed} />
        <Metric label="Remaining" value={c.remaining} />
        <Metric label="Failure summary" value={t.failure_summary || 'none'} />
        <Metric label="Engine status" value={t.engine_status || t.truth || result.completion_status} />
        <Metric label="Avg DL" value={t.metrics?.dl_mbps_avg ?? t.metrics?.dl_mbps} unit="Mbps" />
        <Metric label="Avg UL" value={t.metrics?.ul_mbps_avg ?? t.metrics?.ul_mbps} unit="Mbps" />
      </div>
      {iterRows.length > 0 && (
        <>
          <h3 style={{ marginTop: 16 }}>Per-iteration DL / UL</h3>
          <div className="bdfr-table-wrap">
            <table className="bdfr-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Status</th>
                  <th>DL Mbps</th>
                  <th>UL Mbps</th>
                  <th>Bytes</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {iterRows.map((row, idx) => (
                  <tr key={row.n || row.iteration_number || idx}>
                    <td>{row.n || row.iteration_number || idx + 1}</td>
                    <td>{row.status || row.overall_verdict || '—'}</td>
                    <td>{formatMetric(row.dl_mbps ?? row.actual_dl_mbps)}</td>
                    <td>{formatMetric(row.ul_mbps ?? row.actual_ul_mbps)}</td>
                    <td>{formatMetric(row.bytes)}</td>
                    <td>{formatMetric(row.duration_ms, 'ms')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {t.config && (
        <pre style={{ fontSize: 12, overflow: 'auto' }}>
          {JSON.stringify(t.config, null, 2)}
        </pre>
      )}
    </div>
  );
}

function AcceptancePanel({ result }) {
  const snap = result.acceptance || {};
  const counts = snap.counts || result.attempt_counts || {};
  const evals = result.iteration_evaluations || [];
  const call = result.call_summary;
  const override = result.acceptance_override;
  return (
    <div className="bdfr-panel">
      <h3>Acceptance</h3>
      <div className="bdfr-verdict-cards">
        <div className="bdfr-verdict-card">
          <span>Overall</span>
          <strong className={verdictClass(snap.overall_verdict || result.acceptance_verdict)}>
            {snap.overall_verdict || result.acceptance_verdict || 'NOT_EVALUATED'}
          </strong>
        </div>
        <div className="bdfr-verdict-card">
          <span>DL</span>
          <strong className={verdictClass(snap.dl_verdict)}>{snap.dl_verdict || 'N/A'}</strong>
        </div>
        <div className="bdfr-verdict-card">
          <span>UL</span>
          <strong className={verdictClass(snap.ul_verdict)}>{snap.ul_verdict || 'N/A'}</strong>
        </div>
        <div className="bdfr-verdict-card">
          <span>MO</span>
          <strong className={verdictClass(snap.mo_verdict)}>{snap.mo_verdict || 'N/A'}</strong>
        </div>
        <div className="bdfr-verdict-card">
          <span>MT</span>
          <strong className={verdictClass(snap.mt_verdict)}>{snap.mt_verdict || 'N/A'}</strong>
        </div>
      </div>
      <div className="bdfr-meta-grid">
        <Metric label="Profile name" value={snap.profile_name || snap.profile_id} />
        <Metric label="Profile ID" value={snap.profile_id} />
        <Metric label="Profile version" value={snap.profile_version} />
        <Metric label="Scope" value={snap.scope || snap.scope_type} />
        <Metric label="Evaluated" value={snap.evaluated_at} />
        <Metric label="Applicability" value={snap.resolved_rules?.applicability?.reason} />
        <Metric label="Requested" value={counts.requested} />
        <Metric label="Attempted" value={counts.attempted} />
        <Metric label="Completed" value={counts.completed} />
        <Metric label="Execution failed" value={counts.execution_failed} />
        <Metric label="Evaluable" value={counts.evaluable} />
        <Metric label="DL pass/fail" value={`${counts.dl_pass ?? '—'} / ${counts.dl_fail ?? '—'}`} />
        <Metric label="UL pass/fail" value={`${counts.ul_pass ?? '—'} / ${counts.ul_fail ?? '—'}`} />
        <Metric label="Excluded rules" value={(snap.resolved_rules?.excluded_rules || []).join(', ') || 'none'} />
        {snap.server_overall_verdict && snap.server_overall_verdict !== snap.overall_verdict && (
          <Metric label="Server snapshot overall (immutable)" value={snap.server_overall_verdict} />
        )}
      </div>
      {override && (
        <p role="status">
          Computed {override.computed_verdict} · override {override.override_verdict} by {override.actor_id} at {override.created_at}
        </p>
      )}
      <h3 style={{ marginTop: 16 }}>Iteration drill-down</h3>
      <div className="bdfr-table-wrap">
        <table className="bdfr-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Time</th>
              <th>Actual DL</th>
              <th>DL threshold</th>
              <th>DL verdict</th>
              <th>Actual UL</th>
              <th>UL threshold</th>
              <th>UL verdict</th>
              <th>Overall</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {evals.length === 0 && (
              <tr>
                <td colSpan={10}>No persisted iteration evaluations yet.</td>
              </tr>
            )}
            {evals.map((row) => (
              <tr key={`${row.iteration_number}-${row.iteration_id || row.id}`}>
                <td>{row.iteration_number}</td>
                <td>{row.timestamp || '—'}</td>
                <td>{row.actual_dl_mbps ?? 'unavailable'}</td>
                <td>{row.dl_threshold ?? '—'}</td>
                <td>{row.dl_verdict}</td>
                <td>{row.actual_ul_mbps ?? 'unavailable'}</td>
                <td>{row.ul_threshold ?? '—'}</td>
                <td>{row.ul_verdict}</td>
                <td>{row.overall_verdict}</td>
                <td>{row.incomplete_reason || row.failure_reason || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 style={{ marginTop: 16 }}>MO / MT required vs actual</h3>
      {!call && <p>Voice call events were not present. Synthetic disposable events are labeled when used.</p>}
      {call && (
        <div className="bdfr-meta-grid">
          <Metric label="MO required" value={call.required_mo ?? call.mo?.required} />
          <Metric label="MO actual" value={call.mo_successful ?? call.mo?.actual} />
          <Metric label="MO attempted / failed" value={`${call.mo_attempted ?? call.mo?.attempted ?? '—'} / ${call.mo_failed ?? call.mo?.failed ?? '—'}`} />
          <Metric label="MO verdict" value={call.mo_verdict ?? call.mo?.verdict} />
          <Metric label="MT required" value={call.required_mt ?? call.mt?.required} />
          <Metric label="MT actual" value={call.mt_successful ?? call.mt?.actual} />
          <Metric label="MT attempted / failed" value={`${call.mt_attempted ?? call.mt?.attempted ?? '—'} / ${call.mt_failed ?? call.mt?.failed ?? '—'}`} />
          <Metric label="MT verdict" value={call.mt_verdict ?? call.mt?.verdict} />
          <Metric label="CSSR" value={call.cssr ?? call.CSSR} />
          <Metric label="CDR" value={call.cdr ?? call.CDR} />
          <Metric label="CBR" value={call.cbr ?? call.CBR} />
          <Metric label="Setup" value={call.setup_time_ms ?? call.setup} unit="ms" />
          <Metric label="Synthetic" value={call.labeled_synthetic ? 'yes — disposable label' : 'no'} />
        </div>
      )}
    </div>
  );
}

function RfSummaryPanel({ result }) {
  const rf = result.rf_summary;
  if (!rf) {
    return (
      <div className="bdfr-panel">
        <h3>RF Summary</h3>
        <p>RF summary unavailable</p>
      </div>
    );
  }
  return (
    <div className="bdfr-panel">
      <h3>RF Summary</h3>
      {rf.unavailable_reason && <p>{rf.unavailable_reason}</p>}
      <p className="bdfr-hint">Missing RF metrics stay N/A / unavailable — never coerced to zero.</p>
      <div className="bdfr-meta-grid">
        <Metric label="RF sample count" value={formatCountOrNA(rf.sample_count)} />
        <Metric
          label="RAT distribution"
          value={rf.rat_distribution ? JSON.stringify(rf.rat_distribution) : null}
        />
        <Metric label="NR mode" value={rf.nr_mode} />
        <Metric label="LTE RSRP avg" value={rf.lte?.rsrp?.avg} unit="dBm" />
        <Metric label="LTE RSRP min" value={rf.lte?.rsrp?.min} unit="dBm" />
        <Metric label="LTE RSRP max" value={rf.lte?.rsrp?.max} unit="dBm" />
        <Metric label="LTE RSRQ avg" value={rf.lte?.rsrq?.avg} unit="dB" />
        <Metric label="LTE SINR avg" value={rf.lte?.sinr?.avg} unit="dB" />
        <Metric label="LTE PCI" value={rf.lte?.pci} />
        <Metric label="LTE EARFCN" value={rf.lte?.earfcn} />
        <Metric label="LTE TAC" value={rf.lte?.tac} />
        <Metric label="LTE band" value={rf.lte?.band} />
        <Metric label="LTE BW" value={rf.lte?.bandwidth_mhz} unit="MHz" />
        <Metric label="LTE CA" value={rf.lte?.ca} />
        <Metric label="NR SS-RSRP avg" value={rf.nr?.ss_rsrp?.avg} unit="dBm" />
        <Metric label="NR SS-RSRP min" value={rf.nr?.ss_rsrp?.min} unit="dBm" />
        <Metric label="NR SS-RSRP max" value={rf.nr?.ss_rsrp?.max} unit="dBm" />
        <Metric label="NR SS-RSRQ avg" value={rf.nr?.ss_rsrq?.avg} unit="dB" />
        <Metric label="NR SS-SINR avg" value={rf.nr?.ss_sinr?.avg} unit="dB" />
        <Metric label="NR PCI" value={rf.nr?.pci} />
        <Metric label="NRARFCN" value={rf.nr?.nrarfcn} />
        <Metric label="NR band" value={rf.nr?.band} />
        <Metric label="NR BW" value={rf.nr?.bandwidth_mhz} unit="MHz" />
        <Metric label="WCDMA RSCP avg" value={rf.wcdma?.rscp?.avg} unit="dBm" />
        <Metric label="GSM RxLev avg" value={rf.gsm?.rxlev?.avg} unit="dBm" />
      </div>
    </div>
  );
}

function GpsPanel({ result }) {
  const g = result.gps_summary;
  if (!g) {
    return (
      <div className="bdfr-panel">
        <h3>GPS / Route</h3>
        <p>GPS summary unavailable</p>
      </div>
    );
  }
  return (
    <div className="bdfr-panel">
      <h3>GPS / Route (bounded summary)</h3>
      {g.gaps_warning && <p role="status">{g.gaps_warning}</p>}
      <p className="bdfr-hint">Missing GPS counts stay N/A — never coerced to zero.</p>
      <div className="bdfr-meta-grid">
        <Metric label="Samples" value={formatCountOrNA(g.sample_count)} />
        <Metric label="Valid" value={formatCountOrNA(g.valid_count)} />
        <Metric label="Invalid" value={formatCountOrNA(g.invalid_count)} />
        <Metric
          label="Start"
          value={g.start ? `${g.start.lat}, ${g.start.lon}` : null}
        />
        <Metric label="End" value={g.end ? `${g.end.lat}, ${g.end.lon}` : null} />
        <Metric label="Distance" value={g.distance_m} unit="m" />
        <Metric label="Accuracy" value={g.accuracy_m ?? g.accuracy} unit="m" />
        <Metric label="Freshness" value={g.freshness || g.fix_age_s} />
        <Metric label="Route" value={g.route_label} />
        <Metric label="Grid" value={g.grid_association} />
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted)' }}>
        Full raw GPS traces are not loaded into dashboard state (Phase 3 performance rule).
      </p>
    </div>
  );
}

function EventsPanel({ result }) {
  const e = result.events_summary;
  if (!e) {
    return (
      <div className="bdfr-panel">
        <h3>Events</h3>
        <p>No event summary</p>
      </div>
    );
  }
  return (
    <div className="bdfr-panel">
      <h3>Events</h3>
      <div className="bdfr-meta-grid">
        {Object.entries(e.counts || {}).map(([k, v]) => (
          <Metric key={k} label={k} value={v} />
        ))}
      </div>
      <ul className="bdfr-timeline">
        {(e.timeline || []).map((item, idx) => (
          <li key={`${item.t}-${idx}`}>
            <strong>{item.kind}</strong> — {item.label}
            <br />
            <small>{item.t}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScenarioPanel({ result }) {
  const d = result.scenario_details || {};
  const dash = result.scenario_dashboard || d.dashboard || {};
  const family = dash.native_http || dash.ftp || dash.iperf3 || dash.ookla || dash.fcc
    || dash.rf_only || dash.voice_mo || dash.voice_mt || dash.combined;
  return (
    <div className="bdfr-panel">
      <h3>Scenario Details</h3>
      <p style={{ fontSize: 12, color: 'var(--muted)' }}>
        Applicable family only. Missing values stay unavailable — never coerced to zero.
        Absence of another test family does not hide this scenario.
      </p>
      {dash.common && (
        <>
          <h3 style={{ marginTop: 12 }}>Common</h3>
          <div className="bdfr-meta-grid">
            {Object.entries(dash.common).map(([k, v]) => (
              <Metric key={k} label={k.replace(/_/g, ' ')} value={v} />
            ))}
          </div>
        </>
      )}
      {dash.rf_gps && (
        <>
          <h3 style={{ marginTop: 12 }}>RF / GPS</h3>
          <div className="bdfr-meta-grid">
            {Object.entries(dash.rf_gps).map(([k, v]) => (
              <Metric key={k} label={k.replace(/_/g, ' ')} value={typeof v === 'object' && v ? JSON.stringify(v) : v} />
            ))}
          </div>
        </>
      )}
      {family && (
        <>
          <h3 style={{ marginTop: 12 }}>{d.scenario_type || 'Scenario metrics'}</h3>
          <div className="bdfr-meta-grid">
            {Object.entries(family).map(([k, v]) => (
              <Metric key={k} label={k.replace(/_/g, ' ')} value={v} />
            ))}
          </div>
        </>
      )}
      <pre style={{ fontSize: 12, overflow: 'auto', maxHeight: 280, marginTop: 12 }}>
        {JSON.stringify(d, null, 2)}
      </pre>
    </div>
  );
}

function ArtifactsPanel({ result, repository, actor, onNotice }) {
  const slots = buildReportDownloadSlots(result.artifacts || []);

  async function accessArtifact(artifactId) {
    const res = await repository.requestArtifactAccess(result.id, artifactId, actor || {});
    if (!res.ok) {
      onNotice(res.error?.message || 'Artifact not available');
      return;
    }
    if (res.access?.mode === 'signed_url' && res.access.signed_url) {
      window.open(res.access.signed_url, '_blank', 'noopener,noreferrer');
      onNotice('Opened protected artifact (short-lived signed access).');
      return;
    }
    onNotice(res.access?.notice || 'Artifact access granted (no public URL).');
  }

  return (
    <div className="bdfr-panel">
      <h3>Download Reports</h3>
      <p className="bdfr-hint">
        Private artifact refs only. Short-lived signed URLs are minted on demand and are never stored.
        Missing artifacts stay labeled — they are not uploaded just to show a button.
      </p>
      <div className="bdfr-table-wrap">
        <table className="bdfr-table">
          <thead>
            <tr>
              <th>Report</th>
              <th>Type</th>
              <th>Filename</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {slots.map((slot, idx) => {
              const art = slot.artifact;
              return (
                <tr key={art?.artifact_id || `${slot.slot_type}-${idx}`}>
                  <td>{slot.label}</td>
                  <td>{slot.slot_type}</td>
                  <td>{art?.filename || '—'}</td>
                  <td>
                    {slot.status === 'available' && <span className="bdfr-badge bdfr-badge-ok">available</span>}
                    {slot.status === 'pending' && <span className="bdfr-badge bdfr-badge-wait">pending</span>}
                    {slot.status === 'missing' && <span className="bdfr-badge bdfr-badge-warn">missing</span>}
                  </td>
                  <td>
                    {slot.downloadable && art?.artifact_id ? (
                      <button
                        type="button"
                        className="bdfr-btn bdfr-btn-secondary"
                        onClick={() => accessArtifact(art.artifact_id)}
                      >
                        Secure download
                      </button>
                    ) : (
                      <span className="bdfr-badge bdfr-badge-warn">
                        {slot.status === 'pending' ? 'Not ready' : 'Not downloadable'}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <h3 style={{ marginTop: 16 }}>Artifact metadata</h3>
      <div className="bdfr-table-wrap">
        <table className="bdfr-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Filename</th>
              <th>MIME</th>
              <th>Size</th>
              <th>Checksum</th>
              <th>Upload</th>
              <th>Required</th>
              <th>Available</th>
            </tr>
          </thead>
          <tbody>
            {(result.artifacts || []).map((a) => (
              <tr key={a.artifact_id}>
                <td>{artifactDownloadLabel(a.artifact_type)}</td>
                <td>{a.filename}</td>
                <td>{a.mime_type}</td>
                <td>{a.size_bytes}</td>
                <td>{a.checksum_status}</td>
                <td>{a.upload_status}</td>
                <td>{a.required ? 'yes' : 'no'}</td>
                <td>{a.available && !a.missing ? 'yes' : 'missing'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="bdfr-hint">
        Reports open with a short-lived protected link. Missing files stay unavailable.
      </p>
    </div>
  );
}

function QcReadOnly({ result, onOpenQcReview }) {
  const history = result.qc_history || [];
  const o = result.overview || {};
  return (
    <div className="bdfr-panel">
      <h3>QC Summary</h3>
      <p className="bdfr-hint">
        QC editing, overrides, notes, re-drive, and history stay in QC & Reports → QC Review.
        Field Results is read-only for QC.
      </p>
      <div className="bdfr-meta-grid">
        <Metric label="QC status" value={o.latest_qc_status} />
        <Metric label="Computed verdict" value={result.acceptance_verdict || result.acceptance?.overall_verdict || 'NOT_EVALUATED'} />
        <Metric label="Override" value={result.acceptance_override?.override_verdict || 'none'} />
        <Metric label="Re-drive needed" value={o.redrive_needed ? 'yes' : 'no'} />
      </div>
      {typeof onOpenQcReview === 'function' && (
        <button
          type="button"
          className="bdfr-btn"
          onClick={() => onOpenQcReview({
            taskId: o.task_id || result.task_id || null,
            resultId: result.id || o.result_id || null,
            reportName: o.report_name || result.report_name || null,
            gridName: o.grid_name || result.grid_name || null,
          })}
        >
          Open in QC Review
        </button>
      )}
      <h3 style={{ marginTop: 16 }}>History (read-only)</h3>
      <div className="bdfr-timeline">
        {history.map((h) => (
          <div key={h.id}>
            <strong>{h.decision}</strong> — {h.reviewer_name} · {h.decided_at}
            {h.notes && <div>{h.notes}</div>}
          </div>
        ))}
        {history.length === 0 && <p className="bdfr-hint">No QC history on this run.</p>}
      </div>
    </div>
  );
}

export default function FieldResultDetail({
  resultId,
  repository,
  actor,
  onBack,
  onOpenQcReview,
}) {
  const [tab, setTab] = useState('overview');
  const [advancedTab, setAdvancedTab] = useState('identity');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await repository.getFieldResult(resultId);
      if (!res.ok) {
        setError(res.error?.message || 'Failed to load result.');
        setResult(null);
      } else {
        setResult(res.result);
      }
    } catch (err) {
      setError(err?.message || 'Unexpected detail error.');
    } finally {
      setLoading(false);
    }
  }, [repository, resultId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        const res = await repository.getFieldResult(resultId);
        if (cancelled) return;
        if (!res.ok) {
          setError(res.error?.message || 'Failed to load result.');
          setResult(null);
        } else {
          setResult(res.result);
        }
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Unexpected detail error.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repository, resultId]);

  const tabs = useMemo(() => TABS, []);
  const advancedTabs = useMemo(() => ADVANCED_TABS, []);

  return (
    <div>
      <div className="bdfr-detail-toolbar" role="toolbar" aria-label="Result actions">
        <button type="button" className="bdfr-btn bdfr-btn-secondary bdfr-toolbar-nav" onClick={onBack}>
          Back to Results
        </button>
        {!error && (
          <button type="button" className="bdfr-btn bdfr-btn-secondary bdfr-toolbar-refresh" onClick={load} disabled={loading}>
            Refresh
          </button>
        )}
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`bdfr-btn bdfr-toolbar-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {notice && (
        <div className="bdfr-mock-banner" role="status">
          {notice}
        </div>
      )}

      {loading && (
        <div className="bdfr-skeleton" aria-busy="true">
          <div className="bdfr-skeleton-row" />
          <div className="bdfr-skeleton-row" />
          <p className="bdfr-empty-copy">Loading…</p>
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

      {!loading && result && (
        <>
          {tab === 'overview' && (
            <OpsOverviewPanel
              result={result}
              repository={repository}
              actor={actor}
              onOpenQcReview={onOpenQcReview}
              onNotice={setNotice}
            />
          )}
          {tab === 'advanced' && (
            <>
              <h3 className="bdfr-advanced-title">Advanced Technical Details</h3>
              <div className="bdfr-detail-tabs" role="tablist" aria-label="Advanced Technical Details">
                {advancedTabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={advancedTab === t.id}
                    className={`bdfr-tab ${advancedTab === t.id ? 'active' : ''}`}
                    onClick={() => setAdvancedTab(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {advancedTab === 'identity' && <OverviewPanel result={result} />}
              {advancedTab === 'test' && <TestSummaryPanel result={result} />}
              {advancedTab === 'acceptance' && <AcceptancePanel result={result} />}
              {advancedTab === 'rf' && <RfSummaryPanel result={result} />}
              {advancedTab === 'gps' && (
                <>
                  <GpsPanel result={result} />
                  <GpsRouteMap result={result} repository={repository} actor={actor} />
                </>
              )}
              {advancedTab === 'events' && <EventsPanel result={result} />}
              {advancedTab === 'scenario' && <ScenarioPanel result={result} />}
              {advancedTab === 'artifacts' && (
                <ArtifactsPanel
                  result={result}
                  repository={repository}
                  actor={actor}
                  onNotice={setNotice}
                />
              )}
              {advancedTab === 'qc' && (
                <QcReadOnly result={result} onOpenQcReview={onOpenQcReview} />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
