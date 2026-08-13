/**
 * Compatibility layer — KPI bins/colors come from shared rfKpiDisplayConfig.
 * Do not maintain a separate report palette here.
 */

import {
  binsForReport,
  colorForValue,
  countBinsForValues,
  buildCategoryColorMap,
  SERIES_COLORS,
  CATEGORY_PALETTE,
  BAND_COLORS,
} from "../config/rfKpiDisplayConfig.js";

export { colorForValue, countBinsForValues, buildCategoryColorMap, SERIES_COLORS, CATEGORY_PALETTE, BAND_COLORS };

export const RSRP_BINS = binsForReport("lte_rsrp");
export const RSRQ_BINS = binsForReport("lte_rsrq");
export const SINR_BINS = binsForReport("lte_sinr");
export const RSCP_BINS = binsForReport("wcdma_rscp");
export const ECNO_BINS = binsForReport("wcdma_ecno");
export const RXLEV_BINS = binsForReport("gsm_rxlev");
export const THP_DL_BINS = binsForReport("thp_dl");
export const THP_UL_BINS = binsForReport("thp_ul");
export const BER_BINS = binsForReport("gsm_ber");
export const GPS_ACCURACY_BINS = binsForReport("gps_accuracy");

/** Event marker styles (report presentation; not KPI thresholds). */
export const EVENT_STYLES = {
  SERVING_CELL_CHANGE: { color: "#7c3aed", shape: "diamond", label: "Serving cell change / possible handover or reselection" },
  PCI_CHANGE: { color: "#ea580c", shape: "triangle", label: "PCI change" },
  PSC_CHANGE: { color: "#c2410c", shape: "triangle", label: "PSC change" },
  BSIC_CHANGE: { color: "#9a3412", shape: "triangle", label: "BSIC change" },
  CHANNEL_CHANGE: { color: "#2563eb", shape: "square", label: "Channel change" },
  EARFCN_CHANGE: { color: "#1d4ed8", shape: "square", label: "EARFCN change" },
  NRARFCN_CHANGE: { color: "#1e40af", shape: "square", label: "NRARFCN change" },
  UARFCN_CHANGE: { color: "#1e3a8a", shape: "square", label: "UARFCN change" },
  ARFCN_CHANGE: { color: "#312e81", shape: "square", label: "ARFCN change" },
  RAT_CHANGE: { color: "#0d9488", shape: "ring", label: "RAT change" },
  DATA_NETWORK_TYPE_CHANGE: { color: "#0f766e", shape: "ring", label: "Data network type change" },
  TAC_CHANGE: { color: "#0891b2", shape: "square", label: "TAC change" },
  CELL_ID_CHANGE: { color: "#0369a1", shape: "diamond", label: "Cell ID change" },
  NCI_CHANGE: { color: "#075985", shape: "diamond", label: "NCI change" },
  NR_SECONDARY: { color: "#db2777", shape: "diamond", label: "NR secondary change" },
  NR_SECONDARY_EXPOSED: { color: "#db2777", shape: "diamond", label: "NR secondary visible" },
  NR_SECONDARY_LOST: { color: "#be185d", shape: "diamond", label: "NR secondary lost" },
  NR_SECONDARY_STATUS_CHANGE: { color: "#9d174d", shape: "diamond", label: "NR measurement-only status change" },
  SESSION_START: { color: "#16a34a", shape: "ring", label: "Session start" },
  SESSION_END: { color: "#dc2626", shape: "ring", label: "Session end" },
  PAUSE: { color: "#ca8a04", shape: "square", label: "Pause" },
  RESUME: { color: "#65a30d", shape: "square", label: "Resume" },
  GPS_LOST: { color: "#57534e", shape: "triangle", label: "GPS lost" },
  GPS_RESTORED: { color: "#44403c", shape: "triangle", label: "GPS restored" },
  NATIVE_HTTP_ITERATION_START: { color: "#4f46e5", shape: "diamond", label: "Native HTTP iteration start" },
  NATIVE_HTTP_ITERATION_END: { color: "#4338ca", shape: "diamond", label: "Native HTTP iteration end" },
  NATIVE_HTTP_DL_END: { color: "#2563eb", shape: "square", label: "Native HTTP DL end" },
  NATIVE_HTTP_DL_SUCCESS: { color: "#16a34a", shape: "square", label: "Native HTTP DL success" },
  NATIVE_HTTP_DL_FAILURE: { color: "#dc2626", shape: "square", label: "Native HTTP DL failure" },
  NATIVE_HTTP_UL_END: { color: "#7c3aed", shape: "square", label: "Native HTTP UL end" },
  NATIVE_HTTP_UL_SUCCESS: { color: "#15803d", shape: "square", label: "Native HTTP UL success" },
  NATIVE_HTTP_UL_FAILURE: { color: "#b91c1c", shape: "square", label: "Native HTTP UL failure" },
  NATIVE_HTTP_TEST_FAILURE: { color: "#dc2626", shape: "diamond", label: "Native HTTP Test Failed" },
  FTP_TEST_FAILURE: { color: "#dc2626", shape: "diamond", label: "FTP Test Failed" },
  IPERF3_TEST_FAILURE: { color: "#dc2626", shape: "diamond", label: "iPerf3 Test Failed" },
  DEFAULT: { color: "#6d28d9", shape: "diamond", label: "RF / data event" },
};

