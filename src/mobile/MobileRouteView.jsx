import React, { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  Popup,
  CircleMarker,
  Polyline,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { supabase } from "../lib/supabaseClient";
import CellSectorLayer from "../components/maps/CellSectorLayer";

const DEFAULT_CENTER = [32.7767, -96.797];
const DEFAULT_ZOOM = 10;
const OFF_ROUTE_THRESHOLD_M = 95;
const MAX_TRAIL_POINTS = 300;
const GPS_PERMISSION_REQUIRED_MESSAGE =
  "Location permission is required for live task GPS tracking.";
const GPS_PERMISSION_ANDROID_STEPS =
  "Android Settings > Apps > BabyDragon > Permissions > Location > Allow while using.";

const BASE_LAYERS = {
  street: {
    label: "Street",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors",
  },
  satellite: {
    label: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
  },
  terrain: {
    label: "Terrain",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "Map data &copy; OpenStreetMap contributors, SRTM | OpenTopoMap",
  },
};

const ROUTE_URL_FIELDS = [
  "geojson_url",
  "geo_json_url",
  "route_geojson_url",
  "route_json_url",
  "route_file_url",
  "export_geojson_url",
  "file_url",
  "public_url",
  "download_url",
];

const ROUTE_GEOMETRY_FIELDS = [
  "geojson",
  "geo_json",
  "geojson_data",
  "geoJson",
  "geometry",
  "geometry_json",
  "route_geo_json",
  "data",
  "json_data",
  "shape",
  "route_shape",
  "coords",
  "waypoints",
  "route_waypoints",
  "route_geojson",
  "routeGeojson",
  "route_geometry",
  "routeGeometry",
  "route_json",
  "routeJson",
  "route_data",
  "routeData",
  "route_payload",
  "routePayload",
  "route_segments",
  "routeSegments",
  "road_segments",
  "roadSegments",
  "selected_roads",
  "selectedRoads",
  "segments",
  "features",
  "feature_collection",
  "featureCollection",
  "route_feature_collection",
  "routeFeatureCollection",
  "line",
  "line_string",
  "lineString",
  "linestring",
  "polyline",
  "route_line",
  "routeLine",
  "route_lines",
  "routeLines",
  "coordinates",
  "route_coordinates",
  "routeCoordinates",
  "route_coords",
  "routeCoords",
  "route_path",
  "routePath",
  "path",
  "path_geojson",
  "map_geojson",
  "mapData",
  "map_data",
  "export_geojson",
  "exported_route_geojson",
  "points",
  "route_points",
  "routePoints",
  "latlngs",
  "lat_lngs",
  "kml_coordinates",
  "kml",
];

const DEFAULT_ROUTE_ISSUE = {
  issue_type: "route_issue",
  severity: "normal",
  description: "",
};

const ISSUE_TYPES = [
  { value: "route_issue", label: "Route" },
  { value: "no_access", label: "No Access" },
  { value: "private_road", label: "Private Road" },
  { value: "blocked_route", label: "Blocked" },
  { value: "equipment_issue", label: "Equipment" },
  { value: "safety", label: "Safety" },
  { value: "weather", label: "Weather" },
  { value: "other", label: "Other" },
];

export default function MobileRouteView({
  assignedTasks = [],
  taskLoading = false,
  issueLoadingTaskId = null,
  onOpenNavigation,
  onSubmitRouteIssue,
  onUpdateTaskStatus,
}) {
  const [routeContextLoading, setRouteContextLoading] = useState(false);
  const [routeContextError, setRouteContextError] = useState("");
  const [taskGridRows, setTaskGridRows] = useState([]);
  const [grids, setGrids] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [routeGridRows, setRouteGridRows] = useState([]);
  const [selectedRowId, setSelectedRowId] = useState("");
  const [showOtherRoutes, setShowOtherRoutes] = useState(false);
  const [showIssueForm, setShowIssueForm] = useState(false);
  const [issueInputsByTask, setIssueInputsByTask] = useState({});
  const [photoInputsByTask, setPhotoInputsByTask] = useState({});
  const [statusOverrides, setStatusOverrides] = useState({});
  const [statusSavingTaskId, setStatusSavingTaskId] = useState(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const taskIds = useMemo(
    () => assignedTasks.map((task) => task?.id).filter(Boolean),
    [assignedTasks]
  );

  useEffect(() => {
    let isMounted = true;

    async function loadRouteContext() {
      setRouteContextError("");
      setRouteContextLoading(true);

      try {
        if (taskIds.length === 0) {
          if (isMounted) {
            setTaskGridRows([]);
            setGrids([]);
            setRoutes([]);
            setRouteGridRows([]);
          }
          return;
        }

        const { data: taskGridData, error: taskGridError } = await supabase
          .from("task_grids")
          .select("*")
          .in("task_id", taskIds);

        if (taskGridError) throw taskGridError;

        const safeTaskGrids = Array.isArray(taskGridData) ? taskGridData : [];
        const baseGridIds = Array.from(
          new Set(
            [
              ...safeTaskGrids.map((item) => item.grid_id),
              ...assignedTasks.map((task) => task.grid_id),
              ...assignedTasks.map((task) => task.gridId),
              ...assignedTasks.map((task) => task.grid_db_id),
              ...assignedTasks.map((task) => task.grid_name),
              ...assignedTasks.map((task) => task.target_name),
              ...assignedTasks.map((task) => task.target),
              ...assignedTasks.map((task) => task.reference),
              ...assignedTasks.map((task) => task._mobileGrid?.id),
              ...assignedTasks.map((task) => task._mobileGrid?.grid_id),
              ...assignedTasks.map((task) => task._mobileGrid?.grid_code),
              ...assignedTasks.map((task) => task._mobileGrid?.name),
            ].filter(Boolean)
          )
        );

        const gridData = await loadAssignedGrids(baseGridIds);
        const routeLookupKeys = buildRouteLookupKeys(baseGridIds, gridData, assignedTasks);

        const [routeGridData, directRouteData, directSavedRouteData] = await Promise.all([
          loadRouteGridRows(routeLookupKeys),
          loadRoutesFromTable("routes", routeLookupKeys),
          loadRoutesFromTable("saved_routes", routeLookupKeys),
        ]);

        const routeIds = Array.from(
          new Set((routeGridData || []).map((item) => item.route_id).filter(Boolean))
        );

        const [linkedRouteData, linkedSavedRouteData, looseRouteData] = await Promise.all([
          loadRoutesByIds("routes", routeIds),
          loadRoutesByIds("saved_routes", routeIds),
          loadLooseMatchedRoutes(routeLookupKeys, gridData, assignedTasks),
        ]);

        const mergedRoutes = mergeById([
          ...(linkedRouteData || []),
          ...(linkedSavedRouteData || []),
          ...(directRouteData || []),
          ...(directSavedRouteData || []),
          ...(looseRouteData || []),
          ...assignedTasks.map((task) => task._mobileRoute).filter(Boolean),
        ]);

        if (isMounted) {
          setTaskGridRows(safeTaskGrids);
          setGrids(gridData || []);
          setRoutes(mergedRoutes);
          setRouteGridRows(routeGridData || []);
        }
      } catch (error) {
        console.error("Mobile route context load error:", error);
        if (isMounted) {
          setRouteContextError(error.message || "Unable to load route map details.");
        }
      } finally {
        if (isMounted) setRouteContextLoading(false);
      }
    }

    loadRouteContext();

    return () => {
      isMounted = false;
    };
  }, [assignedTasks, taskIds, refreshKey]);

  const allRouteRows = useMemo(() => {
    return buildRouteRows({
      assignedTasks,
      taskGridRows,
      grids,
      routes,
      routeGridRows,
    }).map((row) => ({
      ...row,
      effectiveStatus: statusOverrides[row.task?.id] || row.task?.status || "assigned",
    }));
  }, [assignedTasks, grids, routeGridRows, routes, statusOverrides, taskGridRows]);

  const routeRows = useMemo(() => {
    return allRouteRows.filter((row) => isActiveRouteStatus(row.effectiveStatus));
  }, [allRouteRows]);

  useEffect(() => {
    if (routeRows.length === 0) {
      setSelectedRowId("");
      return;
    }

    const activeRow = routeRows.find((row) => isInProcessStatus(row.effectiveStatus));
    const selectedRow = routeRows.find((row) => row.id === selectedRowId);

    if (activeRow && selectedRow?.id !== activeRow.id) {
      setSelectedRowId(activeRow.id);
      return;
    }

    const selectedStillExists = Boolean(selectedRow);
    if (selectedStillExists) return;

    const savedGridId = safeLocalStorageGet("feRouteSelectedGridId");
    const fromTaskClick = savedGridId
      ? routeRows.find((row) =>
          getGridKeys(row.grid).some((key) => String(key) === String(savedGridId))
        )
      : null;

    const preferredRow =
      routeRows.find((row) => isInProcessStatus(row.effectiveStatus)) ||
      routeRows.find((row) => isOnHoldStatus(row.effectiveStatus)) ||
      fromTaskClick ||
      routeRows.find((row) => row.route) ||
      routeRows[0];

    setSelectedRowId(preferredRow.id);
  }, [routeRows, selectedRowId]);

  const selectedRow = useMemo(() => {
    return routeRows.find((row) => row.id === selectedRowId) || routeRows[0] || null;
  }, [routeRows, selectedRowId]);

  const stats = useMemo(() => {
    const activeTaskIds = new Set(routeRows.map((row) => String(row.task?.id || row.id)));
    return {
      activeTasks: activeTaskIds.size,
      assigned: routeRows.filter((row) => isAssignedStatus(row.effectiveStatus)).length,
      inProgress: routeRows.filter((row) => isInProcessStatus(row.effectiveStatus)).length,
      onHold: routeRows.filter((row) => isOnHoldStatus(row.effectiveStatus)).length,
      ready: routeRows.filter((row) => Boolean(row.route)).length,
      missing: routeRows.filter((row) => !row.route).length,
    };
  }, [routeRows]);

  function refreshRoutes() {
    setStatusMessage("");
    setRefreshKey((value) => value + 1);
  }

  function updateIssueInput(taskId, patch) {
    setIssueInputsByTask((prev) => ({
      ...prev,
      [taskId]: {
        ...DEFAULT_ROUTE_ISSUE,
        ...(prev[taskId] || {}),
        ...patch,
      },
    }));
  }

  async function submitIssue(row) {
    if (!row?.task || !onSubmitRouteIssue) return;

    const input = {
      ...DEFAULT_ROUTE_ISSUE,
      ...(issueInputsByTask[row.task.id] || {}),
    };

    const photoFile = photoInputsByTask[row.task.id] || null;
    await onSubmitRouteIssue(row.task, input, photoFile);

    setIssueInputsByTask((prev) => ({
      ...prev,
      [row.task.id]: { ...DEFAULT_ROUTE_ISSUE },
    }));
    setPhotoInputsByTask((prev) => ({ ...prev, [row.task.id]: null }));
    setShowIssueForm(false);
  }

  async function handleStatusChange(row, nextStatus) {
    if (!row?.task?.id) return;

    setStatusSavingTaskId(row.task.id);
    setStatusMessage("");

    try {
      if (onUpdateTaskStatus) {
        await onUpdateTaskStatus(row.task.id, nextStatus);
      } else {
        const patch = { status: nextStatus };
        if (nextStatus === "in_progress") patch.started_at = new Date().toISOString();
        if (nextStatus === "completed") patch.completed_at = new Date().toISOString();

        const { error } = await supabase
          .from("tasks")
          .update(patch)
          .eq("id", row.task.id);

        if (error) throw error;
      }

      setStatusOverrides((prev) => ({ ...prev, [row.task.id]: nextStatus }));
      setStatusMessage(`${getGridLabel(row.grid, row.task)} moved to ${formatStatus(nextStatus)}.`);
    } catch (error) {
      console.error("Route status update failed:", error);
      setStatusMessage(
        error?.message ||
          "Status update failed. If this was On-Hold, Supabase may need on_hold added to the task status rule."
      );
    } finally {
      setStatusSavingTaskId(null);
    }
  }

  function handleNavigate(row) {
    const directUrl = buildNavigationUrl(row);

    if (directUrl) {
      window.open(directUrl, "_blank", "noopener,noreferrer");
      return;
    }

    if (onOpenNavigation) onOpenNavigation(row.task);
  }

  if (taskLoading) {
    return (
      <section className="bd-mobile-card bd-mobile-center" style={styles.loadingCard}>
        <div className="bd-mobile-loader" />
        <h2>Loading tasks</h2>
        <p className="bd-mobile-muted">Loading assigned tasks for this FE.</p>
      </section>
    );
  }

  if (routeRows.length === 0) {
    return (
      <section className="bd-mobile-card bd-mobile-center" style={styles.emptyCard}>
        <p style={styles.versionPill}>Active Route</p>
        <h2>No active task routes</h2>
        <p className="bd-mobile-muted">
          Assigned, In Progress, and On-Hold tasks will appear here. Completed tasks stay in My Tasks history.
        </p>
        <button type="button" className="bd-mobile-secondary" onClick={refreshRoutes}>
          Refresh Active Tasks
        </button>
      </section>
    );
  }

  const selectedTaskRows = selectedRow?.task?.id
    ? routeRows.filter((row) => String(row.task?.id) === String(selectedRow.task.id))
    : selectedRow
      ? [selectedRow]
      : [];

  const issueCount = getIssueList(selectedRow?.task).length;
  const latestIssue = getLatestIssue(selectedRow?.task);
  const issueInput = {
    ...DEFAULT_ROUTE_ISSUE,
    ...(issueInputsByTask[selectedRow?.task?.id] || {}),
  };
  const isSavingIssue = String(issueLoadingTaskId || "") === String(selectedRow?.task?.id || "");
  const isSavingStatus = String(statusSavingTaskId || "") === String(selectedRow?.task?.id || "");
  const otherRows = getUniqueTaskRows(
    routeRows.filter((row) => String(row.task?.id || row.id) !== String(selectedRow?.task?.id || selectedRow?.id))
  );

  return (
    <section className="bd-mobile-routes-view bd-mobile-routes-workspace" style={styles.page}>
      <div style={styles.topBar}>
        <div>
          <p style={styles.versionPill}>Active Route</p>
          <h2 style={styles.pageTitle}>Active Task Map</h2>
          <p style={styles.pageHint}>
            Follow the selected task route, check your GPS, measure distance, and report field issues.
          </p>
        </div>
        <button type="button" style={styles.refreshButton} onClick={refreshRoutes}>
          Refresh
        </button>
      </div>

      {routeContextLoading && <div style={styles.contextLoading}>Refreshing grid, route, GPS, and cell layers in the background...</div>}
      {routeContextError && <div style={styles.alert}>{routeContextError}</div>}
      {statusMessage && <div style={styles.statusMessage}>{statusMessage}</div>}

      <article className="bd-mobile-card" style={styles.activeCard}>
        <div style={styles.activeHeader}>
          <div>
            <p style={styles.eyebrow}>Selected Task</p>
            <h3 style={styles.taskTitle}>{selectedRow.taskName}</h3>
            <p style={styles.subTitle}>{selectedRow.marketLabel}</p>
          </div>
          <span style={selectedRow.route ? styles.readyPill : styles.missingPill}>
            {selectedRow.route ? "Route Ready" : "Grid Only"}
          </span>
        </div>

        <div style={styles.infoGrid}>
          <InfoItem label="Grid" value={selectedRow.gridLabel} />
          <InfoItem label="Route" value={selectedRow.routeLabel} />
          <InfoItem label="Status" value={formatStatus(selectedRow.effectiveStatus)} tone="blue" />
          <InfoItem label="Due" value={selectedRow.dueLabel} />
          <InfoItem label="Mode" value={selectedRow.routeMode} />
          <InfoItem label="Issues" value={issueCount} tone={issueCount ? "amber" : "green"} />
        </div>

        <RouteMapCard row={selectedRow} taskRows={selectedTaskRows} latestIssue={latestIssue} />

        <RouteLifecycleButtons
          row={selectedRow}
          isSaving={isSavingStatus}
          onStart={() => handleStatusChange(selectedRow, "in_progress")}
          onHold={() => handleStatusChange(selectedRow, "on_hold")}
          onEnd={() => handleStatusChange(selectedRow, "completed")}
          onNavigate={() => handleNavigate(selectedRow)}
        />

        <button
          type="button"
          style={styles.issueToggle}
          onClick={() => setShowIssueForm((value) => !value)}
        >
          {showIssueForm ? "Close Issue Form" : "+ Add Route Issue / Photo"}
        </button>

        {showIssueForm && (
          <div style={styles.issueForm}>
            <div style={styles.issueTypeGrid}>
              {ISSUE_TYPES.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  style={{
                    ...styles.issueTypeButton,
                    ...(issueInput.issue_type === type.value ? styles.issueTypeActive : null),
                  }}
                  onClick={() => updateIssueInput(selectedRow.task.id, { issue_type: type.value })}
                >
                  {type.label}
                </button>
              ))}
            </div>

            <label style={styles.label}>
              Severity
              <select
                value={issueInput.severity}
                onChange={(event) =>
                  updateIssueInput(selectedRow.task.id, { severity: event.target.value })
                }
                style={styles.input}
              >
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>

            <label style={styles.label}>
              Field note
              <textarea
                value={issueInput.description}
                onChange={(event) =>
                  updateIssueInput(selectedRow.task.id, { description: event.target.value })
                }
                placeholder="Example: private road, blocked route, safety issue, no access, need alternate route."
                rows={3}
                style={{ ...styles.input, resize: "vertical" }}
              />
            </label>

            <label style={styles.photoBox}>
              Photo evidence
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(event) =>
                  setPhotoInputsByTask((prev) => ({
                    ...prev,
                    [selectedRow.task.id]: event.target.files?.[0] || null,
                  }))
                }
              />
            </label>

            <button
              type="button"
              className="bd-mobile-primary"
              style={styles.submitIssueButton}
              disabled={isSavingIssue}
              onClick={() => submitIssue(selectedRow)}
            >
              {isSavingIssue ? "Saving..." : "Submit Issue"}
            </button>
          </div>
        )}

        {latestIssue && !showIssueForm && (
          <div style={styles.latestIssueBox}>
            <p style={styles.latestLabel}>Latest Issue</p>
            <strong>{formatIssueType(latestIssue.issue_type)}</strong>
            <span>{latestIssue.description || "Issue reported"}</span>
            <small>{formatDateTime(latestIssue.created_at)} • {formatSeverity(latestIssue.severity)}</small>
          </div>
        )}
      </article>

      {otherRows.length > 0 && (
        <section className="bd-mobile-card" style={styles.otherRoutesCard}>
          <button
            type="button"
            style={styles.otherRoutesToggle}
            onClick={() => setShowOtherRoutes((value) => !value)}
          >
            {showOtherRoutes ? "Hide Active Tasks" : `Choose Active Task (${otherRows.length})`}
          </button>

          {showOtherRoutes && (
            <div style={styles.otherRoutesList}>
              {routeRows.map((row) => (
                <button
                  type="button"
                  key={row.id}
                  style={{
                    ...styles.routeChoice,
                    ...(row.id === selectedRow.id ? styles.routeChoiceActive : null),
                  }}
                  onClick={() => {
                    setSelectedRowId(row.id);
                    setShowIssueForm(false);
                    setShowOtherRoutes(false);
                  }}
                >
                  <span>
                    <strong>{row.taskName}</strong>
                    <small>{formatStatus(row.effectiveStatus)} • {row.gridLabel}</small>
                  </span>
                  <em>{row.route ? "Map" : "Grid"}</em>
                </button>
              ))}
            </div>
          )}
        </section>
      )}
    </section>
  );
}

