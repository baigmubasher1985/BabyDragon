import React, { useMemo, useState } from "react";

const KPI_ROW_SETS = {
  auto: [
    { group: "Tech", kpi: "Technology / RAT", unit: "", live: "N/A", avg: "N/A", minMax: "N/A", status: "Pending" },
    { group: "Tech", kpi: "Band / Channel", unit: "", live: "N/A", avg: "N/A", minMax: "N/A", status: "Pending" },
    { group: "Tech", kpi: "PCI / PSC / BSIC", unit: "", live: "N/A", avg: "N/A", minMax: "N/A", status: "Pending" },
    { group: "Tech", kpi: "Cell ID", unit: "", live: "N/A", avg: "N/A", minMax: "N/A", status: "Pending" },
    { group: "RF", kpi: "RSRP / RSCP / RSSI", unit: "dBm", live: "N/A", avg: "N/A", minMax: "N/A", status: "Pending" },
    { group: "RF", kpi: "RSRQ / EcNo", unit: "dB", live: "N/A", avg: "N/A", minMax: "N/A", status: "Pending" },
    { group: "RF", kpi: "SINR", unit: "dB", live: "N/A", avg: "N/A", minMax: "N/A", status: "Pending" },
    { group: "Data", kpi: "APP DL THP", unit: "Mbps", live: "N/A", avg: "N/A", minMax: "N/A", status: "Planned" },
    { group: "Data", kpi: "APP UL THP", unit: "Mbps", live: "N/A", avg: "N/A", minMax: "N/A", status: "Planned" },
    { group: "Voice", kpi: "Call State", unit: "", live: "N/A", avg: "N/A", minMax: "N/A", status: "Planned" },
  ],
  nrLte: [
    { group: "Tech", kpi: "Technology", unit: "", live: "5G/4G N/A", avg: "N/A", minMax: "N/A", status: "Pending" },
    { group: "Tech", kpi: "Band / EARFCN / NRARFCN", unit: "", live: "N/A", avg: "N/A", minMax: "N/A", status: "Pending" },
    { group: "Tech", kpi: "PCI / Cell", unit: "", live: "N/A", avg: "N/A", minMax: "N/A", status: "Pending" },
    { group: "RF", kpi: "SS-RSRP / RSRP", unit: "dBm", live: "N/A", avg: "N/A", minMax: "N/A", status: "Pending" },
    { group: "RF", kpi: "SS-RSRQ / RSRQ", unit: "dB", live: "N/A", avg: "N/A", minMax: "N/A", status: "Pending" },
    { group: "RF", kpi: "SS-SINR / SINR", unit: "dB", live: "N/A", avg: "N/A", minMax: "N/A", status: "Pending" },
    { group: "RF", kpi: "RSSI", unit: "dBm", live: "N/A", avg: "N/A", minMax: "N/A", status: "Pending" },
    { group: "Data", kpi: "APP DL THP", unit: "Mbps", live: "N/A", avg: "N/A", minMax: "N/A", status: "Planned" },
    { group: "Data", kpi: "APP UL THP", unit: "Mbps", live: "N/A", avg: "N/A", minMax: "N/A", status: "Planned" },
    { group: "Voice", kpi: "VoLTE / VoNR State", unit: "", live: "N/A", avg: "N/A", minMax: "N/A", status: "Planned" },
  ],
  wcdma: [
    { group: "Tech", kpi: "Technology", unit: "", live: "3G/WCDMA N/A", avg: "N/A", minMax: "N/A", status: "Pending" },
    { group: "Tech", kpi: "UARFCN / PSC", unit: "", live: "N/A", avg: "N/A", minMax: "N/A", status: "Pending" },
    { group: "Tech", kpi: "LAC / Cell ID", unit: "", live: "N/A", avg: "N/A", minMax: "N/A", status: "Pending" },
    { group: "3G RF", kpi: "RSCP", unit: "dBm", live: "N/A", avg: "N/A", minMax: "N/A", status: "Pending" },
    { group: "3G RF", kpi: "Ec/No", unit: "dB", live: "N/A", avg: "N/A", minMax: "N/A", status: "Pending" },
    { group: "3G RF", kpi: "RSSI", unit: "dBm", live: "N/A", avg: "N/A", minMax: "N/A", status: "Pending" },
    { group: "Voice", kpi: "Call State", unit: "", live: "N/A", avg: "N/A", minMax: "N/A", status: "Planned" },
    { group: "Voice", kpi: "Attempts / Drops", unit: "", live: "0 / 0", avg: "N/A", minMax: "N/A", status: "Planned" },
  ],
  gsm: [
    { group: "Tech", kpi: "Technology", unit: "", live: "2G/GSM N/A", avg: "N/A", minMax: "N/A", status: "Pending" },
    { group: "Tech", kpi: "ARFCN / BSIC", unit: "", live: "N/A", avg: "N/A", minMax: "N/A", status: "Pending" },
    { group: "Tech", kpi: "LAC / Cell ID", unit: "", live: "N/A", avg: "N/A", minMax: "N/A", status: "Pending" },
    { group: "2G RF", kpi: "RxLev / RSSI", unit: "dBm", live: "N/A", avg: "N/A", minMax: "N/A", status: "Pending" },
    { group: "2G RF", kpi: "BER", unit: "0-7/99", live: "N/A", avg: "N/A", minMax: "N/A", status: "Pending" },
    { group: "2G RF", kpi: "Timing Advance", unit: "symbols", live: "N/A", avg: "N/A", minMax: "N/A", status: "Pending" },
    { group: "Voice", kpi: "Call State", unit: "", live: "N/A", avg: "N/A", minMax: "N/A", status: "Planned" },
    { group: "Voice", kpi: "Attempts / Drops", unit: "", live: "0 / 0", avg: "N/A", minMax: "N/A", status: "Planned" },
  ],
};

