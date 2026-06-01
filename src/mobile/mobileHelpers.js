import {
  assignmentEmailFields,
  assignmentFields,
  assignedStatuses,
  CHECKLIST_ITEMS,
  completedStatuses,
  GPS_SYSTEM_COMMENTS,
  inProcessStatuses,
  onHoldStatuses,
} from "./mobileConstants";

export function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeStatus(status) {
  return normalizeText(status || "assigned");
}

export function normalizeStatusClass(status) {
  return normalizeStatus(status).replaceAll(" ", "_").replaceAll("-", "_");
}

export function isAssignedTask(task) {
  return assignedStatuses.includes(normalizeStatus(task?.status));
}

export function isInProcessTask(task) {
  return inProcessStatuses.includes(normalizeStatus(task?.status));
}

export function isOnHoldTask(task) {
  return onHoldStatuses.includes(normalizeStatus(task?.status));
}

export function isCompletedTask(task) {
  return completedStatuses.includes(normalizeStatus(task?.status));
}

export function isActiveFieldTask(task) {
  return isAssignedTask(task) || isInProcessTask(task) || isOnHoldTask(task);
}

export function formatTaskStatusLabel(status) {
  const normalized = normalizeStatus(status);

  if (assignedStatuses.includes(normalized)) return "Assigned";
  if (inProcessStatuses.includes(normalized)) return "In Progress";
  if (onHoldStatuses.includes(normalized)) return "On Hold";
  if (completedStatuses.includes(normalized)) return "Completed";

  return String(status || "assigned")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatSeverity(value) {
  const normalized = normalizeText(value || "normal");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function formatIssueStatus(status) {
  const normalized = normalizeText(status || "open");

  if (normalized === "pending_sync") return "Pending Sync";
  if (normalized === "in_review") return "In Review";
  if (normalized === "closed") return "Closed";
  if (normalized === "resolved") return "Resolved";

  return "Open";
}

export function getFirstValue(record, fields) {
  if (!record) return "";

  for (const field of fields) {
    const value = record[field];

    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  return "";
}

export function looksLikeUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(value || "").trim()
  );
}

export function getProjectDisplayNameFromRecord(record) {
  return getFirstValue(record, [
    "name",
    "project_name",
    "title",
    "label",
    "customer",
  ]);
}

export function getTaskProjectName(task) {
  const projectObjectName =
    typeof task?.project === "object" ? getProjectDisplayNameFromRecord(task.project) : "";

  const directProject =
    task?.project_name ||
    task?.project_title ||
    task?.customer_project ||
    projectObjectName ||
    getProjectDisplayNameFromRecord(task?._mobileProject);

  if (directProject && !looksLikeUuid(directProject)) {
    return directProject;
  }

  const looseProject = typeof task?.project === "string" ? task.project : "";

  if (looseProject && !looksLikeUuid(looseProject)) {
    return looseProject;
  }

  return "";
}

export function getGridDisplayNameFromRecord(record) {
  return getFirstValue(record, [
    "grid_name",
    "name",
    "grid_code",
    "grid_label",
    "target_name",
    "label",
    "title",
  ]);
}

export function getTaskGrid(task) {
  return (
    task?._mobileGridName ||
    task?.grid_name ||
    task?.grid_code ||
    task?.grid_label ||
    getGridDisplayNameFromRecord(task?._mobileGrid) ||
    task?.grid_id ||
    task?.target_name ||
    task?.target ||
    "Grid not set"
  );
}

export function getTaskTitle(task) {
  const projectName = getTaskProjectName(task);
  const gridName = getTaskGrid(task);
  const taskName = getFirstValue(task, [
    "task_name",
    "task_title",
    "title",
    "job_name",
    "work_order",
    "wo_number",
  ]);

  if (projectName && gridName && normalizeText(projectName) !== normalizeText(gridName)) {
    return `${projectName} • ${gridName}`;
  }

  if (taskName && gridName && normalizeText(taskName) !== normalizeText(gridName)) {
    return `${taskName} • ${gridName}`;
  }

  return projectName || taskName || gridName || "Assigned Task";
}

export function getTaskMarket(task) {
  return (
    task?.market ||
    task?.market_name ||
    task?._mobileGrid?.market ||
    task?._mobileProject?.market ||
    task?._mobileProject?.market_name ||
    "Market not set"
  );
}

export function getTaskStatus(task) {
  return task?.status || "assigned";
}

export function getTaskReference(task) {
  return (
    task?.task_ref ||
    task?.task_reference ||
    task?.task_number ||
    task?.work_order ||
    task?.wo_number ||
    task?.job_number ||
    task?.job_id ||
    task?.target_name ||
    task?.grid_name ||
    task?.name ||
    "Task"
  );
}

export function getTaskPriority(task) {
  return task?.priority || task?.priority_level || task?.urgency || task?.severity || "Normal";
}

export function normalizePriorityClass(priority) {
  return String(priority || "normal")
    .trim()
    .toLowerCase()
    .replaceAll(" ", "_")
    .replaceAll("-", "_");
}

export function getTaskCustomer(task) {
  return (
    task?.customer ||
    task?.customer_name ||
    task?.client ||
    task?.client_name ||
    task?._mobileProject?.customer ||
    task?._mobileProject?.customer_name ||
    task?._mobileProject?.client ||
    "Not set"
  );
}

export function getTaskTestingType(task) {
  return (
    task?.testing_type ||
    task?.project_testing_type ||
    task?._mobileProject?.testing_type ||
    task?._mobileProject?.test_type ||
    task?.test_type ||
    "Not set"
  );
}

export function getTargetType(task) {
  return (
    task?.target_type ||
    task?.assignment_target_type ||
    task?.target_kind ||
    task?.entity_type ||
    task?.scope_type ||
    task?.task_type ||
    "Not set"
  );
}

export function getTargetName(task) {
  return (
    task?.target_name ||
    task?.target ||
    task?.site_name ||
    task?.cluster_name ||
    task?.benchmark_name ||
    task?.route_name ||
    task?.task_name ||
    task?.name ||
    getTaskGrid(task) ||
    "Not set"
  );
}

export function getTaskScope(task) {
  return (
    task?.test_scope ||
    task?.scope ||
    task?.task_scope ||
    task?.drive_scope ||
    task?.testing_scope ||
    task?.work_scope ||
    task?.requirement ||
    task?.task_requirement ||
    task?.scope_notes ||
    task?.test_type ||
    task?.testing_type ||
    "Not set"
  );
}

export function getTaskEngineer(task, user) {
  return (
    task?.fe_email ||
    task?.assigned_fe_email ||
    task?.assigned_to_email ||
    task?.engineer_email ||
    task?.fe_name ||
    task?.engineer_name ||
    user?.email ||
    "Assigned FE"
  );
}

export function getTaskNotes(task) {
  return (
    task?.notes ||
    task?.note ||
    task?.assignment_notes ||
    task?.task_notes ||
    task?.description ||
    task?.comments ||
    task?.instructions ||
    task?.message ||
    task?.fe_instructions ||
    ""
  );
}

export function getTaskNotesPreview(task) {
  const notes = String(getTaskNotes(task) || "").trim();
  if (!notes) return "";
  return notes.length > 130 ? `${notes.slice(0, 130)}...` : notes;
}

export function normalizeChecklistKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function getChecklistItemConfigFromRow(row) {
  const labelKey = normalizeChecklistKey(row?.label);
  return (
    CHECKLIST_ITEMS.find((item) => normalizeChecklistKey(item.label) === labelKey) || null
  );
}

export function getChecklistItemIdFromRow(row) {
  const matched = getChecklistItemConfigFromRow(row);
  return matched?.id || normalizeChecklistKey(row?.label || row?.id);
}

export function getTaskChecklistRows(task) {
  const rows = Array.isArray(task?._mobileChecklistItems) ? task._mobileChecklistItems : [];
  return [...rows].sort((a, b) => Number(a.item_order || 0) - Number(b.item_order || 0));
}

export function getChecklistState(task) {
  const state = {};

  CHECKLIST_ITEMS.forEach((item) => {
    state[item.id] = false;
  });

  getTaskChecklistRows(task).forEach((row) => {
    const itemId = getChecklistItemIdFromRow(row);
    if (itemId) state[itemId] = Boolean(row.is_done);
  });

  return state;
}

export function getChecklistStats(task) {
  const state = getChecklistState(task);
  const total = CHECKLIST_ITEMS.length;
  const completed = CHECKLIST_ITEMS.filter((item) => Boolean(state[item.id])).length;

  return {
    completed,
    total,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
}

export function findChecklistRowForItem(task, itemId) {
  const targetItem = CHECKLIST_ITEMS.find((item) => item.id === itemId);
  const targetLabelKey = normalizeChecklistKey(targetItem?.label);

  return (
    getTaskChecklistRows(task).find((row) => {
      const rowItemId = getChecklistItemIdFromRow(row);
      const rowLabelKey = normalizeChecklistKey(row?.label);
      return rowItemId === itemId || (targetLabelKey && rowLabelKey === targetLabelKey);
    }) || null
  );
}

export function groupChecklistRows(rows) {
  const grouped = {};

  (rows || []).forEach((row) => {
    if (!row?.task_id) return;
    const taskId = String(row.task_id);
    if (!grouped[taskId]) grouped[taskId] = [];
    grouped[taskId].push(row);
  });

  Object.keys(grouped).forEach((taskId) => {
    grouped[taskId].sort((a, b) => Number(a.item_order || 0) - Number(b.item_order || 0));
  });

  return grouped;
}

export function groupIssueRows(rows) {
  const grouped = {};

  (rows || []).forEach((issue) => {
    if (!issue?.task_id) return;
    const taskId = String(issue.task_id);
    if (!grouped[taskId]) grouped[taskId] = [];
    grouped[taskId].push(issue);
  });

  Object.keys(grouped).forEach((taskId) => {
    grouped[taskId].sort((a, b) => {
      const aTime = new Date(a.created_at || 0).getTime();
      const bTime = new Date(b.created_at || 0).getTime();
      return bTime - aTime;
    });
  });

  return grouped;
}

export function getTaskIssues(task) {
  return Array.isArray(task?._mobileIssueReports) ? task._mobileIssueReports : [];
}

export function groupTaskUpdateRows(rows) {
  const grouped = {};

  (rows || []).forEach((update) => {
    if (!update?.task_id) return;
    const taskId = String(update.task_id);
    if (!grouped[taskId]) grouped[taskId] = [];
    grouped[taskId].push(update);
  });

  Object.keys(grouped).forEach((taskId) => {
    grouped[taskId].sort((a, b) => {
      const aTime = new Date(a.created_at || 0).getTime();
      const bTime = new Date(b.created_at || 0).getTime();
      return bTime - aTime;
    });
  });

  return grouped;
}

export function getTaskUpdates(task) {
  return Array.isArray(task?._mobileTaskUpdates) ? task._mobileTaskUpdates : [];
}

export function isGpsSystemUpdate(update) {
  const comment = normalizeText(update?.comment);
  if (update?.photo_url) return false;
  return GPS_SYSTEM_COMMENTS.includes(comment) || comment.startsWith("checklist gps:");
}

export function getTaskEvidenceUpdates(task) {
  return getTaskUpdates(task).filter((update) => !isGpsSystemUpdate(update));
}

export function getLatestTaskGpsUpdate(task) {
  return (
    getTaskUpdates(task).find(
      (update) =>
        update?.latitude !== undefined &&
        update?.latitude !== null &&
        update?.longitude !== undefined &&
        update?.longitude !== null
    ) || null
  );
}

export function getEvidenceStats(task) {
  const updates = getTaskEvidenceUpdates(task);
  const photos = updates.filter((update) => Boolean(update.photo_url)).length;
  const notes = updates.filter((update) => Boolean(String(update.comment || "").trim())).length;

  return { total: updates.length, notes, photos };
}

export function getRouteDisplayNameFromRecord(record) {
  return getFirstValue(record, [
    "route_name",
    "name",
    "saved_route_name",
    "title",
    "label",
    "grid_name",
  ]);
}

export function parseJsonMaybe(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getDirectCoordinates(record) {
  if (!record) return null;

  const lat = getFirstValue(record, [
    "grid_center_lat",
    "center_lat",
    "centroid_lat",
    "latitude",
    "lat",
    "target_lat",
    "start_lat",
  ]);

  const lng = getFirstValue(record, [
    "grid_center_lng",
    "grid_center_lon",
    "center_lng",
    "center_lon",
    "centroid_lng",
    "centroid_lon",
    "longitude",
    "lng",
    "lon",
    "target_lng",
    "target_lon",
    "start_lng",
    "start_lon",
  ]);

  const parsedLat = toNumber(lat);
  const parsedLng = toNumber(lng);

  if (parsedLat === null || parsedLng === null) return null;
  if (parsedLat === 0 && parsedLng === 0) return null;
  if (Math.abs(parsedLat) > 90 || Math.abs(parsedLng) > 180) return null;

  return { lat: parsedLat, lng: parsedLng };
}

export function normalizeCoordinatePair(a, b) {
  const first = toNumber(a);
  const second = toNumber(b);

  if (first === null || second === null) return null;

  if (Math.abs(first) > 90 && Math.abs(second) <= 90) return { lat: second, lng: first };
  if (Math.abs(second) > 90 && Math.abs(first) <= 90) return { lat: first, lng: second };

  return { lat: second, lng: first };
}

function collectCoordinateStringPoints(value, points = []) {
  if (typeof value !== "string") return false;

  const text = value.trim();
  if (!text || !text.includes(",")) return false;

  let found = false;

  text.split(/\s+/).forEach((token) => {
    const parts = token.split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) return;

    const pair = normalizeCoordinatePair(parts[0], parts[1]);
    if (pair) {
      points.push(pair);
      found = true;
    }
  });

  if (found) return true;

  const pairPattern = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*,\s*-?\d+(?:\.\d+)?)?/g;
  let match = pairPattern.exec(text);

  while (match) {
    const pair = normalizeCoordinatePair(match[1], match[2]);
    if (pair) {
      points.push(pair);
      found = true;
    }
    match = pairPattern.exec(text);
  }

  return found;
}

const GEOMETRY_FIELDS = [
  "geometry",
  "geom",
  "geojson",
  "geo_json",
  "route",
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
  "polygon",
  "polygon_json",
  "boundary",
  "boundary_json",
  "shape",
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

export function collectCoordinatePoints(value, points = []) {
  if (!value) return points;

  const parsed = parseJsonMaybe(value) || value;

  if (typeof parsed === "string") {
    collectCoordinateStringPoints(parsed, points);
    return points;
  }

  if (Array.isArray(parsed)) {
    if (parsed.length >= 2 && typeof parsed[0] !== "object" && typeof parsed[1] !== "object") {
      const pair = normalizeCoordinatePair(parsed[0], parsed[1]);
      if (pair) points.push(pair);
      return points;
    }

    parsed.forEach((item) => collectCoordinatePoints(item, points));
    return points;
  }

  if (typeof parsed === "object") {
    const direct = getDirectCoordinates(parsed);
    if (direct) points.push(direct);

    GEOMETRY_FIELDS.forEach((field) => {
      if (parsed[field]) collectCoordinatePoints(parsed[field], points);
    });
  }

  return points;
}

export function getCenterFromPoints(points) {
  const validPoints = points.filter(
    (point) =>
      point &&
      Number.isFinite(point.lat) &&
      Number.isFinite(point.lng) &&
      Math.abs(point.lat) <= 90 &&
      Math.abs(point.lng) <= 180 &&
      !(point.lat === 0 && point.lng === 0)
  );

  if (validPoints.length === 0) return null;

  const total = validPoints.reduce(
    (acc, point) => {
      acc.lat += point.lat;
      acc.lng += point.lng;
      return acc;
    },
    { lat: 0, lng: 0 }
  );

  return {
    lat: total.lat / validPoints.length,
    lng: total.lng / validPoints.length,
  };
}

export function getGeometryCoordinates(record) {
  if (!record) return null;

  const direct = getDirectCoordinates(record);
  if (direct) return direct;

  for (const field of GEOMETRY_FIELDS) {
    const value = record[field];
    if (!value) continue;

    const points = collectCoordinatePoints(value, []);
    const center = getCenterFromPoints(points);
    if (center) return center;
  }

  return null;
}

export function getGeometryPoints(record) {
  if (!record) return [];

  const points = [];
  const direct = getDirectCoordinates(record);
  if (direct) points.push(direct);

  GEOMETRY_FIELDS.forEach((field) => {
    if (record[field]) collectCoordinatePoints(record[field], points);
  });

  const seen = new Set();
  return points.filter((point) => {
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return false;
    if (Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) return false;
    if (point.lat === 0 && point.lng === 0) return false;
    const key = `${point.lat.toFixed(7)}:${point.lng.toFixed(7)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getTaskCoordinates(task) {
  return (
    getDirectCoordinates(task) ||
    getGeometryCoordinates(task?._mobileRoute) ||
    getGeometryCoordinates(task?._mobileGrid) ||
    null
  );
}

export function buildGoogleMapsUrl(task) {
  const coords = getTaskCoordinates(task);
  if (!coords) return "";
  return `https://www.google.com/maps/dir/?api=1&destination=${coords.lat},${coords.lng}`;
}

export function getTaskRouteName(task) {
  const explicitRoute =
    task?.assigned_route_name ||
    task?.saved_route_name ||
    task?.route_name ||
    getRouteDisplayNameFromRecord(task?._mobileRoute) ||
    task?.route_id ||
    task?.saved_route_id;

  if (explicitRoute && !looksLikeUuid(explicitRoute)) return explicitRoute;
  if (getGeometryCoordinates(task?._mobileRoute)) return "Saved route navigation ready";
  if (getGeometryCoordinates(task?._mobileGrid) || getDirectCoordinates(task)) return "Grid navigation ready";
  return "Assigned route not linked yet";
}

export function getTaskDueDateRaw(task) {
  return task?.due_date || task?.dueDate || task?.target_date || "";
}

export function formatDateTime(value) {
  if (!value) return "Not set";
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

export function formatShortDate(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

export function getGridMatchKeys(task) {
  return [task?.grid_id, task?.grid_name, task?.target_name, task?.target, task?.grid_code, task?.grid_label]
    .filter(Boolean)
    .map((value) => normalizeText(value));
}

export function recordMatchesKeys(record, keys) {
  if (!record || keys.length === 0) return false;

  const recordKeys = [
    record.id,
    record.grid_id,
    record.grid_name,
    record.name,
    record.grid_code,
    record.grid_label,
    record.target_name,
    record.label,
    record.title,
  ]
    .filter(Boolean)
    .map((value) => normalizeText(value));

  return recordKeys.some((recordKey) => keys.includes(recordKey));
}

export function findMatchingGrid(task, grids) {
  const keys = getGridMatchKeys(task);
  return grids.find((grid) => recordMatchesKeys(grid, keys)) || null;
}

export function findMatchingRoute(task, savedRoutes) {
  const taskId = task?.id ? normalizeText(task.id) : "";

  if (taskId) {
    const taskRouteMatch = savedRoutes.find((route) => {
      const routeTaskKeys = [route.task_id, route._mobileTaskId, route.assigned_task_id]
        .filter(Boolean)
        .map((value) => normalizeText(value));

      return routeTaskKeys.includes(taskId);
    });

    if (taskRouteMatch) return taskRouteMatch;
  }

  const directRouteKeys = [
    task?.saved_route_id,
    task?.route_id,
    task?.assigned_route_id,
    task?.assigned_route_name,
    task?.saved_route_name,
    task?.route_name,
  ]
    .filter(Boolean)
    .map((value) => normalizeText(value));

  if (directRouteKeys.length > 0) {
    const directMatch = savedRoutes.find((route) => {
      const routeKeys = [route.id, route.route_id, route.saved_route_id, route.route_name, route.name, route.title]
        .filter(Boolean)
        .map((value) => normalizeText(value));

      return routeKeys.some((key) => directRouteKeys.includes(key));
    });

    if (directMatch) return directMatch;
  }

  const gridKeys = getGridMatchKeys(task);

  return (
    savedRoutes.find((route) => {
      const routeGridKeys = [
        route.grid_id,
        route._mobileRouteGridId,
        route.grid_name,
        route._mobileGridNameFromLink,
        route.grid_code,
        route.target_name,
        route.name,
        route.route_name,
      ]
        .filter(Boolean)
        .map((value) => normalizeText(value));

      return routeGridKeys.some((key) => gridKeys.includes(key));
    }) || null
  );
}

export function findMatchingProject(task, projects) {
  const projectKeys = [task?.project_id, task?.project, task?.project_name, task?.project_title]
    .filter(Boolean)
    .map((value) => normalizeText(typeof value === "object" ? getProjectDisplayNameFromRecord(value) : value));

  if (projectKeys.length === 0) return null;

  return (
    projects.find((project) => {
      const recordKeys = [project.id, project.project_id, project.name, project.project_name, project.title, project.label]
        .filter(Boolean)
        .map((value) => normalizeText(value));

      return recordKeys.some((key) => projectKeys.includes(key));
    }) || null
  );
}

export function enrichTask(task, grids, savedRoutes, projects, checklistItemsByTask, issueReportsByTask, taskUpdatesByTask) {
  const matchingGrid = findMatchingGrid(task, grids);
  const matchingRoute = findMatchingRoute(task, savedRoutes);
  const matchingProject = findMatchingProject(task, projects);
  const gridName = getGridDisplayNameFromRecord(matchingGrid);

  return {
    ...task,
    _mobileGrid: matchingGrid,
    _mobileRoute: matchingRoute,
    _mobileProject: matchingProject,
    _mobileGridName: task.grid_name || task.grid_code || task.grid_label || gridName || "",
    _mobileChecklistItems: checklistItemsByTask?.[String(task.id)] || [],
    _mobileIssueReports: issueReportsByTask?.[String(task.id)] || [],
    _mobileTaskUpdates: taskUpdatesByTask?.[String(task.id)] || [],
  };
}

export function isAssignedToCurrentUser(task, user) {
  if (!user) return false;

  const userId = user.id;
  const userEmail = (user.email || "").toLowerCase();

  const hasKnownAssignmentField = assignmentFields.some((field) => task[field] !== undefined && task[field] !== null);
  const hasKnownEmailField = assignmentEmailFields.some((field) => task[field] !== undefined && task[field] !== null);

  const idMatch = assignmentFields.some((field) => {
    const value = task[field];
    return value && String(value) === String(userId);
  });

  const emailMatch = assignmentEmailFields.some((field) => {
    const value = task[field];
    return value && String(value).toLowerCase() === userEmail;
  });

  if (idMatch || emailMatch) return true;
  if (!hasKnownAssignmentField && !hasKnownEmailField) return true;
  return false;
}

function getTaskSortRank(task) {
  if (isInProcessTask(task)) return 0;
  if (isOnHoldTask(task)) return 1;
  if (isAssignedTask(task)) return 2;
  if (isCompletedTask(task)) return 4;
  return 3;
}

export function sortTasks(tasks) {
  return [...tasks].sort((a, b) => {
    const aRank = getTaskSortRank(a);
    const bRank = getTaskSortRank(b);

    if (aRank !== bRank) return aRank - bRank;

    const aDue = new Date(getTaskDueDateRaw(a) || a.created_at || 0).getTime();
    const bDue = new Date(getTaskDueDateRaw(b) || b.created_at || 0).getTime();

    if (aDue && bDue && aDue !== bDue) return aDue - bDue;
    return bDue - aDue;
  });
}

export function getTaskRouteMode(task) {
  return (
    task?._mobileRoute?.route_type ||
    task?._mobileRoute?.route_mode ||
    task?._mobileRoute?.mode ||
    task?._mobileRoute?.coverage_mode ||
    task?.route_type ||
    task?.route_mode ||
    task?.coverage_mode ||
    "Not set"
  );
}

export function getTaskRouteStatusInfo(task) {
  const hasSavedRouteRecord = Boolean(task?._mobileRoute);
  const hasSavedRouteGeometry = Boolean(getGeometryCoordinates(task?._mobileRoute));
  const hasGridNavigation = Boolean(getGeometryCoordinates(task?._mobileGrid) || getDirectCoordinates(task));
  const hasAnyNavigation = Boolean(getTaskCoordinates(task));

  if (hasSavedRouteRecord || hasSavedRouteGeometry) {
    return {
      key: "route_ready",
      label: "Route Ready",
      detail: "Saved route is linked. FE can open navigation from this route card.",
    };
  }

  if (hasGridNavigation || hasAnyNavigation) {
    return {
      key: "grid_navigation",
      label: "Grid Navigation Only",
      detail: "No saved route is linked yet. Navigation will use the grid center or task coordinates.",
    };
  }

  return {
    key: "missing_route",
    label: "Missing Route",
    detail: "No saved route or grid center was found for this assignment yet.",
  };
}

export function isRouteReadyForTask(task) {
  return getTaskRouteStatusInfo(task).key === "route_ready";
}

export function isGridNavigationOnlyForTask(task) {
  return getTaskRouteStatusInfo(task).key === "grid_navigation";
}

export function isRouteMissingForTask(task) {
  return getTaskRouteStatusInfo(task).key === "missing_route";
}
