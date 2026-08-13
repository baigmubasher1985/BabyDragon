/**
 * Persistent mobility-session controller (module singleton).
 * Authoritative GPS/RF acquisition is owned by BabyDragonMobilityService.
 * Preview mode auto-starts when RF KPI is active; recording reuses the same stream.
 */

import {
  GPS_FRESH_MAX_AGE_MS,
  GPS_LOST_AFTER_MS,
  GPS_STATUS,
  enrichMobilityGpsSample,
  shouldExtendDrivenTrail,
} from "./mobilityGpsFreshness.js";

const DRAIN_TICK_MS = 1000;
const FRESHNESS_TICK_MS = 1000;
const PREVIEW_PENDING_CAP = 30;

export const MOBILITY_MODE = {
  PREVIEW: "preview",
  RECORDING: "recording",
  STOPPING: "stopping",
  STOPPED: "stopped",
  ERROR: "error",
};

const initialState = () => ({
  active: false,
  mode: MOBILITY_MODE.STOPPED,
  sessionId: null,
  reportSessionId: null,
  startedAt: null,
  gps: null,
  gpsStatus: GPS_STATUS.UNAVAILABLE,
  gpsUnavailableReason: null,
  liveDrivenTrail: [],
  gpsEvents: [],
  pendingRfSamples: [],
  latestRfSample: null,
  firstSampleReceived: false,
  lastNativeRfTimestamp: null,
  testStatus: null,
  notificationText: "",
  foregroundServiceActive: false,
  nativeOwner: true,
  lastDrainAt: null,
  lastDrainCount: 0,
  lastDrainError: null,
  lastNativeGpsFixMs: null,
  lastStartAck: null,
  lastDiagnostics: null,
  startError: null,
  ensureInFlight: false,
  activeDrainLoopCount: 0,
});

let state = initialState();
let drainTimer = null;
let freshnessTimer = null;
let listeners = new Set();
let lastEmittedGpsEventType = null;
let lastValidCoords = null;
let rfPluginPromise = null;
let ensurePromise = null;

function emit() {
  const snapshot = getMobilitySessionSnapshot();
  listeners.forEach((fn) => {
    try { fn(snapshot); } catch (error) { console.warn("mobilitySession listener error:", error); }
  });
}

function isFiniteCoord(gps) {
  return Number.isFinite(gps?.lat) && Number.isFinite(gps?.lng);
}

function pushGpsEvent(eventType, gps, nowMs = Date.now()) {
  if (!eventType || eventType === lastEmittedGpsEventType) return;
  const allowed = new Set(["GPS_FIX_FRESH", "GPS_STALE", "GPS_LOST", "GPS_RESTORED"]);
  if (!allowed.has(eventType)) return;
  lastEmittedGpsEventType = eventType;
  const coords = isFiniteCoord(gps) ? { lat: gps.lat, lng: gps.lng } : lastValidCoords;
  state.gpsEvents = [...state.gpsEvents, {
    event_type: eventType,
    timestamp: nowMs,
    timestamp_iso: new Date(nowMs).toISOString(),
    last_valid_coordinates: coords,
    source_fix_timestamp: gps?.location_fix_timestamp_iso || null,
    source_fix_timestamp_ms: gps?.location_fix_timestamp_ms || null,
    fix_age_ms: gps?.gps_fix_age_ms ?? null,
    provider: gps?.provider || null,
    accuracy: gps?.accuracy_m ?? gps?.accuracy ?? null,
    event_source: "android_mobility_service",
    confidence: "confirmed",
  }];
}

function mapStatusToEvent(status) {
  if (status === GPS_STATUS.FRESH) return "GPS_FIX_FRESH";
  if (status === GPS_STATUS.STALE) return "GPS_STALE";
  if (status === GPS_STATUS.LOST) return "GPS_LOST";
  if (status === GPS_STATUS.RESTORED) return "GPS_RESTORED";
  return null;
}

