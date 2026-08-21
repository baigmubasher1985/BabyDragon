/**
 * F10C2 Phase 3 — Field Result detail + QC workspace tabs.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FIELD_RESULT_QC_DECISIONS, formatMetric } from '../models/fieldResultTypes.js';
import { validateFieldResultQcDecision } from '../qc/qcValidation.js';
import './FieldResults.css';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'test', label: 'Test Summary' },
  { id: 'rf', label: 'RF Summary' },
  { id: 'gps', label: 'GPS / Route' },
  { id: 'events', label: 'Events' },
  { id: 'scenario', label: 'Scenario Details' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'qc', label: 'QC Workspace' },
];

function Metric({ label, value, unit }) {
  return (
    <div className="bdfr-meta-item">
      <span>{label}</span>
      <strong>{formatMetric(value, unit)}</strong>
    </div>
  );
}

function OverviewPanel({ result }) {
  const o = result.overview || {};
  return (
    <div className="bdfr-panel">
      <h3>Overview</h3>
      <div className="bdfr-meta-grid">
        <Metric label="Report" value={o.report_name} />
        <Metric label="Result ID" value={o.result_id} />
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
      </div>
    </div>
  );
}

function TestSummaryPanel({ result }) {
  const t = result.test_summary || {};
  const c = result.attempt_counts || {};
  return (
    <div className="bdfr-panel">
      <h3>Test Summary</h3>
      <div className="bdfr-meta-grid">
        <Metric label="Truth" value={t.truth || result.completion_status} />
        <Metric label="Requested" value={c.requested} />
        <Metric label="Attempted" value={c.attempted} />
        <Metric label="Completed" value={c.completed} />
        <Metric label="Failed" value={c.failed} />
        <Metric label="Remaining" value={c.remaining} />
        <Metric label="Failure summary" value={t.failure_summary || 'none'} />
      </div>
      {t.config && (
        <pre style={{ fontSize: 12, overflow: 'auto' }}>
          {JSON.stringify(t.config, null, 2)}
        </pre>
      )}
      {t.metrics && (
        <div className="bdfr-meta-grid">
          {Object.entries(t.metrics).map(([k, v]) => (
            <Metric key={k} label={k} value={v} />
          ))}
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
      <div className="bdfr-meta-grid">
        <Metric
          label="RAT distribution"
          value={rf.rat_distribution ? JSON.stringify(rf.rat_distribution) : null}
        />
        <Metric label="NR mode" value={rf.nr_mode} />
        <Metric label="LTE RSRP avg" value={rf.lte?.rsrp?.avg} unit="dBm" />
        <Metric label="LTE RSRQ avg" value={rf.lte?.rsrq?.avg} unit="dB" />
        <Metric label="LTE SINR avg" value={rf.lte?.sinr?.avg} unit="dB" />
        <Metric label="LTE PCI" value={rf.lte?.pci} />
        <Metric label="LTE EARFCN" value={rf.lte?.earfcn} />
        <Metric label="LTE band" value={rf.lte?.band} />
        <Metric label="LTE BW" value={rf.lte?.bandwidth_mhz} unit="MHz" />
        <Metric label="LTE CA" value={rf.lte?.ca} />
        <Metric label="NR SS-RSRP avg" value={rf.nr?.ss_rsrp?.avg} unit="dBm" />
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
      <div className="bdfr-meta-grid">
        <Metric label="Samples" value={g.sample_count} />
        <Metric label="Valid" value={g.valid_count} />
        <Metric label="Invalid" value={g.invalid_count} />
        <Metric
          label="Start"
          value={g.start ? `${g.start.lat}, ${g.start.lon}` : null}
        />
        <Metric label="End" value={g.end ? `${g.end.lat}, ${g.end.lon}` : null} />
        <Metric label="Distance" value={g.distance_m} unit="m" />
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
  return (
    <div className="bdfr-panel">
      <h3>Scenario Details</h3>
      <pre style={{ fontSize: 12, overflow: 'auto', maxHeight: 420 }}>
        {JSON.stringify(d, null, 2)}
      </pre>
    </div>
  );
}

function ArtifactsPanel({ result, repository, onNotice }) {
  async function accessArtifact(artifactId) {
    const res = await repository.requestArtifactAccess(result.id, artifactId, {});
    if (!res.ok) {
      onNotice(res.error?.message || 'Artifact not available');
      return;
    }
    onNotice(res.access?.notice || 'Mock artifact access granted (no URL).');
  }

  return (
    <div className="bdfr-panel">
      <h3>Artifacts</h3>
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
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {(result.artifacts || []).map((a) => (
              <tr key={a.artifact_id}>
                <td>{a.artifact_type}</td>
                <td>{a.filename}</td>
                <td>{a.mime_type}</td>
                <td>{a.size_bytes}</td>
                <td>{a.checksum_status}</td>
                <td>{a.upload_status}</td>
                <td>{a.required ? 'yes' : 'no'}</td>
                <td>{a.available && !a.missing ? 'yes' : 'missing'}</td>
                <td>
                  {a.downloadable ? (
                    <button
                      type="button"
                      className="bdfr-btn bdfr-btn-secondary"
                      onClick={() => accessArtifact(a.artifact_id)}
                    >
                      Mock access
                    </button>
                  ) : (
                    <span className="bdfr-badge bdfr-badge-warn">Not downloadable</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted)' }}>
        Artifact access uses the provider abstraction only. No public/signed Storage URLs.
      </p>
    </div>
  );
}

function QcWorkspace({ result, repository, actor, canQc, onUpdated, onNotice }) {
  const [decision, setDecision] = useState(result.overview?.latest_qc_status || 'Waiting for Logs');
  const [notes, setNotes] = useState('');
  const [redriveReason, setRedriveReason] = useState('');
  const [missingEvidence, setMissingEvidence] = useState('');
  const [override, setOverride] = useState(false);
  const [clientErrors, setClientErrors] = useState([]);
  const [saving, setSaving] = useState(false);

  const history = result.qc_history || [];

  async function save() {
    if (!canQc) {
      onNotice('QC actions are not available for this role (UX gate).');
      return;
    }
    const payload = {
      decision,
      notes,
      redriveReason,
      missingEvidence: missingEvidence
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      allowMissingArtifactOverride: override,
    };
    const local = validateFieldResultQcDecision(payload, {
      processing_state: result.overview?.processing_state,
      artifacts: result.artifacts,
    });
    if (!local.ok) {
      setClientErrors(local.errors);
      return;
    }
    setClientErrors([]);
    setSaving(true);
    try {
      const res = await repository.saveResultQcDecision(result.id, payload, actor);
      if (!res.ok) {
        setClientErrors(res.error?.details || [{ message: res.error?.message }]);
        onNotice(res.error?.message || 'Save failed');
      } else {
        onNotice(res.idempotent ? 'Saved (idempotent — history unchanged).' : 'QC decision saved.');
        onUpdated(res.result);
      }
    } finally {
      setSaving(false);
    }
  }

  async function linkRedrive() {
    if (!canQc) return;
    const res = await repository.createOrLinkRedrive(result.id, redriveReason, actor);
    if (!res.ok) {
      onNotice(res.error?.message || 'Re-drive link failed');
      return;
    }
    onNotice(`Re-drive linked (mock): ${res.redrive_task_id}`);
    onUpdated(res.result);
  }

  return (
    <div className="bdfr-panel">
      <h3>QC Workspace</h3>
      <p style={{ fontSize: 13, color: 'var(--muted)' }}>
        QC is a human decision. Upload completion or iteration success does not auto-pass QC.
        Client checks are UX only — Phase 1 RLS/RPC remain mandatory before live deploy.
      </p>

      {!canQc && (
        <div className="bdfr-state" role="status">
          Field Result QC controls are hidden for FE / unauthorized roles.
        </div>
      )}

      {canQc && (
        <div className="bdfr-qc-form">
          <label>
            Decision
            <select
              aria-label="QC decision"
              value={decision}
              onChange={(e) => setDecision(e.target.value)}
            >
              {FIELD_RESULT_QC_DECISIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label>
            Notes
            <textarea
              aria-label="QC notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Required for QC Failed"
            />
          </label>
          <label>
            Re-drive reason
            <input
              aria-label="Re-drive reason"
              value={redriveReason}
              onChange={(e) => setRedriveReason(e.target.value)}
              placeholder="Required for Needs Re-drive"
            />
          </label>
          <label>
            Missing evidence (comma-separated)
            <input
              aria-label="Missing evidence"
              value={missingEvidence}
              onChange={(e) => setMissingEvidence(e.target.value)}
              placeholder="e.g. unified_json, rf_csv"
            />
          </label>
          <label className="bdfr-check-row" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={override}
              onChange={(e) => setOverride(e.target.checked)}
            />
            Authorized override: allow QC Passed with missing required artifacts (documented)
          </label>
          {clientErrors.length > 0 && (
            <ul className="bdfr-error-list">
              {clientErrors.map((err, i) => (
                <li key={i}>{err.message || err.code}</li>
              ))}
            </ul>
          )}
          <div className="bdfr-filter-actions">
            <button type="button" className="bdfr-btn" disabled={saving} onClick={save}>
              {saving ? 'Saving…' : 'Save QC decision'}
            </button>
            <button type="button" className="bdfr-btn bdfr-btn-secondary" onClick={linkRedrive}>
              Create / link re-drive (mock)
            </button>
          </div>
        </div>
      )}

      <h3 style={{ marginTop: 18 }}>QC History (append-only)</h3>
      <div className="bdfr-history">
        {history.length === 0 && <p>No QC history yet.</p>}
        {history.map((h) => (
          <div key={h.id} className="bdfr-history-item">
            <div>
              <strong>{h.decision}</strong> · {h.reviewer_name}
            </div>
            <small>{h.decided_at}</small>
            {h.notes && <div>Notes: {h.notes}</div>}
            {h.redrive_reason && <div>Re-drive: {h.redrive_reason}</div>}
            {h.missing_evidence?.length > 0 && (
              <div>Missing: {h.missing_evidence.join(', ')}</div>
            )}
            {h.redrive_task_id && <div>Linked task: {h.redrive_task_id}</div>}
            {h.previous_decision && <div>Previous: {h.previous_decision}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function FieldResultDetail({
  resultId,
  repository,
  actor,
  canQc,
  onBack,
}) {
  const [tab, setTab] = useState('overview');
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

  return (
    <div>
      <div className="bdfr-filter-actions" style={{ marginBottom: 12 }}>
        <button type="button" className="bdfr-btn bdfr-btn-secondary" onClick={onBack}>
          ← Back to list
        </button>
        <button type="button" className="bdfr-btn bdfr-btn-secondary" onClick={load}>
          Retry / refresh
        </button>
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
          <div className="bdfr-detail-tabs" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`bdfr-tab ${tab === t.id ? 'active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'overview' && <OverviewPanel result={result} />}
          {tab === 'test' && <TestSummaryPanel result={result} />}
          {tab === 'rf' && <RfSummaryPanel result={result} />}
          {tab === 'gps' && <GpsPanel result={result} />}
          {tab === 'events' && <EventsPanel result={result} />}
          {tab === 'scenario' && <ScenarioPanel result={result} />}
          {tab === 'artifacts' && (
            <ArtifactsPanel
              result={result}
              repository={repository}
              onNotice={setNotice}
            />
          )}
          {tab === 'qc' && (
            <QcWorkspace
              result={result}
              repository={repository}
              actor={actor}
              canQc={canQc}
              onUpdated={setResult}
              onNotice={setNotice}
            />
          )}
        </>
      )}
    </div>
  );
}
