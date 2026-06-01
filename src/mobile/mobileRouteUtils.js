// src/mobile/mobileRouteUtils.js

export const ASSIGNMENT_ID_FIELDS = [
  "fe_id",
  "assigned_fe_id",
  "assigned_to",
  "assigned_user_id",
  "engineer_id",
  "fe_user_id",
  "user_id",
];

export const ASSIGNMENT_EMAIL_FIELDS = [
  "fe_email",
  "assigned_fe_email",
  "assigned_to_email",
  "engineer_email",
  "email",
];

export const MOBILE_GPS_CACHE_PREFIX = "babydragon_mobile_last_gps_v1";

export function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

export function prettyText(value, fallback = "Not set") {
  const text = String(value || "").trim();
  if (!text) return fallback;
  return text
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getFirstValue(record, fields, fallback = "") {
  if (!record) return fallback;

  for (const field of fields) {
    const value = record[field];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  return fallback;
}

export function isAssignedToCurrentUser(task, user) {
  if (!task || !user) return false;

  const userId = String(user.id || "");
  const userEmail = normalizeText(user.email || "");

  const knownIdField = ASSIGNMENT_ID_FIELDS.some(
    (field) => task[field] !== undefined && task[field] !== null
  );
  const knownEmailField = ASSIGNMENT_EMAIL_FIELDS.some(
    (field) => task[field] !== undefined && task[field] !== null
  );

  const idMatch = ASSIGNMENT_ID_FIELDS.some((field) => {
    const value = task[field];
    return value !== undefined && value !== null && String(value) === userId;
  });

  const emailMatch = ASSIGNMENT_EMAIL_FIELDS.some((field) => {
    const value = task[field];
    return value && normalizeText(value) === userEmail;
  });

  if (idMatch || emailMatch) return true;
  return !knownIdField && !knownEmailField;
}

export function getTaskStatus(task) {
  return normalizeText(task?.status || "assigned");
}

export function isInProcessTask(task) {
  const status = getTaskStatus(task);
  return ["in_progress", "in-process", "in process", "started", "working"].includes(status);
}

export function getGridLabel(grid) {
  return String(
    getFirstValue(grid, [
      "grid_id",
      "grid_name",
      "grid_code",
      "name",
      "number",
      "Real_GridCode",
      "real_grid_code",
      "GRID_ID",
      "label",
      "title",
      "id",
    ], "Unknown Grid")
  );
}

export function getGridMarket(grid, task = null) {
  return String(
    getFirstValue(grid, ["market", "market_name", "Market", "MARKET"], "") ||
      getFirstValue(task, ["market", "market_name"], "") ||
      getFirstValue(task?.projects, ["market"], "") ||
      "No Market"
  );
}

export function getTaskTitle(task, grid = null) {
  const projectName =
    getFirstValue(task?.projects, ["name"], "") ||
    getFirstValue(task, ["project_name", "project", "task_name", "name"], "");
  const targetName = getFirstValue(task, ["target_name", "grid_name", "target", "name"], "");
  const gridName = grid ? getGridLabel(grid) : "";

  if (projectName && targetName && normalizeText(projectName) !== normalizeText(targetName)) {
    return `${projectName} • ${targetName}`;
  }

  if (projectName && gridName && normalizeText(projectName) !== normalizeText(gridName)) {
    return `${projectName} • ${gridName}`;
  }

  return projectName || targetName || gridName || "Assigned Route";
}

export function getTaskScope(task) {
  return String(
    getFirstValue(task, ["test_type", "task_type", "scope", "test_scope", "testing_type"], "") ||
      getFirstValue(task?.projects, ["testing_type"], "") ||
      "Not set"
  );
}

export function getTaskPriority(task) {
  return String(getFirstValue(task, ["priority", "priority_level", "urgency", "severity"], "normal"));
}

export function getTaskReference(task, grid = null) {
  const direct = getFirstValue(task, [
    "task_ref",
    "task_reference",
    "work_order",
    "wo_number",
    "job_number",
    "target_name",
    "grid_name",
  ], "");

  if (direct) return String(direct);
  return grid ? getGridLabel(grid) : "Task";
}

export function formatDate(value, fallback = "Not set") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatShortDate(value, fallback = "Not set") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

export function formatMeters(value) {
  const meters = Number(value);
  if (!Number.isFinite(meters) || meters <= 0) return "N/A";
  const miles = meters / 1609.344;
  if (miles >= 0.1) return `${miles.toFixed(2)} mi`;
  return `${Math.round(meters)} m`;
}

export function formatRouteMode(route) {
  const raw = getFirstValue(route, ["route_mode", "mode", "coverage_mode", "route_type"], "route");
  return prettyText(raw, "Route");
}

export function getRouteName(route, grid = null) {
  return String(
    getFirstValue(route, ["route_name", "name", "saved_route_name", "title", "label"], "") ||
      (grid ? `${getGridLabel(grid)} Route` : "Missing Route")
  );
}

export function getRouteLength(route) {
  return Number(
    getFirstValue(route, ["route_length_m", "length_m", "length", "distance_m", "route_distance_m"], 0)
  );
}

export function normalizeIdList(values) {
  return values
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== "")
    .map((value) => String(value));
}

export function getGridMatchKeys(grid) {
  if (!grid) return [];
  return normalizeIdList([
    grid.id,
    grid.grid_id,
    grid.grid_db_id,
    grid.grid_code,
    grid.grid_name,
    grid.name,
    grid.number,
    grid.Real_GridCode,
    grid.real_grid_code,
    grid.GRID_ID,
  ]);
}

export function getTaskGridKeys(task) {
  if (!task) return [];
  return normalizeIdList([
    task.grid_id,
    task.grid_db_id,
    task.grid_name,
    task.grid_code,
    task.grid_label,
    task.target_name,
    task.target,
  ]);
}

export function routeMatchesGrid(route, grid, routeGrids = []) {
  if (!route || !grid) return false;

  const gridKeys = getGridMatchKeys(grid);
  const routeGridKeys = normalizeIdList([
    route.grid_id,
    route.grid_db_id,
    route.gridId,
    route.grid_name,
    route.grid_code,
    route.target_name,
  ]);

  if (routeGridKeys.some((key) => gridKeys.includes(key))) return true;

  const routeId = String(route.id || route.route_id || route.saved_route_id || "");
  if (!routeId) return false;

  return routeGrids.some((link) => {
    const linkRoute = String(link.route_id || link.saved_route_id || link.id || "");
    const linkGrid = String(link.grid_id || link.grid_db_id || "");
    return linkRoute === routeId && gridKeys.includes(linkGrid);
  });
}

export function findRouteForGrid(grid, routes, routeGrids = []) {
  if (!grid) return null;
  return (
    (routes || []).find((route) => routeMatchesGrid(route, grid, routeGrids)) ||
    null
  );
}

export function findGridForTask(task, grids) {
  const taskKeys = getTaskGridKeys(task);
  if (!taskKeys.length) return null;

  return (
    (grids || []).find((grid) => {
      const gridKeys = getGridMatchKeys(grid);
      return gridKeys.some((key) => taskKeys.includes(key));
    }) || null
  );
}

export function getLinkedGridIdsForTask(task, taskGrids) {
  const taskId = String(task?.id || "");
  if (!taskId) return [];

  const linkedIds = (taskGrids || [])
    .filter((item) => String(item.task_id || "") === taskId)
    .map((item) => item.grid_id || item.grid_db_id)
    .filter(Boolean);

  if (linkedIds.length) return normalizeIdList(linkedIds);
  return getTaskGridKeys(task);
}

export function findGridsForTask(task, grids, taskGrids) {
  const keys = getLinkedGridIdsForTask(task, taskGrids);
  if (!keys.length) {
    const fallback = findGridForTask(task, grids);
    return fallback ? [fallback] : [];
  }

  const matches = (grids || []).filter((grid) => {
    const gridKeys = getGridMatchKeys(grid);
    return gridKeys.some((key) => keys.includes(key));
  });

  if (matches.length) return matches;

  const fallback = findGridForTask(task, grids);
  return fallback ? [fallback] : [];
}

export function parseMaybeJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function normalizeGeometry(value) {
  if (!value) return null;

  const parsed = parseMaybeJson(value) || value;

  if (parsed?.type === "Feature") return parsed.geometry || null;

  if (parsed?.type === "FeatureCollection") {
    const feature = parsed.features?.find((item) =>
      ["Polygon", "MultiPolygon"].includes(item?.geometry?.type)
    );
    return feature?.geometry || null;
  }

  if (["Polygon", "MultiPolygon"].includes(parsed?.type)) return parsed;

  if (typeof parsed === "string") {
    return parseWktPolygon(parsed);
  }

  return null;
}

export function buildGridFeature(grid) {
  if (!grid) return null;

  const candidates = [
    grid.geometry,
    grid.geojson,
    grid.geo_json,
    grid.geom,
    grid.polygon,
    grid.polygon_json,
    grid.boundary,
    grid.boundary_json,
    grid.coordinates,
    grid.kml_coordinates,
    grid.kml,
  ];

  for (const candidate of candidates) {
    const geometry = normalizeGeometry(candidate);
    if (geometry) {
      return {
        type: "Feature",
        properties: { ...grid },
        geometry,
      };
    }
  }

  return null;
}

export function parseWktPolygon(wkt) {
  if (!wkt || typeof wkt !== "string") return null;

  const text = wkt.trim();
  if (!text.toUpperCase().startsWith("POLYGON")) return null;

  const body = text.replace(/^POLYGON\s*\(\(/i, "").replace(/\)\)\s*$/i, "");

  const ring = body
    .split(",")
    .map((pair) => {
      const [lng, lat] = pair.trim().split(/\s+/).map(Number);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return [lng, lat];
    })
    .filter(Boolean);

  if (ring.length < 4) return null;
  return { type: "Polygon", coordinates: [ring] };
}

export function parseRouteGeojson(route) {
  if (!route) return null;

  const routeLike =
    route.route_geojson ||
    route.geojson ||
    route.geo_json ||
    route.geometry ||
    route.route_path ||
    route.path ||
    route.points ||
    route.route_points ||
    route.coordinates ||
    route;

  const parsed = parseMaybeJson(routeLike) || routeLike;

  if (!parsed) return null;

  if (parsed.type === "FeatureCollection") return parsed;
  if (parsed.type === "Feature") return { type: "FeatureCollection", features: [parsed] };

  if (["LineString", "MultiLineString"].includes(parsed.type)) {
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: parsed }],
    };
  }

  const points = collectLatLngPoints(parsed);
  if (points.length >= 2) {
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: points.map((point) => [point.lng, point.lat]),
          },
        },
      ],
    };
  }

  return null;
}

