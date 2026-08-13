/**
 * Event Graphs (time-series charts) + Event Map Plot specs for Excel Plot Report.
 * Start/end/voice/failure graphs stay consolidated; radio RF events get one plot/map per type.
 */

import {
  RSRP_BINS,
  CATEGORY_PALETTE,
  SERIES_COLORS,
  colorForValue,
  styleForEventType,
  normalizeEventStyleKey,
} from "./excelMapPlotBins.js";
import { buildSegmentableRoutePointsFromRows } from "./excelRouteSegmentation.js";

const PLACEHOLDER_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FABJADveWkH6aAAAAAElFTkSuQmCC";

const EVENT_DISPLAY_OFFSETS_Y = [0, -14, 14, -28, 28, -42, 42];

function getNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function createCanvas(width, height) {
  if (typeof document !== "undefined" && document.createElement) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  return null;
}

async function canvasToPngBase64(canvas) {
  if (!canvas) return PLACEHOLDER_PNG_BASE64;
  try {
    if (typeof canvas.toDataURL === "function") {
      const dataUrl = canvas.toDataURL("image/png");
      return String(dataUrl).split(",")[1] || PLACEHOLDER_PNG_BASE64;
    }
    if (typeof canvas.convertToBlob === "function") {
      const blob = await canvas.convertToBlob({ type: "image/png" });
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      return btoa(binary);
    }
  } catch {
    return PLACEHOLDER_PNG_BASE64;
  }
  return PLACEHOLDER_PNG_BASE64;
}

function nearestSampleY(seriesPoints, elapsedSec) {
  if (!seriesPoints?.length || elapsedSec === null) return null;
  let best = null;
  let bestDelta = Infinity;
  seriesPoints.forEach((p) => {
    const x = getNumber(p.x);
    const y = getNumber(p.y);
    if (x === null || y === null) return;
    const d = Math.abs(x - elapsedSec);
    if (d < bestDelta) {
      bestDelta = d;
      best = { ...p, matchDeltaSec: d };
    }
  });
  return best;
}

function buildNumericSeries(rows, xKey, yKey) {
  return (rows || [])
    .map((r) => {
      const x = getNumber(r[xKey]);
      const y = getNumber(r[yKey]);
      if (x === null || y === null) return null;
      return { x, y, label: null };
    })
    .filter(Boolean);
}

function pickPrimarySignal(rawRows, techFlags = {}) {
  if (techFlags.hasLte) {
    return {
      name: "LTE RSRP",
      unit: "dBm",
      mode: "numeric",
      bins: RSRP_BINS,
      points: buildNumericSeries(rawRows, "elapsed_sec", "lte_rsrp"),
    };
  }
  if (techFlags.hasNr) {
    return {
      name: "NR SS-RSRP",
      unit: "dBm",
      mode: "numeric",
      bins: RSRP_BINS,
      points: buildNumericSeries(rawRows, "elapsed_sec", "nr_ss_rsrp"),
    };
  }
  if (techFlags.hasWcdma) {
    return {
      name: "WCDMA RSCP",
      unit: "dBm",
      mode: "numeric",
      bins: RSRP_BINS,
      points: buildNumericSeries(rawRows, "elapsed_sec", "wcdma_rscp"),
    };
  }
  if (techFlags.hasGsm) {
    return {
      name: "GSM RxLev",
      unit: "dBm",
      mode: "numeric",
      bins: RSRP_BINS,
      points: buildNumericSeries(rawRows, "elapsed_sec", "gsm_rxlev"),
    };
  }
  return { name: null, unit: "", mode: "event_only", points: [], bins: null };
}

function friendlyEventName(eventType) {
  return String(eventType || "Event").replace(/_/g, " ");
}

function fmtMbps(value) {
  const n = getNumber(value);
  return n !== null ? ` — ${n} Mbps` : "";
}

function isDataEnginePrefix(t) {
  return t.includes("NATIVE_HTTP") || t.includes("FTP") || t.includes("IPERF");
}

function isIterationStartEvent(eventType) {
  const t = String(eventType || "");
  return /_ITERATION_START$/.test(t) && isDataEnginePrefix(t);
}

function isTestStartEvent(eventType) {
  const t = String(eventType || "");
  if (t === "SESSION_START") return true;
  if (/_ITERATION_/.test(t)) return false;
  return t.endsWith("_START") && isDataEnginePrefix(t);
}

function isStartTimelineEvent(eventType) {
  const t = String(eventType || "");
  return t === "SESSION_START" || isTestStartEvent(t) || isIterationStartEvent(t);
}

function isEndTimelineEvent(eventType) {
  const t = String(eventType || "");
  if (t.endsWith("_TEST_FAILURE")) return true;
  if (t === "SESSION_END") return true;
  if (/_(DL_END|DL_SUCCESS|DL_FAILURE|UL_END|UL_SUCCESS|UL_FAILURE)$/.test(t)) return true;
  if (/_ITERATION_END$/.test(t) && isDataEnginePrefix(t)) return true;
  if (t.endsWith("_END") && !/_ITERATION_END$/.test(t) && isDataEnginePrefix(t)) return true;
  return false;
}

function hasTestFailureEvent(events = []) {
  return (events || []).some((evt) => String(evt.eventType || "").endsWith("_TEST_FAILURE"));
}

const PER_TYPE_RADIO_EVENT_GROUPS = [
  { key: "RAT_CHANGE", title: "RAT / Data Network Type Change", mapTitle: "RAT / Data Network Type Change Map" },
  { key: "SERVING_CELL_CHANGE", title: "Serving Cell Change / Possible Handover or Reselection", mapTitle: "Serving Cell Change Map" },
  { key: "PCI_CHANGE", title: "PCI Change", mapTitle: "PCI Change Map" },
  { key: "CHANNEL_CHANGE", title: "EARFCN / NRARFCN / Channel Change", mapTitle: "Channel Change Map" },
  { key: "CELL_ID_CHANGE", title: "NCI / Cell ID Change", mapTitle: "NCI / Cell ID Change Map" },
  { key: "TAC_CHANGE", title: "TAC Change", mapTitle: "TAC Change Map" },
  { key: "NR_SECONDARY", title: "NR Secondary Visible / Lost / Restored", mapTitle: "NR Secondary Map" },
  { key: "GPS_LOST_RESTORED", title: "GPS Lost / Restored", mapTitle: "GPS Lost / Restored Map" },
  { key: "PAUSE_RESUME", title: "Pause / Resume", mapTitle: "Pause / Resume Map" },
];

