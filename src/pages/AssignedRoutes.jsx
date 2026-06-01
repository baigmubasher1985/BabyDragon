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
  const isDark = useBabyDragonTheme();
  const styles = useMemo(() => makeStyles(isDark), [isDark]);

  const [tasks, setTasks] = useState([]);
  const [grids, setGrids] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [profiles, setProfiles] = useState([]);

  const [selectedGrid, setSelectedGrid] = useState(null);
  const [selectedRoute, setSelectedRoute] = useState(null);

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [listSearch, setListSearch] = useState("");
  const [expandedRouteId, setExpandedRouteId] = useState("");
  const [showRecords, setShowRecords] = useState(false);

  useEffect(() => {
    loadAssignedRoutes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

        setProfiles(!profileError && Array.isArray(profileData) ? profileData : []);
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
              assignedGridIds.some((gridId) => routeMatchesGridId(route, gridId))
            )
          : allRoutes;

      setRoutes(assignedRoutes);

      const initialSelection = getInitialSelectedGridOrRoute({
        assignedGrids,
        assignedRoutes,
      });

      const firstGridWithRoute =
        initialSelection?.grid ||
        assignedGrids.find((grid) => findRouteForGrid(grid, assignedRoutes)) ||
        assignedGrids[0] ||
        null;

      if (firstGridWithRoute) {
        const route =
          initialSelection?.route || findRouteForGrid(firstGridWithRoute, assignedRoutes);

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
    const gridId = getGridUniqueId(grid);

    if (gridId) {
      localStorage.setItem("babydragon_selected_route_grid_id", String(gridId));
    }

    setSelectedGrid(grid);
    setSelectedRoute(route || null);
  }

  function toggleRouteDetails(grid) {
    const key = String(getGridUniqueId(grid));
    setExpandedRouteId((current) => (String(current) === key ? "" : key));
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

    if (!query) return [];

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

  const selectedGridLabel = selectedGrid ? getGridLabel(selectedGrid) : "No grid selected";

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
      <section style={styles.heroCard}>
        <div style={styles.heroTextBlock}>
          <div style={styles.kicker}>Route Management</div>
          <h2 style={styles.title}>Assigned Routes</h2>
          <p style={styles.subtitle}>
            FE route view for assigned grids, saved route packages, grid boundary, and sector layers.
          </p>
        </div>

        <div style={styles.heroActions}>
          <span style={styles.flowPill}>Assigned Grid → Route → Field Work</span>
          <button
            type="button"
            onClick={loadAssignedRoutes}
            disabled={loading}
            style={styles.secondaryButton}
            title="Reload assigned tasks, assigned grids, and saved routes"
          >
            {loading ? "Refreshing..." : "Refresh Routes"}
          </button>
        </div>
      </section>

      {message && <div style={styles.message}>{message}</div>}

      <section style={styles.statsGrid}>
        <MetricCard styles={styles} title="Assigned Grids" value={grids.length} />
        <MetricCard styles={styles} title="Routes Ready" value={readyRouteCount} tone="good" />
        <MetricCard styles={styles} title="Missing Routes" value={missingRouteCount} tone="warning" />
      </section>

      <section style={styles.previewCard}>
        <div style={styles.sectionHeaderRow}>
          <div>
            <h3 style={styles.cardTitle}>Route Preview</h3>
            <p style={styles.cardSubtitle}>
              {selectedGrid ? `${selectedGridLabel} • ${selectedRouteLabel}` : "Select a grid to preview route details."}
            </p>
          </div>

          <div style={styles.headerPillsRow}>
            <span style={styles.mapBadge}>{selectedGrid ? "1 grid on map" : "0 grids"}</span>
            <span style={selectedRoute ? styles.goodBadge : styles.warningBadge}>
              {selectedRoute ? "Route Ready" : "Missing Route"}
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
                      Status: {selectedGrid.status || selectedGrid.testing_status || "Available"}
                    </span>
                  </div>
                </Popup>
              </GeoJSON>
            )}

            {selectedRouteGeojson && <RouteLineLayer geojson={selectedRouteGeojson} />}
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
      </section>

      <section style={styles.listCard}>
        <div style={styles.sectionHeaderRow}>
          <div>
            <h3 style={styles.cardTitle}>Assigned Grid Route List</h3>
            <p style={styles.cardSubtitle}>
              Showing selected grid by default. Search to find another assigned grid.
            </p>
          </div>

          <div style={styles.listHeaderActions}>
            <input
              value={listSearch}
              onChange={(event) => {
                setListSearch(event.target.value);
                setShowRecords(true);
              }}
              placeholder="Search assigned grids..."
              style={styles.input}
            />

            <button
              type="button"
              onClick={() => setShowRecords((current) => !current)}
              style={styles.secondaryButton}
            >
              {showRecords ? "Hide Records" : `Show Records (${filteredRoutesWithGrid.length})`}
            </button>
          </div>
        </div>

        {loading && <p style={styles.muted}>Loading assigned routes...</p>}

        {!loading && !showRecords && (
          <div style={styles.hiddenRecordsBox}>
            Assigned route records are hidden to keep the page fast and clean. The selected route is already shown on the map.
          </div>
        )}

        {!loading && showRecords && filteredRoutesWithGrid.length === 0 && (
          <div style={styles.hiddenRecordsBox}>
            Use grid name search or select a grid from the route map to show assigned route records.
          </div>
        )}

        {!loading && showRecords && filteredRoutesWithGrid.length > 0 && (
          <div style={styles.assignedRouteList}>
            {filteredRoutesWithGrid.map(({ grid, route, feInfo }) => {
              const isSelected =
                String(getGridUniqueId(grid)) === String(getGridUniqueId(selectedGrid));

              return (
                <div
                  key={getGridUniqueId(grid)}
                  style={{
                    ...styles.assignedRouteCard,
                    ...(isSelected ? styles.assignedRouteCardActive : {}),
                  }}
                >
                  <div style={styles.compactRouteTop}>
                    <div style={styles.compactRouteInfo}>
                      <span style={styles.gridIdentityLabel}>Assigned Grid</span>
                      <strong style={styles.gridIdentityName}>{getGridLabel(grid)}</strong>
                      <span style={styles.gridIdentityMarket}>
                        {getMarketLabel(grid)} • {formatRouteMode(route?.route_mode)} • {formatRouteLength(route)} • FE: {feInfo.display}
                      </span>
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

                      <button type="button" onClick={() => handleSelectGrid(grid)} style={styles.primaryButtonSmall}>
                        View Map
                      </button>

                      <button type="button" onClick={() => toggleRouteDetails(grid)} style={styles.secondaryButtonSmall}>
                        {String(expandedRouteId) === String(getGridUniqueId(grid)) ? "Hide" : "Details"}
                      </button>
                    </div>
                  </div>

                  {String(expandedRouteId) === String(getGridUniqueId(grid)) && (
                    <div style={styles.routeDetailsDrawer}>
                      <div style={styles.routeNameBox}>
                        <span style={styles.recordMiniLabel}>Saved Route</span>
                        <strong style={styles.routeNameValue}>{route?.route_name || "No route created"}</strong>
                      </div>

                      <div style={styles.routeMetaGrid}>
                        <InfoBox styles={styles} title="Mode" value={formatRouteMode(route?.route_mode)} />
                        <InfoBox styles={styles} title="Length" value={formatRouteLength(route)} />
                        <InfoBox styles={styles} title="Generated" value={formatGeneratedDate(route)} />
                        <InfoBox styles={styles} title="Assigned FE" value={feInfo.display} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function MetricCard({ styles, title, value, tone }) {
  const valueStyle = {
    ...styles.metricValue,
    ...(tone === "good" ? styles.goodText : {}),
    ...(tone === "warning" ? styles.warningText : {}),
  };

  return (
    <div style={styles.metricCard}>
      <span style={styles.metricTitle}>{title}</span>
      <strong style={valueStyle}>{value}</strong>
    </div>
  );
}

function InfoBox({ styles, title, value }) {
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
        color: "#00D4FF",
        weight: 7,
        opacity: 0.95,
        lineCap: "round",
        lineJoin: "round",
      },
      pointToLayer: (feature, latlng) => {
        return L.circleMarker(latlng, {
          radius: 5,
          color: "#00D4FF",
          fillColor: "#00D4FF",
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

function useBabyDragonTheme() {
  const [isDark, setIsDark] = useState(() => detectDarkMode());

  useEffect(() => {
    const updateTheme = () => setIsDark(detectDarkMode());

    updateTheme();

    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });

    window.addEventListener("storage", updateTheme);
    const interval = window.setInterval(updateTheme, 1200);

    return () => {
      observer.disconnect();
      window.removeEventListener("storage", updateTheme);
      window.clearInterval(interval);
    };
  }, []);

  return isDark;
}

function detectDarkMode() {
  if (typeof window === "undefined" || typeof document === "undefined") return false;

  const themeText = [
    document.documentElement.className,
    document.body.className,
    document.documentElement.dataset?.theme,
    document.body.dataset?.theme,
    localStorage.getItem("theme"),
    localStorage.getItem("babydragon_theme"),
    localStorage.getItem("colorMode"),
    localStorage.getItem("mode"),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/(dark|night)/.test(themeText)) return true;
  if (/(light|day)/.test(themeText)) return false;

  const bg = window.getComputedStyle(document.body).backgroundColor || "";
  const rgb = bg.match(/\d+(\.\d+)?/g)?.slice(0, 3).map(Number);

  if (rgb?.length === 3) {
    const brightness = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
    return brightness < 90;
  }

  return false;
}

function makeStyles(isDark) {
  const palette = isDark
    ? {
        text: "#F8FAFC",
        muted: "#A7C7F8",
        softMuted: "#7EA3D8",
        card: "#0B1728",
        card2: "#081320",
        input: "#081320",
        border: "rgba(96, 165, 250, 0.30)",
        borderStrong: "rgba(96, 165, 250, 0.55)",
        panel: "#0D1B2E",
        pill: "rgba(37, 99, 235, 0.15)",
        pillText: "#93C5FD",
        shadow: "0 14px 34px rgba(0,0,0,0.24)",
        hidden: "rgba(37, 99, 235, 0.08)",
      }
    : {
        text: "#081A33",
        muted: "#38506F",
        softMuted: "#64748B",
        card: "#FFFFFF",
        card2: "#F8FBFF",
        input: "#FFFFFF",
        border: "#BBD1FF",
        borderStrong: "#8FB7FF",
        panel: "#EFF6FF",
        pill: "#EEF6FF",
        pillText: "#0052CC",
        shadow: "0 10px 24px rgba(15, 23, 42, 0.06)",
        hidden: "#F0F7FF",
      };

  return {
    page: {
      width: "100%",
      maxWidth: "none",
      margin: 0,
      color: palette.text,
      padding: "0 0 22px",
      boxSizing: "border-box",
      display: "grid",
      gap: "14px",
    },

    heroCard: {
      background: palette.card,
      border: `1px solid ${palette.border}`,
      borderRadius: "18px",
      padding: "22px 24px",
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr) auto",
      alignItems: "center",
      gap: "16px",
      boxShadow: palette.shadow,
    },

    heroTextBlock: {
      textAlign: "left",
      minWidth: 0,
    },

    kicker: {
      marginBottom: "8px",
      color: "#2563EB",
      fontSize: "12px",
      fontWeight: 950,
      textTransform: "uppercase",
      letterSpacing: "0.16em",
    },

    title: {
      margin: 0,
      fontSize: "28px",
      fontWeight: 950,
      lineHeight: 1.1,
    },

    subtitle: {
      margin: "8px 0 0",
      color: palette.muted,
      fontSize: "14px",
      fontWeight: 700,
      lineHeight: 1.45,
    },

    heroActions: {
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: "10px",
      flexWrap: "wrap",
    },

    flowPill: {
      border: `1px solid ${palette.borderStrong}`,
      background: palette.pill,
      color: palette.pillText,
      borderRadius: "999px",
      padding: "12px 18px",
      fontSize: "16px",
      fontWeight: 950,
      whiteSpace: "nowrap",
    },

    secondaryButton: {
      border: `1px solid ${palette.borderStrong}`,
      background: palette.card2,
      color: palette.pillText,
      borderRadius: "11px",
      padding: "10px 14px",
      fontWeight: 900,
      cursor: "pointer",
      fontSize: "12px",
      whiteSpace: "nowrap",
    },

    primaryButtonSmall: {
      background: "linear-gradient(90deg, #2563EB, #06B6D4)",
      color: "#FFFFFF",
      border: "none",
      borderRadius: "10px",
      padding: "8px 11px",
      cursor: "pointer",
      fontSize: "12px",
      fontWeight: 900,
      whiteSpace: "nowrap",
    },

    secondaryButtonSmall: {
      background: palette.panel,
      color: palette.pillText,
      border: `1px solid ${palette.border}`,
      borderRadius: "10px",
      padding: "8px 11px",
      cursor: "pointer",
      fontSize: "12px",
      fontWeight: 900,
      whiteSpace: "nowrap",
    },

    message: {
      background: isDark ? "rgba(34,197,94,0.12)" : "#ECFDF3",
      border: isDark ? "1px solid rgba(34,197,94,0.35)" : "1px solid #86EFAC",
      color: isDark ? "#86EFAC" : "#047857",
      borderRadius: "14px",
      padding: "13px 14px",
      fontSize: "14px",
      fontWeight: 800,
      textAlign: "center",
    },

    statsGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      gap: "12px",
    },

    metricCard: {
      background: palette.card,
      border: `1px solid ${palette.border}`,
      borderRadius: "16px",
      padding: "18px 14px",
      textAlign: "center",
      minHeight: "74px",
      display: "grid",
      alignContent: "center",
      gap: "8px",
    },

    metricTitle: {
      display: "block",
      color: palette.muted,
      fontSize: "13px",
      fontWeight: 850,
    },

    metricValue: {
      color: palette.text,
      fontSize: "26px",
      fontWeight: 950,
      lineHeight: 1,
    },

    goodText: {
      color: "#22C55E",
    },

    warningText: {
      color: "#F59E0B",
    },

    previewCard: {
      background: palette.card,
      border: `1px solid ${palette.border}`,
      borderRadius: "18px",
      padding: "18px",
      display: "grid",
      gap: "12px",
    },

    listCard: {
      background: palette.card,
      border: `1px solid ${palette.border}`,
      borderRadius: "18px",
      padding: "18px",
      display: "grid",
      gap: "12px",
    },

    sectionHeaderRow: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: "14px",
      marginBottom: "2px",
      textAlign: "left",
    },

    headerPillsRow: {
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-end",
      flexWrap: "wrap",
      gap: "8px",
    },

    cardTitle: {
      margin: 0,
      color: palette.text,
      fontSize: "24px",
      fontWeight: 950,
      lineHeight: 1.1,
    },

    cardSubtitle: {
      margin: "6px 0 0",
      color: palette.muted,
      fontSize: "13px",
      fontWeight: 700,
      lineHeight: 1.4,
    },

    mapBadge: {
      border: `1px solid ${palette.borderStrong}`,
      color: palette.pillText,
      background: palette.pill,
      borderRadius: "999px",
      padding: "8px 11px",
      fontSize: "12px",
      fontWeight: 900,
      whiteSpace: "nowrap",
    },

    goodBadge: {
      border: isDark ? "1px solid rgba(34,197,94,0.45)" : "1px solid #86EFAC",
      background: isDark ? "rgba(34,197,94,0.12)" : "#ECFDF3",
      color: isDark ? "#86EFAC" : "#047857",
      borderRadius: "999px",
      padding: "8px 11px",
      fontSize: "12px",
      fontWeight: 900,
      whiteSpace: "nowrap",
    },

    warningBadge: {
      border: isDark ? "1px solid rgba(245,158,11,0.45)" : "1px solid #FDBA74",
      background: isDark ? "rgba(245,158,11,0.12)" : "#FFF7ED",
      color: isDark ? "#FCD34D" : "#C2410C",
      borderRadius: "999px",
      padding: "8px 11px",
      fontSize: "12px",
      fontWeight: 900,
      whiteSpace: "nowrap",
    },

    mapBox: {
      width: "100%",
      height: "390px",
      borderRadius: "16px",
      overflow: "hidden",
      border: `1px solid ${palette.border}`,
      background: palette.card2,
    },

    map: {
      width: "100%",
      height: "100%",
    },

    routeSummaryBox: {
      borderRadius: "14px",
      padding: "12px 14px",
      fontSize: "13px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "10px",
      textAlign: "center",
      fontWeight: 800,
      flexWrap: "wrap",
    },

    routeSummaryGood: {
      background: isDark ? "rgba(34,197,94,0.12)" : "#ECFDF3",
      border: isDark ? "1px solid rgba(34,197,94,0.35)" : "1px solid #86EFAC",
      color: isDark ? "#86EFAC" : "#047857",
    },

    routeSummaryWarning: {
      background: isDark ? "rgba(245,158,11,0.12)" : "#FFF7ED",
      border: isDark ? "1px solid rgba(245,158,11,0.35)" : "1px solid #FDBA74",
      color: isDark ? "#FCD34D" : "#C2410C",
    },

    listHeaderActions: {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      justifyContent: "flex-end",
      flexWrap: "wrap",
    },

    input: {
      width: "260px",
      maxWidth: "100%",
      background: palette.input,
      color: palette.text,
      border: `1px solid ${palette.border}`,
      borderRadius: "11px",
      padding: "10px 12px",
      outline: "none",
      fontSize: "13px",
      boxSizing: "border-box",
      fontWeight: 700,
    },

    muted: {
      color: palette.muted,
      fontSize: "13px",
      fontWeight: 700,
    },

    hiddenRecordsBox: {
      background: palette.hidden,
      border: `1px dashed ${palette.borderStrong}`,
      color: palette.text,
      borderRadius: "14px",
      padding: "15px",
      textAlign: "center",
      fontSize: "14px",
      fontWeight: 850,
    },

    assignedRouteList: {
      display: "grid",
      gap: "12px",
    },

    assignedRouteCard: {
      background: palette.card2,
      border: `1px solid ${palette.border}`,
      borderRadius: "16px",
      padding: "14px",
      display: "grid",
      gap: "12px",
      alignItems: "center",
    },

    assignedRouteCardActive: {
      border: `1px solid ${palette.borderStrong}`,
      background: isDark ? "rgba(37,99,235,0.12)" : "#F8FBFF",
    },

    compactRouteTop: {
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr) auto",
      gap: "12px",
      alignItems: "center",
    },

    compactRouteInfo: {
      minWidth: 0,
      textAlign: "left",
    },

    gridIdentityLabel: {
      display: "block",
      color: "#2563EB",
      fontSize: "11px",
      fontWeight: 950,
      textTransform: "uppercase",
      letterSpacing: "0.12em",
      marginBottom: "5px",
    },

    gridIdentityName: {
      color: palette.text,
      fontSize: "18px",
      fontWeight: 950,
      lineHeight: 1.25,
      wordBreak: "break-word",
      display: "block",
    },

    gridIdentityMarket: {
      color: palette.muted,
      fontSize: "13px",
      fontWeight: 800,
      display: "block",
      marginTop: "4px",
    },

    assignedRouteActions: {
      display: "flex",
      gap: "8px",
      justifyContent: "flex-end",
      alignItems: "center",
      flexWrap: "wrap",
    },

    statusPill: {
      borderRadius: "999px",
      padding: "8px 11px",
      fontSize: "12px",
      fontWeight: 950,
      whiteSpace: "nowrap",
      cursor: "default",
      pointerEvents: "none",
    },

    readyPill: {
      background: isDark ? "rgba(34,197,94,0.16)" : "#DCFCE7",
      color: isDark ? "#86EFAC" : "#047857",
      border: isDark ? "1px solid rgba(34,197,94,0.36)" : "1px solid #86EFAC",
    },

    missingPill: {
      background: isDark ? "rgba(245,158,11,0.16)" : "#FEF3C7",
      color: isDark ? "#FCD34D" : "#A16207",
      border: isDark ? "1px solid rgba(245,158,11,0.36)" : "1px solid #FACC15",
    },

    routeDetailsDrawer: {
      borderTop: `1px solid ${palette.border}`,
      paddingTop: "12px",
      display: "grid",
      gap: "10px",
    },

    routeNameBox: {
      background: palette.card,
      border: `1px solid ${palette.border}`,
      borderRadius: "13px",
      padding: "12px",
      minWidth: 0,
      textAlign: "left",
    },

    routeNameValue: {
      display: "block",
      color: palette.text,
      fontSize: "14px",
      fontWeight: 950,
      whiteSpace: "normal",
      overflow: "visible",
      textOverflow: "clip",
      lineHeight: 1.35,
      wordBreak: "break-word",
    },

    routeMetaGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(4, minmax(110px, 1fr))",
      gap: "8px",
    },

    recordMiniBox: {
      background: palette.card,
      border: `1px solid ${palette.border}`,
      borderRadius: "13px",
      padding: "10px",
      minWidth: 0,
      textAlign: "left",
    },

    recordMiniLabel: {
      display: "block",
      color: palette.softMuted,
      fontSize: "10px",
      fontWeight: 950,
      marginBottom: "5px",
      textTransform: "uppercase",
      letterSpacing: "0.08em",
    },

    recordMiniValue: {
      display: "block",
      color: palette.text,
      fontSize: "13px",
      fontWeight: 900,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "normal",
      lineHeight: 1.3,
      wordBreak: "break-word",
    },
  };
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
    task?.target_name,
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

    const matchesId = possibleUserIds.some((value) => String(value) === String(userId));

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
      task.target_name,
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
    return value.flatMap((item) => extractGridIdsFromValue(item)).filter(Boolean);
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

  const urlRouteId = params.get("route_id") || params.get("routeId") || params.get("route");

  const localGridId =
    localStorage.getItem("babydragon_selected_route_grid_id") ||
    localStorage.getItem("selected_route_grid_id") ||
    localStorage.getItem("assignedRouteGridId") ||
    localStorage.getItem("selectedGridId") ||
    localStorage.getItem("myRoutesSelectedGridId") ||
    localStorage.getItem("feRouteSelectedGridId");

  const wantedGridId = urlGridId || localGridId;

  if (urlRouteId) {
    const route = assignedRoutes.find((item) => String(item.id) === String(urlRouteId));

    if (route) {
      const grid = findGridForRoute(route, assignedGrids);

      if (grid) return { grid, route };
    }
  }

  if (wantedGridId) {
    const grid = assignedGrids.find((item) => gridMatchesAnyId(item, [wantedGridId]));

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

  const body = text.replace(/^POLYGON\s*\(\(/i, "").replace(/\)\)\s*$/i, "");

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
      const routeKeys = getRouteMatchKeys(route);
      return gridKeys.some((gridKey) =>
        routeKeys.some((routeKey) => String(gridKey) === String(routeKey))
      );
    }) || null
  );
}

function findGridForRoute(route, grids) {
  if (!route) return null;

  const routeKeys = getRouteMatchKeys(route);

  return (
    grids.find((grid) => {
      const gridKeys = getGridMatchKeys(grid);
      return gridKeys.some((gridKey) =>
        routeKeys.some((routeKey) => String(gridKey) === String(routeKey))
      );
    }) || null
  );
}

function routeMatchesGridId(route, gridId) {
  const routeKeys = getRouteMatchKeys(route);
  return routeKeys.some((key) => String(key) === String(gridId));
}

function getRouteMatchKeys(route) {
  if (!route) return [];

  return [
    route.grid_id,
    route.gridId,
    route.grid_db_id,
    route.grid_code,
    route.grid_name,
  ].filter((value) => value !== undefined && value !== null && value !== "");
}

function gridMatchesAnyId(grid, ids) {
  const gridKeys = getGridMatchKeys(grid);

  return ids.some((id) => gridKeys.some((gridKey) => String(gridKey) === String(id)));
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
