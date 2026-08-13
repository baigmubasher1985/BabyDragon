/**
 * GPS freshness model for BabyDragon mobility sessions.
 *
 * Staleness is based on the native location-fix timestamp age, NOT unchanged
 * coordinates (a parked device may legitimately repeat the same lat/lon).
 */

/** Age at or below this is treated as a fresh fix. */
export const GPS_FRESH_MAX_AGE_MS = 5000;

/** Age above fresh and at or below this is stale (last coords may be reused). */
export const GPS_STALE_MAX_AGE_MS = 30000;

/** Beyond this with no newer fix → lost. */
export const GPS_LOST_AFTER_MS = 30000;

export const GPS_STATUS = Object.freeze({
  FRESH: "fresh",
  STALE: "stale",
  LOST: "lost",
  RESTORED: "restored",
  UNAVAILABLE: "unavailable",
});

function getNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function isValidMobilityLatLng(point = {}) {
  const lat = getNumber(point.lat ?? point.latitude);
  const lng = getNumber(point.lng ?? point.lon ?? point.longitude);
  if (lat === null || lng === null) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
}

/**
 * Resolve the best available fix timestamp in epoch ms.
 * Prefers Android / W3C location timestamp over wall-clock receive time.
 */
export function resolveLocationFixTimestampMs(point = {}, receivedAtMs = Date.now()) {
  const candidates = [
    point.location_fix_timestamp_ms,
    point.locationFixTimestampMs,
    point.timestamp,
    point.time,
    point.gps_timestamp_ms,
  ];
  for (const c of candidates) {
    const n = getNumber(c);
    if (n === null) continue;
    // W3C Geolocation timestamps are epoch ms; reject tiny / relative values.
    if (n > 1e11) return Math.round(n);
    if (n > 1e9 && n < 1e11) return Math.round(n * 1000); // seconds → ms
  }
  const iso = point.location_fix_timestamp_iso || point.cached_at || point.isoTime;
  if (iso) {
    const parsed = Date.parse(String(iso));
    if (Number.isFinite(parsed)) return parsed;
  }
  return getNumber(receivedAtMs) ?? Date.now();
}

export function computeGpsFixAgeMs(point = {}, nowMs = Date.now()) {
  const fixMs = resolveLocationFixTimestampMs(point, nowMs);
  const age = (getNumber(nowMs) ?? Date.now()) - fixMs;
  return age >= 0 ? age : 0;
}

/**
 * Classify gps_status from fix age and prior status.
 * `restored` is only returned when transitioning into fresh from stale/lost.
 */
export function classifyGpsStatus({
  point = null,
  nowMs = Date.now(),
  previousStatus = null,
  freshMaxAgeMs = GPS_FRESH_MAX_AGE_MS,
  lostAfterMs = GPS_LOST_AFTER_MS,
} = {}) {
  if (!isValidMobilityLatLng(point)) {
    return {
      gps_status: GPS_STATUS.UNAVAILABLE,
      gps_fix_age_ms: null,
      location_fix_timestamp_ms: null,
    };
  }

  const fixMs = resolveLocationFixTimestampMs(point, nowMs);
  const age = computeGpsFixAgeMs(point, nowMs);
  let status = GPS_STATUS.FRESH;
  if (age > lostAfterMs) status = GPS_STATUS.LOST;
  else if (age > freshMaxAgeMs) status = GPS_STATUS.STALE;

  const prev = String(previousStatus || "").toLowerCase();
  if (
    status === GPS_STATUS.FRESH
    && (prev === GPS_STATUS.STALE || prev === GPS_STATUS.LOST || prev === GPS_STATUS.UNAVAILABLE)
  ) {
    status = GPS_STATUS.RESTORED;
  }

  return {
    gps_status: status,
    gps_fix_age_ms: age,
    location_fix_timestamp_ms: fixMs,
    location_fix_timestamp_iso: new Date(fixMs).toISOString(),
  };
}

/**
 * Normalize a browser / Capacitor / session GPS point into the mobility sample shape.
 */
