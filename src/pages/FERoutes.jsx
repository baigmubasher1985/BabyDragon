import { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  Popup,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { supabase } from "../lib/supabaseClient";
import CellSectorLayer from "../components/maps/CellSectorLayer";
import {
  exportRouteKml,
  exportRouteHtml,
  exportRouteZip,
} from "../utils/routeExport";

const DEFAULT_CENTER = [32.7767, -96.797];
const DEFAULT_ZOOM = 10;

export default function FERoutes() {
  const [tasks, setTasks] = useState([]);
  const [taskGrids, setTaskGrids] = useState([]);
  const [grids, setGrids] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [routeGrids, setRouteGrids] = useState([]);

  const [selectedGridId, setSelectedGridId] = useState("");
  const [search, setSearch] = useState("");
  const [routeStatusFilter, setRouteStatusFilter] = useState("");
  const [expandedRouteId, setExpandedRouteId] = useState("");

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    loadFeRoutes();
  }, []);

  async function loadFeRoutes() {
    setLoading(true);
    setErrorMessage("");

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error("Failed to load FE user.");
      }

      const { data: taskData, error: taskError } = await supabase
        .from("tasks")
        .select(`
          *,
          projects (
            id,
            name,
            customer,
            market,
            testing_type
          )
        `)
        .eq("assigned_to", user.id)
        .order("created_at", { ascending: false });

      if (taskError) throw taskError;

      const safeTasks = taskData || [];
      setTasks(safeTasks);

      if (safeTasks.length === 0) {
        setTaskGrids([]);
        setGrids([]);
        setRoutes([]);
        setRouteGrids([]);
        return;
      }

      const taskIds = safeTasks.map((task) => task.id);

      const { data: taskGridData, error: taskGridError } = await supabase
        .from("task_grids")
        .select("*")
        .in("task_id", taskIds);

      if (taskGridError) throw taskGridError;

      const safeTaskGrids = taskGridData || [];
      setTaskGrids(safeTaskGrids);

      const gridIds = Array.from(
        new Set(safeTaskGrids.map((item) => item.grid_id).filter(Boolean))
      );

      if (gridIds.length === 0) {
        setGrids([]);
        setRoutes([]);
        setRouteGrids([]);
        return;
      }

      const { data: gridData, error: gridError } = await supabase.rpc(
        "get_grids_geojson"
      );

      if (gridError) throw gridError;

      const safeGrids = (gridData || [])
        .filter((grid) =>
          gridIds.some((gridId) => String(gridId) === String(grid.id))
        )
        .map((grid) => ({
          ...grid,
          status: grid.status || "Available",
          geometry: normalizeGeometry(grid.geometry),
        }));

      setGrids(safeGrids);

      const { data: routeData, error: routeError } = await supabase
        .from("routes")
        .select("*")
        .order("created_at", { ascending: false });

      if (routeError) throw routeError;

      const safeRoutes = routeData || [];
      setRoutes(safeRoutes);

      let safeRouteGrids = [];

      const { data: routeGridData, error: routeGridError } = await supabase
        .from("route_grids")
        .select("*");

      if (!routeGridError) {
        safeRouteGrids = routeGridData || [];
      }

      setRouteGrids(safeRouteGrids);

      const selectedGridFromTask = localStorage.getItem("feRouteSelectedGridId");

      if (selectedGridFromTask) {
        setSelectedGridId(selectedGridFromTask);
        localStorage.removeItem("feRouteSelectedGridId");
      } else if (!selectedGridId && safeGrids.length > 0) {
        const firstGridWithRoute =
          safeGrids.find((grid) =>
            findBestRouteForGrid(grid, safeRoutes, safeRouteGrids)
          ) || safeGrids[0];

        setSelectedGridId(firstGridWithRoute.id);
      }
    } catch (error) {
      console.error("FE Routes load error:", error);
      setErrorMessage(error.message || "Failed to load FE routes.");
    } finally {
      setLoading(false);
    }
  }

  const taskById = useMemo(() => {
    const map = {};

    tasks.forEach((task) => {
      map[task.id] = task;
    });

    return map;
  }, [tasks]);

  const gridById = useMemo(() => {
    const map = {};

    grids.forEach((grid) => {
      map[grid.id] = grid;
    });

    return map;
  }, [grids]);

  const rows = useMemo(() => {
    const rowMap = new Map();

    function getTaskTime(task) {
      return task?.created_at ? new Date(task.created_at).getTime() : 0;
    }

    taskGrids.forEach((taskGrid) => {
      const task = taskById[taskGrid.task_id];
      const grid = gridById[taskGrid.grid_id];

      if (!task || !grid) return;

      const latestRoute = findBestRouteForGrid(grid, routes, routeGrids);

      const uniqueKey = taskGrid.grid_id;
      const existingRow = rowMap.get(uniqueKey);

      const shouldReplace =
        !existingRow || getTaskTime(task) > getTaskTime(existingRow.task);

      if (!shouldReplace) return;

      rowMap.set(uniqueKey, {
        id: uniqueKey,
        task,
        grid,
        route: latestRoute,
        routeStatus: latestRoute ? "Route Ready" : "Missing Route",
      });
    });

    return Array.from(rowMap.values()).sort((a, b) => {
      return getGridLabel(a.grid).localeCompare(getGridLabel(b.grid));
    });
  }, [taskGrids, taskById, gridById, routes, routeGrids]);

  useEffect(() => {
    const selectedGridFromTask = localStorage.getItem("feRouteSelectedGridId");

    if (!selectedGridFromTask || rows.length === 0) return;

    const exists = rows.some(
      (row) => String(row.grid.id) === String(selectedGridFromTask)
    );

    if (exists) {
      setSelectedGridId(selectedGridFromTask);
      localStorage.removeItem("feRouteSelectedGridId");
    }
  }, [rows]);

  const filteredRows = useMemo(() => {
    const cleanSearch = search.trim().toLowerCase();

    return rows.filter((row) => {
      const gridName = getGridLabel(row.grid);
      const routeName = row.route?.route_name || "No Route";
      const projectName = row.task.projects?.name || "No Project";
      const market = getGridMarket(row.grid) || row.task.market || "";
      const routeType = getRouteType(row.route);
      const taskStatus = formatStatus(row.task.status);
      const routeLength = formatRouteLength(row.route);
      const generated = formatGeneratedDate(row.route);

      const haystack = [
        gridName,
        routeName,
        projectName,
        market,
        routeType,
        taskStatus,
        row.routeStatus,
        routeLength,
        generated,
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch = !cleanSearch || haystack.includes(cleanSearch);
      const matchesRouteStatus =
        !routeStatusFilter || row.routeStatus === routeStatusFilter;

      return matchesSearch && matchesRouteStatus;
    });
  }, [rows, search, routeStatusFilter]);

  const selectedRow = useMemo(() => {
    return rows.find((row) => String(row.grid.id) === String(selectedGridId)) || null;
  }, [rows, selectedGridId]);

  const selectedGridFeature = useMemo(() => {
    if (!selectedRow?.grid) return null;

    const geometry = normalizeGeometry(selectedRow.grid.geometry);

    if (!geometry) return null;

    return {
      type: "Feature",
      properties: {
        ...selectedRow.grid,
      },
      geometry,
    };
  }, [selectedRow]);

  const selectedRouteGeojson = useMemo(() => {
    return parseRouteGeojson(selectedRow?.route?.route_geojson);
  }, [selectedRow]);

  const selectedRouteSummary = useMemo(() => {
    if (!selectedRow) return "Click View Map from your assigned route list.";

    if (!selectedRow.route) {
      return "Missing Route • Admin needs to generate this route";
    }

    return [
      "Route Ready",
      getRouteType(selectedRow.route),
      formatRouteLength(selectedRow.route),
      `Generated ${formatGeneratedDate(selectedRow.route)}`,
    ].join(" • ");
  }, [selectedRow]);

  const stats = useMemo(() => {
    return {
      assignedGrids: rows.length,
      routeReady: rows.filter((row) => row.routeStatus === "Route Ready").length,
      missingRoutes: rows.filter((row) => row.routeStatus === "Missing Route")
        .length,
    };
  }, [rows]);

  function clearFilters() {
    setSearch("");
    setRouteStatusFilter("");
  }

  function viewGrid(row) {
    setSelectedGridId(row.grid.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function navigateToGrid(row) {
    openGoogleMapsNavigation(row);
  }

  function toggleRouteDetails(row) {
    setExpandedRouteId((current) =>
      String(current) === String(row.id) ? "" : String(row.id)
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.headerCard}>
        <div style={styles.headerCenter}>
          <h2 style={styles.title}>My Assigned Routes</h2>
          <p style={styles.subtitle}>
            Your routes are automatically attached to the grids assigned to you.
          </p>
        </div>

        <button
          type="button"
          onClick={loadFeRoutes}
          disabled={loading}
          style={styles.refreshButtonTopRight}
          title="Reload assigned tasks, grids, and saved routes"
        >
          {loading ? "Refreshing..." : "Refresh Routes"}
        </button>
      </div>

      {errorMessage && <div style={styles.errorBox}>{errorMessage}</div>}

      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <span>Assigned Grids</span>
          <b>{stats.assignedGrids}</b>
        </div>

        <div style={styles.statCard}>
          <span>Routes Ready</span>
          <b style={styles.greenText}>{stats.routeReady}</b>
        </div>

        <div style={styles.statCard}>
          <span>Missing Routes</span>
          <b style={styles.orangeText}>{stats.missingRoutes}</b>
        </div>
      </div>

      <div style={styles.mapCard}>
        <div style={styles.mapHeader}>
          <div>
            <h3 style={styles.cardTitle}>
              {selectedRow
                ? `Route Preview: ${getGridLabel(selectedRow.grid)}`
                : "FE Route Map Preview"}
            </h3>

            <p style={styles.smallText}>
              {selectedRow
                ? `${selectedRow.route?.route_name || "No saved route"}`
                : "Click View Map from your assigned route list."}
            </p>
          </div>

          <div style={styles.mapHeaderActions}>
            {selectedRow && (
              <button
                type="button"
                onClick={() => navigateToGrid(selectedRow)}
                style={styles.navigateButton}
              >
                Navigate to Grid
              </button>
            )}

            <span style={styles.mapBadge}>
              {selectedRow ? "1 grid on map" : "0 grids"}
            </span>
          </div>
        </div>

        <div style={styles.mapBox}>
          <MapContainer
            center={DEFAULT_CENTER}
            zoom={DEFAULT_ZOOM}
            style={styles.map}
            scrollWheelZoom
          >
            <TileLayer
              attribution="&copy; OpenStreetMap contributors"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <MapBoundsController
              gridFeature={selectedGridFeature}
              routeGeojson={selectedRouteGeojson}
            />

            <CellSectorLayer
              market={selectedRow?.grid ? getGridMarket(selectedRow.grid) : ""}
              showSites
              showSectors
              maxRecords={1200}
              sectorRadiusM={550}
            />

            {selectedGridFeature && (
              <GeoJSON
                key={`fe-grid-${selectedGridId}`}
                data={selectedGridFeature}
                style={() => ({
                  color: "#2563EB",
                  weight: 4,
                  fillColor: "#60A5FA",
                  fillOpacity: 0.22,
                })}
              >
                <Popup>
                  <div style={{ minWidth: 160 }}>
                    <strong>{getGridLabel(selectedRow.grid)}</strong>
                    <br />
                    <span>Market: {getGridMarket(selectedRow.grid)}</span>
                    <br />
                    <span>Status: {selectedRow.grid.status || "Available"}</span>
                  </div>
                </Popup>
              </GeoJSON>
            )}

            {selectedRouteGeojson && (
              <RouteLineLayer geojson={selectedRouteGeojson} />
            )}
          </MapContainer>
        </div>

        {selectedRow && (
          <div
            style={{
              ...styles.routeSummaryBox,
              ...(selectedRow.route ? styles.routeSummaryGood : styles.routeSummaryWarning),
            }}
          >
            <b>{selectedRow.route ? "Route Ready" : "Missing Route"}</b>
            <span>{selectedRouteSummary}</span>
          </div>
        )}
      </div>

      <div style={styles.listCard}>
        <div style={styles.tableHeader}>
          <div>
            <h3 style={styles.cardTitle}>Assigned Grid Route List</h3>
            <p style={styles.smallText}>
              Showing {filteredRows.length} of {rows.length} assigned grid route
              record(s).
            </p>
          </div>

          <button type="button" onClick={clearFilters} style={styles.smallButton}>
            Clear Filters
          </button>
        </div>

        <div style={styles.filtersGrid}>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search grid, route, project, market..."
            style={styles.input}
          />

          <select
            value={routeStatusFilter}
            onChange={(event) => setRouteStatusFilter(event.target.value)}
            style={styles.input}
          >
            <option value="">All Route Status</option>
            <option value="Route Ready">Route Ready</option>
            <option value="Missing Route">Missing Route</option>
          </select>
        </div>

        {loading && <div style={styles.emptyBox}>Loading assigned routes...</div>}

        {!loading && filteredRows.length === 0 && (
          <div style={styles.emptyBox}>No assigned routes found.</div>
        )}

        {!loading && filteredRows.length > 0 && (
          <div style={styles.assignedRouteList}>
            {filteredRows.map((row) => {
              const isSelected = String(selectedGridId) === String(row.grid.id);

              return (
                <div
                  key={row.id}
                  style={{
                    ...styles.assignedRouteCard,
                    ...(isSelected ? styles.assignedRouteCardActive : {}),
                  }}
                >
                  <div style={styles.compactRouteTop}>
                    <div style={styles.compactRouteInfo}>
                      <span style={styles.recordLabel}>Assigned Grid</span>
                      <strong style={styles.recordTitle}>{getGridLabel(row.grid)}</strong>
                      <span style={styles.recordSubText}>
                        {getGridMarket(row.grid) || "Unknown Market"} • {getRouteType(row.route)} • {formatRouteLength(row.route)}
                      </span>
                    </div>

                    <div style={styles.assignedRouteActions}>
                      <span
                        style={{
                          ...styles.statusPill,
                          ...(row.routeStatus === "Route Ready"
                            ? styles.readyPill
                            : styles.missingPill),
                        }}
                      >
                        {row.routeStatus}
                      </span>

                      <button type="button" onClick={() => viewGrid(row)} style={styles.viewButton}>
                        View Map
                      </button>

                      {row.route && (
                        <button type="button" onClick={() => navigateToGrid(row)} style={styles.navSmallButton}>
                          Navigate
                        </button>
                      )}

                      <button type="button" onClick={() => toggleRouteDetails(row)} style={styles.detailButton}>
                        {String(expandedRouteId) === String(row.id) ? "Hide" : "Details"}
                      </button>
                    </div>
                  </div>

                  {String(expandedRouteId) === String(row.id) && (
                    <div style={styles.routeDetailsDrawer}>
                      <div style={styles.recordMiniGrid}>
                        <InfoBox title="Saved Route" value={row.route?.route_name || "No route created"} />
                        <InfoBox title="Project" value={row.task.projects?.name || "No Project"} />
                        <InfoBox title="Mode" value={getRouteType(row.route)} />
                        <InfoBox title="Length" value={formatRouteLength(row.route)} />
                        <InfoBox title="Generated" value={formatGeneratedDate(row.route)} />
                        <InfoBox title="Task Status" value={formatStatus(row.task.status)} />
                      </div>

                      {row.route && (
                        <div style={styles.exportRow}>
                          <button type="button" onClick={() => exportRouteKml({ route: row.route, grid: row.grid })} style={styles.exportButton}>
                            KML
                          </button>
                          <button type="button" onClick={() => exportRouteHtml({ route: row.route, grid: row.grid })} style={styles.exportButton}>
                            HTML
                          </button>
                          <button type="button" onClick={() => exportRouteZip({ route: row.route, grid: row.grid })} style={styles.exportButton}>
                            ZIP
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function InfoBox({ title, value }) {
  return (
    <div style={styles.recordMiniBox}>
      <span style={styles.recordMiniLabel}>{title}</span>
      <strong style={styles.recordMiniValue}>{value}</strong>
    </div>
  );
}

function MapBoundsController({ gridFeature, routeGeojson }) {
  const map = useMap();

  useEffect(() => {
    const layers = [];

    if (gridFeature) {
      layers.push(L.geoJSON(gridFeature));
    }

    if (routeGeojson) {
      layers.push(L.geoJSON(routeGeojson));
    }

    if (!layers.length) return;

    const group = L.featureGroup(layers);
    const bounds = group.getBounds();

    if (bounds.isValid()) {
      map.fitBounds(bounds, {
        padding: [28, 28],
        maxZoom: 17,
      });
    }
  }, [map, gridFeature, routeGeojson]);

  return null;
}

function RouteLineLayer({ geojson }) {
  const map = useMap();

  useEffect(() => {
    if (!geojson) return;

    const routeLayer = L.geoJSON(geojson, {
      style: {
        color: "#00FF66",
        weight: 8,
        opacity: 1,
        lineCap: "round",
        lineJoin: "round",
      },
      pointToLayer: (feature, latlng) => {
        return L.circleMarker(latlng, {
          radius: 5,
          color: "#00FF66",
          fillColor: "#00FF66",
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

function openGoogleMapsNavigation(row) {
  const destination = getNavigationDestination(row);

  if (!destination) {
    alert("Unable to find grid location for navigation.");
    return;
  }

  const destinationText = `${destination.lat},${destination.lng}`;

  const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    destinationText
  )}&travelmode=driving`;

  window.open(url, "_blank", "noopener,noreferrer");
}

function getNavigationDestination(row) {
  const routeGeojson = parseRouteGeojson(row?.route?.route_geojson);
  const firstRoutePoint = getFirstRoutePoint(routeGeojson);

  if (firstRoutePoint) {
    return firstRoutePoint;
  }

  const geometry = normalizeGeometry(row?.grid?.geometry);
  const center = getGeometryCenter(geometry);

  if (center) {
    return center;
  }

  return null;
}

function getFirstRoutePoint(routeGeojson) {
  if (!routeGeojson?.features?.length) return null;

  for (const feature of routeGeojson.features) {
    const geometry = feature.geometry;

    if (!geometry) continue;

    if (geometry.type === "LineString") {
      const first = geometry.coordinates?.[0];

      if (isValidLngLat(first)) {
        return {
          lng: Number(first[0]),
          lat: Number(first[1]),
        };
      }
    }

    if (geometry.type === "MultiLineString") {
      const first = geometry.coordinates?.[0]?.[0];

      if (isValidLngLat(first)) {
        return {
          lng: Number(first[0]),
          lat: Number(first[1]),
        };
      }
    }
  }

  return null;
}

function getGeometryCenter(geometry) {
  const points = getGeometryPoints(geometry);

  if (!points.length) return null;

  let lngSum = 0;
  let latSum = 0;

  points.forEach(([lng, lat]) => {
    lngSum += Number(lng);
    latSum += Number(lat);
  });

  return {
    lng: lngSum / points.length,
    lat: latSum / points.length,
  };
}

function getGeometryPoints(geometry) {
  if (!geometry) return [];

  if (geometry.type === "Polygon") {
    return geometry.coordinates.flat().filter(isValidLngLat);
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.flat(2).filter(isValidLngLat);
  }

  return [];
}

function isValidLngLat(point) {
  return (
    Array.isArray(point) &&
    point.length >= 2 &&
    Number.isFinite(Number(point[0])) &&
    Number.isFinite(Number(point[1]))
  );
}

function findBestRouteForGrid(grid, routes, routeGrids) {
  if (!grid) return null;

  const gridKeys = getGridMatchKeys(grid);

  const directRoutes = routes.filter((route) => {
    const routeGridId = route.grid_id ?? route.gridId ?? route.grid_db_id;

    return gridKeys.some((key) => String(key) === String(routeGridId));
  });

  const linkedRouteIds = routeGrids
    .filter((link) => gridKeys.some((key) => String(key) === String(link.grid_id)))
    .map((link) => link.route_id);

  const linkedRoutes = routes.filter((route) =>
    linkedRouteIds.some((routeId) => String(routeId) === String(route.id))
  );

  const candidates = [...directRoutes, ...linkedRoutes];

  const uniqueCandidates = Array.from(
    new Map(candidates.map((route) => [String(route.id), route])).values()
  );

  if (uniqueCandidates.length === 0) return null;

  uniqueCandidates.sort((a, b) => {
    const aHasGeojson = a.route_geojson ? 1 : 0;
    const bHasGeojson = b.route_geojson ? 1 : 0;

    if (aHasGeojson !== bHasGeojson) {
      return bHasGeojson - aHasGeojson;
    }

    const dateA = getRouteTime(a);
    const dateB = getRouteTime(b);

    return dateB - dateA;
  });

  return uniqueCandidates[0];
}

function getRouteTime(route) {
  const value = route?.generated_at || route?.updated_at || route?.created_at;
  return value ? new Date(value).getTime() : 0;
}

function getGridMatchKeys(grid) {
  if (!grid) return [];

  return [
    grid.id,
    grid.grid_id,
    grid.grid_db_id,
    grid.grid_code,
    grid.number,
    grid.name,
    grid.grid_name,
    grid.Real_GridCode,
    grid.real_grid_code,
    grid.GRID_ID,
  ].filter((value) => value !== undefined && value !== null && value !== "");
}

function normalizeGeometry(geometry) {
  if (!geometry) return null;

  if (typeof geometry === "object") {
    if (geometry.type === "Feature") return geometry.geometry;

    if (geometry.type === "FeatureCollection") {
      const polygonFeature = geometry.features?.find((feature) =>
        ["Polygon", "MultiPolygon"].includes(feature?.geometry?.type)
      );

      return polygonFeature?.geometry || null;
    }

    return geometry;
  }

  if (typeof geometry === "string") {
    try {
      const parsed = JSON.parse(geometry);

      if (parsed.type === "Feature") return parsed.geometry;

      if (parsed.type === "FeatureCollection") {
        const polygonFeature = parsed.features?.find((feature) =>
          ["Polygon", "MultiPolygon"].includes(feature?.geometry?.type)
        );

        return polygonFeature?.geometry || null;
      }

      return parsed;
    } catch {
      return null;
    }
  }

  return null;
}

function parseRouteGeojson(routeGeojson) {
  if (!routeGeojson) return null;

  let parsed = routeGeojson;

  if (typeof routeGeojson === "string") {
    try {
      parsed = JSON.parse(routeGeojson);
    } catch {
      return null;
    }
  }

  if (!parsed) return null;

  if (parsed.type === "FeatureCollection") {
    return parsed;
  }

  if (parsed.type === "Feature") {
    return {
      type: "FeatureCollection",
      features: [parsed],
    };
  }

  if (parsed.type === "LineString" || parsed.type === "MultiLineString") {
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: parsed,
        },
      ],
    };
  }

  return null;
}

function getGridLabel(grid) {
  if (!grid) return "Unknown Grid";

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
  if (!grid) return "";

  return grid.market || grid.Market || grid.market_name || "";
}

function getRouteType(route) {
  if (!route) return "N/A";

  const value = route.route_mode || route.route_type || route.type || "N/A";

  return String(value)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatRouteLength(route) {
  const meters = Number(route?.route_length_m);

  if (!Number.isFinite(meters) || meters <= 0) return "N/A";

  const miles = meters / 1609.344;

  if (miles < 0.1) {
    return `${Math.round(meters)} m`;
  }

  return `${miles.toFixed(2)} mi`;
}

function formatGeneratedDate(route) {
  const value = route?.generated_at || route?.updated_at || route?.created_at;

  if (!value) return "N/A";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "N/A";

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatStatus(status) {
  if (status === "assigned") return "Assigned";
  if (status === "in_progress") return "In Progress";
  if (status === "completed") return "Completed";
  if (status === "needs_redrive") return "Needs Re-drive";
  if (status === "pending") return "Pending";

  return status || "Unknown";
}

const styles = {
  page: {
    width: "100%",
    maxWidth: "900px",
    margin: "0 auto",
    color: "#fff",
    padding: "18px",
    boxSizing: "border-box",
  },

  headerCard: {
    background: "#101828",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "14px",
    padding: "14px 16px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    textAlign: "left",
    gap: "14px",
    marginBottom: "12px",
    minHeight: "auto",
  },

  headerCenter: {
    maxWidth: "560px",
    margin: 0,
  },

  title: {
    margin: 0,
    fontSize: "20px",
    fontWeight: 900,
  },

  subtitle: {
    margin: "6px 0 0",
    color: "#98A2B3",
    fontSize: "13px",
  },

  refreshButtonTopRight: {
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.07)",
    color: "#fff",
    borderRadius: "9px",
    padding: "9px 12px",
    fontWeight: 800,
    cursor: "pointer",
    fontSize: "12px",
    whiteSpace: "nowrap",
  },

  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "10px",
    marginBottom: "12px",
  },

  statCard: {
    background: "#101828",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "14px",
    padding: "14px",
    textAlign: "center",
    display: "grid",
    gap: "8px",
  },

  greenText: {
    color: "#34d399",
  },

  orangeText: {
    color: "#f59e0b",
  },

  mapCard: {
    background: "#101828",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "14px",
    padding: "14px",
    marginBottom: "12px",
  },

  mapHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "flex-start",
    marginBottom: "12px",
  },

  mapHeaderActions: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },

  navigateButton: {
    background: "#16a34a",
    color: "#ffffff",
    border: "none",
    borderRadius: "10px",
    padding: "9px 12px",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 800,
    whiteSpace: "nowrap",
  },

  mapBadge: {
    border: "1px solid rgba(147,197,253,0.45)",
    color: "#bfdbfe",
    borderRadius: "999px",
    padding: "6px 10px",
    fontSize: "12px",
    fontWeight: 800,
    whiteSpace: "nowrap",
  },

  mapBox: {
    height: "420px",
    borderRadius: "12px",
    overflow: "hidden",
    border: "1px solid rgba(255,255,255,0.12)",
    background: "#0b1220",
  },

  map: {
    width: "100%",
    height: "100%",
  },

  routeSummaryBox: {
    marginTop: "10px",
    borderRadius: "10px",
    padding: "10px 12px",
    fontSize: "13px",
    display: "grid",
    gap: "4px",
    textAlign: "center",
  },

  routeSummaryGood: {
    background: "rgba(0,255,102,0.10)",
    border: "1px solid rgba(0,255,102,0.35)",
    color: "#86efac",
  },

  routeSummaryWarning: {
    background: "rgba(245,158,11,0.12)",
    border: "1px solid rgba(245,158,11,0.35)",
    color: "#fcd34d",
  },

  listCard: {
    background: "#101828",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "14px",
    padding: "14px",
  },

  tableHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "flex-start",
    marginBottom: "14px",
  },

  cardTitle: {
    margin: "0 0 6px",
    color: "#ffffff",
    fontSize: "17px",
    fontWeight: 900,
  },

  smallText: {
    margin: "4px 0 0",
    color: "#9ca3af",
    fontSize: "12px",
  },

  smallButton: {
    background: "#1f2937",
    color: "#ffffff",
    border: "1px solid #374151",
    borderRadius: "8px",
    padding: "7px 10px",
    cursor: "pointer",
    fontSize: "12px",
    whiteSpace: "nowrap",
    fontWeight: 800,
  },

  filtersGrid: {
    display: "grid",
    gridTemplateColumns: "1.7fr 1fr",
    gap: "10px",
    marginBottom: "14px",
  },

  input: {
    width: "100%",
    padding: "11px",
    borderRadius: "10px",
    border: "1px solid #374151",
    background: "#0b1220",
    color: "#ffffff",
    outline: "none",
    boxSizing: "border-box",
  },

  assignedRouteList: {
    display: "grid",
    gap: "12px",
  },

  assignedRouteCard: {
    background: "#0B1220",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "14px",
    padding: "13px",
    display: "grid",
    gap: "10px",
    alignItems: "center",
  },

  assignedRouteCardActive: {
    border: "1px solid rgba(96,165,250,0.65)",
    background: "rgba(37,99,235,0.12)",
  },

  assignedRouteMain: {
    display: "grid",
    gap: "12px",
    minWidth: 0,
  },

  recordLabel: {
    display: "block",
    color: "#98A2B3",
    fontSize: "11px",
    fontWeight: 800,
    marginBottom: "4px",
  },

  recordTitle: {
    display: "block",
    color: "#fff",
    fontSize: "15px",
    fontWeight: 900,
    lineHeight: 1.35,
  },

  recordSubText: {
    display: "block",
    color: "#93C5FD",
    fontSize: "12px",
    marginTop: "4px",
  },

  recordMiniGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
    gap: "8px",
  },

  recordMiniBox: {
    background: "rgba(255,255,255,0.045)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "11px",
    padding: "9px",
    minWidth: 0,
  },

  recordMiniLabel: {
    display: "block",
    color: "#98A2B3",
    fontSize: "10px",
    fontWeight: 800,
    marginBottom: "4px",
  },

  recordMiniValue: {
    display: "block",
    color: "#fff",
    fontSize: "12px",
    fontWeight: 900,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  assignedRouteActions: {
    display: "flex",
    gap: "7px",
    justifyContent: "flex-end",
    alignItems: "center",
    flexWrap: "wrap",
  },


  compactRouteTop: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: "12px",
    alignItems: "center",
  },

  compactRouteInfo: {
    minWidth: 0,
  },

  routeDetailsDrawer: {
    borderTop: "1px solid rgba(255,255,255,0.10)",
    paddingTop: "10px",
    display: "grid",
    gap: "10px",
  },

  exportRow: {
    display: "flex",
    gap: "8px",
    justifyContent: "flex-end",
    flexWrap: "wrap",
  },

  detailButton: {
    background: "rgba(255,255,255,0.07)",
    color: "#ffffff",
    border: "1px solid rgba(255,255,255,0.16)",
    borderRadius: "8px",
    padding: "7px 9px",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 700,
  },

  statusPill: {
    borderRadius: "999px",
    padding: "7px 10px",
    fontSize: "11px",
    fontWeight: 950,
    lineHeight: 1.1,
    letterSpacing: "0.2px",
    whiteSpace: "nowrap",
    cursor: "default",
    pointerEvents: "none",
    textAlign: "center",
    minWidth: "82px",
  },

  readyPill: {
    background: "#dcfce7",
    color: "#064e3b",
    border: "1px solid #22c55e",
    boxShadow: "0 1px 0 rgba(6, 78, 59, 0.12)",
  },

  missingPill: {
    background: "#ffedd5",
    color: "#7c2d12",
    border: "1px solid #fb923c",
    boxShadow: "0 1px 0 rgba(124, 45, 18, 0.10)",
  },

  viewButton: {
    background: "#2563eb",
    color: "#ffffff",
    border: "none",
    borderRadius: "8px",
    padding: "7px 9px",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 700,
  },

  navSmallButton: {
    background: "#16a34a",
    color: "#ffffff",
    border: "none",
    borderRadius: "8px",
    padding: "7px 9px",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 700,
  },

  exportButton: {
    background: "#7c3aed",
    color: "#ffffff",
    border: "none",
    borderRadius: "8px",
    padding: "7px 9px",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 700,
  },

  emptyBox: {
    padding: "14px",
    borderRadius: "10px",
    color: "#9ca3af",
    background: "#111827",
    border: "1px dashed #374151",
    fontSize: "13px",
  },

  errorBox: {
    background: "#3b0a0a",
    color: "#fecaca",
    border: "1px solid #991b1b",
    borderRadius: "12px",
    padding: "12px",
    marginBottom: "14px",
  },
};
