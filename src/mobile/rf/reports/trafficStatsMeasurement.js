/**
 * Shared TrafficStats finite-measurement predicate (STEP 1J2-F9 / F9C).
 * First counter row has no previous sample → Mbps stay null and must NOT count
 * as a valid throughput / KPI / legend / map measured sample.
 *
 * Meaningful-movement floor (F9C): customer-facing "moved" requires measured
 * Mbps >= 0.01. Tiny incidental Android byte deltas that still display as
 * 0.00 / <0.01 Mbps are NOT meaningful Mobile/Total movement.
 * Raw byte counters are never altered — interpretation only.
 */

/** Display-aligned floor: formatThroughputValue uses 0.01 as the first non-"0.00" band. */
export const MEANINGFUL_TRAFFIC_STATS_MBPS = 0.01;

export function getFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * True only for a real measured Mbps value (including measured 0).
 * null / undefined / "" / NaN / non-numeric → not measured.
 * Never coerce null via Number(null) === 0.
 */
export function isMeasuredTrafficStatsMbps(value) {
  return getFiniteNumber(value) !== null;
}

export function collectMeasuredTrafficStatsMbps(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((v) => getFiniteNumber(v))
    .filter((v) => v !== null);
}

export function aggregateMeasuredTrafficStatsMbps(values = []) {
  const nums = collectMeasuredTrafficStatsMbps(values);
  if (!nums.length) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  return {
    count: nums.length,
    average: Number((sum / nums.length).toFixed(2)),
    minimum: Number(Math.min(...nums).toFixed(2)),
    maximum: Number(Math.max(...nums).toFixed(2)),
  };
}

/**
 * True when measured Mbps indicates meaningful interface traffic (not bookkeeping noise).
 * Accepts a stats object { max, avg } or a raw Mbps number.
 */
export function isMeaningfulTrafficStatsMbps(valueOrStats) {
  if (valueOrStats == null) return false;
  if (typeof valueOrStats === "object") {
    const max = getFiniteNumber(valueOrStats.max ?? valueOrStats.maximum);
    const avg = getFiniteNumber(valueOrStats.avg ?? valueOrStats.average);
    return (max != null && max >= MEANINGFUL_TRAFFIC_STATS_MBPS)
      || (avg != null && avg >= MEANINGFUL_TRAFFIC_STATS_MBPS);
  }
  const n = getFiniteNumber(valueOrStats);
  return n != null && n >= MEANINGFUL_TRAFFIC_STATS_MBPS;
}

export function hasMeaningfulTrafficStatsMovement(dlStats = null, ulStats = null) {
  return isMeaningfulTrafficStatsMbps(dlStats) || isMeaningfulTrafficStatsMbps(ulStats);
}

export default {
  getFiniteNumber,
  isMeasuredTrafficStatsMbps,
  collectMeasuredTrafficStatsMbps,
  aggregateMeasuredTrafficStatsMbps,
  MEANINGFUL_TRAFFIC_STATS_MBPS,
  isMeaningfulTrafficStatsMbps,
  hasMeaningfulTrafficStatsMovement,
};
