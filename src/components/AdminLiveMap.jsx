import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  GeoJSON,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import CellSectorLayer from "./maps/CellSectorLayer";

const LIVE_REFRESH_MS = 5000;
const ACTIVE_WINDOW_MINUTES = 10;
const MAX_TASK_ROWS = 2500;
const MAX_UPDATE_ROWS = 7000;
const MAX_TRAIL_POINTS_PER_TASK = 300;
const MAX_GRID_ROWS_WITH_MARKET = 3000;
const MAX_GRID_ROWS_ALL_MARKETS = 800;

const focusIcon = new L.DivIcon({
  className: "timeline-focus-marker",
  html: `<div class="timeline-focus-dot">📍</div>`,
  iconSize: [38, 38],
  iconAnchor: [19, 38],
});

const liveIcon = new L.DivIcon({
  className: "bd-live-fe-marker",
  html: `<div class="bd-live-fe-dot"><span></span></div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

const staleIcon = new L.DivIcon({
  className: "bd-live-fe-marker bd-live-fe-marker-stale",
  html: `<div class="bd-live-fe-dot bd-live-fe-dot-stale"><span></span></div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replaceAll("-", "_")
    .replaceAll(" ", "_");
}

function isClearFilter(value) {
  const normalized = normalizeText(value);
  return !normalized || normalized === "all" || normalized.startsWith("all_");
}

function isInProcessStatus(status) {
  const normalized = normalizeText(status);
  return ["in_progress", "inprocess", "in_process", "started", "working", "active"].includes(
    normalized
  );
}

function statusMatches(taskStatus, filterStatus) {
  if (isClearFilter(filterStatus)) return true;
  return normalizeText(taskStatus) === normalizeText(filterStatus);
}

function freshText(dateValue) {
  if (!dateValue) return "N/A";

  const time = new Date(dateValue).getTime();
  if (!Number.isFinite(time)) return "N/A";

  const diff = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (diff < 60) return `${diff} sec ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  return `${Math.floor(diff / 86400)} day ago`;
}

function formatDateTime(dateValue) {
  if (!dateValue) return "N/A";

  const time = new Date(dateValue).getTime();
  if (!Number.isFinite(time)) return "N/A";

  return new Date(dateValue).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function isFresh(dateValue) {
  if (!dateValue) return false;

  const time = new Date(dateValue).getTime();
  if (!Number.isFinite(time)) return false;

  const diffMinutes = (Date.now() - time) / 60000;
  return diffMinutes <= ACTIVE_WINDOW_MINUTES;
}

function getPoint(update) {
  const lat = update?.latitude ?? update?.lat ?? update?.gps_lat ?? update?.gpsLat;
  const lng = update?.longitude ?? update?.lon ?? update?.lng ?? update?.gps_lng ?? update?.gpsLng;

  const latitude = Number(lat);
  const longitude = Number(lng);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  if (latitude === 0 && longitude === 0) return null;

  return { latitude, longitude };
}

function taskIdOf(value) {
  return value === undefined || value === null ? "" : String(value);
}

function matchesFeFilter(task, filters) {
  if (isClearFilter(filters?.feId)) return true;

  const wanted = String(filters.feId).trim().toLowerCase();
  const candidates = [
    task?.assigned_to,
    task?.assigned_user_id,
    task?.assigned_fe_id,
    task?.fe_id,
    task?.engineer_id,
    task?.user_id,
    task?.fe_email,
    task?.assigned_fe_email,
    task?.assigned_to_email,
    task?.engineer_email,
    task?.email,
  ]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());

  return candidates.includes(wanted);
}

function taskMatchesFilters(task, filters) {
  const matchProject =
    isClearFilter(filters?.projectId) || String(task?.project_id || "") === String(filters.projectId || "");

  const matchMarket =
    isClearFilter(filters?.market) || normalizeText(task?.market) === normalizeText(filters.market);

  const matchStatus = statusMatches(task?.status, filters?.status);
  const matchFe = matchesFeFilter(task, filters);

  return matchProject && matchMarket && matchStatus && matchFe;
}

function taskFeLabel(task, update) {
  return (
    update?.user_email ||
    task?.fe_email ||
    task?.assigned_fe_email ||
    task?.assigned_to_email ||
    task?.engineer_email ||
    task?.assigned_to ||
    "Unknown FE"
  );
}

function taskTitle(task) {
  const target = task?.target_name || task?.target_type || "Target not set";
  const test = task?.test_type || "Test type not set";
  return `${target} • ${test}`;
}

function taskSubTitle(task) {
  const market = task?.market || "Market not set";
  const type = task?.target_type || "Target";
  return `${market} • ${type}`;
}

function normalizeGeometry(geometry) {
  if (!geometry) return null;

  if (typeof geometry === "string") {
    try {
      return JSON.parse(geometry);
    } catch {
      return null;
    }
  }

  return geometry;
}

function getGridStyle(grid) {
  const status = String(grid?.status || "Available").toLowerCase();

  if (status.includes("progress")) {
    return { color: "#16a34a", weight: 3, fillColor: "#86efac", fillOpacity: 0.18 };
  }

  if (status.includes("assigned")) {
    return { color: "#f59e0b", weight: 3, fillColor: "#fde68a", fillOpacity: 0.16 };
  }

  if (status.includes("completed")) {
    return { color: "#64748b", weight: 2, fillColor: "#cbd5e1", fillOpacity: 0.12 };
  }

  if (status.includes("re-drive") || status.includes("redrive")) {
    return { color: "#ef4444", weight: 3, fillColor: "#fecaca", fillOpacity: 0.18 };
  }

  return { color: "#1d4ed8", weight: 3, fillColor: "#93c5fd", fillOpacity: 0.16 };
}

function FitActiveLocations({ locations, focusedLocation }) {
  const map = useMap();

  useEffect(() => {
    if (focusedLocation) return;
    if (!locations.length) return;

    const bounds = L.latLngBounds(
      locations.map((loc) => [Number(loc.latitude), Number(loc.longitude)])
    );

    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }, [locations, focusedLocation, map]);

  return null;
}

function FocusTimelineLocation({ focusedLocation }) {
  const map = useMap();

  useEffect(() => {
    if (!focusedLocation?.lat || !focusedLocation?.lng) return;
    map.flyTo([Number(focusedLocation.lat), Number(focusedLocation.lng)], 17, { duration: 1.4 });
  }, [focusedLocation, map]);

  return null;
}

export default function AdminLiveMap({
  filters,
  focusedLocation,
  showGrids = true,
  showSites = true,
  showSectors = true,
  cellTechFilter = "all",
}) {
  const [locations, setLocations] = useState([]);
  const [trails, setTrails] = useState({});
  const [inProcessTasks, setInProcessTasks] = useState([]);
  const [tasksWithoutGps, setTasksWithoutGps] = useState([]);
  const [grids, setGrids] = useState([]);
  const [loading, setLoading] = useState(true);
  const [gridLoading, setGridLoading] = useState(false);
  const [gridError, setGridError] = useState("");
  const [gpsError, setGpsError] = useState("");
  const [showLocationDetails, setShowLocationDetails] = useState(true);
  const [showTrail, setShowTrail] = useState(true);
  const [isDarkTheme, setIsDarkTheme] = useState(false);

  const activeMarket = isClearFilter(filters?.market) ? "" : filters?.market || "";

  useEffect(() => {
    const detectTheme = () => {
      const body = document.body;
      const html = document.documentElement;
      const themeText = [
        body.className,
        html.className,
        body.dataset.theme,
        html.dataset.theme,
        body.dataset.mode,
        html.dataset.mode,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const getAverageRgb = (value) => {
        const rgb = value.match(/\d+/g)?.map(Number) || [];
        return rgb.length >= 3 ? (rgb[0] + rgb[1] + rgb[2]) / 3 : 255;
      };

      const bodyBg = window.getComputedStyle(body).backgroundColor || "";
      const panel = document.querySelector(".admin-live-map-panel");
      const panelBg = panel ? window.getComputedStyle(panel).backgroundColor || "" : "";

      setIsDarkTheme(
        themeText.includes("dark") ||
          themeText.includes("night") ||
          getAverageRgb(bodyBg) < 90 ||
          getAverageRgb(panelBg) < 110
      );
    };

    detectTheme();

    const observer = new MutationObserver(detectTheme);
    observer.observe(document.body, { attributes: true, attributeFilter: ["class", "data-theme", "data-mode"] });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "data-mode"] });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    fetchLocations();

    const interval = setInterval(() => {
      fetchLocations();
    }, LIVE_REFRESH_MS);

    return () => clearInterval(interval);
  }, [filters]);

  useEffect(() => {
    fetchGridBoundaries();
  }, [activeMarket, showGrids]);

  async function fetchLocations() {
    setGpsError("");

    try {
      const { data: taskRows, error: taskError } = await supabase
        .from("tasks")
        .select("id,project_id,assigned_to,market,target_name,target_type,test_type,status")
        .limit(MAX_TASK_ROWS);

      if (taskError) {
        console.warn("Admin live map task lookup warning:", taskError);
      }

      const filteredInProcessTasks = (taskRows || [])
        .filter((task) => taskMatchesFilters(task, filters))
        .filter((task) => isInProcessStatus(task.status));

      const { data: updateRows, error: updateError } = await supabase
        .from("task_updates")
        .select(`
          *,
          tasks (
            id,
            project_id,
            assigned_to,
            market,
            target_name,
            target_type,
            test_type,
            status
          )
        `)
        .not("latitude", "is", null)
        .not("longitude", "is", null)
        .order("created_at", { ascending: false })
        .limit(MAX_UPDATE_ROWS);

      if (updateError) throw updateError;

      const filteredUpdates = (updateRows || []).filter((item) => {
        const point = getPoint(item);
        if (!point) return false;
        if (!item.tasks) return false;
        return taskMatchesFilters(item.tasks, filters) && isInProcessStatus(item.tasks.status);
      });

      const trailByTask = {};
      const latestByTask = {};

      filteredUpdates.forEach((item) => {
        const taskKey = taskIdOf(item.task_id || item.tasks?.id);
        const point = getPoint(item);
        if (!taskKey || !point) return;

        if (!latestByTask[taskKey]) {
          latestByTask[taskKey] = {
            ...item,
            latitude: point.latitude,
            longitude: point.longitude,
            feLabel: taskFeLabel(item.tasks, item),
            taskTitle: taskTitle(item.tasks),
            taskSubTitle: taskSubTitle(item.tasks),
            isLive: isFresh(item.created_at),
            lastSeenText: freshText(item.created_at),
            lastActivityText: formatDateTime(item.created_at),
          };
        }

        if (!trailByTask[taskKey]) trailByTask[taskKey] = [];
        if (trailByTask[taskKey].length < MAX_TRAIL_POINTS_PER_TASK) {
          trailByTask[taskKey].push([point.latitude, point.longitude]);
        }
      });

      Object.keys(trailByTask).forEach((taskKey) => {
        trailByTask[taskKey] = trailByTask[taskKey].reverse();
      });

      const liveLocations = Object.values(latestByTask)
        .map((loc) => ({
          ...loc,
          trailPoints: trailByTask[taskIdOf(loc.task_id || loc.tasks?.id)]?.length || 0,
        }))
        .sort((a, b) => {
          if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });

      const activeGpsTaskIds = new Set(liveLocations.map((loc) => taskIdOf(loc.task_id || loc.tasks?.id)));
      const noGpsTasks = filteredInProcessTasks.filter((task) => !activeGpsTaskIds.has(taskIdOf(task.id)));

      setInProcessTasks(filteredInProcessTasks);
      setTasksWithoutGps(noGpsTasks);
      setTrails(trailByTask);
      setLocations(liveLocations);
    } catch (error) {
      console.error("Error loading live FE locations:", error);
      setGpsError(error?.message || "Unable to load live FE locations");
      setLocations([]);
      setTrails({});
      setTasksWithoutGps([]);
    } finally {
      setLoading(false);
    }
  }

  async function fetchGridBoundaries() {
    if (!showGrids) {
      setGrids([]);
      return;
    }

    setGridLoading(true);
    setGridError("");

    try {
      const allRows = [];
      const pageSize = 1000;
      const maxRows = activeMarket ? MAX_GRID_ROWS_WITH_MARKET : MAX_GRID_ROWS_ALL_MARKETS;
      let from = 0;

      while (from < maxRows) {
        const to = Math.min(from + pageSize - 1, maxRows - 1);

        let query = supabase
          .from("grids")
          .select("id,name,market,status,geometry,created_at")
          .not("geometry", "is", null)
          .order("created_at", { ascending: false })
          .range(from, to);

        if (activeMarket) {
          query = query.eq("market", activeMarket);
        }

        const { data, error } = await query;
        if (error) throw error;

        const rows = data || [];
        allRows.push(...rows);

        if (rows.length < pageSize) break;
        from += pageSize;
      }

      const normalized = allRows
        .map((grid) => ({
          ...grid,
          geometry: normalizeGeometry(grid.geometry),
          status: grid.status || "Available",
        }))
        .filter((grid) => grid.geometry);

      setGrids(normalized);
    } catch (error) {
      console.error("Error loading grid boundaries for live map:", error);
      setGridError(error?.message || "Unable to load grid boundaries");
      setGrids([]);
    } finally {
      setGridLoading(false);
    }
  }

  const visibleGrids = useMemo(() => {
    const maxGridPolygons = activeMarket ? MAX_GRID_ROWS_WITH_MARKET : MAX_GRID_ROWS_ALL_MARKETS;
    return grids.slice(0, maxGridPolygons);
  }, [grids, activeMarket]);

  const locationByTask = useMemo(() => {
    const map = new Map();
    locations.forEach((loc) => {
      map.set(taskIdOf(loc.task_id || loc.tasks?.id), loc);
    });
    return map;
  }, [locations]);

  const liveCount = useMemo(() => locations.filter((loc) => loc.isLive).length, [locations]);
  const staleCount = useMemo(() => locations.filter((loc) => !loc.isLive).length, [locations]);

  const trailCount = useMemo(() => {
    if (!showTrail) return 0;
    return Object.values(trails).reduce((sum, points) => sum + points.length, 0);
  }, [trails, showTrail]);

  const statusMessage = useMemo(() => {
    if (loading) return "Loading FE locations...";
    if (gpsError) return `GPS warning: ${gpsError}`;
    if (focusedLocation) return `Timeline location selected: ${formatDateTime(focusedLocation.time)}`;
    if (liveCount > 0) return `${liveCount} live FE location${liveCount === 1 ? "" : "s"} visible on the map.`;
    if (staleCount > 0) return `${staleCount} stale FE location${staleCount === 1 ? "" : "s"} found. Waiting for fresh GPS heartbeat.`;
    if (tasksWithoutGps.length > 0) return `${tasksWithoutGps.length} in-process task${tasksWithoutGps.length === 1 ? "" : "s"} found without GPS yet.`;
    return "No active FE GPS locations. Start a task to begin tracking.";
  }, [loading, gpsError, focusedLocation, liveCount, staleCount, tasksWithoutGps.length]);

  return (
    <div className={`panel-card admin-live-map-panel ${isDarkTheme ? "admin-live-map-panel-night" : "admin-live-map-panel-day"}`}>
      <style>{`
        .admin-live-map-panel {
          overflow: hidden;
        }

        .admin-live-map-panel .panel-header {
          align-items: flex-start;
          gap: 14px;
        }

        .bd-live-header-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex-wrap: wrap;
        }

        .bd-live-toggle-btn {
          border: 1px solid rgba(37, 99, 235, 0.28);
          border-radius: 999px;
          background: rgba(239, 246, 255, 0.92);
          color: #1d4ed8;
          font-size: 12px;
          font-weight: 900;
          padding: 8px 14px;
          cursor: pointer;
        }

        .bd-live-toggle-btn:hover {
          background: #dbeafe;
        }

        .bd-live-metric-strip {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 10px;
          margin: 12px 0;
        }

        .bd-live-metric-card {
          border: 1px solid rgba(96, 165, 250, 0.28);
          border-radius: 16px;
          background: rgba(248, 250, 252, 0.68);
          padding: 12px 14px;
          min-height: 72px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          text-align: center;
        }

        .bd-live-metric-card span {
          color: #2563eb;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .bd-live-metric-card strong {
          margin-top: 5px;
          color: #0f172a;
          font-size: 24px;
          font-weight: 950;
          line-height: 1;
        }

        .bd-live-metric-card.live {
          border-color: rgba(34, 197, 94, 0.45);
          background: rgba(220, 252, 231, 0.72);
        }

        .bd-live-metric-card.stale {
          border-color: rgba(245, 158, 11, 0.45);
          background: rgba(254, 243, 199, 0.66);
        }

        .bd-live-metric-card.trail {
          border-color: rgba(14, 165, 233, 0.45);
          background: rgba(224, 242, 254, 0.72);
        }

        .bd-live-metric-card.waiting {
          border-color: rgba(148, 163, 184, 0.36);
          background: rgba(241, 245, 249, 0.74);
        }

        .bd-live-status-line {
          border: 1px solid rgba(96, 165, 250, 0.25);
          border-radius: 14px;
          background: rgba(239, 246, 255, 0.84);
          color: #1e3a8a;
          font-size: 13px;
          font-weight: 850;
          padding: 10px 14px;
          margin-bottom: 10px;
          text-align: center;
        }

        .bd-live-map-wrap {
          position: relative;
        }

        .bd-live-map-wrap .admin-map {
          min-height: 345px;
          border-radius: 18px;
          overflow: hidden;
        }

        .bd-live-fe-dot {
          position: relative;
          width: 28px;
          height: 28px;
          border-radius: 999px;
          background: #22c55e;
          border: 3px solid #ffffff;
          box-shadow: 0 0 0 5px rgba(34, 197, 94, 0.22), 0 12px 22px rgba(15, 23, 42, 0.26);
        }

        .bd-live-fe-dot span {
          position: absolute;
          inset: -9px;
          border-radius: 999px;
          border: 2px solid rgba(34, 197, 94, 0.55);
          animation: bdLivePulse 1.8s ease-out infinite;
        }

        .bd-live-fe-dot-stale {
          background: #f59e0b;
          box-shadow: 0 0 0 5px rgba(245, 158, 11, 0.2), 0 12px 22px rgba(15, 23, 42, 0.26);
        }

        .bd-live-fe-dot-stale span {
          border-color: rgba(245, 158, 11, 0.52);
        }

        @keyframes bdLivePulse {
          0% { transform: scale(0.65); opacity: 0.95; }
          100% { transform: scale(1.4); opacity: 0; }
        }

        .timeline-focus-dot {
          width: 34px;
          height: 34px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          background: #ffffff;
          border: 2px solid #2563eb;
          box-shadow: 0 12px 24px rgba(37, 99, 235, 0.25);
        }

        .bd-live-list {
          margin-top: 14px;
          display: grid;
          gap: 10px;
        }

        .bd-live-list-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .bd-live-list-header h3 {
          margin: 0;
          color: inherit;
          font-size: 18px;
          text-align: left;
        }

        .bd-live-fe-card {
          display: grid;
          grid-template-columns: minmax(260px, 1.4fr) repeat(3, minmax(130px, 0.8fr));
          align-items: stretch;
          gap: 10px;
          padding: 12px;
          border: 1px solid rgba(96, 165, 250, 0.34);
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.48);
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.04);
        }

        .bd-live-fe-card.is-live {
          border-left: 5px solid #22c55e;
        }

        .bd-live-fe-card.is-stale {
          border-left: 5px solid #f59e0b;
        }

        .bd-live-fe-main {
          display: flex;
          flex-direction: column;
          gap: 6px;
          justify-content: center;
          min-width: 0;
        }

        .bd-live-fe-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .bd-live-fe-main h4 {
          margin: 0;
          color: #0f172a;
          font-size: 16px;
          font-weight: 950;
          line-height: 1.25;
          word-break: break-word;
        }

        .bd-live-fe-main p {
          margin: 0;
          color: #334155;
          font-size: 12px;
          font-weight: 800;
          line-height: 1.35;
        }

        .bd-live-pill {
          white-space: nowrap;
          border-radius: 999px;
          padding: 6px 10px;
          font-size: 11px;
          font-weight: 950;
        }

        .bd-live-pill.live {
          color: #166534;
          background: #dcfce7;
          border: 1px solid rgba(34, 197, 94, 0.42);
        }

        .bd-live-pill.stale {
          color: #92400e;
          background: #fef3c7;
          border: 1px solid rgba(245, 158, 11, 0.42);
        }

        .bd-live-info-cell {
          border: 1px solid rgba(148, 163, 184, 0.22);
          border-radius: 14px;
          padding: 10px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 5px;
          min-width: 0;
          background: rgba(248, 250, 252, 0.58);
        }

        .bd-live-info-cell span {
          color: #2563eb;
          font-size: 10px;
          font-weight: 950;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }

        .bd-live-info-cell strong {
          color: #0f172a;
          font-size: 13px;
          font-weight: 950;
          line-height: 1.25;
          word-break: break-word;
        }

        .bd-live-hidden-note,
        .bd-live-no-gps {
          border: 1px dashed rgba(96, 165, 250, 0.55);
          border-radius: 16px;
          padding: 14px 16px;
          background: rgba(255, 255, 255, 0.34);
          color: #1e3a8a;
          font-weight: 850;
          text-align: left;
        }

        .bd-live-no-gps h4 {
          margin: 0 0 8px;
          font-size: 15px;
        }

        .bd-live-no-gps ul {
          margin: 0;
          padding-left: 18px;
        }

        .bd-live-no-gps li {
          margin: 4px 0;
          color: #334155;
          font-weight: 800;
        }

        .admin-live-map-panel-night .bd-live-toggle-btn,
        body.dark .admin-live-map-panel .bd-live-toggle-btn,
        body.night .admin-live-map-panel .bd-live-toggle-btn,
        body[data-theme="dark"] .admin-live-map-panel .bd-live-toggle-btn,
        body[data-mode="dark"] .admin-live-map-panel .bd-live-toggle-btn,
        .dark .admin-live-map-panel .bd-live-toggle-btn,
        .night .admin-live-map-panel .bd-live-toggle-btn {
          border-color: rgba(96, 165, 250, 0.45);
          background: rgba(37, 99, 235, 0.18);
          color: #dbeafe;
        }

        .admin-live-map-panel-night .bd-live-metric-card,
        .admin-live-map-panel-night .bd-live-fe-card,
        .admin-live-map-panel-night .bd-live-info-cell,
        body.dark .admin-live-map-panel .bd-live-metric-card,
        body.dark .admin-live-map-panel .bd-live-fe-card,
        body.dark .admin-live-map-panel .bd-live-info-cell,
        body.night .admin-live-map-panel .bd-live-metric-card,
        body.night .admin-live-map-panel .bd-live-fe-card,
        body.night .admin-live-map-panel .bd-live-info-cell,
        body[data-theme="dark"] .admin-live-map-panel .bd-live-metric-card,
        body[data-theme="dark"] .admin-live-map-panel .bd-live-fe-card,
        body[data-theme="dark"] .admin-live-map-panel .bd-live-info-cell,
        body[data-mode="dark"] .admin-live-map-panel .bd-live-metric-card,
        body[data-mode="dark"] .admin-live-map-panel .bd-live-fe-card,
        body[data-mode="dark"] .admin-live-map-panel .bd-live-info-cell,
        .dark .admin-live-map-panel .bd-live-metric-card,
        .dark .admin-live-map-panel .bd-live-fe-card,
        .dark .admin-live-map-panel .bd-live-info-cell,
        .night .admin-live-map-panel .bd-live-metric-card,
        .night .admin-live-map-panel .bd-live-fe-card,
        .night .admin-live-map-panel .bd-live-info-cell {
          background: rgba(15, 23, 42, 0.76);
          border-color: rgba(96, 165, 250, 0.32);
          box-shadow: none;
        }

        .admin-live-map-panel-night .bd-live-status-line,
        body.dark .admin-live-map-panel .bd-live-status-line,
        body.night .admin-live-map-panel .bd-live-status-line,
        body[data-theme="dark"] .admin-live-map-panel .bd-live-status-line,
        body[data-mode="dark"] .admin-live-map-panel .bd-live-status-line,
        .dark .admin-live-map-panel .bd-live-status-line,
        .night .admin-live-map-panel .bd-live-status-line {
          background: rgba(15, 23, 42, 0.74);
          border-color: rgba(96, 165, 250, 0.34);
          color: #dbeafe;
        }

        .admin-live-map-panel-night .bd-live-metric-card strong,
        .admin-live-map-panel-night .bd-live-fe-main h4,
        .admin-live-map-panel-night .bd-live-info-cell strong,
        body.dark .admin-live-map-panel .bd-live-metric-card strong,
        body.dark .admin-live-map-panel .bd-live-fe-main h4,
        body.dark .admin-live-map-panel .bd-live-info-cell strong,
        body.night .admin-live-map-panel .bd-live-metric-card strong,
        body.night .admin-live-map-panel .bd-live-fe-main h4,
        body.night .admin-live-map-panel .bd-live-info-cell strong,
        body[data-theme="dark"] .admin-live-map-panel .bd-live-metric-card strong,
        body[data-theme="dark"] .admin-live-map-panel .bd-live-fe-main h4,
        body[data-theme="dark"] .admin-live-map-panel .bd-live-info-cell strong,
        body[data-mode="dark"] .admin-live-map-panel .bd-live-metric-card strong,
        body[data-mode="dark"] .admin-live-map-panel .bd-live-fe-main h4,
        body[data-mode="dark"] .admin-live-map-panel .bd-live-info-cell strong,
        .dark .admin-live-map-panel .bd-live-metric-card strong,
        .dark .admin-live-map-panel .bd-live-fe-main h4,
        .dark .admin-live-map-panel .bd-live-info-cell strong,
        .night .admin-live-map-panel .bd-live-metric-card strong,
        .night .admin-live-map-panel .bd-live-fe-main h4,
        .night .admin-live-map-panel .bd-live-info-cell strong {
          color: #f8fbff;
        }

        .admin-live-map-panel-night .bd-live-fe-main p,
        .admin-live-map-panel-night .bd-live-no-gps li,
        body.dark .admin-live-map-panel .bd-live-fe-main p,
        body.dark .admin-live-map-panel .bd-live-no-gps li,
        body.night .admin-live-map-panel .bd-live-fe-main p,
        body.night .admin-live-map-panel .bd-live-no-gps li,
        body[data-theme="dark"] .admin-live-map-panel .bd-live-fe-main p,
        body[data-theme="dark"] .admin-live-map-panel .bd-live-no-gps li,
        body[data-mode="dark"] .admin-live-map-panel .bd-live-fe-main p,
        body[data-mode="dark"] .admin-live-map-panel .bd-live-no-gps li,
        .dark .admin-live-map-panel .bd-live-fe-main p,
        .dark .admin-live-map-panel .bd-live-no-gps li,
        .night .admin-live-map-panel .bd-live-fe-main p,
        .night .admin-live-map-panel .bd-live-no-gps li {
          color: #cbd5e1;
        }

        .admin-live-map-panel-night .bd-live-hidden-note,
        .admin-live-map-panel-night .bd-live-no-gps,
        body.dark .admin-live-map-panel .bd-live-hidden-note,
        body.dark .admin-live-map-panel .bd-live-no-gps,
        body.night .admin-live-map-panel .bd-live-hidden-note,
        body.night .admin-live-map-panel .bd-live-no-gps,
        body[data-theme="dark"] .admin-live-map-panel .bd-live-hidden-note,
        body[data-theme="dark"] .admin-live-map-panel .bd-live-no-gps,
        body[data-mode="dark"] .admin-live-map-panel .bd-live-hidden-note,
        body[data-mode="dark"] .admin-live-map-panel .bd-live-no-gps,
        .dark .admin-live-map-panel .bd-live-hidden-note,
        .dark .admin-live-map-panel .bd-live-no-gps,
        .night .admin-live-map-panel .bd-live-hidden-note,
        .night .admin-live-map-panel .bd-live-no-gps {
          border-color: rgba(96, 165, 250, 0.42);
          background: rgba(15, 23, 42, 0.62);
          color: #dbeafe;
        }

        @media (max-width: 1100px) {
          .bd-live-metric-strip {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .bd-live-fe-card {
            grid-template-columns: 1fr 1fr;
          }
        }

        @media (max-width: 720px) {
          .bd-live-metric-strip {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .bd-live-fe-card {
            grid-template-columns: 1fr;
          }

          .bd-live-list-header,
          .admin-live-map-panel .panel-header {
            align-items: flex-start;
            flex-direction: column;
          }

          .bd-live-header-actions {
            justify-content: flex-start;
          }
        }
      `}</style>

      <div className="panel-header">
        <div>
          <h2>Live FE / UE Activity Map</h2>
          <p>
            Live: {liveCount} • Stale: {staleCount} • In-process tasks: {inProcessTasks.length} • Trail points: {trailCount} • Grid boundaries: {visibleGrids.length}
          </p>
        </div>

        <div className="bd-live-header-actions">
          <button
            type="button"
            className="bd-live-toggle-btn"
            onClick={() => setShowTrail((value) => !value)}
          >
            {showTrail ? "Hide Trail" : "Show Trail"}
          </button>

          {locations.length > 0 && (
            <button
              type="button"
              className="bd-live-toggle-btn"
              onClick={() => setShowLocationDetails((value) => !value)}
            >
              {showLocationDetails ? "Hide FE Cards" : "Show FE Cards"}
            </button>
          )}
        </div>
      </div>

      <div className="bd-live-metric-strip">
        <div className="bd-live-metric-card live">
          <span>Live</span>
          <strong>{liveCount}</strong>
        </div>
        <div className="bd-live-metric-card stale">
          <span>Stale</span>
          <strong>{staleCount}</strong>
        </div>
        <div className="bd-live-metric-card">
          <span>In-Process</span>
          <strong>{inProcessTasks.length}</strong>
        </div>
        <div className="bd-live-metric-card trail">
          <span>Trail Points</span>
          <strong>{trailCount}</strong>
        </div>
        <div className="bd-live-metric-card waiting">
          <span>No GPS Yet</span>
          <strong>{tasksWithoutGps.length}</strong>
        </div>
      </div>

      <div className="bd-live-status-line">
        {statusMessage}
        {!loading && !gridLoading && gridError ? ` Grid layer warning: ${gridError}` : ""}
        {!loading && gridLoading ? " Loading grid boundaries..." : ""}
      </div>

      <div className="map-shell bd-live-map-wrap">
        <MapContainer center={[33.0, -96.8]} zoom={10} className="admin-map">
          <TileLayer
            attribution="&copy; OpenStreetMap"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <FitActiveLocations locations={locations} focusedLocation={focusedLocation} />
          <FocusTimelineLocation focusedLocation={focusedLocation} />

          {showGrids &&
            visibleGrids.map((grid) => (
              <GeoJSON
                key={`${grid.id}-${grid.status}`}
                data={grid.geometry}
                style={() => getGridStyle(grid)}
                eventHandlers={{
                  mouseover: (event) => {
                    event.target.setStyle({ color: "#ffffff", weight: 5, fillOpacity: 0.28 });
                  },
                  mouseout: (event) => {
                    event.target.setStyle(getGridStyle(grid));
                  },
                }}
                onEachFeature={(feature, layer) => {
                  layer.bindPopup(`
                    <b>${grid.name || "Unnamed Grid"}</b><br/>
                    Market: ${grid.market || "Not set"}<br/>
                    Status: ${grid.status || "Available"}
                  `);
                }}
              />
            ))}

          <CellSectorLayer
            market={activeMarket}
            technologyFilter={cellTechFilter}
            showSites={showSites}
            showSectors={showSectors}
            maxRecords={2500}
          />

          {showTrail &&
            Object.entries(trails).map(([taskId, points]) => {
              const loc = locationByTask.get(taskId);
              if (points.length <= 1) return null;

              return (
                <Polyline
                  key={taskId}
                  positions={points}
                  pathOptions={{
                    color: loc?.isLive ? "#2563eb" : "#94a3b8",
                    weight: loc?.isLive ? 5 : 4,
                    opacity: loc?.isLive ? 0.86 : 0.62,
                  }}
                />
              );
            })}

          {locations.map((loc) => (
            <Marker
              key={loc.id || `${loc.task_id}-${loc.created_at}`}
              position={[Number(loc.latitude), Number(loc.longitude)]}
              icon={loc.isLive ? liveIcon : staleIcon}
            >
              <Popup>
                <b>FE:</b> {loc.feLabel || loc.user_email || "Unknown"}
                <br />
                <b>Status:</b> {loc.isLive ? "Live" : "Stale"}
                <br />
                <b>Task:</b> {loc.taskTitle || taskTitle(loc.tasks)}
                <br />
                <b>Market:</b> {loc.tasks?.market || "N/A"}
                <br />
                <b>Target:</b> {loc.tasks?.target_name || "N/A"}
                <br />
                <b>Test:</b> {loc.tasks?.test_type || "N/A"}
                <br />
                <b>Latest GPS:</b> {formatDateTime(loc.created_at)}
                <br />
                <b>Last seen:</b> {freshText(loc.created_at)}
                <br />
                <b>Trail Points:</b> {trails[taskIdOf(loc.task_id || loc.tasks?.id)]?.length || 0}
              </Popup>
            </Marker>
          ))}

          {focusedLocation?.lat && focusedLocation?.lng && (
            <Marker position={[Number(focusedLocation.lat), Number(focusedLocation.lng)]} icon={focusIcon}>
              <Popup>
                <b>Selected Timeline Event</b>
                <br />
                {formatDateTime(focusedLocation.time)}
                <br />
                Lat/Lng: {Number(focusedLocation.lat).toFixed(5)}, {Number(focusedLocation.lng).toFixed(5)}
              </Popup>
            </Marker>
          )}
        </MapContainer>
      </div>

      <div className="bd-live-list">
        <div className="bd-live-list-header">
          <h3>Latest FE Locations</h3>
        </div>

        {locations.length === 0 ? (
          <p className="muted">No active locations available.</p>
        ) : !showLocationDetails ? (
          <div className="bd-live-hidden-note">
            FE cards are hidden. The map still shows FE location, trails, grid boundaries, and cell sectors.
          </div>
        ) : (
          locations.map((loc) => (
            <div
              key={loc.id || `${loc.task_id}-${loc.created_at}-card`}
              className={`bd-live-fe-card ${loc.isLive ? "is-live" : "is-stale"}`}
            >
              <div className="bd-live-fe-main">
                <div className="bd-live-fe-top">
                  <h4>{loc.feLabel || loc.user_email || "Unknown FE"}</h4>
                  <span className={`bd-live-pill ${loc.isLive ? "live" : "stale"}`}>
                    {loc.isLive ? "LIVE" : "STALE"}
                  </span>
                </div>
                <p>{loc.taskTitle || taskTitle(loc.tasks)}</p>
                <p>{loc.taskSubTitle || taskSubTitle(loc.tasks)}</p>
              </div>

              <div className="bd-live-info-cell">
                <span>Latest GPS</span>
                <strong>{formatDateTime(loc.created_at)}</strong>
              </div>

              <div className="bd-live-info-cell">
                <span>Last Seen</span>
                <strong>{loc.lastSeenText || freshText(loc.created_at)}</strong>
              </div>

              <div className="bd-live-info-cell">
                <span>Lat / Lng</span>
                <strong>
                  {Number(loc.latitude).toFixed(5)}, {Number(loc.longitude).toFixed(5)}
                </strong>
              </div>
            </div>
          ))
        )}

        {tasksWithoutGps.length > 0 && (
          <div className="bd-live-no-gps">
            <h4>In-process tasks waiting for first GPS</h4>
            <ul>
              {tasksWithoutGps.slice(0, 6).map((task) => (
                <li key={task.id}>
                  {task.market || "Market not set"} • {task.target_name || "Target not set"} • {task.test_type || "Test type not set"}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