function RouteLifecycleButtons({ row, isSaving, onStart, onHold, onEnd, onNavigate }) {
  const status = normalizeStatus(row?.effectiveStatus || row?.task?.status);
  const isActive = isInProcessStatus(status);
  const isHold = isOnHoldStatus(status);
  const isDone = isCompletedStatus(status);

  return (
    <div style={styles.lifecycleGrid}>
      {!isActive && !isDone && (
        <button
          type="button"
          className="bd-mobile-primary"
          style={styles.lifecycleButton}
          disabled={isSaving}
          onClick={onStart}
        >
          {isHold ? "Resume Route" : "Start Route"}
        </button>
      )}

      {isActive && (
        <button
          type="button"
          style={styles.holdButton}
          disabled={isSaving}
          onClick={onHold}
        >
          Put On-Hold
        </button>
      )}

      {(isActive || isHold) && (
        <button
          type="button"
          style={styles.endButton}
          disabled={isSaving}
          onClick={onEnd}
        >
          End Route
        </button>
      )}

      {isDone && (
        <button type="button" style={styles.doneButton} disabled>
          Route Completed
        </button>
      )}

      <button type="button" className="bd-mobile-secondary" style={styles.lifecycleButton} onClick={onNavigate}>
        Navigate
      </button>
    </div>
  );
}