function applyGpsUpdate(rawPoint, source = "android_mobility_service") {
  if (!state.active) return null;
  const nowMs = Date.now();
  const previousStatus = state.gpsStatus;
  const enriched = enrichMobilityGpsSample(rawPoint || {}, { nowMs, previousStatus, source });

  if (rawPoint?.gps_unavailable_reason) {
    state.gpsUnavailableReason = rawPoint.gps_unavailable_reason;
  }

  if (!isFiniteCoord(enriched)) {
    if (lastValidCoords) {
      const age = lastValidCoords.fixMs != null ? nowMs - lastValidCoords.fixMs : null;
      enriched.gps_fix_age_ms = age;
      enriched.location_fix_timestamp_ms = lastValidCoords.fixMs;
      enriched.location_fix_timestamp_iso = lastValidCoords.fixIso;
      if (age != null && age > GPS_LOST_AFTER_MS) enriched.gps_status = GPS_STATUS.LOST;
      else if (age != null && age > GPS_FRESH_MAX_AGE_MS) enriched.gps_status = GPS_STATUS.STALE;
      else enriched.gps_status = GPS_STATUS.UNAVAILABLE;
    }
  }

  if (isFiniteCoord(enriched) && (enriched.gps_status === GPS_STATUS.FRESH || enriched.gps_status === GPS_STATUS.RESTORED)) {
    lastValidCoords = {
      lat: enriched.lat,
      lng: enriched.lng,
      fixMs: enriched.location_fix_timestamp_ms,
      fixIso: enriched.location_fix_timestamp_iso,
    };
    state.lastNativeGpsFixMs = enriched.location_fix_timestamp_ms;
    state.gpsUnavailableReason = null;
  }

  state.gps = enriched;
  state.gpsStatus = enriched.gps_status || GPS_STATUS.UNAVAILABLE;
  const eventType = mapStatusToEvent(state.gpsStatus);
  if (eventType) pushGpsEvent(eventType, enriched, nowMs);

  if (shouldExtendDrivenTrail(enriched)) {
    const last = state.liveDrivenTrail[state.liveDrivenTrail.length - 1];
    const same = last
      && Math.abs(last.lat - enriched.lat) < 1e-7
      && Math.abs(last.lng - enriched.lng) < 1e-7
      && last.location_fix_timestamp_ms === enriched.location_fix_timestamp_ms;
    if (!same) {
      state.liveDrivenTrail = [...state.liveDrivenTrail, {
        lat: enriched.lat,
        lng: enriched.lng,
        accuracy_m: enriched.accuracy_m,
        speed_mps: enriched.speed_mps,
        location_fix_timestamp_ms: enriched.location_fix_timestamp_ms,
        location_fix_timestamp_iso: enriched.location_fix_timestamp_iso,
        gps_status: enriched.gps_status,
        recorded_at: nowMs,
        provider: enriched.provider,
      }];
    }
  }

  emit();
  return enriched;
}

function freshnessTick() {
  if (!state.active) return;
  if (!state.gps) {
    applyGpsUpdate(null, "freshness_tick");
    return;
  }
  applyGpsUpdate({
    ...state.gps,
    latitude: state.gps.lat,
    longitude: state.gps.lng,
    timestamp: state.gps.location_fix_timestamp_ms,
    provider: state.gps.provider || "android_location_manager",
  }, "freshness_tick");
}

/**
 * Capacitor plugin proxies are thenable (`.then` is treated as a plugin method).
 * Never let Promise.resolve / async-return / await adopt the raw plugin — that invokes
 * `BabyDragonRfKpi.then()` and fails with "then() is not implemented on android".
 * Always resolve to a plain `{ plugin }` box, then unwrap after await.
 */
function getRfPluginSync() {
  try {
    return globalThis?.Capacitor?.Plugins?.BabyDragonRfKpi || null;
  } catch {
    return null;
  }
}

async function ensureRfPluginBoxed() {
  const existing = getRfPluginSync();
  if (existing) return { plugin: existing };
  if (!rfPluginPromise) {
    rfPluginPromise = import("@capacitor/core").then(({ registerPlugin }) => ({
      plugin: registerPlugin("BabyDragonRfKpi"),
    }));
  }
  const boxed = await rfPluginPromise;
  return { plugin: boxed?.plugin || getRfPluginSync() };
}

function withTimeout(promise, ms, label) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => {
    if (timer) window.clearTimeout(timer);
  });
}

export async function fetchMobilityDiagnostics() {
  try {
    const { plugin: BabyDragonRfKpi } = await ensureRfPluginBoxed();
    if (typeof BabyDragonRfKpi?.getMobilityDiagnostics === "function") {
      const diagnostics = await withTimeout(
        BabyDragonRfKpi.getMobilityDiagnostics(),
        4000,
        "getMobilityDiagnostics"
      );
      state.lastDiagnostics = {
        ...diagnostics,
        mobilityMode: state.mode,
        jsSessionId: state.sessionId,
        serviceSessionId: diagnostics?.sessionId || "",
        firstSampleReceived: state.firstSampleReceived,
        activeDrainLoopCount: drainTimer ? 1 : 0,
        activeNativeTickerCount: diagnostics?.rfTickerActive ? 1 : 0,
      };
      emit();
      return state.lastDiagnostics;
    }
    if (typeof BabyDragonRfKpi?.getMobilityBufferStatus === "function") {
      const status = await withTimeout(
        BabyDragonRfKpi.getMobilityBufferStatus(),
        4000,
        "getMobilityBufferStatus"
      );
      state.lastDiagnostics = { ...status, mobilityMode: state.mode, jsSessionId: state.sessionId };
      emit();
      return state.lastDiagnostics;
    }
    state.lastDiagnostics = { ok: false, pluginLoaded: false, lastServiceError: "plugin_unavailable" };
  } catch (error) {
    console.warn("fetchMobilityDiagnostics failed:", error);
    state.lastDiagnostics = {
      ok: false,
      lastServiceError: error?.message || String(error),
      mobilityMode: state.mode,
      jsSessionId: state.sessionId,
    };
  }
  return state.lastDiagnostics;
}

