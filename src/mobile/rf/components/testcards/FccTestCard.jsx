import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { DEFAULT_FCC_IMPORT_SETUP } from "../../config/dataTestConfig";
import {
  FCC_DEFAULT_BUFFER_SECONDS,
  buildFccImportDebugPayload,
  buildFccTruncationSummaries,
  reapplyFccTimeWindow,
} from "../../utils/fccExportImport";

function formatMaybeNumber(value, digits = 2) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return digits === null ? String(number) : number.toFixed(digits);
}

function formatSessionTime(ms) {
  if (!Number.isFinite(ms)) return "Unavailable";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "Unavailable";
  }
}

function phaseSuccessSummary(phaseSuccess = {}) {
  const parts = [
    phaseSuccess.latency === true ? "L✓" : (phaseSuccess.latency === false ? "L✗" : "L?"),
    phaseSuccess.download === true ? "D✓" : (phaseSuccess.download === false ? "D✗" : "D?"),
    phaseSuccess.upload === true ? "U✓" : (phaseSuccess.upload === false ? "U✗" : "U?"),
  ];
  return parts.join(" ");
}

function windowLabel(row = {}) {
  if (row.addedToIterations) return "ADDED";
  if (row.insideBabyDragonTimeWindow === "yes") return "INSIDE";
  if (row.insideBabyDragonTimeWindow === "no") return "OUTSIDE WINDOW";
  return "NO TIMESTAMP";
}