function RouteMapCard({ row, taskRows = [], latestIssue }) {
  const [baseLayer, setBaseLayer] = useState("street");
  const [measureMode, setMeasureMode] = useState(false);
  const [measurePoints, setMeasurePoints] = useState([]);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [locationFocusKey, setLocationFocusKey] = useState(0);
  const [fitTaskKey, setFitTaskKey] = useState(0);
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState("");
  const [locationPermissionDenied, setLocationPermissionDenied] = useState(false);
  const [remoteRouteGeojsons, setRemoteRouteGeojsons] = useState([]);
  const [remoteRouteLoading, setRemoteRouteLoading] = useState(false);

  const mapRows = useMemo(() => (taskRows.length ? taskRows : [row].filter(Boolean)), [row, taskRows]);
  const gridFeatures = useMemo(
    () => mapRows.map((item) => buildGridFeature(item.grid)).filter(Boolean),
    [mapRows]
  );
  const localRouteGeojsons = useMemo(
    () => mapRows.map((item) => parseRouteGeojson(item.route)).filter(Boolean),
    [mapRows]
  );
  const routeUrls = useMemo(
    () => Array.from(new Set(mapRows.flatMap((item) => getRouteGeometryUrls(item.route)))),
    [mapRows]
  );
  const routeUrlKey = routeUrls.join("|");
  const localRoutePointTotal = useMemo(
    () => localRouteGeojsons.reduce((total, geojson) => total + getRoutePointCount(geojson), 0),
    [localRouteGeojsons]
  );

  useEffect(() => {
    let cancelled = false;
    setRemoteRouteGeojsons([]);

    if (localRoutePointTotal > 1 || routeUrls.length === 0) {
      setRemoteRouteLoading(false);
      return undefined;
    }

    async function loadRemoteRouteGeometry() {
      setRemoteRouteLoading(true);
      const collected = [];

      for (const url of routeUrls) {
        try {
          const response = await fetch(url);
          if (!response.ok) continue;
          const text = await response.text();
          const parsed = parseRouteGeojson(text);
          if (parsed) collected.push(parsed);
        } catch (error) {
          console.warn("Mobile route map could not load saved route file:", error?.message || error);
        }
      }

      if (!cancelled) {
        setRemoteRouteGeojsons(collected);
        setRemoteRouteLoading(false);
      }
    }

    loadRemoteRouteGeometry();
    return () => {
      cancelled = true;
    };
  }, [localRoutePointTotal, routeUrlKey]);

  const routeGeojsons = useMemo(
    () => [...localRouteGeojsons, ...remoteRouteGeojsons].filter(Boolean),
    [localRouteGeojsons, remoteRouteGeojsons]
  );
  const combinedRouteGeojson = useMemo(() => combineFeatureCollections(routeGeojsons), [routeGeojsons]);
  const gpsPoints = useMemo(
    () => buildTrailPoints(row.task, combinedRouteGeojson),
    [row.task, combinedRouteGeojson]
  );
  const routePointCount = useMemo(
    () => routeGeojsons.reduce((total, geojson) => total + getRoutePointCount(geojson), 0),
    [routeGeojsons]
  );
  const offRouteCount = gpsPoints.filter((point) => point.offRoute).length;
  const routeLengthLabel = formatDistance(
    getRouteDistanceMeters(row.route) || getRouteGeojsonDistanceMeters(routeGeojsons)
  );
  const lastTrailPoint = gpsPoints[gpsPoints.length - 1] || null;
  const measureDistanceLabel = formatDistance(getLatLngDistanceMeters(measurePoints));
  const layer = BASE_LAYERS[baseLayer] || BASE_LAYERS.street;

  function addMeasurePoint(point) {
    setMeasurePoints((prev) => [...prev, point]);
  }

  async function locateMe(mapInstance = null) {
    setLocationMessage("");
    setLocationPermissionDenied(false);
    setLocating(true);

    const fallbackLocation = getBestFallbackLocation(row, lastTrailPoint, gridFeatures);

    const centerMap = (nextLocation, sourceLabel = "GPS") => {
      if (!nextLocation || !isValidLatLng(nextLocation)) return;

      setCurrentLocation(nextLocation);
      setLocationPermissionDenied(false);

      const targetMap = mapInstance;
      if (targetMap) {
        window.setTimeout(() => {
          targetMap.invalidateSize(true);
          targetMap.stop();
          targetMap.setView([nextLocation.lat, nextLocation.lng], 18, { animate: true });
        }, 80);
      } else {
        setLocationFocusKey((value) => value + 1);
      }

      const accuracyText = Number.isFinite(Number(nextLocation.accuracy))
        ? ` • ±${Math.round(Number(nextLocation.accuracy))}m`
        : "";
      setLocationMessage(`${sourceLabel} centered${accuracyText}.`);
    };

    const useFallback = (message, permissionDenied = false) => {
      if (permissionDenied) setLocationPermissionDenied(true);

      if (fallbackLocation) {
        centerMap(fallbackLocation, "Last saved GPS");
        if (permissionDenied) setLocationPermissionDenied(true);
        setLocationMessage(`${message} Showing last saved FE GPS instead.`);
      } else {
        setLocationMessage(message);
      }
      setLocating(false);
    };

    const permissionMessage = getGpsPermissionMessage();

    try {
      const capacitorGeo = window?.Capacitor?.Plugins?.Geolocation;
      if (capacitorGeo?.getCurrentPosition) {
        const permissionStatus = await ensureCapacitorGpsPermission(capacitorGeo);

        if (permissionStatus.denied) {
          useFallback(permissionMessage, true);
          return;
        }

        const position = await capacitorGeo.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 0,
        });

        centerMap({
          lat: Number(position.coords.latitude),
          lng: Number(position.coords.longitude),
          accuracy: Number(position.coords.accuracy),
        });
        setLocating(false);
        return;
      }
    } catch (error) {
      if (isGpsPermissionDeniedError(error)) {
        useFallback(permissionMessage, true);
        return;
      }

      console.warn("Capacitor GPS lookup failed:", error?.message || error);
    }

    if (!navigator.geolocation) {
      useFallback("Current GPS is not available on this device.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        centerMap({
          lat: Number(position.coords.latitude),
          lng: Number(position.coords.longitude),
          accuracy: Number(position.coords.accuracy),
        });
        setLocating(false);
      },
      (error) => {
        const isDenied = error?.code === 1 || isGpsPermissionDeniedError(error);
        const message = isDenied
          ? permissionMessage
          : error?.message || "Unable to get current location.";
        useFallback(message, isDenied);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  }

  return (
    <div style={styles.mapCard}>
      <div style={styles.mapHeader}>
        <div>
          <p style={styles.mapEyebrow}>Map</p>
          <h4 style={styles.mapTitle}>{row.gridLabel}</h4>
        </div>
        <span style={row.route ? styles.readyMini : styles.warnMini}>
          {row.route ? routePointCount > 1 ? "Route Shown" : "Route Linked" : "Grid Only"}
        </span>
      </div>

      <div style={styles.mapToolbar}>
        {Object.entries(BASE_LAYERS).map(([key, item]) => (
          <button
            key={key}
            type="button"
            style={{
              ...styles.mapToolButton,
              ...(baseLayer === key ? styles.mapToolButtonActive : null),
            }}
            onClick={() => setBaseLayer(key)}
          >
            {item.label}
          </button>
        ))}
        <button type="button" style={styles.mapToolButton} onClick={() => setFitTaskKey((value) => value + 1)}>
          Fit Task
        </button>
        <button
          type="button"
          style={{ ...styles.mapToolButton, ...(measureMode ? styles.mapToolButtonActive : null) }}
          onClick={() => setMeasureMode((value) => !value)}
        >
          Ruler
        </button>
        {(measureMode || measurePoints.length > 0) && (
          <button type="button" style={styles.mapToolButtonDanger} onClick={() => setMeasurePoints([])}>
            Clear Ruler
          </button>
        )}
      </div>

      <div style={styles.mapBox}>
        <MapContainer
            center={DEFAULT_CENTER}
            zoom={DEFAULT_ZOOM}
            style={styles.map}
            scrollWheelZoom
            attributionControl={false}
            className={measureMode ? "bd-mobile-route-map bd-route-measure-mode" : "bd-mobile-route-map"}
          >
          <TileLayer attribution="" url={layer.url} />

          <MapBoundsController
            gridFeatures={gridFeatures}
            routeGeojsons={routeGeojsons}
            gpsPoints={gpsPoints}
            fitKey={fitTaskKey}
          />
          <MapMeasureTapCapture active={measureMode} onAddPoint={addMeasurePoint} />
          <CurrentLocationController location={currentLocation} focusKey={locationFocusKey} />
          <MapActionControls
            locating={locating}
            permissionDenied={locationPermissionDenied}
            onLocate={(mapInstance) => locateMe(mapInstance)}
            onFit={() => setFitTaskKey((value) => value + 1)}
          />

          <CellSectorLayer
            market={row.marketLabel === "Unknown Market" ? "" : row.marketLabel}
            showSites
            showSectors
            showLegend={false}
            maxRecords={1200}
            sectorRadiusM={550}
          />

          {gridFeatures.map((feature, index) => (
            <GeoJSON
              key={`route-grid-${row.id}-${index}`}
              data={feature}
              interactive={!measureMode}
              style={() => ({
                color: "#facc15",
                weight: 4,
                fillColor: "#facc15",
                fillOpacity: 0.16,
              })}
            >
              <Popup>
                <strong>{feature.properties?.name || row.gridLabel}</strong>
                <br />
                <span>{feature.properties?.market || row.marketLabel}</span>
              </Popup>
            </GeoJSON>
          ))}

          {routeGeojsons.map((geojson, index) => (
            <RouteLineLayer key={`route-line-${row.id}-${index}`} geojson={geojson} interactive={!measureMode} />
          ))}
          {gpsPoints.length > 1 && <GpsTrailLayer points={gpsPoints} />}

          {measurePoints.length > 1 && (
            <Polyline
              positions={measurePoints.map((point) => [point.lat, point.lng])}
              pathOptions={{ color: "#a78bfa", weight: 4, opacity: 0.95, dashArray: "8 8" }}
            />
          )}

          {measurePoints.map((point, index) => (
            <CircleMarker
              key={`measure-${index}-${point.lat}-${point.lng}`}
              center={[point.lat, point.lng]}
              radius={5}
              pathOptions={{ color: "#a78bfa", fillColor: "#a78bfa", fillOpacity: 0.95, weight: 2 }}
            >
              <Popup>
                <strong>Ruler point {index + 1}</strong>
              </Popup>
            </CircleMarker>
          ))}

          {currentLocation && (
            <CircleMarker
              center={[currentLocation.lat, currentLocation.lng]}
              radius={8}
              pathOptions={{ color: "#ffffff", fillColor: "#2563eb", fillOpacity: 0.95, weight: 3 }}
            >
              <Popup>
                <strong>Your current location</strong>
                <br />
                Accuracy: {Number.isFinite(currentLocation.accuracy) ? `${Math.round(currentLocation.accuracy)}m` : "N/A"}
              </Popup>
            </CircleMarker>
          )}

          {lastTrailPoint && (
            <CircleMarker
              center={[lastTrailPoint.lat, lastTrailPoint.lng]}
              radius={7}
              pathOptions={{ color: "#38bdf8", fillColor: "#38bdf8", fillOpacity: 0.95, weight: 2 }}
            >
              <Popup>
                <strong>Last FE GPS</strong>
                <br />
                {formatDateTime(lastTrailPoint.created_at)}
              </Popup>
            </CircleMarker>
          )}
        </MapContainer>

        {(measureMode || measurePoints.length > 0) && (
          <div style={styles.rulerPanel}>
            <span>Ruler: {measureDistanceLabel}</span>
            <button type="button" style={styles.rulerClearButton} onClick={() => setMeasurePoints([])}>
              Clear
            </button>
          </div>
        )}

        {measureMode && (
          <div style={styles.measureOverlay}>
            Ruler is ON. Tap anywhere on the map • {measurePoints.length} point{measurePoints.length === 1 ? "" : "s"}
          </div>
        )}
      </div>

      <div style={styles.mapAttribution}>
        Map tiles © OpenStreetMap / Esri
      </div>

      {(locationMessage || remoteRouteLoading) && (
        <p style={styles.mapSystemNote}>
          {remoteRouteLoading ? "Loading saved route line from route file..." : locationMessage}
        </p>
      )}

      {locationPermissionDenied && (
        <div style={styles.locationPermissionPanel}>
          <strong>Location permission needed</strong>
          <span>Allow Location for BabyDragon so My GPS, live task tracking, and route checkpoints can work.</span>
          <small>{GPS_PERMISSION_ANDROID_STEPS}</small>
        </div>
      )}

      <div style={styles.mapFacts}>
        <MapFact label="Route" value={routePointCount} />
        <MapFact label="GPS" value={gpsPoints.length} />
        <MapFact label="Off" value={offRouteCount} warn={offRouteCount > 0} />
        <MapFact label="Miles" value={routeLengthLabel} />
      </div>

      <p style={styles.mapNote}>
        {routeGeojsons.length
          ? "Saved route is shown as a clean blue road line. Green trail means driven near the route. Orange means off-route movement."
          : row.route
            ? "Saved route record is linked, but route geometry/file was not found yet. Tap Refresh once; if still missing, Admin should re-save this route so mobile geometry is stored."
            : "Grid is shown, but no saved route is linked to this grid yet. Navigation will use the grid center until Admin saves or links a route."}
        {latestIssue ? ` Latest issue: ${latestIssue.description || formatIssueType(latestIssue.issue_type)}` : ""}
      </p>
    </div>
  );
}

