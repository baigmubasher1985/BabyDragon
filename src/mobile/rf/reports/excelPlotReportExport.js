/**
 * Excel Plot Report model builder (Option A — plot-ready sheets, no native Excel charts).
 * Parallel export only — does not alter OOKLA/FCC 3-file packages.
 */

import { resolveOoklaIterations } from "./externalEvidenceSummary.js";
import { isFccSession } from "./fccReportExport.js";
import { resolveFccIterations } from "../utils/fccExportImport.js";
import { buildRfEvents, buildVoiceEvents } from "../utils/rfEventDetector.js";
import { computeRouteDistanceFromSamples } from "../utils/gpsDistanceUtils.js";
import { summarizeGpsQuality } from "../session/mobilityGpsFreshness.js";
import { attachMapGpsToEvents, EVENT_GPS_MATCH_MAX_DELTA_MS } from "../utils/gpsEventMatchUtils.js";
import { isOoklaSession } from "./ooklaReportExport.js";
import {
  RSRP_BINS,
  RSRQ_BINS,
  SINR_BINS,
  RSCP_BINS,
  ECNO_BINS,
  RXLEV_BINS,
  THP_DL_BINS,
  THP_UL_BINS,
  BER_BINS,
  GPS_ACCURACY_BINS,
} from "./excelMapPlotBins.js";
import { buildKpiSummary } from "./excelKpiSummary.js";
import { buildEventPlotSpecs, buildEventMapPlotSpecs } from "./excelEventPlotRenderer.js";
import { capturePaletteSnapshot } from "../config/rfKpiDisplayConfig.js";
import { maybeBuildDetailMapSpecs } from "./excelMapPlotRenderer.js";
import {
  attachRoutePointMeta,
  buildSegmentableRoutePointsFromRows,
} from "./excelRouteSegmentation.js";
import { computeFilteredRouteTruth } from "./excelRouteQuality.js";
import { MEANINGFUL_TRAFFIC_STATS_MBPS } from "./trafficStatsMeasurement.js";
import { buildDataTestOutcome, formatCustomerScenario, classifyNativeHttpFailure } from "./dataTestOutcome.js";
import { buildRfConfigurationRows } from "./rfConfigurationSummary.js";
import { buildScenarioAdapter, createNormalizedScenarioReportModel } from "./scenarioReportModel.js";

function isIperf3Session(session = {}) {
  if (session.appTestType === "iperf") return true;
  const rows = Array.isArray(session.appIterationResults) ? session.appIterationResults : [];
  return rows.some((row) => String(row?.source || "").includes("iperf"));
}

export const EXCEL_PLOT_REPORT_VERSION = "1.9.4-excel-plot-f9d";
export const EXCEL_PLOT_SHEET_NAMES = [
  "01_Test_Grid_Info",
  "02_Index",
  "03_KPI_Summary",
  "04_RF_Plot_Data",
  "05_RF_Raw_Data",
  "06_Data_Throughput",
  "07_Data_Events",
  "08_Voice_Events",
  "09_External_Evidence",
  "11_RF_Map_Plots",
  "12_Data_Map_Plots",
  "13_Event_Graphs",
  "14_Event_Map_Plots",
  "15_ReadMe",
];

const SAMPLE_CAP_NOTE = "Live RF UI preview retains approximately the last 900 samples (`samples` rolling window). Full-session export uses `exportSamplesRef` / `exportSamples` with no 900-sample truncation. Raw export, KPI Summary, distance, maps, and event matching use the complete session export list.";

function getNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return null;
}

function toIso(ms) {
  const n = getNumber(ms);
  if (n === null) return null;
  try {
    const d = new Date(n);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

function toLocal(ms) {
  const n = getNumber(ms);
  if (n === null) return null;
  try {
    return new Date(n).toLocaleString();
  } catch {
    return null;
  }
}

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text || text === "N/A" || text === "undefined" || text === "NaN") return null;
  return text;
}

function safeNum(value, digits = null) {
  const n = getNumber(value);
  if (n === null) return null;
  if (digits === null || Number.isInteger(n)) return n;
  return Number(n.toFixed(digits));
}

function durationSec(startMs, endMs) {
  const start = getNumber(startMs);
  const end = getNumber(endMs);
  if (start === null || end === null || end < start) return null;
  return Number(((end - start) / 1000).toFixed(3));
}

function getLte(snapshot = {}) {
  const serving = snapshot.serving && typeof snapshot.serving === "object" ? snapshot.serving : {};
  if (snapshot.lteAnchor && typeof snapshot.lteAnchor === "object") return snapshot.lteAnchor;
  if (String(serving.rat || "").toUpperCase() === "LTE") return serving;
  return {};
}

function getNr(snapshot = {}) {
  const serving = snapshot.serving && typeof snapshot.serving === "object" ? snapshot.serving : {};
  const rat = String(snapshot.currentRatName || serving.rat || serving.technology || "").toUpperCase();
  // SA / NR serving: use serving object when RAT is NR and no LTE anchor.
  if ((rat.includes("NR") || rat.includes("5G")) && !(snapshot.lteAnchor && typeof snapshot.lteAnchor === "object" && Object.keys(snapshot.lteAnchor).length)) {
    if (serving && (serving.ssRsrp != null || serving.rsrp != null || serving.pci != null || serving.nrarfcn != null)) {
      return serving;
    }
  }
  if (snapshot.nrSecondary && typeof snapshot.nrSecondary === "object") return snapshot.nrSecondary;
  if (String(serving.rat || "").toUpperCase() === "NR" || String(serving.technology || "").toUpperCase().includes("NR")) {
    return serving;
  }
  return {};
}

function getWcdma(snapshot = {}) {
  const serving = snapshot.serving && typeof snapshot.serving === "object" ? snapshot.serving : {};
  if (snapshot.wcdma && typeof snapshot.wcdma === "object") return snapshot.wcdma;
  if (String(serving.rat || "").toUpperCase().includes("WCDMA") || String(serving.rat || "").toUpperCase() === "UMTS") {
    return serving;
  }
  return {};
}

function getGsm(snapshot = {}) {
  const serving = snapshot.serving && typeof snapshot.serving === "object" ? snapshot.serving : {};
  if (snapshot.gsm && typeof snapshot.gsm === "object") return snapshot.gsm;
  if (String(serving.rat || "").toUpperCase() === "GSM") return serving;
  return {};
}

function resolveScenario(session = {}) {
  const engineId = String(session?.appEngineId || session?.engineId || "").toLowerCase();
  if (engineId.includes("ookla")) return "ookla_app";
  if (engineId.includes("fcc")) return "fcc_app";
  if (engineId.includes("iperf")) return "iperf3";
  if (engineId === "ftp") return "ftp";
  if (engineId === "native_http") return "native_http";
  if (engineId === "rf_only") return "rf_data";
  if (isOoklaSession(session)) return "ookla_app";
  if (isFccSession(session)) return "fcc_app";
  if (isIperf3Session(session)) return "iperf3";
  const type = String(session?.appTestType || session?.appSetupSnapshot?.testType || "").toLowerCase();
  if (type.includes("ftp")) return "ftp";
  if (type.includes("http") || type.includes("native")) return "native_http";
  if (type.includes("rf_only")) return "rf_data";
  if (session?.mode === "voice") return "voice";
  if (Array.isArray(session?.appIterationResults) && session.appIterationResults.length && type) {
    return type.includes("ftp") ? "ftp" : (type.includes("iperf") ? "iperf3" : "native_http");
  }
  return "rf_data";
}

function appDlUlRule(scenario) {
  if (scenario === "ookla_app" || scenario === "fcc_app") {
    return "OOKLA/FCC are external evidence only. APP DL/UL must remain N/A/null.";
  }
  if (scenario === "native_http" || scenario === "ftp" || scenario === "iperf3") {
    return "Native HTTP/FTP/iPerf can have internal BabyDragon throughput. External OOKLA/FCC evidence (if any) stays separate.";
  }
  return "No internal APP DL/UL unless a BabyDragon data engine result exists. OOKLA/FCC remain external evidence only.";
}