async function startForegroundService(meta = {}) {
  try {
    const { plugin: BabyDragonRfKpi } = await ensureRfPluginBoxed();
    if (typeof BabyDragonRfKpi?.startMobilityForegroundService !== "function") {
      state.foregroundServiceActive = false;
      state.startError = "plugin_unavailable";
      state.mode = MOBILITY_MODE.ERROR;
      return { ok: false, accepted: false, message: state.startError, reason: "plugin_unavailable" };
    }
    const response = await withTimeout(
      BabyDragonRfKpi.startMobilityForegroundService({
        sessionId: state.sessionId,
        title: meta.title || "BabyDragon mobility",
        text: meta.notificationText || state.notificationText || "Live RF / GPS preview",
        status: meta.status || state.mode || "running",
      }),
      8000,
      "startMobilityForegroundService"
    );

    // startForegroundService returns before onStartCommand finishes — poll readiness.
    let diagnostics = response?.diagnostics || null;
    const accepted = response?.accepted !== false;
    const pollDeadline = Date.now() + 10000;
    while (Date.now() < pollDeadline) {
      try {
        diagnostics = await fetchMobilityDiagnostics();
        if (diagnostics?.serviceRunning && diagnostics?.rfTickerActive) break;
      } catch (pollError) {
        // Bridge may be briefly busy (permissions). Keep polling until deadline.
        console.warn("[BabyDragon] readiness poll soft-fail", pollError?.message || pollError);
      }
      await new Promise((r) => window.setTimeout(r, 250));
    }

    const serviceStarted = diagnostics?.serviceRunning === true
      || response?.serviceStarted === true
      || response?.running === true;
    const rfTickerActive = diagnostics?.rfTickerActive === true || response?.rfTickerActive === true;
    const merged = {
      ...(response || {}),
      accepted,
      diagnostics,
      serviceStarted,
      rfTickerActive,
      locationSubscriptionActive: diagnostics?.locationSubscriptionActive === true,
      locationSubscriptionReason: diagnostics?.locationSubscriptionReason || "",
      bufferCount: diagnostics?.bufferCount ?? response?.bufferCount ?? 0,
      // Accept Intent acceptance even if readiness lags a moment; keep preview draining.
      ok: (serviceStarted && rfTickerActive) || (accepted && !diagnostics?.lastServiceError),
      pendingReady: accepted && !(serviceStarted && rfTickerActive),
      reason: (!accepted || (diagnostics?.lastServiceError && !serviceStarted))
        ? "service_start_failed"
        : (!rfTickerActive && serviceStarted ? "rf_ticker_inactive" : null),
    };
    if (serviceStarted && rfTickerActive) {
      merged.ok = true;
      merged.pendingReady = false;
      merged.message = merged.locationSubscriptionActive
        ? "Native RF stream live"
        : `RF ticker live; GPS: ${merged.locationSubscriptionReason || "waiting"}`;
    } else if (accepted) {
      merged.message = "Native RF service start accepted — waiting for ticker";
    } else {
      merged.message = diagnostics?.lastServiceError || response?.message || merged.reason || "service_start_failed";
    }

    state.lastStartAck = merged;
    state.foregroundServiceActive = serviceStarted || accepted;
    // Do not flip to ERROR on a slow start — preview drain continues until UI timeout.
    if (serviceStarted && rfTickerActive) {
      state.startError = null;
      if (state.mode === MOBILITY_MODE.ERROR || state.mode === MOBILITY_MODE.STOPPED) {
        state.mode = MOBILITY_MODE.PREVIEW;
      }
    } else if (!accepted) {
      state.startError = "service_start_failed";
      state.mode = MOBILITY_MODE.ERROR;
    } else {
      state.startError = null;
    }
    console.info("[BabyDragon] startMobilityForegroundService ack", merged);
    return merged;
  } catch (error) {
    console.warn("Mobility foreground service start failed:", error);
    state.foregroundServiceActive = false;
    state.startError = "service_start_failed";
    state.mode = MOBILITY_MODE.ERROR;
    state.lastStartAck = {
      ok: false,
      accepted: false,
      message: error?.message || String(error),
      reason: "service_start_failed",
    };
    return state.lastStartAck;
  }
}

