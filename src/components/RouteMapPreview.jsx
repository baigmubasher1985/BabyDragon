import { useEffect } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

function RouteMapController({ previewGrids }) {
  const map = useMap();

  useEffect(() => {
    setTimeout(() => {
      map.invalidateSize();
    }, 150);
  }, [map]);

  useEffect(() => {
    const gridsWithGeometry = previewGrids.filter((grid) => grid.geometry);

    if (gridsWithGeometry.length === 0) return;

    const layer = L.geoJSON(gridsWithGeometry.map((grid) => grid.geometry));
    const bounds = layer.getBounds();

    if (bounds.isValid()) {
      map.fitBounds(bounds, {
        padding: [50, 50],
        maxZoom: 15,
      });
    }
  }, [map, previewGrids]);

  return null;
}

export default function RouteMapPreview({
  previewGrids = [],
  title = "Route Map Preview",
  subtitle = "Click View from Saved Routes, or create a route and select grids.",
  mapHeight = 560,
}) {
  const gridsWithGeometry = previewGrids.filter((grid) => grid.geometry);

  function getGridLabel(grid) {
    return (
      grid.grid_id ||
      grid.grid_name ||
      grid.name ||
      grid.GridName ||
      grid.Real_GridCode ||
      grid.real_grid_code ||
      grid.GRID_ID ||
      grid.id
    );
  }

  function getGridMarket(grid) {
    return grid.market || grid.Market || grid.market_name || "No Market";
  }

  function getGridStatus(grid) {
    return grid.status || grid.Status || "No Status";
  }

  function getGridStyle() {
    return {
      color: "#ffffff",
      weight: 5,
      opacity: 1,
      fillColor: "#38bdf8",
      fillOpacity: 0.25,
    };
  }

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <div>
          <h3 style={styles.title}>{title}</h3>
          <p style={styles.subtitle}>{subtitle}</p>
        </div>

        <div style={styles.counter}>
          {gridsWithGeometry.length} grid
          {gridsWithGeometry.length === 1 ? "" : "s"} on map
        </div>
      </div>

      <div style={styles.mapShell}>
        <MapContainer
          center={[32.97, -96.34]}
          zoom={11}
          style={{
            height: `${mapHeight}px`,
            width: "100%",
            borderRadius: "14px",
          }}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

          <RouteMapController previewGrids={gridsWithGeometry} />

          {gridsWithGeometry.map((grid) => (
            <GeoJSON
              key={`${grid.id}-${getGridStatus(grid)}`}
              data={grid.geometry}
              style={getGridStyle}
              eventHandlers={{
                mouseover: (event) => {
                  event.target.setStyle({
                    color: "#facc15",
                    weight: 6,
                    fillOpacity: 0.35,
                  });
                },
                mouseout: (event) => {
                  event.target.setStyle(getGridStyle());
                },
              }}
              onEachFeature={(feature, layer) => {
                layer.bindPopup(`
                  <b>${getGridLabel(grid)}</b><br/>
                  Market: ${getGridMarket(grid)}<br/>
                  Status: ${getGridStatus(grid)}
                `);
              }}
            />
          ))}
        </MapContainer>

        {gridsWithGeometry.length === 0 && (
          <div style={styles.emptyMapNote}>
            Click View from Saved Routes, or open Create Route and select grids.
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  card: {
    background: "#111827",
    border: "1px solid #263244",
    borderRadius: "16px",
    padding: "16px",
    marginBottom: "16px",
  },

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "12px",
    marginBottom: "12px",
  },

  title: {
    margin: 0,
    color: "#ffffff",
    fontSize: "20px",
  },

  subtitle: {
    margin: "6px 0 0",
    color: "#9ca3af",
    fontSize: "13px",
  },

  counter: {
    background: "#0b1220",
    border: "1px solid #374151",
    color: "#bfdbfe",
    padding: "8px 12px",
    borderRadius: "999px",
    fontSize: "12px",
    whiteSpace: "nowrap",
  },

  mapShell: {
    position: "relative",
    border: "1px solid #263244",
    borderRadius: "14px",
    overflow: "hidden",
    background: "#0b1220",
  },

  emptyMapNote: {
    position: "absolute",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    background: "rgba(3, 7, 18, 0.9)",
    border: "1px dashed #475569",
    color: "#cbd5e1",
    borderRadius: "12px",
    padding: "14px 18px",
    fontSize: "13px",
    textAlign: "center",
    pointerEvents: "none",
  },
};