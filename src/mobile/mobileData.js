import { supabase } from "../lib/supabaseClient";
import { CHECKLIST_ITEMS } from "./mobileConstants";
import {
  getGridDisplayNameFromRecord,
  groupChecklistRows,
  groupIssueRows,
  groupTaskUpdateRows,
} from "./mobileHelpers";

export async function fetchAndEnsureChecklistRows(taskList) {
  const taskIds = (taskList || []).map((task) => task.id).filter(Boolean);

  if (taskIds.length === 0) return {};

  let { data, error } = await supabase
    .from("task_checklist_items")
    .select("*")
    .in("task_id", taskIds)
    .order("item_order", { ascending: true });

  if (error) {
    console.warn("BabyDragon mobile could not load task_checklist_items:", error.message);
    return {};
  }

  const existingRows = data || [];
  const taskIdsWithChecklist = new Set(existingRows.map((row) => String(row.task_id)));
  const missingRows = [];

  (taskList || []).forEach((task) => {
    if (!task?.id) return;
    if (taskIdsWithChecklist.has(String(task.id))) return;

    CHECKLIST_ITEMS.forEach((item, index) => {
      missingRows.push({
        task_id: task.id,
        label: item.label,
        item_order: index + 1,
        is_done: false,
        completed_by: null,
      });
    });
  });

  if (missingRows.length > 0) {
    const { error: insertError } = await supabase.from("task_checklist_items").insert(missingRows);

    if (insertError) {
      console.warn("BabyDragon mobile could not create checklist rows:", insertError.message);
    }

    const reloadResult = await supabase
      .from("task_checklist_items")
      .select("*")
      .in("task_id", taskIds)
      .order("item_order", { ascending: true });

    data = reloadResult.data || [];
    error = reloadResult.error;

    if (error) {
      console.warn("BabyDragon mobile could not reload checklist rows:", error.message);
      return groupChecklistRows(existingRows);
    }
  }

  return groupChecklistRows(data || []);
}

export async function fetchIssueReports(taskList) {
  const taskIds = (taskList || []).map((task) => task.id).filter(Boolean);

  if (taskIds.length === 0) return {};

  const { data, error } = await supabase
    .from("task_issue_reports")
    .select("*")
    .in("task_id", taskIds)
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("BabyDragon mobile could not load task_issue_reports:", error.message);
    return {};
  }

  return groupIssueRows(data || []);
}

export async function fetchTaskUpdates(taskList) {
  const taskIds = (taskList || []).map((task) => task.id).filter(Boolean);

  if (taskIds.length === 0) return {};

  const { data, error } = await supabase
    .from("task_updates")
    .select("*")
    .in("task_id", taskIds)
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("BabyDragon mobile could not load task_updates:", error.message);
    return {};
  }

  return groupTaskUpdateRows(data || []);
}