async function stopForegroundService() {
  try {
    const { plugin: BabyDragonRfKpi } = await ensureRfPluginBoxed();
    if (typeof BabyDragonRfKpi?.stopMobilityForegroundService === "function") {
      await withTimeout(BabyDragonRfKpi.stopMobilityForegroundService(), 5000, "stopMobilityForegroundService");
    }
  } catch (error) {
    console.warn("Mobility foreground service stop skipped:", error);
  }
  state.foregroundServiceActive = false;
}

function trimPreviewPending() {
  if (state.mode === MOBILITY_MODE.RECORDING) return;
  if (state.pendingRfSamples.length > PREVIEW_PENDING_CAP) {
    state.pendingRfSamples = state.pendingRfSamples.slice(-PREVIEW_PENDING_CAP);
  }
}

/**
 * Drain native mobility buffer. Returns RF samples for React.
 */
export async function drainNativeMobilitySamples() {
  if (!state.active) return [];
  try {
    const { plugin: BabyDragonRfKpi } = await ensureRfPluginBoxed();
    if (typeof BabyDragonRfKpi?.drainMobilitySamples !== "function") {
      state.lastDrainError = "plugin_unavailable";
      return [];
    }
    const response = await withTimeout(
      BabyDragonRfKpi.drainMobilitySamples(),
      5000,
      "drainMobilitySamples"
    );
    const samples = Array.isArray(response?.samples) ? response.samples : [];
    state.lastDrainAt = Date.now();
    state.lastDrainCount = samples.length;
    state.lastDrainError = response?.ok === false ? (response?.message || "drain_failed") : null;
    if (response?.lastGpsFixMs) state.lastNativeGpsFixMs = response.lastGpsFixMs;

    if (response?.sessionId && state.sessionId && response.sessionId !== state.sessionId) {
      // Adopt native authoritative session id rather than failing the stream.
      console.warn("[BabyDragon] reconciling session id", {
        jsSessionId: state.sessionId,
        nativeSessionId: response.sessionId,
      });
      state.sessionId = response.sessionId;
      state.lastDrainError = null;
    }

    const out = [];
    for (const raw of samples) {
      const gpsRaw = raw?.gps || null;
      const gpsStatus = raw?.gps_status || gpsRaw?.gps_status || null;
      if (gpsRaw) {
        applyGpsUpdate({
          latitude: gpsRaw.lat ?? gpsRaw.latitude,
          longitude: gpsRaw.lng ?? gpsRaw.longitude,
          accuracy: gpsRaw.accuracy_m ?? gpsRaw.accuracy,
          speed: gpsRaw.speed_mps ?? gpsRaw.speed,
          heading: gpsRaw.bearing_deg ?? gpsRaw.heading ?? gpsRaw.bearing,
          altitude: gpsRaw.altitude_m ?? gpsRaw.altitude,
          timestamp: gpsRaw.location_fix_timestamp_ms,
          provider: gpsRaw.provider || "android_location_manager",
          gps_is_mock: gpsRaw.gps_is_mock,
          gps_freshness_source: gpsRaw.gps_freshness_source || "android_location_manager",
          elapsed_realtime_nanos: gpsRaw.elapsed_realtime_nanos,
          gps_unavailable_reason: gpsRaw.gps_unavailable_reason,
        }, "android_mobility_service");
      } else if (gpsStatus === "unavailable") {
        applyGpsUpdate({
          gps_unavailable_reason: raw?.gps?.gps_unavailable_reason || "waiting_for_native_gps_fix",
        }, "android_mobility_service");
      }

      const ts = Number(raw?.timestamp) || Date.now();
      state.lastNativeRfTimestamp = ts;
      state.firstSampleReceived = true;
      state.latestRfSample = raw;
      out.push({
        ...raw,
        gps: state.gps,
        mobilityOwned: true,
      });
    }
    if (out.length) {
      state.pendingRfSamples = [...state.pendingRfSamples, ...out];
      trimPreviewPending();
      if (state.mode === MOBILITY_MODE.ERROR) state.mode = MOBILITY_MODE.PREVIEW;
      emit();
    }
    return out;
  } catch (error) {
    console.warn("drainNativeMobilitySamples failed:", error);
    state.lastDrainError = "drain_failed";
    state.lastDrainAt = Date.now();
    emit();
    return [];
  }
}

export function takePendingMobilityRfSamples() {
  const list = state.pendingRfSamples.slice();
  state.pendingRfSamples = [];
  return list;
}

function startDrainLoop() {
  if (drainTimer) return;
  drainTimer = window.setInterval(() => {
    drainNativeMobilitySamples().catch(() => {});
  }, DRAIN_TICK_MS);
  state.activeDrainLoopCount = 1;
  drainNativeMobilitySamples().catch(() => {});
  emit();
}

