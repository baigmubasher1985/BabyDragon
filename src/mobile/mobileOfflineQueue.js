export const OFFLINE_ACTION_TYPES = {
  TASK_STATUS: "task_status",
  CHECKLIST_ITEM: "checklist_item",
  ISSUE_REPORT: "issue_report",
  TASK_UPDATE: "task_update",
  GPS_CHECKPOINT: "gps_checkpoint",
  /** F10C2 Phase 2 — result packaging / mocked upload (extends this queue; no third queue). */
  FIELD_TEST_RESULT_SUBMIT: "field_test_result_submit",
};

export const MOBILE_QUEUE_STORAGE_KEY = "babydragon_mobile_offline_queue_v1";
export const MOBILE_QUEUE_RECORD_VERSION = 1;

const QUEUE_KEY = MOBILE_QUEUE_STORAGE_KEY;
const QUARANTINE_KEY = "babydragon_mobile_offline_queue_quarantine_v1";

export function isBrowserOnline() {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

export function shouldQueueAfterError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    !isBrowserOnline() ||
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("offline") ||
    message.includes("load failed")
  );
}

function readRawQueueArray(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("BabyDragon mobile could not read offline queue:", error);
    return [];
  }
}

function writeRawQueueArray(key, items) {
  try {
    localStorage.setItem(key, JSON.stringify(Array.isArray(items) ? items : []));
  } catch (error) {
    console.warn("BabyDragon mobile could not save offline queue:", error);
  }
}

/**
 * Normalize legacy + versioned records. Corrupt items go to quarantine (non-destructive).
 */
export function normalizeMobileQueueItem(item) {
  if (!item || typeof item !== "object") {
    return { ok: false, reason: "not_object", item: null };
  }
  if (!item.id || !item.type) {
    return { ok: false, reason: "missing_id_or_type", item };
  }
  return {
    ok: true,
    item: {
      ...item,
      record_version: item.record_version || item.meta?.record_version || MOBILE_QUEUE_RECORD_VERSION,
      payload: item.payload && typeof item.payload === "object" ? item.payload : {},
      meta: item.meta && typeof item.meta === "object" ? item.meta : {},
      attempts: Number(item.attempts || 0),
      created_at: item.created_at || new Date().toISOString(),
      last_error: item.last_error || "",
    },
  };
}

export function quarantineMobileQueueItem(item, reason = "corrupt") {
  const list = readRawQueueArray(QUARANTINE_KEY);
  list.push({
    quarantined_at: new Date().toISOString(),
    reason,
    item,
  });
  writeRawQueueArray(QUARANTINE_KEY, list.slice(-50));
}

export function readMobileQueue() {
  const raw = readRawQueueArray(QUEUE_KEY);
  const healthy = [];
  for (const entry of raw) {
    const normalized = normalizeMobileQueueItem(entry);
    if (!normalized.ok) {
      quarantineMobileQueueItem(entry, normalized.reason);
      continue;
    }
    healthy.push(normalized.item);
  }
  // If we quarantined anything, rewrite cleaned queue (additive / safe).
  if (healthy.length !== raw.length) {
    writeRawQueueArray(QUEUE_KEY, healthy);
  }
  return healthy;
}

export function saveMobileQueue(items) {
  writeRawQueueArray(QUEUE_KEY, Array.isArray(items) ? items : []);
}

export function getMobileQueueCount() {
  return readMobileQueue().length;
}

export function getMobileQueueItems() {
  return readMobileQueue();
}

export function getMobileResultSubmitItems() {
  return readMobileQueue().filter(
    (item) => item.type === OFFLINE_ACTION_TYPES.FIELD_TEST_RESULT_SUBMIT,
  );
}

export function queueMobileAction(type, payload, meta = {}) {
  const item = {
    id: `offline-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    payload,
    meta,
    record_version: meta.record_version || MOBILE_QUEUE_RECORD_VERSION,
    attempts: 0,
    created_at: new Date().toISOString(),
    last_error: "",
  };

  const nextQueue = [...readMobileQueue(), item];
  saveMobileQueue(nextQueue);
  return item;
}

/**
 * Update a single queue item by id (used by result orchestrator persistence).
 */
export function updateMobileQueueItem(id, updater) {
  const queue = readMobileQueue();
  let found = false;
  const next = queue.map((item) => {
    if (item.id !== id) return item;
    found = true;
    const patch = typeof updater === "function" ? updater(item) : updater;
    return { ...item, ...patch, updated_at: new Date().toISOString() };
  });
  if (found) saveMobileQueue(next);
  return found;
}

export async function syncMobileOfflineQueue(processItem) {
  const currentQueue = readMobileQueue();
  const remaining = [];
  let synced = 0;
  let failed = 0;

  for (const item of currentQueue) {
    try {
      const result = await processItem(item);
      // Result submit processor may request keep=true for partial / retry_wait.
      if (result && result.keep === true) {
        remaining.push({
          ...item,
          payload: result.payload !== undefined ? result.payload : item.payload,
          attempts: Number(result.payload?.attempts ?? item.attempts ?? 0),
          last_error: result.payload?.last_error || item.last_error || "",
          last_attempt_at: new Date().toISOString(),
        });
        if (result.done) {
          // Terminal keep (e.g. cancelled / permanent) still counts as processed slot.
          failed += 1;
        } else {
          failed += 1;
        }
        continue;
      }
      synced += 1;
    } catch (error) {
      failed += 1;
      remaining.push({
        ...item,
        attempts: Number(item.attempts || 0) + 1,
        last_error: error?.message || String(error || "Sync failed"),
        last_attempt_at: new Date().toISOString(),
      });
    }
  }

  saveMobileQueue(remaining);

  return {
    synced,
    failed,
    pending: remaining.length,
  };
}