function radioEventGroupKey(eventType) {
  const t = String(eventType || "");
  if (t === "RAT_CHANGE" || t === "DATA_NETWORK_TYPE_CHANGE") return "RAT_CHANGE";
  if (t === "SERVING_CELL_CHANGE" || t.includes("SERVING_CELL")) return "SERVING_CELL_CHANGE";
  if (t === "PCI_CHANGE" || t.includes("PCI_CHANGE")) return "PCI_CHANGE";
  if (
    t === "CHANNEL_CHANGE"
    || t.includes("EARFCN_CHANGE")
    || t.includes("NRARFCN_CHANGE")
    || t.includes("UARFCN_CHANGE")
    || t.includes("ARFCN_CHANGE")
  ) return "CHANNEL_CHANGE";
  if (t === "CELL_ID_CHANGE" || t === "NCI_CHANGE" || t.includes("CELL_ID") || t.includes("NCI_CHANGE")) {
    return "CELL_ID_CHANGE";
  }
  if (t === "TAC_CHANGE") return "TAC_CHANGE";
  if (t.includes("NR_SECONDARY")) return "NR_SECONDARY";
  if (t === "GPS_LOST" || t === "GPS_RESTORED") return "GPS_LOST_RESTORED";
  if (t === "PAUSE" || t === "RESUME") return "PAUSE_RESUME";
  return null;
}

function isMeaningfulVoiceEventType(eventType) {
  const t = String(eventType || "").toUpperCase();
  if (!t.includes("CALL")) return false;
  return t.includes("RING") || t.includes("OFFHOOK") || t.includes("DROP")
    || t.includes("FAIL") || t.includes("ESTABLISH") || t.includes("ATTEMPT");
}

function isFailureEventType(eventType) {
  const t = String(eventType || "").toUpperCase();
  return t.endsWith("_TEST_FAILURE") || t.includes("FAILURE") || t.includes("_FAIL") || t === "FAIL";
}

function conciseReasonFromEvent(evt) {
  const notes = String(evt?.notes || "");
  const errorText = cleanText(evt?.errorText);
  if (notes.includes("errorCode=")) {
    const code = notes.match(/errorCode=([^;]+)/)?.[1];
    if (code) return code.replace(/_/g, " ");
  }
  if (errorText) {
    const lower = errorText.toLowerCase();
    if (lower.includes("unable to resolve host") || lower.includes("dns")) return "DNS Resolution Failed";
    if (lower.includes("timeout")) return "Connection Timed Out";
    if (lower.includes("network is unreachable")) return "No Usable Data Path";
    return errorText.length > 48 ? `${errorText.slice(0, 45)}…` : errorText;
  }
  return "Test failed";
}

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function computeOutcomeSummary(events = [], outcomeSummary = null) {
  if (outcomeSummary && typeof outcomeSummary === "object") {
    return {
      attempts: getNumber(outcomeSummary.attempts) ?? 0,
      completed: getNumber(outcomeSummary.completed) ?? 0,
      failed: getNumber(outcomeSummary.failed) ?? 0,
    };
  }
  const starts = (events || []).filter((evt) => isIterationStartEvent(evt.eventType));
  const failures = (events || []).filter((evt) => isFailureEventType(evt.eventType));
  const ends = (events || []).filter((evt) => {
    const t = String(evt.eventType || "");
    return /_(DL_SUCCESS|UL_SUCCESS)$/.test(t) || (/_ITERATION_END$/.test(t) && !isFailureEventType(t));
  });
  return {
    attempts: starts.length || (events.some((e) => isTestStartEvent(e.eventType)) ? 1 : 0),
    completed: ends.length,
    failed: failures.length,
  };
}

function formatOutcomeSummaryText(summary = {}) {
  const attempts = getNumber(summary.attempts);
  const completed = getNumber(summary.completed);
  const failed = getNumber(summary.failed);
  if (attempts === null && completed === null && failed === null) return null;
  return `Attempts ${attempts ?? 0}  |  Completed ${completed ?? 0}  |  Failed ${failed ?? 0}`;
}

function formatClock(evt) {
  const iso = evt?.timestampIso;
  if (iso) {
    try {
      const d = new Date(iso);
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
        });
      }
    } catch {
      // fall through
    }
  }
  const elapsed = getNumber(evt?.elapsedSec);
  if (elapsed !== null) return `t=${elapsed.toFixed(0)}s`;
  return "";
}

function startTextLabel(evt) {
  const t = String(evt.eventType || "");
  const clock = formatClock(evt);
  let base = evt.label || friendlyEventName(t);
  if (t === "SESSION_START") base = "Session Start";
  else if (isIterationStartEvent(t)) base = `Iteration ${evt.relatedIteration ?? "?"} Start`;
  else if (isTestStartEvent(t) && t !== "SESSION_START") base = "Test Start";
  return clock ? `${base} — ${clock}` : base;
}

function endTextLabel(evt) {
  const t = String(evt.eventType || "");
  const iter = evt.relatedIteration ?? "?";
  const clock = formatClock(evt);
  let base = evt.label || friendlyEventName(t);
  if (t.endsWith("_TEST_FAILURE")) {
    const engine = t.startsWith("FTP_") ? "FTP" : t.startsWith("IPERF3_") ? "iPerf3" : "Native HTTP";
    base = `${engine} Failed — ${conciseReasonFromEvent(evt)}`;
  } else if (/_(DL_END|DL_SUCCESS|DL_FAILURE)$/.test(t)) {
    base = `Iteration ${iter} DL End${fmtMbps(evt.dlMbps)}`;
  } else if (/_(UL_END|UL_SUCCESS|UL_FAILURE)$/.test(t)) {
    base = `Iteration ${iter} UL End${fmtMbps(evt.ulMbps)}`;
  } else if (/_ITERATION_END$/.test(t)) {
    base = `Iteration ${iter} Complete`;
  } else if (t === "SESSION_END") {
    base = "Session End";
  } else if (t.endsWith("_END") && isDataEnginePrefix(t)) {
    base = "Test End";
  }
  return clock ? `${base} — ${clock}` : base;
}

function voiceTextLabel(evt) {
  const t = String(evt.eventType || "").toUpperCase();
  if (t.includes("RING")) return "Call Ringing";
  if (t.includes("OFFHOOK")) return "Call Offhook";
  if (t.includes("DROP")) return "Call Drop";
  if (t.includes("FAIL")) return "Call Fail";
  if (t.includes("ESTABLISH")) return "Call Establish";
  if (t.includes("ATTEMPT")) return "Call Attempt";
  return evt.label || friendlyEventName(evt.eventType);
}