function InfoItem({ label, value, tone = "neutral" }) {
  const toneStyle = tone === "green" ? styles.infoGreen : tone === "amber" ? styles.infoAmber : tone === "blue" ? styles.infoBlue : null;
  const shouldUseFullRow = ["Grid", "Route"].includes(label);

  return (
    <span
      style={{
        ...styles.infoItem,
        ...(shouldUseFullRow ? styles.infoItemFullRow : null),
        ...(toneStyle || null),
      }}
    >
      <small>{label}</small>
      <strong style={styles.infoValue}>{value || "N/A"}</strong>
    </span>
  );
}

function MapFact({ label, value, warn = false }) {
  return (
    <span style={{ ...styles.mapFact, ...(warn ? styles.mapFactWarn : null) }}>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

function MapBoundsController({ gridFeatures = [], routeGeojsons = [], gpsPoints = [], fitKey = 0 }) {
  const map = useMap();

  useEffect(() => {
    const bounds = L.latLngBounds([]);

    try {
      (gridFeatures || []).forEach((gridFeature) => {
        const layer = L.geoJSON(gridFeature);
        const gridBounds = layer.getBounds();
        if (gridBounds.isValid()) bounds.extend(gridBounds);
      });

      (routeGeojsons || []).forEach((routeGeojson) => {
        const layer = L.geoJSON(routeGeojson);
        const routeBounds = layer.getBounds();
        if (routeBounds.isValid()) bounds.extend(routeBounds);
      });

      (gpsPoints || []).forEach((point) => {
        if (isValidLatLng(point)) bounds.extend([point.lat, point.lng]);
      });

      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [34, 34], maxZoom: 17 });
      }
    } catch (error) {
      console.warn("Unable to fit mobile route map bounds:", error);
    }
  }, [fitKey, gridFeatures, gpsPoints, map, routeGeojsons]);

  return null;
}

function CurrentLocationController({ location, focusKey = 0 }) {
  const map = useMap();

  useEffect(() => {
    if (!focusKey || !isValidLatLng(location)) return undefined;

    const timer = window.setTimeout(() => {
      map.invalidateSize(true);
      map.stop();
      map.setView([location.lat, location.lng], 18, { animate: true });
    }, 120);

    return () => window.clearTimeout(timer);
  }, [focusKey, location, map]);

  return null;
}

function MapMeasureTapCapture({ active, onAddPoint }) {
  const map = useMap();

  useEffect(() => {
    if (!active) return undefined;

    const container = map.getContainer();
    let startPoint = null;
    let lastTapAt = 0;

    const shouldIgnoreTarget = (target) => {
      if (!target?.closest) return false;
      return Boolean(
        target.closest(
          ".leaflet-control, .bd-leaflet-action-control, button, a, input, select, textarea, label"
        )
      );
    };

    const getClientPoint = (event) => {
      const touch = event.changedTouches?.[0] || event.touches?.[0] || null;
      const clientX = touch ? touch.clientX : event.clientX;
      const clientY = touch ? touch.clientY : event.clientY;

      if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
      return { clientX, clientY };
    };

    const addPointFromEvent = (event) => {
      if (shouldIgnoreTarget(event.target)) return;

      const now = Date.now();
      if (now - lastTapAt < 250) return;

      const point = getClientPoint(event);
      if (!point) return;

      const rect = container.getBoundingClientRect();
      const containerPoint = L.point(point.clientX - rect.left, point.clientY - rect.top);
      const latlng = map.containerPointToLatLng(containerPoint);

      if (!latlng) return;

      lastTapAt = now;
      event.preventDefault?.();
      event.stopPropagation?.();
      event.stopImmediatePropagation?.();

      onAddPoint({ lat: latlng.lat, lng: latlng.lng });
    };

    const handlePointerDown = (event) => {
      if (shouldIgnoreTarget(event.target)) return;
      startPoint = getClientPoint(event);
    };

    const handlePointerUp = (event) => {
      if (shouldIgnoreTarget(event.target)) return;

      const endPoint = getClientPoint(event);
      if (!startPoint || !endPoint) {
        addPointFromEvent(event);
        return;
      }

      const movedPx = Math.hypot(endPoint.clientX - startPoint.clientX, endPoint.clientY - startPoint.clientY);
      startPoint = null;

      // Treat small movement as a tap. This prevents accidental ruler points while panning.
      if (movedPx > 12) return;

      addPointFromEvent(event);
    };

    const handleClickCapture = (event) => {
      // Fallback for older WebViews that do not reliably emit pointer events.
      addPointFromEvent(event);
    };

    // Capture phase is important. Cell sectors, grid polygons, and popups can swallow normal Leaflet clicks.
    // This listens on the raw map container before overlay layers receive the event.
    container.addEventListener("pointerdown", handlePointerDown, true);
    container.addEventListener("pointerup", handlePointerUp, true);
    container.addEventListener("click", handleClickCapture, true);

    return () => {
      container.removeEventListener("pointerdown", handlePointerDown, true);
      container.removeEventListener("pointerup", handlePointerUp, true);
      container.removeEventListener("click", handleClickCapture, true);
    };
  }, [active, map, onAddPoint]);

  return null;
}

function getGpsPermissionMessage() {
  return `${GPS_PERMISSION_REQUIRED_MESSAGE} ${GPS_PERMISSION_ANDROID_STEPS}`;
}

function isGpsPermissionDeniedError(error) {
  const text = [error?.message, error?.name, error?.code]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    error?.code === 1 ||
    error?.name === "NotAllowedError" ||
    text.includes("permission") ||
    text.includes("denied") ||
    text.includes("not granted") ||
    text.includes("user denied")
  );
}

async function ensureCapacitorGpsPermission(capacitorGeo) {
  if (!capacitorGeo?.checkPermissions) return { denied: false };

  try {
    const checked = await capacitorGeo.checkPermissions();
    const checkedStatus = normalizeCapacitorPermissionStatus(checked);

    if (checkedStatus === "granted") return { denied: false };

    if (!capacitorGeo.requestPermissions) {
      return { denied: checkedStatus === "denied" };
    }

    const requested = await capacitorGeo.requestPermissions({ permissions: ["location"] });
    const requestedStatus = normalizeCapacitorPermissionStatus(requested);

    return { denied: requestedStatus !== "granted" };
  } catch (error) {
    return { denied: isGpsPermissionDeniedError(error) };
  }
}

function normalizeCapacitorPermissionStatus(permissionResult = {}) {
  const status =
    permissionResult.location ||
    permissionResult.coarseLocation ||
    permissionResult.fineLocation ||
    permissionResult.locationAlways ||
    "";

  return String(status).toLowerCase();
}

function MapActionControls({ locating, permissionDenied = false, onLocate, onFit }) {
  const map = useMap();

  useEffect(() => {
    const control = L.control({ position: "topright" });

    control.onAdd = () => {
      const container = L.DomUtil.create("div", "bd-leaflet-action-control");
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      const locateButton = L.DomUtil.create("button", "bd-leaflet-action-btn", container);
      locateButton.type = "button";
      locateButton.title = "Find my GPS location";
      locateButton.setAttribute("aria-label", "Find my GPS location");
      locateButton.innerHTML = locating ? "…" : permissionDenied ? "Allow GPS" : "GPS";
      locateButton.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        onLocate?.(map);
      };

      const fitButton = L.DomUtil.create("button", "bd-leaflet-action-btn", container);
      fitButton.type = "button";
      fitButton.title = "Fit task map";
      fitButton.setAttribute("aria-label", "Fit task map");
      fitButton.innerHTML = "Fit";
      fitButton.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        onFit?.();
      };

      return container;
    };

    control.addTo(map);

    return () => {
      control.remove();
    };
  }, [locating, map, onFit, onLocate, permissionDenied]);

  return null;
}

function RouteLineLayer({ geojson, interactive = true }) {
  const map = useMap();

  useEffect(() => {
    if (!geojson) return undefined;

    const shadowLayer = L.geoJSON(geojson, {
      interactive,
      style: {
        color: "#0f172a",
        weight: 7,
        opacity: 0.95,
        lineCap: "round",
        lineJoin: "round",
      },
      pointToLayer: (_feature, latlng) =>
        L.circleMarker(latlng, {
          radius: 5,
          color: "#082f49",
          fillColor: "#082f49",
          fillOpacity: 0.95,
        }),
    }).addTo(map);

    const routeLayer = L.geoJSON(geojson, {
      interactive,
      style: {
        color: "#2563eb",
        weight: 4,
        opacity: 1,
        lineCap: "round",
        lineJoin: "round",
      },
      pointToLayer: (_feature, latlng) =>
        L.circleMarker(latlng, {
          radius: 4,
          color: "#2563eb",
          fillColor: "#2563eb",
          fillOpacity: 1,
        }),
    }).addTo(map);

    shadowLayer.bringToFront();
    routeLayer.bringToFront();

    return () => {
      map.removeLayer(shadowLayer);
      map.removeLayer(routeLayer);
    };
  }, [geojson, interactive, map]);

  return null;
}

function GpsTrailLayer({ points }) {
  const segments = [];

  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];

    if (!isValidLatLng(from) || !isValidLatLng(to)) continue;

    segments.push({
      key: `${index}-${from.lat}-${from.lng}`,
      path: [
        [from.lat, from.lng],
        [to.lat, to.lng],
      ],
      offRoute: Boolean(to.offRoute || from.offRoute),
    });
  }

  return (
    <>
      {segments.map((segment) => (
        <Polyline
          key={segment.key}
          positions={segment.path}
          pathOptions={{
            color: segment.offRoute ? "#f97316" : "#22c55e",
            weight: segment.offRoute ? 5 : 6,
            opacity: 0.95,
          }}
        />
      ))}
    </>
  );
}

