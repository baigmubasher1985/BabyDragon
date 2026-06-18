import React, { useEffect, useMemo, useRef } from "react";
import {
  DATA_DIRECTIONS,
  DATA_TEST_STORAGE_KEYS,
  DEFAULT_FTP_SETUP,
  FTP_PRESETS,
} from "../../config/dataTestConfig";

function cleanIntegerDraft(value, maxDigits = 4) {
  return String(value ?? "")
    .replace(/[^0-9]/g, "")
    .slice(0, maxDigits);
}

function selectOnFocus(event) {
  window.setTimeout(() => event.target.select?.(), 0);
}

function safeReadJson(key) {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function safeWriteJson(key, value) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Local storage can be blocked on some WebViews. Setup still works in memory.
  }
}

function InputBox({ label, unit, value, onChange, disabled, maxDigits = 4 }) {
  return (
    <label className="bd-rf-native-box">
      <span>{label}</span>
      <input
        disabled={disabled}
        inputMode="numeric"
        value={value ?? ""}
        onFocus={selectOnFocus}
        onChange={(event) => onChange(cleanIntegerDraft(event.target.value, maxDigits))}
      />
      {unit ? <em>{unit}</em> : null}
    </label>
  );
}

export default function FtpTestCard({ setup = {}, onChange, disabled = false }) {
  const loadedLastUsedRef = useRef(false);
  const skipFirstSaveRef = useRef(true);
  const current = useMemo(() => ({ ...DEFAULT_FTP_SETUP, ...(setup || {}) }), [setup]);
  const update = (patch, markCustom = true) => onChange?.({ ...current, ...(markCustom ? { presetKey: "custom" } : {}), ...patch });

  useEffect(() => {
    if (loadedLastUsedRef.current) return;
    loadedLastUsedRef.current = true;
    const saved = safeReadJson(DATA_TEST_STORAGE_KEYS.ftp);
    if (saved && typeof saved === "object") {
      onChange?.({ ...DEFAULT_FTP_SETUP, ...saved });
    }
  }, [onChange]);

  useEffect(() => {
    if (!loadedLastUsedRef.current) return;
    if (skipFirstSaveRef.current) {
      skipFirstSaveRef.current = false;
      return;
    }
    safeWriteJson(DATA_TEST_STORAGE_KEYS.ftp, current);
  }, [current]);

  function applyPreset(presetKey) {
    const preset = FTP_PRESETS.find((item) => item.key === presetKey);
    if (!preset) return;
    if (preset.key === "custom") {
      update({ presetKey: "custom" }, false);
      return;
    }
    onChange?.({ ...DEFAULT_FTP_SETUP, ...preset.values });
  }

  function resetDemo() {
    const demo = FTP_PRESETS[0]?.values || DEFAULT_FTP_SETUP;
    onChange?.({ ...DEFAULT_FTP_SETUP, ...demo });
  }

  const activePreset = FTP_PRESETS.find((item) => item.key === current.presetKey) || FTP_PRESETS[0];

  return (
    <section className="bd-rf-test-card bd-rf-test-card-ftp">
      <header>
        <div>
          <b>FTP Test</b>
          <span>Native FTP runner is active. Public demo servers are smoke-test only; use a controlled FTP server for final DL/UL throughput.</span>
        </div>
        <em>Active</em>
      </header>

      <div className="bd-rf-preset-row">
        <label>
          <span>Preset</span>
          <select disabled={disabled} value={activePreset.key} onChange={(event) => applyPreset(event.target.value)}>
            {FTP_PRESETS.map((preset) => (
              <option key={preset.key} value={preset.key}>{preset.label}</option>
            ))}
          </select>
          <em>{activePreset.hint}</em>
        </label>
        <button type="button" disabled={disabled} onClick={resetDemo}>Reset Demo</button>
      </div>

      <label className="bd-rf-full-input">
        <span>FTP Host / Server</span>
        <input
          disabled={disabled}
          placeholder="ftp.example.com or 10.10.10.10"
          value={current.host || ""}
          onFocus={selectOnFocus}
          onChange={(event) => update({ host: event.target.value })}
        />
      </label>

      <div className="bd-rf-test-card-grid">
        <InputBox label="Port" unit="tcp" value={current.port} onChange={(port) => update({ port })} disabled={disabled} maxDigits={5} />
        <label className="bd-rf-native-box">
          <span>Direction</span>
          <select disabled={disabled} value={current.direction || DEFAULT_FTP_SETUP.direction} onChange={(event) => update({ direction: event.target.value })}>
            {DATA_DIRECTIONS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
          <em>mode</em>
        </label>
      </div>

      <div className="bd-rf-test-card-grid">
        <InputBox label="Duration" unit="sec" value={current.durationSeconds} onChange={(durationSeconds) => update({ durationSeconds })} disabled={disabled} maxDigits={3} />
        <InputBox label="Warmup" unit="sec" value={current.warmupSeconds} onChange={(warmupSeconds) => update({ warmupSeconds })} disabled={disabled} maxDigits={2} />
        <InputBox label="Interval" unit="sec" value={current.intervalSeconds} onChange={(intervalSeconds) => update({ intervalSeconds })} disabled={disabled} maxDigits={2} />
        <InputBox label="Iterations" unit="count" value={current.iterations} onChange={(iterations) => update({ iterations })} disabled={disabled} maxDigits={2} />
        <InputBox label="Wait" unit="sec" value={current.waitSeconds} onChange={(waitSeconds) => update({ waitSeconds })} disabled={disabled} maxDigits={3} />
        <InputBox label="UL file size" unit="MB" value={current.uploadFileSizeMb} onChange={(uploadFileSizeMb) => update({ uploadFileSizeMb })} disabled={disabled} maxDigits={4} />
      </div>

      <div className="bd-rf-test-card-grid">
        <label className="bd-rf-full-input">
          <span>Username</span>
          <input disabled={disabled} value={current.username || ""} onFocus={selectOnFocus} onChange={(event) => update({ username: event.target.value })} />
        </label>
        <label className="bd-rf-full-input">
          <span>Password</span>
          <input disabled={disabled} type="password" value={current.password || ""} onFocus={selectOnFocus} onChange={(event) => update({ password: event.target.value })} />
        </label>
      </div>

      <label className="bd-rf-full-input">
        <span>DL remote file/path</span>
        <input
          disabled={disabled}
          placeholder="/download/test.bin"
          value={current.downloadRemotePath || ""}
          onFocus={selectOnFocus}
          onChange={(event) => update({ downloadRemotePath: event.target.value })}
        />
      </label>

      <label className="bd-rf-full-input">
        <span>UL remote folder/path</span>
        <input
          disabled={disabled}
          placeholder="/upload/"
          value={current.uploadRemotePath || ""}
          onFocus={selectOnFocus}
          onChange={(event) => update({ uploadRemotePath: event.target.value })}
        />
      </label>

      <div className="bd-rf-check-grid">
        <label>
          <input type="checkbox" disabled={disabled} checked={Boolean(current.passiveMode)} onChange={(event) => update({ passiveMode: event.target.checked })} />
          Passive mode
        </label>
        <label>
          <input type="checkbox" disabled={disabled} checked={Boolean(current.secure)} onChange={(event) => update({ secure: event.target.checked })} />
          FTPS / secure later
        </label>
      </div>

      {current.notes ? <p className="bd-rf-mini-note">{current.notes}</p> : null}
      <div className="bd-rf-ftp-server-note">
        <span><b>Rebex</b> DL smoke only. Read-only, speed-limited, tiny file.</span>
        <span><b>DLPTest</b> UL smoke only. Password may rotate.</span>
        <span><b>Final THP</b> Use controlled FTP with 50MB/100MB/500MB files.</span>
      </div>
    </section>
  );
}
