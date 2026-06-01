import { useEffect, useMemo, useState } from "react";
import {
  Circle,
  MapContainer,
  Marker,
  Polygon,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import CellSectorLayer from "./maps/CellSectorLayer";

const DEFAULT_CENTER = [32.7767, -96.7970];
const DEFAULT_ZOOM = 15;

const feMarkerIcon = L.divIcon({
  className: "bd-fe-live-marker",
  html: `<div style="width:18px;height:18px;border-radius:999px;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 8px rgba(37,99,235,.22),0 8px 18px rgba(15,23,42,.28);"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function parseMaybeJson(value) {
  if (!value) return null;

  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

function looksLikeLngLat(pair) {
  if (!Array.isArray(pair) || pair.length < 2) return false;
  const a = Number(pair[0]);
  const b = Number(pair[1]);

  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;

  // Longitude often has absolute value above 90, latitude never does.
  if (Math.abs(a) > 90 && Math.abs(b) <= 90) return true;

  // Around Texas/US, stored KML/GeoJSON usually arrives as [-96, 33].
  if (a < -60 && a > -180 && b > 10 && b < 75) return true;

  return false;
}

function normalizePair(pair) {
  if (!Array.isArray(pair) || pair.length < 2) return null;

  const a = Number(pair[0]);
  const b = Number(pair[1]);

  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  if (looksLikeLngLat(pair)) return [b, a];
  return [a, b];
}

function normalizeRing(ring) {
  if (!Array.isArray(ring)) return [];

  return ring
    .map((point) => {
      if (Array.isArray(point)) return normalizePair(point);

      if (point && typeof point === "object") {
        const lat = point.lat ?? point.latitude ?? point.Latitude ?? point.LAT;
        const lng =
          point.lng ??
          point.lon ??
          point.longitude ??
          point.Longitude ??
          point.LON ??
          point.LNG;

        if (lat !== undefined && lng !== undefined) {
          return [Number(lat), Number(lng)];
        }
      }

      return null;
    })
    .filter((point) => {
      return (
        Array.isArray(point) &&
        point.length === 2 &&
        Number.isFinite(point[0]) &&
        Number.isFinite(point[1])
      );
    });
}

function parseKmlCoordinateString(value) {
  if (typeof value !== "string") return [];

  const pairs = value
    .trim()
    .split(/\s+/)
    .map((chunk) => {
      const parts = chunk.split(",").map(Number);
      if (parts.length < 2) return null;
      // KML format is lon,lat,alt.
      return [parts[1], parts[0]];
    })
    .filter((point) => {
      return (
        Array.isArray(point) &&
        point.length === 2 &&
        Number.isFinite(point[0]) &&
        Number.isFinite(point[1])
      );
    });

  return pairs.length >= 3 ? pairs : [];
}

function extractGeometryCandidate(gridLike) {
  if (!gridLike) return null;

  const grid = gridLike.gridRecord || gridLike.grid || gridLike;

  return (
    gridLike.gridBoundary ||
    gridLike.boundary ||
    gridLike.geometry ||
    gridLike.geojson ||
    gridLike.geo_json ||
    gridLike.polygon ||
    gridLike.coordinates ||
    grid?.boundary ||
    grid?.geojson ||
    grid?.geo_json ||
    grid?.geometry ||
    grid?.geom ||
    grid?.polygon ||
    grid?.coordinates ||
    grid?.shape ||
    grid?.kml_coordinates ||
    grid?.kml ||
    null
  );
}

function geometryToRings(candidate) {
  const value = parseMaybeJson(candidate);

  if (!value) return [];

  if (typeof value === "string") {
    const kmlRing = parseKmlCoordinateString(value);
    return kmlRing.length ? [kmlRing] : [];
  }

  if (value.type === "FeatureCollection") {
    return (value.features || []).flatMap((feature) => geometryToRings(feature));
  }

  if (value.type === "Feature") {
    return geometryToRings(value.geometry || value.properties?.geometry);
  }

  if (value.type === "Polygon") {
    const outerRing = value.coordinates?.[0] || [];
    const ring = normalizeRing(outerRing);
    return ring.length >= 3 ? [ring] : [];
  }

  if (value.type === "MultiPolygon") {
    return (value.coordinates || [])
      .map((polygon) => normalizeRing(polygon?.[0] || []))
      .filter((ring) => ring.length >= 3);
  }

  if (value.coordinates) {
    return geometryToRings({ type: value.type || "Polygon", coordinates: value.coordinates });
  }

  if (Array.isArray(value)) {
    // Ring: [[lat,lng], [lat,lng], ...]
    if (Array.isArray(value[0]) && typeof value[0][0] === "number") {
      const ring = normalizeRing(value);
      return ring.length >= 3 ? [ring] : [];
    }

    // Polygon wrapper: [[[lng,lat], ...]]
    if (Array.isArray(value[0]) && Array.isArray(value[0][0])) {
      return value
        .map((ringOrPolygon) => {
          if (Array.isArray(ringOrPolygon[0]) && typeof ringOrPolygon[0][0] === "number") {
            return normalizeRing(ringOrPolygon);
          }

          if (Array.isArray(ringOrPolygon[0]) && Array.isArray(ringOrPolygon[0][0])) {
            return normalizeRing(ringOrPolygon[0]);
          }

          return [];
        })
        .filter((ring) => ring.length >= 3);
    }
  }

  return [];
}

function getGridName(gridLike, index) {
  const grid = gridLike?.gridRecord || gridLike?.grid || gridLike || {};

  return (
    gridLike?.gridName ||
    gridLike?.name ||
    grid?.name ||
    grid?.grid_name ||
    grid?.grid_id ||
    grid?.Real_GridCode ||
    grid?.real_grid_code ||
    `Assigned Grid ${index + 1}`
  );
}

function getGridMarket(gridLike) {
  const grid = gridLike?.gridRecord || gridLike?.grid || gridLike || {};
  return gridLike?.gridMarket || gridLike?.market || grid?.market || grid?.Market || "";
}

function MapBoundsController({ position, gridRings }) {
  const map = useMap();

  useEffect(() => {
    const points = [];

    if (position?.latitude && position?.longitude) {
      points.push([position.latitude, position.longitude]);
    }

    gridRings.forEach((grid) => {
      grid.rings.forEach((ring) => {
        ring.forEach((point) => points.push(point));
      });
    });

    if (points.length >= 2) {
      map.fitBounds(points, { padding: [26, 26], maxZoom: 16 });
    } else if (points.length === 1) {
      map.setView(points[0], DEFAULT_ZOOM);
    }
  }, [map, position?.latitude, position?.longitude, gridRings]);

  return null;
}


function FELiveGpsMapStyles() {
  return (
    <style>{`
      .fe-live-map-shell {
        width: 100%;
      }

      .fe-live-map-shell .leaflet-container {
        border-radius: 14px;
        border: 1px solid rgba(96, 165, 250, 0.38);
        overflow: hidden;
      }

      .fe-gps-readable-row {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
        margin-top: 10px;
        text-align: center;
      }

      .fe-gps-readable-row span {
        border: 1px solid rgba(96, 165, 250, 0.35);
        background: rgba(15, 23, 42, 0.05);
        border-radius: 10px;
        padding: 8px 10px;
        color: #0f172a;
        font-weight: 800;
      }

      .theme-night .fe-gps-readable-row span,
      body.bd-theme-night .fe-gps-readable-row span {
        background: rgba(15, 23, 42, 0.78);
        color: #f8fafc;
      }

      .fe-gps-readable-row b {
        color: #2563eb;
      }

      .theme-night .fe-gps-readable-row b,
      body.bd-theme-night .fe-gps-readable-row b {
        color: #93c5fd;
      }

      .fe-map-grid-note {
        margin-top: 8px;
        border: 1px solid #f59e0b;
        background: #fff7ed;
        color: #92400e;
        border-radius: 10px;
        padding: 8px 10px;
        font-size: 12px;
        font-weight: 800;
        text-align: center;
      }

      .theme-night .fe-map-grid-note,
      body.bd-theme-night .fe-map-grid-note {
        background: rgba(251, 191, 36, 0.12);
        color: #fde68a;
      }

      .fe-gps-error {
        background: #991b1b;
        color: #ffffff;
        border-radius: 12px;
        padding: 14px;
        text-align: center;
        font-weight: 900;
      }

      @media (max-width: 700px) {
        .fe-gps-readable-row {
          grid-template-columns: 1fr;
        }
      }
    `}</style>
  );
}

export default function FELiveGpsMap({ assignedGrids = [] }) {
  const [position, setPosition] = useState(null);
  const [gpsError, setGpsError] = useState("");

  const gridRings = useMemo(() => {
    return (assignedGrids || [])
      .map((gridLike, index) => {
        const rings = geometryToRings(extractGeometryCandidate(gridLike));

        if (!rings.length) return null;

        return {
          id: gridLike?.gridId || gridLike?.id || `${index}`,
          name: getGridName(gridLike, index),
          market: getGridMarket(gridLike),
          routeName: gridLike?.routeName || "",
          rings,
        };
      })
      .filter(Boolean);
  }, [assignedGrids]);

  const market = useMemo(() => {
    return gridRings.find((grid) => grid.market)?.market || getGridMarket(assignedGrids?.[0]) || "";
  }, [assignedGrids, gridRings]);

  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsError("GPS is not supported on this browser.");
      return undefined;
    }

    const handleSuccess = (pos) => {
      setPosition({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      });
      setGpsError("");
    };

    const handleError = () => {
      setGpsError("Unable to get GPS location. Please allow location permission.");
    };

    navigator.geolocation.getCurrentPosition(handleSuccess, handleError, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 15000,
    });

    const watchId = navigator.geolocation.watchPosition(handleSuccess, handleError, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 10000,
    });

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const center = position?.latitude && position?.longitude
    ? [position.latitude, position.longitude]
    : gridRings[0]?.rings?.[0]?.[0] || DEFAULT_CENTER;

  if (gpsError && !position) {
    return (
      <>
        <FELiveGpsMapStyles />
        <div className="fe-gps-error">{gpsError}</div>
      </>
    );
  }

  return (
    <div className="fe-live-map-shell">
      <FELiveGpsMapStyles />
      <MapContainer center={center} zoom={DEFAULT_ZOOM} style={{ height: 260, width: "100%" }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <MapBoundsController position={position} gridRings={gridRings} />

        {gridRings.map((grid) =>
          grid.rings.map((ring, ringIndex) => (
            <Polygon
              key={`${grid.id}_${ringIndex}`}
              positions={ring}
              pathOptions={{
                color: "#0f4ea8",
                weight: 4,
                opacity: 0.95,
                fillColor: "#3b82f6",
                fillOpacity: 0.14,
              }}
            >
              <Popup>
                <strong>{grid.name}</strong>
                {grid.market ? <><br />Market: {grid.market}</> : null}
                {grid.routeName ? <><br />Route: {grid.routeName}</> : null}
              </Popup>
            </Polygon>
          ))
        )}

        {position && (
          <>
            <Marker
              position={[position.latitude, position.longitude]}
              icon={feMarkerIcon}
            >
              <Popup>
                FE Current Location<br />
                Lat: {Number(position.latitude).toFixed(6)}<br />
                Lng: {Number(position.longitude).toFixed(6)}
              </Popup>
            </Marker>
            <Circle
              center={[position.latitude, position.longitude]}
              radius={Number(position.accuracy || 40)}
              pathOptions={{ color: "#2563eb", fillColor: "#60a5fa", fillOpacity: 0.18 }}
            />
          </>
        )}

        <CellSectorLayer
          market={market}
          showSites={true}
          showSectors={true}
          maxRecords={1200}
          sectorRadiusM={450}
        />
      </MapContainer>

      {gridRings.length === 0 && (
        <div className="fe-map-grid-note">
          Assigned grid boundary is not available for this task yet.
        </div>
      )}

      {position && (
        <div className="fe-gps-readable-row">
          <span><b>Latitude:</b> {Number(position.latitude).toFixed(6)}</span>
          <span><b>Longitude:</b> {Number(position.longitude).toFixed(6)}</span>
          <span><b>Accuracy:</b> {Math.round(Number(position.accuracy || 0))} meters</span>
        </div>
      )}
    </div>
  );
}
