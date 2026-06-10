import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import "./mobile.css";
import { CHECKLIST_ITEMS, MOBILE_GPS_INTERVAL_MS, getDefaultIssueInput } from "./mobileConstants";
import {
  buildGoogleMapsUrl,
  enrichTask,
  findChecklistRowForItem,
  getChecklistStats,
  getTaskReference,
  isAssignedTask,
  isAssignedToCurrentUser,
  isCompletedTask,
  isInProcessTask,
  isOnHoldTask,
  sortTasks,
} from "./mobileHelpers";
import {
  fetchAndEnsureChecklistRows,
  fetchIssueReports,
  fetchRoutesForTasks,
  fetchTaskUpdates,
  safeSelectAll,
  uploadTaskPhotoToStorage,
} from "./mobileData";
import {
  formatGpsPoint,
  getCurrentLocationSafe,
  isValidGpsPoint,
  readCachedMobileGps,
  saveCachedMobileGps,
} from "./mobileGps";
import {
  OFFLINE_ACTION_TYPES,
  getMobileQueueCount,
  getMobileQueueItems,
  isBrowserOnline,
  queueMobileAction,
  shouldQueueAfterError,
  syncMobileOfflineQueue,
} from "./mobileOfflineQueue";
import { deleteQueuedFile, readQueuedFile, saveQueuedFile } from "./mobileIndexedDb";
import MobileLogin from "./MobileLogin";
import MobileMyTasks from "./MobileMyTasks";
import MobileRouteView from "./MobileRouteView";
import MobileSyncStatus from "./MobileSyncStatus";
import MobileProfile from "./MobileProfile";
import MobileRfKpi from "./MobileRfKpi";

function MobileLoading() {
  return (
    <main className="bd-mobile-screen">
      <section className="bd-mobile-card bd-mobile-center">
        <div className="bd-mobile-loader" />
        <h2>Opening BabyDragon Mobile</h2>
        <p>Checking FE session...</p>
      </section>
    </main>
  );
}

function getLocalCreatedAt() {
  return new Date().toISOString();
}