function buildRawRows(samples, sessionStartMs) {
  return (Array.isArray(samples) ? samples : []).map((sample, index) => {
    const paused = sample?.recordState === "paused";
    const snap = sample?.snapshot || {};
    const lte = paused ? {} : getLte(snap);
    const nr = paused ? {} : getNr(snap);
    const wcdma = paused ? {} : getWcdma(snap);
    const gsm = paused ? {} : getGsm(snap);
    const ts = getNumber(sample?.timestamp);
    const traffic = sample?.trafficStats || {};
    return {
      sample_index: index + 1,
      timestamp_ms: ts,
      timestamp_iso: toIso(ts),
      timestamp_local: toLocal(ts),
      elapsed_sec: durationSec(sessionStartMs, ts),
      record_state: paused ? "paused" : "active",
      mode: cleanText(sample?.mode || null),
      gps_lat: safeNum(sample?.gps?.lat, 7),
      gps_lon: safeNum(sample?.gps?.lng, 7),
      gps_accuracy_m: safeNum(sample?.gps?.accuracy ?? sample?.gps?.accuracy_m, 1),
      gps_speed_mps: safeNum(sample?.gps?.speed ?? sample?.gps?.speed_mps, 2),
      gps_status: cleanText(sample?.gps?.gps_status),
      gps_fix_age_ms: safeNum(sample?.gps?.gps_fix_age_ms, 0),
      location_fix_timestamp_iso: cleanText(sample?.gps?.location_fix_timestamp_iso),
      location_fix_timestamp_ms: safeNum(sample?.gps?.location_fix_timestamp_ms),
      gps_provider: cleanText(sample?.gps?.provider),
      gps_bearing_deg: safeNum(sample?.gps?.bearing_deg ?? sample?.gps?.heading, 1),
      gps_altitude_m: safeNum(sample?.gps?.altitude_m ?? sample?.gps?.altitude, 1),
      rat: paused ? null : cleanText(snap.currentRatName || snap.dataNetworkTypeName),
      technology_label: paused ? "paused_gps_only" : cleanText(snap.currentRatName || snap.dataNetworkTypeName),
      call_state: cleanText(snap.callState),
      lte_rsrp: safeNum(lte.rsrp ?? lte.dbm, 1),
      lte_rsrq: safeNum(lte.rsrq, 1),
      lte_sinr: safeNum(lte.sinr ?? lte.rssnr, 1),
      lte_pci: safeNum(lte.pci),
      lte_earfcn: safeNum(lte.earfcn ?? lte.channel),
      lte_cell_id: safeNum(lte.cellId ?? lte.ci),
      lte_tac: safeNum(lte.tac),
      lte_rssi: safeNum(lte.rssi ?? lte.dbm, 1),
      nr_ss_rsrp: safeNum(nr.ssRsrp ?? nr.rsrp, 1),
      nr_ss_rsrq: safeNum(nr.ssRsrq ?? nr.rsrq, 1),
      nr_ss_sinr: safeNum(nr.ssSinr ?? nr.sinr, 1),
      nr_pci: safeNum(nr.pci),
      nr_nrarfcn: safeNum(nr.nrarfcn ?? nr.channel),
      nr_nci: safeNum(nr.nci ?? nr.cellId),
      nr_tac: safeNum(nr.tac),
      nr_secondary_status: cleanText(snap.nrSecondaryStatus),
      wcdma_rscp: safeNum(wcdma.rscp ?? wcdma.dbm, 1),
      wcdma_ecno: safeNum(wcdma.ecno, 1),
      wcdma_psc: safeNum(wcdma.psc),
      wcdma_uarfcn: safeNum(wcdma.uarfcn ?? wcdma.channel),
      gsm_rxlev: safeNum(gsm.rxlev ?? gsm.rssi ?? gsm.dbm, 1),
      gsm_ber: safeNum(gsm.ber),
      gsm_bsic: safeNum(gsm.bsic),
      gsm_arfcn: safeNum(gsm.arfcn ?? gsm.channel),
      traffic_stats_supported: traffic.trafficStatsSupported === true ? "yes" : "no",
      traffic_stats_dl_mbps: safeNum(traffic.trafficStatsDlMbps, 2),
      traffic_stats_ul_mbps: safeNum(traffic.trafficStatsUlMbps, 2),
      traffic_stats_total_dl_mbps: safeNum(traffic.trafficStatsTotalDlMbps, 2),
      traffic_stats_total_ul_mbps: safeNum(traffic.trafficStatsTotalUlMbps, 2),
      traffic_stats_counter_reset: traffic.trafficStatsCounterReset === true || traffic.counterReset === true ? "yes" : "no",
      traffic_stats_note: paused ? "paused_gps_only" : cleanText(traffic.trafficStatsNote),
      band_note: "Band plot pending channel-to-band derivation.",
      pause_note: paused ? "GPS-only sample while recording paused" : null,
    };
  });
}

function attachEventMarkers(rawRows, events) {
  // Match events to nearest sample within 1.1s
  const timed = (events || []).filter((e) => getNumber(e.timestampMs) !== null);

  return rawRows.map((row) => {
    const markers = {
      rat_change_event: null,
      serving_cell_change_event: null,
      pci_change_event: null,
      channel_change_event: null,
      nr_secondary_event: null,
    };
    const near = timed.filter((evt) => {
      const delta = Math.abs((getNumber(evt.timestampMs) || 0) - (getNumber(row.timestamp_ms) || 0));
      return delta <= 1100;
    });
    near.forEach((evt) => {
      if (evt.eventType === "RAT_CHANGE") markers.rat_change_event = evt.label;
      if (evt.eventType === "SERVING_CELL_CHANGE") {
        markers.serving_cell_change_event = "Serving cell change / possible HO or reselection";
      }
      if (evt.eventType === "PCI_CHANGE") markers.pci_change_event = evt.label;
      if (evt.eventType === "CHANNEL_CHANGE") markers.channel_change_event = evt.label;
      if (evt.eventType === "NR_SECONDARY_EXPOSED" || evt.eventType === "NR_SECONDARY_LOST") {
        markers.nr_secondary_event = evt.label;
      }
    });
    return { ...row, ...markers };
  });
}

function buildThroughputSeries(session, samples, ooklaIterations, fccIterations, sessionStartMs) {
  const series = [];
  const scenario = resolveScenario(session);

  (Array.isArray(samples) ? samples : []).forEach((sample) => {
    const ts = getNumber(sample?.timestamp);
    if (ts === null) return;
    const traffic = sample?.trafficStats || {};
    if (traffic.trafficStatsSupported === true) {
      series.push({
        series_type: "android_trafficstats_mobile",
        label: "Android TrafficStats Mobile",
        timestamp_iso: toIso(ts),
        elapsed_sec: durationSec(sessionStartMs, ts),
        x_elapsed_sec: durationSec(sessionStartMs, ts),
        y_dl_mbps: safeNum(traffic.trafficStatsDlMbps, 2),
        y_ul_mbps: safeNum(traffic.trafficStatsUlMbps, 2),
        y_ping_ms: null,
        y_jitter_ms: null,
        iteration: null,
        test_id: null,
        notes: "Android mobile interface byte-delta context (see ReadMe).",
      });
      series.push({
        series_type: "android_trafficstats_total",
        label: "Android TrafficStats Total",
        timestamp_iso: toIso(ts),
        elapsed_sec: durationSec(sessionStartMs, ts),
        x_elapsed_sec: durationSec(sessionStartMs, ts),
        y_dl_mbps: safeNum(traffic.trafficStatsTotalDlMbps, 2),
        y_ul_mbps: safeNum(traffic.trafficStatsTotalUlMbps, 2),
        y_ping_ms: null,
        y_jitter_ms: null,
        iteration: null,
        test_id: null,
        notes: "Android total device byte-delta context (see ReadMe).",
      });
    }
  });

  const iterations = Array.isArray(session?.appIterationResults) ? session.appIterationResults : [];
  iterations.forEach((row) => {
    const start = getNumber(row?.startedAt);
    const end = getNumber(row?.endedAt);
    const engine = scenario === "iperf3" ? "iperf3_internal" : (scenario === "ftp" ? "ftp_internal" : "native_http_internal");
    if (start !== null) {
      series.push({
        series_type: engine,
        label: `${engine} iteration ${row.iteration || ""} start`,
        timestamp_iso: toIso(start),
        elapsed_sec: durationSec(sessionStartMs, start),
        x_elapsed_sec: durationSec(sessionStartMs, start),
        y_dl_mbps: null,
        y_ul_mbps: null,
        y_ping_ms: null,
        y_jitter_ms: null,
        iteration: row.iteration ?? null,
        test_id: null,
        notes: "BabyDragon internal data engine marker",
      });
    }
    if (Array.isArray(row.intervalSamples) && row.intervalSamples.length) {
      const ordered = [...row.intervalSamples].sort((a, b) => {
        const ia = getNumber(a?.index ?? a?.intervalIndex) ?? 0;
        const ib = getNumber(b?.index ?? b?.intervalIndex) ?? 0;
        if (ia !== ib) return ia - ib;
        const sa = getNumber(a?.start) ?? 0;
        const sb = getNumber(b?.start) ?? 0;
        return sa - sb;
      });
      ordered.forEach((sample) => {
        const intervalIndex = sample.index ?? sample.intervalIndex ?? null;
        const startSec = getNumber(sample.start);
        const endSec = getNumber(sample.end);
        const durationSecVal = (startSec != null && endSec != null && endSec >= startSec)
          ? Number((endSec - startSec).toFixed(3))
          : getNumber(sample.seconds ?? sample.durationSec);
        const absStart = start !== null && startSec != null ? start + startSec * 1000 : null;
        const absEnd = start !== null && endSec != null ? start + endSec * 1000 : null;
        const pointMs = absEnd ?? absStart ?? end;
        const dl = safeNum(sample.dlMbps, 3);
        const ul = safeNum(sample.ulMbps, 3);
        const dlBytes = safeNum(sample.dlBytes ?? sample.bytesDl ?? null, 0);
        const ulBytes = safeNum(sample.ulBytes ?? sample.bytesUl ?? null, 0);
        const sumBytes = safeNum(sample.bytes ?? sample.sumBytes, 0);
        const pushInterval = (direction, mbps, bytes) => {
          series.push({
            series_type: "iperf3_interval",
            label: "iPerf3 interval throughput",
            timestamp_iso: toIso(pointMs),
            elapsed_sec: durationSec(sessionStartMs, pointMs),
            x_elapsed_sec: durationSec(sessionStartMs, pointMs),
            y_dl_mbps: direction === "DL" ? mbps : (direction === "DL+UL" ? dl : null),
            y_ul_mbps: direction === "UL" ? mbps : (direction === "DL+UL" ? ul : null),
            y_ping_ms: null,
            y_jitter_ms: null,
            iteration: row.iteration ?? null,
            interval_index: intervalIndex,
            interval: intervalIndex,
            interval_start_iso: toIso(absStart),
            interval_end_iso: toIso(absEnd),
            interval_start_sec: startSec,
            interval_end_sec: endSec,
            seconds: durationSecVal,
            bytes: bytes ?? sumBytes,
            dl_bytes: dlBytes,
            ul_bytes: ulBytes,
            direction,
            status: "measured",
            test_id: intervalIndex,
            notes: absStart != null && absEnd != null
              ? "iPerf3 interval sample (absolute from test start + interval offsets)"
              : "iPerf3 interval sample (relative timing)",
          });
        };
        if (dl != null && ul != null) {
          // Preserve both directions — never collapse into one Mbps.
          pushInterval("DL", dl, dlBytes ?? sumBytes);
          pushInterval("UL", ul, ulBytes ?? sumBytes);
        } else if (dl != null) {
          pushInterval("DL", dl, dlBytes ?? sumBytes);
        } else if (ul != null) {
          pushInterval("UL", ul, ulBytes ?? sumBytes);
        } else {
          pushInterval(cleanText(row.direction) || "", null, sumBytes);
        }
      });
    } else if (end !== null || start !== null) {
      const pointMs = end ?? start;
      series.push({
        series_type: engine,
        label: `${engine} result point`,
        timestamp_iso: toIso(pointMs),
        elapsed_sec: durationSec(sessionStartMs, pointMs),
        x_elapsed_sec: durationSec(sessionStartMs, pointMs),
        y_dl_mbps: safeNum(row.dlMbps, 3),
        y_ul_mbps: safeNum(row.ulMbps, 3),
        y_ping_ms: null,
        y_jitter_ms: null,
        iteration: row.iteration ?? null,
        test_id: null,
        notes: "Iteration result point (no dense interval series)",
      });
    }
  });

  (ooklaIterations || []).forEach((item, index) => {
    const resultMs = (() => {
      const parsed = Date.parse(String(item?.ooklaDateTime || item?.testDateTime || item?.capturedAt || item?.savedAt || ""));
      return Number.isNaN(parsed) ? null : parsed;
    })();
    series.push({
      series_type: "ookla_external_evidence",
      label: "OOKLA external evidence",
      timestamp_iso: toIso(resultMs),
      elapsed_sec: durationSec(sessionStartMs, resultMs),
      x_elapsed_sec: durationSec(sessionStartMs, resultMs),
      y_dl_mbps: safeNum(item.dlMbps, 3),
      y_ul_mbps: safeNum(item.ulMbps, 3),
      y_ping_ms: safeNum(item.pingMs, 2),
      y_jitter_ms: safeNum(item.jitterMs, 2),
      iteration: item.iterationNumber ?? index + 1,
      test_id: cleanText(item.resultId || item.ooklaResultId),
      notes: "External evidence only. Do not invent OOKLA start/end. APP DL/UL stays N/A.",
    });
  });

  (fccIterations || []).forEach((item, index) => {
    const start = getNumber(item?.testStartMs);
    const end = getNumber(item?.testEndMs);
    const result = getNumber(item?.fccTestAtMs) ?? (() => {
      const parsed = Date.parse(String(item?.fccTestAt || ""));
      return Number.isNaN(parsed) ? null : parsed;
    })();
    if (start !== null) {
      series.push({
        series_type: "fcc_external_evidence",
        label: "FCC external evidence start",
        timestamp_iso: toIso(start),
        elapsed_sec: durationSec(sessionStartMs, start),
        x_elapsed_sec: durationSec(sessionStartMs, start),
        y_dl_mbps: null,
        y_ul_mbps: null,
        y_ping_ms: null,
        y_jitter_ms: null,
        iteration: item.iterationNumber ?? index + 1,
        test_id: cleanText(item.fccTestId),
        notes: "FCC testStartMs from export",
      });
    }
    series.push({
      series_type: "fcc_external_evidence",
      label: "FCC external evidence result",
      timestamp_iso: toIso(result ?? end ?? start),
      elapsed_sec: durationSec(sessionStartMs, result ?? end ?? start),
      x_elapsed_sec: durationSec(sessionStartMs, result ?? end ?? start),
      y_dl_mbps: safeNum(item.fccDlMbps, 3),
      y_ul_mbps: safeNum(item.fccUlMbps, 3),
      y_ping_ms: safeNum(item.fccPingMs, 2),
      y_jitter_ms: safeNum(item.fccJitterMs, 2),
      iteration: item.iterationNumber ?? index + 1,
      test_id: cleanText(item.fccTestId),
      notes: "External evidence only. APP DL/UL stays N/A.",
    });
    if (end !== null) {
      series.push({
        series_type: "fcc_external_evidence",
        label: "FCC external evidence end",
        timestamp_iso: toIso(end),
        elapsed_sec: durationSec(sessionStartMs, end),
        x_elapsed_sec: durationSec(sessionStartMs, end),
        y_dl_mbps: null,
        y_ul_mbps: null,
        y_ping_ms: null,
        y_jitter_ms: null,
        iteration: item.iterationNumber ?? index + 1,
        test_id: cleanText(item.fccTestId),
        notes: "FCC testEndMs from export",
      });
    }
  });

  return series.sort((a, b) => (getNumber(a.elapsed_sec) ?? 0) - (getNumber(b.elapsed_sec) ?? 0));
}

