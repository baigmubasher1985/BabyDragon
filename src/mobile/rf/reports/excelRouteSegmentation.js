/**
 * Report-side GPS route segmentation for Excel map rendering.
 * Single shared implementation used by RF maps, Data Throughput maps, and Event maps
 * (all draw through renderRouteKpiMapPng → segmentRoutePoints).
 * Raw CSV/JSON rows stay unchanged. Connections are drawn only when a consecutive
 * plotted pair passes chronological, freshness, accuracy, gap, and speed checks.
 */

import { haversineMeters, isValidLatLng } from "../utils/gpsDistanceUtils.js";

/** Max age / status already filtered upstream; still reject restored jumps. */
const DEFAULTS = {
  maxAccuracyM: 80,
  maxTimeGapSec: 8,
  maxImpliedSpeedMps: 45, // ~162 km/h — reject teleport chords, keep highway
  maxSegmentMeters: 2500,
  minSegmentMeters: 0,
};

function getNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Attach the geo fields required by segmentRoutePoints from a plot/raw row or point.
 * Shared by RF/Data/Event map point builders so segmentation inputs cannot diverge.
 */
export function attachRoutePointMeta(row = {}, index = 0) {
  return {
    sampleIndex: getNumber(row.sampleIndex ?? row.sample_index) ?? index,
    timestampMs: getNumber(
      row.timestampMs
      ?? row.timestamp_ms
      ?? row.locationFixTimestampMs
      ?? row.location_fix_timestamp_ms
      ?? row.timestamp,
    ),
    accuracyM: getNumber(row.accuracyM ?? row.gps_accuracy_m ?? row.accuracy),
    gpsStatus: String(row.gpsStatus ?? row.gps_status ?? "").toLowerCase() || null,
    gpsProvider: String(row.gpsProvider ?? row.gps_provider ?? row.provider ?? "") || null,
  };
}

function isFreshOrRestoredStatus(status) {
  const s = String(status || "").toLowerCase();
  if (!s) return true; // legacy rows without status remain eligible
  return s === "fresh" || s === "restored";
}

/**
 * Build ordered route points for map rendering (context trails / neutral event routes).
 * Always includes segmentation metadata so RF/Data/Event maps share one connection contract.
 */
export function buildSegmentableRoutePointsFromRows(rows = [], {
  value = null,
  freshOnly = false,
  valueFn = null,
} = {}) {
  const out = [];
  (Array.isArray(rows) ? rows : []).forEach((row, index) => {
    const lat = getNumber(row?.gps_lat ?? row?.lat ?? row?.latitude);
    const lng = getNumber(row?.gps_lon ?? row?.lng ?? row?.lon ?? row?.longitude);
    if (!isValidLatLng({ lat, lng })) return;
    const meta = attachRoutePointMeta(row, index);
    if (freshOnly && !isFreshOrRestoredStatus(meta.gpsStatus)) return;
    let resolvedValue = value;
    if (typeof valueFn === "function") {
      resolvedValue = valueFn(row);
      if (resolvedValue === null || resolvedValue === undefined || resolvedValue === "") return;
      if (typeof resolvedValue === "number" && !Number.isFinite(resolvedValue)) return;
    }
    out.push({
      lat,
      lng,
      value: resolvedValue,
      ...meta,
    });
  });
  return out;
}

function normalizePoint(point = {}, index = 0) {
  const lat = getNumber(point.lat ?? point.latitude ?? point.gps_lat);
  const lng = getNumber(point.lng ?? point.lon ?? point.longitude ?? point.gps_lon);
  return {
    ...point,
    ...attachRoutePointMeta(point, index),
    lat,
    lng,
  };
}

/**
 * Evaluate whether a connection from point A → B should be drawn.
 * @returns {{ ok: boolean, reason: string|null }}
 */