function eventMarkerFrom(evt, textLabel) {
  const elapsed = getNumber(evt.elapsedSec);
  if (elapsed === null) return null;
  const derivedNote = String(evt.notes || "").toLowerCase().includes("derived")
    || String(evt.timestampOrigin || "") === "derived_wall_duration";
  return {
    eventType: evt.eventType,
    elapsedSec: elapsed,
    timestampIso: evt.timestampIso,
    label: evt.label,
    textLabel,
    iteration: evt.relatedIteration ?? null,
    source: evt.source,
    confidence: evt.confidence,
    dlMbps: getNumber(evt.dlMbps),
    ulMbps: getNumber(evt.ulMbps),
    derivedTimestamp: derivedNote,
    notes: evt.notes || null,
  };
}

function buildIterationBarPoints(throughputRows, scenario) {
  const engine = scenario === "iperf3"
    ? "iperf3_internal"
    : scenario === "ftp"
      ? "ftp_internal"
      : "native_http_internal";
  if (engine !== "native_http_internal") return [];

  const byIteration = new Map();
  (throughputRows || []).forEach((row) => {
    if (String(row.series_type || "") !== engine) return;
    const label = String(row.label || "");
    if (!label.includes("result point")) return;
    const iteration = getNumber(row.iteration);
    if (iteration === null) return;
    const yDl = getNumber(row.y_dl_mbps);
    const yUl = getNumber(row.y_ul_mbps);
    if (yDl === null && yUl === null) return;
    const status = String(row.notes || "").toLowerCase().includes("fail") ? "failure" : "ok";
    byIteration.set(iteration, {
      x: iteration,
      yDl,
      yUl,
      status,
    });
  });

  return Array.from(byIteration.values()).sort((a, b) => a.x - b.x);
}

function resolveRadioSeries(rawRows, techFlags, titleHint = "Radio Events") {
  const series = pickPrimarySignal(rawRows, techFlags);
  return {
    titleHint,
    kpiName: series.name,
    unit: series.unit,
    mode: series.points?.length ? (series.mode || "numeric") : "event_only",
    seriesPoints: series.points || [],
    bins: series.bins || null,
    categories: series.categories || [],
    why: "Primary active-technology signal timeline when available.",
  };
}

function buildRadioTypeMarkers(events, radioSeries) {
  return (events || [])
    .map((evt) => {
      const marker = eventMarkerFrom(evt, evt.label || friendlyEventName(evt.eventType));
      if (!marker) return null;
      if (radioSeries.mode !== "event_only") {
        const nearest = nearestSampleY(radioSeries.seriesPoints, marker.elapsedSec);
        marker.yValue = nearest ? nearest.y : null;
        marker.matchDeltaSec = nearest?.matchDeltaSec ?? null;
      }
      return marker;
    })
    .filter(Boolean)
    .sort((a, b) => a.elapsedSec - b.elapsedSec);
}

function resolveFailureSeries(rawRows, techFlags) {
  const series = pickPrimarySignal(rawRows, techFlags);
  return {
    titleHint: "Failure Events",
    kpiName: series.name,
    unit: series.unit,
    mode: series.points?.length ? (series.mode || "numeric") : "event_only",
    seriesPoints: series.points || [],
    bins: series.bins || null,
    categories: series.categories || [],
    why: "Failure markers on primary signal timeline when available.",
  };
}

function resolveVoiceSeries(rawRows, techFlags) {
  const series = pickPrimarySignal(rawRows, techFlags);
  return {
    titleHint: "Voice Events",
    kpiName: series.name,
    unit: series.unit,
    mode: series.points?.length ? (series.mode || "numeric") : "event_only",
    seriesPoints: series.points || [],
    bins: series.bins || null,
    categories: series.categories || [],
    why: "Voice events over active-technology signal when available.",
  };
}

function startMapBadge(evt) {
  const t = String(evt.eventType || "");
  if (t === "SESSION_START") return "S";
  if (isIterationStartEvent(t)) return `I${evt.relatedIteration ?? "?"}`;
  if (isTestStartEvent(t) && t !== "SESSION_START") return "Test";
  return "S";
}

function endMapBadge(evt) {
  const t = String(evt.eventType || "");
  const iter = evt.relatedIteration ?? "?";
  if (t.endsWith("_TEST_FAILURE")) return "FAIL";
  if (/_(DL_END|DL_SUCCESS|DL_FAILURE)$/.test(t)) return `DL${iter}`;
  if (/_(UL_END|UL_SUCCESS|UL_FAILURE)$/.test(t)) return `UL${iter}`;
  if (/_ITERATION_END$/.test(t)) return `I${iter} End`;
  if (t === "SESSION_END") return "Session End";
  if (t.endsWith("_END") && isDataEnginePrefix(t)) return "Test End";
  return "End";
}

function radioMapBadge(evt) {
  const t = String(evt.eventType || "");
  if (t.includes("SERVING_CELL")) return "SC?";
  if (t.includes("RAT")) return "RAT";
  if (t.includes("NR_SECONDARY_EXPOSED")) return "NR+";
  if (t.includes("NR_SECONDARY_LOST")) return "NR−";
  if (t.includes("NR_SECONDARY")) return "NRM";
  if (t === "GPS_LOST") return "GPS−";
  if (t === "GPS_RESTORED") return "GPS+";
  if (t === "PAUSE") return "P";
  if (t === "RESUME") return "R";
  return "RF";
}

function voiceMapBadge(evt) {
  const t = String(evt.eventType || "").toUpperCase();
  if (t.includes("ATTEMPT") || t.includes("RING")) return "CA";
  if (t.includes("ESTABLISH") || t.includes("OFFHOOK")) return "CE";
  if (t.includes("DROP")) return "CD";
  if (t.includes("FAIL")) return "CF";
  return "CA";
}

function gpsMatchedEvents(events) {
  return (events || []).filter((evt) => evt?.mapGpsMatched === true
    && evt.mapLat != null
    && evt.mapLon != null);
}

function neutralRouteFromRows(rows) {
  // Same shared segmentable point contract as RF/Data maps (geo meta required).
  // Keep all valid coordinates for event basemap trails (freshOnly=false) so prior
  // event-map point inclusion is preserved; connection breaks still use shared rules.
  const points = buildSegmentableRoutePointsFromRows(rows, {
    value: 1,
    freshOnly: false,
  });
  return {
    mode: "bins",
    bins: [{ min: null, max: null, color: SERIES_COLORS.neutralRoute, label: "Route (neutral)" }],
    points,
    unitLabel: "Route",
    subtitle: "Neutral route with event markers",
    note: null,
    connectMode: "segments",
  };
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text || "").split(/\s+/);
  let line = "";
  let yy = y;
  words.forEach((word) => {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, yy);
      line = word;
      yy += lineHeight;
    } else {
      line = test;
    }
  });
  if (line) ctx.fillText(line, x, yy);
}