function buildExternalEvidenceRows(ooklaIterations, fccIterations) {
  const rows = [];
  (ooklaIterations || []).forEach((item, index) => {
    const matched = item.matchedContext || {};
    rows.push({
      source_type: "OOKLA",
      evidence_source: cleanText(item.evidenceSource || item.source) || "ookla_external",
      iteration_or_test_id: cleanText(item.iterationNumber) || String(index + 1),
      result_id: cleanText(item.resultId || item.ooklaResultId),
      result_url: cleanText(item.resultUrl || item.ooklaResultUrl),
      result_timestamp: cleanText(item.ooklaDateTime || item.testDateTime || item.capturedAt),
      start_timestamp: null,
      end_timestamp: null,
      dl_mbps: safeNum(item.dlMbps, 3),
      ul_mbps: safeNum(item.ulMbps, 3),
      ping_ms: safeNum(item.pingMs, 2),
      jitter_ms: safeNum(item.jitterMs, 2),
      loss_pct: safeNum(item.packetLossPct ?? item.lossPct, 2),
      server: cleanText(item.serverName || item.server),
      provider: cleanText(item.providerName || item.isp || item.provider),
      connection_type: cleanText(item.connectionType),
      matched_rf_status: cleanText(matched.matchedRfStatus),
      matched_rf_time_delta_sec: safeNum(matched.matchedRfTimeDeltaSec, 3),
      matched_gps_lat: safeNum(matched.bdGpsLatitude, 7),
      matched_gps_lon: safeNum(matched.bdGpsLongitude, 7),
      matched_traffic_dl_mbps: safeNum(matched.bdTrafficStatsDlMbps, 2),
      matched_traffic_ul_mbps: safeNum(matched.bdTrafficStatsUlMbps, 2),
      inside_babydragon_window: cleanText(item.insideBabyDragonTimeWindow),
      completeness_status: cleanText(item.evidenceCompleteness || item.confirmation || item.status),
      notes: "External evidence only. APP DL/UL remains N/A.",
    });
  });
  (fccIterations || []).forEach((item, index) => {
    const matched = item.matchedContext || {};
    rows.push({
      source_type: "FCC",
      evidence_source: cleanText(item.evidenceSource) || "fcc_export_zip_csv",
      iteration_or_test_id: cleanText(item.fccTestId) || String(item.iterationNumber || index + 1),
      result_id: cleanText(item.fccTestId),
      result_url: null,
      result_timestamp: cleanText(item.fccTestAt),
      start_timestamp: toIso(item.testStartMs),
      end_timestamp: toIso(item.testEndMs),
      dl_mbps: safeNum(item.fccDlMbps, 3),
      ul_mbps: safeNum(item.fccUlMbps, 3),
      ping_ms: safeNum(item.fccPingMs, 2),
      jitter_ms: safeNum(item.fccJitterMs, 2),
      loss_pct: safeNum(item.fccLossPct, 2),
      server: cleanText(item.fccServerName),
      provider: cleanText(item.fccCarrier),
      connection_type: cleanText(item.fccConnectionType),
      matched_rf_status: cleanText(matched.matchedRfStatus),
      matched_rf_time_delta_sec: safeNum(matched.matchedRfTimeDeltaSec, 3),
      matched_gps_lat: safeNum(matched.bdGpsLatitude, 7),
      matched_gps_lon: safeNum(matched.bdGpsLongitude, 7),
      matched_traffic_dl_mbps: safeNum(matched.bdTrafficStatsDlMbps, 2),
      matched_traffic_ul_mbps: safeNum(matched.bdTrafficStatsUlMbps, 2),
      inside_babydragon_window: cleanText(item.insideBabyDragonTimeWindow),
      completeness_status: cleanText(item.confirmation || item.status),
      notes: "External evidence only. APP DL/UL remains N/A.",
    });
  });
  return rows;
}

function resolveConnectivitySnapshot(session = {}, samples = []) {
  const snap = session.connectivitySnapshot && typeof session.connectivitySnapshot === "object"
    ? session.connectivitySnapshot
    : null;
  if (snap) return snap;
  for (let i = samples.length - 1; i >= 0; i -= 1) {
    const sampleSnap = samples[i]?.snapshot?.connectivity;
    if (sampleSnap && typeof sampleSnap === "object") return sampleSnap;
  }
  return null;
}

function buildIndexRows(distance = {}, techFlags = {}, sheetFlags = {}, createdSheets = null) {
  const miles = distance.distance_covered_miles;
  const milesNote = miles != null
    ? `Distance covered: ${miles} mi`
    : "Distance covered: pending GPS trail";
  const activeTechs = [
    techFlags.hasLte ? "LTE" : null,
    techFlags.hasNr ? "NR" : null,
    techFlags.hasWcdma ? "WCDMA" : null,
    techFlags.hasGsm ? "GSM" : null,
  ].filter(Boolean);
  const allRows = [
    {
      sheet_name: "01_Test_Grid_Info",
      purpose: "Project, session, network, and report summary",
    },
    {
      sheet_name: "02_Index",
      purpose: "Workbook navigation",
    },
    {
      sheet_name: "03_KPI_Summary",
      purpose: "Average / minimum / maximum for valid numeric KPIs; identifier summary (not averaged)",
    },
    {
      sheet_name: "04_RF_Plot_Data",
      purpose: "Time-aligned RF series for active technologies",
    },
    {
      sheet_name: "05_RF_Raw_Data",
      purpose: "Per-sample RF / GPS / TrafficStats source table",
    },
    {
      sheet_name: "06_Data_Throughput",
      purpose: "Internal engine, TrafficStats, and external evidence throughput series",
    },
    {
      sheet_name: "07_Data_Events",
      purpose: "Session / data / RF event source-of-truth table",
    },
  ];
  if (sheetFlags.hasVoice) {
    allRows.push({
      sheet_name: "08_Voice_Events",
      purpose: "Meaningful voice / call-state transitions",
    });
  }
  if (sheetFlags.hasExternalEvidence) {
    allRows.push({
      sheet_name: "09_External_Evidence",
      purpose: "Saved OOKLA / FCC external evidence rows",
    });
  }
  if (sheetFlags.hasRfMaps) {
    allRows.push({
      sheet_name: "11_RF_Map_Plots",
      purpose: `RF KPI route maps (${activeTechs.join(", ") || "active techs"}) — Start/End only`,
    });
  }
  if (sheetFlags.hasDataMaps) {
    allRows.push({
      sheet_name: "12_Data_Map_Plots",
      purpose: "Data throughput route maps — Start/End only",
    });
  }
  if (sheetFlags.hasEventPlots) {
    allRows.push({
      sheet_name: "13_Event_Graphs",
      purpose: "Consolidated Start/End timelines and optional radio/voice/failure graphs",
    });
  }
  if (sheetFlags.hasEventMaps) {
    allRows.push({
      sheet_name: "14_Event_Map_Plots",
      purpose: "One GPS-matched map per meaningful radio-event type that occurred, plus Start/End/Voice when present",
    });
  }
  allRows.push({
    sheet_name: "15_ReadMe",
    purpose: "Concise truth rules for interpreting this report",
  });
  const created = createdSheets ? new Set(createdSheets) : null;
  const rows = created
    ? allRows.filter((r) => created.has(r.sheet_name))
    : allRows;
  rows.forEach((r) => {
    r.notes = milesNote;
  });
  return rows;
}

