import React from "react";

export default function IperfTestCard({ setup = {}, onChange, disabled = false }) {
  const update = (patch) => onChange?.({ ...setup, ...patch });
  return (
    <section className="bd-rf-test-card bd-rf-test-card-planned">
      <header><div><b>iPerf Test</b><span>Planned isolated coding page for TCP/UDP iPerf.</span></div><em>Planned</em></header>
      <label><span>Server host/IP</span><input disabled={disabled} value={setup.server || ""} onChange={(event) => update({ server: event.target.value })} /></label>
      <div className="bd-rf-test-card-grid">
        <label><span>Port</span><input disabled={disabled} inputMode="numeric" value={setup.port || "5201"} onChange={(event) => update({ port: event.target.value })} /></label>
        <label><span>Protocol</span><input disabled={disabled} value={setup.protocol || "TCP"} onChange={(event) => update({ protocol: event.target.value })} /></label>
        <label><span>Streams</span><input disabled={disabled} inputMode="numeric" value={setup.streams || "1"} onChange={(event) => update({ streams: event.target.value })} /></label>
        <label><span>Duration</span><input disabled={disabled} inputMode="numeric" value={setup.durationSeconds || "10"} onChange={(event) => update({ durationSeconds: event.target.value })} /></label>
      </div>
    </section>
  );
}
