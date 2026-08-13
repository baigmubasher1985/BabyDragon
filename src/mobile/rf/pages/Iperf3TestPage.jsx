import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  DATA_DIRECTIONS,
  DATA_TEST_STORAGE_KEYS,
  DEFAULT_IPERF_SETUP,
  IPERF_PRESETS,
} from "../config/dataTestConfig";
import { BabyDragonIperf } from "../../plugins/babyDragonIperf";
import {
  buildIperf3CommandFromSetup,
  parseIperf3Command,
  resolvePort,
  sanitizeIperfSetup,
} from "../../testEngines/iperf3CommandParser";

function cleanIntegerDraft(value, maxDigits = 5) {
  return String(value ?? "").replace(/[^0-9]/g, "").slice(0, maxDigits);
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
    // WebView storage may be unavailable. In-memory setup still works.
  }
}

function InputBox({ label, unit, value, onChange, disabled, maxDigits = 4, className = "" }) {
  return (
    <label className={className || undefined}>
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

function binaryBadge(status) {
  if (status?.ok) return "Ready";
  return "Missing";
}

function binarySummaryShort(status) {
  if (status?.ok) return "Binary ready for this device ABI.";
  if (status?.status === "plugin_error") return "Plugin missing. Rebuild Android with BabyDragonIperfPlugin.";
  return "Binary missing for this device ABI.";
}

export default function Iperf3TestPage({
  setup = DEFAULT_IPERF_SETUP,
  onChange,
  onBinaryStatusChange,
  disabled = false,
}) {
  const loadedLastUsedRef = useRef(false);
  const skipFirstSaveRef = useRef(true);
  const [binaryStatus, setBinaryStatus] = useState(null);
  const [binaryBusy, setBinaryBusy] = useState(false);
  const [commandDraft, setCommandDraft] = useState(setup?.customerCommand || setup?.rawCommand || "");
  const [commandParseMessage, setCommandParseMessage] = useState("");
  const [commandParseTone, setCommandParseTone] = useState("");

  const current = useMemo(
    () => sanitizeIperfSetup(setup || {}, DEFAULT_IPERF_SETUP),
    [setup],
  );
  const displayPort = resolvePort(current.port, "5201");
  const activePreset = IPERF_PRESETS.find((item) => item.key === current.presetKey) || IPERF_PRESETS[0];

  const update = (patch, markCustom = true) => {
    onChange?.({
      ...current,
      ...(markCustom ? { presetKey: "custom" } : {}),
      ...patch,
    });
  };

  function publishBinaryStatus(status) {
    setBinaryStatus(status);
    onBinaryStatusChange?.(status);
  }

  function applyCustomerCommand(commandText = commandDraft) {
    const trimmed = String(commandText || "").trim();
    setCommandDraft(trimmed);
    const parsed = parseIperf3Command(trimmed, current);

    if (!parsed.ok) {
      const message = parsed.errors.filter(Boolean).join(" ")
        || parsed.warnings.filter(Boolean).join(" ")
        || "Could not parse command. Form settings were kept.";
      setCommandParseTone("error");
      setCommandParseMessage(message);
      return parsed;
    }

    const values = sanitizeIperfSetup(parsed.values || {}, current);
    setCommandParseTone("success");
    setCommandParseMessage(parsed.warnings.filter(Boolean).join(" ") || "Command parsed successfully.");
    update({
      ...values,
      commandMode: true,
      presetKey: "custom",
      customerCommand: trimmed,
      rawCommand: trimmed,
    }, false);
    return parsed;
  }

  function generateCommandFromForm() {
    const command = buildIperf3CommandFromSetup(current);
    setCommandDraft(command);
    update({ commandMode: true, customerCommand: command, rawCommand: command }, false);
    setCommandParseTone("success");
    setCommandParseMessage("Command built from form settings.");
  }

  function clearCommandMode() {
    setCommandDraft("");
    setCommandParseMessage("");
    setCommandParseTone("");
    update({ commandMode: false, customerCommand: "", rawCommand: "" }, false);
  }

  async function checkBinaryStatus() {
    setBinaryBusy(true);
    try {
      const status = await BabyDragonIperf.getIperfStatus();
      publishBinaryStatus(status);
      return status;
    } catch (error) {
      const message = error?.message || "BabyDragonIperf plugin is not registered yet. Rebuild Android after adding plugin.";
      const status = { ok: false, status: "plugin_error", message };
      publishBinaryStatus(status);
      return null;
    } finally {
      setBinaryBusy(false);
    }
  }

  async function prepareBinary() {
    setBinaryBusy(true);
    try {
      const status = await BabyDragonIperf.prepareIperfBinary();
      publishBinaryStatus(status);
      return status;
    } catch (error) {
      const message = error?.message || "Unable to prepare iPerf3 binary.";
      publishBinaryStatus({ ok: false, status: "prepare_error", message });
      return null;
    } finally {
      setBinaryBusy(false);
    }
  }

  useEffect(() => {
    if (loadedLastUsedRef.current) return;
    loadedLastUsedRef.current = true;
    const saved = safeReadJson(DATA_TEST_STORAGE_KEYS.iperf);
    if (saved && typeof saved === "object") {
      onChange?.({ ...DEFAULT_IPERF_SETUP, ...saved });
      if (saved.customerCommand || saved.rawCommand) setCommandDraft(saved.customerCommand || saved.rawCommand);
    }
    checkBinaryStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loadedLastUsedRef.current) return;
    if (skipFirstSaveRef.current) {
      skipFirstSaveRef.current = false;
      return;
    }
    safeWriteJson(DATA_TEST_STORAGE_KEYS.iperf, current);
  }, [current]);

  function applyPreset(presetKey) {
    const preset = IPERF_PRESETS.find((item) => item.key === presetKey);
    if (!preset) return;
    if (preset.key === "custom") {
      update({ presetKey: "custom" }, false);
      return;
    }
    onChange?.({ ...DEFAULT_IPERF_SETUP, ...preset.values });
    setCommandDraft(preset.values?.customerCommand || preset.values?.rawCommand || "");
    setCommandParseMessage("");
    setCommandParseTone("");
  }

  function resetDemo() {
    const demo = IPERF_PRESETS[0]?.values || DEFAULT_IPERF_SETUP;
    onChange?.({ ...DEFAULT_IPERF_SETUP, ...demo });
    setCommandDraft("");
    setCommandParseMessage("");
    setCommandParseTone("");
  }

  return (
    <section className="bd-rf-test-card bd-rf-test-card-iperf3 bd-rf-test-card-setup bd-rf-iperf3-clean-page bd-rf-iperf3-compact-page bd-rf-iperf3-layout-1g4d">
      <header className="bd-rf-iperf3-clean-header bd-rf-iperf3-compact-header bd-rf-iperf3-native-head">
        <b>iPerf3 Native</b>
        <em className={binaryStatus?.ok ? "ready" : ""}>{binaryBadge(binaryStatus)}</em>
      </header>

      <div className="bd-rf-iperf3-status-compact bd-rf-iperf3-binary-row bd-rf-iperf3-binary-row-slim">
        <div>
          <b>{binarySummaryShort(binaryStatus)}</b>
          <span>{binaryStatus?.abi ? `ABI ${binaryStatus.abi}` : "ABI auto-detected"}</span>
        </div>
        <div className="bd-rf-iperf3-actions">
          <button type="button" disabled={disabled || binaryBusy} onClick={checkBinaryStatus}>{binaryBusy ? "Checking" : "Check"}</button>
          <button type="button" disabled={disabled || binaryBusy} onClick={prepareBinary}>Prepare</button>
        </div>
      </div>

      <div className="bd-rf-iperf3-card-block bd-rf-iperf3-setup-card">
        <div className="bd-rf-iperf3-block-title bd-rf-iperf3-block-title-slim">
          <b>Current iPerf3 Setup</b>
        </div>
        <div className="bd-rf-iperf3-setup-tiles">
          <label className="bd-rf-iperf3-tile bd-rf-iperf3-tile-wide">
            <span>Server Host / IP</span>
            <input
              disabled={disabled}
              value={current.server || ""}
              onFocus={selectOnFocus}
              onChange={(event) => update({ server: event.target.value })}
              placeholder="10.10.10.20 or iperf.customer.net"
            />
          </label>
          <InputBox className="bd-rf-iperf3-tile" label="Port" unit="tcp/udp" value={displayPort} onChange={(port) => update({ port: resolvePort(port, displayPort) })} disabled={disabled} maxDigits={5} />
          <label className="bd-rf-iperf3-tile">
            <span>Protocol</span>
            <select disabled={disabled} value={current.protocol || "TCP"} onChange={(event) => update({ protocol: event.target.value })}>
              <option value="TCP">TCP</option>
              <option value="UDP">UDP</option>
            </select>
          </label>
          <label className="bd-rf-iperf3-tile">
            <span>Direction</span>
            <select
              disabled={disabled}
              value={current.direction || DEFAULT_IPERF_SETUP.direction}
              onChange={(event) => {
                const direction = event.target.value;
                const protocol = String(current.protocol || "TCP").toUpperCase();
                // Direction is authoritative for -R / --bidir so UL cannot inherit a stale reverse checkbox.
                if (direction === "dl") {
                  update({ direction, reverseMode: true, bidirMode: false });
                } else if (direction === "ul") {
                  update({ direction, reverseMode: false, bidirMode: false });
                } else {
                  update({
                    direction,
                    reverseMode: false,
                    bidirMode: protocol === "TCP",
                  });
                }
              }}
            >
              {DATA_DIRECTIONS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </label>
          <InputBox className="bd-rf-iperf3-tile" label="Streams" unit="parallel" value={current.streams} onChange={(streams) => update({ streams })} disabled={disabled} maxDigits={2} />
          <InputBox className="bd-rf-iperf3-tile" label="Duration" unit="sec" value={current.durationSeconds} onChange={(durationSeconds) => update({ durationSeconds })} disabled={disabled} maxDigits={3} />
          <InputBox className="bd-rf-iperf3-tile" label="Interval" unit="sec" value={current.intervalSeconds} onChange={(intervalSeconds) => update({ intervalSeconds })} disabled={disabled} maxDigits={2} />
          <InputBox className="bd-rf-iperf3-tile" label="Iterations" unit={current.runMode === "continuous" ? "n/a" : "1–999999"} value={current.runMode === "continuous" ? "" : current.iterations} onChange={(iterations) => update({ iterations })} disabled={disabled || current.runMode === "continuous"} maxDigits={6} />
          <InputBox className="bd-rf-iperf3-tile" label="Wait" unit="sec" value={current.waitSeconds} onChange={(waitSeconds) => update({ waitSeconds })} disabled={disabled} maxDigits={3} />
        </div>
        <label className="bd-rf-iperf3-tile bd-rf-iperf3-tile-wide">
          <span>Mode</span>
          <select
            disabled={disabled}
            value={current.runMode === "continuous" ? "continuous" : "fixed"}
            onChange={(event) => update({ runMode: event.target.value })}
          >
            <option value="fixed">Fixed Iterations</option>
            <option value="continuous">Continuous Until Stopped</option>
          </select>
        </label>
      </div>

      <details className="bd-rf-iperf3-collapsible bd-rf-iperf3-command-panel">
        <summary>Paste customer / carrier command</summary>
        <div className="bd-rf-iperf3-command-mode">
          <span className="bd-rf-iperf3-command-hint">Supports spaced, compact, and mixed flags such as <code>-p5201</code>, <code>-t15</code>, and <code>-p5201-t15</code>.</span>
          <textarea
            disabled={disabled}
            value={commandDraft}
            onChange={(event) => {
              setCommandDraft(event.target.value);
              setCommandParseMessage("");
              setCommandParseTone("");
            }}
            placeholder="iperf3 -c 10.10.10.20 -p 5201 -t 15 -P 4 -R -J"
            rows={2}
          />
          <div className="bd-rf-iperf3-command-actions">
            <button type="button" disabled={disabled} onClick={() => applyCustomerCommand(commandDraft)}>Parse</button>
            <button type="button" disabled={disabled} onClick={generateCommandFromForm}>Build</button>
            <button type="button" disabled={disabled} onClick={clearCommandMode}>Clear</button>
          </div>
          {commandParseMessage ? (
            <em className={commandParseTone === "error" ? "bd-rf-iperf3-parse-error" : "bd-rf-iperf3-parse-success"}>
              {commandParseMessage}
            </em>
          ) : null}
        </div>
      </details>

      <details className="bd-rf-iperf3-collapsible bd-rf-iperf3-advanced-panel">
        <summary>Advanced options</summary>
        <div className="bd-rf-iperf3-advanced-body">
          <div className="bd-rf-preset-row bd-rf-iperf3-preset-row">
            <label>
              <span>Preset</span>
              <select disabled={disabled} value={activePreset.key} onChange={(event) => applyPreset(event.target.value)}>
                {IPERF_PRESETS.map((preset) => <option key={preset.key} value={preset.key}>{preset.label}</option>)}
              </select>
              <em>{activePreset.hint}</em>
            </label>
            <button type="button" disabled={disabled} onClick={resetDemo}>Reset</button>
          </div>
          <div className="bd-rf-test-card-grid bd-rf-iperf3-grid-clean">
            <InputBox label="Warmup" unit="sec" value={current.warmupSeconds} onChange={(warmupSeconds) => update({ warmupSeconds })} disabled={disabled} maxDigits={2} />
            <InputBox label="UDP bitrate" unit="Mbps" value={current.udpBitrateMbps} onChange={(udpBitrateMbps) => update({ udpBitrateMbps })} disabled={disabled} maxDigits={5} />
          </div>
          <label className="bd-rf-check-row bd-rf-iperf3-reverse-row">
            <input
              disabled={disabled}
              type="checkbox"
              checked={Boolean(current.reverseMode)}
              onChange={(event) => update({ reverseMode: event.target.checked })}
            />
            <span>Use reverse mode <b>-R</b> for downlink.</span>
          </label>
          <div className="bd-rf-iperf-server-note bd-rf-iperf3-simple-note">
            <span><b>Customer server:</b> <code>iperf3 -s -p {displayPort}</code></span>
            <span><b>Binary path:</b> <code>android/app/src/main/assets/iperf3/&lt;abi&gt;/iperf3</code></span>
          </div>
          {current.notes ? <p className="bd-rf-mini-note">{current.notes}</p> : null}
        </div>
      </details>
    </section>
  );
}