const RAT_OPTIONS = [
  { key: "auto", label: "Auto", hint: "Current RAT" },
  { key: "nrLte", label: "5G/4G", hint: "NR + LTE" },
  { key: "wcdma", label: "3G", hint: "WCDMA" },
  { key: "gsm", label: "2G", hint: "GSM" },
];

const KPI_LEGENDS = [
  {
    name: "NR/LTE RSRP",
    unit: "dBm",
    note: "5G/LTE reference signal power family",
    bands: [
      { label: "Excellent", range: ">= -80", className: "excellent" },
      { label: "Good", range: "-81 to -90", className: "good" },
      { label: "Fair", range: "-91 to -100", className: "fair" },
      { label: "Poor", range: "-101 to -110", className: "poor" },
      { label: "Bad", range: "< -110", className: "bad" },
    ],
  },
  {
    name: "NR/LTE RSRQ",
    unit: "dB",
    note: "5G/LTE reference signal quality family",
    bands: [
      { label: "Excellent", range: ">= -10", className: "excellent" },
      { label: "Good", range: "-11 to -15", className: "good" },
      { label: "Fair", range: "-16 to -20", className: "fair" },
      { label: "Poor", range: "-21 to -25", className: "poor" },
      { label: "Bad", range: "< -25", className: "bad" },
    ],
  },
  {
    name: "NR/LTE SINR",
    unit: "dB",
    note: "Signal to interference plus noise family",
    bands: [
      { label: "Excellent", range: ">= 20", className: "excellent" },
      { label: "Good", range: "13 to 19", className: "good" },
      { label: "Fair", range: "5 to 12", className: "fair" },
      { label: "Poor", range: "0 to 4", className: "poor" },
      { label: "Bad", range: "< 0", className: "bad" },
    ],
  },
  {
    name: "3G RSCP / EcNo",
    unit: "dBm / dB",
    note: "WCDMA signal level and quality families",
    bands: [
      { label: "Excellent", range: "RSCP >= -75", className: "excellent" },
      { label: "Good", range: "-76 to -85", className: "good" },
      { label: "Fair", range: "-86 to -95", className: "fair" },
      { label: "Poor", range: "-96 to -105", className: "poor" },
      { label: "Bad", range: "< -105", className: "bad" },
    ],
  },
  {
    name: "2G RSSI / RxLev",
    unit: "dBm",
    note: "GSM signal strength family",
    bands: [
      { label: "Excellent", range: ">= -65", className: "excellent" },
      { label: "Good", range: "-66 to -75", className: "good" },
      { label: "Fair", range: "-76 to -85", className: "fair" },
      { label: "Poor", range: "-86 to -95", className: "poor" },
      { label: "Bad", range: "< -95", className: "bad" },
    ],
  },
  {
    name: "APP THP",
    unit: "Mbps",
    note: "Application-layer DL/UL throughput thresholds",
    bands: [
      { label: "Excellent", range: "Project target +", className: "excellent" },
      { label: "Good", range: "Meets target", className: "good" },
      { label: "Fair", range: "Watch zone", className: "fair" },
      { label: "Poor", range: "Below target", className: "poor" },
      { label: "Bad", range: "Severe fail", className: "bad" },
    ],
  },
  {
    name: "Voice",
    unit: "Events",
    note: "Call setup, connection, drop, and manual event markers",
    bands: [
      { label: "Pass", range: "Connected, no drop", className: "excellent" },
      { label: "Watch", range: "Setup delay", className: "fair" },
      { label: "Fail", range: "Drop / no setup", className: "bad" },
    ],
  },
];