export default function FccTestCard({
  setup = DEFAULT_FCC_IMPORT_SETUP,
  importMeta = null,
  onChange,
  onImportFile,
  onImportFromUrl,
  onAddSelectedRows,
  sessionStartMs = null,
  sessionEndMs = null,
  provisionalSessionEnd = false,
  disabled = false,
}) {
  const fileInputId = useId();
  const urlInputId = useId();
  const [message, setMessage] = useState("");
  const [showAllRows, setShowAllRows] = useState(false);
  const [isAddingRows, setIsAddingRows] = useState(false);
  const [isDownloadingUrl, setIsDownloadingUrl] = useState(false);
  const isAddingRowsRef = useRef(false);
  const isDownloadingUrlRef = useRef(false);
  const hasParsedImport = Boolean(
    importMeta
    && (
      importMeta.parseStatus === "parsed"
      || importMeta.status === "parsed"
      || (Array.isArray(importMeta.rows) && importMeta.rows.length > 0)
      || Number(importMeta.stats?.collapsedTestCount) > 0
      || Number(importMeta.originalSourceSummary?.collapsedTestsTotal) > 0
    ),
  );
  const importState = hasParsedImport ? importMeta : null;
  const stats = importState?.stats || {};
  const bufferSeconds = Number(setup.timestampBufferSeconds) || FCC_DEFAULT_BUFFER_SECONDS;
  const zipUrl = setup.fccZipUrl || "";
  const busy = disabled || isAddingRows || isDownloadingUrl;
  const statusLine = importMeta?.message || message || "";

  const originalSource = importState?.originalSourceSummary || {};
  const sessionWindow = importState?.sessionWindowSummary || {};
  const savedEvidence = importState?.savedEvidenceSummary || {
    savedFccIterations: stats.savedCount || 0,
    savedWifi: 0,
    savedCell: 0,
  };

  useEffect(() => {
    if (!importState?.rows?.length) return;
    if (!Number.isFinite(sessionStartMs)) return;
    // Avoid re-window thrash while provisional end is Date.now() each render.
    if (provisionalSessionEnd) return;
    if (!Number.isFinite(sessionEndMs)) return;
    const updated = reapplyFccTimeWindow(importState, {
      sessionStartMs,
      sessionEndMs,
      bufferSeconds,
      preserveManualIncludes: true,
    });
    if (!updated) return;
    if (importState.sessionEndMs === sessionEndMs
      && importState.sessionStartMs === sessionStartMs
      && importState.bufferSeconds === bufferSeconds) {
      return;
    }
    onChange?.({
      ...setup,
      appFccImport: buildFccImportDebugPayload(updated),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-window only after final session end
  }, [sessionStartMs, sessionEndMs, bufferSeconds, provisionalSessionEnd]);

  const visibleRows = useMemo(() => {
    const rows = importState?.rows || [];
    if (showAllRows) return rows;
    return rows.filter((row) => row.insideBabyDragonTimeWindow === "yes" || row.addedToIterations);
  }, [importState, showAllRows]);

  const update = (patch) => onChange?.({ ...setup, ...patch });

  function handleFilePicked(event) {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (!file) return;
    setMessage("");
    setShowAllRows(false);
    onImportFile?.(file, {
      sessionStartMs,
      sessionEndMs,
      bufferSeconds,
      provisionalSessionEnd,
    });
  }

  async function handleDownloadUrl() {
    if (isDownloadingUrlRef.current || busy) return;
    isDownloadingUrlRef.current = true;
    setIsDownloadingUrl(true);
    setMessage("");
    setShowAllRows(false);
    try {
      const result = await onImportFromUrl?.(zipUrl, {
        sessionStartMs,
        sessionEndMs,
        bufferSeconds,
        provisionalSessionEnd,
      });
      if (result?.message) setMessage(result.message);
    } catch (error) {
      setMessage(`Download failed: ${String(error?.message || error || "unknown error")}`);
    } finally {
      isDownloadingUrlRef.current = false;
      setIsDownloadingUrl(false);
    }
  }

  function handleClearUrl() {
    update({ fccZipUrl: "" });
    setMessage("");
  }

  function updateRow(fccTestId, patch) {
    if (!importState) return;
    const rows = (importState.rows || []).map((row) => {
      if (String(row.fccTestId) !== String(fccTestId)) return row;
      if (row.addedToIterations) return row;
      const next = { ...row, ...patch };
      if (Object.prototype.hasOwnProperty.call(patch, "include")) {
        // Outside-window rows may be visible in "show all" but should not stay selected.
        if (patch.include && row.insideBabyDragonTimeWindow !== "yes") {
          next.include = false;
          next.manualInclude = false;
          next.status = row.insideBabyDragonTimeWindow === "no" ? "outside_window" : "no_timestamp";
          return next;
        }
        next.manualInclude = Boolean(patch.include);
        next.status = patch.include ? "selected" : (row.insideBabyDragonTimeWindow === "no" ? "outside_window" : "excluded");
      }
      return next;
    });
    const nextState = {
      ...importState,
      rows,
      stats: {
        ...importState.stats,
        selectedCount: rows.filter((row) => row.include).length,
      },
    };
    update({ appFccImport: buildFccImportDebugPayload(nextState) });
  }

  async function handleAddSelected() {
    if (isAddingRowsRef.current || disabled) return;
    const selectedAll = (importState?.rows || []).filter((row) => row.include && !row.addedToIterations);
    const outsideSelected = selectedAll.filter((row) => row.insideBabyDragonTimeWindow !== "yes");
    const selected = selectedAll.filter((row) => row.insideBabyDragonTimeWindow === "yes");
    if (!selectedAll.length) {
      setMessage("Select at least one FCC row to add.");
      return;
    }
    if (!selected.length) {
      setMessage(`Blocked: ${outsideSelected.length} selected row(s) are outside the BabyDragon session window. Select inside-window tests only.`);
      return;
    }
    isAddingRowsRef.current = true;
    setIsAddingRows(true);
    try {
      const result = await onAddSelectedRows?.(selected, buildFccImportDebugPayload(importState));
      const added = Number(result?.added) || 0;
      const skipped = Number(result?.skippedDuplicates) || 0;
      const skippedOutside = Number(result?.skippedOutsideWindow) || outsideSelected.length;
      const addedIds = new Set((result?.addedTestIds || []).map((id) => String(id)));
      if (importState && (addedIds.size || skippedOutside)) {
        const rows = (importState.rows || []).map((row) => {
          if (addedIds.has(String(row.fccTestId))) {
            return {
              ...row,
              include: false,
              manualInclude: false,
              addedToIterations: true,
              status: "added",
            };
          }
          if (row.insideBabyDragonTimeWindow !== "yes" && row.include) {
            return {
              ...row,
              include: false,
              manualInclude: false,
              status: row.insideBabyDragonTimeWindow === "no" ? "outside_window" : "no_timestamp",
            };
          }
          return row;
        });
        const nextState = {
          ...importState,
          rows,
          stats: {
            ...importState.stats,
            selectedCount: rows.filter((row) => row.include).length,
            savedCount: rows.filter((row) => row.addedToIterations).length,
            duplicateSkippedCount: (importState.stats?.duplicateSkippedCount || 0) + skipped,
          },
        };
        const summaries = buildFccTruncationSummaries({
          rows,
          phaseRows: nextState.phaseRows || [],
          filesDetected: nextState.filesDetected || [],
          sessionStartMs: nextState.sessionStartMs,
          sessionEndMs: nextState.sessionEndMs,
          bufferSeconds,
          savedIterations: rows.filter((row) => row.addedToIterations),
          sourceFileSummaries: nextState.sourceFileSummaries || [],
        });
        update({
          appFccImport: buildFccImportDebugPayload({
            ...nextState,
            ...summaries,
          }),
        });
      }
      const parts = [`Added ${added} FCC evidence iteration(s) inside BabyDragon session.`];
      if (skipped > 0) parts.push(`Skipped ${skipped} duplicate(s) by test_id.`);
      if (skippedOutside > 0) parts.push(`Skipped ${skippedOutside} outside-window row(s).`);
      setMessage(parts.join(" "));
    } catch (error) {
      setMessage(`Add FCC rows failed: ${String(error?.message || error || "unknown error")}`);
    } finally {
      isAddingRowsRef.current = false;
      setIsAddingRows(false);
    }
  }

  return (
    <section className="bd-rf-test-card bd-rf-fcc-evidence-card bd-rf-fcc-import-card">
      <header>
        <div>
          <b>FCC App External Evidence</b>
          <span>Import FCC ZIP, truncate to BabyDragon Start→Stop session window, then save selected inside-window tests.</span>
        </div>
        <em>Import</em>
      </header>

      <p className="bd-rf-fcc-evidence-note">
        FCC ZIP may contain full history. Only tests overlapping the BabyDragon session window are eligible evidence. APP DL/UL THP stays N/A.
      </p>

      <label>
        <span>Timestamp buffer</span>
        <input
          disabled={disabled}
          inputMode="numeric"
          value={setup.timestampBufferSeconds ?? FCC_DEFAULT_BUFFER_SECONDS}
          onChange={(event) => update({ timestampBufferSeconds: event.target.value })}
        />
        <em>sec</em>
      </label>

      <div className="bd-rf-fcc-url-import">
        <label htmlFor={urlInputId}>
          <span>FCC ZIP Download URL</span>
          <input
            id={urlInputId}
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://fccapi.mozark.ai/download-zip/..."
            value={zipUrl}
            disabled={busy}
            onChange={(event) => update({ fccZipUrl: event.target.value })}
          />
        </label>
        <div className="bd-rf-fcc-url-actions">
          <button
            type="button"
            className="bd-rf-fcc-url-download"
            disabled={busy || !String(zipUrl || "").trim()}
            onClick={handleDownloadUrl}
          >
            {isDownloadingUrl ? "Downloading…" : "Download FCC ZIP"}
          </button>
          <button
            type="button"
            className="bd-rf-fcc-url-clear"
            disabled={busy || !String(zipUrl || "").trim()}
            onClick={handleClearUrl}
          >
            Clear URL
          </button>
        </div>
      </div>

      <label className="bd-rf-fcc-import-picker" htmlFor={fileInputId}>
        <span>Select FCC ZIP</span>
        <input
          id={fileInputId}
          type="file"
          accept=".zip,application/zip"
          disabled={busy}
          onChange={handleFilePicked}
        />
        <small>Or paste an HTTPS FCC ZIP download URL above.</small>
      </label>

      {statusLine && !importState ? (
        <p className={`bd-rf-inline-note ${String(importMeta?.status || "").includes("fail") || String(importMeta?.status || "").includes("invalid") ? "warning" : "success"}`}>
          {statusLine}
        </p>
      ) : null}

      {importState ? (
        <div className="bd-rf-fcc-import-status">
          <strong>{importState.fileName || "Imported FCC ZIP"}</strong>
          <small>
            {importState.parseStatus || importState.status || "parsed"}
            {importState.importMode === "url_zip" ? " · URL import" : " · manual ZIP"}
            {importState.packageId ? ` · package ${importState.packageId}` : ""}
            {` · ${(importState.filesDetected || []).length || originalSource.sourceFileCount || 0} source file(s)`}
          </small>
          <div className="bd-rf-fcc-import-stats bd-rf-fcc-truncation-stats">
            <span>
              <b>Original source</b>
              {originalSource.collapsedTestsTotal ?? stats.collapsedTestCount ?? "—"} tests
              <small>
                {(originalSource.phaseRowsTotal ?? stats.phaseRowCount ?? "—")} phase · Wi‑Fi {originalSource.wifiTestsTotal ?? stats.wifiCount ?? "—"} · Cell {originalSource.cellTestsTotal ?? stats.cellCount ?? "—"}
              </small>
            </span>
            <span>
              <b>Inside BabyDragon session</b>
              {sessionWindow.collapsedTestsInsideWindow ?? stats.insideWindowCount ?? "—"} tests
              <small>
                Wi‑Fi {sessionWindow.wifiTestsInsideWindow ?? stats.wifiTestsInsideWindow ?? "—"} · Cell {sessionWindow.cellTestsInsideWindow ?? stats.cellTestsInsideWindow ?? "—"}
              </small>
            </span>
            <span>
              <b>Saved evidence</b>
              {savedEvidence.savedFccIterations ?? stats.savedCount ?? 0} tests
              <small>
                Wi‑Fi {savedEvidence.savedWifi ?? 0} · Cell {savedEvidence.savedCell ?? 0}
              </small>
            </span>
          </div>
          <small>
            Session window: {formatSessionTime(sessionStartMs)} → {formatSessionTime(sessionEndMs)}
            {provisionalSessionEnd ? " (provisional end)" : ""}
            {` · buffer ${bufferSeconds}s`}
          </small>
          <label className="bd-rf-check-row bd-rf-fcc-show-all">
            <input
              type="checkbox"
              checked={showAllRows}
              onChange={(event) => setShowAllRows(event.target.checked)}
            />
            <span>Show all original FCC tests (outside-window labeled, not auto-selected)</span>
          </label>
        </div>
      ) : (
        <small className="bd-rf-fcc-evidence-note">No FCC ZIP imported yet.</small>
      )}

      {visibleRows.length ? (
        <div className="bd-rf-fcc-preview-wrap">
          <div className="bd-rf-fcc-preview-table">
            <div className="bd-rf-fcc-preview-head">
              <span />
              <span>test_id</span>
              <span>time</span>
              <span>conn</span>
              <span>DL</span>
              <span>UL</span>
              <span>ping</span>
              <span>jitter</span>
              <span>carrier</span>
              <span>server</span>
              <span>window</span>
              <span>success</span>
            </div>
            {visibleRows.map((row) => {
              const added = Boolean(row.addedToIterations);
              const outside = row.insideBabyDragonTimeWindow !== "yes";
              return (
                <label
                  key={row.fccTestId || row.dedupeKey}
                  className={`bd-rf-fcc-preview-row ${added ? "is-added" : ""} ${row.include ? "is-selected" : ""} ${outside && !added ? "is-outside" : ""}`}
                >
                  <input
                    type="checkbox"
                    disabled={busy || added || outside}
                    checked={Boolean(row.include) && !added && !outside}
                    onChange={(event) => updateRow(row.fccTestId, { include: event.target.checked })}
                  />
                  <span>{row.fccTestId || "—"}</span>
                  <span>{row.fccTestAt ? new Date(row.fccTestAt).toLocaleString() : "—"}</span>
                  <span>{row.fccConnectionType || "—"}</span>
                  <span>{formatMaybeNumber(row.fccDlMbps, 3)}</span>
                  <span>{formatMaybeNumber(row.fccUlMbps, 3)}</span>
                  <span>{formatMaybeNumber(row.fccPingMs, 1)}</span>
                  <span>{formatMaybeNumber(row.fccJitterMs, 1)}</span>
                  <span>{row.fccCarrier || "—"}</span>
                  <span className="bd-rf-fcc-server">{row.fccServerName || "—"}</span>
                  <span>{windowLabel(row)}</span>
                  <span>{added ? "added" : phaseSuccessSummary(row.phaseSuccess)}</span>
                </label>
              );
            })}
          </div>
          <button
            type="button"
            className="bd-rf-fcc-add-selected"
            disabled={busy || !(stats.selectedCount > 0)}
            onClick={handleAddSelected}
          >
            {isAddingRows ? "Adding…" : "Add Selected FCC Rows as Evidence Iterations"}
          </button>
        </div>
      ) : importState ? (
        <p className="bd-rf-inline-note warning">
          No FCC tests inside the BabyDragon session window yet.
          {showAllRows ? "" : " Enable “Show all original FCC tests” to inspect historical rows."}
        </p>
      ) : null}

      {statusLine && importState ? (
        <p className={`bd-rf-inline-note ${String(importMeta?.status || "").includes("fail") || String(importMeta?.status || "").includes("invalid") ? "warning" : "success"}`}>
          {statusLine}
        </p>
      ) : null}
      {(importState?.warnings || []).length ? (
        <details className="bd-rf-fcc-import-warnings">
          <summary>Parse / truncation notes ({importState.warnings.length})</summary>
          <ul>
            {importState.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
