/**
 * CR1-D — GPS driven-route model.
 * Chronological recorded points only. No interpolate, snap, or fabricated coords.
 * Invalid / missing / out-of-range / 0,0 are rejected. Missing stays N/A.
 */

export const GPS_RENDER_MAX_POINTS = 500;
export const GPS_EMPTY_REASONS = Object.freeze({
  NOT_UPLOADED: "gps_not_uploaded",
  ARTIFACT_PENDING: "artifact_pending",
  NO_VALID_SAMPLES: "no_valid_samples",
  TILES_UNAVAILABLE: "tiles_unavailable",
  NOT_ASSOCIATED: "gps_not_associated",
});

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Reject missing, non-finite, out of range, and illegitimate 0/0.
 */
export function isValidGpsCoordinate(lat, lon) {
  const latitude = toNumber(lat);
  const longitude = toNumber(lon);
  if (latitude == null || longitude == null) return false;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return false;
  if (latitude === 0 && longitude === 0) return false;
  return true;
}

export function extractLatLon(raw) {
  if (!raw || typeof raw !== "object") return { lat: null, lon: null };
  const gps = raw.gps && typeof raw.gps === "object" ? raw.gps : raw;
  const lat = gps.latitude ?? gps.lat ?? gps.Latitude ?? raw.latitude ?? raw.lat;
  const lon = gps.longitude ?? gps.lon ?? gps.lng ?? gps.Longitude ?? raw.longitude ?? raw.lon ?? raw.lng;
  return { lat: toNumber(lat), lon: toNumber(lon) };
}

function extractTimestamp(raw) {
  if (!raw || typeof raw !== "object") return null;
  const gps = raw.gps && typeof raw.gps === "object" ? raw.gps : {};
  return (
    raw.timestamp_iso
    || raw.timestampIso
    || raw.timestamp
    || raw.t
    || gps.timestamp_iso
    || gps.timestamp
    || raw.recorded_at
    || null
  );
}

function extractAccuracy(raw) {
  if (!raw || typeof raw !== "object") return null;
  const gps = raw.gps && typeof raw.gps === "object" ? raw.gps : raw;
  return toNumber(
    gps.accuracy_m
    ?? gps.accuracy
    ?? gps.gps_accuracy_m
    ?? raw.gps_accuracy_m
    ?? raw.accuracy_m
    ?? raw.accuracy,
  );
}

function extractFreshness(raw) {
  if (!raw || typeof raw !== "object") return null;
  const gps = raw.gps && typeof raw.gps === "object" ? raw.gps : raw;
  return gps.gps_status || gps.freshness || raw.gps_status || raw.freshness || null;
}

/**
 * Haversine distance in meters. Returns null when either point is invalid.
 */
export function haversineMeters(a, b) {
  if (!a || !b) return null;
  if (!isValidGpsCoordinate(a.lat, a.lon) || !isValidGpsCoordinate(b.lat, b.lon)) return null;
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function parseGpsCsv(text) {
  const source = String(text || "");
  if (!source.trim()) return [];
  const lines = source.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());
  const latIdx = headers.findIndex((h) => h === "latitude" || h === "lat" || h === "gps_lat");
  const lonIdx = headers.findIndex((h) => h === "longitude" || h === "lon" || h === "lng" || h === "gps_lon");
  const timeIdx = headers.findIndex((h) => h === "timestamp_iso" || h === "timestamp" || h === "time");
  const accIdx = headers.findIndex((h) => h.includes("accuracy"));
  const statusIdx = headers.findIndex((h) => h === "gps_status" || h === "freshness");
  if (latIdx < 0 || lonIdx < 0) return [];
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]);
    rows.push({
      latitude: cols[latIdx],
      longitude: cols[lonIdx],
      timestamp_iso: timeIdx >= 0 ? cols[timeIdx] : null,
      accuracy_m: accIdx >= 0 ? cols[accIdx] : null,
      gps_status: statusIdx >= 0 ? cols[statusIdx] : null,
      sample_index: i,
    });
  }
  return rows;
}

function splitCsvLine(line) {
  const out = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out;
}

export function collectRawGpsSamples(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return collectRawGpsSamples(JSON.parse(trimmed));
      } catch {
        return [];
      }
    }
    return parseGpsCsv(payload);
  }
  if (typeof payload !== "object") return [];
  if (Array.isArray(payload.samples)) return payload.samples;
  if (Array.isArray(payload.trace?.samples)) return payload.trace.samples;
  if (Array.isArray(payload.gps?.samples)) return payload.gps.samples;
  if (Array.isArray(payload.points)) return payload.points;
  if (Array.isArray(payload.route)) return payload.route;
  return [];
}