const DATA_TEST_OPTIONS = [
  { label: "Internal HTTP DL/UL", status: "Next", note: "BabyDragon controlled application throughput test." },
  { label: "iPerf", status: "Planned", note: "Use configured server and record RF/GPS trace." },
  { label: "FTP", status: "Planned", note: "Use configured FTP server and record RF/GPS trace." },
  { label: "Open Ookla", status: "App", note: "Launch app, run test there, keep RF/GPS trace active." },
  { label: "Open FCC", status: "App", note: "Launch app, run test there, keep RF/GPS trace active." },
];

const VOICE_TEST_OPTIONS = [
  { label: "Start Voice Monitor", status: "Next", note: "Track call state with RF/GPS samples." },
  { label: "Dial Test Number", status: "Planned", note: "Open dialer to configured test number." },
  { label: "Mark Connected", status: "Manual", note: "FE marker for answered call." },
  { label: "Mark Drop / Fail", status: "Manual", note: "FE marker for dropped or failed call." },
];

const EXPORT_ITEMS = [
  { title: "Summary CSV", description: "One row per test phase with min, max, average, status, and sample count." },
  { title: "Trace CSV", description: "One row per RF/GPS sample for map, plots, and audit trail." },
  { title: "JSON", description: "Full BabyDragon package with task, route, RF, data, voice, GPS, and thresholds." },
  { title: "PDF Report", description: "Instant report with KPI table, plots, map snapshot, legend, and pass/fail summary." },
];

function formatGps(point) {
  if (!point?.lat || !point?.lng) return "No GPS";
  return `${Number(point.lat).toFixed(5)}, ${Number(point.lng).toFixed(5)}`;
}

function getActiveTask(tasks = []) {
  const list = Array.isArray(tasks) ? tasks : [];
  return list[0] || null;
}

function getTaskLabel(task) {
  if (!task) return "No active task";
  return (
    task.task_name ||
    task.title ||
    task.name ||
    task.grid_name ||
    task.gridName ||
    task.project_name ||
    "Active field task"
  );
}

function getTaskGrid(task) {
  return task?.grid_name || task?.gridName || task?.assigned_grid || task?.grid_id || "Grid pending";
}

function getStatusLabel(testState, selectedMode) {
  if (testState === "recording") return `${selectedMode === "voice" ? "Voice" : "Data"} armed`;
  if (testState === "paused") return "Saved locally";
  return "Ready";
}

