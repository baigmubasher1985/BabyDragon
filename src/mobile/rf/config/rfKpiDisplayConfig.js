/**
 * Shared BabyDragon KPI display configuration.
 * Single source of truth for app legends and Excel Plot Report colors/thresholds.
 */

export const KPI_DISPLAY_PROFILE_NAME = "BabyDragon Default KPI Display";
export const KPI_DISPLAY_PROFILE_VERSION = "1.0.0-f6";

export const BAND_COLORS = {
  excellent: "#22c55e",
  good: "#84cc16",
  fair: "#eab308",
  poor: "#f97316",
  bad: "#ef4444",
  missing: "#94a3b8",
  neutral: "#64748b",
};

export const SERIES_COLORS = {
  kpiLine: "#2563eb",
  kpiPoint: "#1d4ed8",
  eventMarker: "#7c3aed",
  eventHalo: "rgba(255,255,255,0.95)",
  start: "#16a34a",
  end: "#dc2626",
  neutralRoute: "#64748b",
  missing: "#94a3b8",
};

export const CATEGORY_PALETTE = [
  "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
  "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf",
  "#393b79", "#637939", "#8c6d31", "#843c39", "#7b4173",
];

function band(min, max, className, label, opts = {}) {
  return {
    min,
    max,
    minInclusive: opts.minInclusive !== false,
    maxInclusive: opts.maxInclusive === true || max === null,
    color: BAND_COLORS[className] || BAND_COLORS.missing,
    className,
    label,
  };
}

