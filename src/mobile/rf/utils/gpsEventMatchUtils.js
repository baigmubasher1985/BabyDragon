/**
 * Match events to real GPS samples for Excel map markers.
 * Never invents coordinates. Never reuses previous point when match fails.
 */

const EARTH_OK = true; // keep file focused

function getNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return null;
}

/** Max |event_ts - gps_ts| for nearest-timestamp GPS attach (milliseconds). */
export const EVENT_GPS_MATCH_MAX_DELTA_MS = 5000;

export function isValidMapGps(lat, lon) {
  const la = getNumber(lat);
  const lo = getNumber(lon);
  if (la === null || lo === null) return false;
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return false;
  if (la === 0 && lo === 0) return false;
  return true;
}

/**
 * Build GPS trace from RF samples (real recorded points only).
 */
export function buildGpsTraceFromSamples(samples = []) {
  const trace = [];
  (Array.isArray(samples) ? samples : []).forEach((sample, index) => {
    const lat = getNumber(sample?.gps?.lat ?? sample?.gps_lat);
    const lng = getNumber(sample?.gps?.lng ?? sample?.gps?.lon ?? sample?.gps_lon);
    const timestampMs = getNumber(sample?.timestamp ?? sample?.timestamp_ms);
    if (!isValidMapGps(lat, lng) || timestampMs === null) return;
    trace.push({ lat, lng, timestampMs, sampleIndex: index });
  });
  return trace;
}

/**
 * Nearest GPS sample by timestamp within maxDeltaMs.
 * Uses binary search on a timestamp-sorted trace (O(log n) after sort).
 * Returns null when no valid match (caller must leave map lat/lon blank).
 */
export function matchEventToGpsTrace(timestampMs, gpsTrace = [], maxDeltaMs = EVENT_GPS_MATCH_MAX_DELTA_MS) {
  const ts = getNumber(timestampMs);
  if (ts === null || !Array.isArray(gpsTrace) || !gpsTrace.length) {
    return null;
  }
  // Prefer pre-sorted traces; sort a shallow copy when unsorted (once per attach batch is better).
  const sorted = gpsTrace._bdSorted
    ? gpsTrace
    : [...gpsTrace].filter((p) => getNumber(p.timestampMs) !== null && isValidMapGps(p.lat, p.lng))
      .sort((a, b) => getNumber(a.timestampMs) - getNumber(b.timestampMs));

  if (!sorted.length) return null;

  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (getNumber(sorted[mid].timestampMs) < ts) lo = mid + 1;
    else hi = mid;
  }
  const candidates = [sorted[lo]];
  if (lo > 0) candidates.push(sorted[lo - 1]);
  if (lo + 1 < sorted.length) candidates.push(sorted[lo + 1]);

  let best = null;
  let bestDelta = Infinity;
  for (const point of candidates) {
    const pt = getNumber(point.timestampMs);
    if (pt === null) continue;
    const delta = Math.abs(pt - ts);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = point;
    }
  }
  if (!best || bestDelta > maxDeltaMs) return null;
  return {
    lat: best.lat,
    lng: best.lng,
    timestampMs: best.timestampMs,
    sampleIndex: best.sampleIndex,
    deltaMs: bestDelta,
    deltaSec: Number((bestDelta / 1000).toFixed(3)),
    attachMode: "nearest_timestamp",
  };
}

/**
 * Resolve map GPS for one event.
 * Prefer direct sample GPS; else nearest timestamp match; else blank.
 */
export function resolveEventMapGps(event = {}, gpsTrace = [], maxDeltaMs = EVENT_GPS_MATCH_MAX_DELTA_MS) {
  if (isValidMapGps(event.mapLat ?? event.gpsLat, event.mapLon ?? event.gpsLon ?? event.gpsLng)) {
    return {
      mapLat: getNumber(event.mapLat ?? event.gpsLat),
      mapLon: getNumber(event.mapLon ?? event.gpsLon ?? event.gpsLng),
      mapGpsAttachMode: event.mapGpsAttachMode || "direct_sample",
      mapGpsMatchDeltaSec: event.mapGpsMatchDeltaSec ?? 0,
      mapGpsMatched: true,
    };
  }
  const matched = matchEventToGpsTrace(event.timestampMs, gpsTrace, maxDeltaMs);
  if (!matched) {
    return {
      mapLat: null,
      mapLon: null,
      mapGpsAttachMode: "none",
      mapGpsMatchDeltaSec: null,
      mapGpsMatched: false,
    };
  }
  return {
    mapLat: matched.lat,
    mapLon: matched.lng,
    mapGpsAttachMode: matched.attachMode,
    mapGpsMatchDeltaSec: matched.deltaSec,
    mapGpsMatched: true,
  };
}

/**
 * Attach map GPS fields to event list (mutates copies).
 */
export function attachMapGpsToEvents(events = [], samples = [], maxDeltaMs = EVENT_GPS_MATCH_MAX_DELTA_MS) {
  void EARTH_OK;
  const gpsTrace = buildGpsTraceFromSamples(samples);
  // Sort once; mark for binary search in matchEventToGpsTrace.
  gpsTrace.sort((a, b) => a.timestampMs - b.timestampMs);
  gpsTrace._bdSorted = true;
  return (Array.isArray(events) ? events : []).map((evt) => {
    const resolved = resolveEventMapGps(evt, gpsTrace, maxDeltaMs);
    return {
      ...evt,
      mapLat: resolved.mapLat,
      mapLon: resolved.mapLon,
      mapGpsAttachMode: resolved.mapGpsAttachMode,
      mapGpsMatchDeltaSec: resolved.mapGpsMatchDeltaSec,
      mapGpsMatched: resolved.mapGpsMatched,
    };
  });
}