export function styleForEventType(eventType) {
  const t = String(eventType || "");
  if (EVENT_STYLES[t]) return EVENT_STYLES[t];
  if (t.includes("SERVING_CELL")) return EVENT_STYLES.SERVING_CELL_CHANGE;
  if (t.includes("NR_SECONDARY_EXPOSED")) return EVENT_STYLES.NR_SECONDARY_EXPOSED;
  if (t.includes("NR_SECONDARY_LOST")) return EVENT_STYLES.NR_SECONDARY_LOST;
  if (t.includes("NR_SECONDARY")) return EVENT_STYLES.NR_SECONDARY_STATUS_CHANGE;
  if (t.includes("PCI")) return EVENT_STYLES.PCI_CHANGE;
  if (t.includes("RAT")) return EVENT_STYLES.RAT_CHANGE;
  if (t.includes("GPS_LOST")) return EVENT_STYLES.GPS_LOST;
  if (t.includes("GPS_RESTORED")) return EVENT_STYLES.GPS_RESTORED;
  if (t === "PAUSE") return EVENT_STYLES.PAUSE;
  if (t === "RESUME") return EVENT_STYLES.RESUME;
  if (t.includes("NATIVE_HTTP") || t.includes("FTP") || t.includes("IPERF")) {
    if (t.endsWith("_TEST_FAILURE")) {
      if (t.startsWith("FTP_")) return EVENT_STYLES.FTP_TEST_FAILURE;
      if (t.startsWith("IPERF3_")) return EVENT_STYLES.IPERF3_TEST_FAILURE;
      return EVENT_STYLES.NATIVE_HTTP_TEST_FAILURE;
    }
    if (t.includes("DL_FAILURE") || t.includes("UL_FAILURE") || t.includes("FAILURE")) {
      return EVENT_STYLES.NATIVE_HTTP_DL_FAILURE;
    }
    if (t.includes("DL")) return EVENT_STYLES.NATIVE_HTTP_DL_END;
    if (t.includes("UL")) return EVENT_STYLES.NATIVE_HTTP_UL_END;
    if (t.includes("START")) return EVENT_STYLES.NATIVE_HTTP_ITERATION_START;
    if (t.includes("END")) return EVENT_STYLES.NATIVE_HTTP_ITERATION_END;
  }
  return EVENT_STYLES.DEFAULT;
}

export function normalizeEventStyleKey(eventType) {
  const t = String(eventType || "");
  if (EVENT_STYLES[t]) return t;
  if (t.includes("SERVING_CELL")) return "SERVING_CELL_CHANGE";
  if (t.includes("NR_SECONDARY_EXPOSED")) return "NR_SECONDARY_EXPOSED";
  if (t.includes("NR_SECONDARY_LOST")) return "NR_SECONDARY_LOST";
  if (t.includes("NR_SECONDARY")) return "NR_SECONDARY_STATUS_CHANGE";
  if (t.includes("PCI")) return "PCI_CHANGE";
  if (t.includes("RAT")) return "RAT_CHANGE";
  if (t.includes("GPS_LOST")) return "GPS_LOST";
  if (t.includes("GPS_RESTORED")) return "GPS_RESTORED";
  return "DEFAULT";
}
