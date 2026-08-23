const DB_NAME = "babydragon_mobile_offline_files_v1";
const DB_VERSION = 1;
const STORE_NAME = "queued_files";

function hasIndexedDb() {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDb()) {
      reject(new Error("IndexedDB is not available on this device/browser."));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Unable to open offline file storage."));
  });
}

function runStore(mode, callback) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        const request = callback(store);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Offline file storage operation failed."));

        transaction.oncomplete = () => db.close();
        transaction.onerror = () => {
          db.close();
          reject(transaction.error || new Error("Offline file storage transaction failed."));
        };
      })
  );
}

export async function saveOoklaScreenshotFile(
  file,
  sessionId = "session",
  iterationNumber = 0,
  role = "main",
) {
  if (!file) return null;

  const safeRole = role === "detailed" ? "detailed" : "main";
  const id = `ookla-screenshot-${safeRole}-${sessionId}-${iterationNumber}-${Date.now()}`;
  const record = {
    id,
    name: file.name || `ookla-${safeRole}-screenshot.jpg`,
    type: file.type || "image/jpeg",
    size: file.size || 0,
    lastModified: file.lastModified || Date.now(),
    blob: file,
    created_at: new Date().toISOString(),
    purpose: safeRole === "detailed" ? "ookla_detailed_screenshot" : "ookla_main_screenshot",
    role: safeRole,
  };

  await runStore("readwrite", (store) => store.put(record));

  return {
    id,
    name: record.name,
    type: record.type,
    size: record.size,
    lastModified: record.lastModified,
    role: safeRole,
  };
}

export async function saveQueuedFile(file) {
  if (!file) return null;

  const id = `queued-file-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const record = {
    id,
    name: file.name || "photo.jpg",
    type: file.type || "image/jpeg",
    size: file.size || 0,
    lastModified: file.lastModified || Date.now(),
    blob: file,
    created_at: new Date().toISOString(),
  };

  await runStore("readwrite", (store) => store.put(record));

  return {
    id,
    name: record.name,
    type: record.type,
    size: record.size,
    lastModified: record.lastModified,
  };
}

export async function saveResultArtifactFile(artifactId, fileLike) {
  if (!artifactId || fileLike == null) return null;
  const id = `result-artifact-${artifactId}`;
  const blob = fileLike.blob || fileLike;
  const record = {
    id,
    name: fileLike.name || fileLike.fileName || `${artifactId}.bin`,
    type: fileLike.type || fileLike.mime_type || "application/octet-stream",
    size: fileLike.size || fileLike.sizeBytes || 0,
    lastModified: fileLike.lastModified || Date.now(),
    blob,
    created_at: new Date().toISOString(),
    purpose: "field_test_result_artifact",
  };
  await runStore("readwrite", (store) => store.put(record));
  return { id, name: record.name, type: record.type, size: record.size };
}

export async function readQueuedFile(fileId) {
  if (!fileId) return null;
  return runStore("readonly", (store) => store.get(fileId));
}

export async function deleteQueuedFile(fileId) {
  if (!fileId) return;
  await runStore("readwrite", (store) => store.delete(fileId));
}
