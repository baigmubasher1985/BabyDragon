/**
 * Immutable normalized engine identity for BabyDragon data/external workflows.
 * Set before test execution begins; never rewrite mid-session.
 */

export const ENGINE_IDS = Object.freeze({
  NATIVE_HTTP: "native_http",
  FTP: "ftp",
  IPERF3: "iperf3",
  OOKLA_EXTERNAL: "ookla_external",
  FCC_EXTERNAL: "fcc_external",
  RF_ONLY: "rf_only",
});

export function normalizeEngineId(raw, fallback = ENGINE_IDS.RF_ONLY) {
  const t = String(raw || "").toLowerCase().trim();
  if (!t) return fallback;
  if (t === ENGINE_IDS.NATIVE_HTTP || t.includes("native_http") || t === "native_android_http" || (t.includes("http") && !t.includes("ftp"))) {
    return ENGINE_IDS.NATIVE_HTTP;
  }
  if (t === ENGINE_IDS.FTP || t === "ftp_native" || t.includes("ftp")) return ENGINE_IDS.FTP;
  if (t === ENGINE_IDS.IPERF3 || t === "iperf" || t.includes("iperf")) return ENGINE_IDS.IPERF3;
  if (t === ENGINE_IDS.OOKLA_EXTERNAL || t.includes("ookla")) return ENGINE_IDS.OOKLA_EXTERNAL;
  if (t === ENGINE_IDS.FCC_EXTERNAL || t.includes("fcc")) return ENGINE_IDS.FCC_EXTERNAL;
  if (t === ENGINE_IDS.RF_ONLY || t === "rf_data" || t === "voice") return ENGINE_IDS.RF_ONLY;
  return fallback;
}

export function engineIdFromUiTestType(testType) {
  const t = String(testType || "").toLowerCase();
  if (t === "rf_only" || t === "voice") return ENGINE_IDS.RF_ONLY;
  if (t === "native_http") return ENGINE_IDS.NATIVE_HTTP;
  if (t === "ftp") return ENGINE_IDS.FTP;
  if (t === "iperf") return ENGINE_IDS.IPERF3;
  if (t === "ookla_app") return ENGINE_IDS.OOKLA_EXTERNAL;
  if (t === "fcc_app") return ENGINE_IDS.FCC_EXTERNAL;
  return ENGINE_IDS.RF_ONLY;
}

export function engineDisplayName(engineId) {
  switch (normalizeEngineId(engineId)) {
    case ENGINE_IDS.NATIVE_HTTP: return "Native HTTP";
    case ENGINE_IDS.FTP: return "FTP";
    case ENGINE_IDS.IPERF3: return "iPerf3";
    case ENGINE_IDS.OOKLA_EXTERNAL: return "OOKLA External Evidence";
    case ENGINE_IDS.FCC_EXTERNAL: return "FCC External Evidence";
    default: return "RF Only";
  }
}

export function jsonDataTestType(engineId) {
  switch (normalizeEngineId(engineId)) {
    case ENGINE_IDS.NATIVE_HTTP: return "native_http";
    case ENGINE_IDS.FTP: return "ftp";
    case ENGINE_IDS.IPERF3: return "iperf3";
    case ENGINE_IDS.OOKLA_EXTERNAL: return "ookla_external";
    case ENGINE_IDS.FCC_EXTERNAL: return "fcc_external";
    default: return "rf_only";
  }
}

export function isControlledEngineId(engineId) {
  const id = normalizeEngineId(engineId);
  return id === ENGINE_IDS.NATIVE_HTTP || id === ENGINE_IDS.FTP || id === ENGINE_IDS.IPERF3;
}

export function isExternalEvidenceEngineId(engineId) {
  const id = normalizeEngineId(engineId);
  return id === ENGINE_IDS.OOKLA_EXTERNAL || id === ENGINE_IDS.FCC_EXTERNAL;
}

/** Map normalized id back to UI/testType storage keys used historically. */
export function uiTestTypeFromEngineId(engineId) {
  switch (normalizeEngineId(engineId)) {
    case ENGINE_IDS.NATIVE_HTTP: return "native_http";
    case ENGINE_IDS.FTP: return "ftp";
    case ENGINE_IDS.IPERF3: return "iperf";
    case ENGINE_IDS.OOKLA_EXTERNAL: return "ookla_app";
    case ENGINE_IDS.FCC_EXTERNAL: return "fcc_app";
    default: return "rf_only";
  }
}

export default {
  ENGINE_IDS,
  normalizeEngineId,
  engineIdFromUiTestType,
  engineDisplayName,
  jsonDataTestType,
  isControlledEngineId,
  isExternalEvidenceEngineId,
  uiTestTypeFromEngineId,
};