const METRIC_DEFS = {
  lte_rsrp: {
    metricKey: "lte_rsrp",
    displayName: "LTE RSRP",
    technology: "LTE",
    unit: "dBm",
    higherIsBetter: true,
    bins: [
      band(-80, null, "excellent", "≥ -80 (Excellent)"),
      band(-90, -80, "good", "-90 to -81 (Good)", { maxInclusive: false }),
      band(-100, -90, "fair", "-100 to -91 (Fair)", { maxInclusive: false }),
      band(-110, -100, "poor", "-110 to -101 (Poor)", { maxInclusive: false }),
      band(null, -110, "bad", "< -110 (Bad)", { maxInclusive: false }),
    ],
  },
  nr_ss_rsrp: {
    metricKey: "nr_ss_rsrp",
    displayName: "NR SS-RSRP",
    technology: "NR",
    unit: "dBm",
    higherIsBetter: true,
    aliasOf: "lte_rsrp",
  },
  lte_rsrq: {
    metricKey: "lte_rsrq",
    displayName: "LTE RSRQ",
    technology: "LTE",
    unit: "dB",
    higherIsBetter: true,
    bins: [
      band(-10, null, "excellent", "≥ -10 (Excellent)"),
      band(-15, -10, "good", "-15 to -11 (Good)", { maxInclusive: false }),
      band(-20, -15, "fair", "-20 to -16 (Fair)", { maxInclusive: false }),
      band(-25, -20, "poor", "-25 to -21 (Poor)", { maxInclusive: false }),
      band(null, -25, "bad", "< -25 (Bad)", { maxInclusive: false }),
    ],
  },
  nr_ss_rsrq: {
    metricKey: "nr_ss_rsrq",
    displayName: "NR SS-RSRQ",
    technology: "NR",
    unit: "dB",
    higherIsBetter: true,
    aliasOf: "lte_rsrq",
  },
  lte_sinr: {
    metricKey: "lte_sinr",
    displayName: "LTE SINR / RSSNR",
    technology: "LTE",
    unit: "dB",
    higherIsBetter: true,
    bins: [
      band(20, null, "excellent", "≥ 20 (Excellent)"),
      band(13, 20, "good", "13 to 19 (Good)", { maxInclusive: false }),
      band(5, 13, "fair", "5 to 12 (Fair)", { maxInclusive: false }),
      band(0, 5, "poor", "0 to 4 (Poor)", { maxInclusive: false }),
      band(null, 0, "bad", "< 0 (Bad)", { maxInclusive: false }),
    ],
  },
  nr_ss_sinr: {
    metricKey: "nr_ss_sinr",
    displayName: "NR SS-SINR",
    technology: "NR",
    unit: "dB",
    higherIsBetter: true,
    aliasOf: "lte_sinr",
  },
  lte_rssi: {
    metricKey: "lte_rssi",
    displayName: "LTE RSSI",
    technology: "LTE",
    unit: "dBm",
    higherIsBetter: true,
    aliasOf: "lte_rsrp",
  },
  wcdma_rscp: {
    metricKey: "wcdma_rscp",
    displayName: "WCDMA RSCP",
    technology: "WCDMA",
    unit: "dBm",
    higherIsBetter: true,
    bins: [
      band(-75, null, "excellent", "≥ -75 (Excellent)"),
      band(-85, -75, "good", "-85 to -76 (Good)", { maxInclusive: false }),
      band(-95, -85, "fair", "-95 to -86 (Fair)", { maxInclusive: false }),
      band(-105, -95, "poor", "-105 to -96 (Poor)", { maxInclusive: false }),
      band(null, -105, "bad", "< -105 (Bad)", { maxInclusive: false }),
    ],
  },
  wcdma_ecno: {
    metricKey: "wcdma_ecno",
    displayName: "WCDMA Ec/No",
    technology: "WCDMA",
    unit: "dB",
    higherIsBetter: true,
    bins: [
      band(-6, null, "excellent", "≥ -6 (Excellent)"),
      band(-10, -6, "good", "-10 to -7 (Good)", { maxInclusive: false }),
      band(-14, -10, "fair", "-14 to -11 (Fair)", { maxInclusive: false }),
      band(-18, -14, "poor", "-18 to -15 (Poor)", { maxInclusive: false }),
      band(null, -18, "bad", "< -18 (Bad)", { maxInclusive: false }),
    ],
  },
  gsm_rxlev: {
    metricKey: "gsm_rxlev",
    displayName: "GSM RxLev / RSSI",
    technology: "GSM",
    unit: "dBm",
    higherIsBetter: true,
    bins: [
      band(-65, null, "excellent", "≥ -65 (Excellent)"),
      band(-75, -65, "good", "-75 to -66 (Good)", { maxInclusive: false }),
      band(-85, -75, "fair", "-85 to -76 (Fair)", { maxInclusive: false }),
      band(-95, -85, "poor", "-95 to -86 (Poor)", { maxInclusive: false }),
      band(null, -95, "bad", "< -95 (Bad)", { maxInclusive: false }),
    ],
  },
  gsm_ber: {
    metricKey: "gsm_ber",
    displayName: "GSM BER",
    technology: "GSM",
    unit: "",
    higherIsBetter: false,
    bins: [
      band(null, 2, "excellent", "< 2 (Good)", { maxInclusive: false }),
      band(2, 5, "fair", "2–5 (Fair)", { maxInclusive: false }),
      band(5, null, "bad", "≥ 5 (Poor)"),
    ],
  },
  thp_dl: {
    metricKey: "thp_dl",
    displayName: "APP DL Throughput",
    technology: "Data",
    unit: "Mbps",
    higherIsBetter: true,
    bins: [
      band(100, null, "excellent", "≥ 100 Mbps"),
      band(50, 100, "good", "50–100 Mbps", { maxInclusive: false }),
      band(20, 50, "fair", "20–50 Mbps", { maxInclusive: false }),
      band(5, 20, "poor", "5–20 Mbps", { maxInclusive: false }),
      band(null, 5, "bad", "< 5 Mbps", { maxInclusive: false }),
    ],
  },
  thp_ul: {
    metricKey: "thp_ul",
    displayName: "APP UL Throughput",
    technology: "Data",
    unit: "Mbps",
    higherIsBetter: true,
    bins: [
      band(30, null, "excellent", "≥ 30 Mbps"),
      band(15, 30, "good", "15–30 Mbps", { maxInclusive: false }),
      band(5, 15, "fair", "5–15 Mbps", { maxInclusive: false }),
      band(1, 5, "poor", "1–5 Mbps", { maxInclusive: false }),
      band(null, 1, "bad", "< 1 Mbps", { maxInclusive: false }),
    ],
  },
  gps_accuracy: {
    metricKey: "gps_accuracy",
    displayName: "GPS Accuracy",
    technology: "GPS",
    unit: "m",
    higherIsBetter: false,
    bins: [
      band(null, 5, "excellent", "< 5 m (Excellent)", { maxInclusive: false }),
      band(5, 15, "good", "5–15 m (Good)", { maxInclusive: false }),
      band(15, 50, "fair", "15–50 m (Fair)", { maxInclusive: false }),
      band(50, 100, "poor", "50–100 m (Poor)", { maxInclusive: false }),
      band(100, null, "bad", "≥ 100 m (Bad)"),
    ],
  },
};

function getNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function resolveKey(metricKey) {
  const key = String(metricKey || "").trim();
  if (METRIC_DEFS[key]?.aliasOf) return METRIC_DEFS[key].aliasOf;
  if (METRIC_DEFS[key]) return key;
  return key;
}

export function getMetricDisplayConfig(metricKey, activeSettings = null) {
  const resolved = resolveKey(metricKey);
  const base = METRIC_DEFS[resolved] || METRIC_DEFS[metricKey];
  if (!base) {
    return {
      metricKey: resolved,
      displayName: resolved,
      technology: "Unknown",
      unit: "",
      higherIsBetter: true,
      bins: [],
      missingColor: BAND_COLORS.missing,
    };
  }
  const root = base.aliasOf ? METRIC_DEFS[base.aliasOf] : base;
  const override = activeSettings?.metrics?.[resolved] || activeSettings?.metrics?.[metricKey];
  const bins = (override?.bins || root.bins || []).map((b) => ({ ...b }));
  return {
    metricKey: resolved,
    displayName: override?.displayName || base.displayName || root.displayName,
    technology: base.technology || root.technology,
    unit: base.unit || root.unit,
    higherIsBetter: root.higherIsBetter,
    bins,
    missingColor: BAND_COLORS.missing,
  };
}

export function getMetricBins(metricKey, activeSettings = null) {
  return getMetricDisplayConfig(metricKey, activeSettings).bins || [];
}

export function classifyMetricValue(metricKey, value, activeSettings = null) {
  const n = getNumber(value);
  const cfg = getMetricDisplayConfig(metricKey, activeSettings);
  if (n === null) {
    return { bin: null, color: cfg.missingColor, label: "Missing", className: "missing" };
  }
  for (const bin of cfg.bins || []) {
    const minOk = bin.min === null || bin.min === undefined
      || (bin.minInclusive !== false ? n >= bin.min : n > bin.min);
    const maxOk = bin.max === null || bin.max === undefined
      || (bin.maxInclusive === true ? n <= bin.max : n < bin.max);
    if (minOk && maxOk) {
      return { bin, color: bin.color, label: bin.label, className: bin.className };
    }
  }
  return { bin: null, color: cfg.missingColor, label: "Unclassified", className: "missing" };
}

export function getMetricColor(metricKey, value, activeSettings = null) {
  return classifyMetricValue(metricKey, value, activeSettings).color;
}

export function getMetricLegend(metricKey, activeSettings = null) {
  const cfg = getMetricDisplayConfig(metricKey, activeSettings);
  return {
    metricKey: cfg.metricKey,
    displayName: cfg.displayName,
    unit: cfg.unit,
    technology: cfg.technology,
    bands: (cfg.bins || []).map((b) => ({
      label: b.label,
      color: b.color,
      className: b.className,
      min: b.min,
      max: b.max,
    })),
  };
}

export function buildUiKpiLegends(activeSettings = null) {
  const mk = (name, note, metricKey) => {
    const legend = getMetricLegend(metricKey, activeSettings);
    return {
      name,
      unit: legend.unit,
      note,
      metricKey,
      bands: legend.bands.map((b) => ({
        label: String(b.className || "").replace(/^\w/, (c) => c.toUpperCase()),
        range: b.label,
        className: b.className,
        color: b.color,
      })),
    };
  };
  return [
    mk("NR/LTE RSRP", "5G/LTE reference signal power family", "lte_rsrp"),
    mk("NR/LTE RSRQ", "5G/LTE reference signal quality family", "lte_rsrq"),
    mk("NR/LTE SINR", "Signal to interference plus noise family", "lte_sinr"),
    mk("3G RSCP / EcNo", "WCDMA signal level and quality families", "wcdma_rscp"),
    mk("2G RSSI / RxLev", "GSM signal strength family", "gsm_rxlev"),
    mk("APP THP", "Application-layer DL/UL throughput thresholds", "thp_dl"),
  ];
}

