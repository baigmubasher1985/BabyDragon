/**
 * Shared report-side route quality model (STEP 1J2-F9).
 * Uses the same eligible GPS segments as map rendering.
 * Raw GPS coordinates in CSV/JSON are never mutated.
 */

import { haversineMeters, extractGpsPointsFromSamples, isValidLatLng } from "../utils/gpsDistanceUtils.js";
import {
  attachRoutePointMeta,
  segmentRoutePoints,
} from "./excelRouteSegmentation.js";

const METERS_PER_MILE = 1609.344;
/** Bounding-extent / filtered-distance gate for stationary classification. */
const STATIONARY_EXTENT_M = 40;
const STATIONARY_FILTERED_DISTANCE_M = 25;
const MIN_MOBILITY_FILTERED_M = 40;

function getNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function routeExtentMeters(points = []) {
  const valid = (Array.isArray(points) ? points : []).filter((p) => isValidLatLng(p));
  if (valid.length <= 1) return 0;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  valid.forEach((p) => {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  });
  const midLat = (minLat + maxLat) / 2;
  const latExtentM = haversineMeters({ lat: minLat, lng: midLngSafe(minLng, maxLng) }, { lat: maxLat, lng: midLngSafe(minLng, maxLng) }) || 0;
  const lngExtentM = haversineMeters({ lat: midLat, lng: minLng }, { lat: midLat, lng: maxLng }) || 0;
  return Math.sqrt(latExtentM * latExtentM + lngExtentM * lngExtentM);
}

function midLngSafe(a, b) {
  return (a + b) / 2;
}

function sumAcceptedSegmentMeters(segments = []) {
  let meters = 0;
  let accepted = 0;
  let rejectedContribution = 0;
  (Array.isArray(segments) ? segments : []).forEach((seg) => {
    for (let i = 1; i < seg.length; i += 1) {
      const m = haversineMeters(seg[i - 1], seg[i]);
      if (m == null || !Number.isFinite(m) || m < 0.5) continue;
      meters += m;
      accepted += 1;
    }
  });
  return { meters, acceptedSegments: accepted, rejectedContribution };
}

function sumRawJitterMeters(points = []) {
  let meters = 0;
  const list = (Array.isArray(points) ? points : []).filter((p) => isValidLatLng(p));
  for (let i = 1; i < list.length; i += 1) {
    const m = haversineMeters(list[i - 1], list[i]);
    if (m == null || !Number.isFinite(m) || m <= 0) continue;
    meters += m;
  }
  return meters;
}

function countGpsStatuses(samples = []) {
  let fresh = 0;
  let restored = 0;
  let stale = 0;
  let lost = 0;
  let unavailable = 0;
  (Array.isArray(samples) ? samples : []).forEach((sample) => {
    const status = String(sample?.gps?.gps_status || sample?.gps_status || "").toLowerCase();
    if (status === "fresh") fresh += 1;
    else if (status === "restored") restored += 1;
    else if (status === "stale") stale += 1;
    else if (status === "lost") lost += 1;
    else if (status === "unavailable") unavailable += 1;
  });
  return { fresh, restored, stale, lost, unavailable };
}

/**
 * Classify route from filtered segment truth — never from raw jitter distance alone.
 */
export function classifyFilteredRoute({
  eligiblePointCount = 0,
  filteredDistanceM = 0,
  extentM = 0,
  statusCounts = {},
} = {}) {
  const freshLike = (statusCounts.fresh || 0) + (statusCounts.restored || 0);
  if (freshLike <= 0) {
    if ((statusCounts.stale || 0) > 0 || (statusCounts.lost || 0) > 0) return "GPS stale";
    return "GPS unavailable";
  }
  if (eligiblePointCount < 2) return "Insufficient fresh GPS";
  if (
    filteredDistanceM < STATIONARY_FILTERED_DISTANCE_M
    || extentM < STATIONARY_EXTENT_M
  ) {
    return "Stationary / limited route spread";
  }
  if (filteredDistanceM < MIN_MOBILITY_FILTERED_M) {
    return "Stationary / limited route spread";
  }
  return "Mobility route recorded";
}

/**
 * Shared filtered route truth for distance, status, maps, and diagnostics.
 */
export function computeFilteredRouteTruth(samples = []) {
  const statusCounts = countGpsStatuses(samples);
  const rawPoints = extractGpsPointsFromSamples(samples, { freshOnly: false });
  const eligible = extractGpsPointsFromSamples(samples, { freshOnly: true }).map((p, index) => ({
    ...p,
    ...attachRoutePointMeta({
      ...p,
      gps_status: p.gpsStatus,
      gps_accuracy_m: p.accuracyM,
      location_fix_timestamp_ms: p.locationFixTimestampMs,
      timestamp_ms: p.timestampMs,
      sample_index: p.sampleIndex ?? index,
      gps_provider: p.gpsProvider,
    }, index),
  }));

  const segmented = segmentRoutePoints(eligible);
  const accepted = sumAcceptedSegmentMeters(segmented.segments);
  const rawJitterM = sumRawJitterMeters(eligible);
  const rejectedDistanceM = Math.max(0, rawJitterM - accepted.meters);
  const extentM = routeExtentMeters(eligible);
  const routeStatus = classifyFilteredRoute({
    eligiblePointCount: eligible.length,
    filteredDistanceM: accepted.meters,
    extentM,
    statusCounts,
  });
  const stationaryDriven = routeStatus === "Stationary / limited route spread";

  const miles = stationaryDriven ? 0 : (accepted.meters / METERS_PER_MILE);
  const km = stationaryDriven ? 0 : (accepted.meters / 1000);
  const positionalVariationM = Number(Math.max(rawJitterM, extentM).toFixed(2));

  return {
    // Customer Driven Distance: zero for stationary/limited spread; filtered segments otherwise.
    distance_covered_m: Number((stationaryDriven ? 0 : accepted.meters).toFixed(2)),
    distance_covered_km: Number(km.toFixed(4)),
    distance_covered_miles: Number(miles.toFixed(4)),
    gps_positional_variation_m: positionalVariationM,
    gps_points_used_for_distance: eligible.length,
    gps_segments_used: accepted.acceptedSegments,
    gps_segments_skipped_outlier: segmented.meta?.rejectedConnectionCount || 0,
    route_distance_status: "filtered_route_segments",
    route_status: routeStatus,
    route_classification: routeStatus,
    stationary: stationaryDriven,
    diagnostics: {
      raw_gps_point_count: rawPoints.length,
      eligible_route_point_count: eligible.length,
      rendered_segment_count: segmented.meta?.renderedSegmentCount || 0,
      rejected_connection_count: segmented.meta?.rejectedConnectionCount || 0,
      rejected_distance_contribution_m: Number(rejectedDistanceM.toFixed(2)),
      filtered_distance_m: Number(accepted.meters.toFixed(2)),
      raw_displacement_jitter_distance_m: Number(rawJitterM.toFixed(2)),
      route_extent_m: Number(extentM.toFixed(2)),
      gps_positional_variation_m: positionalVariationM,
      driven_distance_m: Number((stationaryDriven ? 0 : accepted.meters).toFixed(2)),
      rejection_reason_counts: segmented.meta?.rejectionReasonCounts || {},
      classification_rule: "Stationary when filtered distance < 40 m or extent < 40 m (or < 25 m filtered). Driven Distance uses filtered segments only; GPS Positional Variation exposes raw jitter/extent without claiming drive.",
    },
  };
}

export default {
  classifyFilteredRoute,
  computeFilteredRouteTruth,
};
