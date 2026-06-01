import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import FELiveGpsMap from "./components/FELiveGpsMap";
import FERoutes from "./pages/FERoutes";
import {
  OFFLINE_ACTION_TYPES,
  getOfflineQueueCount,
  isBrowserOnline,
  syncOfflineQueue,
  tryOnlineThenQueue,
} from "./utils/offlineQueue";


const DEFAULT_CHECKLIST_ITEMS = [
  "Reached assigned grid/site",
  "Opened assigned route",
  "Started testing in RF tool",
  "Required drive/testing completed",
  "Logs collected in RF tool",
  "Logs uploaded/handed to team",
  "Photo/evidence added if needed",
  "Issue reported if any",
];

const ISSUE_TYPES = [
  "No access",
  "Private road",
  "Unsafe area",
  "Weather delay",
  "Equipment issue",
  "Route issue",
  "Log issue",
  "Need re-drive",
  "Other",
];

const ISSUE_SEVERITIES = ["normal", "low", "high", "urgent"];


const FE_DASHBOARD_CACHE_PREFIX = "babydragon_fe_dashboard_cache_v1";
const AUTH_CACHE_KEY = "babydragon_cached_auth_v1";
const FE_GPS_CACHE_PREFIX = "babydragon_fe_last_gps_v1";
const FE_FETCH_TIMEOUT_MS = 7000;