export function isValidLngLat(value) {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(Number(value[0])) &&
    Number.isFinite(Number(value[1])) &&
    Math.abs(Number(value[0])) <= 180 &&
    Math.abs(Number(value[1])) <= 90
  );
}

export function normalizeLatLngPair(a, b) {
  const first = Number(a);
  const second = Number(b);

  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;

  if (Math.abs(first) <= 90 && Math.abs(second) <= 180) {
    return { lat: first, lng: second };
  }

  if (Math.abs(second) <= 90 && Math.abs(first) <= 180) {
    return { lat: second, lng: first };
  }

  return null;
}

export function collectLatLngPoints(value, points = []) {
  if (!value) return points;

  const parsed = parseMaybeJson(value) || value;

  if (Array.isArray(parsed)) {
    if (parsed.length >= 2 && typeof parsed[0] !== "object" && typeof parsed[1] !== "object") {
      const pair = normalizeLatLngPair(parsed[0], parsed[1]);
      if (pair) points.push(pair);
      return points;
    }

    parsed.forEach((item) => collectLatLngPoints(item, points));
    return points;
  }

  if (typeof parsed === "object") {
    const direct = getDirectLatLng(parsed);
    if (direct) points.push(direct);

    if (parsed.coordinates) collectLatLngPoints(parsed.coordinates, points);
    if (parsed.geometry) collectLatLngPoints(parsed.geometry, points);
    if (parsed.features) collectLatLngPoints(parsed.features, points);
    if (parsed.path) collectLatLngPoints(parsed.path, points);
    if (parsed.points) collectLatLngPoints(parsed.points, points);
    if (parsed.route_points) collectLatLngPoints(parsed.route_points, points);
    if (parsed.latlngs) collectLatLngPoints(parsed.latlngs, points);
  }

  return points;
}

