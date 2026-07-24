import React, { useId, useMemo, useRef, useState } from "react";
import {
  buildOoklaCsvImportDebugPayload,
  csvRowToEvidenceDraft,
  parseOoklaCsvImport,
  reapplyOoklaCsvTimeWindow,
} from "../../utils/ooklaCsvImport";

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

export default function OoklaCsvImportPanel({
  sessionStartMs = null,
  sessionEndMs = null,
  provisionalEnd = false,
  disabled = false,
  onAddSelectedRows,
  onImportDebugChange,
}) {
  const fileInputId = useId();
  const [bufferSeconds, setBufferSeconds] = useState(60);
  const [customBuffer, setCustomBuffer] = useState("");
  const [useSessionWindow, setUseSessionWindow] = useState(true);
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [importState, setImportState] = useState(null);
  const [message, setMessage] = useState("");
  const [pickerUnavailable, setPickerUnavailable] = useState(false);
  const [editingRow, setEditingRow] = useState(null);
  const [isAddingCsvRows, setIsAddingCsvRows] = useState(false);
  const isAddingCsvRowsRef = useRef(false);

  const effectiveBuffer = customBuffer.trim() !== ""
    ? Math.max(0, Number(customBuffer) || 0)
    : Number(bufferSeconds) || 60;

  const visibleRows = useMemo(() => {
    const rows = importState?.rows || [];
    if (!showSelectedOnly) return rows;
    return rows.filter((row) => row.include);
  }, [importState, showSelectedOnly]);

  function publishDebug(nextState) {
    onImportDebugChange?.(nextState ? buildOoklaCsvImportDebugPayload(nextState) : null);
  }

  function applyWindow(nextState, {
    startMs = sessionStartMs,
    endMs = sessionEndMs,
    provisional = provisionalEnd,
    preserveManualIncludes = false,
  } = {}) {
    if (!nextState) return null;
    if (!useSessionWindow) {
      const cleared = {
        ...nextState,
        sessionStartMs: startMs,
        sessionEndMs: endMs,
        bufferSeconds: effectiveBuffer,
        provisionalEnd: provisional,
        warnings: [
          ...(nextState.warnings || []).filter((item) => !/session time window|provisional/i.test(item)),
          "BabyDragon session time window filter is off. Select rows manually.",
        ],
      };
      setImportState(cleared);
      publishDebug(cleared);
      return cleared;
    }
    const updated = reapplyOoklaCsvTimeWindow(nextState, {
      sessionStartMs: startMs,
      sessionEndMs: endMs,
      bufferSeconds: effectiveBuffer,
      provisionalEnd: provisional,
      preserveManualIncludes,
    });
    setImportState(updated);
    publishDebug(updated);
    return updated;
  }

  async function handleFilePicked(event) {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (!file) return;
    setMessage("");
    setPickerUnavailable(false);
    try {
      const text = await file.text();
      const parsed = parseOoklaCsvImport(text, {
        fileName: file.name || "ookla-export.csv",
        sessionStartMs: useSessionWindow ? sessionStartMs : null,
        sessionEndMs: useSessionWindow ? sessionEndMs : null,
        bufferSeconds: effectiveBuffer,
        provisionalEnd,
      });
      if (!parsed.ok && !(parsed.rows || []).length) {
        setImportState(parsed);
        publishDebug(parsed);
        setMessage((parsed.errors || []).join(" ") || "CSV import failed.");
        return;
      }
      setImportState(parsed);
      publishDebug(parsed);
      setMessage(
        `Imported ${parsed.stats?.imported || 0} row(s). `
        + `${parsed.stats?.insideWindow || 0} inside window, `
        + `${parsed.stats?.selected || 0} auto-selected.`,
      );
    } catch (error) {
      const msg = String(error?.message || error || "");
      if (/not available|securityerror|file picker|abort/i.test(msg)) {
        setPickerUnavailable(true);
        setMessage("CSV file picker is not available on this device. Use manual evidence or retry from Android Files.");
      } else {
        setMessage(`CSV import failed: ${msg}`);
      }
    }
  }

  function updateRow(originalRowNumber, patch) {
    setImportState((prev) => {
      if (!prev) return prev;
      const rows = (prev.rows || []).map((row) => {
        if (row.originalRowNumber !== originalRowNumber) return row;
        const next = { ...row, ...patch };
        if (Object.prototype.hasOwnProperty.call(patch, "include")) {
          next.manualInclude = Boolean(patch.include);
          next.status = patch.include ? "selected" : (row.insideBabyDragonTimeWindow === false ? "outside_window" : "excluded");
        }
        return next;
      });
      const nextState = {
        ...prev,
        rows,
        stats: {
          ...prev.stats,
          selected: rows.filter((row) => row.include).length,
        },
      };
      publishDebug(nextState);
      return nextState;
    });
  }

  function selectAllInsideWindow() {
    setImportState((prev) => {
      if (!prev) return prev;
      const rows = (prev.rows || []).map((row) => {
        const canSelect = row.insideBabyDragonTimeWindow === true
          && row.status !== "missing_required"
          && row.status !== "duplicate_result_id"
          && row.status !== "added"
          && !row.addedToIterations
          && !(row.parseErrors || []).length;
        if (!canSelect) return row;
        return { ...row, include: true, manualInclude: true, status: "selected" };
      });
      const nextState = {
        ...prev,
        rows,
        stats: { ...prev.stats, selected: rows.filter((row) => row.include).length },
      };
      publishDebug(nextState);
      return nextState;
    });
  }

  function clearImport() {
    setImportState(null);
    setEditingRow(null);
    setMessage("");
    setIsAddingCsvRows(false);
    isAddingCsvRowsRef.current = false;
    publishDebug(null);
  }

  function markRowsAdded(originalRowNumbers = []) {
    const numberSet = new Set(originalRowNumbers);
    if (!numberSet.size) return;
    setImportState((prev) => {
      if (!prev) return prev;
      const rows = (prev.rows || []).map((row) => {
        if (!numberSet.has(row.originalRowNumber)) return row;
        return {
          ...row,
          include: false,
          manualInclude: false,
          addedToIterations: true,
          status: "added",
        };
      });
      const nextState = {
        ...prev,
        rows,
        stats: {
          ...prev.stats,
          selected: rows.filter((row) => row.include).length,
        },
      };
      publishDebug(nextState);
      return nextState;
    });
  }

  async function handleAddSelected() {
    // Synchronous guard: ignore double-clicks before React re-renders.
    if (isAddingCsvRowsRef.current || isAddingCsvRows) return;

    const selected = (importState?.rows || []).filter((row) => (
      row.include && !row.addedToIterations && row.status !== "added"
    ));
    if (!selected.length) {
      setMessage("Select at least one CSV row before adding iterations.");
      return;
    }

    isAddingCsvRowsRef.current = true;
    setIsAddingCsvRows(true);
    setMessage("");

    try {
      const drafts = selected.map((row) => csvRowToEvidenceDraft(row, {
        fileName: importState.fileName,
        importedAt: importState.importedAt,
        bufferSeconds: importState.bufferSeconds,
        sessionStartMs: importState.sessionStartMs,
        sessionEndMs: importState.sessionEndMs,
        feConfirmed: false,
      }));
      const result = await onAddSelectedRows?.(drafts, buildOoklaCsvImportDebugPayload(importState));
      const added = Number(result?.added) || 0;
      const skipped = Number(result?.skippedDuplicates) || 0;

      // Prevent re-adding the same selected rows on a second click.
      markRowsAdded(selected.map((row) => row.originalRowNumber));

      if (skipped > 0 && added <= 0) {
        setMessage("Duplicate OOKLA CSV rows skipped.");
        return;
      }
      if (skipped > 0) {
        setMessage(`Added ${added} CSV row(s). Duplicate OOKLA CSV rows skipped.`);
        return;
      }
      setMessage(`Added ${added} CSV row(s) as OOKLA iterations.`);
    } finally {
      isAddingCsvRowsRef.current = false;
      setIsAddingCsvRows(false);
    }
  }

  // Recompute when session window / buffer props change.
  React.useEffect(() => {
    setImportState((prev) => {
      if (!prev) return prev;
      let next;
      if (!useSessionWindow) {
        next = {
          ...prev,
          sessionStartMs,
          sessionEndMs,
          bufferSeconds: effectiveBuffer,
          provisionalEnd,
          warnings: [
            ...(prev.warnings || []).filter((item) => !/session time window|provisional/i.test(item)),
            "BabyDragon session time window filter is off. Select rows manually.",
          ],
        };
      } else {
        next = reapplyOoklaCsvTimeWindow(prev, {
          sessionStartMs,
          sessionEndMs,
          bufferSeconds: effectiveBuffer,
          provisionalEnd,
          preserveManualIncludes: true,
        });
      }
      // Defer parent debug publish to avoid render-phase setState loops.
      queueMicrotask(() => onImportDebugChange?.(buildOoklaCsvImportDebugPayload(next)));
      return next;
    });
    // intentionally omit onImportDebugChange (parent inline callback)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStartMs, sessionEndMs, provisionalEnd, effectiveBuffer, useSessionWindow]);

  return (
    <section className="bd-rf-ookla-csv-panel bd-rf-ookla-csv-panel-nested">
      <p className="bd-rf-ookla-evidence-note">
        BabyDragon filters CSV rows by this recording session time window.
      </p>

      <div className="bd-rf-ookla-csv-controls">
        <label className={`bd-mobile-evidence-action-v7c ${disabled ? "is-disabled" : ""}`} htmlFor={fileInputId}>
          Import OOKLA CSV
        </label>
        <input
          id={fileInputId}
          type="file"
          accept=".csv,text/csv"
          disabled={disabled}
          onChange={handleFilePicked}
          onClick={(event) => {
            // Detect environments where picker never opens.
            if (disabled) {
              event.preventDefault();
              setPickerUnavailable(true);
            }
          }}
        />

        <label className="bd-rf-check-row">
          <input
            type="checkbox"
            checked={useSessionWindow}
            disabled={disabled}
            onChange={(event) => setUseSessionWindow(event.target.checked)}
          />
          <span>Use BabyDragon Session Time Window</span>
        </label>

        <label>
          <span>Time Window Buffer (seconds)</span>
          <select
            disabled={disabled}
            value={customBuffer.trim() !== "" ? "custom" : String(bufferSeconds)}
            onChange={(event) => {
              if (event.target.value === "custom") {
                setCustomBuffer(String(bufferSeconds));
              } else {
                setCustomBuffer("");
                setBufferSeconds(Number(event.target.value) || 60);
              }
            }}
          >
            <option value="30">30</option>
            <option value="60">60</option>
            <option value="120">120</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        {customBuffer.trim() !== "" ? (
          <label>
            <span>Custom buffer seconds</span>
            <input
              type="number"
              inputMode="numeric"
              disabled={disabled}
              value={customBuffer}
              onChange={(event) => setCustomBuffer(event.target.value)}
            />
          </label>
        ) : null}
      </div>

      <div className="bd-rf-ookla-csv-session-meta">
        <small>BabyDragon session start: {formatSessionTime(sessionStartMs)}</small>
        <small>
          BabyDragon session end: {formatSessionTime(sessionEndMs)}
          {provisionalEnd ? " (provisional)" : ""}
        </small>
        <small>Buffer: {effectiveBuffer}s</small>
      </div>

      {pickerUnavailable ? (
        <small className="bd-rf-ookla-warning">
          CSV file picker is not available on this device. Use manual evidence or retry from Android Files.
        </small>
      ) : null}
      {message ? <small className="bd-rf-ookla-screenshot-meta">{message}</small> : null}
      {(importState?.warnings || []).map((warning) => (
        <small key={warning} className="bd-rf-ookla-warning">{warning}</small>
      ))}

      {importState?.rows?.length ? (
        <>
          <div className="bd-rf-ookla-csv-actions">
            <button type="button" className="bd-rf-ookla-secondary-btn" disabled={disabled} onClick={() => setShowSelectedOnly(false)}>
              Show all imported rows
            </button>
            <button type="button" className="bd-rf-ookla-secondary-btn" disabled={disabled} onClick={() => setShowSelectedOnly(true)}>
              Show selected rows only
            </button>
            <button type="button" className="bd-rf-ookla-secondary-btn" disabled={disabled} onClick={selectAllInsideWindow}>
              Select all inside window
            </button>
            <button type="button" className="bd-rf-ookla-danger-btn" disabled={disabled} onClick={clearImport}>
              Clear CSV import
            </button>
            <button
              type="button"
              className="bd-mobile-primary bd-rf-ookla-save-btn"
              disabled={disabled || isAddingCsvRows}
              onClick={handleAddSelected}
            >
              {isAddingCsvRows ? "Adding CSV Rows…" : "Add Selected CSV Rows as OOKLA Iterations"}
            </button>
          </div>

          <div className="bd-rf-ookla-csv-table-wrap">
            <table className="bd-rf-ookla-csv-table">
              <thead>
                <tr>
                  <th>Incl</th>
                  <th>#</th>
                  <th>Date/Time</th>
                  <th>DL</th>
                  <th>UL</th>
                  <th>Ping</th>
                  <th>Jitter</th>
                  <th>Server</th>
                  <th>Conn</th>
                  <th>Lat</th>
                  <th>Lon</th>
                  <th>Result ID</th>
                  <th>Result URL</th>
                  <th>Status</th>
                  <th>Edit</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr
                    key={`ookla-csv-${row.originalRowNumber}`}
                    className={[
                      row.include ? "is-selected" : "",
                      row.addedToIterations || row.status === "added" ? "is-added" : "",
                    ].filter(Boolean).join(" ") || undefined}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={Boolean(row.include)}
                        disabled={
                          disabled
                          || isAddingCsvRows
                          || row.status === "missing_required"
                          || row.status === "added"
                          || Boolean(row.addedToIterations)
                        }
                        onChange={(event) => updateRow(row.originalRowNumber, { include: event.target.checked })}
                      />
                    </td>
                    <td>{row.originalRowNumber}</td>
                    <td>{row.ooklaDateTime || "—"}</td>
                    <td>{formatMaybeNumber(row.dlMbps, 2)}</td>
                    <td>{formatMaybeNumber(row.ulMbps, 2)}</td>
                    <td>{formatMaybeNumber(row.pingMs, 1)}</td>
                    <td>{formatMaybeNumber(row.jitterMs, 1)}</td>
                    <td>{row.serverLocation || "—"}</td>
                    <td>{row.connectionType || "—"}</td>
                    <td>{formatMaybeNumber(row.ooklaUserLatitude, 6)}</td>
                    <td>{formatMaybeNumber(row.ooklaUserLongitude, 6)}</td>
                    <td>{row.resultId || "—"}</td>
                    <td className="bd-rf-ookla-csv-url">{row.resultUrl || "—"}</td>
                    <td>{row.status}</td>
                    <td>
                      <button type="button" className="bd-rf-ookla-secondary-btn" disabled={disabled} onClick={() => setEditingRow(row)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {editingRow ? (
        <div className="bd-rf-ookla-csv-edit">
          <strong>Edit CSV row #{editingRow.originalRowNumber}</strong>
          <div className="bd-rf-ookla-evidence-grid">
            {[
              ["dlMbps", "DL Mbps"],
              ["ulMbps", "UL Mbps"],
              ["pingMs", "Ping ms"],
              ["jitterMs", "Jitter ms"],
              ["serverLocation", "Server"],
              ["connectionType", "Connection Type"],
              ["ooklaUserLatitude", "Lat"],
              ["ooklaUserLongitude", "Lon"],
              ["resultId", "Result ID"],
              ["resultUrl", "Result URL"],
            ].map(([key, label]) => (
              <label key={key}>
                <span>{label}</span>
                <input
                  type="text"
                  value={editingRow[key] ?? ""}
                  onChange={(event) => setEditingRow((prev) => ({ ...prev, [key]: event.target.value }))}
                />
              </label>
            ))}
          </div>
          <div className="bd-rf-ookla-csv-actions">
            <button
              type="button"
              className="bd-mobile-primary"
              onClick={() => {
                const numericKeys = ["dlMbps", "ulMbps", "pingMs", "jitterMs", "ooklaUserLatitude", "ooklaUserLongitude"];
                const patch = { ...editingRow, manualInclude: true, include: true, status: "selected" };
                numericKeys.forEach((key) => {
                  const raw = editingRow[key];
                  if (raw === "" || raw === null || raw === undefined) {
                    patch[key] = null;
                    return;
                  }
                  const number = Number(raw);
                  patch[key] = Number.isFinite(number) ? number : editingRow[key];
                });
                const fieldSources = { ...(editingRow.fieldSources || {}) };
                ["dlMbps", "ulMbps", "pingMs", "jitterMs", "serverLocation", "connectionType", "ooklaUserLatitude", "ooklaUserLongitude", "resultId", "resultUrl"].forEach((key) => {
                  fieldSources[key] = {
                    value: String(patch[key] ?? ""),
                    source: "manual",
                    confidence: "high",
                    reason: "FE edited CSV row before save",
                  };
                });
                patch.fieldSources = fieldSources;
                updateRow(editingRow.originalRowNumber, patch);
                setEditingRow(null);
              }}
            >
              Apply row edits
            </button>
            <button type="button" className="bd-rf-ookla-secondary-btn" onClick={() => setEditingRow(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
