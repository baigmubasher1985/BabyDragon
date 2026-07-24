import React, { useId } from "react";
import { DEFAULT_FCC_IMPORT_SETUP } from "../../config/dataTestConfig";

function formatBytes(sizeBytes) {
  const size = Number(sizeBytes);
  if (!Number.isFinite(size) || size < 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FccTestCard({
  setup = DEFAULT_FCC_IMPORT_SETUP,
  importMeta = null,
  onChange,
  onImportFile,
  disabled = false,
}) {
  const fileInputId = useId();
  const activeImport = importMeta || setup.appFccImport || null;
  const update = (patch) => onChange?.({ ...setup, ...patch });

  function handleFilePicked(event) {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (file) onImportFile?.(file);
  }

  return (
    <section className="bd-rf-test-card bd-rf-test-card-planned bd-rf-fcc-evidence-card">
      <header>
        <div>
          <b>FCC App Session Context</b>
          <span>BabyDragon records RF/GPS while you run the FCC app externally.</span>
        </div>
        <em>Context</em>
      </header>

      <p className="bd-rf-fcc-evidence-note">
        Import the FCC export file after the session. Raw import metadata is captured now; truncate will run after the FCC parser is implemented with a sample schema.
      </p>

      <label>
        <span>Timestamp buffer</span>
        <input
          disabled={disabled}
          inputMode="numeric"
          value={setup.timestampBufferSeconds ?? 30}
          onChange={(event) => update({ timestampBufferSeconds: event.target.value })}
        />
        <em>sec</em>
      </label>
      <label className="bd-rf-check-row">
        <input
          disabled={disabled}
          type="checkbox"
          checked={setup.keepRawImport !== false}
          onChange={(event) => update({ keepRawImport: event.target.checked })}
        />
        <span>Keep raw imported FCC output (future import step)</span>
      </label>
      <label className="bd-rf-check-row">
        <input
          disabled={disabled}
          type="checkbox"
          checked={setup.saveTruncatedByGrid !== false}
          onChange={(event) => update({ saveTruncatedByGrid: event.target.checked })}
        />
        <span>Save truncated output with grid/session name (future import step)</span>
      </label>

      <label className="bd-rf-fcc-import-picker" htmlFor={fileInputId}>
        <span>FCC export file import</span>
        <input
          id={fileInputId}
          type="file"
          accept=".csv,.json,.txt,.zip,text/csv,application/json,text/plain,application/zip"
          disabled={disabled}
          onChange={handleFilePicked}
        />
        <small>Choose CSV, JSON, TXT, or ZIP FCC export file.</small>
      </label>

      {activeImport ? (
        <div className="bd-rf-fcc-import-status">
          <strong>{activeImport.fileName || "Imported file"}</strong>
          <small>
            {formatBytes(activeImport.sizeBytes)} · {activeImport.detectedFormat || "unknown"} · {activeImport.parseStatus || activeImport.status || "unknown"}
          </small>
          <small>{activeImport.message || "Import metadata captured."}</small>
          {activeImport.truncateStatus ? <small>Truncate status: {activeImport.truncateStatus}</small> : null}
          {activeImport.rawTextPreview ? (
            <details className="bd-rf-fcc-import-preview">
              <summary>Raw import preview</summary>
              <pre>{activeImport.rawTextPreview}</pre>
            </details>
          ) : null}
        </div>
      ) : (
        <small className="bd-rf-fcc-evidence-note">No FCC export file imported yet.</small>
      )}
    </section>
  );
}
