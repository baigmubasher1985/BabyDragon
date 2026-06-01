// src/mobile/MobileRouteMap.jsx

import React, { useEffect, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  CircleMarker,
  Polyline,
  Popup,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import CellSectorLayer from "../components/maps/CellSectorLayer";
import {
  buildGridFeature,
  classifyGpsTrail,
  extractRoutePoints,
  formatMeters,
  formatRouteMode,
  getFeatureCenter,
  getGridLabel,
  getGridMarket,
  getRouteLength,
  getRouteName,
  getTaskGpsPoints,
  parseRouteGeojson,
} from "./mobileRouteUtils";

const DEFAULT_CENTER = [32.7767, -96.797];
const DEFAULT_ZOOM = 10;
const ROUTE_DISTANCE_THRESHOLD_M = 75;

export default function MobileRouteMap({ row }) {
  const gridFeature = useMemo(() => buildGridFeature(row?.grid), [row?.grid]);
  const routeGeojson = useMemo(() => parseRouteGeojson(row?.route), [row?.route]);
  const gpsPoints = useMemo(() => getTaskGpsPoints(row?.updates || []), [row?.updates]);
  const trail = useMemo(
    () => classifyGpsTrail(gpsPoints, routeGeojson, ROUTE_DISTANCE_THRESHOLD_M),
    [gpsPoints, routeGeojson]
  );
  const latestGps = gpsPoints[gpsPoints.length - 1] || null;
  const routePoints = useMemo(() => extractRoutePoints(routeGeojson), [routeGeojson]);

  const mapStats = {
    routePoints: routePoints.length,
    gpsPoints: gpsPoints.length,
    offRoute: trail.offRouteCount,
    distance: formatMeters(getRouteLength(row?.route)),
  };

  return (
    <section style={styles.card}>
      <div style={styles.mapTopBar}>
        <div>
          <p style={styles.eyebrow}>Route Map</p>
          <h3 style={styles.mapTitle}>{getGridLabel(row?.grid)} • {getGridMarket(row?.grid, row?.task)}</h3>
        </div>
        <span style={row?.route ? styles.readyPill : styles.warningPill}>
          {row?.route ? "Route Ready" : "Grid Only"}
        </span>
      </div>

      <div style={styles.mapShell}>
        <MapContainer
          center={DEFAULT_CENTER}
          zoom={DEFAULT_ZOOM}
          style={styles.map}
          scrollWheelZoom
          tap
        >
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <MapBoundsController
            gridFeature={gridFeature}
            routeGeojson={routeGeojson}
            gpsPoints={gpsPoints}
          />

          <CellSectorLayer
            market={getGridMarket(row?.grid, row?.task)}
            showSites
            showSectors
            showLegend
            maxRecords={1200}
            sectorRadiusM={550}
          />

          {gridFeature && (
            <GeoJSON
              key={`route-grid-${getGridLabel(row?.grid)}`}
              data={gridFeature}
              style={() => ({
                color: "#facc15",
                weight: 3,
                fillColor: "#facc15",
                fillOpacity: 0.16,
              })}
            >
              <Popup>
                <strong>{getGridLabel(row?.grid)}</strong>
                <br />
                {getGridMarket(row?.grid, row?.task)}
              </Popup>
            </GeoJSON>
          )}

          {routeGeojson && <RouteLineLayer geojson={routeGeojson} />}

          {trail.onRouteSegments.map((segment, index) => (
            <Polyline
              key={`on-route-${index}`}
              positions={segment.map((point) => [point.lat, point.lng])}
              pathOptions={{ color: "#22c55e", weight: 6, opacity: 0.95 }}
            />
          ))}

          {trail.offRouteSegments.map((segment, index) => (
            <Polyline
              key={`off-route-${index}`}
              positions={segment.map((point) => [point.lat, point.lng])}
              pathOptions={{ color: "#f97316", weight: 6, opacity: 0.95 }}
            />
          ))}

          {latestGps && (
            <CircleMarker
              center={[latestGps.lat, latestGps.lng]}
              radius={7}
              pathOptions={{ color: "#ffffff", fillColor: "#06b6d4", fillOpacity: 1, weight: 3 }}
            >
              <Popup>
                <strong>FE GPS</strong>
                <br />
                {latestGps.lat.toFixed(5)}, {latestGps.lng.toFixed(5)}
              </Popup>
            </CircleMarker>
          )}
        </MapContainer>
      </div>

      <div style={styles.metaStrip}>
        <span><b>Route</b> {row?.route ? getRouteName(row.route, row.grid) : "Not linked"}</span>
        <span><b>Mode</b> {row?.route ? formatRouteMode(row.route) : "Grid only"}</span>
        <span><b>Route pts</b> {mapStats.routePoints}</span>
        <span><b>GPS pts</b> {mapStats.gpsPoints}</span>
        <span><b>Off route</b> {mapStats.offRoute}</span>
        <span><b>Length</b> {mapStats.distance}</span>
      </div>

      <div style={styles.legendRow}>
        <LegendDot color="#facc15" label="Grid" />
        <LegendDot color="#38bdf8" label="Saved route" />
        <LegendDot color="#22c55e" label="Driven on route" />
        <LegendDot color="#f97316" label="Off route" />
        <LegendDot color="#06b6d4" label="FE GPS" />
      </div>
    </section>
  );
}

function LegendDot({ color, label }) {
  return (
    <span style={styles.legendItem}>
      <i style={{ ...styles.legendDot, background: color }} />
      {label}
    </span>
  );
}

function MapBoundsController({ gridFeature, routeGeojson, gpsPoints }) {
  const map = useMap();

  useEffect(() => {
    const layers = [];

    if (gridFeature) layers.push(L.geoJSON(gridFeature));
    if (routeGeojson) layers.push(L.geoJSON(routeGeojson));

    (gpsPoints || []).forEach((point) => {
      layers.push(L.circleMarker([point.lat, point.lng]));
    });

    if (!layers.length) {
      const center = gridFeature ? getFeatureCenter(gridFeature) : null;
      if (center) map.setView([center.lat, center.lng], 15);
      return;
    }

    const group = L.featureGroup(layers);
    const bounds = group.getBounds();

    if (bounds.isValid()) {
      map.fitBounds(bounds, {
        padding: [22, 22],
        maxZoom: 17,
      });
    }
  }, [map, gridFeature, routeGeojson, gpsPoints]);

  return null;
}

function RouteLineLayer({ geojson }) {
  const map = useMap();

  useEffect(() => {
    if (!geojson) return undefined;

    const routeLayer = L.geoJSON(geojson, {
      style: {
        color: "#38bdf8",
        weight: 6,
        opacity: 0.98,
        lineCap: "round",
        lineJoin: "round",
      },
      pointToLayer: (_feature, latlng) => {
        return L.circleMarker(latlng, {
          radius: 4,
          color: "#38bdf8",
          fillColor: "#38bdf8",
          fillOpacity: 1,
        });
      },
    }).addTo(map);

    routeLayer.bringToFront();

    return () => {
      map.removeLayer(routeLayer);
    };
  }, [map, geojson]);

  return null;
}

const styles = {
  card: {
    marginTop: 12,
    padding: 10,
    border: "1px solid rgba(56, 189, 248, 0.28)",
    borderRadius: 18,
    background: "rgba(8, 47, 73, 0.18)",
  },
  mapTopBar: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 10,
  },
  eyebrow: {
    margin: 0,
    color: "#93c5fd",
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
  },
  mapTitle: {
    margin: "4px 0 0",
    color: "#f8fafc",
    fontSize: 14,
    lineHeight: 1.25,
  },
  readyPill: {
    flex: "0 0 auto",
    padding: "7px 10px",
    borderRadius: 999,
    background: "rgba(34, 197, 94, 0.2)",
    color: "#bbf7d0",
    fontSize: 10,
    fontWeight: 900,
  },
  warningPill: {
    flex: "0 0 auto",
    padding: "7px 10px",
    borderRadius: 999,
    background: "rgba(251, 191, 36, 0.17)",
    color: "#fde68a",
    fontSize: 10,
    fontWeight: 900,
  },
  mapShell: {
    minHeight: 420,
    overflow: "hidden",
    border: "1px solid rgba(148, 163, 184, 0.22)",
    borderRadius: 16,
    background: "#0f172a",
  },
  map: {
    width: "100%",
    height: 420,
  },
  metaStrip: {
    display: "flex",
    flexWrap: "wrap",
    gap: 7,
    marginTop: 9,
  },
  legendRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 9,
    color: "#cbd5e1",
    fontSize: 10,
    fontWeight: 800,
  },
  legendItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
  },
  legendDot: {
    width: 9,
    height: 9,
    borderRadius: 99,
    display: "inline-block",
  },
};