function buildRouteLookupKeys(baseGridIds, gridData = [], assignedTasks = []) {
  const values = [
    ...(baseGridIds || []),
    ...(gridData || []).flatMap((grid) => getGridKeys(grid)),
    ...(assignedTasks || []).flatMap((task) => [
      task?.grid_id,
      task?.gridId,
      task?.grid_db_id,
      task?.grid_name,
      task?.target_name,
      task?.target,
      task?.reference,
      task?._mobileGrid?.id,
      task?._mobileGrid?.grid_id,
      task?._mobileGrid?.grid_code,
      task?._mobileGrid?.name,
      task?._mobileRoute?.grid_id,
      task?._mobileRoute?.grid_name,
      task?._mobileRoute?.grid_code,
      task?._mobileRoute?.target_name,
    ]),
  ];

  return Array.from(
    new Set(
      values
        .filter((value) => value !== null && value !== undefined && String(value).trim() !== "")
        .map((value) => String(value).trim())
    )
  );
}

async function loadAssignedGrids(gridIds) {
  if (!gridIds.length) return [];

  try {
    const { data, error } = await supabase.rpc("get_grids_geojson");
    if (error) throw error;

    return (data || [])
      .filter((grid) => gridIds.some((gridId) => String(gridId) === String(grid.id)))
      .map((grid) => ({ ...grid, geometry: normalizeGeometry(grid.geometry) }));
  } catch (rpcError) {
    console.warn("get_grids_geojson unavailable for mobile route view:", rpcError);
  }

  const { data, error } = await supabase.from("grids").select("*").in("id", gridIds);
  if (error) throw error;

  return (data || []).map((grid) => ({ ...grid, geometry: normalizeGeometry(grid.geometry) }));
}

async function loadRouteGridRows(gridKeys) {
  if (!gridKeys.length) return [];

  const collected = [];
  const uniqueKeys = Array.from(new Set(gridKeys.filter(Boolean).map(String)));

  for (const key of uniqueKeys) {
    try {
      const { data, error } = await supabase
        .from("route_grids")
        .select("*")
        .eq("grid_id", key);

      if (!error && Array.isArray(data)) collected.push(...data);
    } catch (error) {
      console.warn("route_grids lookup skipped:", key, error);
    }
  }

  return mergeById(collected);
}

async function loadRoutesFromTable(tableName, gridKeys) {
  if (!gridKeys.length) return [];

  const candidates = ["grid_id", "grid_db_id", "route_grid_id", "grid_name", "grid_code", "target_name"];
  const collected = [];
  const uniqueKeys = Array.from(new Set(gridKeys.filter(Boolean).map(String)));

  for (const column of candidates) {
    for (const key of uniqueKeys) {
      try {
        const { data, error } = await supabase
          .from(tableName)
          .select("*")
          .eq(column, key)
          .limit(50);

        if (!error && Array.isArray(data)) collected.push(...data);
      } catch (error) {
        console.warn(`Route lookup skipped for ${tableName}.${column}=${key}:`, error);
      }
    }
  }

  return mergeById(collected).sort(compareNewestRoute);
}

async function loadRoutesByIds(tableName, routeIds) {
  if (!routeIds.length) return [];

  const { data, error } = await supabase
    .from(tableName)
    .select("*")
    .in("id", routeIds)
    .order("created_at", { ascending: false });

  if (error) {
    console.warn(`Linked route lookup failed for ${tableName}:`, error);
    return [];
  }

  return Array.isArray(data) ? data : [];
}

async function loadLooseMatchedRoutes(gridKeys = [], gridData = [], assignedTasks = []) {
  const matchKeys = buildLooseRouteMatchKeys(gridKeys, gridData, assignedTasks);
  if (!matchKeys.length) return [];

  const collected = [];

  for (const tableName of ["routes", "saved_routes"]) {
    try {
      const { data, error } = await supabase
        .from(tableName)
        .select("*")
        .limit(350);

      if (error) {
        console.warn(`Loose route scan skipped for ${tableName}:`, error);
        continue;
      }

      const matched = (Array.isArray(data) ? data : []).filter((route) =>
        doesRouteLooselyMatchKeys(route, matchKeys)
      );
      collected.push(...matched);
    } catch (error) {
      console.warn(`Loose route scan failed for ${tableName}:`, error);
    }
  }

  return mergeById(collected).sort(compareNewestRoute);
}

function buildLooseRouteMatchKeys(gridKeys = [], gridData = [], assignedTasks = []) {
  const rawValues = [
    ...(gridKeys || []),
    ...(gridData || []).flatMap((grid) => [
      grid?.id,
      grid?.grid_id,
      grid?.grid_code,
      grid?.grid_name,
      grid?.name,
      getGridLabel(grid),
    ]),
    ...(assignedTasks || []).flatMap((task) => [
      task?.grid_id,
      task?.gridId,
      task?.grid_db_id,
      task?.grid_name,
      task?.target_name,
      task?.target,
      task?.reference,
      task?._mobileGrid?.id,
      task?._mobileGrid?.grid_id,
      task?._mobileGrid?.grid_code,
      task?._mobileGrid?.grid_name,
      task?._mobileGrid?.name,
      task?._mobileRoute?.grid_id,
      task?._mobileRoute?.grid_name,
      task?._mobileRoute?.grid_code,
      task?._mobileRoute?.route_name,
      task?._mobileRoute?.name,
    ]),
  ];

  return Array.from(
    new Set(
      rawValues
        .flatMap((value) => makeLooseRouteKeyVariants(value))
        .filter((value) => value.length >= 5)
    )
  );
}

function doesRouteLooselyMatchKeys(route, matchKeys = []) {
  if (!route || !matchKeys.length) return false;

  const routeText = [
    route.id,
    route.route_id,
    route.grid_id,
    route.gridId,
    route.grid_db_id,
    route.route_grid_id,
    route.grid_name,
    route.grid_code,
    route.target_name,
    route.route_name,
    route.name,
    route.label,
    route.filename,
    route.file_name,
  ]
    .filter(Boolean)
    .flatMap((value) => makeLooseRouteKeyVariants(value));

  const routeKeyText = Array.from(new Set(routeText)).join("|");
  if (!routeKeyText) return false;

  return matchKeys.some((key) => routeKeyText.includes(key) || key.includes(routeKeyText));
}

function makeLooseRouteKeyVariants(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];

  const base = normalizeLooseRouteKey(raw);
  const withoutEdited = normalizeLooseRouteKey(raw.replace(/(?:^|[_\-\s])(edited?|copy|final|draft|route|dense|hybrid|highway|main|street|streets)(?=$|[_\-\s])/gi, "_"));
  const withoutExtension = normalizeLooseRouteKey(raw.replace(/\.(kml|kmz|json|geojson|zip)$/gi, ""));
  const gCode = raw.match(/[a-z]*[_\-\s]*g[_\-\s]*\d+/i)?.[0] || "";
  const digitCode = raw.match(/\d{5,}/)?.[0] || "";

  return Array.from(
    new Set(
      [base, withoutEdited, withoutExtension, normalizeLooseRouteKey(gCode), normalizeLooseRouteKey(digitCode)]
        .filter(Boolean)
    )
  );
}

function normalizeLooseRouteKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\.(kml|kmz|json|geojson|zip)$/g, "")
    .replace(/edited?|copy|final|draft|saved|route|dense|hybrid|highway|main|street|streets/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function mergeById(records) {
  const map = new Map();

  records.filter(Boolean).forEach((record, index) => {
    const key = String(record.id || record.route_id || record.route_name || record.name || `route-${index}`);
    const existing = map.get(key);

    if (!existing) {
      map.set(key, record);
      return;
    }

    // Merge duplicates instead of dropping the later record.
    // This protects the mobile app when one query returns metadata only
    // and another query returns the real route_geojson geometry.
    const existingHasGeometry = hasUsableRouteGeometry(existing);
    const nextHasGeometry = hasUsableRouteGeometry(record);
    const merged = nextHasGeometry && !existingHasGeometry
      ? { ...existing, ...record }
      : { ...record, ...existing };

    map.set(key, merged);
  });

  return Array.from(map.values());
}

function buildRouteRows({ assignedTasks, taskGridRows, grids, routes, routeGridRows }) {
  const gridMap = new Map();
  grids.forEach((grid) => {
    gridMap.set(String(grid.id), grid);
    if (grid.grid_id) gridMap.set(String(grid.grid_id), grid);
    if (grid.grid_code) gridMap.set(String(grid.grid_code), grid);
    if (grid.name) gridMap.set(String(grid.name), grid);
  });

  const rows = [];

  assignedTasks.forEach((task, taskIndex) => {
    const linkedTaskGrids = taskGridRows.filter((item) => String(item.task_id) === String(task.id));
    const rowGrids = [];

    linkedTaskGrids.forEach((link) => {
      const grid = gridMap.get(String(link.grid_id));
      if (grid) rowGrids.push(grid);
    });

    if (rowGrids.length === 0 && task._mobileGrid) rowGrids.push(task._mobileGrid);
    if (rowGrids.length === 0 && task.grid_id) {
      rowGrids.push({
        id: task.grid_id,
        grid_id: task.grid_id,
        name: task.grid_name || task.target_name || task.target,
        market: task.market,
      });
    }
    if (rowGrids.length === 0) rowGrids.push(null);

    rowGrids.forEach((grid, gridIndex) => {
      const route = findBestRouteForGrid(grid, routes, routeGridRows) || task._mobileRoute || null;
      const rowId = `${task.id}-${getGridUniqueId(grid) || gridIndex || taskIndex}`;

      rows.push({
        id: rowId,
        task,
        grid,
        route,
        taskName: getTaskName(task, grid),
        gridLabel: getGridLabel(grid, task),
        marketLabel: getMarketLabel(grid, task),
        projectLabel: getProjectLabel(task),
        routeLabel: getRouteLabel(route, grid, task),
        routeMode: getRouteMode(route),
        dueLabel: formatDate(task.due_date || task.due || task.deadline),
      });
    });
  });

  return rows.sort((a, b) => {
    const aStatusScore = getRoutePriorityScore(a.task?.status, a.route);
    const bStatusScore = getRoutePriorityScore(b.task?.status, b.route);
    if (aStatusScore !== bStatusScore) return aStatusScore - bStatusScore;
    return a.gridLabel.localeCompare(b.gridLabel);
  });
}

function getUniqueTaskRows(rows) {
  const seen = new Set();
  const output = [];

  rows.forEach((row) => {
    const key = String(row.task?.id || row.id);
    if (seen.has(key)) return;
    seen.add(key);
    output.push(row);
  });

  return output;
}

function getRoutePriorityScore(status, route) {
  if (isInProcessStatus(status)) return 0;
  if (isOnHoldStatus(status)) return 1;
  if (route) return 2;
  return 3;
}

function findBestRouteForGrid(grid, routes, routeGridRows) {
  if (!grid || !Array.isArray(routes)) return null;

  const gridKeys = getGridKeys(grid);
  const normalizedGridKeys = gridKeys.map(normalizeKey);
  const gridLabel = normalizeKey(getGridLabel(grid));

  const linkedRouteIds = routeGridRows
    .filter((link) => gridKeys.some((key) => String(key) === String(link.grid_id)))
    .map((link) => String(link.route_id));

  const candidates = routes
    .filter((route) => {
      if (linkedRouteIds.includes(String(route.id))) return true;

      const routeKeys = [
        route.grid_id,
        route.gridId,
        route.grid_db_id,
        route.grid_name,
        route.grid_code,
        route.target_name,
        route.route_grid_id,
      ]
        .filter(Boolean)
        .map(normalizeKey);

      if (routeKeys.some((routeKey) => normalizedGridKeys.includes(routeKey))) return true;

      const routeName = normalizeKey(route.route_name || route.name || "");
      return Boolean(gridLabel && routeName.includes(gridLabel));
    })
    .map((route) => ({
      route,
      score: getRouteMatchScore(route, normalizedGridKeys, gridLabel, linkedRouteIds),
    }))
    .sort((a, b) => b.score - a.score || compareNewestRoute(a.route, b.route));

  return candidates[0]?.route || null;
}

function getRouteMatchScore(route, normalizedGridKeys, gridLabel, linkedRouteIds) {
  let score = 0;
  if (linkedRouteIds.includes(String(route.id))) score += 100;

  const directKeys = [
    route.grid_id,
    route.gridId,
    route.grid_db_id,
    route.grid_name,
    route.grid_code,
    route.target_name,
    route.route_grid_id,
  ]
    .filter(Boolean)
    .map(normalizeKey);

  if (directKeys.some((key) => normalizedGridKeys.includes(key))) score += 80;

  const routeName = normalizeKey(route.route_name || route.name || "");
  if (gridLabel && routeName.includes(gridLabel)) score += 40;

  // Prefer the real generated route geometry over metadata-only records.
  // This fixes the mobile route switching from the true generated line to
  // a linked-but-empty route record after background refresh.
  if (hasUsableRouteGeometry(route)) score += 220;
  if (route.route_geojson || route.routeGeojson) score += 40;

  return score;
}

function hasUsableRouteGeometry(route) {
  return getRoutePointCount(parseRouteGeojson(route)) > 1;
}

function looksLikeGeojsonObject(value) {
  const parsed = parseJsonish(value) || value;
  if (!parsed || typeof parsed !== "object") return false;
  if (parsed.type === "FeatureCollection" || parsed.type === "Feature") return true;
  if (parsed.type && parsed.coordinates) return true;
  if (Array.isArray(parsed)) return true;
  return false;
}

function compareNewestRoute(a, b) {
  const aTime = getTime(a?.generated_at || a?.created_at || a?.updated_at);
  const bTime = getTime(b?.generated_at || b?.created_at || b?.updated_at);
  return bTime - aTime;
}

function getTime(value) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function getGridKeys(grid) {
  return [
    grid?.id,
    grid?.grid_id,
    grid?.gridId,
    grid?.grid_db_id,
    grid?.grid_name,
    grid?.grid_code,
    grid?.name,
    grid?.target_name,
    grid?.label,
    grid?.number,
  ].filter(Boolean);
}

function getGridUniqueId(grid) {
  return grid?.id || grid?.grid_id || grid?.gridId || grid?.grid_code || grid?.name || "";
}

function getTaskName(task = {}, grid = null) {
  const project = getProjectLabel(task);
  const target = getGridLabel(grid, task);

  if (project && target && project !== "Assigned Task") return `${project} • ${target}`;

  return (
    task.task_name ||
    task.name ||
    task.title ||
    task.target_name ||
    task.scope ||
    target ||
    "Assigned Route"
  );
}

function getGridLabel(grid, task = {}) {
  return (
    grid?.grid_name ||
    grid?.grid_id ||
    grid?.grid_code ||
    grid?.name ||
    task.grid_name ||
    task.target_name ||
    task.target ||
    task.reference ||
    "Assigned Grid"
  );
}

function getMarketLabel(grid, task = {}) {
  return (
    grid?.market ||
    grid?.market_name ||
    task.market ||
    task.project_market ||
    task.projects?.market ||
    "Unknown Market"
  );
}

function getProjectLabel(task = {}) {
  return task.projects?.name || task.project_name || task.project || task.task_name || task.name || "Assigned Task";
}

function getRouteLabel(route, grid, task) {
  if (!route) return "Grid navigation only";
  return route.route_name || route.name || getGridLabel(grid, task) || "Saved Route";
}

function getRouteMode(route) {
  const value = route?.route_mode || route?.mode || route?.route_type || "N/A";
  return String(value).replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeStatus(value) {
  return String(value || "assigned").trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
}

function isAssignedStatus(status) {
  return ["assigned", "pending", "new"].includes(normalizeStatus(status));
}

function isInProcessStatus(status) {
  return ["in_progress", "in-process", "in process"].includes(String(status || "").toLowerCase()) || normalizeStatus(status) === "in_progress";
}

function isOnHoldStatus(status) {
  return ["on_hold", "hold", "onhold", "on-hold"].includes(normalizeStatus(status));
}

function isActiveRouteStatus(status) {
  return isAssignedStatus(status) || isInProcessStatus(status) || isOnHoldStatus(status);
}

function isCompletedStatus(status) {
  return ["completed", "complete", "done", "closed"].includes(normalizeStatus(status));
}

function normalizeGeometry(value) {
  const parsed = parseJsonish(value);
  if (!parsed) return null;

  if (parsed.type === "Feature") return parsed.geometry || null;
  if (parsed.type === "FeatureCollection") return parsed.features?.[0]?.geometry || null;
  if (parsed.type && parsed.coordinates) return parsed;

  return null;
}

function buildGridFeature(grid) {
  const geometry = normalizeGeometry(grid?.geometry || grid?.geojson || grid?.polygon || grid?.boundary);
  if (!geometry) return null;

  return {
    type: "Feature",
    properties: {
      id: getGridUniqueId(grid),
      name: getGridLabel(grid),
      market: getMarketLabel(grid),
    },
    geometry,
  };
}

function parseRouteGeojson(routeOrGeojson) {
  if (!routeOrGeojson) return null;

  if (typeof routeOrGeojson === "string" && /^https?:\/\//i.test(routeOrGeojson.trim())) {
    return null;
  }

  const candidates = buildRouteGeometryCandidates(routeOrGeojson);

  for (const candidate of candidates) {
    const parsed = parseJsonish(candidate);
    if (!parsed) continue;

    if (parsed.type === "FeatureCollection") {
      const normalized = normalizeRouteFeatureCollection(parsed);
      if (getRoutePointCount(normalized) > 1) return normalized;
    }

    if (parsed.type === "Feature") {
      const normalized = normalizeRouteFeatureCollection({ type: "FeatureCollection", features: [parsed] });
      if (getRoutePointCount(normalized) > 1) return normalized;
    }

    if (parsed.type && parsed.coordinates) {
      const normalized = normalizeRouteFeatureCollection({
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: parsed }],
      });
      if (getRoutePointCount(normalized) > 1) return normalized;
    }

    const segmented = normalizeRouteSegments(parsed);
    if (segmented.features.length > 0) return segmented;

    const points = dedupeLngLatPoints(collectLngLatPoints(parsed));
    if (points.length >= 2) {
      return {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: points },
          },
        ],
      };
    }
  }

  return null;
}

function buildRouteGeometryCandidates(routeOrGeojson) {
  const output = [];
  const parsed = parseJsonish(routeOrGeojson) || routeOrGeojson;

  if (!parsed) return output;

  // Important: do not treat a whole Supabase route row as geometry.
  // Route rows can include grid points, nav points, cell points, etc.
  // Flattening all of those creates the ugly spider-web route.
  if (looksLikeGeojsonObject(parsed)) output.push(parsed);

  if (typeof parsed === "object" && !Array.isArray(parsed)) {
    ROUTE_GEOMETRY_FIELDS.forEach((field) => {
      if (parsed[field]) output.push(parsed[field]);
    });

    [parsed.route, parsed.saved_route, parsed.savedRoute, parsed.generated_route, parsed.generatedRoute, parsed._mobileRouteLink]
      .filter(Boolean)
      .forEach((nested) => {
        output.push(...buildRouteGeometryCandidates(nested));
      });
  }

  return output;
}

function normalizeRouteSegments(value) {
  const parsed = parseJsonish(value) || value;
  const features = [];

  if (!Array.isArray(parsed)) return { type: "FeatureCollection", features };

  parsed.forEach((item) => {
    const segment = parseJsonish(item) || item;
    if (!segment) return;

    if (segment.type === "Feature") {
      const normalized = normalizeRouteFeatureCollection({ type: "FeatureCollection", features: [segment] });
      features.push(...normalized.features);
      return;
    }

    if (segment.type && segment.coordinates) {
      const normalized = normalizeRouteFeatureCollection({
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: segment }],
      });
      features.push(...normalized.features);
      return;
    }

    const geometry = segment.geometry || segment.geojson || segment.route_geojson || segment.line || segment.lineString || segment.linestring;
    if (geometry) {
      const normalized = normalizeRouteFeatureCollection({
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: segment.properties || {}, geometry }],
      });
      features.push(...normalized.features);
      return;
    }

    const coords = segment.coordinates || segment.coords || segment.points || segment.path || segment.latlngs || segment.lat_lngs;
    const points = dedupeLngLatPoints(collectLngLatPoints(coords));
    if (points.length >= 2) {
      features.push({
        type: "Feature",
        properties: segment.properties || {},
        geometry: { type: "LineString", coordinates: points },
      });
    }
  });

  return { type: "FeatureCollection", features };
}

function normalizeRouteFeatureCollection(collection) {
  const features = [];

  (collection?.features || []).forEach((feature) => {
    const geometry = feature?.geometry || feature;
    if (!geometry) return;

    if (geometry.type === "LineString" || geometry.type === "MultiLineString") {
      features.push({
        type: "Feature",
        properties: feature.properties || {},
        geometry,
      });
      return;
    }

    const points = dedupeLngLatPoints(collectLngLatPoints(geometry));
    if (points.length >= 2) {
      features.push({
        type: "Feature",
        properties: feature.properties || {},
        geometry: { type: "LineString", coordinates: points },
      });
    }
  });

  return { type: "FeatureCollection", features };
}

function getRouteGeometryUrls(route) {
  if (!route) return [];
  const records = [route, route.route, route.saved_route, route.savedRoute, route.generated_route, route.generatedRoute, route._mobileRouteLink].filter(Boolean);
  const urls = [];

  records.forEach((record) => {
    ROUTE_URL_FIELDS.forEach((field) => {
      const value = record?.[field];
      if (typeof value === "string" && /^https?:\/\//i.test(value.trim())) urls.push(value.trim());
    });
  });

  return Array.from(new Set(urls));
}

function parseJsonish(value) {
  if (!value) return null;
  if (typeof value === "object") return value;

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return null;
    }
  }

  return null;
}

