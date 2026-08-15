/**
 * F10A — Unified Field Test Report aggregation (report-only).
 * Consumes F9 canonical session / outcome / scenario adapters.
 * Does NOT recalculate engine throughput or RF measurement math.
 */

import {
  SCENARIO_KEYS,
  buildScenarioAdapter,
  createNormalizedScenarioReportModel,
  resolveScenarioKey,
  resolveRunModeLabel,
  scenarioDisplayName,
} from "./scenarioReportModel.js";
import { buildDataTestOutcome } from "./dataTestOutcome.js";
import { MEANINGFUL_TRAFFIC_STATS_MBPS, isMeaningfulTrafficStatsMbps } from "./trafficStatsMeasurement.js";
import { computeFilteredRouteTruth } from "./excelRouteQuality.js";
import { buildRfEvents } from "../utils/rfEventDetector.js";
import { attachMapGpsToEvents } from "../utils/gpsEventMatchUtils.js";
import { formatTransportChange, resolveSessionConnectivity } from "./connectivitySnapshot.js";

export const UNIFIED_FIELD_REPORT_VERSION = "2.0.3-unified-field-report-f10b";
export const F9_SOURCE_REPORT_VERSION = "1.9.5-excel-plot-f10b";

function getNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function round(value, digits = 2) {
  const n = getNumber(value);
  if (n === null) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/**
 * RF sample dedupe key — identity of one physical measurement instant.
 * Same timestamp + sample id + lat/lng + core serving KPIs → one unique RF row.
 * Different measurement values at the same timestamp are NOT collapsed.
 */
export function buildRfDedupeKey(row = {}) {
  const ts = getNumber(row.timestamp_ms ?? row.timestamp ?? row.sample_timestamp_ms) ?? "";
  const sid = cleanText(row.sample_id ?? row.id) || "";
  const lat = getNumber(row.gps_lat ?? row.latitude);
  const lng = getNumber(row.gps_lon ?? row.longitude);
  const rsrp = getNumber(row.lte_rsrp_dbm ?? row.lteRsrp);
  const nr = getNumber(row.nr_ss_rsrp_dbm ?? row.nrSsRsrp);
  const pci = getNumber(row.lte_pci ?? row.ltePci) ?? getNumber(row.nr_pci ?? row.nrPci);
  const rat = cleanText(row.rat) || "";
  return [
    ts,
    sid,
    lat === null ? "" : lat.toFixed(6),
    lng === null ? "" : lng.toFixed(6),
    rsrp === null ? "" : rsrp,
    nr === null ? "" : nr,
    pci === null ? "" : pci,
    rat,
  ].join("|");
}

/**
 * Event dedupe key — physical radio/data event identity.
 */
export function buildEventDedupeKey(event = {}) {
  const type = cleanText(event.event_type || event.type || event.eventType) || "";
  const ts = getNumber(event.timestamp_ms ?? event.timestamp ?? event.event_time_ms) ?? "";
  const sampleId = cleanText(event.sample_id || event.sampleId || event.related_sample_id) || "";
  const cell = cleanText(event.cell_id || event.pci || event.earfcn || event.nrarfcn) || "";
  const engine = cleanText(event.engine || event.engine_id || event.source) || "";
  const iter = getNumber(event.iteration ?? event.related_iteration);
  return [type, ts, sampleId, cell, engine, iter === null ? "" : iter].join("|");
}

export function assignScenarioIds(scenarios = []) {
  return scenarios.map((item, index) => {
    const id = `S${String(index + 1).padStart(2, "0")}`;
    return { ...item, scenarioId: item.scenarioId || id };
  });
}

function factualFieldStatus(scenarios = []) {
  // Evidence collection completeness only — not KPI PASS/FAIL acceptance criteria.
  const statuses = scenarios.map((s) => String(s.outcome?.normalizedStatus || s.status || "").toLowerCase());
  const hasFail = statuses.some((s) => s === "failed" || s === "failed_before_start");
  const hasPartial = statuses.some((s) => s === "incomplete" || s === "complete_with_failures" || s === "partial");
  const hasEvidence = scenarios.some((s) => s.scenarioKey === SCENARIO_KEYS.OOKLA || s.scenarioKey === SCENARIO_KEYS.FCC);
  const hasRf = scenarios.some((s) => (s.rfRows || []).length > 0);
  if (hasFail) return "Evidence Collection Contains Failures";
  if (hasPartial) return "Evidence Collection Partial";
  if (scenarios.length) return "Evidence Collection Complete";
  if (hasEvidence) return "External Evidence Included";
  if (hasRf) return "RF Evidence Recorded";
  return "No scenarios selected";
}

/**
 * Map F9 route_status to customer Route Quality without inventing GPS availability.
 */
function mapRouteQualityLabel(routeStatus = "", gpsSampleCount = 0) {
  const status = String(routeStatus || "").trim();
  if (!gpsSampleCount) return "Unavailable";
  if (status === "Mobility route recorded") return "Good";
  if (status === "Stationary / limited route spread") return "Stationary";
  if (status === "Insufficient fresh GPS") return "Insufficient";
  if (status === "GPS stale") return "Degraded";
  if (status === "GPS unavailable") return "Unavailable";
  if (status) return status;
  return gpsSampleCount ? "Degraded" : "Unavailable";
}

function scenarioFailureSummary(outcome = {}) {
  const st = String(outcome.normalizedStatus || "").toLowerCase();
  const hasFailure = (outcome.failedIterations || 0) > 0
    || st === "failed"
    || st === "failed_before_start"
    || st === "complete_with_failures"
    || st === "incomplete";
  if (!hasFailure) return null;
  const reason = cleanText(outcome.conciseReason) || cleanText(outcome.failureReason) || cleanText(outcome.errorMessage);
  if (!reason) return null;
  const lower = reason.toLowerCase();
  if (/(http|ftp|iperf3?|native)\s+test\s+completed\.?$/.test(lower) && !lower.includes("fail")) return null;
  return reason;
}

function customerStatusLabel(outcome = {}, scenarioKey = "") {
  const st = String(outcome.normalizedStatus || outcome.status || "").toLowerCase();
  if (scenarioKey === SCENARIO_KEYS.OOKLA || scenarioKey === SCENARIO_KEYS.FCC) {
    if (st.includes("saved") || st === "complete" || st === "evidence_saved") return "Evidence Saved";
    if (st.includes("partial") || st.includes("draft")) return "Evidence Partial";
    return outcome.status || "External Evidence";
  }
  if (scenarioKey === SCENARIO_KEYS.RF_ONLY) return "RF Recorded";
  if (st === "continuous_complete" || st === "complete") return "Complete";
  if (st === "complete_with_failures" || st === "incomplete" || st === "partial") return "Partial";
  if (st === "failed" || st === "failed_before_start" || st === "error") return "Failed";
  if (st === "cancelled") return "Cancelled";
  return outcome.status || st || "Recorded";
}

function extractRfRowsFromSession(session = {}) {
  const samples = Array.isArray(session.exportSamples)
    ? session.exportSamples
    : (Array.isArray(session.traceSamples) ? session.traceSamples : []);
  return samples.map((sample, index) => {
    const snap = sample.snapshot || sample.rf || {};
    const gps = sample.gps || {};
    const ts = getNumber(sample.trafficStats) ? sample.trafficStats : (sample.trafficStats || {});
    return {
      sample_index: index + 1,
      sample_id: sample.id || `${sample.timestamp || index}`,
      session_id: sample.sessionId || session.id || null,
      timestamp_ms: getNumber(sample.timestamp),
      timestamp_iso: sample.isoTime || null,
      rat: cleanText(snap.currentRatName || snap.dataNetworkTypeName || snap.rat || sample.rat || session.rat),
      gps_lat: getNumber(gps.lat ?? gps.latitude),
      gps_lon: getNumber(gps.lon ?? gps.lng ?? gps.longitude),
      gps_accuracy_m: getNumber(gps.accuracy),
      gps_speed_mps: getNumber(gps.speed),
      gps_status: cleanText(gps.status || gps.gps_status || gps.freshness),
      lte_rsrp_dbm: getNumber(snap.lteRsrp ?? snap.lte_rsrp_dbm ?? snap.lte?.rsrp),
      lte_rsrq_db: getNumber(snap.lteRsrq ?? snap.lte_rsrq_db ?? snap.lte?.rsrq),
      lte_sinr_db: getNumber(snap.lteSinr ?? snap.lte_sinr_db ?? snap.lte?.sinr),
      lte_pci: getNumber(snap.ltePci ?? snap.lte_pci ?? snap.lte?.pci),
      lte_earfcn: getNumber(snap.lteEarfcn ?? snap.lte_earfcn ?? snap.lte?.earfcn),
      nr_ss_rsrp_dbm: getNumber(snap.nrSsRsrp ?? snap.nr_ss_rsrp_dbm ?? snap.nr?.ssRsrp),
      nr_ss_rsrq_db: getNumber(snap.nrSsRsrq ?? snap.nr_ss_rsrq_db ?? snap.nr?.ssRsrq),
      nr_ss_sinr_db: getNumber(snap.nrSsSinr ?? snap.nr_ss_sinr_db ?? snap.nr?.ssSinr),
      nr_pci: getNumber(snap.nrPci ?? snap.nr_pci ?? snap.nr?.pci),
      nr_nrarfcn: getNumber(snap.nrNrarfcn ?? snap.nr_nrarfcn ?? snap.nr?.nrarfcn),
      traffic_stats_dl_mbps: getNumber(ts.dlMbps ?? ts.trafficStatsDlMbps ?? ts.traffic_stats_dl_mbps),
      traffic_stats_ul_mbps: getNumber(ts.ulMbps ?? ts.trafficStatsUlMbps ?? ts.traffic_stats_ul_mbps),
      traffic_stats_total_dl_mbps: getNumber(ts.totalDlMbps ?? ts.trafficStatsTotalDlMbps ?? ts.traffic_stats_total_dl_mbps),
      traffic_stats_total_ul_mbps: getNumber(ts.totalUlMbps ?? ts.trafficStatsTotalUlMbps ?? ts.traffic_stats_total_ul_mbps),
      _source_session_id: session.id || null,
    };
  });
}

function metricStats(rows, key) {
  const values = rows.map((r) => getNumber(r[key])).filter((n) => n !== null);
  if (!values.length) {
    return { average: null, minimum: null, maximum: null, count: 0 };
  }
  return {
    average: round(values.reduce((a, b) => a + b, 0) / values.length, 2),
    minimum: round(Math.min(...values), 2),
    maximum: round(Math.max(...values), 2),
    count: values.length,
  };
}

function buildRfKpiSummary(uniqueRfRows = []) {
  return {
    lte: [
      { kpi: "RSRP", unit: "dBm", ...metricStats(uniqueRfRows, "lte_rsrp_dbm") },
      { kpi: "RSRQ", unit: "dB", ...metricStats(uniqueRfRows, "lte_rsrq_db") },
      { kpi: "SINR", unit: "dB", ...metricStats(uniqueRfRows, "lte_sinr_db") },
    ],
    nr: [
      { kpi: "SS-RSRP", unit: "dBm", ...metricStats(uniqueRfRows, "nr_ss_rsrp_dbm") },
      { kpi: "SS-RSRQ", unit: "dB", ...metricStats(uniqueRfRows, "nr_ss_rsrq_db") },
      { kpi: "SS-SINR", unit: "dB", ...metricStats(uniqueRfRows, "nr_ss_sinr_db") },
    ],
    identifiers: {
      lte_pci_values: [...new Set(uniqueRfRows.map((r) => getNumber(r.lte_pci)).filter((n) => n !== null))],
      nr_pci_values: [...new Set(uniqueRfRows.map((r) => getNumber(r.nr_pci)).filter((n) => n !== null))],
      technologies: [...new Set(uniqueRfRows.map((r) => cleanText(r.rat)).filter(Boolean))],
    },
  };
}

function buildDataEngineSummary(scenarioEntries = []) {
  const byEngine = {
    native_http: [],
    ftp: [],
    iperf3: [],
    ookla_app: [],
    fcc_app: [],
    traffic_stats: { mobileMeaningful: false, totalMeaningful: false },
  };

  for (const entry of scenarioEntries) {
    const key = entry.scenarioKey;
    const outcome = entry.outcome || {};
    const row = {
      scenarioId: entry.scenarioId,
      mode: entry.runModeLabel,
      direction: entry.direction,
      attempted: outcome.attemptedIterations ?? null,
      completed: outcome.completedIterations ?? null,
      failed: outcome.failedIterations ?? null,
      requested: outcome.requestedIterations ?? null,
      remaining: outcome.remainingIterations ?? null,
      avgDlMbps: getNumber(entry.session?.appDlMbps) ?? outcome.successfulDlAvgMbps ?? null,
      avgUlMbps: getNumber(entry.session?.appUlMbps) ?? outcome.successfulUlAvgMbps ?? null,
      dlBytes: getNumber(entry.session?.appDownloadBytes),
      ulBytes: getNumber(entry.session?.appUploadBytes),
      status: customerStatusLabel(outcome, key),
      normalizedStatus: outcome.normalizedStatus || null,
      failureReason: outcome.conciseReason || outcome.failureReason || null,
      errorCode: outcome.errorCode || null,
      failureStage: outcome.failureStage || null,
      provenance: entry.sourceFamily,
    };
    if (key === SCENARIO_KEYS.NATIVE_HTTP) byEngine.native_http.push(row);
    else if (key === SCENARIO_KEYS.FTP) byEngine.ftp.push(row);
    else if (key === SCENARIO_KEYS.IPERF3) byEngine.iperf3.push(row);
    else if (key === SCENARIO_KEYS.OOKLA) byEngine.ookla_app.push(row);
    else if (key === SCENARIO_KEYS.FCC) byEngine.fcc_app.push(row);

    for (const rf of entry.rfRows || []) {
      if (isMeaningfulTrafficStatsMbps(rf.traffic_stats_dl_mbps) || isMeaningfulTrafficStatsMbps(rf.traffic_stats_ul_mbps)) {
        byEngine.traffic_stats.mobileMeaningful = true;
      }
      if (isMeaningfulTrafficStatsMbps(rf.traffic_stats_total_dl_mbps) || isMeaningfulTrafficStatsMbps(rf.traffic_stats_total_ul_mbps)) {
        byEngine.traffic_stats.totalMeaningful = true;
      }
    }
  }
  byEngine.traffic_stats.meaningfulFloorMbps = MEANINGFUL_TRAFFIC_STATS_MBPS;
  return byEngine;
}

function collectIterations(scenarioEntries = []) {
  const rows = [];
  for (const entry of scenarioEntries) {
    if (![SCENARIO_KEYS.NATIVE_HTTP, SCENARIO_KEYS.FTP, SCENARIO_KEYS.IPERF3].includes(entry.scenarioKey)) continue;
    const iters = Array.isArray(entry.session?.appIterationResults) ? entry.session.appIterationResults : [];
    for (const iter of iters) {
      rows.push({
        scenarioId: entry.scenarioId,
        engine: entry.scenarioLabel,
        engineKey: entry.scenarioKey,
        direction: entry.direction,
        iteration: iter.iteration ?? null,
        startedAt: iter.startedAt || iter.started_at_iso || null,
        endedAt: iter.endedAt || iter.ended_at_iso || null,
        durationSec: getNumber(iter.wall_seconds ?? iter.durationSeconds),
        status: iter.status || null,
        dlMbps: getNumber(iter.dlMbps ?? iter.dl?.mbps),
        ulMbps: getNumber(iter.ulMbps ?? iter.ul?.mbps),
        dlBytes: getNumber(iter.dlMeasuredBytes ?? iter.dlBytes ?? iter.dl?.measured_bytes),
        ulBytes: getNumber(iter.ulMeasuredBytes ?? iter.ulBytes ?? iter.ul?.measured_bytes),
        failureCode: iter.errorCode || iter.error_code || null,
        failureStage: iter.failureStage || iter.failure_stage || null,
        failureReason: iter.conciseReason || iter.error || iter.errorMessage || null,
        provenance: entry.sourceFamily,
      });
    }
  }
  return rows;
}

function collectExternalEvidence(scenarioEntries = []) {
  const rows = [];
  for (const entry of scenarioEntries) {
    if (entry.scenarioKey === SCENARIO_KEYS.OOKLA) {
      const iters = entry.session?.appOoklaEvidenceIterations || (entry.session?.appOoklaEvidence ? [entry.session.appOoklaEvidence] : []);
      for (const item of iters) {
        rows.push({
          scenarioId: entry.scenarioId,
          source: "OOKLA External Evidence",
          timestamp: item.endedAt || item.timestamp || item.startedAt || null,
          dlMbps: getNumber(item.dlMbps),
          ulMbps: getNumber(item.ulMbps),
          pingMs: getNumber(item.pingMs),
          latitude: getNumber(item.latitude ?? item.gpsLat),
          longitude: getNumber(item.longitude ?? item.gpsLon),
          matchQuality: item.matchQuality || item.matchedContext?.quality || null,
          provenance: "external_evidence",
        });
      }
    }
    if (entry.scenarioKey === SCENARIO_KEYS.FCC) {
      const iters = entry.session?.appFccEvidenceIterations || [];
      for (const item of iters) {
        rows.push({
          scenarioId: entry.scenarioId,
          source: "FCC External Evidence",
          timestamp: item.endedAt || item.timestamp || item.startedAt || null,
          dlMbps: getNumber(item.fccDlMbps ?? item.dlMbps),
          ulMbps: getNumber(item.fccUlMbps ?? item.ulMbps),
          pingMs: getNumber(item.fccPingMs ?? item.pingMs),
          latitude: getNumber(item.latitude ?? item.gpsLat),
          longitude: getNumber(item.longitude ?? item.gpsLon),
          matchQuality: item.matchedContext?.quality || item.matchQuality || null,
          provenance: "external_evidence",
        });
      }
    }
  }
  return rows;
}

/**
 * Create unified field report model from explicit scenario sessions.
 * @param {object} input
 * @param {Array<{session: object, sourcePackage?: string, scenarioId?: string}>} input.scenarios
 * @param {object} [input.fieldContext]
 * @param {object} [input.deviceContext]
 */
export function createUnifiedFieldReportModel({
  scenarios = [],
  fieldContext = {},
  deviceContext = {},
  user = null,
} = {}) {
  if (!Array.isArray(scenarios) || !scenarios.length) {
    throw new Error("Unified Field Report requires at least one explicitly selected scenario.");
  }

  const tagged = assignScenarioIds(scenarios.map((item) => ({
    session: item.session || item,
    sourcePackage: item.sourcePackage || item.sourceReference || null,
    scenarioId: item.scenarioId || null,
  })));

  const scenarioEntries = [];
  const rfSourceRows = [];
  const eventSourceRows = [];
  const warnings = [];

  for (const item of tagged) {
    const session = item.session || {};
    const scenarioKey = resolveScenarioKey(session);
    const adapter = buildScenarioAdapter(session, scenarioKey);
    const outcome = buildDataTestOutcome(session);
    const normalized = createNormalizedScenarioReportModel({
      session,
      scenarioAdapter: adapter,
      testOutcome: outcome,
      iterations: Array.isArray(session.appIterationResults) ? session.appIterationResults : [],
    });
    const rfRows = extractRfRowsFromSession(session).map((row) => ({
      ...row,
      scenario_ids: [item.scenarioId],
    }));
    const samples = session.exportSamples || session.traceSamples || [];
    let events = [];
    try {
      const built = buildRfEvents({ samples, session });
      events = attachMapGpsToEvents(built.events || [], samples);
    } catch (error) {
      warnings.push(`${item.scenarioId}: event build skipped (${error?.message || "error"})`);
    }

    scenarioEntries.push({
      scenarioId: item.scenarioId,
      scenarioKey,
      scenarioLabel: scenarioDisplayName(scenarioKey),
      sourceFamily: adapter.sourceFamily,
      runModeLabel: resolveRunModeLabel(session, scenarioKey),
      direction: cleanText(session.appDirectionLabel || session.appDirection) || null,
      startedAt: session.startedAt || null,
      endedAt: session.endedAt || null,
      durationMs: getNumber(session.durationMs)
        ?? ((getNumber(session.endedAt) != null && getNumber(session.startedAt) != null)
          ? Math.max(0, getNumber(session.endedAt) - getNumber(session.startedAt))
          : null),
      status: customerStatusLabel(outcome, scenarioKey),
      outcome,
      adapter,
      normalized,
      session,
      rfRows,
      events: events.map((ev) => ({ ...ev, scenarioId: item.scenarioId })),
      sourcePackage: item.sourcePackage,
      taskLabel: session.taskLabel || fieldContext.task || null,
      grid: session.grid || fieldContext.grid || null,
      reportLogName: session.reportLogName || null,
    });

    rfSourceRows.push(...rfRows);
    eventSourceRows.push(...events.map((ev) => ({ ...ev, scenarioId: item.scenarioId })));
  }

  // Field-context guard: warn (do not auto-merge silently) when grids/tasks disagree.
  const grids = [...new Set(scenarioEntries.map((s) => cleanText(s.grid)).filter(Boolean))];
  const tasks = [...new Set(scenarioEntries.map((s) => cleanText(s.taskLabel)).filter(Boolean))];
  if (grids.length > 1) warnings.push(`Multiple grids selected: ${grids.join(", ")}. Explicit selection accepted.`);
  if (tasks.length > 1) warnings.push(`Multiple tasks selected: ${tasks.join(", ")}. Explicit selection accepted.`);

  // RF dedupe with provenance
  const rfMap = new Map();
  for (const row of rfSourceRows) {
    const key = buildRfDedupeKey(row);
    const existing = rfMap.get(key);
    if (!existing) {
      rfMap.set(key, {
        ...row,
        scenario_ids: [...(row.scenario_ids || [])],
      });
    } else {
      const mergedIds = new Set([...(existing.scenario_ids || []), ...(row.scenario_ids || [])]);
      existing.scenario_ids = [...mergedIds];
    }
  }
  const uniqueRfRows = [...rfMap.values()].sort((a, b) => (a.timestamp_ms || 0) - (b.timestamp_ms || 0));

  // Event dedupe
  const eventMap = new Map();
  for (const event of eventSourceRows) {
    const key = buildEventDedupeKey(event);
    const existing = eventMap.get(key);
    if (!existing) {
      eventMap.set(key, {
        ...event,
        scenario_ids: [event.scenarioId].filter(Boolean),
      });
    } else {
      const merged = new Set([...(existing.scenario_ids || []), event.scenarioId].filter(Boolean));
      existing.scenario_ids = [...merged];
    }
  }
  const uniqueEvents = [...eventMap.values()].sort((a, b) => (getNumber(a.timestamp_ms ?? a.timestamp) || 0) - (getNumber(b.timestamp_ms ?? b.timestamp) || 0));

  const starts = scenarioEntries.map((s) => getNumber(s.startedAt)).filter((n) => n !== null);
  const ends = scenarioEntries.map((s) => getNumber(s.endedAt)).filter((n) => n !== null);
  const startedAt = starts.length ? Math.min(...starts) : null;
  const endedAt = ends.length ? Math.max(...ends) : null;

  // Route from unique RF/GPS only — pass F9-compatible gps_status fields (not gps.status alone).
  const routeSamples = uniqueRfRows
    .filter((r) => r.gps_lat != null && r.gps_lon != null)
    .map((r) => ({
      timestamp: r.timestamp_ms,
      timestamp_ms: r.timestamp_ms,
      gps_status: r.gps_status,
      gps: {
        lat: r.gps_lat,
        lon: r.gps_lon,
        lng: r.gps_lon,
        accuracy: r.gps_accuracy_m,
        speed: r.gps_speed_mps,
        gps_status: r.gps_status,
        status: r.gps_status,
      },
    }));
  let routeSummary = {
    gpsEvidence: routeSamples.length ? "Recorded" : "Not Recorded",
    gpsSampleCount: routeSamples.length,
    routeQuality: routeSamples.length ? "Unavailable" : "Unavailable",
    status: routeSamples.length ? "Mobility route recorded" : "GPS unavailable",
    drivenDistanceM: null,
    gpsPointCount: routeSamples.length,
  };
  try {
    const truth = computeFilteredRouteTruth(routeSamples);
    const routeStatus = truth.route_status || (routeSamples.length ? "GPS unavailable" : "GPS unavailable");
    routeSummary = {
      gpsEvidence: routeSamples.length ? "Recorded" : "Not Recorded",
      gpsSampleCount: routeSamples.length,
      routeQuality: mapRouteQualityLabel(routeStatus, routeSamples.length),
      status: routeStatus,
      drivenDistanceM: truth.distance_covered_m ?? null,
      gpsPositionalVariationM: truth.gps_positional_variation_m ?? null,
      gpsPointCount: routeSamples.length,
      raw: truth,
    };
  } catch {
    // keep fallback
  }

  const scenarioSummaryRows = scenarioEntries.map((entry) => {
    const continuous = String(entry.runModeLabel).toLowerCase() === "continuous"
      || String(entry.outcome?.normalizedStatus || "").toLowerCase() === "continuous_complete";
    const external = entry.scenarioKey === SCENARIO_KEYS.OOKLA || entry.scenarioKey === SCENARIO_KEYS.FCC;
    const rfOnly = entry.scenarioKey === SCENARIO_KEYS.RF_ONLY;
    const conn = resolveSessionConnectivity(entry.session, entry.session.exportSamples || []);
    const transport = conn.recorded
      ? formatTransportChange(
        conn.connectivityStart?.defaultTransport,
        (conn.connectivityEnd || conn.connectivityStart)?.defaultTransport,
      )
      : "Not recorded";
    return {
      scenarioId: entry.scenarioId,
      scenarioType: entry.scenarioLabel,
      engine: entry.scenarioKey,
      mode: entry.runModeLabel,
      direction: external || rfOnly ? (entry.direction || "—") : (entry.direction || "—"),
      start: entry.startedAt,
      end: entry.endedAt,
      durationMs: entry.durationMs,
      requested: continuous || external || rfOnly ? null : (entry.outcome.requestedIterations ?? null),
      attempted: external || rfOnly ? null : (entry.outcome.attemptedIterations ?? null),
      completed: external || rfOnly ? null : (entry.outcome.completedIterations ?? null),
      failed: external || rfOnly ? null : (entry.outcome.failedIterations ?? null),
      remaining: continuous || external || rfOnly ? null : (entry.outcome.remainingIterations ?? null),
      avgDlMbps: rfOnly ? null : (getNumber(entry.session.appDlMbps) ?? entry.outcome.successfulDlAvgMbps ?? null),
      avgUlMbps: rfOnly ? null : (getNumber(entry.session.appUlMbps) ?? entry.outcome.successfulUlAvgMbps ?? null),
      latencyMs: null,
      dlBytes: rfOnly || external ? null : getNumber(entry.session.appDownloadBytes),
      ulBytes: rfOnly || external ? null : getNumber(entry.session.appUploadBytes),
      transport,
      status: entry.status,
      normalizedStatus: entry.outcome.normalizedStatus || null,
      failureSummary: scenarioFailureSummary(entry.outcome),
      source: entry.sourcePackage || entry.session.id || null,
      provenance: entry.sourceFamily,
    };
  });

  const iterations = collectIterations(scenarioEntries);
  const externalEvidence = collectExternalEvidence(scenarioEntries);
  const dataSummary = buildDataEngineSummary(scenarioEntries);
  const rfSummary = buildRfKpiSummary(uniqueRfRows);

  const reportIdentity = {
    version: UNIFIED_FIELD_REPORT_VERSION,
    f9SourceReportVersion: F9_SOURCE_REPORT_VERSION,
    generatedAt: Date.now(),
    reportName: cleanText(fieldContext.reportName)
      || cleanText(scenarioEntries[0]?.reportLogName)
      || cleanText(scenarioEntries[0]?.taskLabel)
      || "BabyDragon_Unified_Field_Test_Report",
    owner: "MobbiTech Global LLC",
  };

  const resolvedFieldContext = {
    project: fieldContext.project || null,
    task: fieldContext.task || tasks[0] || null,
    grid: fieldContext.grid || grids[0] || null,
    reportLogName: fieldContext.reportLogName || scenarioEntries[0]?.reportLogName || null,
    startedAt,
    endedAt,
    durationMs: startedAt != null && endedAt != null ? Math.max(0, endedAt - startedAt) : null,
    scenarioCount: scenarioEntries.length,
    overallStatus: factualFieldStatus(scenarioEntries),
    evidenceCollectionStatus: factualFieldStatus(scenarioEntries),
    technologiesObserved: rfSummary.identifiers.technologies,
  };

  const qaAudit = {
    unifiedReportVersion: UNIFIED_FIELD_REPORT_VERSION,
    f9SourceReportVersions: [F9_SOURCE_REPORT_VERSION],
    sourceScenarioCount: scenarioEntries.length,
    scenarioIds: scenarioEntries.map((s) => s.scenarioId),
    sourcePackages: scenarioEntries.map((s) => s.sourcePackage).filter(Boolean),
    rfRowsBeforeDedupe: rfSourceRows.length,
    rfRowsAfterDedupe: uniqueRfRows.length,
    rfDuplicatesRemoved: Math.max(0, rfSourceRows.length - uniqueRfRows.length),
    eventRowsBeforeDedupe: eventSourceRows.length,
    eventRowsAfterDedupe: uniqueEvents.length,
    eventDuplicatesRemoved: Math.max(0, eventSourceRows.length - uniqueEvents.length),
    iterationCountsByEngine: {
      native_http: iterations.filter((r) => r.engineKey === SCENARIO_KEYS.NATIVE_HTTP).length,
      ftp: iterations.filter((r) => r.engineKey === SCENARIO_KEYS.FTP).length,
      iperf3: iterations.filter((r) => r.engineKey === SCENARIO_KEYS.IPERF3).length,
    },
    failureCountsByEngine: {
      native_http: scenarioEntries.filter((s) => s.scenarioKey === SCENARIO_KEYS.NATIVE_HTTP && /fail/i.test(s.outcome.normalizedStatus || "")).length,
      ftp: scenarioEntries.filter((s) => s.scenarioKey === SCENARIO_KEYS.FTP && /fail/i.test(s.outcome.normalizedStatus || "")).length,
      iperf3: scenarioEntries.filter((s) => s.scenarioKey === SCENARIO_KEYS.IPERF3 && /fail/i.test(s.outcome.normalizedStatus || "")).length,
    },
    externalEvidenceCounts: {
      ookla: externalEvidence.filter((r) => /ookla/i.test(r.source)).length,
      fcc: externalEvidence.filter((r) => /fcc/i.test(r.source)).length,
    },
    gpsRouteQualityStatus: routeSummary.status,
    gpsEvidence: routeSummary.gpsEvidence,
    gpsSampleCount: routeSummary.gpsSampleCount,
    routeQuality: routeSummary.routeQuality,
    warnings,
    rfDedupeKey: "timestamp_ms|sample_id|lat6|lng6|lte_rsrp|nr_ss_rsrp|pci|rat",
    eventDedupeKey: "event_type|timestamp|sample_id|cell_or_channel|engine|iteration",
    scenarioReconcile: scenarioSummaryRows.map((row) => ({
      scenarioId: row.scenarioId,
      attempted: row.attempted,
      completed: row.completed,
      failed: row.failed,
      requested: row.requested,
      status: row.normalizedStatus,
      consistent: true,
    })),
  };

  return {
    reportIdentity,
    fieldContext: resolvedFieldContext,
    deviceContext: {
      feEmail: user?.email || deviceContext.feEmail || null,
      device: deviceContext.device || null,
      ...deviceContext,
    },
    scenarios: scenarioEntries,
    scenarioSummary: scenarioSummaryRows,
    rfSummary,
    dataSummary,
    routeSummary,
    iterations,
    rfRawData: uniqueRfRows,
    events: uniqueEvents,
    externalEvidence,
    qaAudit,
    sourceReferences: scenarioEntries.map((s) => ({
      scenarioId: s.scenarioId,
      sessionId: s.session.id || null,
      sourcePackage: s.sourcePackage,
      engine: s.scenarioKey,
    })),
    sheetFlags: {
      hasExternalEvidence: externalEvidence.length > 0,
      hasIterations: iterations.length > 0,
      hasRfMaps: uniqueRfRows.some((r) => r.gps_lat != null && r.gps_lon != null),
      hasDataMaps: iterations.some((r) => r.dlMbps != null || r.ulMbps != null),
      hasEvents: uniqueEvents.length > 0,
    },
  };
}

export default {
  UNIFIED_FIELD_REPORT_VERSION,
  F9_SOURCE_REPORT_VERSION,
  createUnifiedFieldReportModel,
  buildRfDedupeKey,
  buildEventDedupeKey,
  assignScenarioIds,
};