export function enrichMobilityGpsSample(raw = {}, {
  nowMs = Date.now(),
  previousStatus = null,
  source = "watch_position",
} = {}) {
  if (!isValidMobilityLatLng(raw)) {
    return {
      lat: null,
      lng: null,
      latitude: null,
      longitude: null,
      accuracy: null,
      accuracy_m: null,
      speed: null,
      speed_mps: null,
      bearing_deg: null,
      altitude_m: null,
      provider: raw?.provider || source || null,
      location_fix_timestamp_iso: null,
      location_fix_timestamp_ms: null,
      elapsed_realtime_nanos: getNumber(raw?.elapsed_realtime_nanos ?? raw?.elapsedRealtimeNanos),
      gps_fix_age_ms: null,
      is_mock: raw?.is_mock === true || raw?.isMock === true || null,
      gps_status: GPS_STATUS.UNAVAILABLE,
      source,
      timestamp: nowMs,
    };
  }

  const lat = getNumber(raw.lat ?? raw.latitude);
  const lng = getNumber(raw.lng ?? raw.lon ?? raw.longitude);
  const classified = classifyGpsStatus({ point: raw, nowMs, previousStatus });
  const accuracy = getNumber(raw.accuracy ?? raw.accuracy_m);
  const speed = getNumber(raw.speed ?? raw.speed_mps);
  const bearing = getNumber(raw.bearing_deg ?? raw.heading ?? raw.bearing);
  const altitude = getNumber(raw.altitude_m ?? raw.altitude);

  return {
    lat,
    lng,
    latitude: lat,
    longitude: lng,
    accuracy,
    accuracy_m: accuracy,
    speed,
    speed_mps: speed,
    bearing_deg: bearing,
    heading: bearing,
    altitude_m: altitude,
    altitude,
    provider: raw.provider || source || "browser_geolocation",
    location_fix_timestamp_iso: classified.location_fix_timestamp_iso,
    location_fix_timestamp_ms: classified.location_fix_timestamp_ms,
    elapsed_realtime_nanos: getNumber(raw.elapsed_realtime_nanos ?? raw.elapsedRealtimeNanos),
    gps_fix_age_ms: classified.gps_fix_age_ms,
    is_mock: raw.is_mock === true || raw.isMock === true || false,
    gps_status: classified.gps_status,
    source,
    timestamp: classified.location_fix_timestamp_ms || nowMs,
    cached_at: classified.location_fix_timestamp_iso,
    from_cache: Boolean(raw.from_cache),
  };
}

export function shouldExtendDrivenTrail(gps = {}) {
  const status = String(gps?.gps_status || "").toLowerCase();
  return status === GPS_STATUS.FRESH || status === GPS_STATUS.RESTORED;
}

