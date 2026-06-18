import React, { useEffect, useMemo, useRef } from "react";
import {
  DATA_DIRECTIONS,
  DATA_TEST_STORAGE_KEYS,
  DEFAULT_NATIVE_HTTP_SETUP,
  NATIVE_HTTP_PRESETS,
} from "../../config/dataTestConfig";

function selectOnFocus(event) {
  window.setTimeout(() => event.target.select?.(), 0);
}

function numericValue(value) {
  return value === undefined || value === null ? "" : String(value);
}

function cleanNumber(value, maxDigits = 3) {
  return String(value || "").replace(/[^0-9]/g, "").slice(0, maxDigits);
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

export default function NativeHttpTestCard({ setup = DEFAULT_NATIVE_HTTP_SETUP, onChange, disabled = false }) {
  const loadedLastUsedRef = useRef(false);
  const skipFirstSaveRef = useRef(true);
  const current = useMemo(() => ({ ...DEFAULT_NATIVE_HTTP_SETUP, ...(setup || {}) }), [setup]);
  const update = (patch, markCustom = true) => {
    onChange?.({ ...current, ...(markCustom ? { presetKey: "custom" } : {}), ...patch });
  };

  useEffect(() => {
    if (loadedLastUsedRef.current) return;
    loadedLastUsedRef.current = true;
    const saved = safeReadJson(DATA_TEST_STORAGE_KEYS.nativeHttp);
    if (saved && typeof saved === "object") {
      onChange?.({ ...DEFAULT_NATIVE_HTTP_SETUP, ...saved });
    }
  }, [onChange]);

  useEffect(() => {
    if (!loadedLastUsedRef.current) return;
    if (skipFirstSaveRef.current) {
      skipFirstSaveRef.current = false;
      return;
    }
    safeWriteJson(DATA_TEST_STORAGE_KEYS.nativeHttp, current);
  }, [current]);

  function applyPreset(presetKey) {
    const preset = NATIVE_HTTP_PRESETS.find((item) => item.key === presetKey);
    if (!preset) return;
    if (preset.key === "custom") {
      update({ presetKey: "custom" }, false);
      return;
    }
    onChange?.({ ...DEFAULT_NATIVE_HTTP_SETUP, ...preset.values });
  }

  function resetDemo() {
    const demo = NATIVE_HTTP_PRESETS[0]?.values || DEFAULT_NATIVE_HTTP_SETUP;
    onChange?.({ ...DEFAULT_NATIVE_HTTP_SETUP, ...demo });
  }

  const activePreset = NATIVE_HTTP_PRESETS.find((item) => item.key === current.presetKey) || NATIVE_HTTP_PRESETS[0];

  return (
    <section className="bd-rf-test-card bd-rf-test-card-native">
      <header>
        <div>
          <b>Native Android HTTP</b>
          <span>Internal BabyDragon engine. Duration is measured time; warmup bytes are counted separately and excluded from Mbps.</span>
        </div>
      </header>

      <div className="bd-rf-preset-row">
        <label>
          <span>Preset</span>
          <select disabled={disabled} value={activePreset.key} onChange={(event) => applyPreset(event.target.value)}>
            {NATIVE_HTTP_PRESETS.map((preset) => (
              <option key={preset.key} value={preset.key}>{preset.label}</option>
            ))}
          </select>
          <em>{activePreset.hint}</em>
        </label>
        <button type="button" disabled={disabled} onClick={resetDemo}>Reset Demo</button>
      </div>

      <label>
        <span>Direction</span>
        <select disabled={disabled} value={current.direction || "dl_ul"} onChange={(event) => update({ direction: event.target.value })}>
          {DATA_DIRECTIONS.map((direction) => (
            <option key={direction.key} value={direction.key}>{direction.label}</option>
          ))}
        </select>
      </label>

      <div className="bd-rf-test-card-grid">
        <label>
          <span>Duration</span>
          <input
            disabled={disabled}
            inputMode="numeric"
            value={numericValue(current.durationSeconds)}
            onFocus={selectOnFocus}
            onChange={(event) => update({ durationSeconds: cleanNumber(event.target.value, 3) })}
            placeholder="10"
          />
          <em>sec</em>
        </label>
        <label>
          <span>Warmup</span>
          <input
            disabled={disabled}
            inputMode="numeric"
            value={numericValue(current.warmupSeconds)}
            onFocus={selectOnFocus}
            onChange={(event) => update({ warmupSeconds: cleanNumber(event.target.value, 2) })}
            placeholder="3"
          />
          <em>sec</em>
        </label>
        <label>
          <span>Interval</span>
          <input
            disabled={disabled}
            inputMode="numeric"
            value={numericValue(current.intervalSeconds)}
            onFocus={selectOnFocus}
            onChange={(event) => update({ intervalSeconds: cleanNumber(event.target.value, 2) })}
            placeholder="1"
          />
          <em>sec</em>
        </label>
        <label>
          <span>Iterations</span>
          <input
            disabled={disabled}
            inputMode="numeric"
            value={numericValue(current.iterations)}
            onFocus={selectOnFocus}
            onChange={(event) => update({ iterations: cleanNumber(event.target.value, 2) })}
            placeholder="1"
          />
          <em>count</em>
        </label>
        <label>
          <span>Wait</span>
          <input
            disabled={disabled}
            inputMode="numeric"
            value={numericValue(current.waitSeconds)}
            onFocus={selectOnFocus}
            onChange={(event) => update({ waitSeconds: cleanNumber(event.target.value, 3) })}
            placeholder="5"
          />
          <em>sec</em>
        </label>
      </div>

      <label>
        <span>DL URL</span>
        <input disabled={disabled} value={current.downloadUrl || ""} onFocus={selectOnFocus} onChange={(event) => update({ downloadUrl: event.target.value })} />
      </label>
      <label>
        <span>UL URL</span>
        <input disabled={disabled} value={current.uploadUrl || ""} onFocus={selectOnFocus} onChange={(event) => update({ uploadUrl: event.target.value })} />
      </label>
    </section>
  );
}