export function getDirectLatLng(record) {
  if (!record) return null;

  const lat = getFirstValue(record, [
    "latitude",
    "lat",
    "center_lat",
    "grid_center_lat",
    "centroid_lat",
    "target_lat",
  ], "");
  const lng = getFirstValue(record, [
    "longitude",
    "lng",
    "lon",
    "center_lng",
    "center_lon",
    "grid_center_lng",
    "grid_center_lon",
    "centroid_lng",
    "centroid_lon",
    "target_lng",
    "target_lon",
  ], "");

  const parsedLat = Number(lat);
  const parsedLng = Number(lng);

  if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) return null;
  if (Math.abs(parsedLat) > 90 || Math.abs(parsedLng) > 180) return null;
  if (parsedLat === 0 && parsedLng === 0) return null;

  return { lat: parsedLat, lng: parsedLng };
}

export function extractRoutePoints(routeGeojson) {
  const points = [];

  if (!routeGeojson?.features?.length) return points;

  routeGeojson.features.forEach((feature) => {
    const geometry = feature?.geometry;
    if (!geometry) return;

    if (geometry.type === "LineString") {
      geometry.coordinates?.forEach((pair) => {
        if (isValidLngLat(pair)) points.push({ lng: Number(pair[0]), lat: Number(pair[1]) });
      });
    }

    if (geometry.type === "MultiLineString") {
      geometry.coordinates?.forEach((line) => {
        line?.forEach((pair) => {
          if (isValidLngLat(pair)) points.push({ lng: Number(pair[0]), lat: Number(pair[1]) });
        });
      });
    }
  });

  return points;
}