function buildReadMeRows() {
  return [
    { topic: "Internal vs external throughput", rule: "APP DL/UL is BabyDragon engine throughput (Native HTTP / FTP / iPerf3). OOKLA and FCC values are external evidence only and never fill APP DL/UL." },
    { topic: "TrafficStats", rule: "TrafficStats Mobile = Android mobile interface byte-delta context. TrafficStats Total = device total and may include Wi-Fi/offload. Neither is official OOKLA/FCC throughput." },
    { topic: "Event confidence", rule: "Serving-cell / PCI / channel changes are inferred unless Android exposes a confirmed handover. Native HTTP success uses recorded status/error only." },
    { topic: "Serving-cell wording", rule: "Label: Serving cell change / possible handover or reselection. BabyDragon does not claim QXDM-level confirmed handover without a directly exposed Android event." },
    { topic: "Distance", rule: "Customer Driven Distance uses filtered route segments (shared map segmentation). Stationary / limited route spread sessions report Driven Distance = 0 and expose GPS Positional Variation separately. Raw GPS coordinates are never altered." },
    { topic: "Map provider", rule: "RF/Data maps show the successful tile provider (Esri, Carto, or OSM) or an honest coordinate-only fallback. Events are not overlaid on RF/Data maps." },
    { topic: "Event graphs", rule: "Sheet 13_Event_Graphs shows consolidated Start/End timelines, Native HTTP iteration results, and optional radio/voice/failure graphs when meaningful. Ordinary audit bookkeeping stays on 07_Data_Events." },
    { topic: "Event maps", rule: "One separate graph/map per meaningful radio-event type that occurred. Empty event types are omitted. Events without valid GPS remain in Data Events or graphs only." },
    { topic: "Colors", rule: "Map and graph colors use the active BabyDragon KPI display profile captured at report export. Thresholds and HEX colors match the in-app legends." },
    { topic: "Graphs vs maps", rule: "KPI graphs show values over elapsed time or by iteration. KPI map plots show values over the geographic route. Data maps use a neutral driven-route trail plus measured result markers — KPI color is never interpolated across unmeasured gaps." },
    { topic: "Route segmentation", rule: "Rendered route lines connect consecutive GPS samples only when chronological, freshness, accuracy, time-gap, and speed checks pass. Rejected connections keep raw rows and begin a new segment — no interpolation. Outlier jumps > 2.5 km are rejected." },
    { topic: "Missing values", rule: "Source null/unavailable becomes a true blank Excel cell (never an empty shared-string that can be misread as a numeric SST index). N/A / Unknown / Not exposed are used only where those semantics apply. Legitimate measured zero is retained." },
    { topic: "TrafficStats movement", rule: "Report notes reflect actual measured Mobile vs Total counter movement, not API availability. Inactive Mobile maps are omitted when Mobile never moved; Total maps remain when Total moved. Raw CSV/JSON always retain Mobile columns." },
    { topic: "Continuous mode", rule: "Continuous runs have no customer Requested/Remaining total. Attempted/Completed/Failed are actual counts only. Fixed mode keeps Requested/Remaining." },
    { topic: "Report version", rule: `Excel Plot Report ${EXCEL_PLOT_REPORT_VERSION}.` },
    { topic: "Identifiers", rule: "PCI, EARFCN, NRARFCN, Cell ID, and similar identifiers are never averaged — see Identifier Summary on sheet 03." },
    { topic: "Package contracts", rule: "OOKLA and FCC original 3-file export packages are unchanged. This Excel file is a parallel optional export." },
    { topic: "Sample cap", rule: SAMPLE_CAP_NOTE },
  ];
}

function isMeaningfulVoiceSession(scenario, voiceEvents = []) {
  if (scenario === "voice") return true;
  return (voiceEvents || []).some((e) => {
    const t = String(e.eventType || "").toUpperCase();
    const src = String(e.source || "").toLowerCase();
    if (src.includes("fe_manual")) return true;
    return t.includes("RING") || t.includes("OFFHOOK") || t.includes("DROP")
      || t.includes("FAIL") || t.includes("ESTABLISH") || t.includes("ATTEMPT")
      || t.includes("BLOCK");
  });
}

function buildCustomerInfoRows({
  session = {},
  user = {},
  taskHelpers = {},
  scenario = "",
  sessionStartMs = null,
  sessionEndMs = null,
  pausedDurationMs = 0,
  distance = {},
  samples = [],
  techFlags = {},
  lastRat = null,
  dataTestOutcome = null,
  basemapMeta = null,
  paletteSnapshot = null,
} = {}) {
  const outcome = dataTestOutcome || buildDataTestOutcome(session);
  const displayScenario = formatCustomerScenario(session, scenario);
  const activeTechs = [
    techFlags.hasLte && "LTE",
    techFlags.hasNr && "NR",
    techFlags.hasWcdma && "WCDMA",
    techFlags.hasGsm && "GSM",
  ].filter(Boolean).join(", ") || "none";
  const connectivity = resolveConnectivitySnapshot(session, samples) || {};
  const gpsQuality = summarizeGpsQuality(samples);
  const routeStatus = distance?.route_status || distance?.route_classification || gpsQuality?.route_status || "";

  return {
    projectRows: [
      { label: "Report Name", value: cleanText(session.reportLogName) || cleanText(session.id) },
      { label: "Task", value: cleanText(session.taskLabel) || cleanText(taskHelpers.getTaskLabel?.(taskHelpers.activeTask)) || "Active field task" },
      { label: "Grid", value: cleanText(session.grid) || cleanText(taskHelpers.getTaskGrid?.(taskHelpers.activeTask)) || "Grid pending" },
      { label: "Field Engineer", value: cleanText(user?.email) },
    ],
    sessionRows: [
      { label: "Scenario", value: displayScenario },
      { label: "Start", value: toLocal(sessionStartMs) },
      { label: "End", value: toLocal(sessionEndMs) },
      { label: "Duration (sec)", value: durationSec(sessionStartMs, sessionEndMs) },
      { label: "Pause duration (sec)", value: pausedDurationMs ? Number((pausedDurationMs / 1000).toFixed(3)) : 0 },
      { label: "Distance covered (mi)", value: distance.distance_covered_miles },
      { label: "Driven Distance (mi)", value: distance.distance_covered_miles },
      { label: "GPS Positional Variation (m)", value: distance.gps_positional_variation_m ?? distance?.diagnostics?.gps_positional_variation_m ?? "" },
      { label: "RF sample count", value: samples.length },
      { label: "GPS fixes recorded", value: gpsQuality?.gps_fixes_recorded ?? "" },
      { label: "Fresh GPS fixes", value: gpsQuality?.fresh_gps_fixes ?? "" },
      { label: "Stale GPS samples", value: gpsQuality?.stale_gps_samples ?? "" },
      { label: "GPS lost events", value: gpsQuality?.gps_lost_events ?? "" },
      { label: "GPS restored events", value: gpsQuality?.gps_restored_events ?? "" },
      { label: "Unique GPS points", value: gpsQuality?.unique_gps_points ?? "" },
      { label: "Eligible route points", value: distance?.diagnostics?.eligible_route_point_count ?? "" },
      { label: "Filtered distance (m)", value: distance?.diagnostics?.filtered_distance_m ?? distance.distance_covered_m },
      { label: "Rejected route connections", value: distance?.diagnostics?.rejected_connection_count ?? "" },
      { label: "Route status", value: routeStatus },
      { label: "GPS route note", value: gpsQuality?.route_incomplete_message || "" },
    ],
    testOutcomeRows: (() => {
      const engineId = cleanText(session.appEngineId) || cleanText(session.engineId) || "";
      const isExternal = scenario === "ookla_app" || scenario === "fcc_app"
        || String(engineId).includes("ookla") || String(engineId).includes("fcc");
      const isRfOnly = scenario === "rf_data" || String(engineId).includes("rf_only");
      if (isExternal) {
        const ooklaCount = Array.isArray(session.appOoklaEvidenceIterations) ? session.appOoklaEvidenceIterations.length : 0;
        const fccCount = Array.isArray(session.appFccEvidenceIterations) ? session.appFccEvidenceIterations.length : 0;
        return [
          { label: "Test type", value: scenario === "ookla_app" ? "OOKLA External Evidence" : "FCC External Evidence" },
          { label: "Mode", value: "External Evidence" },
          { label: "Status", value: outcome.status },
          { label: "Evidence result count", value: scenario === "ookla_app" ? ooklaCount : fccCount },
          { label: "APP DL/UL available", value: "no" },
          { label: "Note", value: "Controlled-engine attempted/completed fields omitted for external evidence." },
        ];
      }
      if (isRfOnly) {
        return [
          { label: "Test type", value: "RF Only" },
          { label: "Mode", value: "RF / Session" },
          { label: "Status", value: outcome.status || "rf_only" },
          { label: "Note", value: "No controlled data-test iterations attempted." },
        ];
      }
      return [
        { label: "Test type", value: outcome.testType },
        { label: "Engine ID", value: engineId || outcome.engineKey || "" },
        { label: "Mode", value: cleanText(session.appRunModeLabel) || cleanText(session.appRunMode) || cleanText(session.appSetupSnapshot?.runMode) || "" },
        { label: "Status", value: outcome.status },
        { label: "Normalized status", value: outcome.normalizedStatus },
        {
          label: "Requested iterations",
          value: (String(session.appRunMode || "").toLowerCase() === "continuous"
            || outcome.normalizedStatus === "continuous_complete"
            || outcome.requestedIterations == null)
            ? "—"
            : outcome.requestedIterations,
        },
        { label: "Attempted", value: outcome.attemptedIterations },
        { label: "Completed", value: outcome.completedIterations },
        { label: "Failed", value: outcome.failedIterations },
        {
          label: "Remaining",
          value: (String(session.appRunMode || "").toLowerCase() === "continuous"
            || outcome.normalizedStatus === "continuous_complete"
            || outcome.remainingIterations == null)
            ? "—"
            : outcome.remainingIterations,
        },
        { label: "APP DL/UL available", value: outcome.appDlUlAvailable ? "yes" : "no" },
        { label: "Averages basis", value: outcome.averagesBasedOnCompletedOnly ? "Completed iterations only" : "" },
        { label: "End reason", value: outcome.endReason || "" },
        { label: "Error", value: outcome.errorMessage || "" },
        { label: "Failure reason", value: outcome.conciseReason || "" },
      ];
    })(),
    networkRows: [
      { label: "Active technologies", value: activeTechs },
      { label: "Last observed RAT", value: lastRat },
      { label: "Wi-Fi connected", value: connectivity.wifiConnected != null ? (connectivity.wifiConnected ? "yes" : "no") : "" },
      { label: "Mobile data active", value: connectivity.mobileDataActive != null ? (connectivity.mobileDataActive ? "yes" : "no") : "" },
      { label: "Default transport", value: cleanText(connectivity.defaultNetworkTransport) || cleanText(connectivity.transport) || "" },
      { label: "Internet validated", value: connectivity.internetValidated != null ? (connectivity.internetValidated ? "yes" : "no") : "" },
    ],
    reportRows: [
      {
        label: "Map provider",
        value: basemapMeta?.map_background_provider
          ? String(basemapMeta.map_background_provider).replace(/World Street Map \(Esri\)/i, "Esri").slice(0, 48)
          : "See map sheets",
      },
      {
        label: "Color note",
        value: paletteSnapshot?.note || "Map and graph colors use the active BabyDragon KPI display profile captured at report export.",
      },
    ],
    technicalRows: [
      { label: "Report version", value: EXCEL_PLOT_REPORT_VERSION },
      { label: "Start (ISO)", value: toIso(sessionStartMs) },
      { label: "End (ISO)", value: toIso(sessionEndMs) },
      { label: "Distance covered (km)", value: distance.distance_covered_km },
      { label: "GPS sample count", value: getNumber(session.gpsCount) ?? samples.filter((s) => s?.gps?.lat != null && s?.gps?.lng != null).length },
      { label: "Owner", value: "MobbiTech Global LLC" },
      { label: "Map attribution", value: basemapMeta?.map_attribution || "" },
      { label: "Provider attempts (technical)", value: basemapMeta?.map_provider_attempts || "" },
    ],
  };
}

