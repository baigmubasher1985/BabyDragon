/**
 * F10C2 Phase 2 — Stable client_run_id + artifact_id persistence.
 * One client_run_id per field-test run; UI reopen must reuse.
 */

const RUN_ID_STORE_KEY = "babydragon_f10c2_client_run_ids_v1";
const ARTIFACT_ID_STORE_KEY = "babydragon_f10c2_artifact_ids_v1";

function safeStorage() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readMap(key) {
  const storage = safeStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(key, map) {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(map));
  } catch (error) {
    console.warn("BabyDragon could not persist F10C2 id map:", error);
  }
}

export function makeUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `f10c2-${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Stable key for a run — session id preferred; never filename-only.
 */
export function buildRunIdentityKey({
  sessionId = null,
  scenarioKey = null,
  taskId = null,
  reportName = null,
  startedAt = null,
  identityKey = null,
} = {}) {
  const explicit = String(identityKey || "").trim();
  if (explicit) return explicit;
  const sid = String(sessionId || "").trim();
  const scenario = String(scenarioKey || "").trim();
  if (sid && scenario) return `session:${sid}|scenario:${scenario}`;
  if (sid) return `session:${sid}`;
  const task = String(taskId || "").trim() || "notask";
  const started = String(startedAt || "").trim() || "nostart";
  const name = String(reportName || "").trim() || "unnamed";
  return `composite:${task}|${started}|${name}`;
}

/**
 * Get or create client_run_id for a run identity. Persist for retries / UI reopen.
 */
export function getOrCreateClientRunId(identityKey, { forceNew = false } = {}) {
  const key = String(identityKey || "").trim();
  if (!key) throw new Error("run_identity_required");

  const map = readMap(RUN_ID_STORE_KEY);
  if (!forceNew && map[key]?.client_run_id) {
    return {
      client_run_id: map[key].client_run_id,
      created: false,
      identity_key: key,
    };
  }

  const clientRunId = makeUuid();
  map[key] = {
    client_run_id: clientRunId,
    identity_key: key,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  writeMap(RUN_ID_STORE_KEY, map);
  return { client_run_id: clientRunId, created: true, identity_key: key };
}

export function peekClientRunId(identityKey) {
  const map = readMap(RUN_ID_STORE_KEY);
  return map[String(identityKey || "")]?.client_run_id || null;
}

/**
 * Stable artifact_id keyed by client_run_id + artifact_type + logical name (not path).
 */
export function getOrCreateArtifactId({
  clientRunId,
  artifactType,
  logicalName = null,
  forceNew = false,
} = {}) {
  if (!clientRunId) throw new Error("client_run_id_required");
  if (!artifactType) throw new Error("artifact_type_required");
  const logical = String(logicalName || artifactType).trim() || artifactType;
  const key = `${clientRunId}|${artifactType}|${logical}`;

  const map = readMap(ARTIFACT_ID_STORE_KEY);
  if (!forceNew && map[key]?.artifact_id) {
    return { artifact_id: map[key].artifact_id, created: false, key };
  }

  const artifactId = makeUuid();
  map[key] = {
    artifact_id: artifactId,
    client_run_id: clientRunId,
    artifact_type: artifactType,
    logical_name: logical,
    created_at: new Date().toISOString(),
  };
  writeMap(ARTIFACT_ID_STORE_KEY, map);
  return { artifact_id: artifactId, created: true, key };
}

/** Test helper — clear persisted maps (node/browser). */
export function __resetIdStoresForTests() {
  const storage = safeStorage();
  if (!storage) return;
  storage.removeItem(RUN_ID_STORE_KEY);
  storage.removeItem(ARTIFACT_ID_STORE_KEY);
}

export default {
  makeUuid,
  buildRunIdentityKey,
  getOrCreateClientRunId,
  peekClientRunId,
  getOrCreateArtifactId,
  __resetIdStoresForTests,
};