function makeLocalId(prefix, taskId) {
  return `${prefix}-${taskId || "task"}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function MobileApp() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [taskLoading, setTaskLoading] = useState(false);
  const [actionLoadingTaskId, setActionLoadingTaskId] = useState(null);
  const [checklistLoadingTaskId, setChecklistLoadingTaskId] = useState(null);
  const [issueLoadingTaskId, setIssueLoadingTaskId] = useState(null);
  const [taskUpdateLoadingTaskId, setTaskUpdateLoadingTaskId] = useState(null);
  const [gpsChecking, setGpsChecking] = useState(false);
  const [gpsTrackingTaskId, setGpsTrackingTaskId] = useState(null);
  const [lastGpsLocation, setLastGpsLocation] = useState(null);
  const [gpsStatusMessage, setGpsStatusMessage] = useState("GPS not checked yet.");
  const [tasks, setTasks] = useState([]);
  const [grids, setGrids] = useState([]);
  const [savedRoutes, setSavedRoutes] = useState([]);
  const [projects, setProjects] = useState([]);
  const [checklistItemsByTask, setChecklistItemsByTask] = useState({});
  const [issueReportsByTask, setIssueReportsByTask] = useState({});
  const [taskUpdatesByTask, setTaskUpdatesByTask] = useState({});
  const [issueInputsByTask, setIssueInputsByTask] = useState({});
  const [updateInputsByTask, setUpdateInputsByTask] = useState({});
  const [photoInputsByTask, setPhotoInputsByTask] = useState({});
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [taskFilter, setTaskFilter] = useState("assigned");
  const [syncMessage, setSyncMessage] = useState("");
  const [error, setError] = useState("");
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [isOnline, setIsOnline] = useState(() => isBrowserOnline());
  const [pendingSyncCount, setPendingSyncCount] = useState(() => getMobileQueueCount());
  const [pendingSyncItems, setPendingSyncItems] = useState(() => getMobileQueueItems());
  const [syncingPending, setSyncingPending] = useState(false);
  const [activeTab, setActiveTab] = useState("tasks");
  const [lastSuccessfulSyncAt, setLastSuccessfulSyncAt] = useState(null);

  const user = session?.user || null;

  const enrichedTasks = useMemo(() => {
    return tasks.map((task) =>
      enrichTask(
        task,
        grids,
        savedRoutes,
        projects,
        checklistItemsByTask,
        issueReportsByTask,
        taskUpdatesByTask
      )
    );
  }, [checklistItemsByTask, grids, issueReportsByTask, projects, savedRoutes, taskUpdatesByTask, tasks]);

  const assignedTasks = useMemo(() => {
    if (!user) return [];
    const filtered = enrichedTasks.filter((task) => isAssignedToCurrentUser(task, user));
    return sortTasks(filtered);
  }, [enrichedTasks, user]);

  const assignedOnlyTasks = useMemo(() => assignedTasks.filter((task) => isAssignedTask(task)), [assignedTasks]);
  const inProcessTasks = useMemo(() => assignedTasks.filter((task) => isInProcessTask(task)), [assignedTasks]);
  const onHoldTasks = useMemo(() => assignedTasks.filter((task) => isOnHoldTask(task)), [assignedTasks]);
  const completedTasks = useMemo(() => assignedTasks.filter((task) => isCompletedTask(task)), [assignedTasks]);
  const activeFieldTasks = useMemo(
    () => sortTasks([...assignedOnlyTasks, ...inProcessTasks, ...onHoldTasks]),
    [assignedOnlyTasks, inProcessTasks, onHoldTasks]
  );

  const visibleTasks = useMemo(() => {
    if (taskFilter === "in_process") return inProcessTasks;
    if (taskFilter === "on_hold") return onHoldTasks;
    if (taskFilter === "completed") return completedTasks;
    if (taskFilter === "active") return activeFieldTasks;
    if (taskFilter === "all") return assignedTasks;
    return assignedOnlyTasks;
  }, [activeFieldTasks, assignedOnlyTasks, assignedTasks, completedTasks, inProcessTasks, onHoldTasks, taskFilter]);

  useEffect(() => {
    let isMounted = true;

    async function loadSession() {
      setAuthLoading(true);
      const { data, error: sessionError } = await supabase.auth.getSession();

      if (!isMounted) return;

      if (sessionError) {
        setError(sessionError.message);
      } else {
        setSession(data?.session || null);
      }

      setAuthLoading(false);
    }

    loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
      refreshOfflineQueueState();
      setSyncMessage("Connection restored. Tap Sync Now to send pending items.");
    }

    function handleOffline() {
      setIsOnline(false);
      refreshOfflineQueueState();
      setSyncMessage("Offline mode. Field changes will be queued on this device.");
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    refreshOfflineQueueState();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (user) {
      const cachedGps = readCachedMobileGps(user.id);
      if (cachedGps) {
        setLastGpsLocation(cachedGps);
        setGpsStatusMessage("Showing last saved GPS point from this device.");
      }

      loadMobileData();
    } else {
      resetMobileDataState();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const liveGpsTaskKey = useMemo(() => {
    return inProcessTasks.map((task) => task.id).filter(Boolean).join("|");
  }, [inProcessTasks]);

  useEffect(() => {
    if (!user?.id) return undefined;

    const liveTasks = inProcessTasks.filter((task) => task?.id);
    if (liveTasks.length === 0) return undefined;

    let cancelled = false;

    async function pushLiveGpsHeartbeat() {
      if (cancelled) return;
      if (!isBrowserOnline()) return;

      for (const task of liveTasks) {
        if (cancelled) return;
        await saveGpsPointForTask(task, "Auto GPS point", {
          silent: true,
          skipOfflineQueue: true,
          source: "auto_live_heartbeat",
        });
      }
    }

    pushLiveGpsHeartbeat();

    const interval = setInterval(() => {
      pushLiveGpsHeartbeat();
    }, MOBILE_GPS_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, liveGpsTaskKey]);

  function refreshOfflineQueueState() {
    setIsOnline(isBrowserOnline());
    setPendingSyncCount(getMobileQueueCount());
    setPendingSyncItems(getMobileQueueItems());
  }

  function resetMobileDataState() {
    setTasks([]);
    setGrids([]);
    setSavedRoutes([]);
    setProjects([]);
    setChecklistItemsByTask({});
    setIssueReportsByTask({});
    setTaskUpdatesByTask({});
    setIssueInputsByTask({});
    setUpdateInputsByTask({});
    setPhotoInputsByTask({});
    setLastGpsLocation(null);
    setGpsStatusMessage("GPS not checked yet.");
    setSelectedTaskId(null);
    setActiveTab("tasks");
    setLastSuccessfulSyncAt(null);
  }

  async function handleLogin(event) {
    event.preventDefault();
    setError("");
    setLoginLoading(true);

    const { data, error: loginError } = await supabase.auth.signInWithPassword({
      email: loginForm.email.trim(),
      password: loginForm.password,
    });

    if (loginError) {
      setError(loginError.message);
    } else {
      setSession(data?.session || null);
      setLoginForm({ email: "", password: "" });
    }

    setLoginLoading(false);
  }

  async function handleLogout() {
    setError("");
    await supabase.auth.signOut();
    setSession(null);
    resetMobileDataState();
  }

  async function loadMobileData() {
    setError("");
    setSyncMessage("");

    if (!isBrowserOnline()) {
      setIsOnline(false);
      refreshOfflineQueueState();
      setSyncMessage("Offline mode. Existing screen data remains available, and new field changes will queue.");
      return;
    }

    setTaskLoading(true);

    const { data: taskData, error: taskError } = await supabase.from("tasks").select("*");

    if (taskError) {
      setError(taskError.message);
      setTaskLoading(false);
      return;
    }

    const safeTaskData = Array.isArray(taskData) ? taskData : [];

    const [gridData, projectData] = await Promise.all([
      safeSelectAll("grids"),
      safeSelectAll("projects"),
    ]);

    const routeData = await fetchRoutesForTasks(safeTaskData, gridData);
    const [checklistGroups, issueGroups, updateGroups] = await Promise.all([
      fetchAndEnsureChecklistRows(safeTaskData),
      fetchIssueReports(safeTaskData),
      fetchTaskUpdates(safeTaskData),
    ]);

    setTasks(safeTaskData);
    setGrids(gridData);
    setSavedRoutes(routeData);
    setProjects(projectData);
    setChecklistItemsByTask(checklistGroups);
    setIssueReportsByTask(issueGroups);
    setTaskUpdatesByTask(updateGroups);
    const syncTime = new Date();
    setLastSuccessfulSyncAt(syncTime.toISOString());
    setSyncMessage(`Tasks synced at ${syncTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`);
    setTaskLoading(false);
    refreshOfflineQueueState();
  }

  async function syncPendingOfflineActions({ silent = false } = {}) {
    refreshOfflineQueueState();

    if (!isBrowserOnline()) {
      setIsOnline(false);
      if (!silent) setSyncMessage("You are offline. Pending items will sync when connection returns.");
      return;
    }

    if (syncingPending) return;

    setSyncingPending(true);
    setError("");

    try {
      const summary = await syncMobileOfflineQueue(async (item) => {
        const payload = item.payload || {};

        if (item.type === OFFLINE_ACTION_TYPES.TASK_STATUS) {
          const { error: updateError } = await supabase
            .from("tasks")
            .update({ status: payload.status })
            .eq("id", payload.task_id);

          if (updateError) throw updateError;

          if (payload.gpsPayload) {
            const { error: gpsError } = await supabase.from("task_updates").insert(payload.gpsPayload);
            if (gpsError) throw gpsError;
          }
          return;
        }

        if (item.type === OFFLINE_ACTION_TYPES.CHECKLIST_ITEM) {
          const { error: checklistError } = await supabase
            .from("task_checklist_items")
            .update(payload.values || {})
            .eq("id", payload.item_id);

          if (checklistError) throw checklistError;
          return;
        }

        if (item.type === OFFLINE_ACTION_TYPES.ISSUE_REPORT) {
          const { error: issueError } = await supabase.from("task_issue_reports").insert(payload.insert || payload);
          if (issueError) throw issueError;
          return;
        }

        if (item.type === OFFLINE_ACTION_TYPES.GPS_CHECKPOINT) {
          const { error: gpsError } = await supabase.from("task_updates").insert(payload.insert || payload);
          if (gpsError) throw gpsError;
          return;
        }

        if (item.type === OFFLINE_ACTION_TYPES.TASK_UPDATE) {
          let photoUrl = payload.update?.photo_url || null;
          const queuedPhotoId = payload.photo?.id;

          if (queuedPhotoId) {
            const queuedFileRecord = await readQueuedFile(queuedPhotoId);
            const queuedBlob = queuedFileRecord?.blob;

            if (!queuedBlob) {
              throw new Error("Queued photo is missing from device storage.");
            }

            photoUrl = await uploadTaskPhotoToStorage(payload.update.task_id, queuedBlob);
          }

          const updatePayload = {
            ...(payload.update || {}),
            photo_url: photoUrl,
          };

          const { error: updateError } = await supabase.from("task_updates").insert(updatePayload);
          if (updateError) throw updateError;

          if (queuedPhotoId) {
            await deleteQueuedFile(queuedPhotoId);
          }

          return;
        }

        throw new Error(`Unsupported offline action type: ${item.type}`);
      });

      refreshOfflineQueueState();

      if (summary.synced > 0) {
        await loadMobileData();
      }

      if (!silent || summary.synced > 0 || summary.failed > 0) {
        if (summary.failed > 0) {
          setSyncMessage(`Sync finished with ${summary.synced} sent and ${summary.failed} still pending.`);
        } else if (summary.synced > 0) {
          setSyncMessage(`Synced ${summary.synced} pending item${summary.synced === 1 ? "" : "s"}.`);
        } else if (!silent) {
          setSyncMessage("No pending items to sync.");
        }
      }
    } catch (syncError) {
      console.error("BabyDragon mobile offline sync error:", syncError);
      setError("Pending sync failed. Please try again when signal is stable.");
    } finally {
      setSyncingPending(false);
      refreshOfflineQueueState();
    }
  }

  async function handleSyncNow() {
    const pendingBeforeSync = getMobileQueueCount();
    await syncPendingOfflineActions();

    if (isBrowserOnline() && pendingBeforeSync === 0) {
      await loadMobileData();
    }
  }

  async function refreshGpsNow(options = {}) {
    const { silent = false, source = "manual_refresh" } = options;

    if (!user?.id) return null;

    if (!silent) {
      setGpsChecking(true);
      setGpsStatusMessage("Checking GPS location...");
    }

    const location = await getCurrentLocationSafe(user.id, {
      allowCachedFallback: true,
      source,
    });

    if (isValidGpsPoint(location)) {
      const cachedGps = location.from_cache ? location : saveCachedMobileGps(user.id, location, source) || location;

      setLastGpsLocation(cachedGps);
      setGpsStatusMessage(
        cachedGps.from_cache
          ? "Fresh GPS unavailable. Showing last saved GPS point."
          : "GPS ready. Fresh location saved."
      );

      if (!silent) setGpsChecking(false);
      return cachedGps;
    }

    setGpsStatusMessage("GPS unavailable. Allow location permission or move where GPS can lock.");
    if (!silent) setGpsChecking(false);
    return null;
  }

  function addLocalTaskUpdate(taskId, updatePayload) {
    const localUpdate = {
      ...updatePayload,
      id: makeLocalId("mobile-update-local", taskId),
      created_at: getLocalCreatedAt(),
      _pending_sync: true,
    };

    setTaskUpdatesByTask((prev) => {
      const key = String(taskId);
      return { ...prev, [key]: [localUpdate, ...(prev[key] || [])] };
    });

    return localUpdate;
  }

  function queueGpsUpdate(task, gpsPayload, message = "GPS checkpoint queued for Sync Now.") {
    queueMobileAction(OFFLINE_ACTION_TYPES.GPS_CHECKPOINT, { insert: gpsPayload }, { task_id: task.id });
    addLocalTaskUpdate(task.id, gpsPayload);
    refreshOfflineQueueState();
    setSyncMessage(message);
  }

  async function saveGpsPointForTask(task, comment = "GPS Checkpoint", options = {}) {
    const { silent = false, skipOfflineQueue = false, source = "mobile_task_gps" } = options;
    const isBackgroundHeartbeat = silent && source === "auto_live_heartbeat";

    if (!task?.id || !user?.id) return null;

    if (!silent) {
      setGpsTrackingTaskId(task.id);
      setGpsStatusMessage("Saving GPS checkpoint...");
    }

    const location = await getCurrentLocationSafe(user.id, {
      allowCachedFallback: true,
      source,
    });

    if (!isValidGpsPoint(location)) {
      if (!silent) {
        setGpsStatusMessage("GPS checkpoint not saved. Location permission or signal is unavailable.");
        setGpsTrackingTaskId(null);
      }
      return null;
    }

    const cachedLocation = location.from_cache ? location : saveCachedMobileGps(user.id, location, source) || location;

    if (!isBackgroundHeartbeat) {
      setLastGpsLocation(cachedLocation);
    }

    const gpsPayload = {
      task_id: task.id,
      user_id: user.id,
      user_email: user.email || "",
      comment,
      photo_url: null,
      latitude: location.latitude,
      longitude: location.longitude,
    };

    if (!isBrowserOnline()) {
      if (!skipOfflineQueue) {
        queueGpsUpdate(
          task,
          gpsPayload,
          comment === "GPS Checkpoint"
            ? "GPS checkpoint saved offline. Tap Sync Now when signal returns."
            : "Task GPS event saved offline. Tap Sync Now when signal returns."
        );
      }

      setGpsStatusMessage(`GPS queued: ${formatGpsPoint(location)}${location.accuracy ? ` • ±${Math.round(location.accuracy)}m` : ""}`);
      setGpsTrackingTaskId(null);
      return { ...gpsPayload, id: makeLocalId("mobile-gps-local", task.id), _pending_sync: true };
    }

    const { data, error: gpsError } = await supabase.from("task_updates").insert(gpsPayload).select("*").single();

    if (gpsError) {
      if (shouldQueueAfterError(gpsError) && !skipOfflineQueue) {
        queueGpsUpdate(task, gpsPayload);
        setGpsStatusMessage("GPS captured but signal failed. Checkpoint queued for Sync Now.");
        setGpsTrackingTaskId(null);
        return { ...gpsPayload, id: makeLocalId("mobile-gps-local", task.id), _pending_sync: true };
      }

      if (!silent) {
        setError(`GPS checkpoint could not save to Admin tracking: ${gpsError.message}`);
        setGpsStatusMessage("GPS capture worked, but Admin tracking save failed.");
        setGpsTrackingTaskId(null);
      }
      return null;
    }

    const savedPoint = data || {
      ...gpsPayload,
      id: makeLocalId("mobile-gps", task.id),
      created_at: getLocalCreatedAt(),
    };

    // Auto live GPS must be quiet. It writes to Supabase for Admin Live Map,
    // but it should not rebuild task cards, route maps, or form state every 30 seconds.
    if (!isBackgroundHeartbeat) {
      setTaskUpdatesByTask((prev) => {
        const taskId = String(task.id);
        return { ...prev, [taskId]: [savedPoint, ...(prev[taskId] || [])] };
      });

      setGpsStatusMessage(
        `GPS saved: ${formatGpsPoint(location)}${location.accuracy ? ` • ±${Math.round(location.accuracy)}m` : ""}`
      );
    }

    if (!silent) {
      setSyncMessage(comment === "GPS Checkpoint" ? "GPS checkpoint saved to Admin tracking." : "GPS point saved to Admin tracking.");
      setGpsTrackingTaskId(null);
    }

    return savedPoint;
  }

  function openNavigation(task) {
    const url = buildGoogleMapsUrl(task);

    if (!url) {
      setError("Navigation is not available yet because this task has no grid center or route coordinates.");
      return;
    }

    setError("");
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function updateTaskStatus(task, nextStatus) {
    if (!task?.id || actionLoadingTaskId) return;

    const taskRef = getTaskReference(task);
    const wasOnHold = isOnHoldTask(task);
    const nextLabel =
      nextStatus === "in_progress"
        ? wasOnHold
          ? "Resumed"
          : "In Progress"
        : nextStatus === "on_hold"
          ? "On Hold"
          : nextStatus === "completed"
            ? "Completed"
            : nextStatus;

    if (nextStatus === "completed") {
      const checklistStats = getChecklistStats(task);

      if (checklistStats.completed < checklistStats.total) {
        const shouldContinue = window.confirm(
          `Checklist is ${checklistStats.completed}/${checklistStats.total} complete. Complete this task anyway?`
        );

        if (!shouldContinue) return;
      }
    }

    setError("");
    setSyncMessage("");
    setActionLoadingTaskId(task.id);

    const location = await getCurrentLocationSafe(user?.id, {
      allowCachedFallback: true,
      source: "task_status",
    });

    const gpsPayload = isValidGpsPoint(location)
      ? {
          task_id: task.id,
          user_id: user?.id || null,
          user_email: user?.email || "",
          comment:
            nextStatus === "completed"
              ? "Task completed from mobile"
              : nextStatus === "on_hold"
                ? "Task put on hold from mobile"
                : wasOnHold
                  ? "Task resumed from mobile"
                  : "Task started from mobile",
          photo_url: null,
          latitude: location.latitude,
          longitude: location.longitude,
        }
      : null;

    const applyLocalStatus = () => {
      setTasks((prevTasks) =>
        prevTasks.map((item) => (item.id === task.id ? { ...item, status: nextStatus } : item))
      );
      if (gpsPayload) addLocalTaskUpdate(task.id, gpsPayload);
      setTaskFilter(nextStatus === "completed" ? "completed" : nextStatus === "on_hold" ? "on_hold" : "in_process");
      setSelectedTaskId(task.id);
    };

    if (!isBrowserOnline()) {
      queueMobileAction(
        OFFLINE_ACTION_TYPES.TASK_STATUS,
        { task_id: task.id, status: nextStatus, gpsPayload },
        { task_ref: taskRef }
      );
      applyLocalStatus();
      refreshOfflineQueueState();
      setSyncMessage(`${taskRef} moved to ${nextLabel} offline. Tap Sync Now when signal returns.`);
      setActionLoadingTaskId(null);
      return;
    }

    const { error: updateError } = await supabase.from("tasks").update({ status: nextStatus }).eq("id", task.id);

    if (updateError) {
      if (shouldQueueAfterError(updateError)) {
        queueMobileAction(
          OFFLINE_ACTION_TYPES.TASK_STATUS,
          { task_id: task.id, status: nextStatus, gpsPayload },
          { task_ref: taskRef }
        );
        applyLocalStatus();
        refreshOfflineQueueState();
        setSyncMessage(`${taskRef} moved to ${nextLabel} locally. Sync Now will send it to Admin.`);
      } else {
        setError(updateError.message);
      }

      setActionLoadingTaskId(null);
      return;
    }

    applyLocalStatus();

    if (gpsPayload) {
      const { error: gpsError } = await supabase.from("task_updates").insert(gpsPayload);
      if (gpsError && shouldQueueAfterError(gpsError)) {
        queueMobileAction(OFFLINE_ACTION_TYPES.GPS_CHECKPOINT, { insert: gpsPayload }, { task_id: task.id });
        refreshOfflineQueueState();
      }
    }

    setSyncMessage(`${taskRef} moved to ${nextLabel}.`);
    setActionLoadingTaskId(null);
  }

  async function updateChecklistItem(task, itemId, checked) {
    if (!task?.id || checklistLoadingTaskId) return;

    if (!isInProcessTask(task)) {
      setError("Start the task before editing the checklist. Completed tasks are read-only.");
      return;
    }

    const checklistRow = findChecklistRowForItem(task, itemId);

    if (!checklistRow?.id) {
      setError("Checklist row is still loading. Tap Sync Now and try again.");
      return;
    }

    const now = getLocalCreatedAt();
    const payload = {
      is_done: checked,
      completed_at: checked ? now : null,
      completed_by: checked ? user?.id || null : null,
      updated_at: now,
    };

    setError("");
    setSyncMessage("");
    setChecklistLoadingTaskId(task.id);

    const optimisticRow = { ...checklistRow, ...payload, _pending_sync: !isBrowserOnline() };

    setChecklistItemsByTask((prev) => {
      const taskId = String(task.id);
      const existingRows = prev[taskId] || [];
      return { ...prev, [taskId]: existingRows.map((row) => (row.id === checklistRow.id ? optimisticRow : row)) };
    });

    if (!isBrowserOnline()) {
      queueMobileAction(
        OFFLINE_ACTION_TYPES.CHECKLIST_ITEM,
        { item_id: checklistRow.id, task_id: task.id, values: payload },
        { label: checklistRow.label }
      );
      refreshOfflineQueueState();
      setSyncMessage("Checklist saved offline. Tap Sync Now when signal returns.");
      setChecklistLoadingTaskId(null);
      return;
    }

    const { data, error: updateError } = await supabase
      .from("task_checklist_items")
      .update(payload)
      .eq("id", checklistRow.id)
      .select("*")
      .single();

    if (updateError) {
      if (shouldQueueAfterError(updateError)) {
        queueMobileAction(
          OFFLINE_ACTION_TYPES.CHECKLIST_ITEM,
          { item_id: checklistRow.id, task_id: task.id, values: payload },
          { label: checklistRow.label }
        );
        refreshOfflineQueueState();
        setSyncMessage("Checklist saved locally. Sync Now will send it to Admin.");
      } else {
        setError(`Checklist could not save to Admin tracking: ${updateError.message}`);
        setChecklistItemsByTask((prev) => {
          const taskId = String(task.id);
          const existingRows = prev[taskId] || [];
          return { ...prev, [taskId]: existingRows.map((row) => (row.id === checklistRow.id ? checklistRow : row)) };
        });
      }
    } else {
      setChecklistItemsByTask((prev) => {
        const taskId = String(task.id);
        const existingRows = prev[taskId] || [];
        const nextRows = existingRows.map((row) => (row.id === checklistRow.id ? data : row));
        const nextStateTask = { ...task, _mobileChecklistItems: nextRows };
        const stats = getChecklistStats(nextStateTask);
        setSyncMessage(`Checklist saved to Admin tracking: ${stats.completed}/${stats.total} complete.`);
        return { ...prev, [taskId]: nextRows };
      });

      const targetItem = CHECKLIST_ITEMS.find((item) => item.id === itemId);
      await saveGpsPointForTask(task, `Checklist GPS: ${targetItem?.label || "Checklist item"}`, { silent: true, skipOfflineQueue: true });
    }

    setChecklistLoadingTaskId(null);
  }

  function updateIssueInput(taskId, field, value) {
    setIssueInputsByTask((prev) => ({
      ...prev,
      [taskId]: { ...getDefaultIssueInput(), ...(prev[taskId] || {}), [field]: value },
    }));
  }

  async function submitIssueReport(task, photoFile = null) {
    if (!task?.id || issueLoadingTaskId) return;

    if (!isInProcessTask(task) && !isOnHoldTask(task)) {
      setError("Start or resume the task before submitting field issues. Completed tasks are read-only.");
      return;
    }

    const input = { ...getDefaultIssueInput(), ...(issueInputsByTask[task.id] || {}) };
    const description = String(input.description || "").trim();

    if (!input.issue_type) {
      setError("Please select an issue type.");
      return;
    }

    if (!description) {
      setError("Please add a short issue note before submitting.");
      return;
    }

    if (photoFile && photoFile.size > 5 * 1024 * 1024) {
      setError("Photo is too large. Please upload an image under 5 MB.");
      return;
    }

    setError("");
    setSyncMessage("");
    setIssueLoadingTaskId(task.id);

    const resetIssueForm = () => {
      setIssueInputsByTask((prev) => ({ ...prev, [task.id]: { ...getDefaultIssueInput(), description: "" } }));
      setPhotoInputsByTask((prev) => ({ ...prev, [task.id]: null }));
    };

    const location = await refreshGpsNow({ silent: true, source: "issue_evidence" });
    const now = getLocalCreatedAt();

    const issuePayload = {
      task_id: task.id,
      issue_type: input.issue_type,
      severity: input.severity || "normal",
      description,
      status: "open",
      lat: location?.latitude ?? null,
      lon: location?.longitude ?? null,
      reported_by: user?.id || null,
    };

    const evidencePayload = photoFile
      ? {
          task_id: task.id,
          user_id: user?.id || null,
          user_email: user?.email || "",
          comment: `Issue evidence: ${input.issue_type} - ${description}`,
          photo_url: null,
          latitude: location?.latitude ?? null,
          longitude: location?.longitude ?? null,
        }
      : null;

    const addLocalIssue = (isPending = false) => {
      const savedIssue = {
        ...issuePayload,
        id: makeLocalId("mobile-issue", task.id),
        created_at: now,
        _pending_sync: isPending,
      };

      setIssueReportsByTask((prev) => {
        const taskId = String(task.id);
        return { ...prev, [taskId]: [savedIssue, ...(prev[taskId] || [])] };
      });
    };

    const queueIssueAndEvidence = async (message) => {
      queueMobileAction(OFFLINE_ACTION_TYPES.ISSUE_REPORT, { insert: issuePayload }, { task_id: task.id });
      addLocalIssue(true);

      if (evidencePayload && photoFile) {
        const localPhotoUrl = URL.createObjectURL(photoFile);
        await queueTaskUpdate(task, evidencePayload, photoFile, localPhotoUrl);
      } else {
        refreshOfflineQueueState();
      }

      resetIssueForm();
      setSyncMessage(message);
    };

    try {
      if (!isBrowserOnline()) {
        await queueIssueAndEvidence(
          photoFile
            ? "Issue and photo evidence saved offline. Tap Sync Now when signal returns."
            : "Issue report saved offline. Tap Sync Now when signal returns."
        );
        return;
      }

      const { data, error: insertError } = await supabase.from("task_issue_reports").insert(issuePayload).select("*").single();

      if (insertError) {
        if (shouldQueueAfterError(insertError)) {
          await queueIssueAndEvidence(
            photoFile
              ? "Issue and photo evidence saved locally. Sync Now will send both to Admin."
              : "Issue report saved locally. Sync Now will send it to Admin."
          );
          return;
        }

        setError(`Issue could not save to Admin tracking: ${insertError.message}`);
        return;
      }

      const savedIssue = data || { ...issuePayload, id: makeLocalId("mobile-issue", task.id), created_at: now };

      setIssueReportsByTask((prev) => {
        const taskId = String(task.id);
        return { ...prev, [taskId]: [savedIssue, ...(prev[taskId] || [])] };
      });

      if (evidencePayload && photoFile) {
        try {
          const photoUrl = await uploadTaskPhotoToStorage(task.id, photoFile);
          const onlineEvidencePayload = { ...evidencePayload, photo_url: photoUrl };
          const { data: updateData, error: updateError } = await supabase.from("task_updates").insert(onlineEvidencePayload).select("*").single();
          if (updateError) throw updateError;

          const savedUpdate = updateData || {
            ...onlineEvidencePayload,
            id: makeLocalId("mobile-issue-evidence", task.id),
            created_at: now,
          };

          setTaskUpdatesByTask((prev) => {
            const taskId = String(task.id);
            return { ...prev, [taskId]: [savedUpdate, ...(prev[taskId] || [])] };
          });

          setSyncMessage("Issue and photo evidence saved to Admin tracking.");
        } catch (photoError) {
          await queueTaskUpdate(task, evidencePayload, photoFile, URL.createObjectURL(photoFile));
          setSyncMessage("Issue saved. Photo evidence queued for Sync Now.");
        }
      } else {
        setSyncMessage("Issue report saved to Admin tracking.");
      }

      resetIssueForm();
    } catch (issueError) {
      setError(`Issue/evidence could not be saved: ${issueError.message}`);
    } finally {
      setIssueLoadingTaskId(null);
      refreshOfflineQueueState();
    }
  }

  async function submitRouteIssueReport(task, routeIssueInput = {}, photoFile = null) {
    if (!task?.id || issueLoadingTaskId) return;

    if (!isInProcessTask(task) && !isOnHoldTask(task)) {
      setError("Start or resume the task before submitting route issues. Completed tasks are read-only.");
      return;
    }

    const input = { ...getDefaultIssueInput(), ...(routeIssueInput || {}) };
    const description = String(input.description || "").trim();

    if (!input.issue_type) {
      setError("Please select an issue type.");
      return;
    }

    if (!description) {
      setError("Please add a short issue note before submitting.");
      return;
    }

    if (photoFile && photoFile.size > 5 * 1024 * 1024) {
      setError("Photo is too large. Please upload an image under 5 MB.");
      return;
    }

    setError("");
    setSyncMessage("");
    setIssueLoadingTaskId(task.id);

    const location = await refreshGpsNow({ silent: true, source: "route_issue" });
    const now = getLocalCreatedAt();

    const issuePayload = {
      task_id: task.id,
      issue_type: input.issue_type,
      severity: input.severity || "normal",
      description,
      status: "open",
      lat: location?.latitude ?? null,
      lon: location?.longitude ?? null,
      reported_by: user?.id || null,
    };

    const evidencePayload = photoFile
      ? {
          task_id: task.id,
          user_id: user?.id || null,
          user_email: user?.email || "",
          comment: `Route issue photo: ${description}`,
          photo_url: null,
          latitude: location?.latitude ?? null,
          longitude: location?.longitude ?? null,
        }
      : null;

    const addLocalIssue = (isPending = false) => {
      const savedIssue = {
        ...issuePayload,
        id: makeLocalId("mobile-route-issue", task.id),
        created_at: now,
        _pending_sync: isPending,
      };

      setIssueReportsByTask((prev) => {
        const taskId = String(task.id);
        return { ...prev, [taskId]: [savedIssue, ...(prev[taskId] || [])] };
      });
    };

    const queueIssueAndEvidence = async (message) => {
      queueMobileAction(OFFLINE_ACTION_TYPES.ISSUE_REPORT, { insert: issuePayload }, { task_id: task.id });
      addLocalIssue(true);

      if (evidencePayload && photoFile) {
        const localPhotoUrl = URL.createObjectURL(photoFile);
        await queueTaskUpdate(task, evidencePayload, photoFile, localPhotoUrl);
      } else {
        refreshOfflineQueueState();
      }

      setSyncMessage(message);
    };

    try {
      if (!isBrowserOnline()) {
        await queueIssueAndEvidence(
          photoFile
            ? "Route issue and photo saved offline. Tap Sync Now when signal returns."
            : "Route issue saved offline. Tap Sync Now when signal returns."
        );
        return;
      }

      const { data, error: insertError } = await supabase.from("task_issue_reports").insert(issuePayload).select("*").single();

      if (insertError) {
        if (shouldQueueAfterError(insertError)) {
          await queueIssueAndEvidence(
            photoFile
              ? "Route issue and photo saved locally. Sync Now will send both to Admin."
              : "Route issue saved locally. Sync Now will send it to Admin."
          );
          return;
        }

        setError(`Route issue could not save to Admin tracking: ${insertError.message}`);
        return;
      }

      const savedIssue = data || { ...issuePayload, id: makeLocalId("mobile-route-issue", task.id), created_at: now };
      setIssueReportsByTask((prev) => {
        const taskId = String(task.id);
        return { ...prev, [taskId]: [savedIssue, ...(prev[taskId] || [])] };
      });

      if (evidencePayload && photoFile) {
        try {
          const photoUrl = await uploadTaskPhotoToStorage(task.id, photoFile);
          const onlineEvidencePayload = { ...evidencePayload, photo_url: photoUrl };
          const { data: updateData, error: updateError } = await supabase.from("task_updates").insert(onlineEvidencePayload).select("*").single();
          if (updateError) throw updateError;

          const savedUpdate = updateData || {
            ...onlineEvidencePayload,
            id: makeLocalId("mobile-route-evidence", task.id),
            created_at: now,
          };

          setTaskUpdatesByTask((prev) => {
            const taskId = String(task.id);
            return { ...prev, [taskId]: [savedUpdate, ...(prev[taskId] || [])] };
          });

          setSyncMessage("Route issue and photo evidence saved to Admin tracking.");
        } catch (photoError) {
          await queueTaskUpdate(task, evidencePayload, photoFile, URL.createObjectURL(photoFile));
          setSyncMessage("Route issue saved. Photo evidence queued for Sync Now.");
        }
      } else {
        setSyncMessage("Route issue saved to Admin tracking.");
      }
    } catch (routeIssueError) {
      setError(`Route issue could not be saved: ${routeIssueError.message}`);
    } finally {
      setIssueLoadingTaskId(null);
      refreshOfflineQueueState();
    }
  }

  function updateTaskUpdateInput(taskId, value) {
    setUpdateInputsByTask((prev) => ({ ...prev, [taskId]: value }));
  }

  function updateTaskPhotoInput(taskId, file) {
    setPhotoInputsByTask((prev) => ({ ...prev, [taskId]: file || null }));
  }

  async function queueTaskUpdate(task, updatePayload, photoFile, localPhotoUrl = null) {
    let photoMeta = null;

    if (photoFile) {
      photoMeta = await saveQueuedFile(photoFile);
    }

    queueMobileAction(
      OFFLINE_ACTION_TYPES.TASK_UPDATE,
      {
        update: { ...updatePayload, photo_url: null },
        photo: photoMeta,
      },
      { task_id: task.id }
    );

    addLocalTaskUpdate(task.id, {
      ...updatePayload,
      photo_url: localPhotoUrl,
      _queued_photo_name: photoMeta?.name || "",
    });

    refreshOfflineQueueState();
  }

  async function submitTaskUpdate(task) {
    if (!task?.id || taskUpdateLoadingTaskId) return;

    if (isAssignedTask(task)) {
      setError("Start the task before adding notes or photo evidence.");
      return;
    }

    const comment = String(updateInputsByTask[task.id] || "").trim();
    const photoFile = photoInputsByTask[task.id] || null;

    if (!comment && !photoFile) {
      setError("Please add a note or choose a photo before submitting.");
      return;
    }

    if (photoFile && photoFile.size > 5 * 1024 * 1024) {
      setError("Photo is too large. Please upload an image under 5 MB.");
      return;
    }

    setError("");
    setSyncMessage("");
    setTaskUpdateLoadingTaskId(task.id);

    const location = await refreshGpsNow({ silent: true, source: "task_update" });

    const updatePayload = {
      task_id: task.id,
      user_id: user?.id || null,
      user_email: user?.email || "",
      comment,
      photo_url: null,
      latitude: location?.latitude ?? null,
      longitude: location?.longitude ?? null,
    };

    const localPhotoUrl = photoFile ? URL.createObjectURL(photoFile) : null;

    if (!isBrowserOnline()) {
      try {
        await queueTaskUpdate(task, updatePayload, photoFile, localPhotoUrl);
        setUpdateInputsByTask((prev) => ({ ...prev, [task.id]: "" }));
        setPhotoInputsByTask((prev) => ({ ...prev, [task.id]: null }));
        setSyncMessage(photoFile ? "Photo evidence saved offline. Tap Sync Now when signal returns." : "Field note saved offline. Tap Sync Now when signal returns.");
      } catch (queueError) {
        setError(`Could not save update offline: ${queueError.message}`);
      } finally {
        setTaskUpdateLoadingTaskId(null);
      }
      return;
    }

    try {
      const photoUrl = await uploadTaskPhotoToStorage(task.id, photoFile);
      const onlinePayload = { ...updatePayload, photo_url: photoUrl };

      const { data, error: insertError } = await supabase.from("task_updates").insert(onlinePayload).select("*").single();
      if (insertError) throw insertError;

      const savedUpdate = data || { ...onlinePayload, id: makeLocalId("mobile-update", task.id), created_at: getLocalCreatedAt() };

      setTaskUpdatesByTask((prev) => {
        const taskId = String(task.id);
        return { ...prev, [taskId]: [savedUpdate, ...(prev[taskId] || [])] };
      });

      setUpdateInputsByTask((prev) => ({ ...prev, [task.id]: "" }));
      setPhotoInputsByTask((prev) => ({ ...prev, [task.id]: null }));
      setSyncMessage(photoFile ? "Photo evidence saved to Admin tracking." : "Field note saved to Admin tracking.");
    } catch (saveError) {
      if (shouldQueueAfterError(saveError)) {
        try {
          await queueTaskUpdate(task, updatePayload, photoFile, localPhotoUrl);
          setUpdateInputsByTask((prev) => ({ ...prev, [task.id]: "" }));
          setPhotoInputsByTask((prev) => ({ ...prev, [task.id]: null }));
          setSyncMessage("Update saved locally. Sync Now will send it to Admin.");
        } catch (queueError) {
          setError(`Update could not save online or offline: ${queueError.message}`);
        }
      } else {
        setError(`Update could not save to Admin tracking: ${saveError.message}`);
      }
    } finally {
      setTaskUpdateLoadingTaskId(null);
    }
  }

  function handleFilterChange(value) {
    setTaskFilter(value);
    setSelectedTaskId(null);
    setError("");
  }

  function handleToggleDetails(taskId) {
    setSelectedTaskId((currentTaskId) => (currentTaskId === taskId ? null : taskId));
  }

  if (authLoading) return <MobileLoading />;

  if (!session) {
    return (
      <MobileLogin
        error={error}
        loginForm={loginForm}
        loginLoading={loginLoading}
        onLogin={handleLogin}
        onLoginFormChange={(patch) => setLoginForm((prev) => ({ ...prev, ...patch }))}
      />
    );
  }

  const activeTitle = activeTab === "routes" ? "Routes" : activeTab === "sync" ? "Sync" : activeTab === "profile" ? "Profile" : "My Tasks";

  return (
    <main className="bd-mobile-screen">
      <header className="bd-mobile-topbar">
        <div>
          <p className="bd-mobile-eyebrow">BabyDragon Mobile</p>
          <h1>{activeTitle}</h1>
        </div>

        <button type="button" className="bd-mobile-ghost" onClick={handleLogout}>Logout</button>
      </header>

      {activeTab === "tasks" && (
        <MobileMyTasks
          user={user}
          assignedOnlyTasks={assignedOnlyTasks}
          inProcessTasks={inProcessTasks}
          onHoldTasks={onHoldTasks}
          completedTasks={completedTasks}
          activeFieldTasks={activeFieldTasks}
          assignedTasks={assignedTasks}
          visibleTasks={visibleTasks}
          taskLoading={taskLoading}
          error={error}
          syncMessage={syncMessage}
          taskFilter={taskFilter}
          selectedTaskId={selectedTaskId}
          actionLoadingTaskId={actionLoadingTaskId}
          checklistLoadingTaskId={checklistLoadingTaskId}
          issueLoadingTaskId={issueLoadingTaskId}
          taskUpdateLoadingTaskId={taskUpdateLoadingTaskId}
          gpsChecking={gpsChecking}
          gpsTrackingTaskId={gpsTrackingTaskId}
          lastGpsLocation={lastGpsLocation}
          gpsStatusMessage={gpsStatusMessage}
          issueInputsByTask={issueInputsByTask}
          updateInputsByTask={updateInputsByTask}
          photoInputsByTask={photoInputsByTask}
          isOnline={isOnline}
          pendingSyncCount={pendingSyncCount}
          pendingSyncItems={pendingSyncItems}
          syncingPending={syncingPending}
          onSyncNow={handleSyncNow}
          onFilterChange={handleFilterChange}
          onToggleDetails={handleToggleDetails}
          onOpenNavigation={openNavigation}
          onUpdateTaskStatus={updateTaskStatus}
          onUpdateChecklistItem={updateChecklistItem}
          onUpdateIssueInput={updateIssueInput}
          onSubmitIssueReport={submitIssueReport}
          onUpdateTaskUpdateInput={updateTaskUpdateInput}
          onUpdateTaskPhotoInput={updateTaskPhotoInput}
          onSubmitTaskUpdate={submitTaskUpdate}
          onRefreshGpsNow={refreshGpsNow}
          onSaveGpsPointForTask={saveGpsPointForTask}
        />
      )}

      {activeTab === "routes" && (
        <MobileRouteView
		  assignedTasks={assignedTasks}
		  taskLoading={taskLoading}
		  issueLoadingTaskId={issueLoadingTaskId}
		  onOpenNavigation={openNavigation}
		  onSubmitRouteIssue={submitRouteIssueReport}
		  onUpdateTaskStatus={updateTaskStatus}
		/>
      )}

      {activeTab === "rf" && (
        <MobileRfKpi
          user={user}
          activeFieldTasks={assignedTasks}
          inProcessTasks={inProcessTasks}
          lastGpsLocation={lastGpsLocation}
          gpsStatusMessage={gpsStatusMessage}
          gpsChecking={gpsChecking}
          onRefreshGpsNow={refreshGpsNow}
        />
      )}

      {activeTab === "sync" && (
        <section className="bd-mobile-sync-view">
          <div className="bd-mobile-section-title">
            <p className="bd-mobile-eyebrow">Sync Center</p>
            <h2>Offline Queue</h2>
            <p className="bd-mobile-muted">Review pending field changes and send them when signal returns.</p>
          </div>

          <MobileSyncStatus
            user={user}
            assignedOnlyCount={assignedOnlyTasks.length}
            inProcessCount={inProcessTasks.length}
            onHoldCount={onHoldTasks.length}
            completedCount={completedTasks.length}
            allCount={assignedTasks.length}
            error={error}
            syncMessage={syncMessage}
            taskFilter={taskFilter}
            taskLoading={taskLoading}
            isOnline={isOnline}
            pendingSyncCount={pendingSyncCount}
            pendingSyncItems={pendingSyncItems}
            syncingPending={syncingPending}
            onFilterChange={handleFilterChange}
            onSyncNow={handleSyncNow}
          />

          <section className="bd-mobile-profile-panel">
            <h3>Sync Notes</h3>
            <p>Checklist, issues, notes/photos, manual GPS checkpoints, and task start/complete actions can wait here when the FE has weak signal.</p>
            <p>Auto GPS trail points are not queued offline, so the queue stays lean instead of growing like a pocket full of marbles.</p>
          </section>
        </section>
      )}

      {activeTab === "profile" && (
        <MobileProfile
          user={user}
          isOnline={isOnline}
          pendingSyncCount={pendingSyncCount}
          assignedOnlyCount={assignedOnlyTasks.length}
          inProcessCount={inProcessTasks.length}
          onHoldCount={onHoldTasks.length}
          completedCount={completedTasks.length}
          allCount={assignedTasks.length}
          lastSuccessfulSyncAt={lastSuccessfulSyncAt}
          lastGpsLocation={lastGpsLocation}
          gpsStatusMessage={gpsStatusMessage}
          gpsChecking={gpsChecking}
          syncingPending={syncingPending}
          onRefreshGpsNow={refreshGpsNow}
          onSyncNow={handleSyncNow}
          onLogout={handleLogout}
        />
      )}

      <nav className="bd-mobile-bottom-nav bd-mobile-bottom-nav-v110">
        <button type="button" className={activeTab === "tasks" ? "active" : ""} onClick={() => setActiveTab("tasks")}>My Tasks</button>
        <button type="button" className={activeTab === "routes" ? "active" : ""} onClick={() => setActiveTab("routes")}>Routes</button>
        <button type="button" className={activeTab === "rf" ? "active" : ""} onClick={() => setActiveTab("rf")}>RF KPI</button>
        <button type="button" className={activeTab === "sync" ? "active" : ""} onClick={() => setActiveTab("sync")}>{pendingSyncCount > 0 ? `Sync ${pendingSyncCount}` : "Sync"}</button>
        <button type="button" className={activeTab === "profile" ? "active" : ""} onClick={() => setActiveTab("profile")}>Profile</button>
      </nav>
    </main>
  );
}