function collectLngLatPoints(value, output = [], depth = 0) {
  if (!value || depth > 8) return output;

  const parsed = parseJsonish(value) || value;

  if (typeof parsed === "string") {
    collectCoordinatePairsFromText(parsed, output);
    return output;
  }

  if (Array.isArray(parsed)) {
    if (parsed.length >= 2 && isFiniteNumber(parsed[0]) && isFiniteNumber(parsed[1])) {
      const pair = normalizeLngLatPair(parsed);
      if (pair) output.push(pair);
      return output;
    }

    parsed.forEach((item) => collectLngLatPoints(item, output, depth + 1));
    return output;
  }

  if (typeof parsed === "object") {
    if (parsed.type === "FeatureCollection") {
      (parsed.features || []).forEach((feature) => collectLngLatPoints(feature, output, depth + 1));
      return output;
    }

    if (parsed.type === "Feature") {
      collectLngLatPoints(parsed.geometry, output, depth + 1);
      return output;
    }

    if (parsed.coordinates) {
      collectLngLatPoints(parsed.coordinates, output, depth + 1);
      return output;
    }

    if (isValidLatLng(parsed)) {
      output.push([Number(parsed.lng ?? parsed.lon ?? parsed.longitude ?? parsed.x), Number(parsed.lat ?? parsed.latitude ?? parsed.y)]);
      return output;
    }

    ROUTE_GEOMETRY_FIELDS.forEach((field) => {
      if (parsed[field]) collectLngLatPoints(parsed[field], output, depth + 1);
    });
  }

  return output;
}

function collectCoordinatePairsFromText(text, output) {
  if (typeof text !== "string" || !text.trim()) return;

  const regex = /(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const pair = normalizeLngLatPair([Number(match[1]), Number(match[2])]);
    if (pair) output.push(pair);
  }
}

function normalizeLngLatPair(pair) {
  const first = Number(pair[0]);
  const second = Number(pair[1]);

  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;

  if (Math.abs(first) <= 90 && Math.abs(second) > 90) {
    return [second, first];
  }

  return [first, second];
}

function dedupeLngLatPoints(points) {
  const output = [];
  let lastKey = "";

  (points || []).forEach((point) => {
    if (!Array.isArray(point) || point.length < 2) return;
    const lng = Number(point[0]);
    const lat = Number(point[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return;

    const key = `${lng.toFixed(7)},${lat.toFixed(7)}`;
    if (key === lastKey) return;
    lastKey = key;
    output.push([lng, lat]);
  });

  return output;
}

function getRoutePointCount(routeGeojson) {
  return collectLngLatPoints(routeGeojson).length;
}

function getRouteDistanceMeters(route) {
  const value = route?.route_length_m || route?.length_m || route?.distance_m || route?.distanceMeters;
  const meters = Number(value);
  return Number.isFinite(meters) && meters > 0 ? meters : 0;
}

function combineFeatureCollections(collections) {
  const features = [];

  (collections || []).forEach((collection) => {
    if (!collection) return;
    if (collection.type === "FeatureCollection") {
      features.push(...(collection.features || []));
      return;
    }
    if (collection.type === "Feature") {
      features.push(collection);
    }
  });

  if (!features.length) return null;
  return { type: "FeatureCollection", features };
}

function buildTrailPoints(task, routeGeojson) {
  const routePoints = collectLngLatPoints(routeGeojson).map(([lng, lat]) => ({ lat, lng }));
  const gpsUpdates = getGpsAndEvidenceUpdates(task)
    .filter(isValidLatLng)
    .sort((a, b) => getTime(a.created_at) - getTime(b.created_at))
    .slice(-MAX_TRAIL_POINTS);

  return gpsUpdates.map((point) => {
    const offRoute = routePoints.length > 1 ? !isPointNearRoute(point, routePoints, OFF_ROUTE_THRESHOLD_M) : false;
    return { ...point, offRoute };
  });
}

function getGpsAndEvidenceUpdates(task) {
  const sources = [
    task?._mobileTaskUpdates,
    task?._mobileUpdates,
    task?._taskUpdates,
    task?._updates,
    task?.taskUpdates,
    task?.task_updates,
    task?.updates,
  ];

  const updates = sources.find((value) => Array.isArray(value)) || [];

  return updates
    .map((item) => ({
      ...item,
      lat: Number(item.lat ?? item.latitude),
      lng: Number(item.lng ?? item.lon ?? item.longitude),
      created_at: item.created_at,
    }))
    .filter(isValidLatLng);
}

function getIssueList(task) {
  const sources = [
    task?._mobileIssueReports,
    task?._issueReports,
    task?._issues,
    task?.issueReports,
    task?.issue_reports,
    task?.issues,
  ];

  return sources.find((value) => Array.isArray(value)) || [];
}

function getLatestIssue(task) {
  return [...getIssueList(task)].sort((a, b) => getTime(b.created_at) - getTime(a.created_at))[0] || null;
}

function isPointNearRoute(point, routePoints, thresholdM) {
  let bestDistance = Infinity;

  for (let index = 1; index < routePoints.length; index += 1) {
    const distance = distancePointToSegmentMeters(point, routePoints[index - 1], routePoints[index]);
    if (distance < bestDistance) bestDistance = distance;
    if (bestDistance <= thresholdM) return true;
  }

  return bestDistance <= thresholdM;
}

function distancePointToSegmentMeters(point, start, end) {
  const originLat = point.lat;
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng = 111_320 * Math.cos((originLat * Math.PI) / 180);

  const px = point.lng * metersPerDegreeLng;
  const py = point.lat * metersPerDegreeLat;
  const ax = start.lng * metersPerDegreeLng;
  const ay = start.lat * metersPerDegreeLat;
  const bx = end.lng * metersPerDegreeLng;
  const by = end.lat * metersPerDegreeLat;

  const dx = bx - ax;
  const dy = by - ay;

  if (dx === 0 && dy === 0) {
    return Math.hypot(px - ax, py - ay);
  }

  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  const closestX = ax + t * dx;
  const closestY = ay + t * dy;

  return Math.hypot(px - closestX, py - closestY);
}

function getBestFallbackLocation(row, lastTrailPoint, gridFeatures = []) {
  if (isValidLatLng(lastTrailPoint)) {
    return {
      lat: Number(lastTrailPoint.lat),
      lng: Number(lastTrailPoint.lng),
      accuracy: Number(lastTrailPoint.accuracy ?? lastTrailPoint.gps_accuracy),
    };
  }

  const updates = getGpsAndEvidenceUpdates(row?.task || []);
  const latest = updates.sort((a, b) => getTime(b.created_at) - getTime(a.created_at))[0];
  if (isValidLatLng(latest)) {
    return {
      lat: Number(latest.lat),
      lng: Number(latest.lng),
      accuracy: Number(latest.accuracy ?? latest.gps_accuracy),
    };
  }

  const gridPoints = collectLngLatPoints({ type: "FeatureCollection", features: gridFeatures || [] });
  const center = getPointCenter(gridPoints);
  if (center) return { ...center, accuracy: null };

  return null;
}

function buildNavigationUrl(row) {
  const routeGeojson = parseRouteGeojson(row.route);
  const routePoints = collectLngLatPoints(routeGeojson);
  const firstRoutePoint = routePoints[0];

  if (firstRoutePoint) {
    const [lng, lat] = firstRoutePoint;
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
  }

  const gridFeature = buildGridFeature(row.grid);
  const gridPoints = collectLngLatPoints(gridFeature);

  if (gridPoints.length > 0) {
    const center = getPointCenter(gridPoints);
    if (center) {
      return `https://www.google.com/maps/dir/?api=1&destination=${center.lat},${center.lng}&travelmode=driving`;
    }
  }

  return "";
}

function getPointCenter(points) {
  const valid = points
    .map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) }))
    .filter(isValidLatLng);

  if (!valid.length) return null;

  const total = valid.reduce(
    (acc, point) => ({ lat: acc.lat + point.lat, lng: acc.lng + point.lng }),
    { lat: 0, lng: 0 }
  );

  return { lat: total.lat / valid.length, lng: total.lng / valid.length };
}