/**
 * Build customer event graphs (start/end/iteration/voice/failure consolidated; radio per type).
 */
export function buildEventPlotSpecs({
  events = [],
  voiceEvents = [],
  rawRows = [],
  throughputRows = [],
  techFlags = {},
  scenario = "",
  pauseSegments = [],
  sessionStartMs = null,
  outcomeSummary = null,
} = {}) {
  const allEvents = [...(events || []), ...(voiceEvents || [])];
  const specs = [];
  const resolvedOutcome = computeOutcomeSummary(allEvents, outcomeSummary);
  const outcomeText = formatOutcomeSummaryText(resolvedOutcome);
  const suppressSessionEnd = hasTestFailureEvent(allEvents);

  const startEvents = allEvents.filter((evt) => isStartTimelineEvent(evt.eventType));
  const startMarkers = startEvents
    .map((evt) => eventMarkerFrom(evt, startTextLabel(evt)))
    .filter(Boolean)
    .sort((a, b) => a.elapsedSec - b.elapsedSec);
  if (startMarkers.length) {
    specs.push({
      id: "start_events_timeline",
      kind: "timeline_start",
      title: "Start Events Timeline",
      graphMode: "single_series",
      mode: "event_only",
      markers: startMarkers,
      seriesPoints: [],
      bins: null,
      kpiName: null,
      unit: "",
      pauseSegments,
      sessionStartMs,
      outcomeSummary: resolvedOutcome,
      outcomeSummaryText: outcomeText,
      sourceNote: `Start markers: ${startMarkers.length}${outcomeText ? `  |  ${outcomeText}` : ""}`,
    });
  }

  const endEvents = allEvents.filter((evt) => {
    if (!isEndTimelineEvent(evt.eventType)) return false;
    const t = String(evt.eventType || "");
    if (suppressSessionEnd) {
      if (t === "SESSION_END") return false;
      // Prefer Test Failed as the customer-facing end outcome; keep iteration/test bookkeeping in 07_Data_Events.
      if (/_ITERATION_END$/.test(t)) return false;
      if (/_END$/.test(t) && !t.endsWith("_TEST_FAILURE") && isDataEnginePrefix(t)) return false;
    }
    return true;
  });
  const endMarkers = endEvents
    .map((evt) => eventMarkerFrom(evt, endTextLabel(evt)))
    .filter(Boolean)
    .sort((a, b) => a.elapsedSec - b.elapsedSec);
  if (endMarkers.length) {
    specs.push({
      id: "end_events_timeline",
      kind: "timeline_end",
      title: "End Events Timeline",
      graphMode: "single_series",
      mode: "event_only",
      markers: endMarkers,
      seriesPoints: [],
      bins: null,
      kpiName: null,
      unit: "",
      pauseSegments,
      sessionStartMs,
      outcomeSummary: resolvedOutcome,
      outcomeSummaryText: outcomeText,
      sourceNote: `End markers: ${endMarkers.length}${outcomeText ? `  |  ${outcomeText}` : ""}`,
    });
  }

  const barPoints = buildIterationBarPoints(throughputRows, scenario);
  if (barPoints.length) {
    specs.push({
      id: "iteration_results",
      kind: "iteration_bars",
      title: "Native HTTP Iteration Results",
      graphMode: "single_series",
      mode: "bars",
      barPoints,
      markers: [],
      seriesPoints: [],
      bins: null,
      kpiName: "APP throughput",
      unit: "Mbps",
      sourceNote: `Iterations: ${barPoints.length}`,
    });
  }

  PER_TYPE_RADIO_EVENT_GROUPS.forEach((group) => {
    const typeEvents = allEvents.filter((evt) => radioEventGroupKey(evt.eventType) === group.key);
    if (!typeEvents.length) return;
    const radioSeries = resolveRadioSeries(rawRows, techFlags, group.title);
    const radioMarkers = buildRadioTypeMarkers(typeEvents, radioSeries);
    specs.push({
      id: `radio_events_${group.key.toLowerCase()}`,
      kind: "timeline_radio",
      title: `${group.title} Events`,
      graphMode: "single_series",
      mode: radioSeries.mode,
      markers: radioMarkers,
      seriesPoints: radioSeries.seriesPoints,
      bins: radioSeries.bins,
      categories: radioSeries.categories,
      kpiName: radioSeries.kpiName,
      unit: radioSeries.unit,
      why: `${group.title} markers on primary signal timeline when available.`,
      shadePauses: true,
      pauseSegments,
      sessionStartMs,
      sourceNote: `${group.title} events: ${radioMarkers.length}`,
    });
  });

  const voiceOnly = (voiceEvents?.length ? voiceEvents : allEvents.filter((evt) => evt.category === "voice"))
    .filter((evt) => isMeaningfulVoiceEventType(evt.eventType));
  if (voiceOnly.length) {
    const voiceSeries = resolveVoiceSeries(rawRows, techFlags);
    const voiceMarkers = voiceOnly
      .map((evt) => {
        const marker = eventMarkerFrom(evt, voiceTextLabel(evt));
        if (!marker) return null;
        if (voiceSeries.mode !== "event_only") {
          const nearest = nearestSampleY(voiceSeries.seriesPoints, marker.elapsedSec);
          marker.yValue = nearest ? nearest.y : null;
        }
        return marker;
      })
      .filter(Boolean)
      .sort((a, b) => a.elapsedSec - b.elapsedSec);
    specs.push({
      id: "voice_events",
      kind: "timeline_voice",
      title: "Voice Events",
      graphMode: "single_series",
      mode: voiceSeries.mode,
      markers: voiceMarkers,
      seriesPoints: voiceSeries.seriesPoints,
      bins: voiceSeries.bins,
      categories: voiceSeries.categories,
      kpiName: voiceSeries.kpiName,
      unit: voiceSeries.unit,
      why: voiceSeries.why,
      sourceNote: `Voice events: ${voiceMarkers.length}`,
    });
  }

  const failureEvents = allEvents.filter((evt) => isFailureEventType(evt.eventType));
  if (failureEvents.length) {
    const failureSeries = resolveFailureSeries(rawRows, techFlags);
    const failureMarkers = failureEvents
      .map((evt) => {
        const marker = eventMarkerFrom(evt, evt.label || friendlyEventName(evt.eventType));
        if (!marker) return null;
        if (failureSeries.mode !== "event_only") {
          const nearest = nearestSampleY(failureSeries.seriesPoints, marker.elapsedSec);
          marker.yValue = nearest ? nearest.y : null;
        }
        return marker;
      })
      .filter(Boolean)
      .sort((a, b) => a.elapsedSec - b.elapsedSec);
    specs.push({
      id: "failure_events",
      kind: "timeline_failure",
      title: "Failure Events",
      graphMode: "single_series",
      mode: failureSeries.mode,
      markers: failureMarkers,
      seriesPoints: failureSeries.seriesPoints,
      bins: failureSeries.bins,
      categories: failureSeries.categories,
      kpiName: failureSeries.kpiName,
      unit: failureSeries.unit,
      why: failureSeries.why,
      sourceNote: `Failure events: ${failureMarkers.length}`,
    });
  }

  return specs;
}

