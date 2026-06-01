export const OFFLINE_ACTION_TYPES = {
  TASK_STATUS: "task_status",
  CHECKLIST_ITEM: "checklist_item",
  ISSUE_REPORT: "issue_report",
  TASK_UPDATE: "task_update",
  GPS_CHECKPOINT: "gps_checkpoint",
};

const QUEUE_KEY = "babydragon_mobile_offline_queue_v1";

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

export function readMobileQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("BabyDragon mobile could not read offline queue:", error);
    return [];
  }
}

export function saveMobileQueue(items) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(Array.isArray(items) ? items : []));
  } catch (error) {
    console.warn("BabyDragon mobile could not save offline queue:", error);
  }
}

export function getMobileQueueCount() {
  return readMobileQueue().length;
}

export function getMobileQueueItems() {
  return readMobileQueue();
}

export function queueMobileAction(type, payload, meta = {}) {
  const item = {
    id: `offline-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    payload,
    meta,
    attempts: 0,
    created_at: new Date().toISOString(),
    last_error: "",
  };

  const nextQueue = [...readMobileQueue(), item];
  saveMobileQueue(nextQueue);
  return item;
}

export async function syncMobileOfflineQueue(processItem) {
  const currentQueue = readMobileQueue();
  const remaining = [];
  let synced = 0;
  let failed = 0;

  for (const item of currentQueue) {
    try {
      await processItem(item);
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
