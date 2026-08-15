/**
 * F10A — Unified Field Test Report workbook writer (ExcelJS).
 * Presentation-only; values come from createUnifiedFieldReportModel.
 */

import { UNIFIED_FIELD_REPORT_VERSION } from "./unifiedFieldReportModel.js";
import {
  renderRouteKpiMapPng,
  prepareSharedBasemap,
  computeProjectedRouteAspect,
  canvasSizeForOrientation,
} from "./excelMapPlotRenderer.js";
import { renderEventTimeSeriesPng } from "./excelEventPlotRenderer.js";
import { buildMapPlotSpecs } from "./excelPlotReportExport.js";

const BRAND = {
  navy: "FF0B3D5C",
  accent: "FF1B6CA8",
  headerFill: "FF0B3D5C",
  headerFont: "FFFFFFFF",
  sectionFill: "FFE8F1F8",
  altRow: "FFF8FAFC",
  border: "FFCBD5E1",
  muted: "FF475569",
};

export const UNIFIED_SHEET_NAMES = Object.freeze({
  cover: "01_Field_Test_Summary",
  index: "02_Index",
  scenarioSummary: "03_Scenario_Summary",
  rfKpi: "04_RF_KPI_Summary",
  dataKpi: "05_Data_KPI_Summary",
  iterations: "06_Test_Iterations",
  rfRaw: "07_RF_Raw_Data",
  dataThroughput: "08_Data_Throughput",
  dataEvents: "09_Data_Events",
  external: "10_External_Evidence",
  // Shared plot sheets 11–14 retired: plots are per-scenario (Sxx_*_RF_Maps / Data_Maps / Events).
  qa: "15_QA_Truth_Audit",
  readMe: "16_ReadMe",
});

function engineSheetToken(scenarioKey = "") {
  const key = String(scenarioKey || "").toLowerCase();
  if (key.includes("ookla")) return "OOKLA";
  if (key.includes("fcc")) return "FCC";
  if (key.includes("iperf")) return "iPerf3";
  if (key === "ftp") return "FTP";
  if (key === "native_http") return "HTTP";
  if (key === "rf_only") return "RF";
  return "Data";
}