function drawSeriesLayer(ctx, spec, plotLeft, plotTop, plotRight, plotBottom, minX, maxX, minY, maxY) {
  const series = spec.seriesPoints || [];
  const mode = spec.mode || "numeric";
  const bins = Array.isArray(spec.bins) ? spec.bins : null;
  const plotW = plotRight - plotLeft;
  const plotH = plotBottom - plotTop;
  const xToPx = (x) => plotLeft + ((x - minX) / (maxX - minX)) * plotW;
  const yToPx = (y) => plotBottom - ((y - minY) / (maxY - minY)) * plotH;

  if (spec.shadePauses && Array.isArray(spec.pauseSegments) && getNumber(spec.sessionStartMs) !== null) {
    const startMs = getNumber(spec.sessionStartMs);
    ctx.fillStyle = "rgba(148, 163, 184, 0.25)";
    spec.pauseSegments.forEach((seg) => {
      const a = getNumber(seg?.startedAt ?? seg?.startMs);
      const b = getNumber(seg?.endedAt ?? seg?.endMs);
      if (a === null || b === null || b < a) return;
      const x0 = xToPx((a - startMs) / 1000);
      const x1 = xToPx((b - startMs) / 1000);
      ctx.fillRect(Math.min(x0, x1), plotTop, Math.abs(x1 - x0), plotH);
    });
  }

  ctx.strokeStyle = "rgba(100, 116, 139, 0.25)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 5; i += 1) {
    const gy = plotTop + (plotH * i) / 5;
    ctx.beginPath();
    ctx.moveTo(plotLeft, gy);
    ctx.lineTo(plotRight, gy);
    ctx.stroke();
  }

  if (series.length >= 2 && mode !== "event_only") {
    if (mode === "category") {
      for (let i = 1; i < series.length; i += 1) {
        const a = series[i - 1];
        const b = series[i];
        const color = CATEGORY_PALETTE[((a.y || 1) - 1) % CATEGORY_PALETTE.length];
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(xToPx(a.x), yToPx(a.y));
        ctx.lineTo(xToPx(b.x), yToPx(a.y));
        ctx.lineTo(xToPx(b.x), yToPx(b.y));
        ctx.stroke();
      }
    } else {
      for (let i = 1; i < series.length; i += 1) {
        const a = series[i - 1];
        const b = series[i];
        const color = bins ? colorForValue(b.y ?? a.y, bins) : SERIES_COLORS.kpiLine;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(xToPx(a.x), yToPx(a.y));
        ctx.lineTo(xToPx(b.x), yToPx(b.y));
        ctx.stroke();
      }
    }
  } else if (series.length === 1 && mode !== "event_only") {
    ctx.fillStyle = bins ? colorForValue(series[0].y, bins) : SERIES_COLORS.kpiPoint;
    ctx.beginPath();
    ctx.arc(xToPx(series[0].x), yToPx(series[0].y), 4, 0, Math.PI * 2);
    ctx.fill();
  }

  return { xToPx, yToPx };
}

