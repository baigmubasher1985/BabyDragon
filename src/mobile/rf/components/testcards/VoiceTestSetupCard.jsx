import React from "react";

export default function VoiceTestSetupCard({ setup = {}, onChange, disabled = false }) {
  const update = (patch) => onChange?.({ ...setup, ...patch });
  return (
    <section className="bd-rf-test-card bd-rf-test-card-planned">
      <header><div><b>Voice KPI Test</b><span>Android call state plus FE event markers for honest voice KPIs.</span></div><em>Planned</em></header>
      <label><span>Dial number / label</span><input disabled={disabled} value={setup.dialTarget || ""} onChange={(event) => update({ dialTarget: event.target.value })} /></label>
      <div className="bd-rf-test-card-grid">
        <label><span>Attempts</span><input disabled={disabled} inputMode="numeric" value={setup.attempts || "1"} onChange={(event) => update({ attempts: event.target.value })} /></label>
        <label><span>Call duration</span><input disabled={disabled} inputMode="numeric" value={setup.durationSeconds || "60"} onChange={(event) => update({ durationSeconds: event.target.value })} /><em>sec</em></label>
      </div>
      <p>CSSR/CDR/CBR will be computed only after attempt/connected/drop/fail events exist.</p>
    </section>
  );
}
