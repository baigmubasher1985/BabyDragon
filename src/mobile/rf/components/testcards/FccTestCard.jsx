import React from "react";
import { DEFAULT_FCC_IMPORT_SETUP } from "../../config/dataTestConfig";

export default function FccTestCard({ setup = DEFAULT_FCC_IMPORT_SETUP, onChange, disabled = false }) {
  const update = (patch) => onChange?.({ ...setup, ...patch });
  return (
    <section className="bd-rf-test-card bd-rf-test-card-planned">
      <header><div><b>FCC App Import</b><span>Import FCC export and truncate using BabyDragon session timestamps.</span></div><em>Planned</em></header>
      <label><span>Timestamp buffer</span><input disabled={disabled} inputMode="numeric" value={setup.timestampBufferSeconds ?? 30} onChange={(event) => update({ timestampBufferSeconds: event.target.value })} /><em>sec</em></label>
      <label className="bd-rf-check-row"><input disabled={disabled} type="checkbox" checked={setup.keepRawImport !== false} onChange={(event) => update({ keepRawImport: event.target.checked })} /><span>Keep raw imported FCC output</span></label>
      <label className="bd-rf-check-row"><input disabled={disabled} type="checkbox" checked={setup.saveTruncatedByGrid !== false} onChange={(event) => update({ saveTruncatedByGrid: event.target.checked })} /><span>Save truncated output with grid/session name</span></label>
    </section>
  );
}
