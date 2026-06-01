// src/components/GridMap.jsx

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  useMap,
  useMapEvents,
  Polygon,
  Polyline,
  CircleMarker,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "../lib/supabaseClient";
import CellSectorLayer from "./maps/CellSectorLayer";

const GRID_STATUSES = [
  "Available",
  "Assigned",
  "In Progress",
  "Completed",
  "Needs Re-drive",
];

function DrawClickHandler({ enabled, onAddPoint }) {
  useMapEvents({
    click(event) {
      if (!enabled) return;
      onAddPoint(event.latlng);
    },
  });

  return null;
}

function pointsToGeoJsonPolygon(points) {
  const coords = points.map((point) => [Number(point.lng), Number(point.lat)]);

  if (coords.length < 3) return null;

  const first = coords[0];
  const last = coords[coords.length - 1];
  const isClosed = first[0] === last[0] && first[1] === last[1];
  const closedCoords = isClosed ? coords : [...coords, first];

  return {
    type: "Polygon",
    coordinates: [closedCoords],
  };
}

function MapController({ filteredGrids, selectedGrid }) {
  const map = useMap();

  useEffect(() => {
    if (selectedGrid?.geometry) {
      const layer = L.geoJSON(selectedGrid.geometry);
      const bounds = layer.getBounds();

      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
      }

      return;
    }

    if (filteredGrids.length > 0) {
      const layer = L.geoJSON(
        filteredGrids.filter((grid) => grid.geometry).map((grid) => grid.geometry)
      );

      const bounds = layer.getBounds();

      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
      }
    }
  }, [map, filteredGrids, selectedGrid]);

  return null;
}

