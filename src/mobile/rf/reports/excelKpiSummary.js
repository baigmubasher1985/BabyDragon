/**
 * Customer-readable KPI Average/Min/Max + Identifier summary for Excel Plot Report.
 * Finite numerics only. Does not average identifiers (PCI, EARFCN, etc.).
 */

import { buildDataTestOutcome } from "./dataTestOutcome.js";
import { buildRfConfigurationRows } from "./rfConfigurationSummary.js";
import { successfulDirectionMbps } from "./controlledIterationContract.js";
import { aggregateMeasuredTrafficStatsMbps } from "./trafficStatsMeasurement.js";

function getNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function round2(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  return Number(n.toFixed(2));
}

function isActiveRow(row) {
  return String(row?.record_state || "") !== "paused";
}

function collectFinite(values) {
  return (values || []).filter((v) => typeof v === "number" && Number.isFinite(v));
}

function agg(values) {
  const nums = collectFinite(values);
  if (!nums.length) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  return {
    count: nums.length,
    average: round2(sum / nums.length),
    minimum: round2(Math.min(...nums)),
    maximum: round2(Math.max(...nums)),
  };
}

function pushContinuous(rows, {
  category, technology, kpi, unit, values, notes = "",
}) {
  const stats = agg(values);
  if (!stats) return;
  rows.push({
    category,
    technology_source: technology,
    kpi,
    unit,
    valid_sample_count: stats.count,
    average: stats.average,
    minimum: stats.minimum,
    maximum: stats.maximum,
    notes: notes || "",
  });
}

function identifierStats(values) {
  const nums = collectFinite(values);
  if (!nums.length) return null;
  const first = nums[0];
  const last = nums[nums.length - 1];
  const freq = new Map();
  nums.forEach((v) => freq.set(v, (freq.get(v) || 0) + 1));
  let mostFrequent = first;
  let mostCount = 0;
  freq.forEach((count, value) => {
    if (count > mostCount) {
      mostCount = count;
      mostFrequent = value;
    }
  });
  let changeCount = 0;
  for (let i = 1; i < nums.length; i += 1) {
    if (nums[i] !== nums[i - 1]) changeCount += 1;
  }
  return {
    first_observed: first,
    last_observed: last,
    most_frequent_value: mostFrequent,
    unique_value_count: freq.size,
    change_count: changeCount,
  };
}

function pushIdentifier(rows, { technology, identifier, values, notes = "" }) {
  const stats = identifierStats(values);
  if (!stats) return;
  rows.push({
    technology,
    identifier,
    first_observed: stats.first_observed,
    last_observed: stats.last_observed,
    most_frequent_value: stats.most_frequent_value,
    unique_value_count: stats.unique_value_count,
    change_count: stats.change_count,
    notes: notes || "Most frequent is not an average.",
  });
}

function hasTech(activeRows, keys) {
  return activeRows.some((r) => keys.some((k) => getNumber(r[k]) !== null));
}

/**
 * @returns {{ continuousRows, identifierRows, sessionSummaryRows, voiceSummaryRows, dbmNote }}
 */