export function capturePaletteSnapshot(activeSettings = null) {
  const keys = [
    "lte_rsrp", "lte_rsrq", "lte_sinr", "wcdma_rscp", "wcdma_ecno",
    "gsm_rxlev", "thp_dl", "thp_ul", "gps_accuracy",
  ];
  return {
    profileName: activeSettings?.profileName || KPI_DISPLAY_PROFILE_NAME,
    profileVersion: activeSettings?.profileVersion || KPI_DISPLAY_PROFILE_VERSION,
    exportTimestampIso: new Date().toISOString(),
    note: "Map and graph colors use the active BabyDragon KPI display profile captured at report export.",
    metrics: keys.map((key) => {
      const legend = getMetricLegend(key, activeSettings);
      return {
        metricKey: legend.metricKey,
        displayName: legend.displayName,
        unit: legend.unit,
        bins: legend.bands.map((b) => ({
          label: b.label,
          color: b.color,
          min: b.min,
          max: b.max,
        })),
      };
    }),
  };
}

export function binsForReport(metricKey, activeSettings = null) {
  return getMetricBins(metricKey, activeSettings).map((b) => ({
    min: b.min,
    max: b.max,
    minInclusive: b.minInclusive,
    maxInclusive: b.maxInclusive,
    color: b.color,
    label: b.label,
  }));
}

export function colorForValue(value, bins = []) {
  const n = getNumber(value);
  if (n === null) return BAND_COLORS.missing;
  for (const bin of bins) {
    const minOk = bin.min === null || bin.min === undefined
      || (bin.minInclusive !== false ? n >= bin.min : n > bin.min);
    const maxOk = bin.max === null || bin.max === undefined
      || (bin.maxInclusive === true ? n <= bin.max : n < bin.max);
    if (minOk && maxOk) return bin.color;
  }
  return BAND_COLORS.missing;
}

/**
 * Count plotted valid samples per bin for legend stats.
 * Preserves zero; excludes null/NaN/Infinity. Uses same boundary rules as colorForValue.
 */
export function countBinsForValues(values = [], bins = []) {
  const counts = (bins || []).map(() => 0);
  let total = 0;
  (values || []).forEach((value) => {
    const n = getNumber(value);
    if (n === null) return;
    total += 1;
    for (let i = 0; i < bins.length; i += 1) {
      const bin = bins[i];
      const minOk = bin.min === null || bin.min === undefined
        || (bin.minInclusive !== false ? n >= bin.min : n > bin.min);
      const maxOk = bin.max === null || bin.max === undefined
        || (bin.maxInclusive === true ? n <= bin.max : n < bin.max);
      if (minOk && maxOk) {
        counts[i] += 1;
        break;
      }
    }
  });
  return (bins || []).map((bin, i) => {
    const count = counts[i] || 0;
    const pct = total > 0 ? Number(((count / total) * 100).toFixed(1)) : 0;
    return {
      ...bin,
      count,
      percent: pct,
      legendLabel: `${bin.label} — ${count} (${pct.toFixed(1)}%)`,
    };
  });
}

export function buildCategoryColorMap(values = []) {
  const unique = [];
  values.forEach((v) => {
    const key = v === null || v === undefined || v === "" ? null : String(v);
    if (key === null) return;
    if (!unique.includes(key)) unique.push(key);
  });
  const map = new Map();
  unique.forEach((key, index) => {
    map.set(key, CATEGORY_PALETTE[index % CATEGORY_PALETTE.length]);
  });
  return { map, unique };
}

export function runBoundaryChecks(metricKey = "lte_rsrp", activeSettings = null) {
  const bins = getMetricBins(metricKey, activeSettings);
  const cases = [];
  const push = (value, expectClass) => {
    const result = classifyMetricValue(metricKey, value, activeSettings);
    cases.push({
      value,
      expected: expectClass,
      actual: result.className,
      color: result.color,
      pass: result.className === expectClass,
    });
  };
  if (metricKey.includes("rsrp") || metricKey === "lte_rsrp") {
    push(-80, "excellent");
    push(-79.9, "excellent");
    push(-80.1, "good");
    push(-90, "good");
    push(-90.1, "fair");
    push(-110, "poor");
    push(-110.1, "bad");
    push(0, "excellent");
    push(null, "missing");
  }
  return { metricKey, bins, cases, allPassed: cases.every((c) => c.pass) };
}

export default {
  getMetricDisplayConfig,
  getMetricBins,
  classifyMetricValue,
  getMetricColor,
  getMetricLegend,
  buildUiKpiLegends,
  capturePaletteSnapshot,
  binsForReport,
  colorForValue,
  countBinsForValues,
  buildCategoryColorMap,
  runBoundaryChecks,
  BAND_COLORS,
  SERIES_COLORS,
};
