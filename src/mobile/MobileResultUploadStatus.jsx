import {
  canManualRetry,
  PACKAGE_STATES,
} from "./rf/submission/resultPackageStates.js";

function formatState(state) {
  return String(state || "unknown")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function progressLabel(summary) {
  const p = summary?.artifact_progress || { uploaded: 0, total: 0 };
  return `${p.uploaded}/${p.total} artifacts`;
}

/**
 * Focused F10C2 result-upload panel — reuses BabyDragon mobile sync styling.
 * Queued ≠ uploaded. Cancel keeps local report.
 */
export default function MobileResultUploadStatus({
  items = [],
  isOnline = true,
  syncing = false,
  onRetryNow = null,
  onCancel = null,
  onViewLocal = null,
  onRefresh = null,
}) {
  const active = items.filter(
    (item) => item.summary?.package_state !== PACKAGE_STATES.CANCELLED_LOCAL_ONLY,
  );

  return (
    <section className="bd-mobile-result-upload-panel">
      <div className="bd-mobile-result-upload-header">
        <div>
          <p className="bd-mobile-eyebrow">Field Results</p>
          <strong>Result Upload Queue</strong>
          <p>
            {active.length > 0
              ? "Packaged field-test results wait here until upload completes. Local reports stay on device."
              : "No field-test result packages are queued. Saving a report still works offline."}
          </p>
        </div>
        <button type="button" onClick={onRefresh} disabled={syncing}>
          {syncing ? "Working..." : "Refresh"}
        </button>
      </div>

      {!isOnline && active.length > 0 && (
        <div className="bd-mobile-alert">
          Offline — result packages remain queued. Report creation is not blocked.
        </div>
      )}

      {active.length === 0 ? (
        <p className="bd-mobile-muted">Queued is not the same as uploaded. Nothing is pending.</p>
      ) : (
        <ul className="bd-mobile-result-upload-list">
          {active.map((item) => {
            const s = item.summary || {};
            const state = s.package_state || "queued";
            const uploaded = Boolean(s.is_uploaded);
            const showRetry = typeof onRetryNow === "function" && canManualRetry(state);
            const showCancel =
              typeof onCancel === "function"
              && !uploaded
              && state !== PACKAGE_STATES.CANCELLED_LOCAL_ONLY;

            return (
              <li key={item.id} className={`bd-mobile-result-upload-item state-${state}`}>
                <div className="bd-mobile-result-upload-item-top">
                  <strong>{s.report_name || "Field test result"}</strong>
                  <span className={`bd-mobile-result-state pill-${state}`}>{formatState(state)}</span>
                </div>
                <p>
                  {formatState(s.scenario_type || "scenario")} · {progressLabel(s)}
                  {s.attempts ? ` · retries ${s.attempts}` : ""}
                </p>
                {s.last_error && <p className="bd-mobile-result-error">{s.last_error}</p>}
                {uploaded && (
                  <p className="bd-mobile-result-ok">Upload confirmed. Local report retained.</p>
                )}
                {!uploaded && (
                  <p className="bd-mobile-muted">Status: queued/packaged — not yet uploaded.</p>
                )}
                <div className="bd-mobile-result-upload-actions">
                  {showRetry && (
                    <button type="button" onClick={() => onRetryNow(item)} disabled={syncing || !isOnline}>
                      Retry Now
                    </button>
                  )}
                  {showCancel && (
                    <button type="button" className="secondary" onClick={() => onCancel(item)} disabled={syncing}>
                      Cancel Upload
                    </button>
                  )}
                  {typeof onViewLocal === "function" && (
                    <button type="button" className="secondary" onClick={() => onViewLocal(item)}>
                      View Local
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
