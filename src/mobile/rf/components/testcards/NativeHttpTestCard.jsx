import React from "react";
import { DEFAULT_NATIVE_HTTP_SETUP, DATA_DIRECTIONS } from "../../config/dataTestConfig";

function selectOnFocus(event) {
  window.setTimeout(() => event.target.select?.(), 0);
}

function numericValue(value) {
  return value === undefined || value === null ? "" : String(value);
}

function cleanNumber(value, maxDigits = 3) {
  return String(value || "").replace(/[^0-9]/g, "").slice(0, maxDigits);
}

export default function NativeHttpTestCard({ setup = DEFAULT_NATIVE_HTTP_SETUP, onChange, disabled = false }) {
  const update = (patch) => onChange?.({ ...setup, ...patch });

  return (
    <section className="bd-rf-test-card bd-rf-test-card-native">
      <header>
        <div>
          <b>Native Android HTTP</b>
          <span>Internal BabyDragon engine. Duration is the requested test time. DL+UL splits the time.</span>
        </div>
      </header>

      <label>
        <span>Direction</span>
        <select disabled={disabled} value={setup.direction || "dl_ul"} onChange={(event) => update({ direction: event.target.value })}>
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
            value={numericValue(setup.durationSeconds)}
            onFocus={selectOnFocus}
            onChange={(event) => update({ durationSeconds: cleanNumber(event.target.value, 3) })}
            placeholder="10"
          />
          <em>sec</em>
        </label>
        <label>
          <span>Interval</span>
          <input
            disabled={disabled}
            inputMode="numeric"
            value={numericValue(setup.intervalSeconds)}
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
            value={numericValue(setup.iterations)}
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
            value={numericValue(setup.waitSeconds)}
            onFocus={selectOnFocus}
            onChange={(event) => update({ waitSeconds: cleanNumber(event.target.value, 3) })}
            placeholder="5"
          />
          <em>sec</em>
        </label>
      </div>

      <label>
        <span>DL URL</span>
        <input disabled={disabled} value={setup.downloadUrl || ""} onFocus={selectOnFocus} onChange={(event) => update({ downloadUrl: event.target.value })} />
      </label>
      <label>
        <span>UL URL</span>
        <input disabled={disabled} value={setup.uploadUrl || ""} onFocus={selectOnFocus} onChange={(event) => update({ uploadUrl: event.target.value })} />
      </label>
    </section>
  );
}
