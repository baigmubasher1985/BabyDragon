/**
 * GPS route distance helpers for Excel Plot Report (Haversine).
 */

const EARTH_RADIUS_M = 6371000;
const METERS_PER_MILE = 1609.344;
/** Skip absurd GPS jumps (teleports / bad fixes) between consecutive points. */
const MAX_SEGMENT_METERS = 2500;

function getNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return null;
}

export function isValidLatLng(point = {}) {
  const lat = getNumber(point.lat ?? point.latitude);
  const lng = getNumber(point.lng ?? point.lon ?? point.longitude);
  if (lat === null || lng === null) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
}

export function haversineMeters(a = {}, b = {}) {
  const lat1 = getNumber(a.lat ?? a.latitude);
  const lng1 = getNumber(a.lng ?? a.lon ?? a.longitude);
  const lat2 = getNumber(b.lat ?? b.latitude);
  const lng2 = getNumber(b.lng ?? b.lon ?? b.longitude);
  if (lat1 === null || lng1 === null || lat2 === null || lng2 === null) return null;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const dφ = ((lat2 - lat1) * Math.PI) / 180;
  const dλ = ((lng2 - lng1) * Math.PI) / 180;
  const sinLat = Math.sin(dφ / 2);
  const sinLng = Math.sin(dλ / 2);
  const h = sinLat * sinLat + Math.cos(φ1) * Math.cos(φ2) * sinLng * sinLng;
  const meters = 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return Number.isFinite(meters) ? meters : null;
}

/**
 * Extract sequential GPS points from RF samples / raw rows.
 */
export function extractGpsPointsFromSamples(samples = [], { freshOnly = false } = {}) {
  const points = [];
  (Array.isArray(samples) ? samples : []).forEach((sample, index) => {
    const lat = getNumber(sample?.gps?.lat ?? sample?.gps_lat ?? sample?.lat);
    const lng = getNumber(sample?.gps?.lng ?? sample?.gps?.lon ?? sample?.gps_lon ?? sample?.lng ?? sample?.lon);
    if (!isValidLatLng({ lat, lng })) return;
    const status = String(sample?.gps?.gps_status || sample?.gps_status || "").toLowerCase();
    if (freshOnly) {
      if (status && status !== "fresh" && status !== "restored") return;
      // Legacy samples without gps_status: include once; distance still filters duplicates by segment length.
      if (!status) {
        // Prefer unique fix timestamps when available to avoid static-GPS inflation.
        // Keep point; caller distance logic skips zero-length segments.
      }
    }
    points.push({
      lat,
      lng,
      timestampMs: getNumber(sample?.timestamp ?? sample?.timestamp_ms),
      sampleIndex: index,
      accuracyM: getNumber(sample?.gps?.accuracy ?? sample?.gps_accuracy_m),
      gpsStatus: status || null,
      locationFixTimestampMs: getNumber(sample?.gps?.location_fix_timestamp_ms),
    });
  });
  return points;
}

/**
 * Driven distance from valid sequential GPS points (Haversine).
 * Skips segments longer than MAX_SEGMENT_METERS as likely GPS outliers.
 * When freshOnly points are provided, stale repeated coordinates do not extend distance.
 */
export function computeRouteDistanceFromGpsPoints(points = {}) {
  const list = Array.isArray(points) ? points : [];
  const valid = list.filter((p) => isValidLatLng(p));
  let distanceM = 0;
  let segmentsUsed = 0;
  let segmentsSkipped = 0;

  for (let i = 1; i < valid.length; i += 1) {
    const seg = haversineMeters(valid[i - 1], valid[i]);
    if (seg === null || !Number.isFinite(seg) || seg <= 0) continue;
    if (seg > MAX_SEGMENT_METERS) {
      segmentsSkipped += 1;
      continue;
    }
    // Zero-length / sub-meter chatter from identical stale fixes does not count.
    if (seg < 0.5) continue;
    distanceM += seg;
    segmentsUsed += 1;
  }

  const miles = distanceM / METERS_PER_MILE;
  const km = distanceM / 1000;

  return {
    distance_covered_m: Number(distanceM.toFixed(2)),
    distance_covered_km: Number(km.toFixed(4)),
    distance_covered_miles: Number(miles.toFixed(4)),
    gps_points_used_for_distance: valid.length,
    gps_segments_used: segmentsUsed,
    gps_segments_skipped_outlier: segmentsSkipped,
  };
}

export function computeRouteDistanceFromSamples(samples = []) {
  // Fresh/restored fixes only — never fall back to stale/lost coordinates for distance.
  const fresh = extractGpsPointsFromSamples(samples, { freshOnly: true });
  if (fresh.length < 2) {
    return {
      distance_covered_m: 0,
      distance_covered_km: 0,
      distance_covered_miles: 0,
      gps_points_used_for_distance: fresh.length,
      gps_segments_used: 0,
      gps_segments_skipped_outlier: 0,
      route_distance_status: fresh.length === 0 ? "insufficient_fresh_gps" : "insufficient_fresh_gps",
    };
  }
  return {
    ...computeRouteDistanceFromGpsPoints(fresh),
    route_distance_status: "fresh_gps_only",
  };
}
