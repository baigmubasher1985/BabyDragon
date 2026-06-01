// =========================================================
// BabyDragon / NetField-360
// Offline-Safe FE Updates V1
// src/utils/offlineQueue.js
// =========================================================
//
// Purpose:
// Store failed FE actions locally and retry them later.
//
// Supports:
// - task updates / notes
// - GPS points
// - checklist changes
// - issue reports
// - photo/evidence payload metadata
//
// Uses IndexedDB so larger payloads/photos can be stored more safely
// than localStorage.
// =========================================================

const DB_NAME = "babydragon_offline_queue";
const DB_VERSION = 1;
const STORE_NAME = "pending_actions";

export const OFFLINE_ACTION_TYPES = {
  TASK_UPDATE: "task_update",
  GPS_POINT: "gps_point",
  CHECKLIST_ITEM: "checklist_item",
  ISSUE_REPORT: "issue_report",
  PHOTO_EVIDENCE: "photo_evidence",
};

function openOfflineDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(request.error || new Error("Failed to open offline queue database."));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: "offline_id",
        });

        store.createIndex("type", "type", { unique: false });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("created_at", "created_at", { unique: false });
      }
    };
  });
}

function makeOfflineId(type) {
  if (window.crypto?.randomUUID) {
    return `${type}_${window.crypto.randomUUID()}`;
  }

  return `${type}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export async function queueOfflineAction({
  type,
  payload,
  table_name = null,
  note = "",
}) {
  if (!type) {
    throw new Error("Offline action type is required.");
  }

  const db = await openOfflineDb();

  const item = {
    offline_id: makeOfflineId(type),
    type,
    table_name,
    payload,
    note,
    status: "pending",
    retry_count: 0,
    last_error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    const request = store.add(item);

    request.onsuccess = () => resolve(item);

    request.onerror = () => {
      reject(request.error || new Error("Failed to queue offline action."));
    };
  });
}

export async function getPendingOfflineActions() {
  const db = await openOfflineDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const rows = request.result || [];

      const pending = rows
        .filter((item) => item.status === "pending")
        .sort((a, b) => {
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        });

      resolve(pending);
    };

    request.onerror = () => {
      reject(request.error || new Error("Failed to read offline queue."));
    };
  });
}

export async function getOfflineQueueCount() {
  const items = await getPendingOfflineActions();
  return items.length;
}

export async function markOfflineActionFailed(offlineId, errorMessage) {
  const db = await openOfflineDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getRequest = store.get(offlineId);

    getRequest.onsuccess = () => {
      const item = getRequest.result;

      if (!item) {
        resolve(null);
        return;
      }

      const updated = {
        ...item,
        retry_count: Number(item.retry_count || 0) + 1,
        last_error: errorMessage || "Sync failed",
        updated_at: new Date().toISOString(),
      };

      const putRequest = store.put(updated);

      putRequest.onsuccess = () => resolve(updated);
      putRequest.onerror = () => {
        reject(putRequest.error || new Error("Failed to update offline action."));
      };
    };

    getRequest.onerror = () => {
      reject(getRequest.error || new Error("Failed to find offline action."));
    };
  });
}

export async function removeOfflineAction(offlineId) {
  const db = await openOfflineDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(offlineId);

    request.onsuccess = () => resolve(true);

    request.onerror = () => {
      reject(request.error || new Error("Failed to remove offline action."));
    };
  });
}

export async function clearOfflineQueue() {
  const db = await openOfflineDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => resolve(true);

    request.onerror = () => {
      reject(request.error || new Error("Failed to clear offline queue."));
    };
  });
}

export function isBrowserOnline() {
  return navigator.onLine;
}

// Generic helper:
// Try the Supabase action first.
// If it fails, save the payload locally.
export async function tryOnlineThenQueue({
  type,
  payload,
  table_name = null,
  note = "",
  onlineAction,
}) {
  if (typeof onlineAction !== "function") {
    throw new Error("onlineAction function is required.");
  }

  try {
    const result = await onlineAction();

    if (result?.error) {
      throw result.error;
    }

    return {
      ok: true,
      queued: false,
      result,
      offlineItem: null,
    };
  } catch (error) {
    const offlineItem = await queueOfflineAction({
      type,
      payload,
      table_name,
      note,
    });

    return {
      ok: false,
      queued: true,
      result: null,
      offlineItem,
      error,
    };
  }
}

// Processor used by FE Dashboard later.
// It takes a custom sync handler from the page because each action type
// may map to a different table/storage upload.
export async function syncOfflineQueue(syncHandler) {
  if (typeof syncHandler !== "function") {
    throw new Error("syncHandler function is required.");
  }

  const items = await getPendingOfflineActions();

  const summary = {
    total: items.length,
    synced: 0,
    failed: 0,
    results: [],
  };

  for (const item of items) {
    try {
      await syncHandler(item);
      await removeOfflineAction(item.offline_id);

      summary.synced += 1;
      summary.results.push({
        offline_id: item.offline_id,
        type: item.type,
        status: "synced",
      });
    } catch (error) {
      await markOfflineActionFailed(item.offline_id, error?.message || "Sync failed");

      summary.failed += 1;
      summary.results.push({
        offline_id: item.offline_id,
        type: item.type,
        status: "failed",
        error: error?.message || "Sync failed",
      });
    }
  }

  return summary;
}