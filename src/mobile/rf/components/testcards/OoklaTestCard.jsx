import React from "react";
import { DEFAULT_OOKLA_SETUP } from "../../config/dataTestConfig";

export default function OoklaTestCard({ setup = DEFAULT_OOKLA_SETUP, onChange, disabled = false }) {
  const update = (patch) => onChange?.({ ...setup, ...patch });
  return (
    <section className="bd-rf-test-card bd-rf-test-card-planned">
      <header><div><b>OOKLA App</b><span>Open app, upload screenshot, OCR assists, FE confirms.</span></div><em>OCR-ready</em></header>
      <label><span>Server ID / name</span><input disabled={disabled} value={setup.server || ""} onChange={(event) => update({ server: event.target.value })} /></label>
      <label className="bd-rf-check-row"><input disabled={disabled} type="checkbox" checked={setup.ocrAssist !== false} onChange={(event) => update({ ocrAssist: event.target.checked })} /><span>Use OCR assist, but require FE confirmation</span></label>
      <p>Final report values must come from screenshot-backed, FE-confirmed DL/UL/Ping/Jitter/Server fields.</p>
    </section>
  );
}
