// src/pages/AssignedRoutes.jsx

import React, { useEffect, useMemo, useState } from "react";
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

const DEFAULT_CENTER = [32.7767, -96.797];
const DEFAULT_ZOOM = 10;

export default function AssignedRoutes() {
  const [tasks, setTasks] = useState([]);
  const [grids, setGrids] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [profiles, setProfiles] = useState([]);

  const [selectedGrid, setSelectedGrid] = useState(null);
  const [selectedRoute, setSelectedRoute] = useState(null);

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [listSearch, setListSearch] = useState("");

  useEffect(() => {
    loadAssignedRoutes();
  }, []);

  async function loadAssignedRoutes() {
    setLoading(true);
    setMessage("");

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;

      const { data: taskData, error: taskError } = await supabase
        .from("tasks")
        .select("*");

      if (taskError) throw taskError;

      const allTasks = Array.isArray(taskData) ? taskData : [];
      const myTasks = getTasksForUser(allTasks, user);
      const finalTasks = myTasks.length > 0 ? myTasks : allTasks;

      setTasks(finalTasks);

      const feIds = Array.from(
        new Set(
          finalTasks
            .map((task) => getTaskFeId(task))
            .filter((value) => value !== undefined && value !== null && value !== "")
        )
      );

      if (feIds.length > 0) {
        const { data: profileData, error: profileError } = await supabase
          .from("profiles")
          .select("*")
          .in("id", feIds);

        if (!profileError) {
          setProfiles(Array.isArray(profileData) ? profileData : []);
        } else {
          setProfiles([]);
        }
      } else {
        setProfiles([]);
      }

      const assignedGridIds = extractAssignedGridIds(finalTasks);

      const { data: gridData, error: gridError } = await supabase
        .from("grids")
        .select("*");

      if (gridError) throw gridError;

      const allGrids = Array.isArray(gridData) ? gridData : [];

      const assignedGrids =
        assignedGridIds.length > 0
          ? allGrids.filter((grid) => gridMatchesAnyId(grid, assignedGridIds))
          : allGrids;

      setGrids(assignedGrids);

      const { data: routeData, error: routeError } = await supabase
        .from("routes")
        .select("*")
        .order("created_at", { ascending: false });

      if (routeError) throw routeError;

      const allRoutes = Array.isArray(routeData) ? routeData : [];

      const assignedRoutes =
        assignedGridIds.length > 0
          ? allRoutes.filter((route) =>
              assignedGridIds.some((gridId) =>
                routeMatchesGridId(route, gridId)
              )
            )
          : allRoutes;

      setRoutes(assignedRoutes);

      const initialSelection = getInitialSelectedGridOrRoute({
        assignedGrids,
        assignedRoutes,
      });

      if (initialSelection?.grid) {
        const route =
          initialSelection.route ||
          findRouteForGrid(initialSelection.grid, assignedRoutes);

        setSelectedGrid(initialSelection.grid);
        setSelectedRoute(route || null);
      } else if (assignedGrids.length > 0) {
        const firstGridWithRoute =
          assignedGrids.find((grid) => findRouteForGrid(grid, assignedRoutes)) ||
          assignedGrids[0];

        const route = findRouteForGrid(firstGridWithRoute, assignedRoutes);

        setSelectedGrid(firstGridWithRoute);
        setSelectedRoute(route || null);
      } else {
        setSelectedGrid(null);
        setSelectedRoute(null);
      }
    } catch (error) {
      console.error(error);
      setMessage(error.message || "Unable to load assigned routes.");
    } finally {
      setLoading(false);
    }
  }

  function handleSelectGrid(grid) {
    const route = findRouteForGrid(grid, routes);

    setSelectedGrid(grid);
    setSelectedRoute(route || null);
  }

  function handleSelectRoute(route) {
    const grid = findGridForRoute(route, grids);

    setSelectedRoute(route || null);

    if (grid) {
      setSelectedGrid(grid);
    }
  }

  const selectedGridFeature = useMemo(() => {
    if (!selectedGrid) return null;
    return buildGridFeature(selectedGrid);
  }, [selectedGrid]);

  const selectedRouteGeojson = useMemo(() => {
    if (!selectedRoute?.route_geojson) return null;
    return parseRouteGeojson(selectedRoute.route_geojson);
  }, [selectedRoute]);

  const taskByGridId = useMemo(() => {
    const map = new Map();

    tasks.forEach((task) => {
      const gridIds = extractGridIdsFromTask(task);

      gridIds.forEach((gridId) => {
        if (!map.has(String(gridId))) {
          map.set(String(gridId), task);
        }
      });
    });

    return map;
  }, [tasks]);

  const profileById = useMemo(() => {
    const map = new Map();

    profiles.forEach((profile) => {
      if (profile?.id) {
        map.set(String(profile.id), profile);
      }
    });

    return map;
  }, [profiles]);

  const routesWithGrid = useMemo(() => {
    return grids.map((grid) => {
      const route = findRouteForGrid(grid, routes);
      const task = findTaskForGrid(grid, taskByGridId);
      const feInfo = getFeInfoFromTask(task, profileById);

      return {
        grid,
        route,
        task,
        feInfo,
      };
    });
  }, [grids, routes, taskByGridId, profileById]);

  const filteredRoutesWithGrid = useMemo(() => {
    const query = listSearch.trim().toLowerCase();

    if (!query && selectedGrid) {
      return routesWithGrid.filter(({ grid }) => {
        return String(getGridUniqueId(grid)) === String(getGridUniqueId(selectedGrid));
      });
    }

    if (!query) {
      return [];
    }

    return routesWithGrid.filter(({ grid, route, feInfo }) => {
      const haystack = [
        getGridLabel(grid),
        getMarketLabel(grid),
        route?.route_name,
        route?.route_mode,
        formatRouteLength(route),
        formatGeneratedDate(route),
        feInfo?.display,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [routesWithGrid, listSearch, selectedGrid]);

  const readyRouteCount = routesWithGrid.filter((item) => item.route).length;
  const missingRouteCount = Math.max(grids.length - readyRouteCount, 0);

  const selectedGridLabel = selectedGrid
    ? getGridLabel(selectedGrid)
    : "No grid selected";

  const selectedRouteLabel = selectedRoute
    ? selectedRoute.route_name ||
      `${selectedGridLabel} - ${formatRouteMode(selectedRoute.route_mode)}`
    : "No saved route for this grid";

  const selectedRouteSummary = selectedRoute
    ? `Route Ready • ${formatRouteMode(selectedRoute.route_mode)} • ${formatRouteLength(
        selectedRoute
      )} • Generated ${formatGeneratedDate(selectedRoute)}`
    : "Missing Route • Admin needs to generate this route";

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
          onClick={loadAssignedRoutes}
          disabled={loading}
          style={styles.refreshButtonTopRight}
          title="Reload assigned tasks, assigned grids, and saved routes"
        >
          {loading ? "Refreshing..." : "Refresh Routes"}
        </button>
      </div>

      {message && <div style={styles.message}>{message}</div>}

      <div style={styles.statsGrid}>
        <MetricCard title="Assigned Grids" value={grids.length} />
        <MetricCard title="Routes Ready" value={readyRouteCount} good />
        <MetricCard title="Missing Routes" value={missingRouteCount} warning />
      </div>

      <div style={styles.previewCard}>
        <div style={styles.previewHeader}>
          <div>
            <h3 style={styles.cardTitle}>Route Preview: {selectedGridLabel}</h3>
            <p style={styles.cardSubtitle}>{selectedRouteLabel}</p>
          </div>

          <span style={styles.mapBadge}>
            {selectedGrid ? "1 grid on map" : "0 grids"}
          </span>
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
              selectedGridFeature={selectedGridFeature}
              selectedRouteGeojson={selectedRouteGeojson}
            />

            <CellSectorLayer
              market={selectedGrid ? getMarketLabel(selectedGrid) : ""}
              showSites
              showSectors
              maxRecords={1200}
              sectorRadiusM={550}
            />

            {selectedGridFeature && (
              <GeoJSON
                key={`assigned-grid-${getGridUniqueId(selectedGrid)}`}
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
                    <strong>{getGridLabel(selectedGrid)}</strong>
                    <br />
                    <span>Market: {getMarketLabel(selectedGrid)}</span>
                    <br />
                    <span>
                      Status:{" "}
                      {selectedGrid.status ||
                        selectedGrid.testing_status ||
                        "Available"}
                    </span>
                  </div>
                </Popup>
              </GeoJSON>
            )}

            {selectedRouteGeojson && (
              <RouteLineLayer geojson={selectedRouteGeojson} />
            )}
          </MapContainer>
        </div>

        {selectedGrid && (
          <div
            style={{
              ...styles.routeSummaryBox,
              ...(selectedRoute ? styles.routeSummaryGood : styles.routeSummaryWarning),
            }}
          >
            <b>{selectedRoute ? "Route Ready" : "Missing Route"}</b>
            <span>{selectedRouteSummary}</span>
          </div>
        )}
      </div>

      <div style={styles.listCard}>
        <div style={styles.previewHeader}>
          <div>
            <h3 style={styles.cardTitle}>Assigned Grid Route List</h3>
            <p style={styles.cardSubtitle}>
              Showing the selected grid route. Use search to find another assigned grid.
            </p>
          </div>

          <div style={styles.listHeaderActions}>
            <input
              value={listSearch}
              onChange={(event) => setListSearch(event.target.value)}
              placeholder="Search assigned grids..."
              style={styles.listSearch}
            />

            <button
              type="button"
              onClick={loadAssignedRoutes}
              disabled={loading}
              style={styles.button}
            >
              {loading ? "Reloading..." : "Reload"}
            </button>
          </div>
        </div>

        {loading && <p style={styles.muted}>Loading assigned routes...</p>}

        {!loading && filteredRoutesWithGrid.length === 0 && (
          <p style={styles.muted}>Use grid name search or click View Map to show assigned route records.</p>
        )}

        <div style={styles.assignedRouteList}>
          {filteredRoutesWithGrid.map(({ grid, route, feInfo }) => {
            const isSelected =
              String(getGridUniqueId(grid)) ===
              String(getGridUniqueId(selectedGrid));

            return (
              <div
                key={getGridUniqueId(grid)}
                style={{
                  ...styles.assignedRouteCard,
                  ...(isSelected ? styles.assignedRouteCardActive : {}),
                }}
              >
                <div style={styles.gridIdentityBlock}>
                  <span style={styles.gridIdentityLabel}>Assigned Grid</span>
                  <strong style={styles.gridIdentityName}>{getGridLabel(grid)}</strong>
                  <span style={styles.gridIdentityMarket}>{getMarketLabel(grid)}</span>
                </div>

                <div style={styles.routeDetailsBlock}>
                  <div style={styles.routeNameBox}>
                    <span style={styles.recordMiniLabel}>Saved Route</span>
                    <strong style={styles.routeNameValue}>
                      {route?.route_name || "No route created"}
                    </strong>

                    <div style={styles.feUnderRouteLine}>
                      <span style={styles.feInlineLabel}>FE</span>
                      <strong style={styles.feInlineValue}>{feInfo.display}</strong>
                    </div>
                  </div>

                  <div style={styles.routeMetaGrid}>
                    <InfoBox title="Mode" value={formatRouteMode(route?.route_mode)} />
                    <InfoBox title="Length" value={formatRouteLength(route)} />
                    <InfoBox title="Generated" value={formatGeneratedDate(route)} />
                  </div>
                </div>

                <div style={styles.assignedRouteActions}>
                  <span
                    style={{
                      ...styles.statusPill,
                      ...(route ? styles.readyPill : styles.missingPill),
                    }}
                  >
                    {route ? "Route Ready" : "Missing Route"}
                  </span>

                  <button
                    type="button"
                    onClick={() => handleSelectGrid(grid)}
                    style={styles.viewButton}
                  >
                    View Map
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, good, warning }) {
  return (
    <div style={styles.metricCard}>
      <span style={styles.metricTitle}>{title}</span>
      <strong
        style={{
          ...styles.metricValue,
          color: good ? "#22C55E" : warning ? "#F59E0B" : "#fff",
        }}
      >
        {value}
      </strong>
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

function MapBoundsController({ selectedGridFeature, selectedRouteGeojson }) {
  const map = useMap();

  useEffect(() => {
    const layers = [];

    if (selectedGridFeature) {
      layers.push(L.geoJSON(selectedGridFeature));
    }

    if (selectedRouteGeojson) {
      layers.push(L.geoJSON(selectedRouteGeojson));
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
  }, [map, selectedGridFeature, selectedRouteGeojson]);

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


function getTaskFeId(task) {
  if (!task) return "";

  return (
    task.assigned_to ||
    task.fe_id ||
    task.assigned_fe ||
    task.assigned_fe_id ||
    task.field_engineer_id ||
    task.user_id ||
    task.created_for ||
    ""
  );
}

function getTaskFeEmail(task) {
  if (!task) return "";

  return (
    task.fe_email ||
    task.assigned_fe_email ||
    task.assigned_to_email ||
    task.field_engineer_email ||
    task.email ||
    ""
  );
}

function getTaskFeName(task) {
  if (!task) return "";

  return (
    task.fe_name ||
    task.assigned_fe_name ||
    task.field_engineer_name ||
    task.engineer_name ||
    ""
  );
}

function extractGridIdsFromTask(task) {
  const candidates = [
    task?.grid_id,
    task?.gridId,
    task?.assigned_grid_id,
    task?.target_grid_id,
    task?.assigned_grid_ids,
    task?.grid_ids,
    task?.selected_grid_ids,
    task?.assigned_grids,
    task?.grids,
  ];

  return candidates.flatMap((candidate) => extractGridIdsFromValue(candidate));
}

function findTaskForGrid(grid, taskByGridId) {
  const gridKeys = getGridMatchKeys(grid);

  for (const key of gridKeys) {
    const task = taskByGridId.get(String(key));

    if (task) return task;
  }

  return null;
}

function getFeInfoFromTask(task, profileById) {
  if (!task) {
    return {
      display: "Unassigned",
      name: "",
      email: "",
    };
  }

  const feId = getTaskFeId(task);
  const profile = feId ? profileById.get(String(feId)) : null;

  const name =
    profile?.full_name ||
    profile?.name ||
    profile?.display_name ||
    getTaskFeName(task) ||
    "";

  const email =
    profile?.email ||
    profile?.user_email ||
    getTaskFeEmail(task) ||
    (feId ? String(feId).slice(0, 8) : "");

  const display = name && email ? `${name} • ${email}` : name || email || "Assigned FE";

  return {
    display,
    name,
    email,
  };
}


function getTasksForUser(tasks, user) {
  if (!user) return tasks;

  const userId = user.id;
  const userEmail = user.email;

  return tasks.filter((task) => {
    const possibleUserIds = [
      task.fe_id,
      task.assigned_to,
      task.assigned_fe,
      task.assigned_fe_id,
      task.field_engineer_id,
      task.user_id,
      task.created_for,
    ].filter(Boolean);

    const possibleEmails = [
      task.fe_email,
      task.assigned_fe_email,
      task.assigned_to_email,
      task.field_engineer_email,
      task.email,
    ].filter(Boolean);

    const matchesId = possibleUserIds.some(
      (value) => String(value) === String(userId)
    );

    const matchesEmail = possibleEmails.some(
      (value) => String(value).toLowerCase() === String(userEmail).toLowerCase()
    );

    return matchesId || matchesEmail;
  });
}

function extractAssignedGridIds(tasks) {
  const ids = new Set();

  for (const task of tasks) {
    const candidates = [
      task.grid_id,
      task.gridId,
      task.assigned_grid_id,
      task.target_grid_id,
      task.assigned_grid_ids,
      task.grid_ids,
      task.selected_grid_ids,
      task.assigned_grids,
      task.grids,
    ];

    for (const candidate of candidates) {
      extractGridIdsFromValue(candidate).forEach((id) => ids.add(String(id)));
    }
  }

  return Array.from(ids).filter(Boolean);
}

function extractGridIdsFromValue(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .flatMap((item) => extractGridIdsFromValue(item))
      .filter(Boolean);
  }

  if (typeof value === "object") {
    return [
      value.id,
      value.grid_id,
      value.gridId,
      value.grid_code,
      value.number,
      value.name,
      value.grid_name,
    ].filter(Boolean);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) return [];

    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        return extractGridIdsFromValue(JSON.parse(trimmed));
      } catch {
        return [trimmed];
      }
    }

    if (trimmed.includes(",")) {
      return trimmed
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }

    return [trimmed];
  }

  return [value];
}

function getInitialSelectedGridOrRoute({ assignedGrids, assignedRoutes }) {
  const params = new URLSearchParams(window.location.search);

  const urlGridId =
    params.get("grid_id") ||
    params.get("gridId") ||
    params.get("grid") ||
    params.get("selected_grid_id") ||
    params.get("selectedGridId");

  const urlRouteId =
    params.get("route_id") || params.get("routeId") || params.get("route");

  const localGridId =
    localStorage.getItem("babydragon_selected_route_grid_id") ||
    localStorage.getItem("selected_route_grid_id") ||
    localStorage.getItem("assignedRouteGridId") ||
    localStorage.getItem("selectedGridId") ||
    localStorage.getItem("myRoutesSelectedGridId") ||
    localStorage.getItem("feRouteSelectedGridId");

  const wantedGridId = urlGridId || localGridId;

  if (urlRouteId) {
    const route = assignedRoutes.find(
      (item) => String(item.id) === String(urlRouteId)
    );

    if (route) {
      const grid = findGridForRoute(route, assignedGrids);

      if (grid) {
        return { grid, route };
      }
    }
  }

  if (wantedGridId) {
    const grid = assignedGrids.find((item) =>
      gridMatchesAnyId(item, [wantedGridId])
    );

    if (grid) {
      return {
        grid,
        route: findRouteForGrid(grid, assignedRoutes),
      };
    }
  }

  return null;
}

function buildGridFeature(grid) {
  if (!grid) return null;

  const geometry = getGridGeometry(grid);

  if (!geometry) return null;

  return {
    type: "Feature",
    properties: {
      ...grid,
    },
    geometry,
  };
}

function getGridGeometry(grid) {
  const candidates = [
    grid.route_boundary_geojson,
    grid.boundary_geojson,
    grid.boundary,
    grid.geometry,
    grid.geom,
    grid.geojson,
    grid.polygon,
  ];

  for (const candidate of candidates) {
    const parsed = parseGeometryCandidate(candidate);

    if (parsed?.type === "Polygon" || parsed?.type === "MultiPolygon") {
      return parsed;
    }
  }

  return null;
}

function parseGeometryCandidate(candidate) {
  if (!candidate) return null;

  if (typeof candidate === "object") {
    if (candidate.type === "Feature") return candidate.geometry;

    if (candidate.type === "FeatureCollection") {
      const polygonFeature = candidate.features?.find((feature) =>
        ["Polygon", "MultiPolygon"].includes(feature?.geometry?.type)
      );

      return polygonFeature?.geometry || null;
    }

    return candidate;
  }

  if (typeof candidate !== "string") return null;

  const trimmed = candidate.trim();

  try {
    const json = JSON.parse(trimmed);

    if (json.type === "Feature") return json.geometry;

    if (json.type === "FeatureCollection") {
      const polygonFeature = json.features?.find((feature) =>
        ["Polygon", "MultiPolygon"].includes(feature?.geometry?.type)
      );

      return polygonFeature?.geometry || null;
    }

    return json;
  } catch {
    return parseWktPolygon(trimmed);
  }
}

function parseWktPolygon(wkt) {
  if (!wkt || typeof wkt !== "string") return null;

  const text = wkt.trim();

  if (!text.toUpperCase().startsWith("POLYGON")) return null;

  const body = text
    .replace(/^POLYGON\s*\(\(/i, "")
    .replace(/\)\)\s*$/i, "");

  const ring = body
    .split(",")
    .map((pair) => {
      const [lng, lat] = pair.trim().split(/\s+/).map(Number);

      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;

      return [lng, lat];
    })
    .filter(Boolean);

  if (ring.length < 4) return null;

  return {
    type: "Polygon",
    coordinates: [ring],
  };
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

  if (parsed.type === "FeatureCollection") return parsed;

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

function findRouteForGrid(grid, routes) {
  if (!grid) return null;

  const gridKeys = getGridMatchKeys(grid);

  return (
    routes.find((route) => {
      const routeGridId = route.grid_id ?? route.gridId ?? route.grid_db_id;

      return gridKeys.some((key) => String(key) === String(routeGridId));
    }) || null
  );
}

function findGridForRoute(route, grids) {
  if (!route) return null;

  const routeGridId = route.grid_id ?? route.gridId ?? route.grid_db_id;

  return (
    grids.find((grid) => {
      const gridKeys = getGridMatchKeys(grid);

      return gridKeys.some((key) => String(key) === String(routeGridId));
    }) || null
  );
}

function routeMatchesGridId(route, gridId) {
  const routeKeys = [
    route.grid_id,
    route.gridId,
    route.grid_db_id,
    route.grid_code,
    route.grid_name,
  ].filter(Boolean);

  return routeKeys.some((key) => String(key) === String(gridId));
}

function gridMatchesAnyId(grid, ids) {
  const gridKeys = getGridMatchKeys(grid);

  return ids.some((id) =>
    gridKeys.some((gridKey) => String(gridKey) === String(id))
  );
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

function getGridUniqueId(grid) {
  if (!grid) return "";

  return (
    grid.id ||
    grid.grid_id ||
    grid.grid_db_id ||
    grid.grid_code ||
    grid.number ||
    grid.name ||
    grid.grid_name ||
    "unknown-grid"
  );
}

function getGridLabel(grid) {
  if (!grid) return "Unknown Grid";

  return (
    grid.grid_name ||
    grid.name ||
    grid.grid_id ||
    grid.grid_code ||
    grid.number ||
    grid.Real_GridCode ||
    grid.real_grid_code ||
    grid.GRID_ID ||
    grid.id ||
    "Grid"
  );
}

function getMarketLabel(grid) {
  if (!grid) return "Unknown Market";

  return grid.market || grid.market_name || grid.Market || "Unknown Market";
}

function formatRouteMode(mode) {
  if (!mode) return "N/A";

  return String(mode)
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
    padding: "16px",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    textAlign: "center",
    gap: "12px",
    marginBottom: "12px",
    position: "relative",
    minHeight: "74px",
  },

  headerCenter: {
    maxWidth: "560px",
    margin: "0 auto",
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
    position: "absolute",
    right: "16px",
    top: "50%",
    transform: "translateY(-50%)",
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

  button: {
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.07)",
    color: "#fff",
    borderRadius: "9px",
    padding: "9px 12px",
    fontWeight: 800,
    cursor: "pointer",
  },

  message: {
    background: "rgba(250,204,21,0.12)",
    border: "1px solid rgba(250,204,21,0.35)",
    color: "#FDE68A",
    borderRadius: "12px",
    padding: "10px 12px",
    marginBottom: "12px",
    fontSize: "13px",
  },

  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "10px",
    marginBottom: "12px",
  },

  metricCard: {
    background: "#101828",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "14px",
    padding: "14px",
    textAlign: "center",
  },

  metricTitle: {
    display: "block",
    color: "#D0D5DD",
    fontSize: "13px",
    marginBottom: "8px",
    fontWeight: 700,
  },

  metricValue: {
    fontSize: "22px",
    fontWeight: 900,
  },

  previewCard: {
    background: "#101828",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "14px",
    padding: "14px",
    marginBottom: "12px",
  },

  previewHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "12px",
    marginBottom: "12px",
  },

  listHeaderActions: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    justifyContent: "flex-end",
    flexWrap: "wrap",
  },

  listSearch: {
    width: "220px",
    maxWidth: "100%",
    background: "#0B1220",
    color: "#fff",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: "9px",
    padding: "9px 11px",
    outline: "none",
    fontSize: "12px",
    boxSizing: "border-box",
  },

  cardTitle: {
    margin: 0,
    fontSize: "16px",
    fontWeight: 900,
  },

  cardSubtitle: {
    margin: "5px 0 0",
    color: "#98A2B3",
    fontSize: "12px",
  },

  mapBadge: {
    border: "1px solid rgba(147,197,253,0.45)",
    color: "#BFDBFE",
    borderRadius: "999px",
    padding: "6px 9px",
    fontSize: "11px",
    fontWeight: 800,
    whiteSpace: "nowrap",
  },

  mapBox: {
    width: "100%",
    height: "420px",
    borderRadius: "12px",
    overflow: "hidden",
    border: "1px solid rgba(255,255,255,0.12)",
    background: "#0B1220",
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

  muted: {
    color: "#98A2B3",
    fontSize: "13px",
  },

  assignedRouteList: {
    display: "grid",
    gap: "12px",
  },

  assignedRouteCard: {
    background: "#0B1220",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "14px",
    padding: "14px",
    display: "grid",
    gridTemplateColumns: "150px minmax(0, 1fr) 118px",
    gap: "14px",
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

  gridIdentityBlock: {
    background: "rgba(37,99,235,0.12)",
    border: "1px solid rgba(96,165,250,0.35)",
    borderRadius: "12px",
    padding: "12px 10px",
    textAlign: "center",
    display: "grid",
    gap: "5px",
    alignContent: "center",
    minHeight: "92px",
  },

  gridIdentityLabel: {
    color: "#BFDBFE",
    fontSize: "11px",
    fontWeight: 900,
  },

  gridIdentityName: {
    color: "#fff",
    fontSize: "15px",
    fontWeight: 900,
    lineHeight: 1.25,
    wordBreak: "break-word",
  },

  gridIdentityMarket: {
    color: "#93C5FD",
    fontSize: "12px",
    fontWeight: 800,
  },

  routeDetailsBlock: {
    display: "grid",
    gap: "8px",
    minWidth: 0,
  },

  routeNameBox: {
    background: "rgba(255,255,255,0.045)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "11px",
    padding: "10px 12px",
    minWidth: 0,
  },

  routeNameValue: {
    display: "block",
    color: "#fff",
    fontSize: "13px",
    fontWeight: 900,
    whiteSpace: "normal",
    overflow: "visible",
    textOverflow: "clip",
    lineHeight: 1.35,
    wordBreak: "break-word",
  },

  routeMetaGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "8px",
  },

  feUnderRouteLine: {
    marginTop: "8px",
    paddingTop: "7px",
    borderTop: "1px solid rgba(255,255,255,0.08)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    minWidth: 0,
  },

  feInlineLabel: {
    color: "#98A2B3",
    fontSize: "10px",
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    flex: "0 0 auto",
  },

  feInlineValue: {
    color: "#fff",
    fontSize: "12px",
    fontWeight: 900,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
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
    gridTemplateColumns: "repeat(4, minmax(90px, 1fr))",
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
    whiteSpace: "normal",
    lineHeight: 1.3,
    wordBreak: "break-word",
  },

  assignedRouteActions: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    justifyContent: "center",
    alignItems: "stretch",
    width: "118px",
  },

  statusPill: {
    borderRadius: "999px",
    padding: "6px 9px",
    fontSize: "11px",
    fontWeight: 900,
    whiteSpace: "nowrap",
    cursor: "default",
    pointerEvents: "none",
  },

  readyPill: {
    background: "#052e1a",
    color: "#bbf7d0",
    border: "1px solid #166534",
  },

  missingPill: {
    background: "#451a03",
    color: "#fed7aa",
    border: "1px solid #9a3412",
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

  secondaryActionButton: {
    background: "rgba(255,255,255,0.07)",
    color: "#ffffff",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: "8px",
    padding: "7px 9px",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 700,
  },
};