function stopDrainLoop() {
  if (drainTimer) {
    window.clearInterval(drainTimer);
    drainTimer = null;
  }
  state.activeDrainLoopCount = 0;
}

function startFreshnessLoop() {
  if (freshnessTimer) return;
  freshnessTimer = window.setInterval(freshnessTick, FRESHNESS_TICK_MS);
}

function stopFreshnessLoop() {
  if (freshnessTimer) {
    window.clearInterval(freshnessTimer);
    freshnessTimer = null;
  }
}

function attachLocalSession({
  sessionId,
  mode,
  notificationText,
  preserveTrail = true,
}) {
  const keepTrail = preserveTrail && state.liveDrivenTrail?.length;
  const keepGps = preserveTrail && state.gps;
  state.active = true;
  state.mode = mode;
  state.sessionId = sessionId || state.sessionId || `preview-${Date.now()}`;
  state.startedAt = state.startedAt || Date.now();
  state.notificationText = notificationText || state.notificationText || "Live RF / GPS preview";
  state.nativeOwner = true;
  state.startError = null;
  if (!keepTrail) {
    // only clear when explicitly not preserving
  }
  if (!preserveTrail) {
    state.liveDrivenTrail = [];
    state.gpsEvents = [];
    lastValidCoords = null;
    lastEmittedGpsEventType = null;
    state.gps = null;
    state.gpsStatus = GPS_STATUS.UNAVAILABLE;
  } else if (keepGps) {
    // keep current gps/trail
  }
  startDrainLoop();
  startFreshnessLoop();
  emit();
}

export function getMobilitySessionSnapshot() {
  return {
    active: state.active,
    mode: state.mode,
    sessionId: state.sessionId,
    reportSessionId: state.reportSessionId,
    startedAt: state.startedAt,
    gps: state.gps,
    gpsStatus: state.gpsStatus,
    gpsUnavailableReason: state.gpsUnavailableReason,
    liveDrivenTrail: state.liveDrivenTrail.slice(),
    gpsEvents: state.gpsEvents.slice(),
    pendingRfSampleCount: state.pendingRfSamples.length,
    latestRfSample: state.latestRfSample,
    firstSampleReceived: state.firstSampleReceived,
    lastNativeRfTimestamp: state.lastNativeRfTimestamp,
    testStatus: state.testStatus,
    notificationText: state.notificationText,
    foregroundServiceActive: state.foregroundServiceActive,
    nativeOwner: true,
    lastDrainAt: state.lastDrainAt,
    lastDrainCount: state.lastDrainCount,
    lastDrainError: state.lastDrainError,
    lastNativeGpsFixMs: state.lastNativeGpsFixMs,
    lastStartAck: state.lastStartAck,
    lastDiagnostics: state.lastDiagnostics,
    startError: state.startError,
    activeDrainLoopCount: drainTimer ? 1 : 0,
    thresholds: {
      fresh_max_age_ms: GPS_FRESH_MAX_AGE_MS,
      lost_after_ms: GPS_LOST_AFTER_MS,
    },
  };
}

export function subscribeMobilitySession(listener) {
  if (typeof listener !== "function") return () => {};
  listeners.add(listener);
  try { listener(getMobilitySessionSnapshot()); } catch { /* ignore */ }
  return () => { listeners.delete(listener); };
}

export function getMobilityGps() { return state.gps; }
export function getLiveDrivenTrail() { return state.liveDrivenTrail.slice(); }
export function getMobilityGpsEvents() { return state.gpsEvents.slice(); }
export function isMobilitySessionActive() {
  // Keep draining while start is in-flight/pending; only STOPPED/STOPPING are inactive.
  return state.active === true && state.mode !== MOBILITY_MODE.STOPPED && state.mode !== MOBILITY_MODE.STOPPING;
}
export function getMobilityMode() { return state.mode; }
export function getMobilityStartError() { return state.startError; }
export function getLastMobilityStartAck() { return state.lastStartAck; }
export function getLatestMobilityRfSample() { return state.latestRfSample; }

export function describeGpsUiStatus(diagnostics = state.lastDiagnostics, gpsStatus = state.gpsStatus) {
  const reason = state.gpsUnavailableReason
    || diagnostics?.locationSubscriptionReason
    || "";
  if (diagnostics?.locationPermission === false || reason === "permission_denied") {
    return "Permission required";
  }
  if (diagnostics?.locationMasterEnabled === false
    || (diagnostics?.gpsProviderEnabled === false && diagnostics?.networkProviderEnabled === false)
    || reason === "location_services_disabled") {
    return "Location services disabled";
  }
  if (gpsStatus === GPS_STATUS.FRESH || gpsStatus === GPS_STATUS.RESTORED) return "Fresh";
  if (gpsStatus === GPS_STATUS.STALE) return "Stale";
  if (gpsStatus === GPS_STATUS.LOST) return "Lost";
  if (diagnostics?.locationSubscriptionActive || String(reason).startsWith("active:")) {
    return "Waiting for native fix";
  }
  if (reason === "waiting_for_native_gps_fix") return "Waiting for native fix";
  return "Waiting for native fix";
}