export default function GridMap({ refreshKey = 0, dashboardFilters = {} }) {
  const geoJsonRefs = useRef({});

  const [grids, setGrids] = useState([]);
  const [selectedGrid, setSelectedGrid] = useState(null);
  const [searchText, setSearchText] = useState("");
  const [cellTechFilter, setCellTechFilter] = useState("all");
  const [tableLimit, setTableLimit] = useState(100);
  const [mapRenderLimit, setMapRenderLimit] = useState("1000");
  const [showGridRecords, setShowGridRecords] = useState(false);
  const [showManualTools, setShowManualTools] = useState(false);
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);
  const [message, setMessage] = useState("");

  const [drawMode, setDrawMode] = useState(false);
  const [draftPoints, setDraftPoints] = useState([]);
  const [manualGridName, setManualGridName] = useState("");
  const [manualMarket, setManualMarket] = useState("");
  const [savingManualGrid, setSavingManualGrid] = useState(false);

  const [editingGrid, setEditingGrid] = useState(null);
  const [editGridName, setEditGridName] = useState("");
  const [editGridMarket, setEditGridMarket] = useState("");
  const [editGridStatus, setEditGridStatus] = useState("Available");
  const [savingGridEdit, setSavingGridEdit] = useState(false);

  useEffect(() => {
    fetchGrids();
  }, [refreshKey]);

  const normalizeGeometry = (geometry) => {
    if (!geometry) return null;

    if (typeof geometry === "string") {
      try {
        return JSON.parse(geometry);
      } catch {
        return null;
      }
    }

    return geometry;
  };

  const fetchGrids = async () => {
    setMessage("Loading grids...");

    try {
      const allRows = [];
      const pageSize = 1000;
      let from = 0;

      while (true) {
        const to = from + pageSize - 1;

        const { data, error } = await supabase
          .from("grids")
          .select("*")
          .order("created_at", { ascending: false })
          .range(from, to);

        if (error) throw error;

        const rows = data || [];
        allRows.push(...rows);

        if (rows.length < pageSize) break;
        from += pageSize;
      }

      const normalized = allRows.map((grid) => ({
        ...grid,
        status: grid.status || "Available",
        geometry: normalizeGeometry(grid.geometry),
      }));

      setGrids(normalized);
      setMessage(`Loaded ${normalized.length} grids.`);
    } catch (tableError) {
      console.warn("Direct grid table load failed, trying geojson RPC:", tableError);

      const { data, error } = await supabase.rpc("get_grids_geojson");

      if (error) {
        console.error("Error fetching grids:", error);
        setMessage(`Error loading grids: ${error.message}`);
        return;
      }

      const normalized = (data || []).map((grid) => ({
        ...grid,
        status: grid.status || "Available",
        geometry: normalizeGeometry(grid.geometry),
      }));

      setGrids(normalized);
      setMessage(`Loaded ${normalized.length} grids.`);
    }
  };

  const activeMarket = normalizeFilterValue(dashboardFilters?.market);

  const filteredGrids = useMemo(() => {
    return grids.filter((grid) => {
      const activeStatus = normalizeFilterValue(dashboardFilters?.status);

      const matchesMarket = !activeMarket || grid.market === activeMarket;
      const matchesStatus = !activeStatus || grid.status === activeStatus;

      const matchesSearch =
        !searchText.trim() ||
        String(grid.name || "")
          .toLowerCase()
          .includes(searchText.toLowerCase());

      return matchesMarket && matchesStatus && matchesSearch;
    });
  }, [grids, searchText, activeMarket, dashboardFilters?.status]);

  const mapLimitValue = mapRenderLimit === "all" ? Infinity : Number(mapRenderLimit);

  const mapGrids = useMemo(() => {
    if (selectedGrid) return [selectedGrid];
    return filteredGrids.slice(0, mapLimitValue);
  }, [filteredGrids, mapLimitValue, selectedGrid]);

  const recordRows = useMemo(() => {
    if (selectedGrid) return [selectedGrid];
    return filteredGrids.slice(0, Number(tableLimit));
  }, [selectedGrid, filteredGrids, tableLimit]);

  const getStatusStyle = (status) => {
    switch (status) {
      case "Assigned":
        return { color: "#ffd66b", fillColor: "#ffd66b" };
      case "In Progress":
        return { color: "#00d4ff", fillColor: "#00d4ff" };
      case "Completed":
        return { color: "#43ff9a", fillColor: "#43ff9a" };
      case "Needs Re-drive":
        return { color: "#ff5c7a", fillColor: "#ff5c7a" };
      case "Available":
      default:
        return { color: "#1d4ed8", fillColor: "#93c5fd" };
    }
  };

  const getGridStyle = (grid) => {
    const isSelected = selectedGrid?.id === grid.id;
    const statusStyle = getStatusStyle(grid.status);

    return {
      color: isSelected ? "#ffffff" : statusStyle.color,
      weight: isSelected ? 5 : 4,
      opacity: 1,
      fillColor: statusStyle.fillColor,
      fillOpacity: isSelected ? 0.38 : 0.18,
    };
  };

  const handleViewGrid = (grid) => {
    setSelectedGrid(grid);

    setTimeout(() => {
      const ref = geoJsonRefs.current[grid.id];

      if (ref) {
        ref.openPopup();
      }
    }, 250);
  };

  const handleStatusChange = async (grid, newStatus) => {
    const { error } = await supabase
      .from("grids")
      .update({ status: newStatus })
      .eq("id", grid.id);

    if (error) {
      console.error(error);
      setMessage(`Status update failed: ${error.message}`);
      return;
    }

    setGrids((prev) =>
      prev.map((item) =>
        item.id === grid.id ? { ...item, status: newStatus } : item
      )
    );

    if (selectedGrid?.id === grid.id) {
      setSelectedGrid({ ...selectedGrid, status: newStatus });
    }

    setMessage("Grid status updated.");
  };

  const startEditGrid = (grid) => {
    setEditingGrid(grid);
    setEditGridName(grid.name || "");
    setEditGridMarket(grid.market || "");
    setEditGridStatus(grid.status || "Available");
    setShowGridRecords(true);
    setMessage(`Editing grid "${grid.name || "Unnamed Grid"}".`);
  };

  const cancelEditGrid = () => {
    setEditingGrid(null);
    setEditGridName("");
    setEditGridMarket("");
    setEditGridStatus("Available");
    setSavingGridEdit(false);
    setMessage("Grid edit cancelled.");
  };

  const saveGridEdit = async () => {
    if (!editingGrid?.id) {
      setMessage("No grid selected for editing.");
      return;
    }

    const cleanName = editGridName.trim();
    const cleanMarket = editGridMarket.trim();

    if (!cleanName) {
      setMessage("Grid name cannot be empty.");
      return;
    }

    if (!cleanMarket) {
      setMessage("Market cannot be empty.");
      return;
    }

    setSavingGridEdit(true);
    setMessage("Saving grid changes...");

    const payload = {
      name: cleanName,
      market: cleanMarket,
      status: editGridStatus || "Available",
    };

    const { error } = await supabase
      .from("grids")
      .update(payload)
      .eq("id", editingGrid.id);

    if (error) {
      console.error(error);
      setMessage(`Grid edit failed: ${error.message}`);
      setSavingGridEdit(false);
      return;
    }

    setGrids((prev) =>
      prev.map((item) =>
        item.id === editingGrid.id ? { ...item, ...payload } : item
      )
    );

    if (selectedGrid?.id === editingGrid.id) {
      setSelectedGrid({ ...selectedGrid, ...payload });
    }

    setEditingGrid(null);
    setEditGridName("");
    setEditGridMarket("");
    setEditGridStatus("Available");
    setSavingGridEdit(false);
    setMessage("Grid changes saved.");
  };

  const handleDeleteGrid = async (grid) => {
    if (["Assigned", "In Progress"].includes(grid.status)) {
      setMessage("This grid is assigned or in progress. Change status before deleting.");
      return;
    }

    const confirmDelete = window.confirm(
      `Delete grid "${grid.name || "Unnamed Grid"}"?`
    );

    if (!confirmDelete) return;

    const { error } = await supabase.from("grids").delete().eq("id", grid.id);

    if (error) {
      console.error(error);
      setMessage(`Delete failed: ${error.message}`);
      return;
    }

    if (selectedGrid?.id === grid.id) {
      setSelectedGrid(null);
    }

    setMessage("Grid deleted.");
    await fetchGrids();
  };

  const startDrawMode = () => {
    setShowManualTools(true);
    setSelectedGrid(null);
    setDraftPoints([]);
    setDrawMode(true);
    setMessage("Draw mode enabled. Click the map to add grid boundary points.");
  };

  const cancelDrawMode = () => {
    setDrawMode(false);
    setDraftPoints([]);
    setShowManualTools(false);
    setMessage("Manual grid drawing cancelled.");
  };

  const undoDraftPoint = () => {
    setDraftPoints((prev) => prev.slice(0, -1));
  };

  const handleAddDraftPoint = (latlng) => {
    setDraftPoints((prev) => [
      ...prev,
      {
        lat: Number(latlng.lat),
        lng: Number(latlng.lng),
      },
    ]);
  };

  const saveManualGrid = async () => {
    const gridName = manualGridName.trim();
    const gridMarket = manualMarket.trim() || activeMarket;

    if (!gridName) {
      setMessage("Please enter a grid name before saving.");
      return;
    }

    if (!gridMarket) {
      setMessage("Please enter a market before saving the manual grid.");
      return;
    }

    if (draftPoints.length < 3) {
      setMessage("Please click at least 3 map points to create a grid polygon.");
      return;
    }

    const geometry = pointsToGeoJsonPolygon(draftPoints);

    if (!geometry) {
      setMessage("Manual grid polygon is invalid. Please redraw the grid.");
      return;
    }

    setSavingManualGrid(true);
    setMessage("Saving manual grid...");

    const { error } = await supabase.from("grids").insert({
      name: gridName,
      market: gridMarket,
      status: "Available",
      geometry,
    });

    if (error) {
      console.error(error);
      setMessage(`Manual grid save failed: ${error.message}`);
      setSavingManualGrid(false);
      return;
    }

    setMessage(`Manual grid "${gridName}" saved successfully.`);
    setManualGridName("");
    setManualMarket("");
    setDraftPoints([]);
    setDrawMode(false);
    setShowManualTools(false);
    setSavingManualGrid(false);
    await fetchGrids();
  };

  return (
    <div className="panel-card bd-grid-map-clean">
      <GridMapThemeStyles />
      <div className="panel-header grid-map-main-header">
        <div>
          <div className="grid-map-kicker">Grid Operations</div>
          <h2>Grid Map</h2>
          <p className="muted">
            Showing {filteredGrids.length} of {grids.length} grids. Use search and market filters before opening records.
          </p>
        </div>

        <div className="grid-map-actions">
          {selectedGrid && (
            <button
              type="button"
              className="small-btn"
              onClick={() => setSelectedGrid(null)}
            >
              Clear Selected Grid
            </button>
          )}

          <button
            type="button"
            className="small-btn"
            onClick={() => setShowAdvancedTools((current) => !current)}
          >
            {showAdvancedTools ? "Hide Map Tools" : "Map Tools"}
          </button>

          <button
            type="button"
            className="small-btn"
            onClick={() => setShowManualTools((current) => !current)}
          >
            {showManualTools ? "Hide Manual Tools" : "Manual Grid Tools"}
          </button>

          <button className="small-btn" onClick={fetchGrids}>
            Refresh
          </button>
        </div>
      </div>

      <div className="grid-map-quick-filters">
        <div>
          <label>Grid Name Search</label>
          <input
            type="text"
            placeholder="Search by grid name..."
            value={searchText}
            onChange={(event) => {
              setSearchText(event.target.value);
              setSelectedGrid(null);
            }}
          />
        </div>

        <div>
          <label>Cell Tech Layer</label>
          <select
            value={cellTechFilter}
            onChange={(event) => setCellTechFilter(event.target.value)}
          >
            <option value="all">All Technologies</option>
            <option value="5G">5G / NR</option>
            <option value="LTE">LTE</option>
            <option value="3G">3G</option>
            <option value="2G">2G</option>
          </select>
        </div>

        <div>
          <label>Total Grids</label>
          <div className="info-box">{grids.length}</div>
        </div>

        <div>
          <label>Filtered Grids</label>
          <div className="info-box">{filteredGrids.length}</div>
        </div>

      </div>

      {showAdvancedTools && (
        <div className="grid-map-advanced-tools">
          <div>
            <label>Map Showing</label>
            <div className="info-box">
              {mapGrids.length} of {filteredGrids.length}
            </div>
          </div>

          <div>
            <label>Table Limit</label>
            <select
              value={tableLimit}
              onChange={(event) => setTableLimit(Number(event.target.value))}
            >
              <option value={25}>25 rows</option>
              <option value={100}>100 rows</option>
              <option value={250}>250 rows</option>
              <option value={500}>500 rows</option>
            </select>
          </div>

          <div>
            <label>Map Render Limit</label>
            <select
              value={mapRenderLimit}
              onChange={(event) => setMapRenderLimit(event.target.value)}
            >
              <option value="250">250 grids</option>
              <option value="500">500 grids</option>
              <option value="1000">1,000 grids</option>
              <option value="3000">3,000 grids</option>
              <option value="all">All filtered grids</option>
            </select>
          </div>

          <div className="grid-map-tool-note">
            Keep this closed for normal work. Open it only for large-market rendering or table limit changes.
          </div>
        </div>
      )}

      {showManualTools && (
      <div className={`manual-grid-tools ${drawMode ? "is-drawing" : ""}`}>
        <div className="panel-header" style={{ marginBottom: "12px" }}>
          <div>
            <h2 style={{ margin: 0 }}>Manual Grid Drawing V1</h2>
            <p className="muted" style={{ marginTop: "6px" }}>
              Click Draw Grid, add boundary points on the map, then save the grid.
            </p>
          </div>

          {!drawMode ? (
            <button className="small-btn" onClick={startDrawMode}>
              Draw Grid
            </button>
          ) : (
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                className="small-btn"
                onClick={undoDraftPoint}
                disabled={draftPoints.length === 0}
              >
                Undo Point
              </button>

              <button
                style={{ background: "linear-gradient(135deg, #ff5c7a, #ff9f43)" }}
                onClick={cancelDrawMode}
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        <div className="filters-grid">
          <div>
            <label>Manual Grid Name</label>
            <input
              type="text"
              placeholder="Example: JOS_TX_011"
              value={manualGridName}
              onChange={(event) => setManualGridName(event.target.value)}
            />
          </div>

          <div>
            <label>Market</label>
            <input
              type="text"
              placeholder={activeMarket ? `Using filter: ${activeMarket}` : "Example: Dallas"}
              value={manualMarket}
              onChange={(event) => setManualMarket(event.target.value)}
            />
          </div>

          <div>
            <label>Boundary Points</label>
            <div className="info-box">{draftPoints.length}</div>
          </div>

          <div>
            <label>Drawing Status</label>
            <div className="info-box">{drawMode ? "Drawing" : "Ready"}</div>
          </div>

          <button onClick={saveManualGrid} disabled={savingManualGrid || draftPoints.length < 3}>
            {savingManualGrid ? "Saving..." : "Save Manual Grid"}
          </button>
        </div>
        </div>
      )}

      <div className="grid-map-status-row">
        {message && <span className="grid-map-loaded-text">{message}</span>}

        {filteredGrids.length > mapGrids.length && (
          <span className="grid-map-warning-text">
            Map is showing {mapGrids.length} of {filteredGrids.length} filtered grids for browser performance.
          </span>
        )}
      </div>

      {editingGrid && (
        <div className="grid-edit-card">
          <div className="grid-edit-header">
            <div>
              <h3>Edit Grid</h3>
              <p>Update grid name, market, and operational status.</p>
            </div>

            <button type="button" className="small-btn" onClick={cancelEditGrid}>
              Close
            </button>
          </div>

          <div className="grid-edit-form">
            <div>
              <label>Grid Name</label>
              <input
                type="text"
                value={editGridName}
                onChange={(event) => setEditGridName(event.target.value)}
                placeholder="Grid name"
              />
            </div>

            <div>
              <label>Market</label>
              <input
                type="text"
                value={editGridMarket}
                onChange={(event) => setEditGridMarket(event.target.value)}
                placeholder="Market"
              />
            </div>

            <div>
              <label>Status</label>
              <select
                value={editGridStatus}
                onChange={(event) => setEditGridStatus(event.target.value)}
              >
                {GRID_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>

            <button type="button" onClick={saveGridEdit} disabled={savingGridEdit}>
              {savingGridEdit ? "Saving..." : "Save Grid Changes"}
            </button>
          </div>
        </div>
      )}

      <div className="map-shell grid-map-leaflet-shell" style={{ position: "relative" }}>
        {drawMode && (
          <div
            style={{
              position: "absolute",
              top: 12,
              left: 52,
              zIndex: 500,
              background: "rgba(15, 23, 42, 0.92)",
              color: "#ffffff",
              border: "1px solid rgba(34, 197, 94, 0.7)",
              borderRadius: "10px",
              padding: "8px 10px",
              fontSize: "13px",
              fontWeight: 800,
            }}
          >
            Draw Mode: click map to add points ({draftPoints.length})
          </div>
        )}

        <MapContainer
          center={[32.97, -96.34]}
          zoom={12}
          className="admin-map"
          style={{ height: "500px", width: "100%" }}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

          <MapController
            filteredGrids={mapGrids}
            selectedGrid={selectedGrid}
          />

          <DrawClickHandler enabled={drawMode} onAddPoint={handleAddDraftPoint} />

          {mapGrids.map((grid) => {
            if (!grid.geometry) return null;

            return (
              <GeoJSON
                key={`${grid.id}-${selectedGrid?.id === grid.id}-${grid.status}`}
                data={grid.geometry}
                style={() => getGridStyle(grid)}
                ref={(ref) => {
                  if (ref) {
                    geoJsonRefs.current[grid.id] = ref;
                  }
                }}
                eventHandlers={{
                  click: () => handleViewGrid(grid),
                  mouseover: (event) => {
                    event.target.setStyle({
                      color: "#ffffff",
                      weight: 5,
                      fillOpacity: 0.28,
                    });
                  },
                  mouseout: (event) => {
                    event.target.setStyle(getGridStyle(grid));
                  },
                }}
                onEachFeature={(feature, layer) => {
                  layer.bindPopup(`
                    <b>${grid.name || "Unnamed Grid"}</b><br/>
                    Market: ${grid.market || "Not set"}<br/>
                    Status: ${grid.status || "Available"}<br/>
                    Created: ${
                      grid.created_at
                        ? new Date(grid.created_at).toLocaleString()
                        : "-"
                    }
                  `);
                }}
              />
            );
          })}

          {draftPoints.length >= 2 && (
            <Polyline
              positions={draftPoints.map((point) => [point.lat, point.lng])}
              pathOptions={{ color: "#22c55e", weight: 4, dashArray: "8 8" }}
            />
          )}

          {draftPoints.length >= 3 && (
            <Polygon
              positions={draftPoints.map((point) => [point.lat, point.lng])}
              pathOptions={{
                color: "#22c55e",
                weight: 4,
                fillColor: "#86efac",
                fillOpacity: 0.24,
              }}
            />
          )}

          {draftPoints.map((point, index) => (
            <CircleMarker
              key={`draft-point-${index}`}
              center={[point.lat, point.lng]}
              radius={6}
              pathOptions={{
                color: "#ffffff",
                weight: 2,
                fillColor: "#22c55e",
                fillOpacity: 1,
              }}
            />
          ))}

          <CellSectorLayer
            market={activeMarket}
            technologyFilter={cellTechFilter}
            showSites
            showSectors
            maxRecords={2500}
          />
        </MapContainer>
      </div>

      <div className="grid-records-shell">
        <div className="grid-records-header">
          <div>
            <h3>Grid Records</h3>
            <p>
              Hidden by default for large markets. Use search/filters and show records only when needed.
            </p>
          </div>

          <button
            type="button"
            className="small-btn"
            onClick={() => setShowGridRecords((current) => !current)}
          >
            {showGridRecords ? "Hide Grid Records" : `Show Grid Records (${recordRows.length})`}
          </button>
        </div>

        {!showGridRecords ? (
          <div className="grid-records-collapsed">
            Grid records are hidden to keep the page fast and clean. The map is showing {mapGrids.length} grid polygon(s), with {filteredGrids.length} filtered grid(s) available.
          </div>
        ) : recordRows.length === 0 ? (
          <div className="info-box">
            No grid records match the current filters.
          </div>
        ) : (
          <div className="grid-records-table-wrap">
            <table className="grid-records-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Market</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {recordRows.map((grid) => (
                  <tr key={grid.id}>
                    <td>{grid.name || "Unnamed Grid"}</td>
                    <td>{grid.market || "Not set"}</td>
                    <td>
                      <select
                        value={grid.status || "Available"}
                        onChange={(event) =>
                          handleStatusChange(grid, event.target.value)
                        }
                      >
                        {GRID_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {grid.created_at
                        ? new Date(grid.created_at).toLocaleString()
                        : "-"}
                    </td>
                    <td>
                      <button
                        className="small-btn"
                        style={{ marginRight: "8px" }}
                        onClick={() => handleViewGrid(grid)}
                      >
                        View
                      </button>

                      <button
                        className="grid-record-edit-btn"
                        style={{ marginRight: "8px" }}
                        onClick={() => startEditGrid(grid)}
                      >
                        Edit
                      </button>

                      <button
                        className="grid-record-delete-btn"
                        onClick={() => handleDeleteGrid(grid)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}

                {filteredGrids.length > recordRows.length && (
                  <tr>
                    <td colSpan="5">
                      Showing {recordRows.length} of {filteredGrids.length} records.
                      Increase Table Limit or use search/market filters to narrow the list.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function normalizeFilterValue(value) {
  const clean = String(value || "").trim();

  if (!clean) return "";
  if (clean.toLowerCase() === "all") return "";
  if (clean.toLowerCase() === "all markets") return "";
  if (clean.toLowerCase() === "all statuses") return "";

  return clean;
}

function GridMapThemeStyles() {
  return (
    <style>{`

      .bd-grid-map-clean {
        text-align: left;
      }

      .bd-grid-map-clean .panel-header,
      .bd-grid-map-clean .grid-map-main-header,
      .bd-grid-map-clean .grid-records-header,
      .bd-grid-map-clean .grid-edit-header {
        text-align: left;
      }

      .bd-grid-map-clean h2,
      .bd-grid-map-clean h3,
      .bd-grid-map-clean p,
      .bd-grid-map-clean label {
        text-align: left;
      }

      .bd-grid-map-clean .filters-grid > div label {
        display: block;
        text-align: left !important;
        margin-bottom: 7px;
      }



      .grid-map-kicker {
        color: #60a5fa;
        font-size: 11px;
        font-weight: 950;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        margin-bottom: 5px;
      }

      .grid-map-main-header {
        align-items: center;
        margin-bottom: 14px;
      }

      .grid-map-main-header h2 {
        margin: 0;
        font-size: 24px;
        line-height: 1.05;
      }

      .grid-map-main-header .muted {
        margin-top: 5px;
      }

      .grid-map-quick-filters,
      .grid-map-advanced-tools {
        display: grid;
        grid-template-columns: 1.25fr 1fr 0.8fr 0.8fr;
        gap: 12px;
        margin-bottom: 14px;
        align-items: end;
      }

      .grid-map-advanced-tools {
        grid-template-columns: 0.8fr 0.8fr 0.8fr 1.4fr;
        border: 1px dashed rgba(96, 165, 250, 0.35);
        border-radius: 14px;
        padding: 12px;
        background: rgba(96, 165, 250, 0.06);
      }

      .grid-map-tool-note {
        align-self: stretch;
        display: flex;
        align-items: center;
        border-radius: 12px;
        padding: 0 12px;
        background: rgba(15, 23, 42, 0.10);
        color: #9fb4d3;
        font-size: 12px;
        font-weight: 800;
      }

      .grid-map-status-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        margin: 4px 0 10px;
      }

      .grid-map-loaded-text,
      .grid-map-warning-text {
        display: inline-flex;
        align-items: center;
        min-height: 26px;
        border-radius: 999px;
        padding: 5px 10px;
        font-weight: 900;
        font-size: 12px;
      }

      .grid-map-loaded-text {
        color: #064e3b;
        background: rgba(34, 197, 94, 0.14);
        border: 1px solid rgba(34, 197, 94, 0.30);
      }

      .grid-map-warning-text {
        color: #92400e;
        background: rgba(245, 158, 11, 0.14);
        border: 1px solid rgba(245, 158, 11, 0.32);
      }

      .grid-map-leaflet-shell {
        overflow: hidden;
        border-radius: 16px;
        border: 1px solid rgba(96, 165, 250, 0.32);
      }

      .grid-map-actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 10px;
        flex-wrap: wrap;
      }

      .manual-grid-tools {
        margin: 0 0 16px;
        padding: 14px;
        border: 1px solid rgba(96, 165, 250, 0.28);
        border-radius: 16px;
        background: rgba(15, 23, 42, 0.16);
      }

      .manual-grid-tools.is-drawing {
        border-color: rgba(34, 197, 94, 0.85);
        background: linear-gradient(135deg, rgba(34,197,94,0.10), rgba(37,99,235,0.08));
      }

      .manual-grid-tools .panel-header {
        margin-bottom: 12px;
      }

      .grid-map-message {
        text-align: left !important;
      }

      .grid-edit-card {
        margin: 0 0 16px;
        border: 1px solid rgba(96, 165, 250, 0.35);
        border-radius: 16px;
        padding: 14px;
        background: rgba(37, 99, 235, 0.10);
      }

      .grid-edit-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
      }

      .grid-edit-header h3 {
        margin: 0;
        color: #e7eefb;
      }

      .grid-edit-header p {
        margin: 4px 0 0;
        color: #9fb4d3;
        font-size: 13px;
        font-weight: 700;
      }

      .grid-edit-form {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
        align-items: end;
      }

      .grid-edit-form label {
        display: block;
        margin-bottom: 6px;
        color: #cfe2ff;
        font-weight: 900;
      }

      .grid-edit-form input,
      .grid-edit-form select {
        width: 100%;
      }

      .grid-records-shell {
        margin-top: 18px;
        border: 1px solid rgba(148, 163, 184, 0.24);
        border-radius: 16px;
        padding: 14px;
        background: rgba(15, 23, 42, 0.12);
      }

      .grid-records-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 10px;
      }

      .grid-records-header h3 {
        margin: 0;
        color: #e7eefb;
      }

      .grid-records-header p {
        margin: 4px 0 0;
        color: #9fb4d3;
        font-size: 13px;
        font-weight: 700;
      }

      .grid-records-collapsed {
        border: 1px dashed rgba(96, 165, 250, 0.35);
        border-radius: 12px;
        padding: 14px;
        color: #cfe2ff;
        background: rgba(96, 165, 250, 0.08);
        font-weight: 800;
      }

      .grid-records-table-wrap {
        overflow-x: auto;
      }

      .grid-records-table {
        width: 100%;
        border-collapse: collapse;
        min-width: 860px;
        background: rgba(8, 17, 31, 0.68);
        border: 1px solid rgba(96, 165, 250, 0.20);
        border-radius: 12px;
        overflow: hidden;
      }

      .grid-records-table th {
        text-align: left;
        padding: 12px;
        background: #07111f;
        color: #ffffff;
        border-bottom: 1px solid rgba(96, 165, 250, 0.25);
        font-size: 13px;
        letter-spacing: 0.04em;
      }

      .grid-records-table td {
        padding: 12px;
        border-bottom: 1px solid rgba(96, 165, 250, 0.18);
        color: #e7eefb;
        font-weight: 700;
      }

      .grid-records-table select {
        min-width: 180px;
      }

      .grid-record-edit-btn {
        background: linear-gradient(135deg, #2563eb, #06b6d4);
        color: #ffffff;
        border: 0;
        border-radius: 10px;
        padding: 9px 12px;
        font-weight: 900;
        cursor: pointer;
      }

      .grid-record-delete-btn {
        background: linear-gradient(135deg, #ff5c7a, #ff9f43);
        color: #07111f;
        border: 0;
        border-radius: 10px;
        padding: 9px 12px;
        font-weight: 900;
        cursor: pointer;
      }

      body.bd-theme-day .grid-edit-card,
      .theme-day .grid-edit-card {
        background: #eff6ff;
        border-color: #bfdbfe;
      }

      body.bd-theme-day .grid-edit-header h3,
      .theme-day .grid-edit-header h3 {
        color: #0f172a;
      }

      body.bd-theme-day .grid-edit-header p,
      .theme-day .grid-edit-header p,
      body.bd-theme-day .grid-edit-form label,
      .theme-day .grid-edit-form label {
        color: #334155;
      }

      body.bd-theme-day .grid-records-shell,
      .theme-day .grid-records-shell {
        background: #ffffff;
        border-color: #bfdbfe;
      }

      body.bd-theme-day .grid-records-header h3,
      .theme-day .grid-records-header h3 {
        color: #0f172a;
      }

      body.bd-theme-day .grid-records-header p,
      .theme-day .grid-records-header p {
        color: #475569;
      }

      body.bd-theme-day .grid-records-collapsed,
      .theme-day .grid-records-collapsed {
        color: #0f172a;
        background: #eff6ff;
        border-color: #bfdbfe;
      }

      body.bd-theme-day .grid-records-table,
      .theme-day .grid-records-table {
        background: #ffffff;
        border-color: #bfdbfe;
      }

      body.bd-theme-day .grid-records-table th,
      .theme-day .grid-records-table th {
        background: #eaf4ff;
        color: #0f172a;
        border-bottom-color: #bfdbfe;
      }

      body.bd-theme-day .grid-records-table td,
      .theme-day .grid-records-table td {
        color: #0f172a;
        border-bottom-color: #dbeafe;
      }

      body.bd-theme-day .grid-record-delete-btn,
      .theme-day .grid-record-delete-btn {
        color: #0f172a;
      }



      body.bd-theme-day .manual-grid-tools,
      .theme-day .manual-grid-tools {
        background: #ffffff;
        border-color: #bfdbfe;
      }

      body.bd-theme-day .manual-grid-tools.is-drawing,
      .theme-day .manual-grid-tools.is-drawing {
        background: linear-gradient(135deg, rgba(34,197,94,0.11), rgba(37,99,235,0.07));
        border-color: rgba(34, 197, 94, 0.65);
      }

      body.bd-theme-day .bd-grid-map-clean .panel-header h2,
      .theme-day .bd-grid-map-clean .panel-header h2,
      body.bd-theme-day .bd-grid-map-clean .panel-header h3,
      .theme-day .bd-grid-map-clean .panel-header h3,
      body.bd-theme-day .bd-grid-map-clean h2,
      .theme-day .bd-grid-map-clean h2,
      body.bd-theme-day .bd-grid-map-clean h3,
      .theme-day .bd-grid-map-clean h3 {
        color: #0f172a;
      }

      body.bd-theme-day .bd-grid-map-clean .muted,
      .theme-day .bd-grid-map-clean .muted,
      body.bd-theme-day .bd-grid-map-clean p,
      .theme-day .bd-grid-map-clean p,
      body.bd-theme-day .bd-grid-map-clean label,
      .theme-day .bd-grid-map-clean label {
        color: #334155;
      }

      body.bd-theme-night .bd-grid-map-clean,
      .bd-theme-night .bd-grid-map-clean,
      body.bd-theme-night .manual-grid-tools,
      .bd-theme-night .manual-grid-tools {
        background: #0b1b31;
        border-color: #1f4b79;
      }

      body.bd-theme-night .bd-grid-map-clean h2,
      .bd-theme-night .bd-grid-map-clean h2,
      body.bd-theme-night .bd-grid-map-clean h3,
      .bd-theme-night .bd-grid-map-clean h3,
      body.bd-theme-night .bd-grid-map-clean label,
      .bd-theme-night .bd-grid-map-clean label {
        color: #edf6ff;
      }

      body.bd-theme-night .bd-grid-map-clean .muted,
      .bd-theme-night .bd-grid-map-clean .muted,
      body.bd-theme-night .bd-grid-map-clean p,
      .bd-theme-night .bd-grid-map-clean p {
        color: #a9c9ee;
      }



      body.bd-theme-day .grid-map-tool-note,
      .theme-day .grid-map-tool-note {
        background: #eff6ff;
        color: #334155;
      }

      body.bd-theme-day .grid-map-main-header .muted,
      .theme-day .grid-map-main-header .muted {
        color: #334155;
      }

      body.bd-theme-night .grid-map-loaded-text,
      .theme-night .grid-map-loaded-text,
      .bd-theme-night .grid-map-loaded-text {
        color: #86efac;
        background: rgba(34, 197, 94, 0.10);
        border-color: rgba(34, 197, 94, 0.28);
      }

      body.bd-theme-night .grid-map-warning-text,
      .theme-night .grid-map-warning-text,
      .bd-theme-night .grid-map-warning-text {
        color: #fbbf24;
        background: rgba(245, 158, 11, 0.10);
        border-color: rgba(245, 158, 11, 0.24);
      }

      body.bd-theme-night .grid-map-tool-note,
      .theme-night .grid-map-tool-note,
      .bd-theme-night .grid-map-tool-note {
        background: rgba(8, 17, 31, 0.62);
        color: #a9c9ee;
      }

      body.bd-theme-night .bd-grid-map-clean,
      .theme-night .bd-grid-map-clean,
      .bd-theme-night .bd-grid-map-clean,
      body.bd-theme-night .manual-grid-tools,
      .theme-night .manual-grid-tools,
      .bd-theme-night .manual-grid-tools,
      body.bd-theme-night .grid-records-shell,
      .theme-night .grid-records-shell,
      .bd-theme-night .grid-records-shell {
        background: #0b1b31 !important;
        border-color: #1f4b79 !important;
      }

      body.bd-theme-night .bd-grid-map-clean h2,
      .theme-night .bd-grid-map-clean h2,
      .bd-theme-night .bd-grid-map-clean h2,
      body.bd-theme-night .bd-grid-map-clean h3,
      .theme-night .bd-grid-map-clean h3,
      .bd-theme-night .bd-grid-map-clean h3,
      body.bd-theme-night .bd-grid-map-clean label,
      .theme-night .bd-grid-map-clean label,
      .bd-theme-night .bd-grid-map-clean label {
        color: #edf6ff !important;
      }

      body.bd-theme-night .bd-grid-map-clean p,
      .theme-night .bd-grid-map-clean p,
      .bd-theme-night .bd-grid-map-clean p,
      body.bd-theme-night .bd-grid-map-clean .muted,
      .theme-night .bd-grid-map-clean .muted,
      .bd-theme-night .bd-grid-map-clean .muted {
        color: #a9c9ee !important;
      }

      @media (max-width: 800px) {
        .grid-map-quick-filters,
        .grid-map-advanced-tools {
          grid-template-columns: 1fr;
        }

        .grid-records-header,
        .grid-edit-header {
          align-items: stretch;
          flex-direction: column;
        }

        .grid-edit-form {
          grid-template-columns: 1fr;
        }
      }
    `}</style>
  );
}
