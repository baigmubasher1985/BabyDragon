import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  DATA_TEST_STORAGE_KEYS,
  DEFAULT_FTP_SETUP,
  FTP_PRESETS,
} from "../../config/dataTestConfig";

const FTP_PRIMARY_DIRECTIONS = [
  { key: "dl", label: "Download" },
  { key: "ul", label: "Upload" },
];

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

function friendlyHost(host = "") {
  return String(host || "").replace(/^ftp:\/\//i, "").split("/")[0] || "FTP server";
}

function friendlyDownloadLabel(path = "", presetKey = "") {
  const p = String(path || "").trim();
  if (!p) return "Not configured";
  if (presetKey === "rebex_dl_demo" || /readme\.txt$/i.test(p)) return "Tiny demo file (readme.txt)";
  const mb = p.match(/(\d+)\s*MB/i) || p.match(/(\d+)MB/i);
  if (mb) return `${mb[1]} MB Test File`;
  const base = p.split("/").filter(Boolean).pop();
  return base || p;
}

function capabilityCard({ presetKey, direction, host }) {
  const dir = String(direction || "").toLowerCase();
  if (presetKey === "dlptest_ul_demo") {
    if (dir === "dl" || dir === "dl_ul") {
      return {
        tone: "warn",
        title: "Upload only on this preset",
        body: "DLPTest public profile supports UL smoke. DL / DL+UL are not guaranteed. Server may return 550 Access denied.",
      };
    }
    return {
      tone: "ok",
      title: "Upload ready",
      body: `${friendlyHost(host)} · UL smoke/upload configured. Not a final throughput server.`,
    };
  }
  if (presetKey === "rebex_dl_demo") {
    if (dir === "ul" || dir === "dl_ul") {
      return {
        tone: "warn",
        title: "Download only",
        body: "Rebex demo is read-only. Uploads are not allowed on this public profile.",
      };
    }
    return {
      tone: "ok",
      title: "Download ready",
      body: `${friendlyHost(host)} · DL smoke only (tiny/speed-limited file).`,
    };
  }
  if (dir === "dl_ul") {
    return {
      tone: "info",
      title: "Sequential DL then UL",
      body: `${friendlyHost(host)} · BabyDragon runs download then upload in one iteration (not simultaneous bidir).`,
    };
  }
  return {
    tone: "ok",
    title: "Server ready",
    body: `${friendlyHost(host)} · ${dir === "ul" ? "Upload" : "Download"} configured.`,
  };
}

export default function FtpTestCard({ setup = {}, onChange, disabled = false }) {
  const loadedLastUsedRef = useRef(false);
  const skipFirstSaveRef = useRef(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
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

  const activePreset = FTP_PRESETS.find((item) => item.key === current.presetKey) || FTP_PRESETS[0];
  const direction = String(current.direction || "ul").toLowerCase();
  const primaryDirection = direction === "dl" || direction === "ul" ? direction : "ul";
  const showDlFile = direction === "dl" || direction === "dl_ul";
  const showUlFile = direction === "ul" || direction === "dl_ul";
  const capability = capabilityCard({
    presetKey: activePreset?.key,
    direction,
    host: current.host,
  });
  const fixedMode = current.runMode !== "continuous";

  return (
    <section className="bd-rf-test-card bd-rf-test-card-ftp bd-rf-ftp-simplified">
      <header>
        <div>
          <b>FTP Test</b>
          <span>Set direction, server, iterations — then start from the Data controls.</span>
        </div>
        <em>Active</em>
      </header>

      <div className={`bd-rf-ftp-capability bd-rf-ftp-capability-${capability.tone}`} role="status">
        <strong>{capability.title}</strong>
        <span>{capability.body}</span>
      </div>

      <div className="bd-rf-ftp-primary">
        <label className="bd-rf-native-box bd-rf-ftp-direction">
          <span>Direction</span>
          <select
            disabled={disabled}
            value={primaryDirection}
            onChange={(event) => update({ direction: event.target.value })}
          >
            {FTP_PRIMARY_DIRECTIONS.map((item) => (
              <option key={item.key} value={item.key}>{item.label}</option>
            ))}
          </select>
          <em>primary</em>
        </label>

        <label className="bd-rf-native-box">
          <span>FTP Server</span>
          <select
            disabled={disabled}
            value={activePreset.key}
            onChange={(event) => applyPreset(event.target.value)}
          >
            {FTP_PRESETS.map((preset) => (
              <option key={preset.key} value={preset.key}>{preset.label}</option>
            ))}
          </select>
          <em>{friendlyHost(current.host)}</em>
        </label>

        <label className="bd-rf-native-box">
          <span>Mode</span>
          <select
            disabled={disabled}
            value={fixedMode ? "fixed" : "continuous"}
            onChange={(event) => update({ runMode: event.target.value })}
          >
            <option value="fixed">Fixed Iterations</option>
            <option value="continuous">Continuous Until Stopped</option>
          </select>
          <em>{fixedMode ? "count" : "until stop"}</em>
        </label>

        {fixedMode ? (
          <InputBox
            label="Iterations"
            unit="1–999999"
            value={current.iterations}
            onChange={(iterations) => update({ iterations })}
            disabled={disabled}
            maxDigits={6}
          />
        ) : null}

        <InputBox
          label="Wait between tests"
          unit="sec"
          value={current.waitSeconds}
          onChange={(waitSeconds) => update({ waitSeconds })}
          disabled={disabled}
          maxDigits={3}
        />
      </div>

      {showDlFile ? (
        <div className="bd-rf-ftp-file-row">
          <span>Download File</span>
          <strong>{friendlyDownloadLabel(current.downloadRemotePath, activePreset?.key)}</strong>
          <em>{current.downloadRemotePath || "Set path in Advanced"}</em>
        </div>
      ) : null}

      {showUlFile ? (
        <div className="bd-rf-ftp-file-row">
          <span>Upload File</span>
          <strong>Timed upload payload</strong>
          <em>{current.uploadRemotePath || "/"} · duration-based (not a fixed MB file)</em>
        </div>
      ) : null}

      <details
        className="bd-rf-ftp-advanced"
        open={advancedOpen}
        onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
      >
        <summary>Advanced Options</summary>

        <label className="bd-rf-full-input">
          <span>Direction (includes sequential DL then UL)</span>
          <select
            disabled={disabled}
            value={current.direction || DEFAULT_FTP_SETUP.direction}
            onChange={(event) => update({ direction: event.target.value })}
          >
            <option value="dl">Download only</option>
            <option value="ul">Upload only</option>
            <option value="dl_ul">DL then UL (sequential)</option>
          </select>
        </label>

        <label className="bd-rf-full-input">
          <span>FTP Host</span>
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
          <InputBox label="Duration" unit="sec" value={current.durationSeconds} onChange={(durationSeconds) => update({ durationSeconds })} disabled={disabled} maxDigits={3} />
          <InputBox label="Warmup" unit="sec" value={current.warmupSeconds} onChange={(warmupSeconds) => update({ warmupSeconds })} disabled={disabled} maxDigits={2} />
          <InputBox label="Interval" unit="sec" value={current.intervalSeconds} onChange={(intervalSeconds) => update({ intervalSeconds })} disabled={disabled} maxDigits={2} />
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
      </details>
    </section>
  );
}