function rowHasGps(row) {
  const lat = getNumber(row?.gps_lat);
  const lng = getNumber(row?.gps_lon);
  return lat !== null && lng !== null && !(lat === 0 && lng === 0);
}

/** Map route extension uses fresh/restored GPS only. Stale/lost keep audit rows but do not draw. */
function rowHasFreshGpsForMap(row) {
  if (!rowHasGps(row)) return false;
  const status = String(row?.gps_status || "").toLowerCase();
  if (!status) {
    // Legacy rows without status: allow once; suspicious-static detection still flags one-timestamp routes.
    return true;
  }
  return status === "fresh" || status === "restored";
}

function buildEventMarkersFromEvents(events = []) {
  return (events || [])
    .filter((evt) => evt?.mapGpsMatched === true && evt.mapLat != null && evt.mapLon != null)
    .filter((evt) => {
      const type = String(evt.eventType || "");
      return type.includes("CHANGE")
        || type.includes("SERVING")
        || type.includes("PCI")
        || type.includes("CHANNEL")
        || type.includes("RAT")
        || type.includes("NR_SECONDARY")
        || type.includes("NATIVE_HTTP")
        || type.includes("FTP_")
        || type.includes("IPERF");
    })
    .map((evt) => ({
      lat: evt.mapLat,
      lng: evt.mapLon,
      label: evt.label,
      eventType: (() => {
        const t = String(evt.eventType || "");
        if (t.includes("SERVING_CELL")) return "SERVING_CELL_CHANGE";
        if (t.includes("PCI")) return "PCI_CHANGE";
        if (t.includes("CHANNEL")) return "CHANNEL_CHANGE";
        if (t.includes("RAT")) return "RAT_CHANGE";
        if (t.includes("NR_SECONDARY")) return "NR_SECONDARY";
        return "DEFAULT";
      })(),
    }));
}

function pointsForMetric(rows, valueFn) {
  return buildSegmentableRoutePointsFromRows(rows, { valueFn });
}

function pointsForCategory(rows, valueFn) {
  return buildSegmentableRoutePointsFromRows(rows, { valueFn });
}

function buildNeutralContextTrail(rows = []) {
  return buildSegmentableRoutePointsFromRows(rows, {
    value: null,
    freshOnly: true,
  });
}

function pointGeoMeta(row = {}, index = 0) {
  return attachRoutePointMeta(row, index);
}

/**
 * Build map-plot specs for RF + Data sheets (rendered later to PNG).
 * LTE, NR, WCDMA, and GSM are separate. Inactive technologies produce no plots/notes.
 */
