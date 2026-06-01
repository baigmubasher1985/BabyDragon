// src/pages/RouteManagement.jsx

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
import RouteGeneratorPanel from "../components/routes/RouteGeneratorPanel";
import CellSectorLayer from "../components/maps/CellSectorLayer";
import {
  ROUTE_MODES,
  formatMeters,
  generateRouteForGrid,
} from "../utils/routeGeneration";
import {
  exportRouteKml,
  exportRouteHtml,
  exportRouteZip,
} from "../utils/routeExport";

const DEFAULT_CENTER = [32.7767, -96.797];
const DEFAULT_ZOOM = 10;

export default function RouteManagement() {
  const [grids, setGrids] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [cellSectors, setCellSectors] = useState([]);

  const [selectedGrid, setSelectedGrid] = useState(null);
  const [selectedGridIds, setSelectedGridIds] = useState([]);
  const [selectedRoute, setSelectedRoute] = useState(null);

  const [previewRouteGeojson, setPreviewRouteGeojson] = useState(null);
  const [previewRouteKey, setPreviewRouteKey] = useState(0);

  const [gridSearch, setGridSearch] = useState("");
  const [routeSearch, setRouteSearch] = useState("");
  const [marketFilter, setMarketFilter] = useState("all");
  const [selectionMode, setSelectionMode] = useState("single");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [batchDrawerOpen, setBatchDrawerOpen] = useState(false);
  const [batchMode, setBatchMode] = useState("dense");
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchLog, setBatchLog] = useState([]);
  const [batchComplete, setBatchComplete] = useState(false);
  const [batchSummary, setBatchSummary] = useState("");
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadPageData();
  }, []);

  async function loadPageData() {
    setLoading(true);
    setMessage("");

    try {
      await Promise.all([loadGrids(), loadRoutes(), loadCellSectors()]);
    } catch (error) {
      console.error(error);
      setMessage(error.message || "Unable to load route management data.");
    } finally {
      setLoading(false);
    }
  }

  async function loadGrids() {
    const { data, error } = await supabase.from("grids").select("*");

    if (error) throw error;

    setGrids(Array.isArray(data) ? data : []);
  }

  async function loadRoutes() {
    const { data, error } = await supabase
      .from("routes")
      .select("*")
      .order("generated_at", { ascending: false, nullsFirst: false });

    if (error) throw error;

    setRoutes(Array.isArray(data) ? data : []);
  }

  async function loadCellSectors() {
    const { data, error } = await supabase
      .from("cell_sectors")
      .select(
        "id, market, system, technology, site_name, cell_name, cid, lat, lon, azimuth, antenna_bw, earfcn, pci, created_at"
      )
      .not("lat", "is", null)
      .not("lon", "is", null)
      .limit(8000);

    if (error) {
      console.warn("Unable to load cell sectors for sector-aware routing:", error);
      setCellSectors([]);
      return;
    }

    setCellSectors(Array.isArray(data) ? data : []);
  }

  const markets = useMemo(() => {
    const uniqueMarkets = new Set();

    grids.forEach((grid) => {
      const market = getMarketLabel(grid);
      if (market && market !== "Unknown Market") uniqueMarkets.add(market);
    });

    return Array.from(uniqueMarkets).sort((a, b) => a.localeCompare(b));
  }, [grids]);

  const filteredGrids = useMemo(() => {
    const query = gridSearch.trim().toLowerCase();

    return grids.filter((grid) => {
      const route = findRouteForGrid(grid, routes);
      const market = getMarketLabel(grid);

      const matchesMarket =
        marketFilter === "all" || String(market) === String(marketFilter);

      const haystack = [
        grid.id,
        grid.grid_id,
        grid.grid_name,
        grid.grid_code,
        grid.name,
        grid.number,
        grid.market,
        grid.market_name,
        grid.status,
        grid.testing_status,
        route?.route_name,
        route?.route_mode,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const matchesSearch = !query || haystack.includes(query);

      return matchesMarket && matchesSearch;
    });
  }, [grids, gridSearch, marketFilter, routes]);

  const routesWithGrid = useMemo(() => {
    return routes.map((route) => {
      const grid = findGridForRoute(route, grids);

      return {
        ...route,
        grid,
      };
    });
  }, [routes, grids]);

  const gridFeatures = useMemo(() => {
    return filteredGrids
      .map((grid) => buildGridFeature(grid))
      .filter(Boolean);
  }, [filteredGrids]);

  const selectedGridFeature = useMemo(() => {
    if (!selectedGrid) return null;
    return buildGridFeature(selectedGrid);
  }, [selectedGrid]);

  const mapRouteGeojson = useMemo(() => {
    if (previewRouteGeojson) return previewRouteGeojson;
    if (selectedRoute?.route_geojson) return selectedRoute.route_geojson;
    return null;
  }, [previewRouteGeojson, selectedRoute]);

  const targetGrids = useMemo(() => {
    if (selectionMode === "all_filtered") return filteredGrids;

    if (selectedGridIds.length > 0) {
      return grids.filter((grid) =>
        selectedGridIds.some(
          (id) => String(id) === String(getGridUniqueId(grid))
        )
      );
    }

    return selectedGrid ? [selectedGrid] : [];
  }, [selectionMode, filteredGrids, grids, selectedGridIds, selectedGrid]);

  const showRouteRecords = Boolean(
    selectedGrid || gridSearch.trim() || routeSearch.trim()
  );

  const routeRecords = useMemo(() => {
    if (!showRouteRecords) return [];

    const gridQuery = gridSearch.trim().toLowerCase();
    const routeQuery = routeSearch.trim().toLowerCase();

    return routesWithGrid.filter((route) => {
      const grid = route.grid;

      if (selectedGrid) {
        const gridKeys = getGridMatchKeys(selectedGrid);
        const routeGridId = route.grid_id ?? route.gridId ?? route.grid_db_id;

        const matchesSelectedGrid = gridKeys.some(
          (key) => String(key) === String(routeGridId)
        );

        if (!matchesSelectedGrid) return false;
      }

      const market = grid ? getMarketLabel(grid) : "Unknown Market";
      const matchesMarket =
        marketFilter === "all" || String(market) === String(marketFilter);

      const haystack = [
        route.id,
        route.route_name,
        route.route_mode,
        route.route_source,
        route.grid_id,
        grid?.grid_id,
        grid?.grid_name,
        grid?.grid_code,
        grid?.name,
        grid?.number,
        grid?.market,
        grid?.market_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const matchesGridSearch = !gridQuery || haystack.includes(gridQuery);
      const matchesRouteSearch = !routeQuery || haystack.includes(routeQuery);

      return matchesMarket && matchesGridSearch && matchesRouteSearch;
    });
  }, [
    showRouteRecords,
    selectedGrid,
    gridSearch,
    routeSearch,
    marketFilter,
    routesWithGrid,
  ]);

  const routeReadyCount = filteredGrids.filter((grid) =>
    findRouteForGrid(grid, routes)
  ).length;

  const missingRouteCount = Math.max(filteredGrids.length - routeReadyCount, 0);

  const selectedGridLabel = selectedGrid
    ? getGridLabel(selectedGrid)
    : "No grid selected";

  const selectedRouteLabel = selectedRoute
    ? selectedRoute.route_name || getGridLabel(selectedGrid) || "Saved Route"
    : "No saved route selected";

  const selectedRouteLength = selectedRoute?.route_length_m
    ? formatMeters(Number(selectedRoute.route_length_m))
    : "N/A";

  const selectedRouteMode = selectedRoute?.route_mode
    ? formatRouteMode(selectedRoute.route_mode)
    : "None";

  function handleSelectGrid(grid) {
    setSelectedGrid(grid);
    setSelectedRoute(findRouteForGrid(grid, routes));
    setPreviewRouteGeojson(null);
    setPreviewRouteKey(Date.now());

    if (selectionMode === "single") {
      setSelectedGridIds([getGridUniqueId(grid)]);
    }
  }

  function handleMapGridClick(grid) {
    handleSelectGrid(grid);

    if (selectionMode === "multiple") {
      setSelectedGridIds((prev) => {
        const id = String(getGridUniqueId(grid));
        if (prev.some((item) => String(item) === id)) return prev;
        return [...prev, id];
      });
    }
  }

  function handleClearSelection() {
    setSelectedGrid(null);
    setSelectedRoute(null);
    setSelectedGridIds([]);
    setPreviewRouteGeojson(null);
    setPreviewRouteKey(Date.now());
  }

  function handleSelectionModeChange(value) {
    setSelectionMode(value);

    if (value === "single") {
      setSelectedGridIds(selectedGrid ? [getGridUniqueId(selectedGrid)] : []);
    }

    if (value === "multiple") {
      setSelectedGridIds(selectedGrid ? [getGridUniqueId(selectedGrid)] : []);
    }

    if (value === "all_filtered") {
      setSelectedGridIds([]);
    }
  }

  function toggleSelectedGrid(grid) {
    const id = String(getGridUniqueId(grid));

    setSelectedGridIds((prev) => {
      if (prev.some((item) => String(item) === id)) {
        return prev.filter((item) => String(item) !== id);
      }

      return [...prev, id];
    });

    setSelectedGrid(grid);
    setSelectedRoute(findRouteForGrid(grid, routes));
    setPreviewRouteGeojson(null);
  }

  function handlePreviewRoute(geojson) {
    setPreviewRouteGeojson(geojson);
    setPreviewRouteKey(Date.now());
  }

  function handleCreateRouteClick() {
    if (selectionMode === "single") {
      handleOpenCreateDrawer(selectedGrid);
      return;
    }

    if (targetGrids.length === 0) {
      setMessage("Please select at least one grid before creating routes.");
      return;
    }

    setBatchLog([]);
    setBatchComplete(false);
    setBatchSummary("");
    setBatchProgress({ current: 0, total: targetGrids.length });
    setBatchDrawerOpen(true);
  }

  function handleOpenCreateDrawer(grid = selectedGrid) {
    if (grid) handleSelectGrid(grid);
    setDrawerOpen(true);
  }

  async function handleRouteSaved() {
    await loadRoutes();

    setMessage("Route saved. Saved Route Records updated.");

    if (selectedGrid) {
      const { data, error } = await supabase
        .from("routes")
        .select("*")
        .order("generated_at", { ascending: false, nullsFirst: false });

      if (!error && Array.isArray(data)) {
        const refreshedRoute = findRouteForGrid(selectedGrid, data);
        setSelectedRoute(refreshedRoute || null);
      }
    }
  }

  async function handleGenerateBatchRoutes() {
    const total = targetGrids.length;

    if (total === 0) {
      setBatchComplete(false);
      setBatchSummary("");
      setBatchProgress({ current: 0, total: 0 });
      setBatchLog(["No grids selected."]);
      return;
    }

    setBatchRunning(true);
    setBatchComplete(false);
    setBatchSummary("");
    setBatchProgress({ current: 0, total });
    setBatchLog([
      `Starting ${formatRouteMode(batchMode)} route generation for ${total} grid(s)...`,
    ]);

    let successCount = 0;
    let failCount = 0;

    for (const grid of targetGrids) {
      const gridName = getGridLabel(grid);

      try {
        setBatchLog((prev) => [...prev, `Generating route for ${gridName}...`]);

        const result = await generateRouteForGrid({
          grid,
          mode: batchMode,
          sectors: cellSectors,
        });
        await saveGeneratedRoute({ grid, result, mode: batchMode });

        successCount += 1;
        const sectorText =
          batchMode === "sector_coverage"
            ? ` • Sector-aware: ${result.sectorAware ? "Yes" : "No"} • Sectors: ${result.sectorCount || 0}`
            : "";

        setBatchLog((prev) => [
          ...prev,
          `Saved ${gridName}: ${formatMeters(result.lengthM)}${sectorText}.`,
        ]);
      } catch (error) {
        failCount += 1;
        console.error(error);
        setBatchLog((prev) => [
          ...prev,
          `Failed ${gridName}: ${error.message || "Route generation failed."}`,
        ]);
      } finally {
        setBatchProgress({ current: successCount + failCount, total });
      }
    }

    await loadRoutes();

    const summary = `Batch route generation complete: ${successCount} saved, ${failCount} failed.`;

    setBatchRunning(false);
    setBatchComplete(true);
    setBatchSummary(summary);
    setBatchProgress({ current: total, total });
    setBatchLog((prev) => [...prev, `DONE: ${summary}`]);
    setMessage(summary);
  }

  async function saveGeneratedRoute({ grid, result, mode }) {
    const gridDbId = grid.id || grid.grid_db_id || grid.grid_id;

    if (!gridDbId) {
      throw new Error("Selected grid has no database id.");
    }

    const payload = {
      grid_id: gridDbId,
      route_name: buildRouteName({ grid, modeLabel: formatRouteMode(mode) }),
      route_mode: mode,
      route_geojson: result.geojson,
      route_length_m: result.lengthM,
      route_source: result.source,
      generated_at: result.generatedAt,
    };

    const { data: existingRoute, error: findError } = await supabase
      .from("routes")
      .select("id")
      .eq("grid_id", gridDbId)
      .limit(1)
      .maybeSingle();

    if (findError) throw findError;

    if (existingRoute?.id) {
      const { error } = await supabase
        .from("routes")
        .update(payload)
        .eq("id", existingRoute.id);

      if (error) throw error;
    } else {
      const { error } = await supabase.from("routes").insert(payload);

      if (error) throw error;
    }
  }

  function handleViewSavedRoute(route) {
    const routeGrid = findGridForRoute(route, grids);

    setSelectedRoute(route);
    setPreviewRouteGeojson(null);
    setPreviewRouteKey(Date.now());

    if (routeGrid) {
      setSelectedGrid(routeGrid);
      setSelectedGridIds([getGridUniqueId(routeGrid)]);
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleDeleteRoute(route) {
    const confirmDelete = window.confirm(
      "Delete this saved route? This will remove the route line from the selected grid."
    );

    if (!confirmDelete) return;

    try {
      const { error } = await supabase.from("routes").delete().eq("id", route.id);

      if (error) throw error;

      setRoutes((prev) => prev.filter((item) => item.id !== route.id));

      if (selectedRoute?.id === route.id) {
        setSelectedRoute(null);
      }

      setMessage("Route deleted.");
    } catch (error) {
      console.error(error);
      setMessage(error.message || "Unable to delete route.");
    }
  }

  return (
    <div className="bd-route-page" style={styles.page}>
      <RouteThemeStyles />

      <section style={styles.headerCard}>
        <div style={styles.headerText}>
          <span style={styles.eyebrow}>Route Management</span>
          <h2 style={styles.title}>Route Management</h2>
          <p style={styles.subtitle}>
            Select grids, generate field-ready routes, export packages, and keep route records clean.
          </p>
        </div>

        <div style={styles.workflowPill}>Select → Generate → Export → Assign</div>
      </section>

      {message && <div style={styles.messageBox}>{message}</div>}

      <section style={styles.topControlsCard}>
        <div style={styles.controlsGrid}>
          <div style={styles.controlBlockWide}>
            <label style={styles.label}>Search / Select Grid</label>
            <input
              value={gridSearch}
              onChange={(event) => setGridSearch(event.target.value)}
              placeholder="Search by grid name, market, status, or route..."
              style={styles.input}
            />

            <select
              value={selectedGrid ? getGridUniqueId(selectedGrid) : ""}
              onChange={(event) => {
                const grid = grids.find(
                  (item) => String(getGridUniqueId(item)) === String(event.target.value)
                );

                if (grid) handleSelectGrid(grid);
                else handleClearSelection();
              }}
              style={styles.input}
            >
              <option value="">Select grid from list</option>
              {filteredGrids.map((grid) => (
                <option key={getGridUniqueId(grid)} value={getGridUniqueId(grid)}>
                  {getGridLabel(grid)} • {getMarketLabel(grid)}
                </option>
              ))}
            </select>
          </div>

          <div style={styles.controlBlock}>
            <label style={styles.label}>Market</label>
            <select
              value={marketFilter}
              onChange={(event) => {
                setMarketFilter(event.target.value);
                handleClearSelection();
              }}
              style={styles.input}
            >
              <option value="all">All Markets</option>
              {markets.map((market) => (
                <option key={market} value={market}>
                  {market}
                </option>
              ))}
            </select>
          </div>

          <div style={styles.controlBlock}>
            <label style={styles.label}>Route Creation</label>
            <select
              value={selectionMode}
              onChange={(event) => handleSelectionModeChange(event.target.value)}
              style={styles.input}
            >
              <option value="single">Single Grid</option>
              <option value="multiple">Multiple Grids</option>
              <option value="all_filtered">All Filtered Grids</option>
            </select>
          </div>

          <div style={styles.controlButtonStack}>
            <button
              type="button"
              onClick={handleCreateRouteClick}
              disabled={targetGrids.length === 0}
              style={{
                ...styles.primaryButtonFull,
                opacity: targetGrids.length > 0 ? 1 : 0.5,
              }}
            >
              Create Route
            </button>

            <button type="button" onClick={loadPageData} style={styles.secondaryButtonFull}>
              Refresh
            </button>
          </div>
        </div>

        {selectionMode === "multiple" && (
          <div style={styles.multiSelectBox}>
            <div style={styles.multiSelectHeader}>
              <div>
                <strong>Multiple Grid Selection</strong>
                <p style={styles.multiSelectSubtext}>
                  Select individual grids from the filtered list below. Each saved route will use its own grid name.
                </p>
              </div>

              <div style={styles.multiSelectActions}>
                <span style={styles.selectedCountBadge}>{targetGrids.length} selected</span>
                <button
                  type="button"
                  onClick={() => setSelectedGridIds(filteredGrids.map(getGridUniqueId))}
                  style={styles.miniButton}
                >
                  Select Filtered
                </button>
                <button type="button" onClick={() => setSelectedGridIds([])} style={styles.miniButton}>
                  Clear
                </button>
              </div>
            </div>

            <div style={styles.multiGridList}>
              {filteredGrids.map((grid) => {
                const id = String(getGridUniqueId(grid));
                const checked = selectedGridIds.some((item) => String(item) === id);
                const route = findRouteForGrid(grid, routes);

                return (
                  <label
                    key={id}
                    style={{
                      ...styles.multiGridRow,
                      ...(checked ? styles.multiGridRowActive : {}),
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelectedGrid(grid)}
                    />

                    <span style={styles.multiGridName}>{getGridLabel(grid)}</span>
                    <span style={styles.multiGridMarket}>{getMarketLabel(grid)}</span>
                    <span style={route ? styles.routeSavedBadge : styles.routeMissingBadge}>
                      {route ? "Route Saved" : "No Route"}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <div style={styles.statsRow}>
          <MetricCard title="Loaded Grids" value={grids.length} />
          <MetricCard title="Filtered Grids" value={filteredGrids.length} />
          <MetricCard title="Saved Routes" value={routeReadyCount} good />
          <MetricCard title="Missing Routes" value={missingRouteCount} warning />
          <MetricCard title="Cell Sectors" value={cellSectors.length} good />
        </div>
      </section>

      <section style={styles.mapCard}>
        <div style={styles.mapHeader}>
          <div>
            <h3 style={styles.cardTitle}>Route Map</h3>
            <p style={styles.smallText}>
              Click a grid to preview records. Green grids already have routes. Blue grids need routes.
            </p>
          </div>

          <div style={styles.mapBadges}>
            <span style={styles.mapBadge}>{filteredGrids.length} grids on map</span>
            <span style={selectedRoute ? styles.readyBadge : styles.neutralBadge}>
              {selectedGrid
                ? selectedRoute
                  ? "Route Saved"
                  : "No Saved Route"
                : "No Grid Selected"}
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

            <CellSectorLayer
              market={marketFilter === "all" ? "" : marketFilter}
              showSites
              showSectors
              showLegend
              maxRecords={2500}
            />

            <MapBoundsController
              selectedGridFeature={selectedGridFeature}
              routeGeojson={mapRouteGeojson}
              allGridFeatures={gridFeatures}
            />

            {gridFeatures.map((feature) => {
              const grid = feature.properties.__grid;
              const route = findRouteForGrid(grid, routes);
              const isSelected =
                String(getGridUniqueId(grid)) === String(getGridUniqueId(selectedGrid));
              const isBatchSelected = targetGrids.some(
                (item) => String(getGridUniqueId(item)) === String(getGridUniqueId(grid))
              );

              return (
                <GeoJSON
                  key={`grid-${getGridUniqueId(grid)}-${isSelected}-${isBatchSelected}-${Boolean(route)}`}
                  data={feature}
                  style={{
                    color: isSelected ? "#FACC15" : route ? "#22C55E" : "#2563EB",
                    weight: isSelected || isBatchSelected ? 5 : route ? 3 : 2,
                    fillColor: isSelected ? "#FACC15" : route ? "#22C55E" : "#60A5FA",
                    fillOpacity: isSelected ? 0.18 : route ? 0.12 : 0.08,
                  }}
                  eventHandlers={{
                    click: () => handleMapGridClick(grid),
                  }}
                >
                  <Popup>
                    <div style={{ minWidth: 190 }}>
                      <strong>{getGridLabel(grid)}</strong>
                      <br />
                      <span>{getMarketLabel(grid)}</span>
                      <br />
                      <span>{route ? "Route Saved" : "No Saved Route"}</span>
                      <br />
                      <button
                        type="button"
                        onClick={() => handleOpenCreateDrawer(grid)}
                        style={popupButtonStyle}
                      >
                        Create Route
                      </button>
                    </div>
                  </Popup>
                </GeoJSON>
              );
            })}

            {mapRouteGeojson && (
              <RouteLineLayer
                geojson={mapRouteGeojson}
                layerKey={`route-${previewRouteKey}-${selectedRoute?.id || "preview"}`}
                isPreview={Boolean(previewRouteGeojson)}
              />
            )}
          </MapContainer>
        </div>
      </section>

      <section style={styles.recordsCard}>
        <div style={styles.recordsHeader}>
          <div>
            <h3 style={styles.cardTitle}>Saved Route Records</h3>
            <p style={styles.smallText}>
              {showRouteRecords
                ? "Records shown for your selected or searched grid."
                : "Use grid name search or click a grid on the map to show grid route records."}
            </p>
          </div>

          <input
            value={routeSearch}
            onChange={(event) => setRouteSearch(event.target.value)}
            placeholder="Search saved route records..."
            style={styles.tableSearch}
          />
        </div>

        {!showRouteRecords && (
          <div style={styles.emptyState}>
            Use grid name search or click a grid on the map to show grid route records.
          </div>
        )}

        {showRouteRecords && routeRecords.length === 0 && (
          <div style={styles.emptyState}>
            No saved route records found for this selection.
          </div>
        )}

        {showRouteRecords && routeRecords.length > 0 && (
          <div style={styles.routeRecordList}>
            {routeRecords.map((route) => {
              const grid = route.grid || findGridForRoute(route, grids);
              const gridName = grid ? getGridLabel(grid) : route.grid_id;
              const marketName = grid ? getMarketLabel(grid) : "Unknown";
              const routeMode = formatRouteMode(route.route_mode);
              const routeLength = formatMeters(Number(route.route_length_m || 0));
              const generatedDate = formatDate(route.generated_at || route.created_at);

              return (
                <div key={route.id} style={styles.routeRecordCard}>
                  <div style={styles.routeRecordTopRow}>
                    <div style={styles.routeRecordTitleBlock}>
                      <span style={styles.recordLabel}>Route Package</span>
                      <strong style={styles.recordTitle}>
                        {route.route_name || "Saved Route"}
                      </strong>
                    </div>

                    <span style={styles.routeRecordStatus}>Route Saved</span>
                  </div>

                  <div style={styles.routeRecordInfoGrid}>
                    <InfoChip label="Grid" value={gridName} />
                    <InfoChip label="Market" value={marketName} />
                    <InfoChip label="Mode" value={routeMode} />
                    <InfoChip label="Length" value={routeLength} />
                    <InfoChip label="Generated" value={generatedDate} wide />
                  </div>

                  <div style={styles.routeRecordActions}>
                    <button
                      type="button"
                      onClick={() => handleViewSavedRoute(route)}
                      style={styles.smallButton}
                    >
                      View
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const gridForRoute = findGridForRoute(route, grids);
                        if (gridForRoute) handleOpenCreateDrawer(gridForRoute);
                      }}
                      style={styles.smallSecondaryButton}
                    >
                      Regenerate
                    </button>

                    <button
                      type="button"
                      onClick={() => exportRouteKml({ route, grid })}
                      style={styles.smallExportButton}
                    >
                      KML
                    </button>

                    <button
                      type="button"
                      onClick={() => exportRouteHtml({ route, grid })}
                      style={styles.smallExportButton}
                    >
                      HTML
                    </button>

                    <button
                      type="button"
                      onClick={() => exportRouteZip({ route, grid })}
                      style={styles.smallExportButton}
                    >
                      ZIP
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteRoute(route)}
                      style={styles.smallDangerButton}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {drawerOpen && (
        <div style={styles.drawerOverlay}>
          <div style={styles.drawer}>
            <div style={styles.drawerHeader}>
              <div>
                <h2 style={styles.drawerTitle}>Create Route</h2>
                <p style={styles.drawerSubtitle}>Generate drive-route lines inside the selected grid.</p>
              </div>

              <button type="button" onClick={() => setDrawerOpen(false)} style={styles.closeButton}>
                ×
              </button>
            </div>

            <div style={styles.drawerContent}>
              <div style={styles.drawerSelectedGrid}>
                <span>Selected Grid</span>
                <strong>{selectedGridLabel}</strong>
                <small>{selectedGrid ? getMarketLabel(selectedGrid) : ""}</small>
              </div>

              <div className="bd-route-generator-host" style={styles.generatorHost}>
                <RouteGeneratorPanel
                  selectedGrid={selectedGrid}
                  cellSectors={cellSectors}
                  onPreviewRoute={handlePreviewRoute}
                  onSaved={handleRouteSaved}
                />
              </div>

              <div style={styles.drawerNote}>
                Single-grid mode previews the route before saving. For multiple or all-filtered grids, use batch route creation.
              </div>
            </div>
          </div>
        </div>
      )}

      {batchDrawerOpen && (
        <div style={styles.drawerOverlay}>
          <div style={styles.drawer}>
            <div style={styles.drawerHeader}>
              <div>
                <h2 style={styles.drawerTitle}>Batch Route Creation</h2>
                <p style={styles.drawerSubtitle}>
                  Generate and save routes for {targetGrids.length} grid(s).
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setBatchDrawerOpen(false);
                  setBatchComplete(false);
                  setBatchSummary("");
                }}
                style={styles.closeButton}
              >
                ×
              </button>
            </div>

            <div style={styles.drawerContent}>
              <div style={styles.drawerSelectedGrid}>
                <span>Target</span>
                <strong>
                  {selectionMode === "all_filtered"
                    ? `All filtered grids (${targetGrids.length})`
                    : `${targetGrids.length} selected grid(s)`}
                </strong>
                <small>{marketFilter === "all" ? "All Markets" : marketFilter}</small>
              </div>

              <label style={styles.label}>Route Mode</label>
              <select
                value={batchMode}
                onChange={(event) => setBatchMode(event.target.value)}
                style={styles.input}
              >
                {ROUTE_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={handleGenerateBatchRoutes}
                disabled={batchRunning || targetGrids.length === 0}
                style={{
                  ...styles.primaryButtonFull,
                  opacity: batchRunning || targetGrids.length === 0 ? 0.55 : 1,
                }}
              >
                {batchRunning ? "Generating..." : `Generate ${targetGrids.length} Route(s)`}
              </button>

              {(batchRunning || batchComplete) && (
                <div style={styles.batchProgressBox}>
                  <div style={styles.batchProgressHeader}>
                    <strong>{batchComplete ? "Done ✅" : "Generating Routes"}</strong>
                    <span>
                      {batchProgress.current} / {batchProgress.total}
                    </span>
                  </div>

                  <div style={styles.batchProgressTrack}>
                    <div
                      style={{
                        ...styles.batchProgressFill,
                        width:
                          batchProgress.total > 0
                            ? `${Math.round((batchProgress.current / batchProgress.total) * 100)}%`
                            : "0%",
                      }}
                    />
                  </div>
                </div>
              )}

              {batchComplete && (
                <div style={styles.batchDoneBox}>
                  <strong>Done ✅</strong>
                  <span>{batchSummary}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setBatchDrawerOpen(false);
                      setBatchComplete(false);
                      setBatchSummary("");
                    }}
                    style={styles.batchDoneButton}
                  >
                    Close
                  </button>
                </div>
              )}

              <div style={styles.batchList}>
                {targetGrids.slice(0, 30).map((grid) => (
                  <div key={getGridUniqueId(grid)} style={styles.batchGridItem}>
                    <strong>{getGridLabel(grid)}</strong>
                    <span>{getMarketLabel(grid)}</span>
                  </div>
                ))}
                {targetGrids.length > 30 && (
                  <div style={styles.batchGridItem}>+ {targetGrids.length - 30} more grid(s)</div>
                )}
              </div>

              {batchLog.length > 0 && (
                <div style={styles.batchLog}>
                  {batchLog.map((line, index) => (
                    <div key={`${line}-${index}`}>{line}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RouteThemeStyles() {
  return (
    <style>{`
      .bd-route-page {
        --route-card: #ffffff;
        --route-soft-card: #f8fbff;
        --route-strong-card: #eef6ff;
        --route-border: #b9d4ff;
        --route-border-soft: #d4e4ff;
        --route-text: #071a33;
        --route-muted: #35506f;
        --route-blue: #2563eb;
        --route-cyan: #06c7e8;
        --route-success: #16a34a;
        --route-warning: #d97706;
        --route-danger: #dc2626;
        --route-purple: #7c3aed;
        --route-map-bg: #f8fbff;
        --route-shadow: 0 14px 34px rgba(15, 44, 85, 0.08);
        --route-overlay: rgba(2, 6, 23, 0.55);
      }

      body.bd-theme-night .bd-route-page,
      .theme-night .bd-route-page,
      body.dark .bd-route-page,
      body.dark-mode .bd-route-page,
      body.night .bd-route-page,
      body.theme-dark .bd-route-page,
      .bd-theme-night .bd-route-page,
      .dark .bd-route-page,
      .dark-mode .bd-route-page,
      .night .bd-route-page,
      .theme-dark .bd-route-page,
      [data-theme="dark"] .bd-route-page {
        --route-card: #0b1b31;
        --route-soft-card: #081525;
        --route-strong-card: #0f243d;
        --route-border: #1f4b79;
        --route-border-soft: #18395f;
        --route-text: #edf6ff;
        --route-muted: #a9c9ee;
        --route-blue: #60a5fa;
        --route-cyan: #22d3ee;
        --route-success: #34d399;
        --route-warning: #f59e0b;
        --route-danger: #fb7185;
        --route-purple: #a78bfa;
        --route-map-bg: #081525;
        --route-shadow: none;
        --route-overlay: rgba(2, 6, 23, 0.72);
      }

      .bd-route-page input::placeholder,
      .bd-route-page textarea::placeholder {
        color: color-mix(in srgb, var(--route-muted) 75%, transparent);
      }

      .bd-route-page input,
      .bd-route-page select,
      .bd-route-page button {
        font-family: inherit;
      }

      .bd-route-page .leaflet-container {
        font-family: inherit;
      }

      body.bd-theme-night .bd-route-page option,
      .theme-night .bd-route-page option {
        background: #081525;
        color: #edf6ff;
      }

      .bd-route-page .bd-route-generator-host > div,
      .bd-route-page .bd-route-generator-host :where(section, article) {
        background: var(--route-card) !important;
        border-color: var(--route-border) !important;
        color: var(--route-text) !important;
      }

      .bd-route-page .bd-route-generator-host :where(div)[style*="background"] {
        background: var(--route-soft-card) !important;
        border-color: var(--route-border-soft) !important;
      }

      .bd-route-page .bd-route-generator-host :where(input, select, textarea) {
        background: var(--route-soft-card) !important;
        border-color: var(--route-border) !important;
        color: var(--route-text) !important;
      }

      .bd-route-page .bd-route-generator-host :where(button) {
        color: #ffffff !important;
      }

      .bd-route-page .bd-route-generator-host :where(h1, h2, h3, h4, label, strong) {
        color: var(--route-text) !important;
      }

      .bd-route-page .bd-route-generator-host :where(p, small) {
        color: var(--route-muted) !important;
      }

      @media (max-width: 1100px) {
        .bd-route-page-route-note {
          display: none;
        }
      }
    `}</style>
  );
}

function MetricCard({ title, value, good, warning }) {
  return (
    <div style={styles.statCard}>
      <span>{title}</span>
      <b style={{ color: good ? "var(--route-success)" : warning ? "var(--route-warning)" : "var(--route-text)" }}>
        {value}
      </b>
    </div>
  );
}

function InfoChip({ label, value, wide }) {
  return (
    <div style={{ ...styles.infoChip, ...(wide ? styles.infoChipWide : {}) }}>
      <span style={styles.infoChipLabel}>{label}</span>
      <strong style={styles.infoChipValue}>{value || "N/A"}</strong>
    </div>
  );
}

function MapBoundsController({ selectedGridFeature, routeGeojson, allGridFeatures }) {
  const map = useMap();

  useEffect(() => {
    const layers = [];

    if (selectedGridFeature) layers.push(L.geoJSON(selectedGridFeature));
    if (routeGeojson) layers.push(L.geoJSON(parseRouteGeojson(routeGeojson) || routeGeojson));

    if (!layers.length && Array.isArray(allGridFeatures)) {
      allGridFeatures.slice(0, 80).forEach((feature) => layers.push(L.geoJSON(feature)));
    }

    if (!layers.length) return;

    const group = L.featureGroup(layers);
    const bounds = group.getBounds();

    if (bounds.isValid()) {
      map.fitBounds(bounds, {
        padding: [28, 28],
        maxZoom: selectedGridFeature || routeGeojson ? 16 : 12,
      });
    }
  }, [map, selectedGridFeature, routeGeojson, allGridFeatures]);

  return null;
}

function RouteLineLayer({ geojson, layerKey, isPreview }) {
  const map = useMap();

  useEffect(() => {
    const parsed = parseRouteGeojson(geojson);
    if (!parsed) return;

    const routeLayer = L.geoJSON(parsed, {
      style: {
        color: isPreview ? "#00E5FF" : "#00FF66",
        weight: 7,
        opacity: 1,
        lineCap: "round",
        lineJoin: "round",
      },
    }).addTo(map);

    routeLayer.bringToFront();

    return () => map.removeLayer(routeLayer);
  }, [map, geojson, layerKey, isPreview]);

  return null;
}

function buildRouteName({ grid, modeLabel }) {
  const market = getMarketLabel(grid);
  const gridName = getGridLabel(grid);
  return `${market && market !== "Unknown Market" ? `${market} - ` : ""}${gridName} - ${modeLabel} Route`;
}

function buildGridFeature(grid) {
  if (!grid) return null;
  const geometry = getGridGeometry(grid);
  if (!geometry) return null;

  return {
    type: "Feature",
    properties: {
      ...grid,
      __grid: grid,
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
    if (parsed?.type === "Polygon" || parsed?.type === "MultiPolygon") return parsed;
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

  if (typeof routeGeojson === "object") return normalizeRouteGeojson(routeGeojson);

  if (typeof routeGeojson === "string") {
    try {
      return normalizeRouteGeojson(JSON.parse(routeGeojson));
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeRouteGeojson(value) {
  if (!value) return null;
  if (value.type === "FeatureCollection") return value;

  if (value.type === "Feature") {
    return { type: "FeatureCollection", features: [value] };
  }

  if (value.type === "LineString" || value.type === "MultiLineString") {
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: value }],
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
    grid.grid_id ||
    grid.grid_name ||
    grid.name ||
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
  if (!mode) return "Unknown";
  return String(mode).replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(value) {
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

const popupButtonStyle = {
  marginTop: 8,
  border: "none",
  background: "#2563EB",
  color: "#fff",
  borderRadius: 8,
  padding: "7px 10px",
  cursor: "pointer",
  fontWeight: 700,
};

const styles = {
  page: {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    margin: 0,
    transform: "none",
    color: "var(--route-text)",
    padding: "0 0 28px",
    boxSizing: "border-box",
    overflowX: "hidden",
    textAlign: "left",
  },

  headerCard: {
    background: "var(--route-card)",
    border: "1px solid var(--route-border)",
    borderRadius: "18px",
    padding: "18px 22px",
    marginBottom: "14px",
    boxShadow: "var(--route-shadow)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "18px",
    textAlign: "left",
  },

  headerText: {
    minWidth: 0,
    textAlign: "left",
  },

  workflowPill: {
    flex: "0 0 auto",
    border: "1px solid var(--route-border)",
    borderRadius: "999px",
    padding: "12px 18px",
    color: "var(--route-blue)",
    fontWeight: 900,
    background: "linear-gradient(90deg, rgba(37,99,235,0.08), rgba(6,199,232,0.08))",
    whiteSpace: "nowrap",
  },

  eyebrow: {
    display: "block",
    color: "var(--route-blue)",
    fontSize: "12px",
    fontWeight: 900,
    letterSpacing: "0.18em",
    textTransform: "uppercase",
    marginBottom: "8px",
    textAlign: "left",
  },

  title: {
    margin: 0,
    fontSize: "26px",
    lineHeight: 1.1,
    color: "var(--route-text)",
    fontWeight: 900,
    textAlign: "left",
  },

  subtitle: {
    margin: "6px 0 0",
    color: "var(--route-muted)",
    fontSize: "14px",
    fontWeight: 650,
    lineHeight: 1.35,
    textAlign: "left",
  },

  messageBox: {
    background: "rgba(22,163,74,0.10)",
    border: "1px solid rgba(22,163,74,0.35)",
    color: "var(--route-success)",
    borderRadius: "14px",
    padding: "12px 14px",
    marginBottom: "14px",
    fontSize: "13px",
    fontWeight: 900,
    textAlign: "center",
  },

  topControlsCard: {
    background: "var(--route-card)",
    border: "1px solid var(--route-border)",
    borderRadius: "18px",
    padding: "16px 18px",
    marginBottom: "14px",
    width: "100%",
    boxSizing: "border-box",
    overflow: "hidden",
    boxShadow: "var(--route-shadow)",
  },

  controlsGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(280px, 1.45fr) minmax(150px, 0.7fr) minmax(170px, 0.7fr) minmax(130px, 150px)",
    gap: "12px",
    alignItems: "end",
    width: "100%",
    boxSizing: "border-box",
  },

  controlBlockWide: {
    display: "grid",
    gap: "8px",
  },

  controlBlock: {
    display: "grid",
    gap: "8px",
    alignContent: "start",
  },

  label: {
    color: "var(--route-text)",
    fontSize: "13px",
    fontWeight: 900,
  },

  input: {
    width: "100%",
    minHeight: "40px",
    boxSizing: "border-box",
    background: "var(--route-soft-card)",
    color: "var(--route-text)",
    border: "1px solid var(--route-border)",
    borderRadius: "12px",
    padding: "0 12px",
    outline: "none",
    fontSize: "13px",
    fontWeight: 650,
  },

  statusPanel: {
    background: "var(--route-soft-card)",
    border: "1px solid var(--route-border-soft)",
    borderRadius: "12px",
    padding: "10px 12px",
    display: "grid",
    alignContent: "center",
    gap: "5px",
    minWidth: 0,
  },

  controlButtonStack: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: "8px",
    alignContent: "end",
    minWidth: 0,
  },

  primaryButtonFull: {
    width: "100%",
    minWidth: 0,
    border: "none",
    background: "linear-gradient(90deg, #2563eb, #06c7e8)",
    color: "#fff",
    borderRadius: "12px",
    padding: "12px 10px",
    fontWeight: 900,
    cursor: "pointer",
    fontSize: "12px",
    whiteSpace: "nowrap",
    boxSizing: "border-box",
  },

  secondaryButtonFull: {
    width: "100%",
    border: "1px solid var(--route-border)",
    background: "var(--route-soft-card)",
    color: "var(--route-text)",
    borderRadius: "12px",
    padding: "11px 12px",
    fontWeight: 900,
    cursor: "pointer",
    fontSize: "12px",
  },

  multiSelectBox: {
    marginTop: "14px",
    background: "var(--route-soft-card)",
    border: "1px solid var(--route-border-soft)",
    borderRadius: "14px",
    padding: "14px",
  },

  multiSelectHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "center",
    marginBottom: "12px",
  },

  multiSelectSubtext: {
    margin: "4px 0 0",
    color: "var(--route-muted)",
    fontSize: "13px",
    fontWeight: 650,
  },

  selectedCountBadge: {
    border: "1px solid var(--route-border)",
    color: "var(--route-blue)",
    borderRadius: "999px",
    padding: "8px 11px",
    fontSize: "12px",
    fontWeight: 900,
    whiteSpace: "nowrap",
    background: "var(--route-card)",
  },

  multiGridList: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: "7px",
    maxHeight: "250px",
    overflowY: "auto",
    paddingRight: "4px",
  },

  multiGridRow: {
    display: "grid",
    gridTemplateColumns: "28px minmax(130px, 1fr) minmax(90px, 0.65fr) 110px",
    alignItems: "center",
    gap: "8px",
    border: "1px solid var(--route-border-soft)",
    background: "var(--route-card)",
    borderRadius: "12px",
    padding: "10px 11px",
    fontSize: "13px",
    cursor: "pointer",
  },

  multiGridRowActive: {
    border: "1px solid var(--route-blue)",
    background: "rgba(37,99,235,0.12)",
  },

  multiGridName: {
    color: "var(--route-text)",
    fontWeight: 900,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  multiGridMarket: {
    color: "var(--route-muted)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  routeSavedBadge: {
    justifySelf: "end",
    color: "var(--route-success)",
    background: "rgba(34,197,94,0.12)",
    border: "1px solid rgba(34,197,94,0.35)",
    borderRadius: "999px",
    padding: "5px 8px",
    fontSize: "11px",
    fontWeight: 900,
    whiteSpace: "nowrap",
  },

  routeMissingBadge: {
    justifySelf: "end",
    color: "var(--route-muted)",
    background: "var(--route-soft-card)",
    border: "1px solid var(--route-border-soft)",
    borderRadius: "999px",
    padding: "5px 8px",
    fontSize: "11px",
    fontWeight: 900,
    whiteSpace: "nowrap",
  },

  multiSelectActions: {
    display: "flex",
    gap: "8px",
  },

  miniButton: {
    border: "1px solid var(--route-border)",
    background: "var(--route-card)",
    color: "var(--route-text)",
    borderRadius: "10px",
    padding: "8px 10px",
    fontSize: "12px",
    fontWeight: 800,
    cursor: "pointer",
  },

  gridPillList: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
    gap: "8px",
    maxHeight: "180px",
    overflowY: "auto",
  },

  gridPill: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    border: "1px solid var(--route-border-soft)",
    background: "var(--route-soft-card)",
    borderRadius: "10px",
    padding: "8px",
    fontSize: "12px",
    cursor: "pointer",
  },

  gridPillActive: {
    border: "1px solid var(--route-blue)",
    background: "rgba(37,99,235,0.12)",
  },

  statsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
    gap: "10px",
    marginTop: "14px",
  },

  statCard: {
    background: "var(--route-card)",
    border: "1px solid var(--route-border)",
    borderRadius: "14px",
    padding: "14px 12px",
    textAlign: "center",
    display: "grid",
    gap: "7px",
    color: "var(--route-muted)",
    fontWeight: 750,
    boxShadow: "var(--route-shadow)",
  },

  mapCard: {
    background: "var(--route-card)",
    border: "1px solid var(--route-border)",
    borderRadius: "18px",
    padding: "16px 18px",
    marginBottom: "14px",
    boxShadow: "var(--route-shadow)",
  },

  mapHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "12px",
    marginBottom: "12px",
    textAlign: "left",
  },

  cardTitle: {
    margin: 0,
    fontSize: "22px",
    fontWeight: 900,
    color: "var(--route-text)",
    textAlign: "left",
  },

  smallText: {
    margin: "5px 0 0",
    color: "var(--route-muted)",
    fontSize: "13px",
    fontWeight: 650,
    textAlign: "left",
  },

  mapBadges: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },

  mapBadge: {
    border: "1px solid var(--route-border)",
    color: "var(--route-blue)",
    background: "var(--route-soft-card)",
    borderRadius: "999px",
    padding: "7px 10px",
    fontSize: "12px",
    fontWeight: 900,
    whiteSpace: "nowrap",
  },

  readyBadge: {
    border: "1px solid rgba(34,197,94,0.42)",
    color: "var(--route-success)",
    background: "rgba(34,197,94,0.12)",
    borderRadius: "999px",
    padding: "7px 10px",
    fontSize: "12px",
    fontWeight: 900,
    whiteSpace: "nowrap",
  },

  neutralBadge: {
    border: "1px solid var(--route-border-soft)",
    color: "var(--route-muted)",
    background: "var(--route-soft-card)",
    borderRadius: "999px",
    padding: "7px 10px",
    fontSize: "12px",
    fontWeight: 900,
    whiteSpace: "nowrap",
  },

  mapBox: {
    width: "100%",
    height: "min(52vh, 520px)",
    minHeight: "360px",
    borderRadius: "16px",
    overflow: "hidden",
    border: "1px solid var(--route-border)",
    background: "var(--route-map-bg)",
    boxSizing: "border-box",
  },

  map: {
    width: "100%",
    height: "100%",
  },

  recordsCard: {
    background: "var(--route-card)",
    border: "1px solid var(--route-border)",
    borderRadius: "18px",
    padding: "16px 18px",
    boxShadow: "var(--route-shadow)",
  },

  recordsHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "12px",
    marginBottom: "14px",
    flexWrap: "wrap",
    textAlign: "left",
  },

  routeRecordList: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },

  routeRecordCard: {
    background: "var(--route-soft-card)",
    border: "1px solid var(--route-border-soft)",
    borderRadius: "16px",
    padding: "14px",
    display: "grid",
    gap: "12px",
    boxShadow: "var(--route-shadow)",
  },

  routeRecordTopRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "12px",
  },

  routeRecordTitleBlock: {
    minWidth: 0,
  },

  recordLabel: {
    display: "block",
    color: "var(--route-blue)",
    fontSize: "11px",
    fontWeight: 900,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    marginBottom: "5px",
  },

  recordTitle: {
    display: "block",
    color: "var(--route-text)",
    fontSize: "16px",
    fontWeight: 900,
    lineHeight: 1.35,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },

  routeRecordStatus: {
    background: "rgba(34,197,94,0.14)",
    color: "var(--route-success)",
    border: "1px solid rgba(34,197,94,0.42)",
    borderRadius: "999px",
    padding: "6px 9px",
    fontSize: "11px",
    fontWeight: 900,
    whiteSpace: "nowrap",
  },

  routeRecordInfoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
    gap: "8px",
  },

  infoChip: {
    background: "var(--route-card)",
    border: "1px solid var(--route-border-soft)",
    borderRadius: "12px",
    padding: "9px 10px",
    minWidth: 0,
  },

  infoChipWide: {
    minWidth: 0,
  },

  infoChipLabel: {
    display: "block",
    color: "var(--route-muted)",
    fontSize: "10px",
    fontWeight: 800,
    marginBottom: "5px",
  },

  infoChipValue: {
    display: "block",
    color: "var(--route-text)",
    fontSize: "12px",
    fontWeight: 900,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  routeRecordActions: {
    display: "flex",
    gap: "7px",
    justifyContent: "flex-start",
    alignItems: "center",
    flexWrap: "wrap",
    borderTop: "1px solid var(--route-border-soft)",
    paddingTop: "12px",
  },

  tableHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "12px",
    marginBottom: "12px",
  },

  tableSearch: {
    width: 280,
    maxWidth: "100%",
    boxSizing: "border-box",
    background: "var(--route-soft-card)",
    color: "var(--route-text)",
    border: "1px solid var(--route-border)",
    borderRadius: "12px",
    padding: "11px 12px",
    outline: "none",
    fontSize: "13px",
    fontWeight: 650,
  },

  emptyState: {
    background: "var(--route-soft-card)",
    border: "1px dashed var(--route-border)",
    color: "var(--route-muted)",
    borderRadius: "14px",
    padding: "18px",
    textAlign: "center",
    fontSize: "13px",
    fontWeight: 750,
  },

  tableScroll: {
    maxHeight: "460px",
    overflowX: "auto",
    overflowY: "auto",
    border: "1px solid var(--route-border-soft)",
    borderRadius: "12px",
  },

  table: {
    width: "100%",
    minWidth: "980px",
    borderCollapse: "collapse",
    tableLayout: "fixed",
  },

  th: {
    textAlign: "left",
    color: "var(--route-text)",
    background: "var(--route-strong-card)",
    fontSize: "12px",
    padding: "11px",
    borderBottom: "1px solid var(--route-border-soft)",
    position: "sticky",
    top: 0,
    zIndex: 2,
  },

  thRight: {
    textAlign: "right",
    color: "var(--route-text)",
    background: "var(--route-strong-card)",
    fontSize: "12px",
    padding: "11px",
    borderBottom: "1px solid var(--route-border-soft)",
    position: "sticky",
    top: 0,
    zIndex: 2,
  },

  td: {
    padding: "11px",
    borderBottom: "1px solid var(--route-border-soft)",
    color: "var(--route-text)",
    fontSize: "12px",
    verticalAlign: "middle",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },

  tdRight: {
    padding: "11px",
    borderBottom: "1px solid var(--route-border-soft)",
    textAlign: "right",
    whiteSpace: "nowrap",
  },

  routeNameTd: {
    padding: "11px",
    borderBottom: "1px solid var(--route-border-soft)",
    color: "var(--route-text)",
    fontSize: "12px",
    fontWeight: 900,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },

  emptyTd: {
    padding: "18px",
    color: "var(--route-muted)",
    textAlign: "center",
    fontSize: "13px",
  },

  modeBadge: {
    display: "inline-block",
    borderRadius: "999px",
    background: "rgba(6,199,232,0.12)",
    color: "var(--route-cyan)",
    border: "1px solid rgba(6,199,232,0.32)",
    padding: "5px 9px",
    fontWeight: 800,
    fontSize: "11px",
  },

  smallButton: {
    border: "none",
    background: "#2563EB",
    color: "#fff",
    borderRadius: "9px",
    padding: "8px 10px",
    fontWeight: 850,
    cursor: "pointer",
    fontSize: "12px",
  },

  smallSecondaryButton: {
    border: "1px solid var(--route-border)",
    background: "var(--route-card)",
    color: "var(--route-text)",
    borderRadius: "9px",
    padding: "8px 10px",
    fontWeight: 850,
    cursor: "pointer",
    fontSize: "12px",
  },

  smallExportButton: {
    border: "none",
    background: "#7C3AED",
    color: "#fff",
    borderRadius: "9px",
    padding: "8px 10px",
    fontWeight: 850,
    cursor: "pointer",
    fontSize: "12px",
  },

  smallDangerButton: {
    border: "none",
    background: "#DC2626",
    color: "#fff",
    borderRadius: "9px",
    padding: "8px 10px",
    fontWeight: 850,
    cursor: "pointer",
    fontSize: "12px",
  },

  generatorHost: {
    display: "grid",
    gap: "12px",
  },

  drawerOverlay: {
    position: "fixed",
    inset: 0,
    background: "var(--route-overlay)",
    backdropFilter: "blur(4px)",
    zIndex: 9999,
    display: "flex",
    justifyContent: "flex-end",
  },

  drawer: {
    width: "460px",
    maxWidth: "94vw",
    height: "100vh",
    background: "var(--route-card)",
    color: "var(--route-text)",
    borderLeft: "1px solid var(--route-border)",
    boxShadow: "-22px 0 60px rgba(0,0,0,0.22)",
    overflowY: "auto",
  },

  drawerHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "12px",
    padding: "18px",
    borderBottom: "1px solid var(--route-border-soft)",
  },

  drawerTitle: {
    margin: 0,
    fontSize: "22px",
    color: "var(--route-text)",
    fontWeight: 900,
  },

  drawerSubtitle: {
    margin: "6px 0 0",
    color: "var(--route-muted)",
    fontSize: "13px",
  },

  closeButton: {
    border: "1px solid var(--route-border)",
    background: "var(--route-soft-card)",
    color: "var(--route-text)",
    width: "36px",
    height: "36px",
    borderRadius: "10px",
    fontSize: "24px",
    lineHeight: "30px",
    cursor: "pointer",
  },

  drawerContent: {
    padding: "18px",
    display: "flex",
    flexDirection: "column",
    gap: "14px",
  },

  drawerSelectedGrid: {
    background: "var(--route-soft-card)",
    border: "1px solid var(--route-border-soft)",
    borderRadius: "14px",
    padding: "12px",
    display: "grid",
    gap: "6px",
  },

  drawerNote: {
    color: "var(--route-muted)",
    fontSize: "13px",
    lineHeight: 1.5,
    background: "var(--route-soft-card)",
    border: "1px solid var(--route-border-soft)",
    borderRadius: "14px",
    padding: "12px",
  },

  batchProgressBox: {
    background: "rgba(59,130,246,0.10)",
    border: "1px solid rgba(59,130,246,0.35)",
    borderRadius: "12px",
    padding: "10px",
    display: "grid",
    gap: "8px",
  },

  batchProgressHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    color: "var(--route-blue)",
    fontSize: "12px",
  },

  batchProgressTrack: {
    height: "8px",
    background: "var(--route-border-soft)",
    borderRadius: "999px",
    overflow: "hidden",
  },

  batchProgressFill: {
    height: "100%",
    background: "#22C55E",
    borderRadius: "999px",
    transition: "width 0.25s ease",
  },

  batchDoneBox: {
    background: "rgba(34,197,94,0.12)",
    border: "1px solid rgba(34,197,94,0.42)",
    color: "var(--route-success)",
    borderRadius: "12px",
    padding: "11px",
    display: "grid",
    gap: "8px",
    fontSize: "13px",
  },

  batchDoneButton: {
    border: "none",
    background: "#16A34A",
    color: "#fff",
    borderRadius: "9px",
    padding: "8px 10px",
    fontWeight: 800,
    cursor: "pointer",
    justifySelf: "start",
  },

  batchList: {
    background: "var(--route-soft-card)",
    border: "1px solid var(--route-border-soft)",
    borderRadius: "12px",
    padding: "10px",
    maxHeight: "220px",
    overflowY: "auto",
    display: "grid",
    gap: "8px",
  },

  batchGridItem: {
    display: "flex",
    justifyContent: "space-between",
    gap: "8px",
    color: "var(--route-text)",
    fontSize: "12px",
    borderBottom: "1px solid var(--route-border-soft)",
    paddingBottom: "7px",
  },

  batchLog: {
    background: "var(--route-soft-card)",
    border: "1px solid var(--route-border-soft)",
    color: "var(--route-text)",
    borderRadius: "12px",
    padding: "10px",
    fontSize: "12px",
    maxHeight: "260px",
    overflowY: "auto",
    display: "grid",
    gap: "6px",
  },
};