export function summarizeGpsQuality(samples = []) {
  let fresh = 0;
  let stale = 0;
  let lost = 0;
  let restored = 0;
  let unavailable = 0;
  const unique = new Set();
  const fixTimestamps = new Set();
  const ages = [];
  const accuracies = [];
  const speeds = [];
  let firstFix = null;
  let lastFix = null;

  const freshUnique = new Set();
  let freshDistanceM = 0;
  let prevFresh = null;

  (Array.isArray(samples) ? samples : []).forEach((sample) => {
    const gps = sample?.gps || sample;
    if (!isValidMobilityLatLng(gps)) {
      unavailable += 1;
      return;
    }
    const status = String(gps.gps_status || "").toLowerCase();
    if (status === GPS_STATUS.FRESH) fresh += 1;
    else if (status === GPS_STATUS.STALE) stale += 1;
    else if (status === GPS_STATUS.LOST) lost += 1;
    else if (status === GPS_STATUS.RESTORED) restored += 1;
    else if (status === GPS_STATUS.UNAVAILABLE) unavailable += 1;
    else {
      // Legacy samples without gps_status: treat as unknown freshness.
      stale += 1;
    }
    unique.add(`${Number(gps.lat ?? gps.latitude).toFixed(6)},${Number(gps.lng ?? gps.longitude).toFixed(6)}`);
    if (status === GPS_STATUS.FRESH || status === GPS_STATUS.RESTORED) {
      const key = `${Number(gps.lat ?? gps.latitude).toFixed(6)},${Number(gps.lng ?? gps.longitude).toFixed(6)}`;
      freshUnique.add(key);
      if (prevFresh) {
        const dlat = (Number(gps.lat ?? gps.latitude) - Number(prevFresh.lat ?? prevFresh.latitude)) * 111320;
        const dlng = (Number(gps.lng ?? gps.longitude) - Number(prevFresh.lng ?? prevFresh.longitude))
          * 111320 * Math.cos((Number(gps.lat ?? gps.latitude) * Math.PI) / 180);
        const seg = Math.sqrt(dlat * dlat + dlng * dlng);
        if (Number.isFinite(seg) && seg >= 0.5) freshDistanceM += seg;
      }
      prevFresh = gps;
    }
    const fixMs = getNumber(gps.location_fix_timestamp_ms ?? gps.timestamp);
    if (fixMs != null) fixTimestamps.add(fixMs);
    const age = getNumber(gps.gps_fix_age_ms);
    if (age != null) ages.push(age);
    const acc = getNumber(gps.accuracy ?? gps.accuracy_m);
    if (acc != null) accuracies.push(acc);
    const spd = getNumber(gps.speed ?? gps.speed_mps);
    if (spd != null) speeds.push(spd);
    if (!firstFix) firstFix = gps;
    lastFix = gps;
  });

  const avg = (arr) => (arr.length ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2)) : null);
  const min = (arr) => (arr.length ? Number(Math.min(...arr).toFixed(2)) : null);
  const max = (arr) => (arr.length ? Number(Math.max(...arr).toFixed(2)) : null);

  const MIN_MOBILITY_ROUTE_M = 40;
  let routeStatus = "GPS unavailable";
  if (fresh + restored <= 0) {
    if (stale > 0 || lost > 0) routeStatus = "GPS stale";
    else routeStatus = "GPS unavailable";
  } else if (fresh + restored < 2 || freshUnique.size < 2) {
    routeStatus = "Insufficient fresh GPS";
  } else if (freshDistanceM < MIN_MOBILITY_ROUTE_M) {
    routeStatus = "Stationary / limited route spread";
  } else {
    // Provisional — Excel/report layers replace with filtered-segment classification.
    routeStatus = "Mobility route recorded";
  }

  const suspiciousStatic = (samples?.length || 0) >= 50 && fixTimestamps.size <= 1;

  return {
    gps_fixes_recorded: fresh + stale + lost + restored,
    fresh_gps_fixes: fresh + restored,
    stale_gps_samples: stale,
    gps_lost_events: lost,
    gps_restored_events: restored,
    unavailable_gps_samples: unavailable,
    unique_gps_points: unique.size,
    unique_fresh_gps_points: freshUnique.size,
    fresh_distance_m: Number(freshDistanceM.toFixed(2)),
    gps_points_used_for_distance: fresh + restored,
    unique_source_fix_timestamps: fixTimestamps.size,
    first_gps_fix: firstFix,
    last_gps_fix: lastFix,
    accuracy_avg: avg(accuracies),
    accuracy_min: min(accuracies),
    accuracy_max: max(accuracies),
    speed_avg: avg(speeds),
    speed_min: min(speeds),
    speed_max: max(speeds),
    fix_age_avg_ms: avg(ages),
    fix_age_max_ms: max(ages),
    route_status: routeStatus,
    suspicious_static_route: suspiciousStatic,
    route_incomplete_message: suspiciousStatic
      ? "GPS route incomplete — location updates became stale"
      : null,
  };
}

export default {
  GPS_FRESH_MAX_AGE_MS,
  GPS_STALE_MAX_AGE_MS,
  GPS_LOST_AFTER_MS,
  GPS_STATUS,
  enrichMobilityGpsSample,
  classifyGpsStatus,
  shouldExtendDrivenTrail,
  summarizeGpsQuality,
};
