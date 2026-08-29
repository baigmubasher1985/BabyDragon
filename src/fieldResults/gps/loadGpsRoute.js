/**
 * CR1-D — on-demand GPS route load for a single run.
 * List views must not call this. Parse artifact / summary only; never fabricate points.
 */

import {
  buildGpsRouteModel,
  emptyGpsRouteState,
  GPS_EMPTY_REASONS,
} from "./gpsRouteModel.js";

function artifactReady(art) {
  return art && art.available !== false && art.missing !== true && art.upload_status === "uploaded";
}

function pickGpsArtifacts(artifacts = []) {
  const list = Array.isArray(artifacts) ? artifacts : [];
  const preferred = ["gps_csv", "rf_csv", "unified_json", "package_zip"];
  const scored = list.filter((a) => {
    const type = String(a?.artifact_type || "").toLowerCase();
    const name = String(a?.filename || a?.original_file_name || "").toLowerCase();
    return preferred.includes(type)
      || name.includes("rf_gps")
      || name.includes("gps_trace")
      || name.endsWith("_report.json")
      || name.endsWith("report.json");
  });
  scored.sort((a, b) => {
    const at = preferred.indexOf(String(a.artifact_type || "").toLowerCase());
    const bt = preferred.indexOf(String(b.artifact_type || "").toLowerCase());
    return (at === -1 ? 99 : at) - (bt === -1 ? 99 : bt);
  });
  return scored;
}

export async function loadGpsRouteForRun({
  run,
  artifacts,
  requestArtifactText,
} = {}) {
  const labeled = run?.labeled_synthetic === true;
  if (run?.gps_route?.render_points?.length) {
    return { ok: true, route: { ...run.gps_route, labeled_synthetic: labeled } };
  }
  if (Array.isArray(run?.gps_trace_points) && run.gps_trace_points.length) {
    return { ok: true, route: buildGpsRouteModel({ payload: run.gps_trace_points, labeled_synthetic: labeled }) };
  }

  const summary = run?.gps_summary;
  const candidates = pickGpsArtifacts(artifacts || run?.artifacts || []);
  const pending = candidates.find((a) => !artifactReady(a));
  const ready = candidates.filter((a) => artifactReady(a) && String(a.artifact_type || "") !== "package_zip");
  if (!ready.length && pending) {
    return { ok: true, route: emptyGpsRouteState(GPS_EMPTY_REASONS.ARTIFACT_PENDING) };
  }

  if (typeof requestArtifactText === "function") {
    for (const art of ready) {
      const fetched = await requestArtifactText(art);
      if (fetched?.ok && fetched.json) {
        const route = buildGpsRouteModel({ payload: fetched.json, labeled_synthetic: labeled });
        if (route.valid_count) return { ok: true, route, source: art.artifact_type };
      }
      if (fetched?.ok && fetched.text) {
        const route = buildGpsRouteModel({ payload: fetched.text, labeled_synthetic: labeled });
        if (route.valid_count) return { ok: true, route, source: art.artifact_type };
      }
    }
  }

  if (summary?.start?.lat != null && summary?.end?.lat != null) {
    const points = [summary.start, summary.end];
    const route = buildGpsRouteModel({
      payload: points.map((p, i) => ({ latitude: p.lat ?? p.latitude, longitude: p.lon ?? p.lng ?? p.longitude, timestamp_iso: i === 0 ? summary.start_time : summary.end_time })),
      labeled_synthetic: labeled,
    });
    if (route.valid_count) {
      return {
        ok: true,
        route: {
          ...route,
          raw_sample_count: summary.sample_count ?? route.raw_sample_count,
          valid_count: summary.valid_count ?? route.valid_count,
          invalid_count: summary.invalid_count ?? route.invalid_count,
          distance_m: summary.distance_m ?? route.distance_m,
          from_summary_only: true,
        },
      };
    }
  }

  if (!candidates.length) {
    return { ok: true, route: emptyGpsRouteState(GPS_EMPTY_REASONS.NOT_UPLOADED) };
  }
  return { ok: true, route: emptyGpsRouteState(GPS_EMPTY_REASONS.NO_VALID_SAMPLES) };
}

export default { loadGpsRouteForRun };