export function describeRfStreamUiStatus({
  diagnostics = state.lastDiagnostics,
  firstSampleReceived = state.firstSampleReceived,
  mode = state.mode,
  startError = state.startError,
  streamAgeMs = null,
} = {}) {
  if (mode === MOBILITY_MODE.ERROR || startError === "permission_error") {
    if (diagnostics?.locationPermission === false) return { label: "Permission required", reason: "permission_error" };
  }
  if (startError === "plugin_unavailable" || diagnostics?.pluginLoaded === false) {
    return { label: "Unavailable", reason: "plugin_unavailable" };
  }
  if (startError === "service_start_failed" || (diagnostics && diagnostics.serviceRunning === false && streamAgeMs != null && streamAgeMs > 3000)) {
    return { label: "Service stopped", reason: "service_start_failed" };
  }
  if (diagnostics?.rfTickerActive === false && diagnostics?.serviceRunning === true) {
    return { label: "Unavailable", reason: "rf_ticker_inactive" };
  }
  if (firstSampleReceived || state.lastNativeRfTimestamp) {
    return { label: "Live", reason: null };
  }
  if (streamAgeMs == null || streamAgeMs < 3000) {
    return { label: "Starting", reason: null };
  }
  if (streamAgeMs < 10000) {
    return { label: "Starting", reason: "waiting_first_sample" };
  }
  if (state.lastDrainError === "drain_failed") {
    return { label: "Unavailable", reason: "drain_failed" };
  }
  if (diagnostics?.nativeRfSampleCount > 0 && !firstSampleReceived) {
    return { label: "Unavailable", reason: "drain_failed" };
  }
  if (diagnostics?.bufferCount === 0 && diagnostics?.nativeRfSampleCount === 0) {
    return { label: "Unavailable", reason: "buffer_empty" };
  }
  return { label: "Unavailable", reason: "first_sample_timeout" };
}

export function updateMobilityTestStatus(patch = {}) {
  if (!state.active) return;
  state.testStatus = { ...(state.testStatus || {}), ...patch, updatedAt: Date.now() };
  if (patch.notificationText) state.notificationText = patch.notificationText;
  emit();
  if (state.foregroundServiceActive) {
    startForegroundService({
      notificationText: state.notificationText || patch.notificationText,
      status: state.mode,
    }).catch(() => {});
  }
}

/**
 * Idempotent: ensure preview (or keep recording) stream is running.
 * Repeated calls must not restart the FGS / reset the buffer while waiting for first sample.
 */