function drawTimelineMarkers(ctx, spec, plotLeft, plotRight, axisY, minX, maxX, markerSide, plotTop, plotBottom) {
  const plotW = plotRight - plotLeft;
  const xToPx = (x) => plotLeft + ((x - minX) / (maxX - minX)) * plotW;
  const markers = (spec.markers || []).slice().sort((a, b) => a.elapsedSec - b.elapsedSec);
  const above = markerSide === "above";
  const usable = above ? (axisY - plotTop - 8) : (plotBottom - axisY - 8);

  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(plotLeft, axisY);
  ctx.lineTo(plotRight, axisY);
  ctx.stroke();

  // Spread labels across lanes to reduce collision
  const laneCount = Math.min(5, Math.max(2, markers.length));
  markers.forEach((m, index) => {
    const x = getNumber(m.elapsedSec);
    if (x === null) return;
    const anchorX = xToPx(x);
    const style = styleForEventType(m.eventType);
    const label = m.textLabel || m.label || friendlyEventName(m.eventType);
    const lane = index % laneCount;
    const laneFrac = (lane + 1) / (laneCount + 1);
    const tickLen = Math.max(14, usable * 0.18);
    const labelDist = Math.min(usable - 4, tickLen + 12 + lane * Math.max(22, usable / (laneCount + 1)));
    const tickEnd = above ? axisY - tickLen : axisY + tickLen;
    const labelY = above ? axisY - labelDist : axisY + labelDist;
    // Alternate slight horizontal stagger for near-coincident times
    const xJitter = ((index % 3) - 1) * 10;

    ctx.strokeStyle = style.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(anchorX, axisY);
    ctx.lineTo(anchorX + xJitter * 0.3, tickEnd);
    ctx.stroke();

    ctx.fillStyle = style.color;
    ctx.beginPath();
    ctx.arc(anchorX + xJitter * 0.3, tickEnd, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 10px Segoe UI, Arial, sans-serif";
    ctx.textAlign = "center";
    wrapText(ctx, label, anchorX + xJitter, labelY, 118, 12);
    ctx.textAlign = "left";
    void laneFrac;
  });
}

function drawTimelineWithSeries(ctx, spec, plotLeft, plotTop, plotRight, plotBottom, minX, maxX, minY, maxY, markerSide) {
  const { yToPx } = drawSeriesLayer(ctx, spec, plotLeft, plotTop, plotRight, plotBottom, minX, maxX, minY, maxY);
  const plotW = plotRight - plotLeft;
  const xToPx = (x) => plotLeft + ((x - minX) / (maxX - minX)) * plotW;
  (spec.markers || []).forEach((m, index) => {
    const x = getNumber(m.elapsedSec);
    if (x === null) return;
    const style = styleForEventType(m.eventType);
    const y = getNumber(m.yValue);
    const anchorY = y !== null ? yToPx(y) : plotTop + (plotBottom - plotTop) / 2;
    const label = m.textLabel || m.label || friendlyEventName(m.eventType);
    const above = markerSide !== "below";
    const yOff = above ? -18 - (index % 4) * 14 : 18 + (index % 4) * 14;
    ctx.strokeStyle = style.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xToPx(x), anchorY);
    ctx.lineTo(xToPx(x), anchorY + (above ? -16 : 16));
    ctx.stroke();
    ctx.fillStyle = style.color;
    ctx.beginPath();
    ctx.arc(xToPx(x), anchorY + (above ? -16 : 16), 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0f172a";
    ctx.font = "9px Segoe UI, Arial, sans-serif";
    wrapText(ctx, String(label), xToPx(x) + 6, anchorY + yOff, 110, 11);
  });
}

function niceAxisTicks(maxVal, targetCount = 6) {
  const max = Math.max(Number(maxVal) || 0, 0);
  if (max <= 0) return [0];
  const rough = max / Math.max(2, targetCount - 1);
  const pow = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / pow;
  let stepNorm = 1;
  if (normalized <= 1) stepNorm = 1;
  else if (normalized <= 2) stepNorm = 2;
  else if (normalized <= 2.5) stepNorm = 2.5;
  else if (normalized <= 5) stepNorm = 5;
  else stepNorm = 10;
  const step = stepNorm * pow;
  const ticks = [];
  const top = Math.ceil(max / step) * step;
  for (let v = 0; v <= top + step * 0.001; v += step) {
    ticks.push(Number(v.toFixed(6)));
  }
  if (!ticks.includes(0)) ticks.unshift(0);
  return ticks;
}

function drawIterationBars(ctx, spec, plotLeft, plotTop, plotRight, plotBottom) {
  const points = spec.barPoints || [];
  const plotW = plotRight - plotLeft;
  const plotH = plotBottom - plotTop;
  const maxIter = Math.max(...points.map((p) => p.x), 1);
  const dataMax = Math.max(
    ...points.flatMap((p) => [getNumber(p.yDl), getNumber(p.yUl)].filter((v) => v !== null)),
    1,
  );
  const ticks = niceAxisTicks(dataMax, 6);
  const axisMax = Math.max(...ticks, dataMax);
  const groupW = plotW / Math.max(maxIter, 1);
  const barW = Math.min(28, Math.max(14, groupW * 0.32));

  // Horizontal grid + Y labels
  ctx.font = "10px Segoe UI, Arial, sans-serif";
  ticks.forEach((tick) => {
    const gy = plotBottom - (tick / axisMax) * plotH;
    ctx.strokeStyle = "rgba(100, 116, 139, 0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plotLeft, gy);
    ctx.lineTo(plotRight, gy);
    ctx.stroke();
    ctx.fillStyle = "#334155";
    ctx.textAlign = "right";
    const label = tick >= 100 ? tick.toFixed(0) : (tick >= 10 ? tick.toFixed(1) : tick.toFixed(1));
    ctx.fillText(label, plotLeft - 6, gy + 3);
    ctx.textAlign = "left";
  });

  points.forEach((p) => {
    const cx = plotLeft + (p.x - 0.5) * groupW + groupW / 2;
    const dl = getNumber(p.yDl);
    const ul = getNumber(p.yUl);
    if (dl !== null) {
      const h = (dl / axisMax) * plotH;
      ctx.fillStyle = SERIES_COLORS.kpiLine;
      ctx.fillRect(cx - barW - 3, plotBottom - h, barW, h);
      ctx.fillStyle = "#1e3a8a";
      ctx.font = "9px Segoe UI, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(dl.toFixed(1), cx - barW / 2 - 3, plotBottom - h - 4);
    }
    if (ul !== null) {
      const h = (ul / axisMax) * plotH;
      ctx.fillStyle = SERIES_COLORS.kpiPoint;
      ctx.fillRect(cx + 3, plotBottom - h, barW, h);
      ctx.fillStyle = "#1e3a8a";
      ctx.font = "9px Segoe UI, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(ul.toFixed(1), cx + barW / 2 + 3, plotBottom - h - 4);
    }
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 11px Segoe UI, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`Iter ${p.x}`, cx, plotBottom + 18);
    if (p.status) {
      ctx.font = "9px Segoe UI, Arial, sans-serif";
      ctx.fillStyle = String(p.status).toLowerCase().includes("fail") ? "#dc2626" : "#475569";
      ctx.fillText(String(p.status).slice(0, 12), cx, plotBottom + 30);
    }
    ctx.textAlign = "left";
  });
}