export async function fetchRoutesForTasks(taskList, gridRecords = []) {
  const tasks = Array.isArray(taskList) ? taskList : [];
  const taskIds = tasks.map((task) => task?.id).filter(Boolean);

  if (taskIds.length === 0) return [];

  const directTaskGridLinks = tasks
    .map((task) => ({
      task_id: task.id,
      grid_id: task.grid_id || task.assigned_grid_id || task.target_grid_id || "",
    }))
    .filter((item) => item.task_id && item.grid_id);

  let taskGridRows = [];

  const { data: taskGridData, error: taskGridError } = await supabase
    .from("task_grids")
    .select("*")
    .in("task_id", taskIds);

  if (taskGridError) {
    console.warn("BabyDragon mobile could not load task_grids for route lookup:", taskGridError.message);
    taskGridRows = directTaskGridLinks;
  } else {
    taskGridRows = [...(taskGridData || []), ...directTaskGridLinks];
  }

  const uniqueTaskGridRows = [];
  const seenTaskGridKeys = new Set();

  taskGridRows.forEach((row) => {
    if (!row?.task_id || !row?.grid_id) return;
    const key = `${row.task_id}:${row.grid_id}`;
    if (seenTaskGridKeys.has(key)) return;
    seenTaskGridKeys.add(key);
    uniqueTaskGridRows.push(row);
  });

  const gridIds = Array.from(new Set(uniqueTaskGridRows.map((row) => row.grid_id).filter(Boolean)));
  if (gridIds.length === 0) return [];

  const gridById = new Map();
  (gridRecords || []).forEach((grid) => {
    if (grid?.id) gridById.set(String(grid.id), grid);
  });

  const linkedRouteRows = [];
  let routeGridRows = [];

  const { data: routeGridData, error: routeGridError } = await supabase
    .from("route_grids")
    .select("*")
    .in("grid_id", gridIds);

  if (routeGridError) {
    console.warn("BabyDragon mobile could not load route_grids. Direct route lookup will still run:", routeGridError.message);
  } else {
    routeGridRows = routeGridData || [];
  }

  const routeIds = Array.from(new Set(routeGridRows.map((row) => row.route_id).filter(Boolean)));

  if (routeIds.length > 0) {
    const { data: linkedRoutesData, error: linkedRoutesError } = await supabase
      .from("routes")
      .select("*")
      .in("id", routeIds);

    if (linkedRoutesError) {
      console.warn("BabyDragon mobile could not load linked route records:", linkedRoutesError.message);
    } else {
      const linkedRouteById = new Map();
      (linkedRoutesData || []).forEach((route) => {
        if (route?.id) linkedRouteById.set(String(route.id), route);
      });

      routeGridRows.forEach((link) => {
        const route = linkedRouteById.get(String(link.route_id));
        if (!route) return;

        const gridId = String(link.grid_id || route.grid_id || "");
        const linkedGrid = gridById.get(gridId) || null;
        const linkedGridName = getGridDisplayNameFromRecord(linkedGrid) || link.grid_name || route.grid_name || "";
        const taskRowsForGrid = uniqueTaskGridRows.filter((taskGrid) => String(taskGrid.grid_id) === gridId);

        taskRowsForGrid.forEach((taskGrid) => {
          linkedRouteRows.push({
            ...route,
            task_id: taskGrid.task_id,
            _mobileTaskId: taskGrid.task_id,
            grid_id: link.grid_id || route.grid_id,
            grid_name: linkedGridName,
            _mobileRouteGridId: link.grid_id || route.grid_id,
            _mobileGridNameFromLink: linkedGridName,
            _mobileRouteLink: link,
            _mobileLinkedGrid: linkedGrid,
          });
        });
      });
    }
  }

  const directRouteRows = [];
  const { data: directRoutesData, error: directRoutesError } = await supabase
    .from("routes")
    .select("*")
    .in("grid_id", gridIds);

  if (directRoutesError) {
    console.warn("BabyDragon mobile could not load direct grid routes:", directRoutesError.message);
  } else {
    const directRoutes = directRoutesData || [];

    uniqueTaskGridRows.forEach((taskGrid) => {
      const gridId = String(taskGrid.grid_id || "");
      const linkedGrid = gridById.get(gridId) || null;
      const linkedGridName = getGridDisplayNameFromRecord(linkedGrid) || "";

      directRoutes
        .filter((route) => String(route.grid_id || route.gridId || route.grid_db_id || "") === gridId)
        .forEach((route) => {
          directRouteRows.push({
            ...route,
            task_id: taskGrid.task_id,
            _mobileTaskId: taskGrid.task_id,
            grid_id: route.grid_id || taskGrid.grid_id,
            grid_name: linkedGridName || route.grid_name || route.name || "",
            _mobileRouteGridId: route.grid_id || taskGrid.grid_id,
            _mobileGridNameFromLink: linkedGridName || route.grid_name || "",
            _mobileLinkedGrid: linkedGrid,
          });
        });
    });
  }

  const mobileRouteRecords = [];
  const seenRouteTaskKeys = new Set();

  [...linkedRouteRows, ...directRouteRows].forEach((route) => {
    if (!route?.task_id || !route?.id) return;
    const key = `${route.task_id}:${route.id}:${route._mobileRouteGridId || route.grid_id || ""}`;
    if (seenRouteTaskKeys.has(key)) return;
    seenRouteTaskKeys.add(key);
    mobileRouteRecords.push(route);
  });

  return mobileRouteRecords.sort((a, b) => {
    const aTime = new Date(a.generated_at || a.updated_at || a.created_at || 0).getTime();
    const bTime = new Date(b.generated_at || b.updated_at || b.created_at || 0).getTime();
    return bTime - aTime;
  });
}

export async function uploadTaskPhotoToStorage(taskId, photoFile) {
  if (!photoFile) return null;

  const originalName = photoFile.name || "photo.jpg";
  const fileExt = originalName.includes(".") ? originalName.split(".").pop() : "jpg";
  const safeExt = String(fileExt || "jpg").replace(/[^a-zA-Z0-9]/g, "") || "jpg";
  const fileName = `${taskId}/${Date.now()}_${Math.random().toString(16).slice(2)}.${safeExt}`;

  const { error: uploadError } = await supabase.storage.from("task-photos").upload(fileName, photoFile);
  if (uploadError) throw uploadError;

  const { data: publicUrlData } = supabase.storage.from("task-photos").getPublicUrl(fileName);
  return publicUrlData?.publicUrl || null;
}

export async function safeSelectAll(tableName) {
  const { data, error } = await supabase.from(tableName).select("*");

  if (error) {
    console.warn(`BabyDragon mobile could not load ${tableName}:`, error.message);
    return [];
  }

  return Array.isArray(data) ? data : [];
}