export async function ensureLiveRfPreview({
  forceRestart = false,
  notificationText = "Live RF / GPS preview",
} = {}) {
  if (ensurePromise) {
    if (!forceRestart) return ensurePromise;
    try { await ensurePromise; } catch { /* ignore prior ensure */ }
  }

  ensurePromise = (async () => {
    state.ensureInFlight = true;
    try {
      if (forceRestart) {
        await stopMobilitySession({ clearTrail: false, stopService: true });
      }

      // Never demote an active recording stream.
      if (state.mode === MOBILITY_MODE.RECORDING && state.active && !forceRestart) {
        startDrainLoop();
        startFreshnessLoop();
        const diagnostics = await fetchMobilityDiagnostics();
        return {
          ...getMobilitySessionSnapshot(),
          ok: diagnostics?.serviceRunning !== false,
          attached: true,
          diagnostics,
        };
      }

      let diagnostics = null;
      try {
        diagnostics = await fetchMobilityDiagnostics();
      } catch (diagError) {
        console.warn("[BabyDragon] ensure diagnostics soft-fail", diagError?.message || diagError);
      }
      const serviceRunning = diagnostics?.serviceRunning === true;
      const rfTickerActive = diagnostics?.rfTickerActive === true;
      const nativeSessionId = diagnostics?.sessionId || "";

      // Already live — attach + drain only (no second startForegroundService).
      if (serviceRunning && rfTickerActive && !forceRestart) {
        const sessionId = nativeSessionId || state.sessionId || `preview-${Date.now()}`;
        attachLocalSession({
          sessionId,
          mode: state.mode === MOBILITY_MODE.RECORDING ? MOBILITY_MODE.RECORDING : MOBILITY_MODE.PREVIEW,
          notificationText,
          preserveTrail: true,
        });
        state.foregroundServiceActive = true;
        state.startError = null;
        await drainNativeMobilitySamples();
        const nextDiag = await fetchMobilityDiagnostics().catch(() => diagnostics);
        return {
          ...getMobilitySessionSnapshot(),
          ok: true,
          attached: true,
          pendingReady: !state.firstSampleReceived,
          diagnostics: nextDiag,
          message: "Attached to running native RF stream",
        };
      }

      // Preview already accepted a start and is waiting for first sample — do not re-start.
      if (
        !forceRestart
        && state.active
        && state.mode === MOBILITY_MODE.PREVIEW
        && state.sessionId
        && state.foregroundServiceActive
        && state.lastStartAck?.accepted !== false
      ) {
        startDrainLoop();
        startFreshnessLoop();
        await drainNativeMobilitySamples();
        for (let i = 0; i < 12; i += 1) {
          const nextDiag = await fetchMobilityDiagnostics().catch(() => null);
          if (nextDiag?.serviceRunning && nextDiag?.rfTickerActive) {
            state.startError = null;
            await drainNativeMobilitySamples();
            return {
              ...getMobilitySessionSnapshot(),
              ok: true,
              attached: true,
              pendingReady: !state.firstSampleReceived,
              diagnostics: nextDiag,
              message: "Waiting for first native RF sample",
            };
          }
          if (state.firstSampleReceived) break;
          await new Promise((r) => window.setTimeout(r, 250));
        }
        const nextDiag = await fetchMobilityDiagnostics().catch(() => diagnostics);
        const ok = nextDiag?.serviceRunning === true && nextDiag?.rfTickerActive === true;
        return {
          ...getMobilitySessionSnapshot(),
          ok: ok || state.firstSampleReceived,
          attached: true,
          pendingReady: !state.firstSampleReceived,
          diagnostics: nextDiag,
          message: "Preview start already in flight",
          reason: (ok || state.firstSampleReceived) ? null : "first_sample_timeout",
        };
      }

      const sessionId = state.sessionId && state.mode !== MOBILITY_MODE.STOPPED
        ? state.sessionId
        : `preview-${Date.now()}`;
      attachLocalSession({
        sessionId,
        mode: MOBILITY_MODE.PREVIEW,
        notificationText,
        preserveTrail: true,
      });
      const startAck = await startForegroundService({
        notificationText,
        status: MOBILITY_MODE.PREVIEW,
      });
      // Keep preview mode while Android finishes startForeground — do not ERROR on race.
      if (startAck?.accepted !== false) {
        state.mode = MOBILITY_MODE.PREVIEW;
        state.startError = null;
        state.foregroundServiceActive = true;
      } else {
        state.mode = MOBILITY_MODE.ERROR;
        state.startError = startAck?.reason || "service_start_failed";
      }
      await drainNativeMobilitySamples();
      // Second readiness pass — service often becomes live 1–3s after Intent accept.
      for (let i = 0; i < 20; i += 1) {
        const nextDiag = await fetchMobilityDiagnostics().catch(() => null);
        if (nextDiag?.serviceRunning && nextDiag?.rfTickerActive) {
          state.mode = MOBILITY_MODE.PREVIEW;
          state.foregroundServiceActive = true;
          state.startError = null;
          await drainNativeMobilitySamples();
          return {
            ...getMobilitySessionSnapshot(),
            ok: true,
            attached: false,
            pendingReady: !state.firstSampleReceived,
            startAck,
            diagnostics: nextDiag,
            message: "Native RF preview live",
          };
        }
        await new Promise((r) => window.setTimeout(r, 250));
      }
      const nextDiag = await fetchMobilityDiagnostics().catch(() => null);
      const live = nextDiag?.serviceRunning === true && nextDiag?.rfTickerActive === true;
      // Intent accepted ⇒ keep Starting (ok for UI); only hard-fail when start was rejected.
      const accepted = startAck?.accepted !== false;
      return {
        ...getMobilitySessionSnapshot(),
        ok: live || accepted,
        attached: false,
        pendingReady: accepted && !live && !state.firstSampleReceived,
        startAck,
        diagnostics: nextDiag,
        message: startAck?.message,
        reason: accepted
          ? (live ? null : "waiting_first_sample")
          : (startAck?.reason || "service_start_failed"),
      };
    } catch (error) {
      state.mode = MOBILITY_MODE.ERROR;
      state.startError = "native_exception";
      state.lastStartAck = { ok: false, message: error?.message || String(error), reason: "native_exception" };
      emit();
      return {
        ...getMobilitySessionSnapshot(),
        ok: false,
        message: error?.message || String(error),
        reason: "native_exception",
      };
    } finally {
      state.ensureInFlight = false;
      ensurePromise = null;
      emit();
    }
  })();

  return ensurePromise;
}