export default function MobileRfKpi({
  user,
  activeFieldTasks = [],
  inProcessTasks = [],
  lastGpsLocation,
  gpsStatusMessage,
  gpsChecking,
  onRefreshGpsNow,
}) {
  const [selectedMode, setSelectedMode] = useState("data");
  const [testState, setTestState] = useState("idle");
  const [openPanel, setOpenPanel] = useState("none");
  const [ratView, setRatView] = useState("auto");

  const activeTask = useMemo(
    () => getActiveTask(inProcessTasks.length ? inProcessTasks : activeFieldTasks),
    [activeFieldTasks, inProcessTasks]
  );

  const activeTaskLabel = useMemo(() => getTaskLabel(activeTask), [activeTask]);
  const activeGrid = useMemo(() => getTaskGrid(activeTask), [activeTask]);
  const modeOptions = selectedMode === "voice" ? VOICE_TEST_OPTIONS : DATA_TEST_OPTIONS;
  const tableRows = KPI_ROW_SETS[ratView] || KPI_ROW_SETS.auto;
  const hasRunningTask = inProcessTasks.length > 0;

  function armWorkflow(mode) {
    setSelectedMode(mode);
    setTestState("recording");
  }

  function stopWorkflow() {
    setTestState("paused");
  }

  function togglePanel(panelName) {
    setOpenPanel((current) => (current === panelName ? "none" : panelName));
  }

  return (
    <section className="bd-mobile-rf-view bd-mobile-rf-compact">
      <section className="bd-mobile-card bd-rf-control-card">
        <div className="bd-rf-compact-head">
          <div>
            <p className="bd-mobile-eyebrow">Android Info RF KPI</p>
            <h2>RF Field Cockpit</h2>
            <span>{hasRunningTask ? "Task live" : "Ready"} · {getStatusLabel(testState, selectedMode)}</span>
          </div>
          <button type="button" onClick={() => togglePanel("about")}>Info</button>
        </div>

        {openPanel === "about" && (
          <p className="bd-rf-inline-note">
            The native collector will auto-detect the serving radio technology. 5G/4G, 3G, and 2G use different KPI families, so this table changes by RAT instead of forcing every technology into the same RSRP/RSRQ box.
          </p>
        )}

        <div className="bd-rf-context-strip">
          <span><b>FE</b>{user?.email || "Signed in FE"}</span>
          <span><b>Task</b>{activeTaskLabel}</span>
          <span><b>Grid</b>{activeGrid}</span>
          <span><b>GPS</b>{formatGps(lastGpsLocation)}</span>
        </div>

        <div className="bd-rf-mode-toggle">
          <button
            type="button"
            className={selectedMode === "data" ? "active" : ""}
            onClick={() => setSelectedMode("data")}
          >
            Data Test
          </button>
          <button
            type="button"
            className={selectedMode === "voice" ? "active" : ""}
            onClick={() => setSelectedMode("voice")}
          >
            Voice Test
          </button>
        </div>

        <div className="bd-rf-action-grid">
          <button type="button" className="bd-mobile-primary" onClick={() => armWorkflow(selectedMode)}>
            {selectedMode === "voice" ? "Start Voice" : "Start Data"}
          </button>
          <button type="button" className="bd-mobile-secondary" onClick={stopWorkflow}>Stop / Save</button>
          <button type="button" className="bd-mobile-secondary" onClick={onRefreshGpsNow}>
            {gpsChecking ? "Checking..." : "GPS"}
          </button>
          <button type="button" className="bd-mobile-secondary" disabled>Export</button>
        </div>

        <div className="bd-rf-panel-buttons">
          <button type="button" className={openPanel === "map" ? "active" : ""} onClick={() => togglePanel("map")}>Map</button>
          <button type="button" className={openPanel === "apps" ? "active" : ""} onClick={() => togglePanel("apps")}>Apps</button>
          <button type="button" className={openPanel === "legend" ? "active" : ""} onClick={() => togglePanel("legend")}>Legend</button>
          <button type="button" className={openPanel === "export" ? "active" : ""} onClick={() => togglePanel("export")}>Report</button>
        </div>
      </section>

      {openPanel === "map" && (
        <section className="bd-mobile-card bd-rf-hidden-panel">
          <div className="bd-rf-panel-head">
            <p><b>Route + KPI Map</b><span>Shell now, live layers next</span></p>
            <button type="button" onClick={() => setOpenPanel("none")}>Hide</button>
          </div>
          <div className="bd-mobile-rf-map-shell compact" aria-label="RF KPI route monitor preview">
            <div className="bd-rf-map-grid" />
            <div className="bd-rf-map-route route-a" />
            <div className="bd-rf-map-route route-b" />
            <div className="bd-rf-map-sector sector-a" />
            <div className="bd-rf-map-sector sector-b" />
            <div className="bd-rf-map-dot good" />
            <div className="bd-rf-map-dot fair" />
            <div className="bd-rf-map-dot poor" />
            <div className="bd-rf-map-fe" />
            <span className="bd-rf-map-label">RF sample trail preview</span>
          </div>
          <div className="bd-rf-mini-facts">
            <span><b>Task</b>{activeTaskLabel}</span>
            <span><b>GPS</b>{gpsStatusMessage || "Waiting for GPS"}</span>
          </div>
        </section>
      )}

      <section className="bd-mobile-card bd-rf-table-card-compact">
        <div className="bd-rf-panel-head">
          <p><b>Live KPI Table</b><span>Technology-aware RF, data, voice</span></p>
          <em>Collector pending</em>
        </div>

        <div className="bd-rf-rat-toggle" role="group" aria-label="Select KPI technology view">
          {RAT_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={ratView === option.key ? "active" : ""}
              onClick={() => setRatView(option.key)}
            >
              <b>{option.label}</b>
              <span>{option.hint}</span>
            </button>
          ))}
        </div>

        <p className="bd-rf-tech-note">
          Auto will follow the phone's current serving technology. 3G shows RSCP/EcNo; 2G shows RxLev/RSSI, BER, and timing advance when Android exposes them.
        </p>

        <div className="bd-mobile-rf-kpi-table-wrap compact">
          <table className="bd-mobile-rf-kpi-table compact">
            <thead>
              <tr>
                <th>KPI</th>
                <th>Live</th>
                <th>Avg</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => (
                <tr key={`${ratView}-${row.group}-${row.kpi}`}>
                  <td>
                    <span className={`bd-rf-group-pill ${row.group.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{row.group}</span>
                    <strong>{row.kpi}</strong>
                    {row.unit ? <small>{row.unit}</small> : null}
                  </td>
                  <td>{row.live}</td>
                  <td>{row.avg}</td>
                  <td><span className={`bd-rf-status ${row.status.toLowerCase()}`}>{row.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {openPanel === "apps" && (
        <section className="bd-mobile-card bd-rf-hidden-panel">
          <div className="bd-rf-panel-head">
            <p><b>{selectedMode === "voice" ? "Voice Actions" : "Data Apps / Tests"}</b><span>{selectedMode === "voice" ? "No-root workflow" : "Internal + external apps"}</span></p>
            <button type="button" onClick={() => setOpenPanel("none")}>Hide</button>
          </div>
          <div className="bd-mobile-rf-test-options compact">
            {modeOptions.map((item) => (
              <button type="button" key={item.label} className="bd-mobile-rf-test-option" disabled>
                <span>{item.status}</span>
                <strong>{item.label}</strong>
                <small>{item.note}</small>
              </button>
            ))}
          </div>
        </section>
      )}

      {openPanel === "legend" && (
        <section className="bd-mobile-card bd-rf-hidden-panel">
          <div className="bd-rf-panel-head">
            <p><b>Legend / Thresholds</b><span>Configurable report colors</span></p>
            <button type="button" onClick={() => setOpenPanel("none")}>Hide</button>
          </div>
          <p className="bd-rf-inline-note">
            3GPP measurement families stay standard. BabyDragon report colors use configurable RF engineering thresholds by RAT: NR/LTE, WCDMA, GSM, data, and voice.
          </p>
          <div className="bd-mobile-rf-legend-list compact">
            {KPI_LEGENDS.map((legend) => (
              <article className="bd-mobile-rf-legend-card compact" key={legend.name}>
                <header>
                  <div>
                    <strong>{legend.name}</strong>
                    <small>{legend.note}</small>
                  </div>
                  <em>{legend.unit}</em>
                </header>
                <div className="bd-mobile-rf-bands compact">
                  {legend.bands.map((band) => (
                    <span className={`bd-rf-band ${band.className}`} key={`${legend.name}-${band.label}`}>
                      <b>{band.label}</b>
                      <small>{band.range}</small>
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {openPanel === "export" && (
        <section className="bd-mobile-card bd-rf-hidden-panel">
          <div className="bd-rf-panel-head">
            <p><b>Instant Report Package</b><span>After each saved test</span></p>
            <button type="button" onClick={() => setOpenPanel("none")}>Hide</button>
          </div>
          <div className="bd-mobile-rf-export-grid compact">
            {EXPORT_ITEMS.map((item) => (
              <div key={item.title}>
                <strong>{item.title}</strong>
                <p>{item.description}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
