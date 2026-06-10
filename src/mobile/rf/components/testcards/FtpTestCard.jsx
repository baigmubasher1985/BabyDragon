import React from "react";

export default function FtpTestCard({ setup = {}, onChange, disabled = false }) {
  const update = (patch) => onChange?.({ ...setup, ...patch });
  return (
    <section className="bd-rf-test-card bd-rf-test-card-planned">
      <header><div><b>FTP Test</b><span>Planned isolated coding page for FTP DL/UL.</span></div><em>Planned</em></header>
      <label><span>Server</span><input disabled={disabled} value={setup.server || ""} onChange={(event) => update({ server: event.target.value })} /></label>
      <div className="bd-rf-test-card-grid">
        <label><span>Port</span><input disabled={disabled} inputMode="numeric" value={setup.port || "21"} onChange={(event) => update({ port: event.target.value })} /></label>
        <label><span>Direction</span><input disabled={disabled} value={setup.direction || "DL + UL"} onChange={(event) => update({ direction: event.target.value })} /></label>
      </div>
      <label><span>Remote path</span><input disabled={disabled} value={setup.remotePath || ""} onChange={(event) => update({ remotePath: event.target.value })} /></label>
    </section>
  );
}