/**
 * Promote preview → recording without restarting native ticker / clearing GPS.
 * Keeps the same native sessionId so Android does not reset the buffer/fix.
 */
export async function promoteToRecordingMode({
  reportSessionId,
  notificationText = "Recording RF / GPS / data test",
} = {}) {
  if (!state.active || !state.foregroundServiceActive) {
    const ensured = await ensureLiveRfPreview({ notificationText });
    if (!ensured?.ok && !state.firstSampleReceived) {
      // still try to promote local mode; service may come up on next tick
    }
  }

  state.mode = MOBILITY_MODE.RECORDING;
  state.reportSessionId = reportSessionId || state.reportSessionId;
  state.notificationText = notificationText;
  state.active = true;
  startDrainLoop();
  startFreshnessLoop();

  // Update notification only — same sessionId avoids native buffer/GPS reset.
  const ack = await startForegroundService({
    notificationText,
    status: MOBILITY_MODE.RECORDING,
  });
  emit();
  return {
    ...getMobilitySessionSnapshot(),
    ok: ack?.ok !== false,
    startAck: ack,
    diagnostics: state.lastDiagnostics,
    message: ack?.message,
  };
}

/** After Stop/Save: return to preview without killing the stream while RF page is open. */
export async function demoteToPreviewMode({
  notificationText = "Live RF / GPS preview",
} = {}) {
  state.mode = MOBILITY_MODE.PREVIEW;
  state.reportSessionId = null;
  state.notificationText = notificationText;
  state.active = true;
  startDrainLoop();
  startFreshnessLoop();
  await startForegroundService({
    notificationText,
    status: MOBILITY_MODE.PREVIEW,
  });
  emit();
  return getMobilitySessionSnapshot();
}

/** @deprecated Prefer ensureLiveRfPreview / promoteToRecordingMode */
export async function startMobilitySession({
  sessionId,
  notificationText = "Recording RF / GPS / data test",
  mode = MOBILITY_MODE.RECORDING,
} = {}) {
  if (mode === MOBILITY_MODE.PREVIEW) {
    return ensureLiveRfPreview({ notificationText });
  }
  const ensured = await ensureLiveRfPreview({ notificationText: "Live RF / GPS preview" });
  return promoteToRecordingMode({
    reportSessionId: sessionId,
    notificationText,
  }).then((result) => ({ ...result, ensured }));
}

export async function stopMobilitySession({
  clearTrail = true,
  stopService = true,
} = {}) {
  state.mode = MOBILITY_MODE.STOPPING;
  emit();
  stopDrainLoop();
  stopFreshnessLoop();
  try { await drainNativeMobilitySamples(); } catch { /* ignore */ }
  if (stopService) {
    await stopForegroundService();
  }
  state.active = false;
  state.mode = MOBILITY_MODE.STOPPED;
  state.testStatus = null;
  state.reportSessionId = null;
  if (clearTrail) {
    state.liveDrivenTrail = [];
    state.gpsEvents = [];
    state.pendingRfSamples = [];
    state.gps = null;
    state.gpsStatus = GPS_STATUS.UNAVAILABLE;
    state.gpsUnavailableReason = null;
    state.sessionId = null;
    state.startedAt = null;
    state.latestRfSample = null;
    state.firstSampleReceived = false;
    state.lastNativeRfTimestamp = null;
    lastValidCoords = null;
    lastEmittedGpsEventType = null;
  }
  emit();
  return getMobilitySessionSnapshot();
}

export function clearLiveDrivenTrail() {
  state.liveDrivenTrail = [];
  emit();
}

export default {
  MOBILITY_MODE,
  ensureLiveRfPreview,
  promoteToRecordingMode,
  demoteToPreviewMode,
  startMobilitySession,
  stopMobilitySession,
  subscribeMobilitySession,
  getMobilitySessionSnapshot,
  getMobilityGps,
  getLiveDrivenTrail,
  getMobilityGpsEvents,
  isMobilitySessionActive,
  getMobilityMode,
  updateMobilityTestStatus,
  clearLiveDrivenTrail,
  drainNativeMobilitySamples,
  takePendingMobilityRfSamples,
  fetchMobilityDiagnostics,
  describeGpsUiStatus,
  describeRfStreamUiStatus,
  getMobilityStartError,
  getLastMobilityStartAck,
  getLatestMobilityRfSample,
};

// Dev/CDP hook — not used by customer reports.
if (typeof window !== "undefined") {
  window.__bdMobility = {
    ensureLiveRfPreview,
    fetchMobilityDiagnostics,
    getMobilitySessionSnapshot,
    drainNativeMobilitySamples,
    getMobilityMode,
    describeRfStreamUiStatus,
  };
}