export function getFeatureCenter(feature) {
  const points = collectLatLngPoints(feature?.geometry || feature, []);
  return getCenterFromLatLngPoints(points);
}

export function getCenterFromLatLngPoints(points) {
  const valid = (points || []).filter(
    (point) =>
      Number.isFinite(Number(point?.lat)) &&
      Number.isFinite(Number(point?.lng)) &&
      Math.abs(Number(point.lat)) <= 90 &&
      Math.abs(Number(point.lng)) <= 180 &&
      !(Number(point.lat) === 0 && Number(point.lng) === 0)
  );

  if (!valid.length) return null;

  const total = valid.reduce(
    (acc, point) => ({ lat: acc.lat + Number(point.lat), lng: acc.lng + Number(point.lng) }),
    { lat: 0, lng: 0 }
  );

  return { lat: total.lat / valid.length, lng: total.lng / valid.length };
}

export function buildNavigationUrl(row) {
  const routeGeojson = parseRouteGeojson(row?.route);
  const routePoints = extractRoutePoints(routeGeojson);
  const target = routePoints[0] || getFeatureCenter(buildGridFeature(row?.grid));

  if (!target) return "";

  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    `${target.lat},${target.lng}`
  )}&travelmode=driving`;
}

export function getTaskGpsPoints(updates = []) {
  return [...updates]
    .filter((update) => {
      const lat = Number(update.latitude ?? update.lat);
      const lng = Number(update.longitude ?? update.lon ?? update.lng);
      return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
    })
    .sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime())
    .map((update) => ({
      lat: Number(update.latitude ?? update.lat),
      lng: Number(update.longitude ?? update.lon ?? update.lng),
      time: update.created_at || null,
      comment: update.comment || "GPS point",
    }));
}

export function classifyGpsTrail(gpsPoints, routeGeojson, thresholdMeters = 75) {
  const routePoints = extractRoutePoints(routeGeojson);
  if (!gpsPoints?.length) return { onRouteSegments: [], offRouteSegments: [], offRouteCount: 0 };

  const segments = {
    onRouteSegments: [],
    offRouteSegments: [],
    offRouteCount: 0,
  };

  for (let index = 1; index < gpsPoints.length; index += 1) {
    const start = gpsPoints[index - 1];
    const end = gpsPoints[index];
    const distance = routePoints.length >= 2 ? getDistanceToPolylineMeters(end, routePoints) : null;
    const onRoute = distance !== null && distance <= thresholdMeters;

    if (onRoute) {
      segments.onRouteSegments.push([start, end]);
    } else {
      segments.offRouteSegments.push([start, end]);
      segments.offRouteCount += 1;
    }
  }

  return segments;
}

export function getDistanceToPolylineMeters(point, linePoints) {
  if (!point || !linePoints || linePoints.length < 2) return null;

  let minDistance = Infinity;

  for (let index = 1; index < linePoints.length; index += 1) {
    const start = linePoints[index - 1];
    const end = linePoints[index];
    const distance = distanceToSegmentMeters(point, start, end);
    if (distance < minDistance) minDistance = distance;
  }

  return Number.isFinite(minDistance) ? minDistance : null;
}

export function distanceToSegmentMeters(point, start, end) {
  const metersPerDegreeLat = 111320;
  const latRad = (Number(point.lat) * Math.PI) / 180;
  const metersPerDegreeLng = Math.cos(latRad) * 111320;

  const px = Number(point.lng) * metersPerDegreeLng;
  const py = Number(point.lat) * metersPerDegreeLat;
  const ax = Number(start.lng) * metersPerDegreeLng;
  const ay = Number(start.lat) * metersPerDegreeLat;
  const bx = Number(end.lng) * metersPerDegreeLng;
  const by = Number(end.lat) * metersPerDegreeLat;

  const dx = bx - ax;
  const dy = by - ay;

  if (dx === 0 && dy === 0) return haversineMeters(point, start);

  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  const projected = {
    lng: (ax + t * dx) / metersPerDegreeLng,
    lat: (ay + t * dy) / metersPerDegreeLat,
  };

  return haversineMeters(point, projected);
}

export function haversineMeters(a, b) {
  const radius = 6371000;
  const lat1 = (Number(a.lat) * Math.PI) / 180;
  const lat2 = (Number(b.lat) * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLng = ((Number(b.lng) - Number(a.lng)) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const value = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * radius * Math.asin(Math.sqrt(value));
}

export function readCachedMobileGps(userId) {
  try {
    const raw =
      localStorage.getItem(`${MOBILE_GPS_CACHE_PREFIX}_${userId || "unknown"}`) ||
      localStorage.getItem(`${MOBILE_GPS_CACHE_PREFIX}_last`);

    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const lat = Number(parsed.latitude ?? parsed.lat);
    const lng = Number(parsed.longitude ?? parsed.lng ?? parsed.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat === 0 && lng === 0) return null;

    return { ...parsed, latitude: lat, longitude: lng };
  } catch {
    return null;
  }
}

export function saveCachedMobileGps(userId, location, source = "route_page") {
  if (!location) return null;

  const lat = Number(location.latitude ?? location.lat);
  const lng = Number(location.longitude ?? location.lng ?? location.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;

  const payload = {
    latitude: lat,
    longitude: lng,
    accuracy: location.accuracy ?? null,
    source,
    cached_at: new Date().toISOString(),
    from_cache: Boolean(location.from_cache),
  };

  try {
    localStorage.setItem(`${MOBILE_GPS_CACHE_PREFIX}_last`, JSON.stringify(payload));
    if (userId) localStorage.setItem(`${MOBILE_GPS_CACHE_PREFIX}_${userId}`, JSON.stringify(payload));
  } catch {
    // Ignore storage errors in restricted mobile browsers.
  }

  return payload;
}

export function getCurrentLocationSafe(userId, options = {}) {
  const { allowCachedFallback = true, source = "route_page", timeout = 10000 } = options;

  return new Promise((resolve) => {
    const cached = readCachedMobileGps(userId);

    if (!navigator?.geolocation) {
      resolve(allowCachedFallback ? cached : null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const fresh = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy ?? null,
          from_cache: false,
        };
        resolve(saveCachedMobileGps(userId, fresh, source) || fresh);
      },
      () => resolve(allowCachedFallback ? cached : null),
      { enableHighAccuracy: true, timeout, maximumAge: 60000 }
    );
  });
}

export async function uploadTaskPhotoToStorage(supabase, taskId, photoFile) {
  if (!photoFile) return null;

  const originalName = photoFile.name || "photo.jpg";
  const fileExt = originalName.includes(".") ? originalName.split(".").pop() : "jpg";
  const safeExt = String(fileExt || "jpg").replace(/[^a-zA-Z0-9]/g, "") || "jpg";
  const fileName = `${taskId}/${Date.now()}_${Math.random().toString(16).slice(2)}.${safeExt}`;

  const { error } = await supabase.storage.from("task-photos").upload(fileName, photoFile);
  if (error) throw error;

  const { data } = supabase.storage.from("task-photos").getPublicUrl(fileName);
  return data?.publicUrl || null;
}