function isValidLatLng(value) {
  const lat = Number(value?.lat ?? value?.latitude);
  const lng = Number(value?.lng ?? value?.lon ?? value?.longitude);

  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function formatDate(value) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(value) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString([], { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function getRouteGeojsonDistanceMeters(routeGeojsons = []) {
  let total = 0;

  (routeGeojsons || []).forEach((geojson) => {
    const points = collectLngLatPoints(geojson).map(([lng, lat]) => ({ lat, lng })).filter(isValidLatLng);
    total += getLatLngDistanceMeters(points);
  });

  return total;
}

function getLatLngDistanceMeters(points = []) {
  const valid = (points || []).filter(isValidLatLng);
  if (valid.length < 2) return 0;

  let total = 0;
  for (let index = 1; index < valid.length; index += 1) {
    total += haversineMeters(valid[index - 1], valid[index]);
  }
  return total;
}

function haversineMeters(a, b) {
  const radiusM = 6371000;
  const lat1 = (Number(a.lat) * Math.PI) / 180;
  const lat2 = (Number(b.lat) * Math.PI) / 180;
  const dLat = ((Number(b.lat) - Number(a.lat)) * Math.PI) / 180;
  const dLng = ((Number(b.lng) - Number(a.lng)) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * radiusM * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function formatDistance(value) {
  const meters = Number(value);
  if (!Number.isFinite(meters) || meters <= 0) return "N/A";
  if (meters >= 1609.344) return `${(meters / 1609.344).toFixed(2)} mi`;
  return `${Math.round(meters)} m`;
}

function formatIssueType(value) {
  return String(value || "Issue").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatSeverity(value) {
  return String(value || "normal").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatStatus(value) {
  return String(value || "assigned").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function safeLocalStorageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (_error) {
    return "";
  }
}

const styles = {
  page: {
    display: "grid",
    gap: 12,
    paddingBottom: 150,
  },
  loadingCard: {
    padding: 18,
  },
  emptyCard: {
    padding: 18,
  },
  topBar: {
    border: "1px solid rgba(148, 163, 184, 0.22)",
    borderRadius: 18,
    padding: "10px 12px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    background: "rgba(15, 23, 42, 0.58)",
  },
  versionPill: {
    margin: "0 0 6px",
    color: "#93c5fd",
    fontSize: 9,
    fontWeight: 900,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  pageTitle: {
    margin: 0,
    fontSize: 21,
    lineHeight: 1.1,
  },
  pageHint: {
    margin: "6px 0 0",
    color: "#bfdbfe",
    fontSize: 11,
    lineHeight: 1.45,
  },
  refreshButton: {
    border: "1px solid rgba(147, 197, 253, 0.38)",
    borderRadius: 12,
    padding: "10px 12px",
    color: "#f8fafc",
    background: "rgba(30, 41, 59, 0.70)",
    fontWeight: 800,
  },
  contextLoading: {
    border: "1px solid rgba(14, 165, 233, 0.34)",
    borderRadius: 14,
    padding: 10,
    color: "#bae6fd",
    background: "rgba(8, 47, 73, 0.28)",
    textAlign: "center",
    fontSize: 11,
    fontWeight: 800,
  },
  alert: {
    border: "1px solid rgba(248, 113, 113, 0.55)",
    borderRadius: 14,
    padding: 12,
    color: "#fecaca",
    background: "rgba(127, 29, 29, 0.32)",
  },
  statusMessage: {
    border: "1px solid rgba(34, 197, 94, 0.42)",
    borderRadius: 14,
    padding: 12,
    color: "#bbf7d0",
    background: "rgba(20, 83, 45, 0.30)",
    textAlign: "center",
    fontWeight: 800,
  },
  activeCard: {
    padding: 12,
    display: "grid",
    gap: 12,
    borderColor: "rgba(14, 165, 233, 0.65)",
    boxShadow: "0 0 0 1px rgba(14, 165, 233, 0.16), 0 18px 42px rgba(14, 165, 233, 0.08)",
  },
  activeHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  eyebrow: {
    margin: 0,
    color: "#93c5fd",
    textTransform: "uppercase",
    letterSpacing: 1.3,
    fontSize: 10,
    fontWeight: 900,
  },
  taskTitle: {
    margin: "4px 0 0",
    fontSize: 19,
    lineHeight: 1.16,
  },
  subTitle: {
    margin: "5px 0 0",
    color: "#bfdbfe",
    fontSize: 12,
    lineHeight: 1.35,
  },
  readyPill: {
    borderRadius: 999,
    padding: "8px 10px",
    fontWeight: 900,
    fontSize: 10,
    color: "#bbf7d0",
    background: "rgba(22, 101, 52, 0.58)",
    whiteSpace: "nowrap",
  },
  missingPill: {
    borderRadius: 999,
    padding: "8px 10px",
    fontWeight: 900,
    fontSize: 10,
    color: "#fde68a",
    background: "rgba(113, 63, 18, 0.62)",
    whiteSpace: "nowrap",
  },
  infoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 7,
  },
  infoItem: {
    border: "1px solid rgba(148, 163, 184, 0.22)",
    borderRadius: 14,
    padding: "10px 9px",
    display: "grid",
    gap: 5,
    background: "rgba(15, 23, 42, 0.58)",
    minWidth: 0,
  },
  infoItemFullRow: {
    gridColumn: "1 / -1",
  },
  infoValue: {
    display: "block",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
    lineHeight: 1.22,
  },
  infoGreen: {
    borderColor: "rgba(34, 197, 94, 0.45)",
    background: "rgba(20, 83, 45, 0.24)",
  },
  infoAmber: {
    borderColor: "rgba(250, 204, 21, 0.42)",
    background: "rgba(113, 63, 18, 0.24)",
  },
  infoBlue: {
    borderColor: "rgba(59, 130, 246, 0.48)",
    background: "rgba(30, 64, 175, 0.22)",
  },
  mapCard: {
    border: "1px solid rgba(14, 165, 233, 0.58)",
    borderRadius: 18,
    overflow: "hidden",
    background: "rgba(8, 47, 73, 0.18)",
  },
  mapHeader: {
    padding: 10,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  mapEyebrow: {
    margin: 0,
    color: "#93c5fd",
    textTransform: "uppercase",
    letterSpacing: 1.3,
    fontSize: 10,
    fontWeight: 900,
  },
  mapTitle: {
    margin: "4px 0 0",
    fontSize: 15,
  },
  readyMini: {
    borderRadius: 999,
    padding: "6px 8px",
    color: "#bbf7d0",
    background: "rgba(22, 101, 52, 0.60)",
    fontSize: 9,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  warnMini: {
    borderRadius: 999,
    padding: "6px 8px",
    color: "#fef3c7",
    background: "rgba(113, 63, 18, 0.60)",
    fontSize: 9,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  mapToolbar: {
    display: "flex",
    gap: 6,
    padding: "0 10px 10px",
    overflowX: "auto",
    WebkitOverflowScrolling: "touch",
  },
  mapToolButton: {
    flex: "0 0 auto",
    border: "1px solid rgba(148, 163, 184, 0.30)",
    borderRadius: 999,
    padding: "7px 9px",
    color: "#e5e7eb",
    background: "rgba(15, 23, 42, 0.74)",
    fontSize: 10,
    fontWeight: 900,
  },
  mapToolButtonActive: {
    borderColor: "rgba(34, 197, 94, 0.65)",
    color: "#dcfce7",
    background: "rgba(20, 83, 45, 0.70)",
  },
  mapToolButtonDanger: {
    flex: "0 0 auto",
    border: "1px solid rgba(248, 113, 113, 0.45)",
    borderRadius: 999,
    padding: "7px 9px",
    color: "#fee2e2",
    background: "rgba(127, 29, 29, 0.58)",
    fontSize: 10,
    fontWeight: 900,
  },
  mapBox: {
    position: "relative",
    height: "min(62vh, 540px)",
    minHeight: 390,
    borderTop: "1px solid rgba(148, 163, 184, 0.18)",
    borderBottom: "1px solid rgba(148, 163, 184, 0.18)",
  },
  map: {
    height: "100%",
    width: "100%",
  },
  mapAttribution: {
    padding: "3px 10px 0",
    color: "rgba(191, 219, 254, 0.62)",
    fontSize: 8,
    lineHeight: 1.2,
    textAlign: "right",
  },
  rulerPanel: {
    position: "absolute",
    right: 8,
    bottom: 8,
    left: 8,
    zIndex: 620,
    border: "1px solid rgba(167, 139, 250, 0.52)",
    borderRadius: 13,
    padding: "8px 10px",
    color: "#ede9fe",
    background: "rgba(49, 46, 129, 0.82)",
    fontSize: 11,
    fontWeight: 900,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  rulerClearButton: {
    border: "1px solid rgba(255, 255, 255, 0.26)",
    borderRadius: 999,
    padding: "5px 9px",
    color: "#ffffff",
    background: "rgba(127, 29, 29, 0.82)",
    fontSize: 10,
    fontWeight: 900,
  },
  measureOverlay: {
    position: "absolute",
    right: 8,
    bottom: 54,
    left: 8,
    zIndex: 500,
    border: "1px solid rgba(167, 139, 250, 0.48)",
    borderRadius: 12,
    padding: "8px 10px",
    color: "#ede9fe",
    background: "rgba(49, 46, 129, 0.76)",
    fontSize: 11,
    fontWeight: 800,
    textAlign: "center",
    pointerEvents: "none",
  },
  mapSystemNote: {
    margin: 0,
    padding: "8px 10px 0",
    color: "#bae6fd",
    fontSize: 10,
    lineHeight: 1.35,
  },
  locationPermissionPanel: {
    margin: "8px 10px 0",
    border: "1px solid rgba(250, 204, 21, 0.52)",
    borderRadius: 14,
    padding: "10px 11px",
    display: "grid",
    gap: 5,
    color: "#fef3c7",
    background: "rgba(113, 63, 18, 0.34)",
    fontSize: 10,
    lineHeight: 1.35,
  },

  mapFacts: {
    padding: 8,
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 5,
  },
  mapFact: {
    border: "1px solid rgba(148, 163, 184, 0.20)",
    borderRadius: 12,
    padding: "8px 6px",
    display: "grid",
    gap: 4,
    textAlign: "center",
    background: "rgba(15, 23, 42, 0.50)",
  },
  mapFactWarn: {
    borderColor: "rgba(249, 115, 22, 0.52)",
    background: "rgba(124, 45, 18, 0.32)",
  },
  legendRow: {
    padding: "0 10px 10px",
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    fontSize: 10,
    color: "#dbeafe",
  },
  legendItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    display: "inline-block",
  },
  mapNote: {
    borderTop: "1px solid rgba(148, 163, 184, 0.14)",
    margin: 0,
    padding: "8px 10px",
    color: "#bfdbfe",
    fontSize: 10,
    lineHeight: 1.35,
  },
  lifecycleGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 8,
  },
  lifecycleButton: {
    minHeight: 46,
  },
  holdButton: {
    border: "1px solid rgba(250, 204, 21, 0.55)",
    borderRadius: 13,
    minHeight: 46,
    padding: "10px 12px",
    color: "#fef3c7",
    background: "rgba(113, 63, 18, 0.62)",
    fontWeight: 900,
  },
  endButton: {
    border: "1px solid rgba(34, 197, 94, 0.55)",
    borderRadius: 13,
    minHeight: 46,
    padding: "10px 12px",
    color: "#dcfce7",
    background: "rgba(22, 101, 52, 0.66)",
    fontWeight: 900,
  },
  doneButton: {
    border: "1px solid rgba(34, 197, 94, 0.45)",
    borderRadius: 13,
    minHeight: 46,
    padding: "10px 12px",
    color: "#bbf7d0",
    background: "rgba(20, 83, 45, 0.40)",
    fontWeight: 900,
  },
  issueToggle: {
    border: "1px solid rgba(250, 204, 21, 0.65)",
    borderRadius: 13,
    padding: "12px 12px",
    fontWeight: 900,
    color: "#0f172a",
    background: "linear-gradient(90deg, #eab308, #22c55e)",
  },
  issueForm: {
    border: "1px dashed rgba(250, 204, 21, 0.52)",
    borderRadius: 16,
    padding: 10,
    display: "grid",
    gap: 10,
    background: "rgba(15, 23, 42, 0.50)",
  },
  issueTypeGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 8,
  },
  issueTypeButton: {
    border: "1px solid rgba(148, 163, 184, 0.30)",
    borderRadius: 13,
    padding: "10px 6px",
    background: "rgba(15, 23, 42, 0.60)",
    color: "#e5e7eb",
    fontWeight: 800,
    fontSize: 11,
  },
  issueTypeActive: {
    borderColor: "rgba(34, 197, 94, 0.70)",
    background: "rgba(20, 83, 45, 0.65)",
    color: "#dcfce7",
  },
  label: {
    display: "grid",
    gap: 6,
    fontSize: 11,
    fontWeight: 800,
    color: "#bfdbfe",
  },
  input: {
    width: "100%",
    border: "1px solid rgba(148, 163, 184, 0.35)",
    borderRadius: 12,
    padding: "11px 12px",
    background: "rgba(2, 6, 23, 0.72)",
    color: "#f8fafc",
    outline: "none",
  },
  photoBox: {
    border: "1px dashed rgba(147, 197, 253, 0.45)",
    borderRadius: 14,
    padding: 10,
    display: "grid",
    gap: 6,
    fontSize: 11,
    color: "#bfdbfe",
  },
  submitIssueButton: {
    minHeight: 44,
  },
  latestIssueBox: {
    border: "1px solid rgba(250, 204, 21, 0.34)",
    borderRadius: 14,
    padding: 10,
    display: "grid",
    gap: 4,
    background: "rgba(113, 63, 18, 0.18)",
  },
  latestLabel: {
    margin: 0,
    color: "#fde68a",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    fontSize: 9,
    fontWeight: 900,
  },
  otherRoutesCard: {
    padding: 12,
  },
  otherRoutesToggle: {
    width: "100%",
    border: "1px solid rgba(147, 197, 253, 0.38)",
    borderRadius: 13,
    padding: "12px 12px",
    color: "#f8fafc",
    background: "rgba(30, 41, 59, 0.70)",
    fontWeight: 900,
  },
  otherRoutesList: {
    marginTop: 10,
    display: "grid",
    gap: 8,
  },
  routeChoice: {
    width: "100%",
    border: "1px solid rgba(148, 163, 184, 0.25)",
    borderRadius: 13,
    padding: "10px 11px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    textAlign: "left",
    color: "#e5e7eb",
    background: "rgba(15, 23, 42, 0.58)",
  },
  routeChoiceActive: {
    borderColor: "rgba(59, 130, 246, 0.74)",
    background: "rgba(30, 64, 175, 0.28)",
  },
};
