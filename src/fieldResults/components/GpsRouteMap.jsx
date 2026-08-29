/**
 * CR1-D — GPS driven-route map for a single Field Result.
 * Loads the route only when this panel mounts (not from the list).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { MapInvalidateSize, TileLoadGuard } from "../../components/maps/BasemapTileGuard.jsx";
import { formatCountOrNA, formatMetric } from "../models/fieldResultTypes.js";
import { GPS_EMPTY_REASONS, emptyGpsRouteState } from "../gps/gpsRouteModel.js";
import { loadGpsRouteForRun } from "../gps/loadGpsRoute.js";

const startIcon = new L.DivIcon({
  className: "bdfr-gps-marker",
  html: '<div class="bdfr-gps-dot bdfr-gps-dot-start">S</div>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const endIcon = new L.DivIcon({
  className: "bdfr-gps-marker",
  html: '<div class="bdfr-gps-dot bdfr-gps-dot-end">E</div>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

function FitBounds({ points, extraKey = 0 }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !points?.length) return undefined;
    const bounds = L.latLngBounds(points);
    if (!bounds.isValid()) return undefined;
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
    return undefined;
  }, [extraKey, map, points]);
  return null;
}

function emptyCopy(reason) {
  if (reason === GPS_EMPTY_REASONS.ARTIFACT_PENDING) return "GPS artifact is pending upload.";
  if (reason === GPS_EMPTY_REASONS.NO_VALID_SAMPLES) return "No valid GPS samples for this run.";
  if (reason === GPS_EMPTY_REASONS.TILES_UNAVAILABLE) return "Map tiles unavailable.";
  if (reason === GPS_EMPTY_REASONS.NOT_ASSOCIATED) return "GPS artifact is not associated with this run.";
  return "GPS was not uploaded for this run.";
}

export default function GpsRouteMap({ result, repository, actor }) {
  const [route, setRoute] = useState(() => emptyGpsRouteState());
  const [status, setStatus] = useState("idle");
  const [tilesFailed, setTilesFailed] = useState(false);
  const [fitKey, setFitKey] = useState(0);
  const loadedFor = useRef(null);

  const load = useCallback(async () => {
    if (!result?.id) return;
    setStatus("loading");
    try {
      if (typeof repository?.getGpsRoute === "function") {
        const res = await repository.getGpsRoute(result.id, actor || {});
        if (res?.ok && res.route) {
          setRoute(res.route);
          setStatus("ready");
          return;
        }
      }
      const loaded = await loadGpsRouteForRun({
        run: result,
        artifacts: result.artifacts,
      });
      setRoute(loaded.route || emptyGpsRouteState());
      setStatus("ready");
    } catch {
      setRoute(emptyGpsRouteState(GPS_EMPTY_REASONS.NOT_UPLOADED));
      setStatus("ready");
    }
  }, [actor, repository, result]);

  useEffect(() => {
    if (!result?.id) return undefined;
    if (loadedFor.current === result.id) return undefined;
    loadedFor.current = result.id;
    load();
    return undefined;
  }, [load, result?.id]);

  const points = route.render_points || [];
  const showMap = points.length >= 1 && !tilesFailed;
  const start = points[0];
  const end = points.length ? points[points.length - 1] : null;

  const emptyReason = tilesFailed ? GPS_EMPTY_REASONS.TILES_UNAVAILABLE : route.empty_reason;

  const meta = useMemo(() => ([
    { label: "Valid samples", value: formatCountOrNA(route.valid_count) },
    { label: "Invalid samples", value: formatCountOrNA(route.invalid_count) },
    { label: "Start time", value: route.start_time || "N/A" },
    { label: "End time", value: route.end_time || "N/A" },
    { label: "Distance", value: Number.isFinite(Number(route.distance_m)) ? `${Number(route.distance_m).toFixed(1)} m` : "unavailable" },
    { label: "Accuracy", value: formatMetric(route.accuracy_m, "m") },
    { label: "Freshness", value: route.freshness || "N/A" },
  ]), [route]);

  return (
    <div className="bdfr-gps-map-wrap">
      <div className="bdfr-gps-map-toolbar">
        <strong>GPS driven route</strong>
        <div className="bdfr-filter-actions">
          <button type="button" className="bdfr-btn bdfr-btn-secondary" onClick={() => setFitKey((k) => k + 1)} disabled={!showMap}>
            Fit Route
          </button>
          <button
            type="button"
            className="bdfr-btn bdfr-btn-secondary"
            disabled={!showMap}
            onClick={() => setFitKey((k) => k + 1)}
          >
            Start / End
          </button>
        </div>
      </div>
      {route.downsampled && (
        <p className="bdfr-hint" role="status">
          Route is downsampled for display ({route.render_count} of {route.raw_valid_count} valid points). Raw samples are unchanged for download.
        </p>
      )}
      {route.labeled_synthetic && (
        <p className="bdfr-synth-note" role="status">SYNTHETIC fixture path — not physical APK GPS proof.</p>
      )}
      <div className="bdfr-meta-grid">
        {meta.map((item) => (
          <div className="bdfr-meta-item" key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
      {status === "loading" && <p className="bdfr-hint">Loading GPS route…</p>}
      {showMap ? (
        <div className="bdfr-gps-map bd-fe-basemap">
          <MapContainer
            center={start}
            zoom={15}
            scrollWheelZoom
            style={{ height: "100%", width: "100%" }}
          >
            <TileLayer
              attribution="&copy; OpenStreetMap contributors"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapInvalidateSize extraKey={fitKey} />
            <TileLoadGuard
              onStatus={(tileStatus) => {
                if (tileStatus?.failed) setTilesFailed(true);
                if (tileStatus && tileStatus.failed === false) setTilesFailed(false);
              }}
            />
            <FitBounds points={points} extraKey={fitKey} />
            {points.length >= 2 && (
              <Polyline positions={points} pathOptions={{ color: "#00d4ff", weight: 4 }} />
            )}
            {start && <Marker position={start} icon={startIcon} />}
            {end && <Marker position={end} icon={endIcon} />}
          </MapContainer>
        </div>
      ) : (
        <div className="bdfr-gps-empty" role="status">
          {emptyCopy(emptyReason)}
        </div>
      )}
    </div>
  );
}
