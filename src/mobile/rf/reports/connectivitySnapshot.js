/**
 * F10B — BabyDragon session connectivity truth helpers.
 * Source: Android ConnectivityManager / NetworkCapabilities via native snapshot.
 * Does NOT infer transport from TrafficStats.
 */

export function normalizeConnectivitySnapshot(raw = null, timestamp = null) {
  if (!raw || typeof raw !== "object") return null;

  const wifiStatus = cleanText(raw.wifiStatus);
  const mobileDataStatus = cleanText(raw.mobileDataStatus);
  const activeTransport = cleanText(raw.defaultTransport)
    || cleanText(raw.defaultNetworkTransport)
    || cleanText(raw.activeTransport)
    || cleanText(raw.transport);

  const wifiConnected = coalesceBool(
    raw.wifiConnected,
    wifiStatus === "Connected" ? true : (wifiStatus === "Disconnected" ? false : null),
  );
  // mobileDataActive / cellularConnected = TRANSPORT_CELLULAR on the default/active network.
  // Not SIM presence and not "mobile data toggle enabled".
  const cellularConnected = coalesceBool(
    raw.cellularConnected,
    coalesceBool(
      raw.mobileDataActive,
      mobileDataStatus === "Connected" ? true : (mobileDataStatus === "Disconnected" ? false : null),
    ),
  );
  const internetConnectivity = cleanText(raw.internetConnectivity);
  const internetCapable = coalesceBool(
    raw.internetCapable,
    internetConnectivity === "Unavailable"
      ? false
      : (internetConnectivity === "Available" || internetConnectivity === "Unvalidated" ? true : null),
  );
  const internetValidated = coalesceBool(
    raw.internetValidated,
    internetConnectivity === "Available"
      ? true
      : (internetConnectivity === "Unvalidated" || internetConnectivity === "Unavailable" ? false : null),
  );

  const ts = Number.isFinite(Number(timestamp))
    ? Number(timestamp)
    : (Number.isFinite(Number(raw.timestamp)) ? Number(raw.timestamp) : Date.now());

  return {
    wifiConnected,
    cellularConnected,
    mobileDataActive: cellularConnected,
    defaultTransport: activeTransport || null,
    internetCapable,
    internetValidated,
    wifiStatus: wifiStatus || (wifiConnected == null ? null : (wifiConnected ? "Connected" : "Disconnected")),
    mobileDataStatus: mobileDataStatus || (cellularConnected == null ? null : (cellularConnected ? "Connected" : "Disconnected")),
    activeTransport: activeTransport || null,
    internetConnectivity: internetConnectivity || null,
    timestamp: ts,
    source: cleanText(raw.source) || "android_connectivity_manager",
    note: cleanText(raw.note),
  };
}

export function buildConnectivityPair(startRaw = null, endRaw = null) {
  const start = normalizeConnectivitySnapshot(startRaw);
  const end = normalizeConnectivitySnapshot(endRaw);
  return {
    connectivityStart: start,
    connectivityEnd: end,
    connectivitySnapshot: end || start || null,
    recorded: Boolean(start || end),
  };
}

export function formatYesNo(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return null;
}

export function formatConnectivityField(startValue, endValue, formatter = formatYesNo) {
  const startText = startValue == null ? null : formatter(startValue);
  const endText = endValue == null ? null : formatter(endValue);
  if (startText == null && endText == null) return null;
  if (startText == null) return endText;
  if (endText == null) return startText;
  if (startText === endText) return startText;
  return `Start ${startText} / End ${endText}`;
}

export function formatTransportChange(startTransport, endTransport) {
  const start = cleanText(startTransport);
  const end = cleanText(endTransport);
  if (!start && !end) return null;
  if (!start) return end;
  if (!end) return start;
  if (start === end) return start;
  return `${start} → ${end}`;
}

/**
 * Excel / UI display rows for 01_Test_Grid_Info Network section.
 */
export function buildConnectivityDisplayRows(session = {}, samples = []) {
  const pair = resolveSessionConnectivity(session, samples);
  if (!pair.recorded) {
    return {
      wifiConnected: "Not recorded",
      mobileDataActive: "Not recorded",
      defaultTransport: "Not recorded",
      internetValidated: "Not recorded",
      pair,
    };
  }
  const start = pair.connectivityStart;
  const end = pair.connectivityEnd || pair.connectivityStart;
  return {
    wifiConnected: formatConnectivityField(start?.wifiConnected, end?.wifiConnected) || "Not recorded",
    // Label retained for Excel compatibility; semantics = cellular on default route.
    mobileDataActive: formatConnectivityField(start?.mobileDataActive, end?.mobileDataActive) || "Not recorded",
    defaultTransport: formatTransportChange(start?.defaultTransport, end?.defaultTransport) || "Not recorded",
    internetValidated: formatConnectivityField(start?.internetValidated, end?.internetValidated) || "Not recorded",
    pair,
  };
}

export function resolveSessionConnectivity(session = {}, samples = []) {
  if (session?.connectivityStart || session?.connectivityEnd) {
    return buildConnectivityPair(session.connectivityStart, session.connectivityEnd);
  }
  const snap = session?.connectivitySnapshot && typeof session.connectivitySnapshot === "object"
    ? session.connectivitySnapshot
    : null;
  if (snap) return buildConnectivityPair(null, snap);

  for (let i = (samples || []).length - 1; i >= 0; i -= 1) {
    const sampleSnap = samples[i]?.snapshot?.connectivity;
    if (sampleSnap && typeof sampleSnap === "object") {
      return buildConnectivityPair(null, sampleSnap);
    }
  }
  return buildConnectivityPair(null, null);
}

export function toJsonConnectivityBlock(session = {}, samples = []) {
  const pair = resolveSessionConnectivity(session, samples);
  if (!pair.recorded) {
    return {
      recorded: false,
      note: "Not recorded",
      connectivity_start: null,
      connectivity_end: null,
    };
  }
  return {
    recorded: true,
    note: "Android ConnectivityManager default-network snapshot. mobile_data_active means TRANSPORT_CELLULAR on the active network, not SIM presence.",
    connectivity_start: toWireConnectivity(pair.connectivityStart),
    connectivity_end: toWireConnectivity(pair.connectivityEnd || pair.connectivityStart),
  };
}

function toWireConnectivity(snap) {
  if (!snap) return null;
  return {
    wifi_connected: snap.wifiConnected,
    cellular_connected: snap.cellularConnected,
    mobile_data_active: snap.mobileDataActive,
    default_transport: snap.defaultTransport,
    internet_capable: snap.internetCapable,
    internet_validated: snap.internetValidated,
    wifi_status: snap.wifiStatus,
    mobile_data_status: snap.mobileDataStatus,
    active_transport: snap.activeTransport,
    internet_connectivity: snap.internetConnectivity,
    timestamp_ms: snap.timestamp,
    source: snap.source,
  };
}

function coalesceBool(...values) {
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }
  return null;
}

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

export default {
  normalizeConnectivitySnapshot,
  buildConnectivityPair,
  buildConnectivityDisplayRows,
  resolveSessionConnectivity,
  toJsonConnectivityBlock,
};