function drawLegendPanel(ctx, spec, lx, plotTop, mode) {
  const graphMode = spec.graphMode || "";
  const bins = Array.isArray(spec.bins) ? spec.bins : null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(lx, plotTop, 176, 200);
  ctx.strokeStyle = "#cbd5e1";
  ctx.strokeRect(lx, plotTop, 176, 200);
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 11px Segoe UI, Arial, sans-serif";
  ctx.fillText("Legend", lx + 10, plotTop + 18);

  let ly = plotTop + 36;
  const showThresholdLegend = graphMode !== "single_series" && bins && bins.length && mode === "numeric";
  if (showThresholdLegend) {
    bins.slice(0, 5).forEach((bin) => {
      ctx.fillStyle = bin.color;
      ctx.fillRect(lx + 10, ly - 8, 14, 10);
      ctx.strokeStyle = "#64748b";
      ctx.strokeRect(lx + 10, ly - 8, 14, 10);
      ctx.fillStyle = "#1e293b";
      ctx.font = "9px Segoe UI, Arial, sans-serif";
      ctx.fillText(String(bin.label).slice(0, 22), lx + 30, ly);
      ly += 14;
    });
  } else if (spec.kind === "iteration_bars") {
    ctx.fillStyle = SERIES_COLORS.kpiLine;
    ctx.fillRect(lx + 10, ly - 8, 14, 10);
    ctx.fillStyle = "#1e293b";
    ctx.font = "9px Segoe UI, Arial, sans-serif";
    ctx.fillText("DL Mbps", lx + 30, ly);
    ly += 14;
    ctx.fillStyle = SERIES_COLORS.kpiPoint;
    ctx.fillRect(lx + 10, ly - 8, 14, 10);
    ctx.fillStyle = "#1e293b";
    ctx.fillText("UL Mbps", lx + 30, ly);
    ly += 14;
  } else if (mode === "category" && (spec.categories || []).length) {
    (spec.categories || []).slice(0, 6).forEach((cat, i) => {
      ctx.fillStyle = CATEGORY_PALETTE[i % CATEGORY_PALETTE.length];
      ctx.fillRect(lx + 10, ly - 8, 14, 10);
      ctx.fillStyle = "#1e293b";
      ctx.font = "9px Segoe UI, Arial, sans-serif";
      ctx.fillText(String(cat).slice(0, 18), lx + 30, ly);
      ly += 14;
    });
  } else {
    ctx.fillStyle = SERIES_COLORS.kpiLine;
    ctx.fillRect(lx + 10, ly - 4, 16, 3);
    ctx.fillStyle = "#1e293b";
    ctx.font = "10px Segoe UI, Arial, sans-serif";
    ctx.fillText(spec.kpiName ? "KPI series" : "Event markers", lx + 32, ly);
    ly += 16;
  }

  const markerTypes = [...new Set((spec.markers || []).map((m) => m.eventType))].slice(0, 4);
  markerTypes.forEach((eventType) => {
    const eventStyle = styleForEventType(eventType);
    ctx.fillStyle = eventStyle.color;
    ctx.beginPath();
    ctx.arc(lx + 18, ly, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1e293b";
    ctx.font = "9px Segoe UI, Arial, sans-serif";
    ctx.fillText(eventStyle.label.slice(0, 20), lx + 32, ly + 3);
    ly += 14;
  });

  ly += 4;
  ctx.font = "9px Segoe UI, Arial, sans-serif";
  ctx.fillStyle = "#475569";
  wrapText(ctx, String(spec.sourceNote || "").slice(0, 90), lx + 10, ly, 156, 12);
}

/**
 * Render one event graph PNG (base64, no data-URL prefix).
 */
export async function renderEventTimeSeriesPng(spec = {}) {
  const width = 1100;
  const kindEarly = String(spec.kind || "");
  const height = kindEarly.startsWith("timeline_")
    ? 560
    : (kindEarly === "iteration_bars" ? 480 : 420);
  const title = String(spec.title || "Event Graph");
  const canvas = createCanvas(width, height);
  if (!canvas) {
    return { base64: PLACEHOLDER_PNG_BASE64, width: 10, height: 10, title, pointCount: 0 };
  }
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#0b3d5c";
  ctx.fillRect(0, 0, width, 52);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 16px Segoe UI, Arial, sans-serif";
  ctx.fillText(title, 16, 24);
  ctx.font = "11px Segoe UI, Arial, sans-serif";
  ctx.fillStyle = "#cbd5e1";
  const kpiLine = spec.kpiName
    ? `KPI: ${spec.kpiName}${spec.unit ? ` (${spec.unit})` : ""}`
    : "Elapsed-time event markers with local timestamps";
  ctx.fillText(kpiLine, 16, 42);

  const plotLeft = kindEarly === "iteration_bars" ? 56 : 56;
  const plotTop = 72;
  const plotRight = width - 200;
  const plotBottom = height - (kindEarly === "iteration_bars" ? 56 : 42);
  const plotW = plotRight - plotLeft;
  const plotH = plotBottom - plotTop;
  const kind = kindEarly;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(plotLeft, plotTop, plotW, plotH);
  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(plotLeft, plotTop, plotW, plotH);

  const markers = spec.markers || [];
  const series = spec.seriesPoints || [];
  const allX = [
    ...series.map((p) => getNumber(p.x)).filter((v) => v !== null),
    ...markers.map((m) => getNumber(m.elapsedSec)).filter((v) => v !== null),
    ...(spec.barPoints || []).map((p) => getNumber(p.x)).filter((v) => v !== null),
  ];
  let minX = allX.length ? Math.min(...allX) : 0;
  let maxX = allX.length ? Math.max(...allX) : 1;
  if (maxX <= minX) {
    minX -= 1;
    maxX += 1;
  }
  const padX = (maxX - minX) * 0.05;
  minX -= padX;
  maxX += padX;

  const mode = spec.mode || "numeric";

  if (kind === "iteration_bars") {
    drawIterationBars(ctx, spec, plotLeft, plotTop, plotRight, plotBottom);
  } else if (kind.startsWith("timeline_")) {
    const hasSeries = mode !== "event_only" && series.length > 0;
    if (hasSeries) {
      let minY;
      let maxY;
      const ys = series.map((p) => getNumber(p.y)).filter((v) => v !== null);
      markers.forEach((m) => {
        const y = getNumber(m.yValue);
        if (y !== null) ys.push(y);
      });
      if (!ys.length) {
        minY = 0;
        maxY = 1;
      } else {
        minY = Math.min(...ys);
        maxY = Math.max(...ys);
        if (maxY === minY) {
          minY -= 1;
          maxY += 1;
        }
        const padY = (maxY - minY) * 0.12;
        minY -= padY;
        maxY += padY;
      }
      drawTimelineWithSeries(ctx, spec, plotLeft, plotTop, plotRight, plotBottom, minX, maxX, minY, maxY, kind === "timeline_end" ? "below" : "above");
    } else {
      const axisY = kind === "timeline_end"
        ? plotTop + plotH * 0.35
        : plotTop + plotH * 0.65;
      drawTimelineMarkers(
        ctx,
        spec,
        plotLeft,
        plotRight,
        axisY,
        minX,
        maxX,
        kind === "timeline_end" ? "below" : "above",
        plotTop,
        plotBottom,
      );
    }
  } else {
    let minY;
    let maxY;
    if (mode === "event_only") {
      minY = 0;
      maxY = 2;
    } else if (mode === "category") {
      const catCount = Math.max(1, (spec.categories || []).length);
      minY = 0.5;
      maxY = catCount + 0.5;
    } else {
      const ys = series.map((p) => getNumber(p.y)).filter((v) => v !== null);
      markers.forEach((m) => {
        const y = getNumber(m.yValue);
        if (y !== null) ys.push(y);
      });
      if (!ys.length) {
        minY = 0;
        maxY = 1;
      } else {
        minY = Math.min(...ys);
        maxY = Math.max(...ys);
        if (maxY === minY) {
          minY -= 1;
          maxY += 1;
        }
        const padY = (maxY - minY) * 0.12;
        minY -= padY;
        maxY += padY;
      }
    }
    const { xToPx, yToPx } = drawSeriesLayer(ctx, spec, plotLeft, plotTop, plotRight, plotBottom, minX, maxX, minY, maxY);
    const eventStyle = styleForEventType(spec.eventType);
    const sortedMarkers = markers.slice().sort((a, b) => (a.elapsedSec || 0) - (b.elapsedSec || 0));
    sortedMarkers.forEach((m, fanIndex) => {
      const x = getNumber(m.elapsedSec);
      let y = getNumber(m.yValue);
      if (x === null) return;
      if (y === null) y = mode === "event_only" ? 1 : (minY + maxY) / 2;
      const anchorX = xToPx(x);
      const anchorY = yToPx(y);
      const dy = EVENT_DISPLAY_OFFSETS_Y[fanIndex % EVENT_DISPLAY_OFFSETS_Y.length];
      const displayY = anchorY + dy;
      ctx.strokeStyle = "rgba(30, 41, 59, 0.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(anchorX, anchorY);
      ctx.lineTo(anchorX, displayY);
      ctx.stroke();
      ctx.fillStyle = eventStyle.color;
      ctx.beginPath();
      ctx.moveTo(anchorX, displayY - 8);
      ctx.lineTo(anchorX + 7, displayY);
      ctx.lineTo(anchorX, displayY + 8);
      ctx.lineTo(anchorX - 7, displayY);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#0f172a";
      ctx.font = "9px Segoe UI, Arial, sans-serif";
      const text = m.textLabel || m.label || "";
      if (text) ctx.fillText(String(text).slice(0, 24), anchorX + 10, displayY + 3);
    });
  }

  ctx.fillStyle = "#0f172a";
  ctx.font = "11px Segoe UI, Arial, sans-serif";
  ctx.fillText(kind === "iteration_bars" ? "Iteration" : "Elapsed time (s)", plotLeft + plotW / 2 - 40, height - 16);
  if (kind !== "iteration_bars") {
    ctx.fillText(minX.toFixed(1), plotLeft, plotBottom + 16);
    ctx.fillText(maxX.toFixed(1), plotRight - 28, plotBottom + 16);
  }

  if (spec.outcomeSummaryText && (kind === "timeline_start" || kind === "timeline_end")) {
    ctx.fillStyle = "#475569";
    ctx.font = "10px Segoe UI, Arial, sans-serif";
    ctx.fillText(String(spec.outcomeSummaryText), plotLeft, height - 28);
  }

  drawLegendPanel(ctx, spec, plotRight + 12, plotTop, mode);

  const base64 = await canvasToPngBase64(canvas);
  return {
    base64,
    width,
    height,
    title,
    pointCount: markers.length || (spec.barPoints || []).length,
    eventType: spec.id || spec.kind,
  };
}

function buildEventMapSpec({
  id,
  title,
  events,
  plotRows,
  distance,
  badgeFn,
  outcomeSummaryText = null,
}) {
  const matched = gpsMatchedEvents(events);
  if (!matched.length) return null;
  const route = neutralRouteFromRows(plotRows);
  const milesLabel = distance.distance_covered_miles != null
    ? `${distance.distance_covered_miles} mi`
    : "n/a";
  const outcomePart = outcomeSummaryText ? `  |  ${outcomeSummaryText}` : "";
  return {
    id,
    sheet: "event_map",
    title,
    subtitle: `Distance: ${milesLabel}  |  ${matched.length} GPS-matched occurrence(s)  |  ${route.subtitle}${outcomePart}`,
    unitLabel: route.unitLabel,
    mode: route.mode,
    bins: route.bins,
    categoryLabel: route.categoryLabel,
    points: route.points,
    connectMode: route.connectMode || "segments",
    eventMarkers: matched.map((evt) => ({
      lat: evt.mapLat,
      lng: evt.mapLon,
      badge: badgeFn(evt),
      eventType: normalizeEventStyleKey(evt.eventType),
      label: evt.label,
    })),
    showEvents: true,
    note: route.note,
    outcomeSummaryText,
  };
}

/**
 * Build GPS-matched event maps (start/end/voice consolidated; radio per type).
 */
export function buildEventMapPlotSpecs({
  events = [],
  voiceEvents = [],
  plotRows = [],
  throughputRows = [],
  techFlags = {},
  scenario = "",
  distance = {},
  outcomeSummary = null,
} = {}) {
  void throughputRows;
  void techFlags;
  void scenario;

  const rows = (plotRows || []).filter((r) => {
    const lat = getNumber(r.gps_lat);
    const lng = getNumber(r.gps_lon);
    return lat !== null && lng !== null && !(lat === 0 && lng === 0);
  });
  if (!rows.length) return [];

  const allEvents = [...(events || []), ...(voiceEvents || [])];
  const suppressSessionEnd = hasTestFailureEvent(allEvents);
  const outcomeText = formatOutcomeSummaryText(computeOutcomeSummary(allEvents, outcomeSummary));
  const specs = [];

  const startMap = buildEventMapSpec({
    id: "start_events_map",
    title: "Start Events Map",
    events: allEvents.filter((evt) => isStartTimelineEvent(evt.eventType)),
    plotRows: rows,
    distance,
    badgeFn: startMapBadge,
    outcomeSummaryText: outcomeText,
  });
  if (startMap) specs.push(startMap);

  const endMap = buildEventMapSpec({
    id: "end_events_map",
    title: "End Events Map",
    events: allEvents.filter((evt) => {
      if (!isEndTimelineEvent(evt.eventType)) return false;
      const t = String(evt.eventType || "");
      if (suppressSessionEnd) {
        if (t === "SESSION_END") return false;
        if (/_ITERATION_END$/.test(t)) return false;
        if (/_END$/.test(t) && !t.endsWith("_TEST_FAILURE") && isDataEnginePrefix(t)) return false;
      }
      return true;
    }),
    plotRows: rows,
    distance,
    badgeFn: endMapBadge,
    outcomeSummaryText: outcomeText,
  });
  if (endMap) specs.push(endMap);

  PER_TYPE_RADIO_EVENT_GROUPS.forEach((group) => {
    const typeMap = buildEventMapSpec({
      id: `radio_events_${group.key.toLowerCase()}_map`,
      title: group.mapTitle,
      events: allEvents.filter((evt) => radioEventGroupKey(evt.eventType) === group.key),
      plotRows: rows,
      distance,
      badgeFn: radioMapBadge,
    });
    if (typeMap) specs.push(typeMap);
  });

  const voiceOnly = (voiceEvents?.length ? voiceEvents : allEvents.filter((evt) => evt.category === "voice"))
    .filter((evt) => isMeaningfulVoiceEventType(evt.eventType));
  const voiceMap = buildEventMapSpec({
    id: "voice_events_map",
    title: "Voice Events Map",
    events: voiceOnly,
    plotRows: rows,
    distance,
    badgeFn: voiceMapBadge,
  });
  if (voiceMap) specs.push(voiceMap);

  return specs;
}

export default {
  buildEventPlotSpecs,
  buildEventMapPlotSpecs,
  renderEventTimeSeriesPng,
};