export function buildKpiSummary({
  rawRows = [],
  throughputRows = [],
  session = {},
  ooklaIterations = [],
  fccIterations = [],
  distance = {},
  voiceEvents = [],
  scenario = "",
} = {}) {
  const continuousRows = [];
  const identifierRows = [];
  const active = (rawRows || []).filter(isActiveRow);
  const dbmNote = "For dBm values, maximum is the strongest observed value and minimum is the weakest.";

  const hasLte = hasTech(active, ["lte_rsrp", "lte_rsrq", "lte_sinr", "lte_rssi", "lte_pci"]);
  const hasNr = hasTech(active, ["nr_ss_rsrp", "nr_ss_rsrq", "nr_ss_sinr", "nr_pci"]);
  const hasWcdma = hasTech(active, ["wcdma_rscp", "wcdma_ecno", "wcdma_psc"]);
  const hasGsm = hasTech(active, ["gsm_rxlev", "gsm_ber", "gsm_bsic"]);

  if (hasLte) {
    pushContinuous(continuousRows, {
      category: "RF", technology: "LTE", kpi: "RSRP", unit: "dBm",
      values: active.map((r) => getNumber(r.lte_rsrp)), notes: dbmNote,
    });
    pushContinuous(continuousRows, {
      category: "RF", technology: "LTE", kpi: "RSRQ", unit: "dB",
      values: active.map((r) => getNumber(r.lte_rsrq)),
    });
    pushContinuous(continuousRows, {
      category: "RF", technology: "LTE", kpi: "SINR / RSSNR", unit: "dB",
      values: active.map((r) => getNumber(r.lte_sinr)),
    });
    pushContinuous(continuousRows, {
      category: "RF", technology: "LTE", kpi: "RSSI", unit: "dBm",
      values: active.map((r) => getNumber(r.lte_rssi)), notes: dbmNote,
    });
    pushIdentifier(identifierRows, {
      technology: "LTE", identifier: "PCI",
      values: active.map((r) => getNumber(r.lte_pci)),
    });
    pushIdentifier(identifierRows, {
      technology: "LTE", identifier: "EARFCN",
      values: active.map((r) => getNumber(r.lte_earfcn)),
    });
    pushIdentifier(identifierRows, {
      technology: "LTE", identifier: "Cell ID",
      values: active.map((r) => getNumber(r.lte_cell_id)),
    });
    pushIdentifier(identifierRows, {
      technology: "LTE", identifier: "TAC",
      values: active.map((r) => getNumber(r.lte_tac)),
    });
  }

  if (hasNr) {
    pushContinuous(continuousRows, {
      category: "RF", technology: "NR", kpi: "SS-RSRP", unit: "dBm",
      values: active.map((r) => getNumber(r.nr_ss_rsrp)), notes: dbmNote,
    });
    pushContinuous(continuousRows, {
      category: "RF", technology: "NR", kpi: "SS-RSRQ", unit: "dB",
      values: active.map((r) => getNumber(r.nr_ss_rsrq)),
    });
    pushContinuous(continuousRows, {
      category: "RF", technology: "NR", kpi: "SS-SINR", unit: "dB",
      values: active.map((r) => getNumber(r.nr_ss_sinr)),
    });
    pushIdentifier(identifierRows, {
      technology: "NR", identifier: "PCI",
      values: active.map((r) => getNumber(r.nr_pci)),
    });
    pushIdentifier(identifierRows, {
      technology: "NR", identifier: "NRARFCN",
      values: active.map((r) => getNumber(r.nr_nrarfcn)),
    });
    pushIdentifier(identifierRows, {
      technology: "NR", identifier: "NCI",
      values: active.map((r) => getNumber(r.nr_nci)),
    });
    pushIdentifier(identifierRows, {
      technology: "NR", identifier: "TAC",
      values: active.map((r) => getNumber(r.nr_tac)),
    });
  }

  if (hasWcdma) {
    pushContinuous(continuousRows, {
      category: "RF", technology: "WCDMA", kpi: "RSCP", unit: "dBm",
      values: active.map((r) => getNumber(r.wcdma_rscp)), notes: dbmNote,
    });
    pushContinuous(continuousRows, {
      category: "RF", technology: "WCDMA", kpi: "Ec/No", unit: "dB",
      values: active.map((r) => getNumber(r.wcdma_ecno)),
    });
    pushIdentifier(identifierRows, {
      technology: "WCDMA", identifier: "PSC",
      values: active.map((r) => getNumber(r.wcdma_psc)),
    });
    pushIdentifier(identifierRows, {
      technology: "WCDMA", identifier: "UARFCN",
      values: active.map((r) => getNumber(r.wcdma_uarfcn)),
    });
  }

  if (hasGsm) {
    pushContinuous(continuousRows, {
      category: "RF", technology: "GSM", kpi: "RxLev / RSSI", unit: "dBm",
      values: active.map((r) => getNumber(r.gsm_rxlev)), notes: dbmNote,
    });
    pushContinuous(continuousRows, {
      category: "RF", technology: "GSM", kpi: "BER", unit: "",
      values: active.map((r) => getNumber(r.gsm_ber)),
    });
    pushIdentifier(identifierRows, {
      technology: "GSM", identifier: "BSIC",
      values: active.map((r) => getNumber(r.gsm_bsic)),
    });
    pushIdentifier(identifierRows, {
      technology: "GSM", identifier: "ARFCN",
      values: active.map((r) => getNumber(r.gsm_arfcn)),
    });
  }

  // Internal engine iteration results (recorded values only)
  const iterations = Array.isArray(session?.appIterationResults) ? session.appIterationResults : [];
  const dataOutcome = buildDataTestOutcome(session);
  const engineLabel = scenario === "iperf3"
    ? "iPerf3 (internal)"
    : scenario === "ftp"
      ? "FTP (internal)"
      : scenario === "native_http"
        ? "Native HTTP (internal)"
        : "BabyDragon data engine";
  const testOutcomeSummaryRows = [];
  if (dataOutcome.engineKey === "native_http" || iterations.length || dataOutcome.status !== "Not run") {
    testOutcomeSummaryRows.push(
      { item: "Test type", value: dataOutcome.testType, notes: "" },
      { item: "Status", value: dataOutcome.status, notes: dataOutcome.rawStatus ? `raw=${dataOutcome.rawStatus}` : "" },
      { item: "Requested iterations", value: dataOutcome.requestedIterations ?? "", notes: "" },
      { item: "Attempted", value: dataOutcome.attemptedIterations ?? "", notes: "" },
      { item: "Completed (full)", value: dataOutcome.completedIterations ?? "", notes: "All requested directions succeeded" },
      { item: "Partial", value: dataOutcome.partialIterations ?? "", notes: "At least one direction succeeded and one failed" },
      { item: "Failed", value: dataOutcome.failedIterations ?? "", notes: "Includes partial full-iteration failures" },
      { item: "Remaining", value: dataOutcome.remainingIterations ?? "", notes: "" },
      { item: "Successful UL directions", value: dataOutcome.successfulUlDirectionCount ?? "", notes: "" },
      { item: "Successful DL directions", value: dataOutcome.successfulDlDirectionCount ?? "", notes: "" },
      { item: "Normalized status", value: dataOutcome.normalizedStatus ?? "", notes: "" },
      { item: "Error code", value: dataOutcome.errorCode ?? "", notes: "" },
      { item: "Failure stage", value: dataOutcome.failureStage ?? "", notes: "" },
      { item: "Error message", value: dataOutcome.errorMessage ?? "", notes: "" },
      { item: "End reason", value: dataOutcome.endReason ?? "", notes: "" },
    );
    if (!dataOutcome.hasSuccessfulAppThroughput) {
      testOutcomeSummaryRows.push({
        item: "APP DL/UL",
        value: "N/A",
        notes: "No successful direction throughput recorded.",
      });
    }
  }
  if (iterations.length && dataOutcome.hasSuccessfulAppThroughput) {
    const dl = iterations.map((r) => successfulDirectionMbps(r, "dl")).filter((v) => v !== null);
    const ul = iterations.map((r) => successfulDirectionMbps(r, "ul")).filter((v) => v !== null);
    if (dl.length) {
      pushContinuous(continuousRows, {
        category: "Internal data", technology: engineLabel, kpi: "DL", unit: "Mbps",
        values: dl, notes: "Successful-direction values only (partial iterations included).",
      });
    }
    if (ul.length) {
      pushContinuous(continuousRows, {
        category: "Internal data", technology: engineLabel, kpi: "UL", unit: "Mbps",
        values: ul, notes: "Successful-direction values only (partial iterations included).",
      });
    }
  }

  // TrafficStats from active samples — measured Mbps only (skip first unmeasured row).
  const trafficDl = aggregateMeasuredTrafficStatsMbps(active.map((r) => r.traffic_stats_dl_mbps));
  const trafficUl = aggregateMeasuredTrafficStatsMbps(active.map((r) => r.traffic_stats_ul_mbps));
  const trafficTotalDl = aggregateMeasuredTrafficStatsMbps(active.map((r) => r.traffic_stats_total_dl_mbps));
  const trafficTotalUl = aggregateMeasuredTrafficStatsMbps(active.map((r) => r.traffic_stats_total_ul_mbps));
  if (trafficDl) {
    continuousRows.push({
      category: "TrafficStats", technology_source: "Android Mobile", kpi: "Mobile DL", unit: "Mbps",
      valid_sample_count: trafficDl.count, average: trafficDl.average, minimum: trafficDl.minimum, maximum: trafficDl.maximum,
      notes: "Android mobile interface byte-delta context — not official OOKLA/FCC. First unmeasured row excluded.",
    });
  }
  if (trafficUl) {
    continuousRows.push({
      category: "TrafficStats", technology_source: "Android Mobile", kpi: "Mobile UL", unit: "Mbps",
      valid_sample_count: trafficUl.count, average: trafficUl.average, minimum: trafficUl.minimum, maximum: trafficUl.maximum,
      notes: "Android mobile interface byte-delta context — not official OOKLA/FCC. First unmeasured row excluded.",
    });
  }
  if (trafficTotalDl) {
    continuousRows.push({
      category: "TrafficStats", technology_source: "Android Total", kpi: "Total DL", unit: "Mbps",
      valid_sample_count: trafficTotalDl.count, average: trafficTotalDl.average, minimum: trafficTotalDl.minimum, maximum: trafficTotalDl.maximum,
      notes: "May include Wi-Fi/routed/offload. Kept separate from Mobile.",
    });
  }
  if (trafficTotalUl) {
    continuousRows.push({
      category: "TrafficStats", technology_source: "Android Total", kpi: "Total UL", unit: "Mbps",
      valid_sample_count: trafficTotalUl.count, average: trafficTotalUl.average, minimum: trafficTotalUl.minimum, maximum: trafficTotalUl.maximum,
      notes: "May include Wi-Fi/routed/offload. Kept separate from Mobile.",
    });
  }

  // External evidence
  if ((ooklaIterations || []).length) {
    pushContinuous(continuousRows, {
      category: "External evidence", technology: "OOKLA", kpi: "DL", unit: "Mbps",
      values: ooklaIterations.map((i) => getNumber(i.dlMbps)),
      notes: "Saved OOKLA evidence only. Not APP DL/UL.",
    });
    pushContinuous(continuousRows, {
      category: "External evidence", technology: "OOKLA", kpi: "UL", unit: "Mbps",
      values: ooklaIterations.map((i) => getNumber(i.ulMbps)),
      notes: "Saved OOKLA evidence only. Not APP DL/UL.",
    });
    pushContinuous(continuousRows, {
      category: "External evidence", technology: "OOKLA", kpi: "Ping", unit: "ms",
      values: ooklaIterations.map((i) => getNumber(i.pingMs)),
      notes: "External evidence.",
    });
    pushContinuous(continuousRows, {
      category: "External evidence", technology: "OOKLA", kpi: "Jitter", unit: "ms",
      values: ooklaIterations.map((i) => getNumber(i.jitterMs)),
      notes: "External evidence.",
    });
    pushContinuous(continuousRows, {
      category: "External evidence", technology: "OOKLA", kpi: "Packet loss", unit: "%",
      values: ooklaIterations.map((i) => getNumber(i.packetLossPct ?? i.lossPct)),
      notes: "External evidence.",
    });
  }

  if ((fccIterations || []).length) {
    pushContinuous(continuousRows, {
      category: "External evidence", technology: "FCC", kpi: "DL", unit: "Mbps",
      values: fccIterations.map((i) => getNumber(i.fccDlMbps)),
      notes: "Saved FCC evidence only. Not APP DL/UL.",
    });
    pushContinuous(continuousRows, {
      category: "External evidence", technology: "FCC", kpi: "UL", unit: "Mbps",
      values: fccIterations.map((i) => getNumber(i.fccUlMbps)),
      notes: "Saved FCC evidence only. Not APP DL/UL.",
    });
    pushContinuous(continuousRows, {
      category: "External evidence", technology: "FCC", kpi: "Latency / Ping", unit: "ms",
      values: fccIterations.map((i) => getNumber(i.fccPingMs)),
      notes: "External evidence.",
    });
    pushContinuous(continuousRows, {
      category: "External evidence", technology: "FCC", kpi: "Jitter", unit: "ms",
      values: fccIterations.map((i) => getNumber(i.fccJitterMs)),
      notes: "External evidence.",
    });
    pushContinuous(continuousRows, {
      category: "External evidence", technology: "FCC", kpi: "Packet loss", unit: "%",
      values: fccIterations.map((i) => getNumber(i.fccLossPct ?? i.packetLossPct)),
      notes: "External evidence.",
    });
  }

  // GPS
  pushContinuous(continuousRows, {
    category: "GPS", technology: "Device GPS", kpi: "GPS accuracy", unit: "m",
    values: (rawRows || []).map((r) => getNumber(r.gps_accuracy_m)),
    notes: "Includes samples with GPS fix when accuracy is present.",
  });
  pushContinuous(continuousRows, {
    category: "GPS", technology: "Device GPS", kpi: "GPS speed", unit: "m/s",
    values: (rawRows || []).map((r) => getNumber(r.gps_speed_mps)),
  });
  pushContinuous(continuousRows, {
    category: "GPS", technology: "Device GPS", kpi: "GPS fix age", unit: "ms",
    values: (rawRows || []).map((r) => getNumber(r.gps_fix_age_ms)),
    notes: "Age of native location-fix timestamp at sample time.",
  });

  const freshCount = (rawRows || []).filter((r) => {
    const s = String(r.gps_status || "").toLowerCase();
    return s === "fresh" || s === "restored";
  }).length;
  const staleCount = (rawRows || []).filter((r) => String(r.gps_status || "").toLowerCase() === "stale").length;

  const sessionSummaryRows = [
    {
      item: "Distance covered (miles)",
      value: distance.distance_covered_miles ?? "",
      notes: "Total route distance from fresh GPS fixes (Haversine), not an average KPI.",
    },
    {
      item: "Distance covered (km)",
      value: distance.distance_covered_km ?? "",
      notes: "Total route distance.",
    },
    {
      item: "GPS points used for distance",
      value: distance.gps_points_used_for_distance ?? "",
      notes: "",
    },
    {
      item: "Fresh GPS sample count",
      value: freshCount,
      notes: "gps_status fresh or restored",
    },
    {
      item: "Stale GPS sample count",
      value: staleCount,
      notes: "gps_status stale — not used to extend route distance",
    },
  ];

  // Voice summary — only confirmed meaningful counts
  const voiceSummaryRows = [];
  const meaningfulVoice = (voiceEvents || []).filter((e) => {
    const t = String(e.eventType || "").toUpperCase();
    return t.includes("RING") || t.includes("OFFHOOK") || t.includes("DROP")
      || t.includes("FAIL") || t.includes("ESTABLISH") || t.includes("ATTEMPT")
      || String(e.source || "").includes("fe_manual");
  });
  if (scenario === "voice" || meaningfulVoice.length) {
    const ringing = meaningfulVoice.filter((e) => String(e.eventType || "").includes("RING")).length;
    const offhook = meaningfulVoice.filter((e) => String(e.eventType || "").includes("OFFHOOK")).length;
    voiceSummaryRows.push(
      { item: "Ringing / attempt transitions", value: ringing, notes: "Confirmed Android callState only unless FE marker exists." },
      { item: "Offhook / active transitions", value: offhook, notes: "MO/MT/drop/fail not invented." },
    );
  }

  // Suppress unused throughputRows warning by acknowledging presence for future dense series
  void throughputRows;

  const rfConfigurationRows = buildRfConfigurationRows(rawRows);

  return {
    continuousRows,
    identifierRows,
    sessionSummaryRows,
    voiceSummaryRows,
    testOutcomeSummaryRows,
    rfConfigurationRows,
    dbmNote,
  };
}

export default buildKpiSummary;
