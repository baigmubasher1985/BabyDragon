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

function InputBox({ label, unit, value, onChange, disabled, maxDigits = 4 }) {
  return (
    <label>
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
  if (!status) return "Check";
  if (status.ok) return "Ready";
  if (status.status === "plugin_error") return "Plugin";
  if (status.status === "binary_missing" || status.status === "binary_missing_or_copy_failed") return "Missing";
  return "Setup";
}

function binarySummary(status) {
  if (!status) return "Press Check to verify the iPerf3 plugin and ABI binary.";
  if (status.status === "plugin_error") return "Plugin is not registered. Rebuild Android and confirm BabyDragonIperfPlugin is included.";
  if (status.ok) return "iPerf3 binary is ready.";
  return "Binary missing. Place the ABI file, rebuild, then press Prepare.";
}

export default function Iperf3TestPage({ setup = DEFAULT_IPERF_SETUP, onChange, disabled = false }) {
  const loadedLastUsedRef = useRef(false);
  const skipFirstSaveRef = useRef(true);
  const [binaryStatus, setBinaryStatus] = useState(null);
  const [binaryBusy, setBinaryBusy] = useState(false);
  const [commandDraft, setCommandDraft] = useState(setup?.customerCommand || setup?.rawCommand || "");
  const [commandParseMessage, setCommandParseMessage] = useState("");

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

  function applyCustomerCommand(commandText = commandDraft) {
    const trimmed = String(commandText || "").trim();
    setCommandDraft(trimmed);
    const parsed = parseIperf3Command(trimmed, current);

    if (!parsed.ok) {
      const message = parsed.warnings.filter(Boolean).join(" ")
        || "Could not parse command. Form values were kept unchanged.";
      setCommandParseMessage(message);
      update({
        commandMode: true,
        presetKey: "custom",
        customerCommand: trimmed,
        rawCommand: trimmed,
      }, false);
      return parsed;
    }

    const values = sanitizeIperfSetup(parsed.values || {}, current);
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
    setCommandParseMessage("Command generated from current form settings.");
  }

  function clearCommandMode() {
    setCommandDraft("");
    setCommandParseMessage("");
    update({ commandMode: false, customerCommand: "", rawCommand: "" }, false);
  }

  async function checkBinaryStatus() {
    setBinaryBusy(true);
    try {
      const status = await BabyDragonIperf.getIperfStatus();
      setBinaryStatus(status);
      return status;
    } catch (error) {
      const message = error?.message || "BabyDragonIperf plugin is not registered yet. Rebuild Android after adding plugin.";
      setBinaryStatus({ ok: false, status: "plugin_error", message });
      return null;
    } finally {
      setBinaryBusy(false);
    }
  }

  async function prepareBinary() {
    setBinaryBusy(true);
    try {
      const status = await BabyDragonIperf.prepareIperfBinary();
      setBinaryStatus(status);
      return status;
    } catch (error) {
      const message = error?.message || "Unable to prepare iPerf3 binary.";
      setBinaryStatus({ ok: false, status: "prepare_error", message });
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
  }

  function resetDemo() {
    const demo = IPERF_PRESETS[0]?.values || DEFAULT_IPERF_SETUP;
    onChange?.({ ...DEFAULT_IPERF_SETUP, ...demo });
    setCommandDraft("");
    setCommandParseMessage("");
  }

  return (
    <section className="bd-rf-test-card bd-rf-test-card-iperf3 bd-rf-test-card-setup bd-rf-iperf3-clean-page">
      <header className="bd-rf-iperf3-clean-header">
        <div>
          <b>iPerf3 Native</b>
          <span>Customer command mode + clean setup page. Real execution comes in Step 1G4B after binary placement.</span>
        </div>
        <em>{binaryBadge(binaryStatus)}</em>
      </header>

      <div className="bd-rf-iperf3-status-compact">
        <div>
          <b>{binarySummary(binaryStatus)}</b>
          <span>{binaryStatus?.abi ? `ABI ${binaryStatus.abi}` : "ABI will be detected from device."}</span>
        </div>
        <div className="bd-rf-iperf3-actions">
          <button type="button" disabled={disabled || binaryBusy} onClick={checkBinaryStatus}>{binaryBusy ? "Checking" : "Check"}</button>
          <button type="button" disabled={disabled || binaryBusy} onClick={prepareBinary}>Prepare</button>
        </div>
      </div>

      <div className="bd-rf-iperf3-quick-strip">
        <span><b>Server</b>{current.server || "N/A"}</span>
        <span><b>Port</b>{displayPort}</span>
        <span><b>Mode</b>{current.protocol || "TCP"} · {DATA_DIRECTIONS.find((item) => item.key === current.direction)?.label || current.direction || "UL"}</span>
      </div>

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

      <div className="bd-rf-iperf3-command-mode bd-rf-iperf3-card-block">
        <div className="bd-rf-iperf3-command-head">
          <b>Paste customer / carrier command</b>
          <span>Supports Verizon, AT&amp;T, T-Mobile, or customer commands. Compact flags like <code>-t15</code>, <code>-P4</code>, and <code>-p5201</code> are accepted.</span>
        </div>
        <textarea
          disabled={disabled}
          value={commandDraft}
          onChange={(event) => {
            setCommandDraft(event.target.value);
            update({ commandMode: true, customerCommand: event.target.value, rawCommand: event.target.value }, false);
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
          <em className={commandParseMessage.toLowerCase().includes("unchanged") ? "bd-rf-iperf3-parse-error" : undefined}>
            {commandParseMessage}
          </em>
        ) : null}
      </div>

      <div className="bd-rf-iperf3-card-block">
        <div className="bd-rf-iperf3-block-title">
          <b>Connection</b>
          <span>Use customer-controlled iPerf3 server for final acceptance.</span>
        </div>
        <label>
          <span>Customer iPerf3 server host/IP</span>
          <input
            disabled={disabled}
            value={current.server || ""}
            onFocus={selectOnFocus}
            onChange={(event) => update({ server: event.target.value })}
            placeholder="10.10.10.20 or iperf.customer.net"
          />
        </label>
        <div className="bd-rf-test-card-grid bd-rf-iperf3-grid-clean">
          <InputBox label="Port" unit="tcp/udp" value={displayPort} onChange={(port) => update({ port: resolvePort(port, displayPort) })} disabled={disabled} maxDigits={5} />
          <label>
            <span>Protocol</span>
            <select disabled={disabled} value={current.protocol || "TCP"} onChange={(event) => update({ protocol: event.target.value })}>
              <option value="TCP">TCP</option>
              <option value="UDP">UDP</option>
            </select>
            <em>mode</em>
          </label>
          <InputBox label="Streams" unit="parallel" value={current.streams} onChange={(streams) => update({ streams })} disabled={disabled} maxDigits={2} />
          <label>
            <span>Direction</span>
            <select disabled={disabled} value={current.direction || DEFAULT_IPERF_SETUP.direction} onChange={(event) => update({ direction: event.target.value })}>
              {DATA_DIRECTIONS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
            <em>mode</em>
          </label>
        </div>
      </div>

      <div className="bd-rf-iperf3-card-block">
        <div className="bd-rf-iperf3-block-title">
          <b>Timing</b>
          <span>Warmup is BabyDragon metadata for reports. iPerf3 execution uses duration and interval.</span>
        </div>
        <div className="bd-rf-test-card-grid bd-rf-iperf3-grid-clean">
          <InputBox label="Duration" unit="sec" value={current.durationSeconds} onChange={(durationSeconds) => update({ durationSeconds })} disabled={disabled} maxDigits={3} />
          <InputBox label="Warmup" unit="sec" value={current.warmupSeconds} onChange={(warmupSeconds) => update({ warmupSeconds })} disabled={disabled} maxDigits={2} />
          <InputBox label="Interval" unit="sec" value={current.intervalSeconds} onChange={(intervalSeconds) => update({ intervalSeconds })} disabled={disabled} maxDigits={2} />
          <InputBox label="Iterations" unit="count" value={current.iterations} onChange={(iterations) => update({ iterations })} disabled={disabled} maxDigits={2} />
          <InputBox label="Wait" unit="sec" value={current.waitSeconds} onChange={(waitSeconds) => update({ waitSeconds })} disabled={disabled} maxDigits={3} />
          <InputBox label="UDP bitrate" unit="Mbps" value={current.udpBitrateMbps} onChange={(udpBitrateMbps) => update({ udpBitrateMbps })} disabled={disabled} maxDigits={5} />
        </div>
      </div>

      <label className="bd-rf-check-row bd-rf-iperf3-reverse-row">
        <input
          disabled={disabled}
          type="checkbox"
          checked={Boolean(current.reverseMode)}
          onChange={(event) => update({ reverseMode: event.target.checked })}
        />
        <span>Use reverse mode <b>-R</b> for downlink when customer server supports it.</span>
      </label>

      <div className="bd-rf-iperf-server-note bd-rf-iperf3-simple-note">
        <span><b>Server side:</b> <code>iperf3 -s -p {displayPort}</code></span>
        <span><b>Binary slot:</b> <code>assets/iperf3/&lt;abi&gt;/iperf3</code></span>
        <span><b>Now:</b> command + setup are saved with RF/GPS. <b>Next:</b> Step 1G4B executes the command.</span>
      </div>

      {current.notes ? <p className="bd-rf-mini-note">{current.notes}</p> : null}
    </section>
  );
}