function withTimeout(promise, timeoutMs, label = "Request timed out") {
  let timer;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function getFeDashboardCacheKey(userId) {
  return `${FE_DASHBOARD_CACHE_PREFIX}_${userId || "unknown"}`;
}

function getFeGpsCacheKey(userId) {
  return `${FE_GPS_CACHE_PREFIX}_${userId || "unknown"}`;
}

function readCachedFeGps(userId) {
  try {
    const raw =
      localStorage.getItem(getFeGpsCacheKey(userId)) ||
      localStorage.getItem(`${FE_GPS_CACHE_PREFIX}_last`);

    if (!raw) return null;

    const cached = JSON.parse(raw);

    if (!cached?.latitude || !cached?.longitude) return null;

    return cached;
  } catch (error) {
    console.warn("Failed to read cached FE GPS:", error);
    return null;
  }
}

function saveCachedFeGps(userId, location, source = "browser") {
  if (!location?.latitude || !location?.longitude) return null;

  const gps = {
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
    accuracy: location.accuracy ?? null,
    source,
    cached_at: new Date().toISOString(),
  };

  try {
    localStorage.setItem(`${FE_GPS_CACHE_PREFIX}_last`, JSON.stringify(gps));

    if (userId) {
      localStorage.setItem(getFeGpsCacheKey(userId), JSON.stringify(gps));
    }
  } catch (error) {
    console.warn("Failed to save cached FE GPS:", error);
  }

  return gps;
}

function readCachedAuthUser() {
  try {
    const raw = localStorage.getItem(AUTH_CACHE_KEY);
    if (!raw) return null;

    const cached = JSON.parse(raw);
    return cached?.user?.id ? cached.user : null;
  } catch (error) {
    console.warn("Failed to read cached auth user:", error);
    return null;
  }
}

function readFeDashboardCache(userId) {
  try {
    const raw = localStorage.getItem(getFeDashboardCacheKey(userId));
    if (!raw) return null;

    return JSON.parse(raw);
  } catch (error) {
    console.warn("Failed to read FE dashboard cache:", error);
    return null;
  }
}

function saveFeDashboardCache(userId, data) {
  if (!userId) return;

  try {
    localStorage.setItem(
      getFeDashboardCacheKey(userId),
      JSON.stringify({
        ...data,
        cached_at: new Date().toISOString(),
      })
    );
  } catch (error) {
    console.warn("Failed to save FE dashboard cache:", error);
  }
}

function getDefaultIssueInput() {
  return {
    issue_type: "No access",
    severity: "normal",
    description: "",
  };
}

export default function FEDashboard({ user: appUser, onLogout, offlineMode = false } = {}) {
  const [activeTab, setActiveTab] = useState(() => {
    return localStorage.getItem("feActiveTab") || "tasks";
  });

  const [themeMode, setThemeMode] = useState(() => {
    return localStorage.getItem("babyDragonTheme") || "night";
  });

  const [tasks, setTasks] = useState([]);
  const [updates, setUpdates] = useState({});
  const [taskRoutes, setTaskRoutes] = useState({});
  const [expandedTaskId, setExpandedTaskId] = useState("");
  const [checklists, setChecklists] = useState({});
  const [issues, setIssues] = useState({});
  const [issueInputs, setIssueInputs] = useState({});
  const [savingChecklistId, setSavingChecklistId] = useState("");
  const [submittingIssueTaskId, setSubmittingIssueTaskId] = useState(null);

  const [commentInputs, setCommentInputs] = useState(() => {
    const saved = localStorage.getItem("feCommentInputs");
    if (!saved) return {};

    try {
      return JSON.parse(saved);
    } catch {
      localStorage.removeItem("feCommentInputs");
      return {};
    }
  });

  const [photoInputs, setPhotoInputs] = useState({});
  const [uploadingTaskId, setUploadingTaskId] = useState(null);
  const [message, setMessage] = useState("");
  const [offlineCount, setOfflineCount] = useState(0);
  const [syncingOffline, setSyncingOffline] = useState(false);
  const [isOnline, setIsOnline] = useState(() => isBrowserOnline());
  const [usedOfflineBootCache, setUsedOfflineBootCache] = useState(() => !!offlineMode);
  const [lastGpsLocation, setLastGpsLocation] = useState(() => {
    return readCachedFeGps(appUser?.id || readCachedAuthUser()?.id);
  });
  const [gpsChecking, setGpsChecking] = useState(false);

  useEffect(() => {
    fetchTasks();
    refreshOfflineCount();
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      syncPendingOfflineActions({ silent: true });
    };

    const handleOffline = () => {
      setIsOnline(false);
      refreshOfflineCount();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const interval = setInterval(refreshOfflineCount, 10000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    localStorage.setItem("babyDragonTheme", themeMode);

    document.body.classList.toggle("bd-theme-day", themeMode === "day");
    document.body.classList.toggle("bd-theme-night", themeMode === "night");

    return () => {
      document.body.classList.remove("bd-theme-day");
      document.body.classList.remove("bd-theme-night");
    };
  }, [themeMode]);

  useEffect(() => {
    localStorage.setItem("feActiveTab", activeTab);
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem("feCommentInputs", JSON.stringify(commentInputs));
  }, [commentInputs]);

  useEffect(() => {
    const userId = appUser?.id || readCachedAuthUser()?.id;
    const cachedGps = readCachedFeGps(userId);

    if (cachedGps) {
      setLastGpsLocation(cachedGps);
    }
  }, [appUser?.id]);


  useEffect(() => {
    const userId = appUser?.id || readCachedAuthUser()?.id;

    if (!userId || tasks.length === 0) return;

    saveFeDashboardCache(userId, {
      tasks,
      updates,
      taskRoutes,
      checklists,
      issues,
    });
  }, [appUser?.id, tasks, updates, taskRoutes, checklists, issues]);

  useEffect(() => {
    const interval = setInterval(async () => {
      const activeTasks = tasks.filter((task) => task.status === "in_progress");

      if (activeTasks.length === 0) return;

      const user = await getEffectiveUser();

      if (!user) return;

      for (const task of activeTasks) {
        const location = await getCurrentLocation();

        if (!location?.latitude || !location?.longitude) continue;

        const gpsPayload = {
          task_id: task.id,
          user_id: user.id,
          user_email: user.email,
          comment: "Auto GPS point",
          photo_url: null,
          photo_file: null,
          latitude: location.latitude,
          longitude: location.longitude,
        };

        const gpsResult = await tryOnlineThenQueue({
          type: OFFLINE_ACTION_TYPES.GPS_POINT,
          table_name: "task_updates",
          payload: gpsPayload,
          note: "Auto GPS point queued from FE dashboard.",
          onlineAction: () => insertTaskUpdateOnline(gpsPayload),
        });

        if (gpsResult.queued) {
          console.warn("Auto GPS point queued for sync:", gpsResult.error);
          await refreshOfflineCount();
        }
      }

      await fetchTaskUpdates(user.id);
    }, 30000);

    return () => clearInterval(interval);
  }, [tasks]);

  async function refreshOfflineCount() {
    try {
      const count = await getOfflineQueueCount();
      setOfflineCount(count);
    } catch (error) {
      console.error("Offline queue count error:", error);
    }
  }

  async function insertTaskUpdateOnline(payload) {
    let photoUrl = payload.photo_url || null;
    const photoFile = payload.photo_file || null;

    if (photoFile) {
      const originalName = payload.photo_file_name || photoFile.name || "photo.jpg";
      const fileExt = originalName.includes(".")
        ? originalName.split(".").pop()
        : "jpg";
      const fileName = `${payload.task_id}/${Date.now()}_${Math.random()
        .toString(16)
        .slice(2)}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("task-photos")
        .upload(fileName, photoFile);

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from("task-photos")
        .getPublicUrl(fileName);

      photoUrl = publicUrlData.publicUrl;
    }

    const insertPayload = {
      task_id: payload.task_id,
      user_id: payload.user_id,
      user_email: payload.user_email,
      comment: payload.comment || "",
      photo_url: photoUrl,
      latitude: payload.latitude ?? null,
      longitude: payload.longitude ?? null,
    };

    const { data, error } = await supabase
      .from("task_updates")
      .insert(insertPayload)
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  async function syncPendingOfflineActions({ silent = false } = {}) {
    if (syncingOffline) return;

    if (!isBrowserOnline()) {
      setIsOnline(false);
      setMessage("You are offline. Pending items will sync when connection returns.");
      await refreshOfflineCount();
      return;
    }

    setSyncingOffline(true);

    try {
      const summary = await syncOfflineQueue(async (item) => {
        const payload = item.payload || {};

        if (
          item.type === OFFLINE_ACTION_TYPES.TASK_UPDATE ||
          item.type === OFFLINE_ACTION_TYPES.GPS_POINT ||
          item.type === OFFLINE_ACTION_TYPES.PHOTO_EVIDENCE
        ) {
          await insertTaskUpdateOnline(payload);
          return;
        }

        if (item.type === OFFLINE_ACTION_TYPES.CHECKLIST_ITEM) {
          const values = payload.values || {};
          const { error } = await supabase
            .from("task_checklist_items")
            .update(values)
            .eq("id", payload.item_id);

          if (error) throw error;
          return;
        }

        if (item.type === OFFLINE_ACTION_TYPES.ISSUE_REPORT) {
          const insertPayload = payload.insert || payload;
          const { error } = await supabase
            .from("task_issue_reports")
            .insert(insertPayload);

          if (error) throw error;
          return;
        }

        if (item.table_name) {
          const { error } = await supabase.from(item.table_name).insert(payload);
          if (error) throw error;
          return;
        }

        throw new Error(`Unsupported offline action type: ${item.type}`);
      });

      await refreshOfflineCount();

      const user = await getEffectiveUser();

      if (summary.synced > 0) {
        await fetchTasks();
        if (user) await fetchTaskUpdates(user.id);
      }

      if (!silent || summary.synced > 0 || summary.failed > 0) {
        if (summary.failed > 0) {
          setMessage(
            `Pending sync finished with ${summary.synced} synced and ${summary.failed} still pending.`
          );
        } else if (summary.synced > 0) {
          setMessage(`Synced ${summary.synced} pending item${summary.synced === 1 ? "" : "s"}.`);
        } else if (!silent) {
          setMessage("No pending items to sync.");
        }
      }
    } catch (error) {
      console.error("Offline sync error:", error);
      setMessage("Pending sync failed. Please try again when signal is stable.");
    } finally {
      setSyncingOffline(false);
      await refreshOfflineCount();
    }
  }

  async function getEffectiveUser() {
    if (appUser?.id) return appUser;

    try {
      const { data, error } = await withTimeout(
        supabase.auth.getUser(),
        FE_FETCH_TIMEOUT_MS,
        "User load timed out"
      );

      if (error) throw error;
      if (data?.user?.id) return data.user;
    } catch (error) {
      console.warn("Using cached FE user because auth user is unavailable:", error);
    }

    return readCachedAuthUser();
  }

  function loadFeDashboardFromCache(userId, reason = "Offline mode") {
    const cached = readFeDashboardCache(userId);

    if (!cached) return false;

    setTasks(cached.tasks || []);
    setUpdates(cached.updates || {});
    setTaskRoutes(cached.taskRoutes || {});
    setChecklists(cached.checklists || {});
    setIssues(cached.issues || {});
    setUsedOfflineBootCache(true);
    setMessage(
      `${reason}: showing last saved FE dashboard data from ${
        cached.cached_at ? new Date(cached.cached_at).toLocaleString() : "cache"
      }.`
    );

    return true;
  }

  async function fetchTasks() {
    const user = await getEffectiveUser();

    if (!user) {
      setMessage("Failed to load user. Reconnect internet and refresh.");
      return;
    }

    if (!isBrowserOnline()) {
      setIsOnline(false);

      if (loadFeDashboardFromCache(user.id, "No internet connection")) {
        await refreshOfflineCount();
        return;
      }

      setMessage("Offline and no saved task cache found. Open this FE dashboard once while online first.");
      return;
    }

    try {
      const { data, error } = await withTimeout(
        supabase
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
          .order("created_at", { ascending: false }),
        FE_FETCH_TIMEOUT_MS,
        "Task load timed out"
      );

      if (error) throw error;

      const safeTasks = data || [];

      setUsedOfflineBootCache(false);
      setTasks(safeTasks);
      await fetchTaskRoutes(safeTasks);
      await fetchTaskUpdates(user.id);
      await fetchChecklistItems(safeTasks, user.id);
      await fetchIssueReports(safeTasks);
    } catch (error) {
      console.error("Error loading FE tasks:", error);

      if (loadFeDashboardFromCache(user.id, "Supabase did not respond")) {
        await refreshOfflineCount();
        return;
      }

      setMessage("Failed to load tasks. Reconnect internet and refresh.");
    }
  }

  async function fetchTaskUpdates(userId) {
    try {
      const { data, error } = await withTimeout(
        supabase
          .from("task_updates")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false }),
        FE_FETCH_TIMEOUT_MS,
        "Task updates load timed out"
      );

      if (error) throw error;

      const grouped = {};

      (data || []).forEach((update) => {
        if (!grouped[update.task_id]) grouped[update.task_id] = [];
        grouped[update.task_id].push(update);
      });

      const latestGpsUpdate = (data || []).find(
        (update) => update.latitude && update.longitude
      );

      if (latestGpsUpdate) {
        const cachedGps = saveCachedFeGps(
          userId,
          {
            latitude: latestGpsUpdate.latitude,
            longitude: latestGpsUpdate.longitude,
          },
          "task_update"
        );

        if (cachedGps) setLastGpsLocation(cachedGps);
      }

      setUpdates(grouped);
      return grouped;
    } catch (error) {
      console.error("Error loading updates:", error);
      return updates;
    }
  }

  async function fetchTaskRoutes(taskList) {
    if (!taskList || taskList.length === 0) {
      setTaskRoutes({});
      return {};
    }

    const taskIds = taskList.map((task) => task.id);

    const { data: taskGridData, error: taskGridError } = await supabase
      .from("task_grids")
      .select("*")
      .in("task_id", taskIds);

    if (taskGridError) {
      console.error("FE task route task_grids error:", taskGridError);
      setTaskRoutes({});
      return {};
    }

    const safeTaskGrids = taskGridData || [];

    if (safeTaskGrids.length === 0) {
      setTaskRoutes({});
      return {};
    }

    const gridIds = Array.from(
      new Set(safeTaskGrids.map((item) => item.grid_id).filter(Boolean))
    );

    if (gridIds.length === 0) {
      setTaskRoutes({});
      return {};
    }

    const { data: gridData, error: gridError } = await supabase
      .from("grids")
      .select("*")
      .in("id", gridIds);

    if (gridError) {
      console.error("FE task route grids error:", gridError);
      setTaskRoutes({});
      return {};
    }

    const { data: routeGridData, error: routeGridError } = await supabase
      .from("route_grids")
      .select("*")
      .in("grid_id", gridIds);

    if (routeGridError) {
      console.error("FE task route route_grids error:", routeGridError);
      setTaskRoutes({});
      return {};
    }

    const safeRouteGrids = routeGridData || [];

    const routeIds = Array.from(
      new Set(safeRouteGrids.map((item) => item.route_id).filter(Boolean))
    );

    let routeData = [];

    if (routeIds.length > 0) {
      const { data: routesResult, error: routesError } = await supabase
        .from("routes")
        .select("*")
        .in("id", routeIds);

      if (routesError) {
        console.error("FE task route routes error:", routesError);
        setTaskRoutes({});
        return;
      }

      routeData = routesResult || [];
    }

    const gridById = {};
    const routeById = {};
    const routeLinksByGridId = {};

    (gridData || []).forEach((grid) => {
      gridById[grid.id] = grid;
    });

    routeData.forEach((route) => {
      routeById[route.id] = route;
    });

    safeRouteGrids.forEach((link) => {
      if (!routeLinksByGridId[link.grid_id]) {
        routeLinksByGridId[link.grid_id] = [];
      }

      routeLinksByGridId[link.grid_id].push(link);
    });

    const nextTaskRoutes = {};

    safeTaskGrids.forEach((taskGrid) => {
      const grid = gridById[taskGrid.grid_id];

      if (!grid) return;

      const routeLinks = routeLinksByGridId[taskGrid.grid_id] || [];

      const routesForGrid = routeLinks
        .map((link) => routeById[link.route_id])
        .filter(Boolean)
        .sort((a, b) => {
          const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
          const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
          return dateB - dateA;
        });

      const latestRoute = routesForGrid[0] || null;

      if (!nextTaskRoutes[taskGrid.task_id]) {
        nextTaskRoutes[taskGrid.task_id] = [];
      }

      const alreadyAdded = nextTaskRoutes[taskGrid.task_id].some(
        (item) => item.gridId === taskGrid.grid_id
      );

      if (alreadyAdded) return;

      nextTaskRoutes[taskGrid.task_id].push({
        gridId: taskGrid.grid_id,
        gridName: getGridLabel(grid),
        gridMarket: grid.market || grid.Market || grid.market_name || "",
        gridStatus: grid.status || grid.grid_status || "",
        gridBoundary: getGridBoundaryPayload(grid),
        gridRecord: getGridMapRecord(grid),
        routeName: latestRoute?.route_name || "No route created",
        routeType: latestRoute?.route_type || "N/A",
        routeStatus: latestRoute ? "Route Ready" : "Missing Route",
      });
    });

    setTaskRoutes(nextTaskRoutes);
    return nextTaskRoutes;
  }


  async function fetchChecklistItems(taskList, userId) {
    if (!taskList || taskList.length === 0) {
      setChecklists({});
      return {};
    }

    const taskIds = taskList.map((task) => task.id).filter(Boolean);

    if (taskIds.length === 0) {
      setChecklists({});
      return {};
    }

    let { data, error } = await supabase
      .from("task_checklist_items")
      .select("*")
      .in("task_id", taskIds)
      .order("item_order", { ascending: true });

    if (error) {
      console.error("Error loading checklist items:", error);
      return checklists;
    }

    const existingItems = data || [];
    const taskIdsWithChecklist = new Set(
      existingItems.map((item) => String(item.task_id))
    );

    const missingRows = [];

    taskList.forEach((task) => {
      if (taskIdsWithChecklist.has(String(task.id))) return;

      DEFAULT_CHECKLIST_ITEMS.forEach((label, index) => {
        missingRows.push({
          task_id: task.id,
          label,
          item_order: index + 1,
          is_done: false,
          completed_by: null,
        });
      });
    });

    if (missingRows.length > 0) {
      const { error: insertError } = await supabase
        .from("task_checklist_items")
        .insert(missingRows);

      if (insertError) {
        console.error("Error creating checklist items:", insertError);
      }

      const result = await supabase
        .from("task_checklist_items")
        .select("*")
        .in("task_id", taskIds)
        .order("item_order", { ascending: true });

      data = result.data || [];
      error = result.error;

      if (error) {
        console.error("Error reloading checklist items:", error);
        return checklists;
      }
    }

    const grouped = {};

    (data || []).forEach((item) => {
      if (!grouped[item.task_id]) grouped[item.task_id] = [];
      grouped[item.task_id].push(item);
    });

    Object.keys(grouped).forEach((taskId) => {
      grouped[taskId].sort(
        (a, b) => Number(a.item_order || 0) - Number(b.item_order || 0)
      );
    });

    setChecklists(grouped);
    return grouped;
  }

  async function toggleChecklistItem(item) {
    if (!item?.id) return;

    setSavingChecklistId(item.id);

    const user = await getEffectiveUser();

    const nextDone = !item.is_done;
    const now = new Date().toISOString();

    const payload = {
      is_done: nextDone,
      completed_at: nextDone ? now : null,
      completed_by: nextDone ? user?.id || null : null,
      updated_at: now,
    };

    const result = await tryOnlineThenQueue({
      type: OFFLINE_ACTION_TYPES.CHECKLIST_ITEM,
      table_name: "task_checklist_items",
      payload: {
        item_id: item.id,
        task_id: item.task_id,
        values: payload,
      },
      note: `Checklist update queued: ${item.label || item.id}`,
      onlineAction: () =>
        supabase
          .from("task_checklist_items")
          .update(payload)
          .eq("id", item.id)
          .select("*")
          .single(),
    });

    if (result.queued) {
      setMessage("Checklist saved locally. It will sync when connection is stable.");
      await refreshOfflineCount();
    }

    const nextItem = result.queued ? { ...item, ...payload } : result.result.data;

    setChecklists((prev) => {
      const next = { ...prev };
      const items = next[item.task_id] || [];

      next[item.task_id] = items.map((existing) =>
        existing.id === item.id ? nextItem : existing
      );

      return next;
    });

    setSavingChecklistId("");
  }

  async function fetchIssueReports(taskList) {
    if (!taskList || taskList.length === 0) {
      setIssues({});
      return {};
    }

    const taskIds = taskList.map((task) => task.id).filter(Boolean);

    if (taskIds.length === 0) {
      setIssues({});
      return {};
    }

    const { data, error } = await supabase
      .from("task_issue_reports")
      .select("*")
      .in("task_id", taskIds)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error loading issue reports:", error);
      return issues;
    }

    const grouped = {};

    (data || []).forEach((issue) => {
      if (!grouped[issue.task_id]) grouped[issue.task_id] = [];
      grouped[issue.task_id].push(issue);
    });

    setIssues(grouped);
    return grouped;
  }

  function updateIssueInput(taskId, field, value) {
    setIssueInputs((prev) => ({
      ...prev,
      [taskId]: {
        ...getDefaultIssueInput(),
        ...(prev[taskId] || {}),
        [field]: value,
      },
    }));
  }

  async function submitIssueReport(taskId) {
    const input = {
      ...getDefaultIssueInput(),
      ...(issueInputs[taskId] || {}),
    };

    if (!input.issue_type) {
      alert("Please select an issue type.");
      return;
    }

    if (!input.description.trim()) {
      alert("Please add a short issue note.");
      return;
    }

    const user = await getEffectiveUser();

    if (!user) {
      alert("Failed to load user.");
      return;
    }

    setSubmittingIssueTaskId(taskId);

    const location = await getCurrentLocation();

    const issuePayload = {
      task_id: taskId,
      issue_type: input.issue_type,
      severity: input.severity || "normal",
      description: input.description.trim(),
      status: "open",
      lat: location.latitude,
      lon: location.longitude,
      reported_by: user.id,
    };

    const result = await tryOnlineThenQueue({
      type: OFFLINE_ACTION_TYPES.ISSUE_REPORT,
      table_name: "task_issue_reports",
      payload: { insert: issuePayload },
      note: `Issue report queued for task ${taskId}`,
      onlineAction: () => supabase.from("task_issue_reports").insert(issuePayload),
    });

    setIssueInputs((prev) => ({
      ...prev,
      [taskId]: {
        ...getDefaultIssueInput(),
        description: "",
      },
    }));

    if (result.queued) {
      setIssues((prev) => ({
        ...prev,
        [taskId]: [
          {
            ...issuePayload,
            id: result.offlineItem.offline_id,
            created_at: result.offlineItem.created_at,
            status: "pending_sync",
          },
          ...(prev[taskId] || []),
        ],
      }));

      setMessage("Issue saved locally. It will sync when connection is stable.");
      await refreshOfflineCount();
    } else {
      await fetchIssueReports(tasks);
      setMessage("Issue report saved.");
    }

    setSubmittingIssueTaskId(null);
  }

  function formatIssueStatus(status) {
    if (status === "pending_sync") return "Pending Sync";
    if (status === "open") return "Open";
    if (status === "in_review") return "In Review";
    if (status === "resolved") return "Resolved";
    if (status === "closed") return "Closed";
    return status || "Open";
  }

  function formatSeverity(severity) {
    if (severity === "urgent") return "Urgent";
    if (severity === "high") return "High";
    if (severity === "low") return "Low";
    return "Normal";
  }

  async function getCurrentLocation(options = {}) {
    const { allowCachedFallback = false } = options;
    const user = appUser?.id ? appUser : readCachedAuthUser();
    const userId = user?.id || null;

    return new Promise((resolve) => {
      const cached = readCachedFeGps(userId);

      if (!navigator.geolocation) {
        resolve(
          allowCachedFallback && cached
            ? { ...cached, from_cache: true }
            : { latitude: null, longitude: null, from_cache: false }
        );
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const location = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy ?? null,
            from_cache: false,
          };

          const cachedGps = saveCachedFeGps(userId, location, "browser_gps");
          if (cachedGps) setLastGpsLocation(cachedGps);

          resolve(location);
        },
        () => {
          resolve(
            allowCachedFallback && cached
              ? { ...cached, from_cache: true }
              : { latitude: null, longitude: null, from_cache: false }
          );
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 60000,
        }
      );
    });
  }

  async function refreshGpsNow() {
    setGpsChecking(true);

    try {
      const location = await getCurrentLocation({ allowCachedFallback: true });

      if (location?.latitude && location?.longitude) {
        const userId = appUser?.id || readCachedAuthUser()?.id;

        if (!location.from_cache) {
          const cachedGps = saveCachedFeGps(userId, location, "manual_refresh");
          if (cachedGps) setLastGpsLocation(cachedGps);
          setMessage("GPS location refreshed locally.");
        } else {
          setLastGpsLocation(location);
          setMessage("Showing last cached GPS location. Fresh GPS was not available.");
        }
      } else {
        setMessage("GPS not available. Allow location permission or move to an area where device GPS can lock.");
      }
    } finally {
      setGpsChecking(false);
    }
  }

  async function saveSystemUpdate(taskId, commentText) {
    const user = await getEffectiveUser();

    if (!user) {
      alert("Failed to load user.");
      return;
    }

    const location = await getCurrentLocation();

    const updatePayload = {
      task_id: taskId,
      user_id: user.id,
      user_email: user.email,
      comment: commentText,
      photo_url: null,
      photo_file: null,
      latitude: location.latitude,
      longitude: location.longitude,
    };

    const result = await tryOnlineThenQueue({
      type: OFFLINE_ACTION_TYPES.TASK_UPDATE,
      table_name: "task_updates",
      payload: updatePayload,
      note: `System update queued: ${commentText}`,
      onlineAction: () => insertTaskUpdateOnline(updatePayload),
    });

    if (result.queued) {
      setMessage("System update saved locally for pending sync.");
      await refreshOfflineCount();
    }
  }

  async function updateTaskStatus(taskId, newStatus) {
    if (!isBrowserOnline()) {
      setIsOnline(false);
      setMessage("Task start/complete needs internet in V1. Notes, checklist, issues, GPS, and photos are protected by Pending Sync.");
      await refreshOfflineCount();
      return;
    }

    const updatesData = { status: newStatus };

    if (newStatus === "in_progress") {
      updatesData.started_at = new Date().toISOString();
    }

    if (newStatus === "completed") {
      updatesData.completed_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from("tasks")
      .update(updatesData)
      .eq("id", taskId);

    if (error) {
      console.error("Error updating task:", error);
      alert("Failed to update task.");
      return;
    }

    if (newStatus === "in_progress") {
      await saveSystemUpdate(taskId, "Task started");
    }

    if (newStatus === "completed") {
      await saveSystemUpdate(taskId, "Task completed");
    }

    const nextTasks = tasks.map((task) =>
      task.id === taskId ? { ...task, ...updatesData } : task
    );

    setTasks(nextTasks);
    await fetchTaskRoutes(nextTasks);

    const user = await getEffectiveUser();

    if (user) {
      await fetchTaskUpdates(user.id);
    }
  }

  async function submitTaskUpdate(taskId) {
    const user = await getEffectiveUser();

    if (!user) {
      alert("Failed to load user.");
      return;
    }

    const comment = commentInputs[taskId] || "";
    const photoFile = photoInputs[taskId];

    if (!comment.trim() && !photoFile) {
      alert("Please add a comment or photo.");
      return;
    }

    setUploadingTaskId(taskId);

    if (photoFile && photoFile.size > 5 * 1024 * 1024) {
      alert("File too large. Please upload image under 5MB.");
      setUploadingTaskId(null);
      return;
    }

    const location = await getCurrentLocation();

    const updatePayload = {
      task_id: taskId,
      user_id: user.id,
      user_email: user.email,
      comment: comment.trim(),
      photo_url: null,
      photo_file: photoFile || null,
      photo_file_name: photoFile?.name || null,
      photo_file_type: photoFile?.type || null,
      latitude: location.latitude,
      longitude: location.longitude,
    };

    const result = await tryOnlineThenQueue({
      type: photoFile
        ? OFFLINE_ACTION_TYPES.PHOTO_EVIDENCE
        : OFFLINE_ACTION_TYPES.TASK_UPDATE,
      table_name: "task_updates",
      payload: updatePayload,
      note: photoFile
        ? `Photo/evidence update queued for task ${taskId}`
        : `FE update queued for task ${taskId}`,
      onlineAction: () => insertTaskUpdateOnline(updatePayload),
    });

    if (result.queued) {
      setMessage("Update saved locally. It will sync when connection is stable.");
      await refreshOfflineCount();
    } else {
      setMessage("Update saved.");
      await fetchTaskUpdates(user.id);
    }

    const nextComments = { ...commentInputs, [taskId]: "" };

    setCommentInputs(nextComments);
    localStorage.setItem("feCommentInputs", JSON.stringify(nextComments));

    setPhotoInputs((prev) => ({ ...prev, [taskId]: null }));
    setUploadingTaskId(null);
  }

  function getGridBoundaryPayload(grid) {
    if (!grid) return null;

    return (
      grid.geojson ||
      grid.geo_json ||
      grid.geometry ||
      grid.geom ||
      grid.polygon ||
      grid.coordinates ||
      grid.boundary ||
      grid.shape ||
      grid.kml_coordinates ||
      grid.kml ||
      null
    );
  }

  function getGridMapRecord(grid) {
    if (!grid) return null;

    return {
      id: grid.id || grid.grid_id || null,
      name: getGridLabel(grid),
      market: grid.market || grid.Market || grid.market_name || "",
      status: grid.status || grid.grid_status || "",
      boundary: getGridBoundaryPayload(grid),
      geojson: grid.geojson || grid.geo_json || null,
      geometry: grid.geometry || grid.geom || null,
      polygon: grid.polygon || null,
      coordinates: grid.coordinates || null,
      kml_coordinates: grid.kml_coordinates || null,
    };
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

  function openRouteFromTask(gridId) {
    localStorage.setItem("feRouteSelectedGridId", gridId);
    setActiveTab("routes");
  }

  function getStatusColor(status) {
    if (status === "completed") return "#43ff9a";
    if (status === "in_progress") return "#00d4ff";
    if (status === "assigned") return "#ffd66b";
    return "#9fb2cf";
  }

  function getPriorityColor(priority) {
    if (priority === "urgent") return "#ff5c7a";
    if (priority === "high") return "#ff9f43";
    if (priority === "low") return "#9fb2cf";
    return "#e7eefb";
  }

  function formatStatus(status) {
    if (status === "assigned") return "Assigned";
    if (status === "in_progress") return "In Progress";
    if (status === "completed") return "Completed";
    return status || "Unknown";
  }

  return (
    <div className={`fe-page theme-${themeMode}`}>
      <style>{feThemeCss}</style>

      <div className="fe-topbar">
        <h2 className="fe-title">🚙 Field Engineer Dashboard</h2>
        <button
          type="button"
          className="fe-theme-toggle"
          onClick={() => setThemeMode((current) => (current === "night" ? "day" : "night"))}
          title="Switch day/night theme"
        >
          {themeMode === "night" ? "☀️ Day" : "🌙 Night"}
        </button>
      </div>

      <div style={styles.tabBar}>
        <button
          type="button"
          onClick={() => setActiveTab("tasks")}
          style={{
            ...styles.tabButton,
            ...(activeTab === "tasks" ? styles.activeTabButton : {}),
          }}
        >
          My Tasks
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("routes")}
          style={{
            ...styles.tabButton,
            ...(activeTab === "routes" ? styles.activeTabButton : {}),
          }}
        >
          My Routes
        </button>

        <button type="button" onClick={fetchTasks} style={styles.refreshButton}>
          Refresh
        </button>
      </div>

      <div className={`fe-sync-banner ${isOnline ? "online" : "offline"}`}>
        <div>
          <b>{isOnline ? "Online" : "Offline"}</b>
          <span>
            Pending Sync: {offlineCount}
            {offlineCount > 0 ? " item" + (offlineCount === 1 ? "" : "s") : ""}
          </span>
        </div>

        <button
          type="button"
          onClick={() => syncPendingOfflineActions()}
          disabled={syncingOffline || offlineCount === 0 || !isOnline}
        >
          {syncingOffline ? "Syncing..." : "Sync Now"}
        </button>
      </div>

      {message && <p className="fe-message">{message}</p>}

      {activeTab === "routes" && <FERoutes />}

      {activeTab === "tasks" &&
        (tasks.length === 0 ? (
          <div style={styles.emptyTaskState}>No assigned tasks.</div>
        ) : (
          <div style={styles.taskStack}>
            {tasks.map((task) => {
              const routes = taskRoutes[task.id] || [];
              const isExpanded = String(expandedTaskId) === String(task.id);
              const hasReadyRoute = routes.some(
                (routeItem) => routeItem.routeStatus === "Route Ready"
              );
              const firstRoute = routes[0];
              const taskChecklist = checklists[task.id] || [];
              const checklistDoneCount = taskChecklist.filter((item) => item.is_done).length;
              const taskIssues = issues[task.id] || [];
              const issueInput = {
                ...getDefaultIssueInput(),
                ...(issueInputs[task.id] || {}),
              };

              return (
                <div key={task.id} className="fe-task-card" style={styles.compactTaskCard}>
                  <div style={styles.compactTaskTop}>
                    <div style={styles.compactTaskMain}>
                      <h3 style={styles.compactTaskTitle}>
                        {task.projects?.name || "No Project"} • {task.target_name || "No Target"}
                      </h3>

                      <p style={styles.compactTaskMeta}>
                        {task.market || task.projects?.market || "No Market"} • {task.test_type || "No Scope"}
                        {task.due_date ? ` • Due ${new Date(task.due_date).toLocaleDateString()}` : ""}
                      </p>

                      {firstRoute && (
                        <p style={styles.compactTaskMetaSoft}>
                          Route: {firstRoute.gridName} • {firstRoute.routeName}
                        </p>
                      )}
                    </div>

                    <div style={styles.compactActionBar}>
                      <span
                        style={{
                          ...styles.statusBadge,
                          color: getStatusColor(task.status),
                          borderColor: getStatusColor(task.status),
                        }}
                      >
                        {formatStatus(task.status)}
                      </span>

                      {task.status === "assigned" && (
                        <button
                          type="button"
                          onClick={() => updateTaskStatus(task.id, "in_progress")}
                          style={styles.startButton}
                        >
                          Start
                        </button>
                      )}

                      {task.status === "in_progress" && (
                        <button
                          type="button"
                          onClick={() => updateTaskStatus(task.id, "completed")}
                          style={styles.completeButton}
                        >
                          Complete
                        </button>
                      )}

                      {task.status === "completed" && (
                        <span style={styles.doneBadge}>Done</span>
                      )}

                      <button
                        type="button"
                        onClick={() => setExpandedTaskId(isExpanded ? "" : task.id)}
                        style={styles.detailsButton}
                      >
                        {isExpanded ? "Hide" : "Details"}
                      </button>
                    </div>
                  </div>

                  {routes.length > 0 && (
                    <div style={styles.compactRouteStrip}>
                      <div>
                        <b>{routes.length === 1 ? "Assigned Route" : "Assigned Routes"}</b>
                        <span style={styles.compactRouteText}>
                          {routes.length} grid route{routes.length > 1 ? "s" : ""} • {hasReadyRoute ? "Route ready" : "Missing route"}
                        </span>
                      </div>

                      {firstRoute && (
                        <button
                          type="button"
                          onClick={() => openRouteFromTask(firstRoute.gridId)}
                          style={styles.routeViewButton}
                        >
                          View Route
                        </button>
                      )}
                    </div>
                  )}

                  {isExpanded && (
                    <div style={styles.expandedTaskBody}>
                      <div style={styles.taskMetaGridCompact}>
                        <InfoCell label="Project" value={task.projects?.name || "Missing Project"} />
                        <InfoCell label="Market" value={task.market || task.projects?.market || "N/A"} />
                        <InfoCell label="Target" value={`${task.target_type || "N/A"} - ${task.target_name || "N/A"}`} />
                        <InfoCell label="Scope" value={task.test_type || "N/A"} />
                        <InfoCell label="Priority" value={task.priority || "normal"} color={getPriorityColor(task.priority)} />
                        <InfoCell
                          label="Due"
                          value={task.due_date ? new Date(task.due_date).toLocaleString() : "N/A"}
                        />
                        <InfoCell
                          label="Started"
                          value={task.started_at ? new Date(task.started_at).toLocaleString() : "Not started"}
                        />
                        <InfoCell
                          label="Completed"
                          value={task.completed_at ? new Date(task.completed_at).toLocaleString() : "Not completed"}
                        />
                      </div>

                      {task.notes && (
                        <div style={styles.notesBox}>
                          <b>Notes</b>
                          <p>{task.notes}</p>
                        </div>
                      )}

                      {routes.length > 0 && (
                        <div style={styles.taskRouteBox}>
                          <h4 style={styles.taskRouteTitle}>Assigned Route Details</h4>

                          {routes.map((routeItem) => (
                            <div key={routeItem.gridId} style={styles.taskRouteRow}>
                              <div>
                                <b>{routeItem.gridName}</b>
                                <p style={styles.taskRouteMeta}>
                                  {routeItem.routeName} • {routeItem.routeType}
                                </p>
                              </div>

                              <span
                                style={{
                                  ...styles.routePill,
                                  ...(routeItem.routeStatus === "Route Ready"
                                    ? styles.routeReadyPill
                                    : styles.routeMissingPill),
                                }}
                              >
                                {routeItem.routeStatus}
                              </span>

                              <button
                                type="button"
                                onClick={() => openRouteFromTask(routeItem.gridId)}
                                style={styles.routeViewButton}
                              >
                                View Route Map
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      <div style={styles.checklistBox}>
                        <div style={styles.sectionHeaderRow}>
                          <div>
                            <h4 style={styles.sectionTitle}>Task Checklist</h4>
                            <p style={styles.sectionSubtext}>
                              Confirm field execution steps before closing the task.
                            </p>
                          </div>

                          <span style={styles.checklistProgressPill}>
                            {checklistDoneCount}/{taskChecklist.length || DEFAULT_CHECKLIST_ITEMS.length} Done
                          </span>
                        </div>

                        {taskChecklist.length === 0 ? (
                          <p className="fe-muted">Checklist is loading...</p>
                        ) : (
                          <div style={styles.checklistGrid}>
                            {taskChecklist.map((item) => (
                              <label key={item.id} style={styles.checklistItem}>
                                <input
                                  type="checkbox"
                                  checked={Boolean(item.is_done)}
                                  disabled={savingChecklistId === item.id}
                                  onChange={() => toggleChecklistItem(item)}
                                  style={styles.checklistCheckbox}
                                />
                                <span
                                  style={{
                                    ...styles.checklistLabel,
                                    ...(item.is_done ? styles.checklistLabelDone : {}),
                                  }}
                                >
                                  {item.label}
                                </span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>

                      <div style={styles.issueBox}>
                        <div style={styles.sectionHeaderRow}>
                          <div>
                            <h4 style={styles.sectionTitle}>Issue Reporting</h4>
                            <p style={styles.sectionSubtext}>
                              Report access, route, safety, equipment, weather, or log handoff issues.
                            </p>
                          </div>

                          <span style={styles.issueCountPill}>
                            {taskIssues.length} Issue{taskIssues.length === 1 ? "" : "s"}
                          </span>
                        </div>

                        <div style={styles.issueFormGrid}>
                          <label style={styles.issueLabel}>
                            Issue Type
                            <select
                              value={issueInput.issue_type}
                              onChange={(event) =>
                                updateIssueInput(task.id, "issue_type", event.target.value)
                              }
                              style={styles.issueInput}
                            >
                              {ISSUE_TYPES.map((type) => (
                                <option key={type} value={type}>
                                  {type}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label style={styles.issueLabel}>
                            Severity
                            <select
                              value={issueInput.severity}
                              onChange={(event) =>
                                updateIssueInput(task.id, "severity", event.target.value)
                              }
                              style={styles.issueInput}
                            >
                              {ISSUE_SEVERITIES.map((severity) => (
                                <option key={severity} value={severity}>
                                  {formatSeverity(severity)}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <textarea
                          placeholder="Example: North side blocked by private road. Need alternate route or re-drive."
                          value={issueInput.description}
                          onChange={(event) =>
                            updateIssueInput(task.id, "description", event.target.value)
                          }
                          style={styles.issueTextarea}
                        />

                        <button
                          type="button"
                          onClick={() => submitIssueReport(task.id)}
                          disabled={submittingIssueTaskId === task.id}
                          style={styles.issueSubmitButton}
                        >
                          {submittingIssueTaskId === task.id
                            ? "Saving Issue..."
                            : "Submit Issue"}
                        </button>

                        {taskIssues.length > 0 && (
                          <div style={styles.issueList}>
                            {taskIssues.slice(0, 5).map((issue) => (
                              <div key={issue.id} style={styles.issueHistoryCard}>
                                <div style={styles.issueHistoryTop}>
                                  <b>{issue.issue_type}</b>
                                  <span style={styles.issueStatusPill}>
                                    {formatSeverity(issue.severity)} • {formatIssueStatus(issue.status)}
                                  </span>
                                </div>

                                {issue.description && (
                                  <p style={styles.issueDescription}>{issue.description}</p>
                                )}

                                <p style={styles.issueMeta}>
                                  {issue.created_at
                                    ? new Date(issue.created_at).toLocaleString()
                                    : "Time not available"}
                                  {issue.lat && issue.lon
                                    ? ` • ${Number(issue.lat).toFixed(5)}, ${Number(issue.lon).toFixed(5)}`
                                    : ""}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {task.status === "assigned" && (
                        <p className="fe-muted">
                          GPS tracking will start after you click Start.
                        </p>
                      )}

                      {task.status === "in_progress" && (
                        <>
                          <hr />
                          <h4>Live GPS Map</h4>

                          {!isOnline ? (
                            <OfflineGpsPanel
                              gps={lastGpsLocation}
                              isOnline={isOnline}
                              gpsChecking={gpsChecking}
                              onRefresh={refreshGpsNow}
                            />
                          ) : (
                            <>
                              <div className="fe-live-gps-wrapper">
                                <FELiveGpsMap assignedGrids={routes} />
                              </div>
                              <OfflineGpsPanel
                                gps={lastGpsLocation}
                                isOnline={isOnline}
                                gpsChecking={gpsChecking}
                                onRefresh={refreshGpsNow}
                                compact={true}
                              />
                            </>
                          )}
                        </>
                      )}

                      {task.status === "completed" && (
                        <>
                          <p className="fe-done">
                            GPS tracking stopped because this task is completed.
                          </p>

                          <p className="fe-late-update-note">
                            ⚠️ You can still add updates if you were offline during execution.
                          </p>
                        </>
                      )}

                      <hr />

                      <h4>FE Update</h4>

                      <textarea
                        placeholder="Add comment / issue / field note"
                        value={commentInputs[task.id] || ""}
                        onChange={(e) =>
                          setCommentInputs((prev) => ({
                            ...prev,
                            [task.id]: e.target.value,
                          }))
                        }
                      />

                      <br />
                      <br />

                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) =>
                          setPhotoInputs((prev) => ({
                            ...prev,
                            [task.id]: e.target.files[0],
                          }))
                        }
                      />

                      <br />
                      <br />

                      <button
                        onClick={() => submitTaskUpdate(task.id)}
                        disabled={uploadingTaskId === task.id}
                      >
                        {uploadingTaskId === task.id
                          ? "Uploading..."
                          : task.status === "completed"
                          ? "Submit Final Update"
                          : "Submit Update"}
                      </button>

                      <h4>Previous Updates</h4>

                      {(updates[task.id] || []).length === 0 ? (
                        <p>No updates yet.</p>
                      ) : (
                        updates[task.id].slice(0, 10).map((update) => (
                          <div key={update.id} className="fe-update-history-card">
                            <p>
                              <b>Time:</b> {new Date(update.created_at).toLocaleString()}
                            </p>

                            {update.comment && (
                              <p>
                                <b>💬 Comment:</b> {update.comment}
                              </p>
                            )}

                            {update.latitude && update.longitude && (
                              <p>
                                <b>📍 Location:</b> {Number(update.latitude).toFixed(5)}, {Number(update.longitude).toFixed(5)}
                                <br />
                                <a
                                  href={`https://www.google.com/maps?q=${update.latitude},${update.longitude}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Open in Google Maps
                                </a>
                              </p>
                            )}

                            {update.photo_url && (
                              <img
                                src={update.photo_url}
                                alt="Task update"
                                className="fe-update-photo"
                                onClick={() => window.open(update.photo_url, "_blank")}
                              />
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}    </div>
  );
}

function OfflineGpsPanel({ gps, isOnline, gpsChecking, onRefresh, compact = false }) {
  const hasGps = gps?.latitude && gps?.longitude;
  const latText = hasGps ? Number(gps.latitude).toFixed(6) : "N/A";
  const lonText = hasGps ? Number(gps.longitude).toFixed(6) : "N/A";
  const savedText = gps?.cached_at ? new Date(gps.cached_at).toLocaleString() : "Not cached yet";

  if (compact && isOnline && hasGps) {
    return (
      <details className="fe-offline-gps-card fe-offline-gps-card-compact">
        <summary>
          <span>
            <b>GPS Backup</b>
            <small>Last saved: {savedText}</small>
          </span>
          <em>Show</em>
        </summary>

        <div className="fe-offline-gps-grid fe-offline-gps-grid-compact">
          <span>
            <b>Latitude</b>
            {latText}
          </span>
          <span>
            <b>Longitude</b>
            {lonText}
          </span>
          <span>
            <b>Saved</b>
            {savedText}
          </span>
        </div>

        <div className="fe-offline-gps-actions">
          <button type="button" onClick={onRefresh} disabled={gpsChecking}>
            {gpsChecking ? "Checking GPS..." : "Refresh GPS"}
          </button>

          <a
            href={`https://www.google.com/maps?q=${gps.latitude},${gps.longitude}`}
            target="_blank"
            rel="noreferrer"
          >
            Open in Google Maps
          </a>
        </div>
      </details>
    );
  }

  return (
    <div className="fe-offline-gps-card">
      <div>
        <h4>{isOnline ? "GPS Backup" : "Offline GPS"}</h4>
        <p>
          {hasGps
            ? "Showing the last saved GPS location from this device. Map tiles may need internet."
            : "No cached GPS found yet. Browser/device GPS can still work offline after permission is allowed."}
        </p>
      </div>

      {hasGps ? (
        <div className="fe-offline-gps-grid">
          <span>
            <b>Latitude</b>
            {latText}
          </span>
          <span>
            <b>Longitude</b>
            {lonText}
          </span>
          <span>
            <b>Saved</b>
            {savedText}
          </span>
        </div>
      ) : null}

      <div className="fe-offline-gps-actions">
        <button type="button" onClick={onRefresh} disabled={gpsChecking}>
          {gpsChecking ? "Checking GPS..." : "Refresh GPS"}
        </button>

        {hasGps ? (
          <a
            href={`https://www.google.com/maps?q=${gps.latitude},${gps.longitude}`}
            target="_blank"
            rel="noreferrer"
          >
            Open in Google Maps
          </a>
        ) : null}
      </div>
    </div>
  );
}

function InfoCell({ label, value, color }) {
  return (
    <div style={styles.infoCell}>
      <span style={styles.infoCellLabel}>{label}</span>
      <b style={{ ...styles.infoCellValue, color: color || "var(--bd-fe-text, #e5eefc)" }}>
        {value}
      </b>
    </div>
  );
}


const feThemeCss = `
  body.bd-theme-night {
    background: #07111f !important;
  }

  body.bd-theme-day {
    background: #edf5ff !important;
  }

  .fe-page {
    --bd-fe-bg: #07111f;
    --bd-fe-panel: #111827;
    --bd-fe-card: #0b1220;
    --bd-fe-border: #263244;
    --bd-fe-text: #e5eefc;
    --bd-fe-muted: #9fb2cf;
    --bd-fe-blue: #93c5fd;
    color: var(--bd-fe-text) !important;
    background: var(--bd-fe-bg) !important;
    min-height: 100vh !important;
    padding-top: 10px !important;
  }

  .fe-page.theme-day {
    --bd-fe-bg: #edf5ff;
    --bd-fe-panel: #ffffff;
    --bd-fe-card: #f8fbff;
    --bd-fe-border: rgba(37, 99, 235, 0.18);
    --bd-fe-text: #0f172a;
    --bd-fe-muted: #475569;
    --bd-fe-blue: #2563eb;
  }

  .fe-topbar {
    width: 100%;
    max-width: 980px;
    margin: 0 auto 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    position: relative;
  }

  .fe-title {
    color: var(--bd-fe-text) !important;
    margin: 0 !important;
    text-align: center !important;
    font-size: clamp(18px, 1.35vw, 24px) !important;
  }

  .fe-theme-toggle {
    position: absolute;
    right: 0;
    border: 1px solid var(--bd-fe-border);
    border-radius: 999px;
    background: var(--bd-fe-panel);
    color: var(--bd-fe-text);
    padding: 7px 11px;
    font-size: 12px;
    font-weight: 900;
    cursor: pointer;
    box-shadow: 0 8px 22px rgba(15, 23, 42, 0.12);
  }



  .fe-sync-banner {
    width: 100%;
    max-width: 980px;
    margin: 0 auto 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--bd-fe-border);
    border-radius: 14px;
    background: var(--bd-fe-panel);
    color: var(--bd-fe-text);
    box-shadow: 0 8px 22px rgba(15, 23, 42, 0.10);
  }

  .fe-sync-banner.offline {
    border-color: rgba(245, 158, 11, 0.55);
    background: rgba(245, 158, 11, 0.10);
  }

  .fe-sync-banner div {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .fe-sync-banner b {
    font-size: 12px;
    font-weight: 950;
    color: var(--bd-fe-text);
  }



  .fe-cache-pill {
    margin-left: 8px;
    padding: 4px 8px;
    border-radius: 999px;
    background: #fff7ed;
    border: 1px solid #fdba74;
    color: #9a3412;
    font-size: 12px;
  }
  .fe-sync-banner span {
    font-size: 12px;
    font-weight: 850;
    color: var(--bd-fe-muted);
  }

  .fe-sync-banner button {
    border: 1px solid var(--bd-fe-border);
    border-radius: 10px;
    padding: 8px 11px;
    background: #2563eb;
    color: #ffffff;
    font-size: 12px;
    font-weight: 900;
    cursor: pointer;
    white-space: nowrap;
  }

  .fe-sync-banner button:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }



  .fe-live-gps-wrapper {
    margin-top: 10px;
  }

  .fe-live-gps-wrapper > div {
    border-color: var(--bd-fe-border) !important;
  }

  .fe-live-gps-wrapper p,
  .fe-live-gps-wrapper span,
  .fe-live-gps-wrapper b,
  .fe-live-gps-wrapper strong {
    color: var(--bd-fe-text) !important;
    opacity: 1 !important;
  }

  .fe-live-gps-wrapper p {
    font-size: 14px !important;
    line-height: 1.55 !important;
    font-weight: 850 !important;
    text-align: center !important;
  }

  .fe-live-gps-wrapper b,
  .fe-live-gps-wrapper strong {
    font-weight: 950 !important;
  }

  .fe-page.theme-day .fe-live-gps-wrapper p,
  .fe-page.theme-day .fe-live-gps-wrapper span,
  .fe-page.theme-day .fe-live-gps-wrapper b,
  .fe-page.theme-day .fe-live-gps-wrapper strong {
    color: #0f172a !important;
  }

  .fe-live-gps-wrapper a {
    color: #2563eb !important;
    font-weight: 900 !important;
  }

  .fe-offline-gps-card {
    border: 1px solid rgba(245, 158, 11, 0.55);
    border-radius: 14px;
    background: rgba(245, 158, 11, 0.10);
    padding: 12px;
    margin: 10px 0;
    color: var(--bd-fe-text);
    text-align: left;
  }

  .fe-offline-gps-card h4 {
    margin: 0 0 5px !important;
    color: var(--bd-fe-text) !important;
    text-align: left !important;
  }

  .fe-offline-gps-card p {
    margin: 0 0 10px !important;
    color: var(--bd-fe-muted) !important;
    font-size: 12px;
    line-height: 1.35;
    text-align: left !important;
  }

  .fe-offline-gps-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 10px;
  }

  .fe-offline-gps-grid span {
    display: grid;
    gap: 4px;
    background: var(--bd-fe-panel);
    border: 1px solid var(--bd-fe-border);
    border-radius: 10px;
    padding: 10px;
    color: var(--bd-fe-text) !important;
    font-size: 13px;
    font-weight: 950;
    word-break: break-word;
  }

  .fe-offline-gps-grid b {
    color: var(--bd-fe-muted) !important;
    font-size: 11px;
    font-weight: 950;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .fe-offline-gps-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }

  .fe-offline-gps-actions button,
  .fe-offline-gps-actions a {
    border: 1px solid var(--bd-fe-border);
    border-radius: 10px;
    padding: 8px 11px;
    background: #2563eb;
    color: #ffffff !important;
    font-size: 12px;
    font-weight: 900;
    cursor: pointer;
    text-decoration: none;
  }

  .fe-offline-gps-actions button:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .fe-offline-gps-card-compact {
    padding: 0;
    overflow: hidden;
  }

  .fe-offline-gps-card-compact summary {
    list-style: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 12px;
    cursor: pointer;
  }

  .fe-offline-gps-card-compact summary::-webkit-details-marker {
    display: none;
  }

  .fe-offline-gps-card-compact summary span {
    display: grid;
    gap: 2px;
  }

  .fe-offline-gps-card-compact summary b {
    color: var(--bd-fe-text) !important;
    font-size: 13px;
    font-weight: 950;
  }

  .fe-offline-gps-card-compact summary small {
    color: var(--bd-fe-muted) !important;
    font-size: 11px;
    font-weight: 800;
  }

  .fe-offline-gps-card-compact summary em {
    font-style: normal;
    border: 1px solid var(--bd-fe-border);
    border-radius: 999px;
    padding: 4px 8px;
    background: var(--bd-fe-panel);
    color: var(--bd-fe-text);
    font-size: 11px;
    font-weight: 950;
  }

  .fe-offline-gps-card-compact[open] summary em::before {
    content: "Hide";
  }

  .fe-offline-gps-card-compact[open] summary em {
    font-size: 0;
  }

  .fe-offline-gps-card-compact[open] summary em::before {
    font-size: 11px;
  }

  .fe-offline-gps-grid-compact,
  .fe-offline-gps-card-compact .fe-offline-gps-actions {
    margin-left: 12px;
    margin-right: 12px;
  }

  .fe-offline-gps-card-compact .fe-offline-gps-actions {
    margin-bottom: 12px;
  }

  @media (max-width: 700px) {
    .fe-offline-gps-grid {
      grid-template-columns: 1fr;
    }
  }

  .fe-page.theme-day .fe-task-card,
  .fe-page.theme-day .panel-card,
  .fe-page.theme-day [style*="background: #0b1220"],
  .fe-page.theme-day [style*="background: rgb(11, 18, 32)"],
  .fe-page.theme-day [style*="background: #111827"],
  .fe-page.theme-day [style*="background: rgb(17, 24, 39)"] {
    background: #ffffff !important;
    color: #0f172a !important;
    border-color: rgba(37, 99, 235, 0.18) !important;
    box-shadow: 0 10px 26px rgba(15, 23, 42, 0.07) !important;
  }

  .fe-page.theme-day h1,
  .fe-page.theme-day h2,
  .fe-page.theme-day h3,
  .fe-page.theme-day h4,
  .fe-page.theme-day b,
  .fe-page.theme-day p,
  .fe-page.theme-day span,
  .fe-page.theme-day label {
    color: #0f172a !important;
  }

  .fe-page.theme-day .fe-muted,
  .fe-page.theme-day [style*="color: #9fb2cf"],
  .fe-page.theme-day [style*="color: rgb(159, 178, 207)"],
  .fe-page.theme-day [style*="color: #93c5fd"],
  .fe-page.theme-day [style*="color: rgb(147, 197, 253)"] {
    color: #2563eb !important;
  }

  .fe-page.theme-day input,
  .fe-page.theme-day textarea,
  .fe-page.theme-day select {
    background: #f8fbff !important;
    border-color: rgba(37, 99, 235, 0.24) !important;
    color: #0f172a !important;
  }

  .fe-page.theme-day button:not(.fe-theme-toggle) {
    box-shadow: none !important;
  }

  .fe-page.theme-day .fe-message {
    background: #eff6ff !important;
    color: #1d4ed8 !important;
    border-color: rgba(37, 99, 235, 0.2) !important;
  }

  /* Day-view color polish V2 */
  .fe-page.theme-day {
    --bd-fe-bg: #eaf3ff;
    --bd-fe-panel: #ffffff;
    --bd-fe-card: #f8fbff;
    --bd-fe-border: rgba(30, 64, 175, 0.18);
    --bd-fe-text: #0f172a;
    --bd-fe-muted: #475569;
    --bd-fe-blue: #2563eb;
  }

  .fe-page.theme-day .fe-title {
    color: #102033 !important;
  }

  .fe-page.theme-day .fe-theme-toggle {
    background: #ffffff !important;
    color: #0f172a !important;
    border-color: rgba(30, 64, 175, 0.22) !important;
  }

  .fe-page.theme-day .fe-task-card,
  .fe-page.theme-day .panel-card,
  .fe-page.theme-day [style*="background: #101828"],
  .fe-page.theme-day [style*="background: rgb(16, 24, 40)"],
  .fe-page.theme-day [style*="background: #0B1220"],
  .fe-page.theme-day [style*="background: #0b1220"],
  .fe-page.theme-day [style*="background: rgb(11, 18, 32)"],
  .fe-page.theme-day [style*="background: #111827"],
  .fe-page.theme-day [style*="background: rgb(17, 24, 39)"] {
    background: #ffffff !important;
    color: #0f172a !important;
    border-color: rgba(30, 64, 175, 0.18) !important;
    box-shadow: 0 10px 26px rgba(15, 23, 42, 0.065) !important;
  }

  .fe-page.theme-day [style*="background: rgba(37,99,235,0.12)"],
  .fe-page.theme-day [style*="background: rgba(37, 99, 235, 0.12)"],
  .fe-page.theme-day [style*="background: rgba(37, 99, 235, 0.1)"] {
    background: #eaf2ff !important;
    border-color: rgba(37, 99, 235, 0.26) !important;
  }

  .fe-page.theme-day h1,
  .fe-page.theme-day h2,
  .fe-page.theme-day h3,
  .fe-page.theme-day h4,
  .fe-page.theme-day b,
  .fe-page.theme-day p,
  .fe-page.theme-day span,
  .fe-page.theme-day label {
    color: #0f172a !important;
  }

  .fe-page.theme-day .fe-muted,
  .fe-page.theme-day [style*="color: #9fb2cf"],
  .fe-page.theme-day [style*="color: rgb(159, 178, 207)"],
  .fe-page.theme-day [style*="color: #98A2B3"],
  .fe-page.theme-day [style*="color: rgb(152, 162, 179)"],
  .fe-page.theme-day [style*="color: #9ca3af"],
  .fe-page.theme-day [style*="color: rgb(156, 163, 175)"] {
    color: #475569 !important;
  }

  .fe-page.theme-day [style*="color: #93c5fd"],
  .fe-page.theme-day [style*="color: rgb(147, 197, 253)"],
  .fe-page.theme-day [style*="color: #bfdbfe"],
  .fe-page.theme-day [style*="color: rgb(191, 219, 254)"] {
    color: #2563eb !important;
  }

  .fe-page.theme-day input,
  .fe-page.theme-day textarea,
  .fe-page.theme-day select {
    background: #f8fbff !important;
    border-color: rgba(30, 64, 175, 0.22) !important;
    color: #0f172a !important;
  }

  .fe-page.theme-day input:focus,
  .fe-page.theme-day textarea:focus,
  .fe-page.theme-day select:focus {
    border-color: rgba(37, 99, 235, 0.55) !important;
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.10) !important;
    outline: none !important;
  }

  .fe-page.theme-day button:not(.fe-theme-toggle) {
    box-shadow: none !important;
  }

  .fe-page.theme-day [style*="background: #1f2937"],
  .fe-page.theme-day [style*="background: rgb(31, 41, 55)"] {
    background: #e2ecff !important;
    color: #0f172a !important;
    border-color: rgba(30, 64, 175, 0.22) !important;
  }

  .fe-page.theme-day [style*="background: #2563eb"],
  .fe-page.theme-day [style*="background: rgb(37, 99, 235)"] {
    background: #2563eb !important;
    color: #ffffff !important;
  }

  .fe-page.theme-day [style*="background: #16a34a"],
  .fe-page.theme-day [style*="background: rgb(22, 163, 74)"] {
    background: #16a34a !important;
    color: #ffffff !important;
  }

  .fe-page.theme-day .fe-message {
    background: #eef6ff !important;
    color: #1e40af !important;
    border-color: rgba(30, 64, 175, 0.18) !important;
  }



  /* FE day-view contrast polish V3 */
  .fe-page.theme-day {
    --bd-fe-bg: #eaf3ff;
    --bd-fe-panel: #ffffff;
    --bd-fe-card: #f8fbff;
    --bd-fe-border: rgba(30, 64, 175, 0.20);
    --bd-fe-text: #0f172a;
    --bd-fe-muted: #475569;
    --bd-fe-blue: #2563eb;
  }

  .fe-page.theme-day .panel-card,
  .fe-page.theme-day .fe-task-card,
  .fe-page.theme-day [style*="background: #111827"],
  .fe-page.theme-day [style*="background:#111827"],
  .fe-page.theme-day [style*="background: rgb(17, 24, 39)"],
  .fe-page.theme-day [style*="background: #0b1220"],
  .fe-page.theme-day [style*="background:#0b1220"],
  .fe-page.theme-day [style*="background: rgb(11, 18, 32)"],
  .fe-page.theme-day [style*="background: #0f172a"],
  .fe-page.theme-day [style*="background:#0f172a"],
  .fe-page.theme-day [style*="background: rgb(15, 23, 42)"],
  .fe-page.theme-day [style*="background: #101828"],
  .fe-page.theme-day [style*="background:#101828"],
  .fe-page.theme-day [style*="background: rgb(16, 24, 40)"] {
    background: #ffffff !important;
    color: #0f172a !important;
    border-color: rgba(30, 64, 175, 0.20) !important;
    box-shadow: 0 10px 26px rgba(15, 23, 42, 0.065) !important;
  }

  .fe-page.theme-day [style*="background: rgba(15, 23, 42"],
  .fe-page.theme-day [style*="background:rgba(15, 23, 42"],
  .fe-page.theme-day [style*="background: rgba(17, 24, 39"],
  .fe-page.theme-day [style*="background:rgba(17, 24, 39"] {
    background: #f8fbff !important;
    color: #0f172a !important;
    border-color: rgba(30, 64, 175, 0.20) !important;
  }

  .fe-page.theme-day h1,
  .fe-page.theme-day h2,
  .fe-page.theme-day h3,
  .fe-page.theme-day h4,
  .fe-page.theme-day b,
  .fe-page.theme-day strong,
  .fe-page.theme-day label {
    color: #0f172a !important;
  }

  .fe-page.theme-day p,
  .fe-page.theme-day span {
    color: inherit !important;
  }

  .fe-page.theme-day .fe-muted,
  .fe-page.theme-day [style*="color: #9fb2cf"],
  .fe-page.theme-day [style*="color: rgb(159, 178, 207)"],
  .fe-page.theme-day [style*="color: #98A2B3"],
  .fe-page.theme-day [style*="color: rgb(152, 162, 179)"],
  .fe-page.theme-day [style*="color: #9ca3af"],
  .fe-page.theme-day [style*="color: rgb(156, 163, 175)"] {
    color: #475569 !important;
  }

  .fe-page.theme-day [style*="color: #93c5fd"],
  .fe-page.theme-day [style*="color: rgb(147, 197, 253)"],
  .fe-page.theme-day [style*="color: #bfdbfe"],
  .fe-page.theme-day [style*="color: rgb(191, 219, 254)"] {
    color: #2563eb !important;
  }

  .fe-page.theme-day input,
  .fe-page.theme-day textarea,
  .fe-page.theme-day select {
    background: #ffffff !important;
    border-color: rgba(30, 64, 175, 0.24) !important;
    color: #0f172a !important;
  }

  .fe-page.theme-day input::placeholder,
  .fe-page.theme-day textarea::placeholder {
    color: #64748b !important;
    opacity: 1 !important;
  }

  .fe-page.theme-day button:disabled,
  .fe-page.theme-day [disabled] {
    background: #eef2ff !important;
    color: #475569 !important;
    border-color: rgba(30, 64, 175, 0.18) !important;
    opacity: 0.75 !important;
  }

  .fe-page.theme-day [style*="background: #2563eb"],
  .fe-page.theme-day [style*="background:#2563eb"],
  .fe-page.theme-day [style*="background: rgb(37, 99, 235)"],
  .fe-page.theme-day [style*="background: #16a34a"],
  .fe-page.theme-day [style*="background:#16a34a"],
  .fe-page.theme-day [style*="background: rgb(22, 163, 74)"],
  .fe-page.theme-day [style*="background: #dc2626"],
  .fe-page.theme-day [style*="background:#dc2626"],
  .fe-page.theme-day [style*="background: rgb(220, 38, 38)"] {
    color: #ffffff !important;
  }

  .fe-page.theme-day .cell-sector-legend,
  .fe-page.theme-day .cell-sector-legend *,
  .fe-page.theme-day .leaflet-container .cell-sector-legend,
  .fe-page.theme-day .leaflet-container .cell-sector-legend * {
    color: #e5eefc !important;
  }

  .fe-page.theme-day .leaflet-control-attribution,
  .fe-page.theme-day .leaflet-control-attribution * {
    color: #334155 !important;
  }


  /* FE day-view readability fix V4 - My Routes and task detail contrast */
  .fe-page.theme-day [style*="background: rgba(0,255,102"],
  .fe-page.theme-day [style*="background:rgba(0,255,102"],
  .fe-page.theme-day [style*="background: rgba(0, 255, 102"],
  .fe-page.theme-day [style*="background:rgba(0, 255, 102"],
  .fe-page.theme-day [style*="background: #052e1a"],
  .fe-page.theme-day [style*="background:#052e1a"] {
    background: #dcfce7 !important;
    border-color: #86efac !important;
    color: #065f46 !important;
  }

  .fe-page.theme-day [style*="color: #86efac"],
  .fe-page.theme-day [style*="color:#86efac"],
  .fe-page.theme-day [style*="color: rgb(134, 239, 172)"],
  .fe-page.theme-day [style*="color: #bbf7d0"],
  .fe-page.theme-day [style*="color:#bbf7d0"] {
    color: #065f46 !important;
    font-weight: 850 !important;
  }

  .fe-page.theme-day [style*="background: rgba(255,255,255,0.07)"],
  .fe-page.theme-day [style*="background:rgba(255,255,255,0.07)"],
  .fe-page.theme-day [style*="background: rgba(255, 255, 255, 0.07)"],
  .fe-page.theme-day [style*="background:rgba(255, 255, 255, 0.07)"] {
    background: #eaf2ff !important;
    border-color: rgba(37, 99, 235, 0.32) !important;
    color: #0f172a !important;
  }

  .fe-page.theme-day [style*="background: rgba(37,99,235,0.12)"],
  .fe-page.theme-day [style*="background:rgba(37,99,235,0.12)"],
  .fe-page.theme-day [style*="background: rgba(37, 99, 235, 0.12)"],
  .fe-page.theme-day [style*="background:rgba(37, 99, 235, 0.12)"] {
    background: #eaf2ff !important;
    border-color: rgba(37, 99, 235, 0.30) !important;
    color: #0f172a !important;
  }

  .fe-page.theme-day [style*="background: #0B1220"],
  .fe-page.theme-day [style*="background:#0B1220"],
  .fe-page.theme-day [style*="background: #0b1220"],
  .fe-page.theme-day [style*="background:#0b1220"],
  .fe-page.theme-day [style*="background: #101828"],
  .fe-page.theme-day [style*="background:#101828"] {
    background: #ffffff !important;
    border-color: rgba(37, 99, 235, 0.22) !important;
    color: #0f172a !important;
  }

  .fe-page.theme-day [style*="color: #fff"],
  .fe-page.theme-day [style*="color:#fff"],
  .fe-page.theme-day [style*="color: #ffffff"],
  .fe-page.theme-day [style*="color:#ffffff"] {
    color: #0f172a !important;
  }

  .fe-page.theme-day [style*="background: #2563eb"],
  .fe-page.theme-day [style*="background:#2563eb"],
  .fe-page.theme-day [style*="background: #16a34a"],
  .fe-page.theme-day [style*="background:#16a34a"],
  .fe-page.theme-day [style*="background: linear-gradient"] {
    color: #ffffff !important;
  }

  .fe-page.theme-day button:disabled,
  .fe-page.theme-day [disabled] {
    background: #f1f5f9 !important;
    color: #64748b !important;
    border-color: rgba(37, 99, 235, 0.16) !important;
    opacity: 0.9 !important;
  }

  .fe-page.theme-day .cell-sector-legend,
  .fe-page.theme-day .cell-sector-legend * {
    color: #e5eefc !important;
  }

  .fe-page.theme-day [style*="background: rgba(34, 197, 94, 0.07)"] {
    background: #f0fdf4 !important;
    border-color: #86efac !important;
  }

  .fe-page.theme-day [style*="background: rgba(245, 158, 11, 0.07)"] {
    background: #fffbeb !important;
    border-color: #fbbf24 !important;
  }

  .fe-page.theme-day [style*="background: #dcfce7"] {
    background: #dcfce7 !important;
    color: #14532d !important;
    border-color: #22c55e !important;
  }

  .fe-page.theme-day [style*="background: #fef3c7"] {
    background: #fef3c7 !important;
    color: #92400e !important;
    border-color: #f59e0b !important;
  }


`;

const styles = {
  taskStack: {
    display: "grid",
    gap: "14px",
  },

  emptyTaskState: {
    border: "1px solid #263244",
    background: "#0b1220",
    color: "#9fb2cf",
    borderRadius: "14px",
    padding: "18px",
    textAlign: "center",
  },

  compactTaskCard: {
    padding: "14px",
    borderRadius: "16px",
  },

  compactTaskTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "flex-start",
    flexWrap: "wrap",
  },

  compactTaskMain: {
    minWidth: "220px",
    flex: 1,
  },

  compactTaskTitle: {
    margin: 0,
    fontSize: "17px",
    color: "#f8fafc",
  },

  compactTaskMeta: {
    margin: "6px 0 0",
    color: "#93c5fd",
    fontSize: "13px",
  },

  compactTaskMetaSoft: {
    margin: "5px 0 0",
    color: "#9fb2cf",
    fontSize: "12px",
  },

  compactActionBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "8px",
    flexWrap: "wrap",
  },

  statusBadge: {
    border: "1px solid #9fb2cf",
    background: "rgba(15, 23, 42, 0.8)",
    borderRadius: "999px",
    padding: "7px 10px",
    fontSize: "11px",
    fontWeight: 900,
    whiteSpace: "nowrap",
  },

  startButton: {
    border: "none",
    borderRadius: "10px",
    padding: "8px 11px",
    background: "linear-gradient(135deg, #22c55e, #06b6d4)",
    color: "#04111f",
    fontWeight: 900,
    cursor: "pointer",
  },

  completeButton: {
    border: "none",
    borderRadius: "10px",
    padding: "8px 11px",
    background: "linear-gradient(135deg, #3b82f6, #22c55e)",
    color: "#ffffff",
    fontWeight: 900,
    cursor: "pointer",
  },

  doneBadge: {
    borderRadius: "999px",
    padding: "7px 10px",
    background: "rgba(34, 197, 94, 0.14)",
    border: "1px solid rgba(34, 197, 94, 0.5)",
    color: "#86efac",
    fontWeight: 900,
    fontSize: "11px",
  },

  detailsButton: {
    border: "1px solid #374151",
    borderRadius: "10px",
    padding: "8px 11px",
    background: "#1f2937",
    color: "#ffffff",
    fontWeight: 900,
    cursor: "pointer",
    fontSize: "12px",
  },

  compactRouteStrip: {
    marginTop: "12px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    border: "1px solid rgba(37, 99, 235, 0.35)",
    background: "rgba(37, 99, 235, 0.1)",
    borderRadius: "12px",
    padding: "10px 12px",
    flexWrap: "wrap",
  },

  compactRouteText: {
    display: "block",
    color: "#bfdbfe",
    fontSize: "12px",
    marginTop: "3px",
  },

  expandedTaskBody: {
    marginTop: "14px",
    borderTop: "1px solid rgba(148, 163, 184, 0.22)",
    paddingTop: "14px",
  },

  taskMetaGridCompact: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))",
    gap: "10px",
    marginBottom: "12px",
  },

  infoCell: {
    border: "1px solid rgba(148, 163, 184, 0.2)",
    background: "#0b1220",
    borderRadius: "12px",
    padding: "10px",
  },

  infoCellLabel: {
    display: "block",
    color: "#9fb2cf",
    fontSize: "11px",
    marginBottom: "5px",
  },

  infoCellValue: {
    display: "block",
    fontSize: "12px",
    lineHeight: 1.35,
  },

  notesBox: {
    border: "1px solid rgba(148, 163, 184, 0.2)",
    background: "#0b1220",
    borderRadius: "12px",
    padding: "10px 12px",
    marginBottom: "12px",
    color: "#dbeafe",
  },


  checklistBox: {
    border: "1px solid rgba(34, 197, 94, 0.25)",
    background: "rgba(34, 197, 94, 0.07)",
    borderRadius: "14px",
    padding: "12px",
    marginBottom: "12px",
  },

  issueBox: {
    border: "1px solid rgba(245, 158, 11, 0.28)",
    background: "rgba(245, 158, 11, 0.07)",
    borderRadius: "14px",
    padding: "12px",
    marginBottom: "12px",
  },

  sectionHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "10px",
    marginBottom: "10px",
    flexWrap: "wrap",
  },

  sectionTitle: {
    margin: 0,
    color: "#f8fafc",
    fontSize: "15px",
  },

  sectionSubtext: {
    margin: "4px 0 0",
    color: "#9fb2cf",
    fontSize: "12px",
    lineHeight: 1.35,
  },

  checklistProgressPill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "999px",
    padding: "6px 10px",
    background: "#dcfce7",
    color: "#14532d",
    border: "1px solid #22c55e",
    fontWeight: 900,
    fontSize: "11px",
    whiteSpace: "nowrap",
  },

  issueCountPill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "999px",
    padding: "6px 10px",
    background: "#fef3c7",
    color: "#92400e",
    border: "1px solid #f59e0b",
    fontWeight: 900,
    fontSize: "11px",
    whiteSpace: "nowrap",
  },

  checklistGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "8px",
  },

  checklistItem: {
    display: "flex",
    alignItems: "center",
    gap: "9px",
    border: "1px solid rgba(148, 163, 184, 0.22)",
    background: "#0b1220",
    borderRadius: "10px",
    padding: "9px 10px",
    cursor: "pointer",
  },

  checklistCheckbox: {
    width: "16px",
    height: "16px",
    accentColor: "#22c55e",
    flexShrink: 0,
  },

  checklistLabel: {
    color: "#dbeafe",
    fontSize: "12px",
    fontWeight: 800,
    lineHeight: 1.3,
  },

  checklistLabelDone: {
    textDecoration: "line-through",
    color: "#86efac",
  },

  issueFormGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: "10px",
    marginBottom: "10px",
  },

  issueLabel: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    color: "#cbd5e1",
    fontSize: "12px",
    fontWeight: 900,
  },

  issueInput: {
    width: "100%",
    border: "1px solid #263244",
    background: "#07111f",
    color: "#e5eefc",
    borderRadius: "10px",
    padding: "9px 10px",
    fontSize: "12px",
  },

  issueTextarea: {
    width: "100%",
    minHeight: "74px",
    boxSizing: "border-box",
    border: "1px solid #263244",
    background: "#07111f",
    color: "#e5eefc",
    borderRadius: "10px",
    padding: "10px",
    fontSize: "12px",
    resize: "vertical",
    marginBottom: "10px",
  },

  issueSubmitButton: {
    border: "none",
    borderRadius: "10px",
    padding: "9px 12px",
    background: "linear-gradient(135deg, #f59e0b, #22c55e)",
    color: "#04111f",
    fontWeight: 900,
    cursor: "pointer",
  },

  issueList: {
    display: "grid",
    gap: "8px",
    marginTop: "10px",
  },

  issueHistoryCard: {
    border: "1px solid rgba(148, 163, 184, 0.22)",
    background: "#0b1220",
    borderRadius: "10px",
    padding: "9px 10px",
  },

  issueHistoryTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    flexWrap: "wrap",
  },

  issueStatusPill: {
    display: "inline-flex",
    borderRadius: "999px",
    padding: "4px 8px",
    background: "#fef3c7",
    color: "#92400e",
    border: "1px solid #f59e0b",
    fontSize: "10px",
    fontWeight: 900,
    whiteSpace: "nowrap",
  },

  issueDescription: {
    margin: "7px 0 0",
    color: "#dbeafe",
    fontSize: "12px",
    lineHeight: 1.35,
  },

  issueMeta: {
    margin: "6px 0 0",
    color: "#9fb2cf",
    fontSize: "11px",
  },

  tabBar: {
    display: "flex",
    gap: "10px",
    alignItems: "center",
    marginBottom: "16px",
    flexWrap: "wrap",
  },

  tabButton: {
    background: "#111827",
    color: "#dbeafe",
    border: "1px solid #263244",
    borderRadius: "10px",
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: 700,
  },

  activeTabButton: {
    background: "#2563eb",
    color: "#ffffff",
    border: "1px solid #3b82f6",
  },

  refreshButton: {
    background: "#1f2937",
    color: "#ffffff",
    border: "1px solid #374151",
    borderRadius: "10px",
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: 700,
  },

  taskRouteBox: {
    marginTop: "14px",
    marginBottom: "14px",
    padding: "12px",
    borderRadius: "12px",
    border: "1px solid #263244",
    background: "#0b1220",
  },

  taskRouteTitle: {
    margin: "0 0 10px",
    color: "#ffffff",
  },

  taskRouteRow: {
    display: "grid",
    gridTemplateColumns: "1fr auto auto",
    gap: "10px",
    alignItems: "center",
    padding: "10px",
    borderRadius: "10px",
    background: "#111827",
    marginBottom: "8px",
  },

  taskRouteMeta: {
    margin: "4px 0 0",
    color: "#9ca3af",
    fontSize: "12px",
  },

  routePill: {
    borderRadius: "999px",
    padding: "5px 9px",
    fontSize: "11px",
    fontWeight: 700,
    whiteSpace: "nowrap",
  },

  routeReadyPill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "8px 12px",
    borderRadius: "999px",
    background: "#dcfce7",
    color: "#14532d",
    border: "1px solid #22c55e",
    fontWeight: 900,
    fontSize: "12px",
    lineHeight: 1,
    whiteSpace: "nowrap",
    boxShadow: "0 6px 14px rgba(34, 197, 94, 0.18)",
  },

  routeMissingPill: {
    background: "#451a03",
    color: "#fed7aa",
    border: "1px solid #9a3412",
  },

  routeViewButton: {
    background: "#2563eb",
    color: "#ffffff",
    border: "none",
    borderRadius: "8px",
    padding: "8px 10px",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 700,
  },
};