export function buildMapPlotSpecs({
  plotRows = [],
  throughputRows = [],
  scenario = "",
  distance = {},
  session = {},
  dataTestOutcome = null,
} = {}) {
  const rows = Array.isArray(plotRows) ? plotRows.filter(rowHasFreshGpsForMap) : [];
  const milesLabel = distance.distance_covered_miles != null
    ? `${distance.distance_covered_miles} mi`
    : "n/a";
  const routeStatus = distance?.route_status || distance?.route_classification || "";
  const routeNote = distance?.route_incomplete_message
    || (plotRows.filter(rowHasGps).length >= 50 && rows.length <= 1
      ? "GPS route incomplete — location updates became stale"
      : "");
  const subtitleBase = `Distance covered: ${milesLabel}  |  Scenario: ${scenario || "rf_data"}${routeStatus ? `  |  ${routeStatus}` : ""}${routeNote ? `  |  ${routeNote}` : ""}`;
  const sharedStationary = distance?.stationary === true
    || routeStatus === "Stationary / limited route spread";

  const hasLte = rows.some((r) => getNumber(r.lte_rsrp) !== null || getNumber(r.lte_rsrq) !== null
    || getNumber(r.lte_sinr) !== null || getNumber(r.lte_pci) !== null);
  const hasNr = rows.some((r) => getNumber(r.nr_ss_rsrp) !== null || getNumber(r.nr_ss_rsrq) !== null
    || getNumber(r.nr_ss_sinr) !== null || getNumber(r.nr_pci) !== null);
  const hasWcdma = rows.some((r) => getNumber(r.wcdma_rscp) !== null || getNumber(r.wcdma_ecno) !== null
    || getNumber(r.wcdma_psc) !== null);
  const hasGsm = rows.some((r) => getNumber(r.gsm_rxlev) !== null || getNumber(r.gsm_bsic) !== null);

  const rfPlots = [];

  // ---- LTE (separate; omit entirely when inactive) ----
  if (hasLte) {
    rfPlots.push({
      id: "lte_rsrp",
      sheet: "rf",
      tech: "LTE",
      title: "LTE RSRP Over Route",
      subtitle: `${subtitleBase}  |  LTE only`,
      unitLabel: "RSRP (dBm)",
      mode: "bins",
      bins: RSRP_BINS,
      points: pointsForMetric(rows, (r) => getNumber(r.lte_rsrp)),
      connectMode: "segments",
    });
    rfPlots.push({
      id: "lte_rsrq",
      sheet: "rf",
      tech: "LTE",
      title: "LTE RSRQ Over Route",
      subtitle: `${subtitleBase}  |  LTE only`,
      unitLabel: "RSRQ (dB)",
      mode: "bins",
      bins: RSRQ_BINS,
      points: pointsForMetric(rows, (r) => getNumber(r.lte_rsrq)),
    });
    rfPlots.push({
      id: "lte_sinr",
      sheet: "rf",
      tech: "LTE",
      title: "LTE SINR Over Route",
      subtitle: `${subtitleBase}  |  LTE only`,
      unitLabel: "SINR (dB)",
      mode: "bins",
      bins: SINR_BINS,
      points: pointsForMetric(rows, (r) => getNumber(r.lte_sinr)),
    });
    if (rows.some((r) => getNumber(r.lte_rssi) !== null)) {
      rfPlots.push({
        id: "lte_rssi",
        sheet: "rf",
        tech: "LTE",
        title: "LTE RSSI Over Route",
        subtitle: `${subtitleBase}  |  LTE only`,
        unitLabel: "RSSI (dBm)",
        mode: "bins",
        bins: RSRP_BINS,
        points: pointsForMetric(rows, (r) => getNumber(r.lte_rssi)),
      });
    }
    rfPlots.push({
      id: "lte_pci",
      sheet: "rf",
      tech: "LTE",
      title: "LTE PCI / Serving Cell Over Route",
      subtitle: `${subtitleBase}  |  LTE PCI`,
      unitLabel: "PCI",
      mode: "category",
      categoryLabel: "PCI",
      points: pointsForCategory(rows, (r) => getNumber(r.lte_pci)),
    });
    if (rows.some((r) => getNumber(r.lte_earfcn) !== null)) {
      rfPlots.push({
        id: "lte_earfcn",
        sheet: "rf",
        tech: "LTE",
        title: "LTE EARFCN / Channel Over Route",
        subtitle: `${subtitleBase}  |  LTE channel (EARFCN)`,
        unitLabel: "EARFCN",
        mode: "category",
        categoryLabel: "EARFCN",
        points: pointsForCategory(rows, (r) => getNumber(r.lte_earfcn)),
      });
    }
    if (rows.some((r) => getNumber(r.lte_cell_id) !== null)) {
      rfPlots.push({
        id: "lte_cell_id",
        sheet: "rf",
        tech: "LTE",
        title: "LTE Cell ID Over Route",
        subtitle: `${subtitleBase}  |  LTE Cell ID`,
        unitLabel: "Cell ID",
        mode: "category",
        categoryLabel: "Cell ID",
        points: pointsForCategory(rows, (r) => getNumber(r.lte_cell_id)),
      });
    }
    if (rows.some((r) => getNumber(r.lte_tac) !== null)) {
      rfPlots.push({
        id: "lte_tac",
        sheet: "rf",
        tech: "LTE",
        title: "LTE TAC Over Route",
        subtitle: `${subtitleBase}  |  LTE TAC`,
        unitLabel: "TAC",
        mode: "category",
        categoryLabel: "TAC",
        points: pointsForCategory(rows, (r) => getNumber(r.lte_tac)),
      });
    }
  }

  // ---- NR (separate; omit entirely when inactive) ----
  if (hasNr) {
    rfPlots.push({
      id: "nr_ss_rsrp",
      sheet: "rf",
      tech: "NR",
      title: "NR SS-RSRP Over Route",
      subtitle: `${subtitleBase}  |  NR only (when Android exposes NR secondary fields)`,
      unitLabel: "SS-RSRP (dBm)",
      mode: "bins",
      bins: RSRP_BINS,
      points: pointsForMetric(rows, (r) => getNumber(r.nr_ss_rsrp)),
    });
    rfPlots.push({
      id: "nr_ss_rsrq",
      sheet: "rf",
      tech: "NR",
      title: "NR SS-RSRQ Over Route",
      subtitle: `${subtitleBase}  |  NR only`,
      unitLabel: "SS-RSRQ (dB)",
      mode: "bins",
      bins: RSRQ_BINS,
      points: pointsForMetric(rows, (r) => getNumber(r.nr_ss_rsrq)),
    });
    rfPlots.push({
      id: "nr_ss_sinr",
      sheet: "rf",
      tech: "NR",
      title: "NR SS-SINR Over Route",
      subtitle: `${subtitleBase}  |  NR only`,
      unitLabel: "SS-SINR (dB)",
      mode: "bins",
      bins: SINR_BINS,
      points: pointsForMetric(rows, (r) => getNumber(r.nr_ss_sinr)),
    });
    rfPlots.push({
      id: "nr_pci",
      sheet: "rf",
      tech: "NR",
      title: "NR PCI / Serving Cell Over Route",
      subtitle: `${subtitleBase}  |  NR PCI`,
      unitLabel: "NR PCI",
      mode: "category",
      categoryLabel: "PCI",
      points: pointsForCategory(rows, (r) => getNumber(r.nr_pci)),
    });
    if (rows.some((r) => getNumber(r.nr_nrarfcn) !== null)) {
      rfPlots.push({
        id: "nr_nrarfcn",
        sheet: "rf",
        tech: "NR",
        title: "NR NRARFCN / Channel Over Route",
        subtitle: `${subtitleBase}  |  NR channel (NRARFCN)`,
        unitLabel: "NRARFCN",
        mode: "category",
        categoryLabel: "NRARFCN",
        points: pointsForCategory(rows, (r) => getNumber(r.nr_nrarfcn)),
      });
    }
    if (rows.some((r) => getNumber(r.nr_nci) !== null)) {
      rfPlots.push({
        id: "nr_nci",
        sheet: "rf",
        tech: "NR",
        title: "NR NCI Over Route",
        subtitle: `${subtitleBase}  |  NR NCI`,
        unitLabel: "NCI",
        mode: "category",
        categoryLabel: "NCI",
        points: pointsForCategory(rows, (r) => getNumber(r.nr_nci)),
      });
    }
    if (rows.some((r) => getNumber(r.nr_tac) !== null)) {
      rfPlots.push({
        id: "nr_tac",
        sheet: "rf",
        tech: "NR",
        title: "NR TAC Over Route",
        subtitle: `${subtitleBase}  |  NR TAC`,
        unitLabel: "TAC",
        mode: "category",
        categoryLabel: "TAC",
        points: pointsForCategory(rows, (r) => getNumber(r.nr_tac)),
      });
    }
  }

  // ---- WCDMA (omit when inactive — no placeholder) ----
  if (hasWcdma) {
    rfPlots.push({
      id: "wcdma_rscp",
      sheet: "rf",
      tech: "WCDMA",
      title: "WCDMA RSCP Over Route",
      subtitle: `${subtitleBase}  |  WCDMA only`,
      unitLabel: "RSCP (dBm)",
      mode: "bins",
      bins: RSCP_BINS,
      points: pointsForMetric(rows, (r) => getNumber(r.wcdma_rscp)),
    });
    rfPlots.push({
      id: "wcdma_ecno",
      sheet: "rf",
      tech: "WCDMA",
      title: "WCDMA Ec/No Over Route",
      subtitle: `${subtitleBase}  |  WCDMA only`,
      unitLabel: "Ec/No (dB)",
      mode: "bins",
      bins: ECNO_BINS,
      points: pointsForMetric(rows, (r) => getNumber(r.wcdma_ecno)),
    });
    rfPlots.push({
      id: "wcdma_psc",
      sheet: "rf",
      tech: "WCDMA",
      title: "WCDMA PSC / Serving Cell Over Route",
      subtitle: `${subtitleBase}  |  WCDMA only`,
      unitLabel: "PSC",
      mode: "category",
      categoryLabel: "PSC",
      points: pointsForCategory(rows, (r) => getNumber(r.wcdma_psc)),
    });
  }

  // ---- GSM (omit when inactive — no placeholder) ----
  if (hasGsm) {
    rfPlots.push({
      id: "gsm_rxlev",
      sheet: "rf",
      tech: "GSM",
      title: "GSM RxLev / RSSI Over Route",
      subtitle: `${subtitleBase}  |  GSM only`,
      unitLabel: "RxLev (dBm)",
      mode: "bins",
      bins: RXLEV_BINS,
      points: pointsForMetric(rows, (r) => getNumber(r.gsm_rxlev)),
    });
    rfPlots.push({
      id: "gsm_bsic",
      sheet: "rf",
      tech: "GSM",
      title: "GSM BSIC / Serving Cell Over Route",
      subtitle: `${subtitleBase}  |  GSM only`,
      unitLabel: "BSIC",
      mode: "category",
      categoryLabel: "BSIC",
      points: pointsForCategory(rows, (r) => getNumber(r.gsm_bsic)),
    });
    if (rows.some((r) => getNumber(r.gsm_ber) !== null)) {
      rfPlots.push({
        id: "gsm_ber",
        sheet: "rf",
        tech: "GSM",
        title: "GSM BER Over Route",
        subtitle: `${subtitleBase}  |  GSM only`,
        unitLabel: "BER",
        mode: "bins",
        bins: BER_BINS,
        points: pointsForMetric(rows, (r) => getNumber(r.gsm_ber)),
      });
    }
  }

  // GPS accuracy map when available
  if (rows.some((r) => getNumber(r.gps_accuracy_m) !== null)) {
    rfPlots.push({
      id: "gps_accuracy",
      sheet: "rf",
      tech: "GPS",
      title: "GPS Accuracy Over Route",
      subtitle: `${subtitleBase}  |  Device GPS accuracy`,
      unitLabel: "Accuracy (m)",
      mode: "bins",
      bins: GPS_ACCURACY_BINS,
      points: pointsForMetric(rows, (r) => getNumber(r.gps_accuracy_m)),
    });
  }

  const outcome = dataTestOutcome || buildDataTestOutcome(session);
  const enginePoints = (Array.isArray(throughputRows) ? throughputRows : []).filter((r) => {
    const series = String(r.series_type || "");
    return series.includes("native_http") || series.includes("ftp") || series.includes("iperf");
  });
  const hasEngineIterations = Array.isArray(session?.appIterationResults) && session.appIterationResults.length > 0;
  const useEngine = scenario !== "ookla_app" && scenario !== "fcc_app"
    && (outcome.hasSuccessfulAppThroughput || hasEngineIterations)
    && (
      enginePoints.some((r) => getNumber(r.y_dl_mbps) !== null || getNumber(r.y_ul_mbps) !== null)
      || hasEngineIterations
    );

  function nearestGpsForElapsed(elapsedSec) {
    const target = getNumber(elapsedSec);
    if (target === null || !rows.length) return null;
    let best = rows[0];
    let bestDelta = Math.abs((getNumber(best.elapsed_sec) || 0) - target);
    for (let i = 1; i < rows.length; i += 1) {
      const delta = Math.abs((getNumber(rows[i].elapsed_sec) || 0) - target);
      if (delta < bestDelta) {
        best = rows[i];
        bestDelta = delta;
      }
    }
    return bestDelta <= 30 ? best : null;
  }

  const dataPlots = [];
  const contextTrail = buildNeutralContextTrail(rows);
  const iterationRows = Array.isArray(session?.appIterationResults) ? session.appIterationResults : [];

  function matchGpsForIteration(row) {
    const elapsedCandidates = [
      row?.endedAt,
      row?.ended_at,
      row?.resultAt,
      row?.startedAt,
      row?.started_at,
    ].map((v) => {
      const abs = getNumber(v);
      if (abs == null) return null;
      // Absolute epoch → elapsed against first GPS row
      const origin = getNumber(rows[0]?.timestamp_ms);
      if (origin == null) return null;
      return (abs - origin) / 1000;
    }).filter((v) => v != null);
    for (const elapsed of elapsedCandidates) {
      const gps = nearestGpsForElapsed(elapsed);
      if (gps) return gps;
    }
    return null;
  }

  if (useEngine) {
    const series = String(scenario || "");
    const isIperf = series === "iperf3";
    const isFtp = series === "ftp";
    const engineLabel = isFtp ? "FTP internal engine" : isIperf ? "iPerf3 internal engine" : "BabyDragon Native HTTP";

    const intervalDl = [];
    const intervalUl = [];
    enginePoints.forEach((r) => {
      const seriesType = String(r.series_type || "");
      const isInterval = seriesType.includes("interval");
      const gps = nearestGpsForElapsed(r.x_elapsed_sec ?? r.elapsed_sec);
      if (!gps) return;
      const meta = pointGeoMeta(gps);
      if (getNumber(r.y_dl_mbps) !== null) {
        const pt = { lat: gps.gps_lat, lng: gps.gps_lon, value: getNumber(r.y_dl_mbps), ...meta };
        if (isInterval || isIperf) intervalDl.push(pt);
      }
      if (getNumber(r.y_ul_mbps) !== null) {
        const pt = { lat: gps.gps_lat, lng: gps.gps_lon, value: getNumber(r.y_ul_mbps), ...meta };
        if (isInterval || isIperf) intervalUl.push(pt);
      }
    });

    const resultDl = [];
    const resultUl = [];
    const failPts = [];
    iterationRows.forEach((row) => {
      const status = String(row?.status || "").toLowerCase();
      const failed = status === "failed" || status === "error" || status === "failure"
        || Boolean(row?.error || row?.errorMessage);
      const gps = matchGpsForIteration(row);
      if (!gps) return;
      const meta = {
        ...pointGeoMeta(gps),
        iteration: row.iteration,
        label: row.iteration != null ? String(row.iteration) : null,
      };
      if (failed) {
        failPts.push({
          lat: gps.gps_lat,
          lng: gps.gps_lon,
          value: null,
          ...meta,
          label: `FAIL ${row.iteration ?? ""}`.trim(),
        });
        return;
      }
      const dl = getNumber(row.dlMbps);
      const ul = getNumber(row.ulMbps);
      if (dl != null && dl > 0) {
        resultDl.push({ lat: gps.gps_lat, lng: gps.gps_lon, value: dl, ...meta });
      }
      if (ul != null && ul > 0) {
        resultUl.push({ lat: gps.gps_lat, lng: gps.gps_lon, value: ul, ...meta });
      }
    });

    // Sparse engines (HTTP/FTP): neutral route + result markers. Never KPI-color between sparse points.
    // iPerf3 intervals: color only where real interval samples match GPS; else result points.
    const useIntervalDl = isIperf && intervalDl.length >= 2;
    const useIntervalUl = isIperf && intervalUl.length >= 2;

    if (resultDl.length || useIntervalDl || failPts.length) {
      dataPlots.push({
        id: "app_dl",
        sheet: "data",
        title: isFtp ? "FTP DL Result Points Over Route"
          : isIperf ? (useIntervalDl ? "iPerf3 Interval DL Over Route" : "iPerf3 DL Result Points Over Route")
            : "Native HTTP DL Result Points Over Route",
        subtitle: `${subtitleBase}  |  ${engineLabel}`,
        unitLabel: "DL (Mbps)",
        mode: "bins",
        bins: THP_DL_BINS,
        points: useIntervalDl ? intervalDl : [],
        contextTrail,
        resultMarkers: useIntervalDl ? [] : resultDl,
        failMarkers: failPts,
        legendValues: useIntervalDl ? intervalDl.map((p) => p.value) : resultDl.map((p) => p.value),
        connectMode: useIntervalDl ? "segments" : "markers_only",
        note: "OOKLA/FCC not used as APP DL. Sparse results are markers only.",
      });
    }
    if (resultUl.length || useIntervalUl || failPts.length) {
      dataPlots.push({
        id: "app_ul",
        sheet: "data",
        title: isFtp ? "FTP UL Result Points Over Route"
          : isIperf ? (useIntervalUl ? "iPerf3 Interval UL Over Route" : "iPerf3 UL Result Points Over Route")
            : "Native HTTP UL Result Points Over Route",
        subtitle: `${subtitleBase}  |  ${engineLabel}`,
        unitLabel: "UL (Mbps)",
        mode: "bins",
        bins: THP_UL_BINS,
        points: useIntervalUl ? intervalUl : [],
        contextTrail,
        resultMarkers: useIntervalUl ? [] : resultUl,
        failMarkers: failPts,
        legendValues: useIntervalUl ? intervalUl.map((p) => p.value) : resultUl.map((p) => p.value),
        connectMode: useIntervalUl ? "segments" : "markers_only",
        note: "OOKLA/FCC not used as APP UL. Sparse results are markers only.",
      });
    }
  } else if (scenario === "ookla_app" || scenario === "fcc_app") {
    const evidenceRows = Array.isArray(session?.appOoklaEvidenceIterations)
      ? session.appOoklaEvidenceIterations
      : (Array.isArray(session?.appFccEvidenceIterations) ? session.appFccEvidenceIterations : []);
    const isOokla = scenario === "ookla_app";
    const resultDl = [];
    const resultUl = [];
    const resultPing = [];
    evidenceRows.forEach((item) => {
      const lat = getNumber(item.ooklaUserLatitude ?? item.fccLat ?? item.fccLatitude ?? item.latitude);
      const lng = getNumber(item.ooklaUserLongitude ?? item.fccLon ?? item.fccLongitude ?? item.longitude);
      if (lat === null || lng === null) return;
      const dl = getNumber(item.dlMbps ?? item.fccDlMbps);
      const ul = getNumber(item.ulMbps ?? item.fccUlMbps);
      const ping = getNumber(item.pingMs ?? item.fccPingMs ?? item.latencyMs);
      if (dl !== null) resultDl.push({ lat, lng, value: dl });
      if (ul !== null) resultUl.push({ lat, lng, value: ul });
      if (ping !== null) resultPing.push({ lat, lng, value: ping });
    });
    if (resultDl.length) {
      dataPlots.push({
        id: isOokla ? "ookla_result_dl" : "fcc_result_dl",
        sheet: "data",
        title: isOokla ? "OOKLA External Evidence DL Result Points" : "FCC External Evidence DL Result Points",
        subtitle: `${subtitleBase}  |  Source coordinates from external evidence`,
        unitLabel: "DL (Mbps)",
        mode: "bins",
        bins: THP_DL_BINS,
        points: [],
        contextTrail,
        resultMarkers: resultDl,
        legendValues: resultDl.map((p) => p.value),
        connectMode: "markers_only",
        note: isOokla ? "OOKLA External Evidence" : "FCC External Evidence",
      });
    }
    if (resultUl.length) {
      dataPlots.push({
        id: isOokla ? "ookla_result_ul" : "fcc_result_ul",
        sheet: "data",
        title: isOokla ? "OOKLA External Evidence UL Result Points" : "FCC External Evidence UL Result Points",
        subtitle: `${subtitleBase}  |  Source coordinates from external evidence`,
        unitLabel: "UL (Mbps)",
        mode: "bins",
        bins: THP_UL_BINS,
        points: [],
        contextTrail,
        resultMarkers: resultUl,
        legendValues: resultUl.map((p) => p.value),
        connectMode: "markers_only",
        note: isOokla ? "OOKLA External Evidence" : "FCC External Evidence",
      });
    }
    if (resultPing.length) {
      dataPlots.push({
        id: isOokla ? "ookla_result_ping" : "fcc_result_latency",
        sheet: "data",
        title: isOokla ? "OOKLA External Evidence Ping Result Points" : "FCC External Evidence Latency Result Points",
        subtitle: `${subtitleBase}  |  Source coordinates from external evidence`,
        unitLabel: "ms",
        mode: "bins",
        bins: [
          { max: 20, color: "#1a9850", label: "≤20" },
          { max: 40, color: "#91cf60", label: "20–40" },
          { max: 80, color: "#fee08b", label: "40–80" },
          { max: 150, color: "#fc8d59", label: "80–150" },
          { max: Infinity, color: "#d73027", label: ">150" },
        ],
        points: [],
        contextTrail,
        resultMarkers: resultPing,
        legendValues: resultPing.map((p) => p.value),
        connectMode: "markers_only",
        note: isOokla ? "OOKLA External Evidence" : "FCC External Evidence",
      });
    }
  } else {
    // No APP DL/UL maps without successful internal engine throughput
  }

  // TrafficStats Mobile — omit maps when Mobile never moved (zeros only). Keep Total maps.
  const mobileDl = buildSegmentableRoutePointsFromRows(rows, {
    valueFn: (r) => getNumber(r.traffic_stats_dl_mbps),
  });
  const mobileUl = buildSegmentableRoutePointsFromRows(rows, {
    valueFn: (r) => getNumber(r.traffic_stats_ul_mbps),
  });
  // Align with Live UI: tiny incidental Mbps below display floor is not meaningful Mobile movement.
  const mobileMoved = [...mobileDl, ...mobileUl].some((p) => {
    const v = getNumber(p?.value);
    return v != null && Math.abs(v) >= MEANINGFUL_TRAFFIC_STATS_MBPS;
  });
  if (mobileMoved && mobileDl.length) {
    dataPlots.push({
      id: "traffic_mobile_dl",
      sheet: "data",
      title: "TrafficStats Mobile DL Over Route",
      subtitle: `${subtitleBase}  |  Android mobile interface context — not APP DL`,
      unitLabel: "DL (Mbps)",
      mode: "bins",
      bins: THP_DL_BINS,
      points: mobileDl,
      legendValues: mobileDl.map((p) => p.value),
      connectMode: "segments",
    });
  }
  if (mobileMoved && mobileUl.length) {
    dataPlots.push({
      id: "traffic_mobile_ul",
      sheet: "data",
      title: "TrafficStats Mobile UL Over Route",
      subtitle: `${subtitleBase}  |  Android mobile interface context — not APP UL`,
      unitLabel: "UL (Mbps)",
      mode: "bins",
      bins: THP_UL_BINS,
      points: mobileUl,
      legendValues: mobileUl.map((p) => p.value),
      connectMode: "segments",
    });
  }
  if (!mobileMoved) {
    // Presentation only: omit Mobile DL/UL map plots. Raw CSV/JSON retain Mobile columns.
  }

  // TrafficStats Total — always separate from Mobile when present
  const totalDl = buildSegmentableRoutePointsFromRows(rows, {
    valueFn: (r) => getNumber(r.traffic_stats_total_dl_mbps),
  });
  const totalUl = buildSegmentableRoutePointsFromRows(rows, {
    valueFn: (r) => getNumber(r.traffic_stats_total_ul_mbps),
  });
  if (totalDl.length) {
    dataPlots.push({
      id: "traffic_total_dl",
      sheet: "data",
      title: "TrafficStats Total DL Over Route",
      subtitle: `${subtitleBase}  |  Total (may include Wi-Fi/offload) — not Mobile`,
      unitLabel: "Total DL (Mbps)",
      mode: "bins",
      bins: THP_DL_BINS,
      points: totalDl,
      legendValues: totalDl.map((p) => p.value),
      connectMode: "segments",
    });
  }
  if (totalUl.length) {
    dataPlots.push({
      id: "traffic_total_ul",
      sheet: "data",
      title: "TrafficStats Total UL Over Route",
      subtitle: `${subtitleBase}  |  Total (may include Wi-Fi/offload) — not Mobile`,
      unitLabel: "Total UL (Mbps)",
      mode: "bins",
      bins: THP_UL_BINS,
      points: totalUl,
      legendValues: totalUl.map((p) => p.value),
      connectMode: "segments",
    });
  }

  // GPS points for shared basemap prep
  const gpsPointsForBasemap = rows.map((r) => ({ lat: r.gps_lat, lng: r.gps_lon }));

  const plotHasGeometry = (p) => (
    (p.points || []).length > 0
    || (p.contextTrail || []).length > 0
    || (p.resultMarkers || []).length > 0
    || (p.failMarkers || []).length > 0
  );

  return {
    rfPlots: rfPlots.filter((p) => (p.points || []).length > 0).map((p) => ({
      ...p,
      stationary: sharedStationary,
      routeStatus,
    })),
    dataPlots: dataPlots.filter(plotHasGeometry).map((p) => ({
      ...p,
      stationary: sharedStationary,
      routeStatus,
    })),
    gpsPointsForBasemap,
    techFlags: { hasLte, hasNr, hasWcdma, hasGsm },
    routeStatus,
    stationary: sharedStationary,
    mobileTrafficMoved: mobileMoved,
    mobileTrafficNote: mobileMoved
      ? null
      : "No mobile-interface TrafficStats movement observed. Mobile columns remain in CSV/JSON raw evidence.",
  };
}