function sortChronological(points) {
  return [...points].sort((a, b) => {
    const ia = a.sample_index != null ? Number(a.sample_index) : null;
    const ib = b.sample_index != null ? Number(b.sample_index) : null;
    if (Number.isFinite(ia) && Number.isFinite(ib) && ia !== ib) return ia - ib;
    const ta = a.timestamp ? Date.parse(a.timestamp) : NaN;
    const tb = b.timestamp ? Date.parse(b.timestamp) : NaN;
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    return (a.raw_index ?? 0) - (b.raw_index ?? 0);
  });
}

/**
 * Downsample for rendering only. Always keep first and last valid. Raw list is untouched.
 */
export function downsampleForRender(points, maxPoints = GPS_RENDER_MAX_POINTS) {
  const list = Array.isArray(points) ? points : [];
  if (list.length <= maxPoints) {
    return { points: list, downsampled: false, render_count: list.length, raw_count: list.length };
  }
  const last = list.length - 1;
  const step = Math.ceil(list.length / (maxPoints - 1));
  const picked = [];
  const seen = new Set();
  for (let i = 0; i < list.length; i += step) {
    if (!seen.has(i)) {
      seen.add(i);
      picked.push(list[i]);
    }
  }
  if (!seen.has(last)) picked.push(list[last]);
  return {
    points: picked,
    downsampled: true,
    render_count: picked.length,
    raw_count: list.length,
  };
}

export function buildGpsRouteModel(input = {}) {
  const rawSamples = collectRawGpsSamples(input.payload ?? input.samples ?? input);
  const classified = rawSamples.map((raw, index) => {
    const { lat, lon } = extractLatLon(raw);
    const valid = isValidGpsCoordinate(lat, lon);
    return {
      lat: valid ? lat : null,
      lon: valid ? lon : null,
      timestamp: extractTimestamp(raw),
      accuracy_m: extractAccuracy(raw),
      freshness: extractFreshness(raw),
      sample_index: raw?.sample_index ?? raw?.sampleIndex ?? index + 1,
      raw_index: index,
      valid,
    };
  });
  const valid = sortChronological(classified.filter((p) => p.valid));
  const invalidCount = classified.length - valid.length;
  let distanceM = null;
  if (valid.length >= 2) {
    distanceM = 0;
    for (let i = 1; i < valid.length; i += 1) {
      const d = haversineMeters(valid[i - 1], valid[i]);
      if (d != null) distanceM += d;
    }
  }
  const render = downsampleForRender(valid, input.maxRenderPoints || GPS_RENDER_MAX_POINTS);
  const start = valid[0] || null;
  const end = valid.length ? valid[valid.length - 1] : null;
  const accuracies = valid.map((p) => p.accuracy_m).filter((v) => v != null);
  const accuracyAvg = accuracies.length
    ? Math.round((accuracies.reduce((s, v) => s + v, 0) / accuracies.length) * 10) / 10
    : null;

  let emptyReason = null;
  if (!classified.length) {
    emptyReason = input.artifactPending
      ? GPS_EMPTY_REASONS.ARTIFACT_PENDING
      : (input.uploaded === false ? GPS_EMPTY_REASONS.NOT_UPLOADED : GPS_EMPTY_REASONS.NOT_UPLOADED);
  } else if (!valid.length) {
    emptyReason = GPS_EMPTY_REASONS.NO_VALID_SAMPLES;
  }

  return {
    raw_sample_count: classified.length || null,
    valid_count: valid.length || (classified.length ? 0 : null),
    invalid_count: classified.length ? invalidCount : null,
    start: start ? { lat: start.lat, lon: start.lon, timestamp: start.timestamp } : null,
    end: end ? { lat: end.lat, lon: end.lon, timestamp: end.timestamp } : null,
    start_time: start?.timestamp || null,
    end_time: end?.timestamp || null,
    distance_m: distanceM,
    accuracy_m: accuracyAvg,
    freshness: start?.freshness || end?.freshness || null,
    render_points: render.points.map((p) => [p.lat, p.lon]),
    downsampled: render.downsampled,
    render_count: render.render_count,
    raw_valid_count: render.raw_count,
    empty_reason: emptyReason,
    labeled_synthetic: input.labeled_synthetic === true,
  };
}

export function emptyGpsRouteState(reason = GPS_EMPTY_REASONS.NOT_UPLOADED) {
  return {
    raw_sample_count: null,
    valid_count: null,
    invalid_count: null,
    start: null,
    end: null,
    start_time: null,
    end_time: null,
    distance_m: null,
    accuracy_m: null,
    freshness: null,
    render_points: [],
    downsampled: false,
    render_count: 0,
    raw_valid_count: 0,
    empty_reason: reason,
    labeled_synthetic: false,
  };
}

export default {
  GPS_RENDER_MAX_POINTS,
  GPS_EMPTY_REASONS,
  isValidGpsCoordinate,
  extractLatLon,
  haversineMeters,
  parseGpsCsv,
  collectRawGpsSamples,
  downsampleForRender,
  buildGpsRouteModel,
  emptyGpsRouteState,
};