function excelSafeSheetName(...parts) {
  const raw = parts.filter(Boolean).join("_").replace(/[\\/*?:\[\]]/g, "_").replace(/_+/g, "_");
  return raw.slice(0, 31) || "Plot";
}

function cellValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "object") {
    if (value.text != null && value.hyperlink != null) return value;
    return null;
  }
  const text = String(value).trim();
  if (!text || text === "NaN" || text === "undefined" || text === "[object Object]") return null;
  return text;
}

function setCell(sheet, row, col, value) {
  const v = cellValue(value);
  sheet.getCell(row, col).value = v === undefined ? null : v;
}

function styleHeader(sheet, rowNum, colCount) {
  const row = sheet.getRow(rowNum);
  for (let c = 1; c <= colCount; c += 1) {
    const cell = row.getCell(c);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.headerFill } };
    cell.font = { bold: true, color: { argb: BRAND.headerFont }, size: 10 };
    cell.border = {
      top: { style: "thin", color: { argb: BRAND.border } },
      bottom: { style: "thin", color: { argb: BRAND.border } },
    };
  }
}

function writeTable(sheet, startRow, headers, rows) {
  headers.forEach((h, i) => setCell(sheet, startRow, i + 1, h));
  styleHeader(sheet, startRow, headers.length);
  rows.forEach((row, rIdx) => {
    row.forEach((value, cIdx) => setCell(sheet, startRow + 1 + rIdx, cIdx + 1, value));
    if (rIdx % 2 === 1) {
      for (let c = 1; c <= headers.length; c += 1) {
        sheet.getCell(startRow + 1 + rIdx, c).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: BRAND.altRow },
        };
      }
    }
  });
  sheet.autoFilter = rows.length
    ? {
      from: { row: startRow, column: 1 },
      to: { row: startRow + rows.length, column: headers.length },
    }
    : undefined;
  // F10B: customer unified workbook must not freeze panes.
  sheet.views = [];
  return startRow + 1 + rows.length;
}

function formatTs(value) {
  const n = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(n)) return value == null ? null : String(value);
  return new Date(n).toISOString();
}

function dashOrNumber(value) {
  if (value === null || value === undefined) return "—";
  return value;
}

async function loadExcelJS() {
  const mod = await import("exceljs");
  return mod?.default || mod;
}

function buildCover(sheet, model) {
  sheet.getColumn(1).width = 28;
  sheet.getColumn(2).width = 48;
  setCell(sheet, 1, 1, "BabyDragon Unified Field Test Report");
  sheet.getCell(1, 1).font = { bold: true, size: 16, color: { argb: BRAND.navy } };
  setCell(sheet, 2, 1, "MobbiTech Global LLC");
  const rows = [
    ["Project", model.fieldContext.project],
    ["Task", model.fieldContext.task],
    ["Grid", model.fieldContext.grid],
    ["Report Name", model.reportIdentity.reportName],
    ["Device", model.deviceContext.device],
    ["FE", model.deviceContext.feEmail],
    ["Start", formatTs(model.fieldContext.startedAt)],
    ["End", formatTs(model.fieldContext.endedAt)],
    ["Duration (ms)", model.fieldContext.durationMs],
    ["GPS Evidence", model.routeSummary.gpsEvidence],
    ["GPS Samples", model.routeSummary.gpsSampleCount ?? model.routeSummary.gpsPointCount],
    ["Route Quality", model.routeSummary.routeQuality],
    ["Driven Distance (m)", model.routeSummary.drivenDistanceM],
    ["Technologies Observed", (model.fieldContext.technologiesObserved || []).join(", ") || null],
    ["Scenarios", model.fieldContext.scenarioCount],
    ["Evidence Collection Status", model.fieldContext.evidenceCollectionStatus || model.fieldContext.overallStatus],
    ["Unified Report Version", model.reportIdentity.version],
  ];
  rows.forEach((pair, idx) => {
    setCell(sheet, 4 + idx, 1, pair[0]);
    setCell(sheet, 4 + idx, 2, pair[1]);
    sheet.getCell(4 + idx, 1).font = { bold: true };
  });
  const overviewStart = 4 + rows.length + 2;
  setCell(sheet, overviewStart, 1, "Scenario Overview");
  sheet.getCell(overviewStart, 1).font = { bold: true, size: 12, color: { argb: BRAND.navy } };
  writeTable(
    sheet,
    overviewStart + 1,
    ["Scenario", "Mode", "Direction", "Attempts", "Complete", "Failed", "Result"],
    model.scenarioSummary.map((s) => [
      `${s.scenarioId} ${s.scenarioType}`,
      s.mode,
      s.direction,
      dashOrNumber(s.attempted),
      dashOrNumber(s.completed),
      dashOrNumber(s.failed),
      s.status,
    ]),
  );
}

function buildIndex(sheet, createdSheets) {
  sheet.getColumn(1).width = 8;
  sheet.getColumn(2).width = 36;
  sheet.getColumn(3).width = 48;
  setCell(sheet, 1, 1, "#");
  setCell(sheet, 1, 2, "Sheet");
  setCell(sheet, 1, 3, "Purpose");
  styleHeader(sheet, 1, 3);
  createdSheets.forEach((item, idx) => {
    setCell(sheet, 2 + idx, 1, idx + 1);
    sheet.getCell(2 + idx, 2).value = {
      text: item.name,
      hyperlink: `#'${item.name}'!A1`,
    };
    sheet.getCell(2 + idx, 2).font = { color: { argb: "FF0563C1" }, underline: true };
    setCell(sheet, 2 + idx, 3, item.purpose);
  });
}

function buildScenarioSummarySheet(sheet, model) {
  writeTable(
    sheet,
    1,
    [
      "Scenario ID", "Scenario Type", "Engine", "Mode", "Direction", "Start", "End", "Duration ms",
      "Requested", "Attempted", "Completed", "Failed", "Remaining",
      "Avg DL", "Avg UL", "Latency/Ping", "DL Bytes", "UL Bytes", "Transport", "Status", "Failure Summary", "Source",
    ],
    model.scenarioSummary.map((s) => [
      s.scenarioId, s.scenarioType, s.engine, s.mode, s.direction,
      formatTs(s.start), formatTs(s.end), s.durationMs,
      dashOrNumber(s.requested), dashOrNumber(s.attempted), dashOrNumber(s.completed),
      dashOrNumber(s.failed), dashOrNumber(s.remaining),
      s.avgDlMbps, s.avgUlMbps, s.latencyMs, s.dlBytes, s.ulBytes,
      s.transport || "Not recorded",
      s.status, s.failureSummary, s.source,
    ]),
  );
  [12, 18, 14, 12, 12, 24, 24, 12, 10, 10, 10, 10, 10, 10, 10, 12, 12, 12, 16, 16, 28, 28].forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
}

function buildRfKpiSheet(sheet, model) {
  setCell(sheet, 1, 1, "LTE");
  sheet.getCell(1, 1).font = { bold: true, size: 12 };
  let row = writeTable(
    sheet,
    2,
    ["KPI", "Unit", "Avg", "Min", "Max", "Count"],
    (model.rfSummary.lte || []).map((k) => [k.kpi, k.unit, k.average, k.minimum, k.maximum, k.count]),
  );
  row += 2;
  setCell(sheet, row, 1, "NR");
  sheet.getCell(row, 1).font = { bold: true, size: 12 };
  row = writeTable(
    sheet,
    row + 1,
    ["KPI", "Unit", "Avg", "Min", "Max", "Count"],
    (model.rfSummary.nr || []).map((k) => [k.kpi, k.unit, k.average, k.minimum, k.maximum, k.count]),
  );
  row += 2;
  setCell(sheet, row, 1, "Identifiers (not averaged)");
  setCell(sheet, row + 1, 1, "Technologies");
  setCell(sheet, row + 1, 2, (model.rfSummary.identifiers?.technologies || []).join(", "));
  setCell(sheet, row + 2, 1, "LTE PCI values");
  setCell(sheet, row + 2, 2, (model.rfSummary.identifiers?.lte_pci_values || []).join(", "));
  setCell(sheet, row + 3, 1, "NR PCI values");
  setCell(sheet, row + 3, 2, (model.rfSummary.identifiers?.nr_pci_values || []).join(", "));
  setCell(sheet, row + 5, 1, "GPS / Route");
  setCell(sheet, row + 6, 1, "GPS Evidence");
  setCell(sheet, row + 6, 2, model.routeSummary.gpsEvidence);
  setCell(sheet, row + 7, 1, "GPS Samples");
  setCell(sheet, row + 7, 2, model.routeSummary.gpsSampleCount ?? model.routeSummary.gpsPointCount);
  setCell(sheet, row + 8, 1, "Route Quality");
  setCell(sheet, row + 8, 2, model.routeSummary.routeQuality);
  setCell(sheet, row + 9, 1, "F9 route status");
  setCell(sheet, row + 9, 2, model.routeSummary.status);
  setCell(sheet, row + 10, 1, "Driven distance (m)");
  setCell(sheet, row + 10, 2, model.routeSummary.drivenDistanceM);
}

function buildDataKpiSheet(sheet, model) {
  const ds = model.dataSummary || {};
  let row = 1;
  const sections = [
    ["A. Native HTTP (APP throughput)", ds.native_http],
    ["B. FTP (APP throughput)", ds.ftp],
    ["C. iPerf3 (APP throughput)", ds.iperf3],
    ["D. OOKLA (External Evidence)", ds.ookla_app],
    ["E. FCC (External Evidence)", ds.fcc_app],
  ];
  for (const [title, rows] of sections) {
    setCell(sheet, row, 1, title);
    sheet.getCell(row, 1).font = { bold: true, size: 12, color: { argb: BRAND.navy } };
    row += 1;
    if (!rows?.length) {
      setCell(sheet, row, 1, "No scenarios in this family");
      row += 2;
      continue;
    }
    row = writeTable(
      sheet,
      row,
      ["Scenario ID", "Mode", "Direction", "Attempted", "Completed", "Failed", "Avg DL", "Avg UL", "DL Bytes", "UL Bytes", "Status", "Provenance"],
      rows.map((r) => [
        r.scenarioId, r.mode, r.direction,
        dashOrNumber(r.attempted), dashOrNumber(r.completed), dashOrNumber(r.failed),
        r.avgDlMbps, r.avgUlMbps, r.dlBytes, r.ulBytes, r.status, r.provenance,
      ]),
    ) + 2;
  }
  setCell(sheet, row, 1, "F. TrafficStats (device-network context only)");
  sheet.getCell(row, 1).font = { bold: true, size: 12 };
  setCell(sheet, row + 1, 1, "Meaningful floor (Mbps)");
  setCell(sheet, row + 1, 2, ds.traffic_stats?.meaningfulFloorMbps ?? 0.01);
  setCell(sheet, row + 2, 1, "Mobile meaningful");
  setCell(sheet, row + 2, 2, ds.traffic_stats?.mobileMeaningful ? "yes" : "no");
  setCell(sheet, row + 3, 1, "Total meaningful");
  setCell(sheet, row + 3, 2, ds.traffic_stats?.totalMeaningful ? "yes" : "no");
  setCell(sheet, row + 5, 1, "Note");
  setCell(sheet, row + 5, 2, "Engine APP throughput is never averaged across HTTP/FTP/iPerf/OOKLA/FCC. TrafficStats is context only.");
}

function buildIterationsSheet(sheet, model) {
  writeTable(
    sheet,
    1,
    [
      "Scenario ID", "Engine", "Direction", "Iteration", "Start", "End", "Duration",
      "Status", "DL Mbps", "UL Mbps", "DL Bytes", "UL Bytes", "Failure Code", "Failure Stage", "Failure Reason",
    ],
    (model.iterations || []).map((r) => [
      r.scenarioId, r.engine, r.direction, r.iteration,
      formatTs(r.startedAt), formatTs(r.endedAt), r.durationSec,
      r.status, r.dlMbps, r.ulMbps, r.dlBytes, r.ulBytes,
      r.failureCode, r.failureStage, r.failureReason,
    ]),
  );
}

function buildRfRawSheet(sheet, model) {
  writeTable(
    sheet,
    1,
    [
      "Scenario IDs", "sample_index", "sample_id", "timestamp_ms", "rat",
      "gps_lat", "gps_lon", "gps_status",
      "lte_rsrp_dbm", "lte_rsrq_db", "lte_sinr_db", "lte_pci",
      "nr_ss_rsrp_dbm", "nr_ss_rsrq_db", "nr_ss_sinr_db", "nr_pci",
      "traffic_stats_dl_mbps", "traffic_stats_ul_mbps",
      "traffic_stats_total_dl_mbps", "traffic_stats_total_ul_mbps",
    ],
    (model.rfRawData || []).map((r, idx) => [
      (r.scenario_ids || []).join(","),
      r.sample_index ?? idx + 1,
      r.sample_id,
      r.timestamp_ms,
      r.rat,
      r.gps_lat, r.gps_lon, r.gps_status,
      r.lte_rsrp_dbm, r.lte_rsrq_db, r.lte_sinr_db, r.lte_pci,
      r.nr_ss_rsrp_dbm, r.nr_ss_rsrq_db, r.nr_ss_sinr_db, r.nr_pci,
      r.traffic_stats_dl_mbps, r.traffic_stats_ul_mbps,
      r.traffic_stats_total_dl_mbps, r.traffic_stats_total_ul_mbps,
    ]),
  );
}

function buildDataThroughputSheet(sheet, model) {
  setCell(sheet, 1, 1, "Unified data engineering view — provenance separated by engine");
  let row = 3;
  const groups = [
    ["Native HTTP", (model.iterations || []).filter((r) => r.engineKey === "native_http")],
    ["FTP", (model.iterations || []).filter((r) => r.engineKey === "ftp")],
    ["iPerf3", (model.iterations || []).filter((r) => r.engineKey === "iperf3")],
  ];
  for (const [title, rows] of groups) {
    setCell(sheet, row, 1, title);
    sheet.getCell(row, 1).font = { bold: true };
    row += 1;
    row = writeTable(
      sheet,
      row,
      ["Scenario ID", "Iteration", "Status", "DL Mbps", "UL Mbps", "DL Bytes", "UL Bytes", "Provenance"],
      rows.map((r) => [r.scenarioId, r.iteration, r.status, r.dlMbps, r.ulMbps, r.dlBytes, r.ulBytes, r.provenance]),
    ) + 2;
  }
  setCell(sheet, row, 1, "TrafficStats context");
  setCell(sheet, row + 1, 1, "See 05_Data_KPI_Summary section F. Not merged into APP averages.");
}

function buildDataEventsSheet(sheet, model) {
  writeTable(
    sheet,
    1,
    ["Scenario IDs", "Timestamp", "Event Type", "Engine", "Iteration", "Status", "Failure Code", "Failure Reason", "GPS Match"],
    (model.events || []).map((e) => [
      (e.scenario_ids || [e.scenarioId]).filter(Boolean).join(","),
      formatTs(e.timestamp_ms ?? e.timestamp),
      e.event_type || e.type || e.eventType,
      e.engine || e.source || null,
      e.iteration ?? e.related_iteration ?? null,
      e.resultStatus || e.status || null,
      e.errorCode || e.error_code || null,
      e.conciseReason || e.message || e.failureReason || null,
      e.mapGps ? "yes" : (e.gps_lat != null ? "yes" : null),
    ]),
  );
}

function buildExternalSheet(sheet, model) {
  writeTable(
    sheet,
    1,
    ["Scenario ID", "Source", "Timestamp", "DL Mbps", "UL Mbps", "Ping/Latency", "Latitude", "Longitude", "Match Quality", "Provenance"],
    (model.externalEvidence || []).map((r) => [
      r.scenarioId, r.source, formatTs(r.timestamp),
      r.dlMbps, r.ulMbps, r.pingMs, r.latitude, r.longitude, r.matchQuality, r.provenance,
    ]),
  );
}

function buildQaSheet(sheet, model) {
  const qa = model.qaAudit || {};
  const pairs = [
    ["Unified Report Version", qa.unifiedReportVersion],
    ["F9 Source Report Version(s)", (qa.f9SourceReportVersions || []).join(", ")],
    ["Source scenarios", qa.sourceScenarioCount],
    ["Scenario IDs", (qa.scenarioIds || []).join(", ")],
    ["Source packages", (qa.sourcePackages || []).join(" | ") || null],
    ["RF rows before dedupe", qa.rfRowsBeforeDedupe],
    ["RF rows after dedupe", qa.rfRowsAfterDedupe],
    ["RF duplicates removed", qa.rfDuplicatesRemoved],
    ["RF dedupe key", qa.rfDedupeKey],
    ["Event rows before dedupe", qa.eventRowsBeforeDedupe],
    ["Event rows after dedupe", qa.eventRowsAfterDedupe],
    ["Event duplicates removed", qa.eventDuplicatesRemoved],
    ["Event dedupe key", qa.eventDedupeKey],
    ["HTTP iterations", qa.iterationCountsByEngine?.native_http],
    ["FTP iterations", qa.iterationCountsByEngine?.ftp],
    ["iPerf iterations", qa.iterationCountsByEngine?.iperf3],
    ["OOKLA evidence", qa.externalEvidenceCounts?.ookla],
    ["FCC evidence", qa.externalEvidenceCounts?.fcc],
    ["GPS route-quality status (F9)", qa.gpsRouteQualityStatus],
    ["GPS Evidence", qa.gpsEvidence],
    ["GPS Samples", qa.gpsSampleCount],
    ["Route Quality", qa.routeQuality],
    ["Warnings", (qa.warnings || []).join(" | ") || null],
  ];
  pairs.forEach((pair, idx) => {
    setCell(sheet, 1 + idx, 1, pair[0]);
    setCell(sheet, 1 + idx, 2, pair[1]);
    sheet.getCell(1 + idx, 1).font = { bold: true };
  });
  const start = pairs.length + 3;
  setCell(sheet, start, 1, "Scenario reconcile");
  writeTable(
    sheet,
    start + 1,
    ["Scenario ID", "Attempted", "Completed", "Failed", "Requested", "Status"],
    (qa.scenarioReconcile || []).map((r) => [
      r.scenarioId, dashOrNumber(r.attempted), dashOrNumber(r.completed),
      dashOrNumber(r.failed), dashOrNumber(r.requested), r.status,
    ]),
  );
  sheet.getColumn(1).width = 32;
  sheet.getColumn(2).width = 60;
}

function buildReadMe(sheet, model) {
  const lines = [
    ["BabyDragon Unified Field Test Report", ""],
    ["Purpose", "Consolidate multiple validated F9 scenario packages from one field activity into a single professional workbook."],
    ["Source provenance", "Each scenario retains engine identity. Native HTTP, FTP, iPerf3, OOKLA, FCC, TrafficStats and RF are never blended into one average."],
    ["APP vs TrafficStats", "APP throughput is BabyDragon engine result. TrafficStats is Android device-network context only."],
    ["External evidence", "OOKLA and FCC are external evidence, not BabyDragon APP throughput."],
    ["RF deduplication", model.qaAudit?.rfDedupeKey || ""],
    ["Event deduplication", model.qaAudit?.eventDedupeKey || ""],
    ["Continuous semantics", "Requested and Remaining are blank/— for Continuous mode."],
    ["Missing values", "Unavailable values are true blank cells or — in overview tables. Empty strings are never written."],
    ["Maps", "Detailed RF/Data/Event plots are generated per selected scenario using the F9 map renderer. Shared 11/12/13 merged plot sheets are not used. Summary tables remain unified."],
    ["GPS Evidence vs Route Quality", "GPS Evidence = Recorded when unique GPS samples exist. Route Quality uses F9 filtered-route classification (Good / Degraded / Stationary / Insufficient / Unavailable). Driven Distance uses the unchanged F9 filtered-segment algorithm and is never inferred from stale-only jitter."],
    ["Evidence Collection Status", "Describes collection/evidence completeness across selected scenarios only (Complete / Partial / Contains Failures). It is not a KPI PASS/FAIL acceptance result. Configurable KPI thresholds belong after F10C session-manifest architecture."],
    ["Connectivity", "Transport is recorded only when the package stored connectivity snapshots. Legacy packages show Not recorded. Never inferred from TrafficStats, SIM presence, or current device state."],
    ["Sheet numbering", "Summary sheets keep 01–10 (conditional). Detailed plot sheets use Sxx_<Engine>_RF_Maps / Data_Maps / Events names (≤31 chars). 15_QA_Truth_Audit and 16_ReadMe remain last. Freeze panes are disabled in the unified workbook."],
    ["Package discovery (F10B)", "Saved report packages are discovered from BabyDragon Reports storage, grouped/reviewed by task/grid. The user explicitly selects scenarios before generation. Unrelated task/grid packages must not silently merge. Legacy packages may show Connectivity = Not recorded."],
    ["Limitations", "Unified generation requires explicit scenario selection after Review & Generate. Packages outside the current task/grid are excluded unless the user deliberately expands selection."],
    ["Version", model.reportIdentity?.version || UNIFIED_FIELD_REPORT_VERSION],
    ["F9 source version", model.reportIdentity?.f9SourceReportVersion || ""],
  ];
  lines.forEach((pair, idx) => {
    setCell(sheet, 1 + idx, 1, pair[0]);
    setCell(sheet, 1 + idx, 2, pair[1]);
    sheet.getCell(1 + idx, 1).font = { bold: true };
  });
  sheet.getColumn(1).width = 28;
  sheet.getColumn(2).width = 100;
}

function rfRowsToPlotPoints(rfRows = []) {
  // Field names must match F9 buildRawRows / buildMapPlotSpecs (lte_rsrp, not lte_rsrp_dbm).
  const withGps = rfRows.filter((r) => r.gps_lat != null && r.gps_lon != null);
  const origin = withGps.length ? (Number(withGps[0].timestamp_ms) || 0) : 0;
  return withGps.map((r, index) => {
    const ts = Number(r.timestamp_ms) || 0;
    return {
      sample_index: r.sample_index || index + 1,
      timestamp_ms: r.timestamp_ms,
      elapsed_sec: origin ? (ts - origin) / 1000 : index,
      gps_lat: r.gps_lat,
      gps_lon: r.gps_lon,
      gps_status: r.gps_status || null,
      gps_accuracy_m: r.gps_accuracy_m,
      gps_fix_age_ms: 0,
      lte_rsrp: r.lte_rsrp_dbm,
      lte_rsrq: r.lte_rsrq_db,
      lte_sinr: r.lte_sinr_db,
      lte_pci: r.lte_pci,
      nr_ss_rsrp: r.nr_ss_rsrp_dbm,
      nr_ss_rsrq: r.nr_ss_rsrq_db,
      nr_ss_sinr: r.nr_ss_sinr_db,
      nr_pci: r.nr_pci,
      rat: r.rat,
      technology_label: r.rat,
      traffic_stats_dl_mbps: r.traffic_stats_dl_mbps,
      traffic_stats_ul_mbps: r.traffic_stats_ul_mbps,
      traffic_stats_total_dl_mbps: r.traffic_stats_total_dl_mbps,
      traffic_stats_total_ul_mbps: r.traffic_stats_total_ul_mbps,
    };
  });
}

function sessionSamplesToPlotRows(session = {}) {
  const samples = Array.isArray(session.exportSamples)
    ? session.exportSamples
    : (Array.isArray(session.traceSamples) ? session.traceSamples : []);
  const origin = samples.length
    ? (Number(samples[0].timestamp) || Number(session.startedAt) || 0)
    : 0;
  return samples.map((sample, index) => {
    const snap = sample.snapshot || sample.rf || {};
    const gps = sample.gps || {};
    const tsStats = sample.trafficStats || {};
    const ts = Number(sample.timestamp) || 0;
    const lat = gps.lat ?? gps.latitude;
    const lon = gps.lon ?? gps.lng ?? gps.longitude;
    return {
      sample_index: index + 1,
      timestamp_ms: ts || null,
      elapsed_sec: origin ? (ts - origin) / 1000 : index,
      gps_lat: lat,
      gps_lon: lon,
      gps_status: gps.gps_status || gps.status || null,
      gps_accuracy_m: gps.accuracy,
      gps_fix_age_ms: gps.fixAgeMs || 0,
      lte_rsrp: snap.lteRsrp ?? snap.lte_rsrp_dbm,
      lte_rsrq: snap.lteRsrq ?? snap.lte_rsrq_db,
      lte_sinr: snap.lteSinr ?? snap.lte_sinr_db,
      lte_pci: snap.ltePci ?? snap.lte_pci,
      nr_ss_rsrp: snap.nrSsRsrp ?? snap.nr_ss_rsrp_dbm,
      nr_ss_rsrq: snap.nrSsRsrq ?? snap.nr_ss_rsrq_db,
      nr_ss_sinr: snap.nrSsSinr ?? snap.nr_ss_sinr_db,
      nr_pci: snap.nrPci ?? snap.nr_pci,
      rat: snap.currentRatName || snap.rat || sample.rat,
      technology_label: snap.currentRatName || snap.rat || sample.rat,
      traffic_stats_dl_mbps: tsStats.dlMbps ?? tsStats.traffic_stats_dl_mbps,
      traffic_stats_ul_mbps: tsStats.ulMbps ?? tsStats.traffic_stats_ul_mbps,
      traffic_stats_total_dl_mbps: tsStats.totalDlMbps ?? tsStats.traffic_stats_total_dl_mbps,
      traffic_stats_total_ul_mbps: tsStats.totalUlMbps ?? tsStats.traffic_stats_total_ul_mbps,
    };
  }).filter((r) => r.gps_lat != null && r.gps_lon != null);
}

function mapScenarioKeyForPlots(scenarioKey = "") {
  const key = String(scenarioKey || "").toLowerCase();
  if (key.includes("ookla")) return "ookla_app";
  if (key.includes("fcc")) return "fcc_app";
  if (key.includes("iperf")) return "iperf3";
  if (key === "ftp") return "ftp";
  if (key === "native_http") return "native_http";
  if (key === "rf_only") return "rf_data";
  return key || "rf_data";
}

function isExternalEvidenceKey(scenarioKey = "") {
  const key = String(scenarioKey || "").toLowerCase();
  return key.includes("ookla") || key.includes("fcc");
}

async function renderPlotImages(plots = [], canvasDefaults = {}, sharedBasemap = null, titlePrefix = "") {
  const out = [];
  for (const plot of (plots || []).slice(0, 8)) {
    try {
      const img = await renderRouteKpiMapPng(plot, {
        sharedBasemap,
        ...canvasDefaults,
      });
      if (img?.base64) {
        out.push({
          title: `${titlePrefix}${plot.title || plot.kpi || "Map"}`,
          ...img,
        });
      }
    } catch {
      // skip failed plot
    }
  }
  return out;
}

/**
 * Per-scenario F9 plot bundles — never merge HTTP/FTP/iPerf3/OOKLA/FCC into one visual sequence.
 */
async function renderScenarioPlotBundles(model = {}) {
  const bundles = [];
  const scenarioAttempts = [];
  for (const entry of (model.scenarios || [])) {
    const scenarioId = entry.scenarioId || "S??";
    const scenarioKey = String(entry.scenarioKey || "");
    const plotKey = mapScenarioKeyForPlots(scenarioKey);
    const engineToken = engineSheetToken(scenarioKey);
    const external = isExternalEvidenceKey(scenarioKey);
    const session = entry.session || {};
    const scenarioPlotRows = sessionSamplesToPlotRows(session);
    const identity = {
      scenarioId,
      engine: entry.scenarioLabel || engineToken,
      engineKey: scenarioKey,
      mode: entry.runModeLabel || null,
      direction: entry.direction || null,
      packageId: entry.sourcePackage || session.sourcePackage || session.id || null,
      startedAt: entry.startedAt || session.startedAt || null,
      endedAt: entry.endedAt || session.endedAt || null,
      externalEvidence: external,
      evidenceLabel: external
        ? `${engineToken} External Evidence`
        : null,
    };

    const sheetBase = excelSafeSheetName(scenarioId, engineToken);
    const rfSheetName = excelSafeSheetName(sheetBase, "RF_Maps");
    const dataSheetName = excelSafeSheetName(sheetBase, "Data_Maps");
    const eventSheetName = excelSafeSheetName(sheetBase, "Events");

    let rfImages = [];
    let dataImages = [];
    let eventImages = [];
    let sharedBasemap = null;
    let canvasDefaults = { orientation: "landscape", width: 1200, height: 720 };

    if (scenarioPlotRows.length) {
      try {
        const rfSpecs = buildMapPlotSpecs({
          plotRows: scenarioPlotRows,
          throughputRows: [],
          scenario: "rf_data",
          distance: {
            distance_covered_m: model.routeSummary?.drivenDistanceM ?? null,
            route_status: model.routeSummary?.status || null,
          },
          session: {
            ...session,
            appTestType: session.appTestType || "rf_only",
            appEngineId: session.appEngineId || "rf_only",
          },
          dataTestOutcome: { hasSuccessfulAppThroughput: false },
        });
        const gpsForBasemap = rfSpecs.gpsPointsForBasemap || scenarioPlotRows;
        const sessionAspect = computeProjectedRouteAspect(gpsForBasemap);
        const canvasSize = canvasSizeForOrientation(sessionAspect.orientation);
        canvasDefaults = {
          orientation: sessionAspect.orientation,
          width: canvasSize.width,
          height: canvasSize.height,
        };
        try {
          sharedBasemap = await prepareSharedBasemap(
            gpsForBasemap,
            Math.round(canvasSize.width * 0.79),
            Math.round(canvasSize.height * 0.786),
          );
        } catch {
          sharedBasemap = null;
        }
        rfImages = await renderPlotImages(rfSpecs.rfPlots || [], canvasDefaults, sharedBasemap);
      } catch (err) {
        scenarioAttempts.push({
          scenarioId,
          kind: "rf",
          eligible: false,
          reason: err?.message || "RF map render failed",
        });
      }

      const iters = Array.isArray(session.appIterationResults) ? session.appIterationResults : [];
      const hasEvidenceIters = external && (
        (Array.isArray(session.appOoklaEvidenceIterations) && session.appOoklaEvidenceIterations.length)
        || (Array.isArray(session.appFccEvidenceIterations) && session.appFccEvidenceIterations.length)
      );
      const controlled = ["native_http", "ftp", "iperf3"].includes(plotKey);
      if (controlled || hasEvidenceIters || plotKey === "ookla_app" || plotKey === "fcc_app") {
        try {
          const hasThroughput = iters.some((row) => (
            row.dlMbps != null || row.ulMbps != null || String(row.status || "").toLowerCase() === "failed"
          ));
          const dataSpecs = buildMapPlotSpecs({
            plotRows: scenarioPlotRows,
            throughputRows: [],
            scenario: plotKey,
            distance: {
              distance_covered_m: model.routeSummary?.drivenDistanceM ?? null,
              route_status: model.routeSummary?.status || null,
            },
            session,
            dataTestOutcome: entry.outcome || { hasSuccessfulAppThroughput: hasThroughput || hasEvidenceIters },
          });
          dataImages = await renderPlotImages(dataSpecs.dataPlots || [], canvasDefaults, sharedBasemap);
          scenarioAttempts.push({
            scenarioId,
            kind: "data",
            eligible: dataImages.length > 0,
            imageCount: dataImages.length,
            reason: dataImages.length
              ? (external ? "External-evidence data markers via F9 specs" : "Controlled-engine data maps via F9 specs")
              : "No eligible data-plot geometry for this scenario",
          });
        } catch (err) {
          scenarioAttempts.push({
            scenarioId,
            kind: "data",
            eligible: false,
            reason: err?.message || "Data map render failed",
          });
        }
      }
    } else {
      scenarioAttempts.push({
        scenarioId,
        kind: "rf",
        eligible: false,
        reason: "No GPS samples in source package",
      });
    }

    const scenarioEvents = Array.isArray(entry.events) ? entry.events : [];
    if (scenarioEvents.length) {
      try {
        const png = await renderEventTimeSeriesPng({
          title: `${scenarioId} ${identity.engine} events`,
          events: scenarioEvents.slice(0, 200),
        });
        if (png?.base64) eventImages = [{ title: `${scenarioId} event timeline`, ...png }];
      } catch {
        eventImages = [];
      }
    }

    bundles.push({
      identity,
      rfSheetName,
      dataSheetName,
      eventSheetName,
      rfImages,
      dataImages,
      eventImages,
    });
  }

  return {
    bundles,
    dataMapEligibility: {
      eligible: bundles.some((b) => b.dataImages.length > 0),
      reason: bundles.some((b) => b.dataImages.length > 0)
        ? "Per-scenario F9 data maps rendered."
        : "No eligible per-scenario data maps.",
      scenarioAttempts,
    },
  };
}

function addScenarioImageSheet(workbook, sheet, images, identity = {}, title = "Plots", emptyReason = null) {
  setCell(sheet, 1, 1, title);
  sheet.getCell(1, 1).font = { bold: true, size: 14, color: { argb: BRAND.navy } };
  const meta = [
    ["Scenario ID", identity.scenarioId],
    ["Engine", identity.externalEvidence ? (identity.evidenceLabel || identity.engine) : identity.engine],
    ["Mode", identity.mode],
    ["Direction", identity.direction || "—"],
    ["Package / identity", identity.packageId],
    ["Scenario start", formatTs(identity.startedAt)],
    ["Scenario end", formatTs(identity.endedAt)],
  ];
  meta.forEach((pair, idx) => {
    setCell(sheet, 3 + idx, 1, pair[0]);
    setCell(sheet, 3 + idx, 2, pair[1]);
    sheet.getCell(3 + idx, 1).font = { bold: true };
  });
  sheet.getColumn(1).width = 22;
  sheet.getColumn(2).width = 56;
  sheet.views = [];
  if (!images.length) {
    setCell(sheet, 12, 1, "No map images for this scenario.");
    if (emptyReason) setCell(sheet, 13, 1, emptyReason);
    return;
  }
  let rowCursor = 12;
  images.forEach((img) => {
    setCell(sheet, rowCursor, 1, img.title || "Map");
    rowCursor += 1;
    const imageId = workbook.addImage({ base64: img.base64, extension: "png" });
    const imgW = img.width || 1000;
    const imgH = img.height || 640;
    const displayW = Math.min(720, imgW);
    const displayH = displayW * (imgH / imgW);
    sheet.addImage(imageId, {
      tl: { col: 0.2, row: rowCursor - 1 },
      ext: { width: displayW, height: displayH },
      editAs: "oneCell",
    });
    rowCursor += Math.ceil(displayH / 15) + 2;
  });
}

/**
 * Build unified workbook buffer from unified field report model.
 */
export async function buildUnifiedFieldReportWorkbookBuffer(model = {}, options = {}) {
  const ExcelJS = await loadExcelJS();
  if (!ExcelJS?.Workbook) throw new Error("exceljs Workbook unavailable");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BabyDragon / MobbiTech Global LLC";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.description = `BabyDragon Unified Field Test Report ${UNIFIED_FIELD_REPORT_VERSION}`;

  const created = [];
  const usedNames = new Set();
  const add = (name, purpose, builder) => {
    let safe = excelSafeSheetName(name);
    let suffix = 2;
    while (usedNames.has(safe.toLowerCase())) {
      const base = excelSafeSheetName(name).slice(0, 28);
      safe = excelSafeSheetName(`${base}_${suffix}`);
      suffix += 1;
    }
    usedNames.add(safe.toLowerCase());
    const sheet = workbook.addWorksheet(safe);
    builder(sheet);
    sheet.views = [];
    created.push({ name: safe, purpose, sheet });
  };

  add(UNIFIED_SHEET_NAMES.cover, "Customer field-test cover and scenario overview", (s) => buildCover(s, model));
  add(UNIFIED_SHEET_NAMES.index, "Navigation", () => {});
  add(UNIFIED_SHEET_NAMES.scenarioSummary, "One row per scenario", (s) => buildScenarioSummarySheet(s, model));
  add(UNIFIED_SHEET_NAMES.rfKpi, "RF KPI statistics on deduplicated RF", (s) => buildRfKpiSheet(s, model));
  add(UNIFIED_SHEET_NAMES.dataKpi, "Engine-separated data KPI sections", (s) => buildDataKpiSheet(s, model));
  if ((model.iterations || []).length) {
    add(UNIFIED_SHEET_NAMES.iterations, "Controlled-engine iterations", (s) => buildIterationsSheet(s, model));
  }
  add(UNIFIED_SHEET_NAMES.rfRaw, "Deduplicated RF/GPS with provenance", (s) => buildRfRawSheet(s, model));
  add(UNIFIED_SHEET_NAMES.dataThroughput, "Engine-separated throughput tables", (s) => buildDataThroughputSheet(s, model));
  if ((model.events || []).length) {
    add(UNIFIED_SHEET_NAMES.dataEvents, "Meaningful combined events", (s) => buildDataEventsSheet(s, model));
  }
  if (model.sheetFlags?.hasExternalEvidence) {
    add(UNIFIED_SHEET_NAMES.external, "OOKLA/FCC external evidence", (s) => buildExternalSheet(s, model));
  }

  const plotResult = options.skipMaps
    ? { bundles: [], dataMapEligibility: { eligible: false, reason: "Maps skipped for this build.", scenarioAttempts: [] } }
    : await renderScenarioPlotBundles(model);

  for (const bundle of plotResult.bundles || []) {
    const id = bundle.identity || {};
    if (bundle.rfImages?.length) {
      add(
        bundle.rfSheetName,
        `${id.scenarioId} RF maps (${id.engine})`,
        (s) => addScenarioImageSheet(workbook, s, bundle.rfImages, id, `${id.scenarioId} RF Map Plots`),
      );
    }
    if (bundle.dataImages?.length) {
      add(
        bundle.dataSheetName,
        `${id.scenarioId} data maps (${id.engine})`,
        (s) => addScenarioImageSheet(
          workbook,
          s,
          bundle.dataImages,
          id,
          id.externalEvidence
            ? `${id.scenarioId} External Evidence Maps`
            : `${id.scenarioId} Data Map Plots`,
        ),
      );
    }
    if (bundle.eventImages?.length) {
      add(
        bundle.eventSheetName,
        `${id.scenarioId} event graphs (${id.engine})`,
        (s) => addScenarioImageSheet(workbook, s, bundle.eventImages, id, `${id.scenarioId} Event Graphs`),
      );
    }
  }

  add(UNIFIED_SHEET_NAMES.qa, "Aggregation audit and reconcile", (s) => buildQaSheet(s, model));
  add(UNIFIED_SHEET_NAMES.readMe, "Definitions and limitations", (s) => buildReadMe(s, model));

  // Refresh Index with only created sheets (avoid stale links)
  const indexSheet = workbook.getWorksheet(UNIFIED_SHEET_NAMES.index)
    || workbook.worksheets.find((ws) => ws.name === UNIFIED_SHEET_NAMES.index);
  if (indexSheet) {
    indexSheet.spliceRows(1, indexSheet.rowCount);
    buildIndex(indexSheet, created.map((c) => ({ name: c.name, purpose: c.purpose })));
    indexSheet.views = [];
  }

  // Ensure ReadMe is last and no sheet retains freeze panes.
  created.forEach((c, idx) => {
    c.sheet.orderNo = idx + 1;
    c.sheet.views = [];
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    buffer,
    workbook,
    createdSheets: created.map((c) => c.name),
    scenarioPlotSheets: (plotResult.bundles || []).map((b) => ({
      scenarioId: b.identity?.scenarioId,
      engine: b.identity?.engine,
      rfSheet: b.rfImages?.length ? b.rfSheetName : null,
      dataSheet: b.dataImages?.length ? b.dataSheetName : null,
      eventSheet: b.eventImages?.length ? b.eventSheetName : null,
    })),
    version: UNIFIED_FIELD_REPORT_VERSION,
  };
}

export default {
  UNIFIED_SHEET_NAMES,
  buildUnifiedFieldReportWorkbookBuffer,
};