/**
 * Build Excel Plot Report model from a saved BabyDragon session.
 * @param {object} session
 * @param {object} user
 * @param {object} taskHelpers
 * @param {object} [options]
 * @param {object} [options.activeSettings] optional KPI display overrides (same shape as app profile)
 * @param {(stage: string) => void} [options.onProgress]
 */
export function buildExcelPlotReportModel(session = {}, user = {}, taskHelpers = {}, options = {}) {
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const activeSettings = options.activeSettings || null;
  onProgress?.("Preparing session data");

  const samples = session.exportSamples || session.traceSamples || [];
  const sessionStartMs = getNumber(session.startedAt) ?? getNumber(samples[0]?.timestamp);
  const sessionEndMs = getNumber(session.endedAt) ?? getNumber(samples[samples.length - 1]?.timestamp);
  const ooklaIterations = resolveOoklaIterations(session);
  const fccIterations = resolveFccIterations(session);
  const scenario = resolveScenario(session);
  const scenarioAdapter = buildScenarioAdapter(session, scenario);
  const dataTestOutcome = buildDataTestOutcome(session);
  const displayScenario = formatCustomerScenario(session, scenario);
  const { events: rawEvents } = buildRfEvents({ samples, session, ooklaIterations, fccIterations });
  const events = attachMapGpsToEvents(rawEvents, samples, EVENT_GPS_MATCH_MAX_DELTA_MS);
  const voice = buildVoiceEvents({ samples, session });
  const voiceEventsAll = attachMapGpsToEvents(voice.events, samples, EVENT_GPS_MATCH_MAX_DELTA_MS);
  const hasVoice = isMeaningfulVoiceSession(scenario, voiceEventsAll);
  const voiceEvents = hasVoice ? voiceEventsAll : [];
  const rawRows = buildRawRows(samples, sessionStartMs);
  // RF plot-data sheet no longer duplicates event marker columns (events live on 07 + 13)
  const plotRows = rawRows;
  const pauseSegments = Array.isArray(session.pauseSegments) ? session.pauseSegments : [];
  const pausedDurationMs = getNumber(session.pausedDurationMs) ?? pauseSegments.reduce((sum, seg) => {
    const start = getNumber(seg?.startedAt ?? seg?.startMs);
    const end = getNumber(seg?.endedAt ?? seg?.endMs);
    if (start === null || end === null || end < start) return sum;
    return sum + (end - start);
  }, 0);

  const lastRat = plotRows.filter((r) => r.rat).slice(-1)[0]?.rat || cleanText(session.rat) || null;
  const filteredRoute = computeFilteredRouteTruth(samples);
  const legacyDistance = computeRouteDistanceFromSamples(samples);
  const distance = {
    ...legacyDistance,
    ...filteredRoute,
    // Preserve raw/jitter distance in diagnostics only — customer distance is filtered.
    raw_haversine_distance_m: legacyDistance.distance_covered_m,
  };
  const throughputRows = buildThroughputSeries(session, samples, ooklaIterations, fccIterations, sessionStartMs);
  const mapPlotSpecs = buildMapPlotSpecs({
    plotRows,
    throughputRows,
    scenario,
    distance,
    session,
    dataTestOutcome,
  });
  const techFlags = mapPlotSpecs.techFlags || {};
  const rfConfigurationRows = buildRfConfigurationRows(rawRows);

  // Display-only detail maps for extreme routes (overview specs remain).
  // Use the primary plot's KPI-valued points so segment maps keep trail colors.
  if ((mapPlotSpecs.rfPlots || []).length) {
    const primary = mapPlotSpecs.rfPlots[0];
    const detailSource = Array.isArray(primary.points) && primary.points.length
      ? primary.points
      : (mapPlotSpecs.gpsPointsForBasemap || []);
    const details = maybeBuildDetailMapSpecs(primary, detailSource, 4) || [];
    if (details.length) {
      mapPlotSpecs.rfPlots = [...mapPlotSpecs.rfPlots, ...details];
    }
  }

  onProgress?.("Building event timelines");
  const outcomeSummary = {
    attempts: dataTestOutcome.attemptedIterations,
    completed: dataTestOutcome.completedIterations,
    failed: dataTestOutcome.failedIterations,
  };
  const eventPlotSpecs = buildEventPlotSpecs({
    events,
    voiceEvents,
    rawRows,
    throughputRows,
    techFlags,
    scenario,
    pauseSegments,
    sessionStartMs,
    outcomeSummary,
  });
  const eventMapPlotSpecs = buildEventMapPlotSpecs({
    events,
    voiceEvents,
    plotRows,
    throughputRows,
    techFlags,
    scenario: displayScenario,
    distance,
    outcomeSummary,
  });
  const externalEvidenceRows = buildExternalEvidenceRows(ooklaIterations, fccIterations);
  const hasExternalEvidence = externalEvidenceRows.length > 0;
  const sheetFlags = {
    hasRfMaps: (mapPlotSpecs.rfPlots || []).length > 0,
    hasDataMaps: (mapPlotSpecs.dataPlots || []).length > 0,
    hasEventPlots: eventPlotSpecs.length > 0,
    hasEventMaps: eventMapPlotSpecs.length > 0,
    hasVoice,
    hasExternalEvidence,
  };

  onProgress?.("Calculating KPI summary");
  const kpiSummary = buildKpiSummary({
    rawRows,
    throughputRows,
    session,
    ooklaIterations,
    fccIterations,
    distance,
    voiceEvents,
    scenario,
  });

  const paletteSnapshot = capturePaletteSnapshot(activeSettings);

  const customerInfo = buildCustomerInfoRows({
    session: {
      ...session,
      appRunModeLabel: scenarioAdapter.runModeLabel,
      appRunMode: scenarioAdapter.runModeLabel,
    },
    user,
    taskHelpers,
    scenario: displayScenario,
    sessionStartMs,
    sessionEndMs,
    pausedDurationMs,
    distance,
    samples,
    techFlags,
    lastRat,
    dataTestOutcome,
    paletteSnapshot,
  });
  if (paletteSnapshot) {
    customerInfo.technicalRows = [
      ...(customerInfo.technicalRows || []),
      { label: "KPI display profile", value: paletteSnapshot.profileName },
      { label: "KPI display profile version", value: paletteSnapshot.profileVersion },
      { label: "Palette captured at", value: paletteSnapshot.exportTimestampIso },
    ];
  }

  const enrichedDataEvents = (events || []).map((evt) => {
    let errorCode = null;
    let failureStage = null;
    let errorMessage = evt.errorText || null;
    try {
      const parsed = evt.details ? JSON.parse(evt.details) : null;
      if (parsed?.errorCode) errorCode = parsed.errorCode;
      if (parsed?.failureStage) failureStage = parsed.failureStage;
    } catch {
      // ignore
    }
    if (!errorCode && errorMessage && String(evt.eventType || "").includes("NATIVE_HTTP")) {
      const classif = classifyNativeHttpFailure(errorMessage);
      errorCode = classif.errorCode;
      failureStage = classif.failureStage;
    }
    const resultStatus = String(evt.eventType || "").endsWith("_TEST_FAILURE")
      ? "failed"
      : (evt.errorText ? "failure/error noted" : (evt.confidence || ""));
    return {
      ...evt,
      resultStatus,
      errorCode,
      errorMessage,
      failureStage,
    };
  });

  return {
    version: EXCEL_PLOT_REPORT_VERSION,
    scenario: displayScenario,
    scenarioKey: scenario,
    scenarioAdapter,
    normalizedReport: createNormalizedScenarioReportModel({
      session: {
        ...session,
        appRunMode: session.appRunMode || scenarioAdapter.runModeLabel?.toLowerCase?.(),
        appRunModeLabel: scenarioAdapter.runModeLabel,
      },
      scenarioAdapter,
      testOutcome: dataTestOutcome,
      iterations: session.appIterationResults || [],
      voiceEvents,
      externalEvidence: externalEvidenceRows,
      events: enrichedDataEvents,
      maps: mapPlotSpecs,
      paletteSnapshot,
    }),
    sessionStartMs,
    sessionEndMs,
    distance,
    customerInfo,
    indexRows: buildIndexRows(distance, techFlags, sheetFlags),
    plotRows,
    rawRows,
    throughputRows,
    dataEvents: enrichedDataEvents,
    voiceEvents,
    voiceNote: voice.note,
    externalEvidenceRows,
    readMeRows: buildReadMeRows(),
    mapPlotSpecs,
    eventPlotSpecs,
    eventMapPlotSpecs,
    kpiSummary,
    paletteSnapshot,
    techFlags,
    sheetFlags,
    dataTestOutcome,
    rfConfigurationRows,
    mapFlags: {
      hasRfMaps: sheetFlags.hasRfMaps,
      hasDataMaps: sheetFlags.hasDataMaps,
    },
    sampleCapNote: SAMPLE_CAP_NOTE,
  };
}

export function isExcelPlotExportableSession(session = {}) {
  if (!session || typeof session !== "object") return false;
  const samples = session.exportSamples || session.traceSamples || [];
  if (samples.length) return true;
  if (Array.isArray(session.appIterationResults) && session.appIterationResults.length) return true;
  if (resolveOoklaIterations(session).length) return true;
  if (resolveFccIterations(session).length) return true;
  return false;
}