export function evaluateRouteConnection(prev, next, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  if (!isValidLatLng(prev) || !isValidLatLng(next)) {
    return { ok: false, reason: "invalid_coordinates" };
  }

  const prevStatus = String(prev.gpsStatus || "").toLowerCase();
  const nextStatus = String(next.gpsStatus || "").toLowerCase();
  if (prevStatus === "lost" || prevStatus === "stale" || prevStatus === "unavailable") {
    return { ok: false, reason: "stale_or_lost_previous" };
  }
  if (nextStatus === "lost" || nextStatus === "stale" || nextStatus === "unavailable") {
    return { ok: false, reason: "stale_or_lost_next" };
  }
  // Break only into the first restored fix after an outage; later restored/fresh may connect.
  if (nextStatus === "restored" && prevStatus !== "restored") {
    return { ok: false, reason: "gps_restored_boundary" };
  }

  const prevAcc = getNumber(prev.accuracyM);
  const nextAcc = getNumber(next.accuracyM);
  if (prevAcc != null && prevAcc > opts.maxAccuracyM) {
    return { ok: false, reason: "poor_accuracy_previous" };
  }
  if (nextAcc != null && nextAcc > opts.maxAccuracyM) {
    return { ok: false, reason: "poor_accuracy_next" };
  }

  const t0 = getNumber(prev.timestampMs);
  const t1 = getNumber(next.timestampMs);
  if (t0 != null && t1 != null) {
    const dtSec = (t1 - t0) / 1000;
    if (dtSec < 0) return { ok: false, reason: "non_monotonic_timestamp" };
    if (dtSec > opts.maxTimeGapSec) return { ok: false, reason: "time_gap" };
  }

  // Sample-index gap after upstream filtering (null KPI / stale dropped) ⇒ do not chord.
  const i0 = getNumber(prev.sampleIndex);
  const i1 = getNumber(next.sampleIndex);
  if (i0 != null && i1 != null && i1 > i0 + 1) {
    return { ok: false, reason: "sample_index_gap" };
  }

  const meters = haversineMeters(prev, next);
  if (meters == null) return { ok: false, reason: "invalid_coordinates" };
  if (meters > opts.maxSegmentMeters) return { ok: false, reason: "impossible_displacement" };

  if (t0 != null && t1 != null) {
    const dtSec = (t1 - t0) / 1000;
    if (dtSec > 0) {
      const speed = meters / dtSec;
      if (speed > opts.maxImpliedSpeedMps) return { ok: false, reason: "impossible_implied_speed" };
    }
  }

  const p0 = String(prev.gpsProvider || "");
  const p1 = String(next.gpsProvider || "");
  if (p0 && p1 && p0 !== p1 && meters > 80) {
    return { ok: false, reason: "provider_switch_jump" };
  }

  return { ok: true, reason: null };
}

/**
 * Split ordered GPS points into renderable route segments.
 * Does not mutate coordinates. Rejected pairs begin a new segment at the later point.
 */
export function segmentRoutePoints(points = [], options = {}) {
  const source = (Array.isArray(points) ? points : [])
    .map((p, i) => normalizePoint(p, i))
    .filter((p) => isValidLatLng(p));

  const rejectionReasonCounts = {};
  const rejectedPairs = [];
  const segments = [];
  let current = [];

  const bump = (reason) => {
    const key = reason || "unknown";
    rejectionReasonCounts[key] = (rejectionReasonCounts[key] || 0) + 1;
  };

  for (let i = 0; i < source.length; i += 1) {
    const point = source[i];
    if (current.length === 0) {
      current.push(point);
      continue;
    }
    const prev = current[current.length - 1];
    const verdict = evaluateRouteConnection(prev, point, options);
    if (verdict.ok) {
      current.push(point);
    } else {
      bump(verdict.reason);
      rejectedPairs.push({
        fromSampleIndex: prev.sampleIndex,
        toSampleIndex: point.sampleIndex,
        reason: verdict.reason,
        from: { lat: prev.lat, lng: prev.lng },
        to: { lat: point.lat, lng: point.lng },
      });
      if (current.length) segments.push(current);
      current = [point];
    }
  }
  if (current.length) segments.push(current);

  const plotted = segments.reduce((n, seg) => n + seg.length, 0);
  return {
    segments,
    rejectedPairs,
    meta: {
      sourceGpsPointCount: (Array.isArray(points) ? points : []).length,
      validPlottedPointCount: plotted,
      renderedSegmentCount: segments.filter((seg) => seg.length >= 1).length,
      rejectedConnectionCount: rejectedPairs.length,
      rejectionReasonCounts,
    },
  };
}

export default {
  attachRoutePointMeta,
  buildSegmentableRoutePointsFromRows,
  evaluateRouteConnection,
  segmentRoutePoints,
};
