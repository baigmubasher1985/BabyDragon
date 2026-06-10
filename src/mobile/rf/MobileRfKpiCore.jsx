import React, { useEffect, useMemo, useRef, useState } from "react";
import { registerPlugin } from "@capacitor/core";
import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { DATA_TEST_TYPES, DATA_DIRECTIONS, DEFAULT_NATIVE_HTTP_SETUP, DEFAULT_FCC_IMPORT_SETUP, DEFAULT_OOKLA_SETUP } from "./config/dataTestConfig";
import NativeHttpTestCard from "./components/testcards/NativeHttpTestCard";
import FtpTestCard from "./components/testcards/FtpTestCard";
import IperfTestCard from "./components/testcards/IperfTestCard";
import OoklaTestCard from "./components/testcards/OoklaTestCard";
import FccTestCard from "./components/testcards/FccTestCard";


const BabyDragonRfKpi = registerPlugin("BabyDragonRfKpi");

const KPI_ROW_SETS = {
  auto: [
    { group: "Current RAT", kpi: "Current RAT", unit: "", avgMode: "none" },
    { group: "LTE Anchor", kpi: "PCI / EARFCN / TAC", unit: "", avgMode: "none" },
    { group: "LTE Anchor", kpi: "Cell ID", unit: "", avgMode: "none" },
    { group: "LTE Anchor", kpi: "RSRP", unit: "dBm", metric: "lteRsrp" },
    { group: "LTE Anchor", kpi: "RSRQ", unit: "dB", metric: "lteRsrq" },
    { group: "LTE Anchor", kpi: "SINR / RSSNR", unit: "dB", metric: "lteSinr" },
    { group: "LTE Anchor", kpi: "RSSI", unit: "dBm", metric: "lteRssi" },
    { group: "NR Secondary", kpi: "PCI / NRARFCN / TAC", unit: "", avgMode: "none" },
    { group: "NR Secondary", kpi: "NCI", unit: "", avgMode: "none" },
    { group: "NR Secondary", kpi: "SS-RSRP", unit: "dBm", metric: "nrRsrp" },
    { group: "NR Secondary", kpi: "SS-RSRQ", unit: "dB", metric: "nrRsrq" },
    { group: "NR Secondary", kpi: "SS-SINR", unit: "dB", metric: "nrSinr" },
    { group: "Data KPIs", kpi: "APP DL THP", unit: "Mbps", avgMode: "data", dataMetric: "dl" },
    { group: "Data KPIs", kpi: "APP UL THP", unit: "Mbps", avgMode: "data", dataMetric: "ul" },
    { group: "Voice KPIs", kpi: "Call State", unit: "", avgMode: "none" },
  ],
  nrLte: [
    { group: "Current RAT", kpi: "Current RAT", unit: "", avgMode: "none" },
    { group: "LTE Anchor", kpi: "PCI / EARFCN / TAC", unit: "", avgMode: "none" },
    { group: "LTE Anchor", kpi: "Cell ID", unit: "", avgMode: "none" },
    { group: "LTE Anchor", kpi: "RSRP", unit: "dBm", metric: "lteRsrp" },
    { group: "LTE Anchor", kpi: "RSRQ", unit: "dB", metric: "lteRsrq" },
    { group: "LTE Anchor", kpi: "SINR / RSSNR", unit: "dB", metric: "lteSinr" },
    { group: "LTE Anchor", kpi: "RSSI", unit: "dBm", metric: "lteRssi" },
    { group: "NR Secondary", kpi: "PCI / NRARFCN / TAC", unit: "", avgMode: "none" },
    { group: "NR Secondary", kpi: "NCI", unit: "", avgMode: "none" },
    { group: "NR Secondary", kpi: "SS-RSRP", unit: "dBm", metric: "nrRsrp" },
    { group: "NR Secondary", kpi: "SS-RSRQ", unit: "dB", metric: "nrRsrq" },
    { group: "NR Secondary", kpi: "SS-SINR", unit: "dB", metric: "nrSinr" },
    { group: "Data KPIs", kpi: "APP DL THP", unit: "Mbps", avgMode: "data", dataMetric: "dl" },
    { group: "Data KPIs", kpi: "APP UL THP", unit: "Mbps", avgMode: "data", dataMetric: "ul" },
    { group: "Voice KPIs", kpi: "VoLTE / VoNR State", unit: "", avgMode: "none" },
  ],
  wcdma: [
    { group: "3G Serving", kpi: "Technology", unit: "", avgMode: "none" },
    { group: "3G Serving", kpi: "UARFCN / PSC", unit: "", avgMode: "none" },
    { group: "3G Serving", kpi: "LAC / Cell ID", unit: "", avgMode: "none" },
    { group: "3G RF", kpi: "RSCP", unit: "dBm", metric: "threeGRscp" },
    { group: "3G RF", kpi: "Ec/No", unit: "dB", metric: "threeGEcno" },
    { group: "3G RF", kpi: "RSSI", unit: "dBm", metric: "threeGRssi" },
    { group: "Voice KPIs", kpi: "Call State", unit: "", avgMode: "none" },
    { group: "Voice KPIs", kpi: "Attempts / Drops", unit: "", avgMode: "none", planned: true },
  ],
  gsm: [
    { group: "2G Serving", kpi: "Technology", unit: "", avgMode: "none" },
    { group: "2G Serving", kpi: "ARFCN / BSIC", unit: "", avgMode: "none" },
    { group: "2G Serving", kpi: "LAC / Cell ID", unit: "", avgMode: "none" },
    { group: "2G RF", kpi: "RxLev / RSSI", unit: "dBm", metric: "twoGRssi" },
    { group: "2G RF", kpi: "BER", unit: "0-7/99", metric: "twoGBer" },
    { group: "2G RF", kpi: "Timing Advance", unit: "symbols", metric: "twoGTimingAdvance" },
    { group: "Voice KPIs", kpi: "Call State", unit: "", avgMode: "none" },
    { group: "Voice KPIs", kpi: "Attempts / Drops", unit: "", avgMode: "none", planned: true },
  ],
};

const RAT_OPTIONS = [
  { key: "auto", label: "Auto", hint: "Current RAT" },
  { key: "nrLte", label: "5G/4G", hint: "LTE + NR" },
  { key: "wcdma", label: "3G", hint: "WCDMA/CDMA" },
  { key: "gsm", label: "2G", hint: "GSM" },
];

const KPI_LEGENDS = [
  {
    name: "NR/LTE RSRP",
    unit: "dBm",
    note: "5G/LTE reference signal power family",
    bands: [
      { label: "Excellent", range: ">= -80", className: "excellent" },
      { label: "Good", range: "-81 to -90", className: "good" },
      { label: "Fair", range: "-91 to -100", className: "fair" },
      { label: "Poor", range: "-101 to -110", className: "poor" },
      { label: "Bad", range: "< -110", className: "bad" },
    ],
  },
  {
    name: "NR/LTE RSRQ",
    unit: "dB",
    note: "5G/LTE reference signal quality family",
    bands: [
      { label: "Excellent", range: ">= -10", className: "excellent" },
      { label: "Good", range: "-11 to -15", className: "good" },
      { label: "Fair", range: "-16 to -20", className: "fair" },
      { label: "Poor", range: "-21 to -25", className: "poor" },
      { label: "Bad", range: "< -25", className: "bad" },
    ],
  },
  {
    name: "NR/LTE SINR",
    unit: "dB",
    note: "Signal to interference plus noise family",
    bands: [
      { label: "Excellent", range: ">= 20", className: "excellent" },
      { label: "Good", range: "13 to 19", className: "good" },
      { label: "Fair", range: "5 to 12", className: "fair" },
      { label: "Poor", range: "0 to 4", className: "poor" },
      { label: "Bad", range: "< 0", className: "bad" },
    ],
  },
  {
    name: "3G RSCP / EcNo",
    unit: "dBm / dB",
    note: "WCDMA signal level and quality families",
    bands: [
      { label: "Excellent", range: "RSCP >= -75", className: "excellent" },
      { label: "Good", range: "-76 to -85", className: "good" },
      { label: "Fair", range: "-86 to -95", className: "fair" },
      { label: "Poor", range: "-96 to -105", className: "poor" },
      { label: "Bad", range: "< -105", className: "bad" },
    ],
  },
  {
    name: "2G RSSI / RxLev",
    unit: "dBm",
    note: "GSM signal strength family",
    bands: [
      { label: "Excellent", range: ">= -65", className: "excellent" },
      { label: "Good", range: "-66 to -75", className: "good" },
      { label: "Fair", range: "-76 to -85", className: "fair" },
      { label: "Poor", range: "-86 to -95", className: "poor" },
      { label: "Bad", range: "< -95", className: "bad" },
    ],
  },
  {
    name: "APP THP",
    unit: "Mbps",
    note: "Application-layer DL/UL throughput thresholds",
    bands: [
      { label: "Excellent", range: "Project target +", className: "excellent" },
      { label: "Good", range: "Meets target", className: "good" },
      { label: "Fair", range: "Watch zone", className: "fair" },
      { label: "Poor", range: "Below target", className: "poor" },
      { label: "Bad", range: "Severe fail", className: "bad" },
    ],
  },
  {
    name: "Voice",
    unit: "Events",
    note: "Call setup, connection, drop, and manual event markers",
    bands: [
      { label: "Pass", range: "Connected, no drop", className: "excellent" },
      { label: "Watch", range: "Setup delay", className: "fair" },
      { label: "Fail", range: "Drop / no setup", className: "bad" },
    ],
  },
];

const DATA_TEST_OPTIONS = [
  { label: "Internal HTTP DL/UL", status: "Next", note: "BabyDragon controlled application throughput test." },
  { label: "iPerf", status: "Planned", note: "Use configured server and record RF/GPS trace." },
  { label: "FTP", status: "Planned", note: "Use configured FTP server and record RF/GPS trace." },
  { label: "Open Ookla", status: "App", note: "Launch app, run test there, keep RF/GPS trace active." },
  { label: "Open FCC", status: "App", note: "Launch app, run test there, keep RF/GPS trace active." },
];

const VOICE_TEST_OPTIONS = [
  { label: "Start Voice Monitor", status: "Next", note: "Track call state with RF/GPS samples." },
  { label: "Dial Test Number", status: "Planned", note: "Open dialer to configured test number." },
  { label: "Mark Connected", status: "Manual", note: "FE marker for answered call." },
  { label: "Mark Drop / Fail", status: "Manual", note: "FE marker for dropped or failed call." },
];

const INTERNAL_THP_CONFIG = {
  downloadUrl: "https://speed.cloudflare.com/__down",
  uploadUrl: "https://speed.cloudflare.com/__up",
  downloadBytes: 8 * 1024 * 1024,
  uploadBytes: 3 * 1024 * 1024,
  timeoutMs: 15000,
};

const DEFAULT_DATA_TEST_TYPE = DEFAULT_NATIVE_HTTP_SETUP.testType;
const DEFAULT_DATA_DIRECTION = DEFAULT_NATIVE_HTTP_SETUP.direction;
const DEFAULT_THP_ITERATIONS = Number(DEFAULT_NATIVE_HTTP_SETUP.iterations || 1);
const DEFAULT_THP_WAIT_SECONDS = Number(DEFAULT_NATIVE_HTTP_SETUP.waitSeconds || 5);
const DEFAULT_THP_DURATION_SECONDS = Number(DEFAULT_NATIVE_HTTP_SETUP.durationSeconds || 10);
const DEFAULT_THP_INTERVAL_SECONDS = Number(DEFAULT_NATIVE_HTTP_SETUP.intervalSeconds || 1);
const MAX_THP_ITERATIONS = 20;
const MAX_THP_WAIT_SECONDS = 120;
const MAX_THP_DURATION_SECONDS = 300;
const MAX_THP_INTERVAL_SECONDS = 10;

function makeDataTestIdle() {
  return {
    status: "idle",
    phase: "idle",
    dlMbps: null,
    ulMbps: null,
    downloadBytes: 0,
    uploadBytes: 0,
    testType: DEFAULT_DATA_TEST_TYPE,
    direction: DEFAULT_DATA_DIRECTION,
    iterationsRequested: DEFAULT_THP_ITERATIONS,
    waitSeconds: DEFAULT_THP_WAIT_SECONDS,
    durationSeconds: DEFAULT_THP_DURATION_SECONDS,
    intervalSeconds: DEFAULT_THP_INTERVAL_SECONDS,
    downloadUrl: DEFAULT_NATIVE_HTTP_SETUP.downloadUrl,
    uploadUrl: DEFAULT_NATIVE_HTTP_SETUP.uploadUrl,
    currentIteration: 0,
    completedIterations: 0,
    iterationResults: [],
    message: "Internal DL/UL test ready.",
    error: "",
    startedAt: null,
    endedAt: null,
  };
}

function makeAbortErrorMessage(error) {
  if (error?.name === "AbortError") return "Throughput test stopped.";
  return error?.message || "Throughput test failed.";
}

function pickThroughputValue(metric, dataContext = {}) {
  const active = dataContext.dataTest || {};
  const saved = dataContext.savedSession || {};
  if (metric === "dl") return getNumber(active.dlMbps ?? saved.appDlMbps);
  if (metric === "ul") return getNumber(active.ulMbps ?? saved.appUlMbps);
  return null;
}

function formatThroughputValue(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function formatThroughputLive(metric, dataContext = {}) {
  const value = pickThroughputValue(metric, dataContext);
  if (value !== null) return formatThroughputValue(value);

  const active = dataContext.dataTest || {};
  if (active.status === "running") {
    if (metric === "dl" && active.phase === "download") return "Testing...";
    if (metric === "ul" && active.phase === "upload") return "Testing...";
  }

  return "N/A";
}

function formatThroughputWithUnit(value) {
  const shown = String(value || "N/A");
  if (shown === "N/A" || shown.includes("Testing") || shown.includes("Queued")) return shown;
  return `${shown} Mbps`;
}

function throughputStatus(metric, dataContext = {}) {
  const active = dataContext.dataTest || {};
  const saved = dataContext.savedSession || {};
  const value = pickThroughputValue(metric, dataContext);

  if (active.status === "running") {
    if (metric === "dl" && active.phase === "download") return "Testing";
    if (metric === "ul" && active.phase === "upload") return "Testing";
    if (value !== null) return "Live";
    return "Queued";
  }
  if (active.status === "error") return value !== null ? "Partial" : "Error";
  if (active.status === "stopped") return value !== null ? "Stopped" : "Stopped";
  if (value !== null) return saved.frozen ? "Saved" : "Live";
  return "Ready";
}

function makeAbortError() {
  const error = new Error("Throughput test stopped.");
  error.name = "AbortError";
  return error;
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function cleanIntegerDraft(value, maxDigits = 3) {
  return String(value ?? "")
    .replace(/[^0-9]/g, "")
    .slice(0, maxDigits);
}

function commitIntegerDraft(value, min, max, fallback) {
  return String(clampInteger(value, min, max, fallback));
}

function averageThroughput(results, key) {
  const values = (Array.isArray(results) ? results : [])
    .map((row) => getNumber(row?.[key]))
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function splitIterationDuration(totalSeconds, direction) {
  const total = clampInteger(totalSeconds, 1, MAX_THP_DURATION_SECONDS, DEFAULT_THP_DURATION_SECONDS);
  if (direction === "dl") return { dlDurationSeconds: total, ulDurationSeconds: 0, phaseText: `${total}s DL` };
  if (direction === "ul") return { dlDurationSeconds: 0, ulDurationSeconds: total, phaseText: `${total}s UL` };
  const dlDurationSeconds = Math.max(1, Math.ceil(total / 2));
  const ulDurationSeconds = Math.max(1, total - dlDurationSeconds);
  return { dlDurationSeconds, ulDurationSeconds, phaseText: `${total}s total (${dlDurationSeconds}s DL + ${ulDurationSeconds}s UL)` };
}

function formatThpIterationSummary(row) {
  if (!row) return "N/A";
  return `DL ${formatThroughputValue(getNumber(row.dlMbps))} / UL ${formatThroughputValue(getNumber(row.ulMbps))} Mbps`;
}

function waitForThroughputPause(waitSeconds, signal, onTick) {
  const totalMs = Math.max(0, Number(waitSeconds || 0) * 1000);
  if (!totalMs) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let intervalId = null;
    let timeoutId = null;

    const cleanup = () => {
      if (intervalId) window.clearInterval(intervalId);
      if (timeoutId) window.clearTimeout(timeoutId);
      if (signal?.removeEventListener) signal.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      cleanup();
      reject(makeAbortError());
    };

    const tick = () => {
      if (signal?.aborted) {
        onAbort();
        return;
      }
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, Math.ceil((totalMs - elapsed) / 1000));
      if (typeof onTick === "function") onTick(remaining);
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }

    if (signal?.addEventListener) signal.addEventListener("abort", onAbort, { once: true });
    tick();
    intervalId = window.setInterval(tick, 500);
    timeoutId = window.setTimeout(() => {
      cleanup();
      resolve();
    }, totalMs);
  });
}

function shouldFallbackToWeb(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("not implemented") || message.includes("not available") || message.includes("plugin") || message.includes("web");
}

async function runNativeThroughputPhase({ phase, bytes, url, durationSeconds, intervalSeconds, signal }) {
  if (signal?.aborted) throw makeAbortError();
  if (typeof BabyDragonRfKpi.runThroughputTest !== "function") return null;

  try {
    const response = await BabyDragonRfKpi.runThroughputTest({
      phase,
      bytes,
      url,
      timeoutMs: durationSeconds > 0
        ? Math.max(2500, Math.min(INTERNAL_THP_CONFIG.timeoutMs, ((durationSeconds || 0) * 1000) + 2500))
        : INTERNAL_THP_CONFIG.timeoutMs,
      durationSeconds,
      intervalSeconds,
    });

    if (signal?.aborted) throw makeAbortError();

    if (!response?.ok) {
      throw new Error(response?.message || `${phase.toUpperCase()} native throughput test failed.`);
    }

    return {
      mbps: Number(response.mbps),
      bytes: Number(response.bytes || bytes),
      seconds: Number(response.seconds || 0),
      wallSeconds: Number(response.wallSeconds || response.seconds || 0),
      source: response.source || "native-http",
    };
  } catch (error) {
    if (signal?.aborted) throw makeAbortError();
    if (shouldFallbackToWeb(error)) return null;
    throw error;
  }
}

function makeUploadBody(byteCount) {
  const size = Math.max(256 * 1024, byteCount || INTERNAL_THP_CONFIG.uploadBytes);
  const body = new Uint8Array(size);
  for (let index = 0; index < body.length; index += 1) {
    body[index] = index % 251;
  }
  return body;
}

function buildTimedSignal(controller, timeoutMs) {
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  return () => window.clearTimeout(timeout);
}

async function measureDownloadThroughput({ signal, onProgress, config = {} }) {
  const durationSeconds = clampInteger(config.durationSeconds, 1, MAX_THP_DURATION_SECONDS, DEFAULT_THP_DURATION_SECONDS);
  const bytes = INTERNAL_THP_CONFIG.downloadBytes;
  const url = config.downloadUrl || INTERNAL_THP_CONFIG.downloadUrl;
  const nativeResult = await runNativeThroughputPhase({
    phase: "download",
    bytes,
    url,
    durationSeconds,
    intervalSeconds: config.intervalSeconds,
    signal,
  });

  if (nativeResult) {
    if (typeof onProgress === "function") onProgress(nativeResult.bytes, bytes);
    return nativeResult;
  }

  const webUrl = `${url}?bytes=${bytes}&cacheBust=${Date.now()}`;
  const startedAt = performance.now();
  const response = await fetch(webUrl, { cache: "no-store", signal });
  if (!response.ok) throw new Error(`DL test HTTP ${response.status}`);

  let received = 0;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value?.byteLength || 0;
      if (typeof onProgress === "function") onProgress(received, bytes);
    }
  } else {
    const buffer = await response.arrayBuffer();
    received = buffer.byteLength;
    if (typeof onProgress === "function") onProgress(received, bytes);
  }

  const seconds = Math.max(0.15, (performance.now() - startedAt) / 1000);
  return { mbps: (received * 8) / seconds / 1000000, bytes: received, seconds };
}

async function measureUploadThroughput({ signal, config = {} }) {
  const durationSeconds = clampInteger(config.durationSeconds, 1, MAX_THP_DURATION_SECONDS, DEFAULT_THP_DURATION_SECONDS);
  const bytes = INTERNAL_THP_CONFIG.uploadBytes;
  const url = config.uploadUrl || INTERNAL_THP_CONFIG.uploadUrl;
  const nativeResult = await runNativeThroughputPhase({
    phase: "upload",
    bytes,
    url,
    durationSeconds,
    intervalSeconds: config.intervalSeconds,
    signal,
  });

  if (nativeResult) return nativeResult;

  const body = makeUploadBody(bytes);
  const startedAt = performance.now();
  const response = await fetch(`${url}?cacheBust=${Date.now()}`, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/octet-stream" },
    body,
    signal,
  });
  if (!response.ok) throw new Error(`UL test HTTP ${response.status}`);

  const seconds = Math.max(0.15, (performance.now() - startedAt) / 1000);
  return { mbps: (body.byteLength * 8) / seconds / 1000000, bytes: body.byteLength, seconds };
}

const EXPORT_ITEMS = [
  { title: "Summary CSV", description: "One clean row with task, grid, RF averages, THP averages, and voice monitor status." },
  { title: "Trace CSV", description: "One row per RF/GPS sample with LTE, NR, 3G, 2G, call state, and GPS fields." },
  { title: "THP Iteration CSV", description: "One row per DL/UL iteration with bytes, seconds, Mbps, and source." },
  { title: "Voice KPI CSV", description: "Voice monitor summary now. Full call attempts/drops come in the voice step." },
  { title: "FCC-style JSON", description: "One structured JSON package containing summary, RF trace, THP iterations, voice, and report metadata." },
];

function formatIso(timestamp) {
  if (!timestamp) return "";
  try {
    return new Date(timestamp).toISOString();
  } catch (error) {
    return "";
  }
}

function formatLocalDateTime(timestamp) {
  if (!timestamp) return "";
  try {
    return new Date(timestamp).toLocaleString();
  } catch (error) {
    return "";
  }
}

function cleanFilePart(value, fallback = "babydragon") {
  const text = String(value || fallback).trim() || fallback;
  return text
    .replace(/[^a-z0-9._-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || fallback;
}

function formatFileDateTime(timestamp) {
  const date = timestamp ? new Date(timestamp) : new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function buildProfessionalReportName(session, activeTask) {
  const taskName = session?.taskLabel || getTaskLabel(activeTask) || "BabyDragon_Task";
  const mode = session?.mode === "voice" ? "Voice" : "Data";
  const started = session?.startedAt || session?.endedAt || Date.now();
  return cleanFilePart(`${taskName}_${mode}_RF_Report_${formatFileDateTime(started)}`, "BabyDragon_RF_Report");
}

function csvValue(value) {
  if (value === null || value === undefined) return "";
  const text = String(value).replace(/\r?\n/g, " ");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function makeCsv(headers, rows) {
  const line = (row) => headers.map((header) => csvValue(row[header])).join(",");
  // UTF-8 BOM keeps Excel from showing characters like “·” as Â·.
  return "\uFEFF" + [headers.join(","), ...rows.map(line)].join("\n");
}

function compactNumber(value, digits = 2) {
  const number = getNumber(value);
  if (number === null) return "";
  return Number.isInteger(number) ? String(number) : number.toFixed(digits);
}

function textOrBlank(value) {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  return text === "N/A" ? "" : text;
}

function getSnapshotExportFields(snapshot = {}) {
  const lte = getLteAnchor(snapshot);
  const nr = getNrSecondary(snapshot);
  const threeG = getThreeGServing(snapshot);
  const twoG = getTwoGServing(snapshot);
  return {
    rat: getCurrentRatName(snapshot),
    carrier: snapshot?.carrierName || "",
    sim_carrier: snapshot?.simCarrierName || "",
    network_operator: snapshot?.networkOperator || "",
    data_network_type: snapshot?.dataNetworkTypeName || "",
    call_state: snapshot?.callState || "",
    lte_pci: lte?.pci ?? "",
    lte_earfcn: lte?.earfcn ?? lte?.channel ?? "",
    lte_tac: lte?.tac ?? "",
    lte_cell_id: lte?.cellId ?? lte?.ci ?? "",
    lte_rsrp_dbm: compactNumber(lte?.rsrp ?? lte?.dbm, 1),
    lte_rsrq_db: compactNumber(lte?.rsrq, 1),
    lte_sinr_db: compactNumber(lte?.sinr ?? lte?.rssnr, 1),
    lte_sinr_source: lte?.sinrSource || "",
    lte_rssi_dbm: compactNumber(lte?.rssi ?? lte?.dbm, 1),
    nr_pci: nr?.pci ?? "",
    nr_nrarfcn: nr?.nrarfcn ?? nr?.channel ?? "",
    nr_tac: nr?.tac ?? "",
    nr_nci: nr?.nci ?? nr?.cellId ?? "",
    nr_ss_rsrp_dbm: compactNumber(nr?.ssRsrp ?? nr?.rsrp, 1),
    nr_ss_rsrq_db: compactNumber(nr?.ssRsrq ?? nr?.rsrq, 1),
    nr_ss_sinr_db: compactNumber(nr?.ssSinr ?? nr?.sinr, 1),
    nr_status: snapshot?.nrSecondaryStatus || "",
    threeg_uarfcn: threeG?.uarfcn ?? threeG?.channel ?? "",
    threeg_psc: threeG?.psc ?? "",
    threeg_lac: threeG?.lac ?? "",
    threeg_cell_id: threeG?.cellId ?? threeG?.cid ?? "",
    threeg_rscp_dbm: compactNumber(threeG?.rscp ?? threeG?.dbm, 1),
    threeg_ecno_db: compactNumber(threeG?.ecno, 1),
    twog_arfcn: twoG?.arfcn ?? twoG?.channel ?? "",
    twog_bsic: twoG?.bsic ?? "",
    twog_lac: twoG?.lac ?? "",
    twog_cell_id: twoG?.cellId ?? twoG?.cid ?? "",
    twog_rssi_dbm: compactNumber(twoG?.rxlev ?? twoG?.rssi ?? twoG?.dbm, 1),
    twog_ber: compactNumber(twoG?.ber, 0),
  };
}

function buildVoiceSummary(session) {
  const samples = session?.exportSamples || session?.traceSamples || [];
  const callStates = samples
    .map((sample) => sample?.snapshot?.callState)
    .filter(Boolean);
  const finalCallState = callStates[callStates.length - 1] || "N/A";
  const offhookCount = callStates.filter((state) => String(state).toLowerCase() === "offhook").length;
  const voiceMode = session?.mode === "voice";
  return {
    voice_monitor_status: voiceMode ? "recorded" : "not_run_in_data_mode",
    final_call_state: finalCallState,
    offhook_samples: offhookCount,
    attempts: "N/A",
    connected: offhookCount > 0 ? "observed_by_call_state" : "N/A",
    drops: "N/A",
    failures: "N/A",
    remarks: voiceMode
      ? "Public Android call-state samples captured. Manual attempt/connect/drop counters will be added in the dedicated Voice KPI step."
      : "Data session. Voice KPIs are exported as placeholders until Voice Mode is run.",
  };
}


function getThpWindow(session) {
  const rows = Array.isArray(session?.appIterationResults) ? session.appIterationResults : [];
  const starts = rows.map((row) => getNumber(row.startedAt)).filter((value) => value !== null);
  const ends = rows.map((row) => getNumber(row.endedAt)).filter((value) => value !== null);
  if (!starts.length || !ends.length) return { startedAt: "", endedAt: "", durationMs: "", duration: "" };
  const startedAt = Math.min(...starts);
  const endedAt = Math.max(...ends);
  const durationMs = Math.max(0, endedAt - startedAt);
  return {
    startedAt,
    endedAt,
    durationMs,
    duration: formatDuration(durationMs),
  };
}

function buildSummaryCsv(session, user, activeTask) {
  const voice = buildVoiceSummary(session);
  const stats = session?.stats || {};
  const thpWindow = getThpWindow(session);
  const headers = [
    "report_type", "session_id", "mode", "fe", "task", "grid", "grid_internal_id",
    "session_started_local", "session_ended_local", "session_duration", "session_duration_ms", "samples", "gps_points", "rat",
    "thp_started_local", "thp_ended_local", "thp_duration", "thp_duration_ms",
    "app_dl_avg_mbps", "app_ul_avg_mbps", "thp_iterations_requested", "thp_iterations_completed",
    "thp_requested_duration_per_iteration_sec", "thp_interval_sec", "thp_wait_between_iterations_sec", "thp_direction",
    "thp_status", "thp_summary_rule", "report_scope",
    "avg_lte_rsrp_dbm", "min_lte_rsrp_dbm", "max_lte_rsrp_dbm",
    "avg_lte_rsrq_db", "min_lte_rsrq_db", "max_lte_rsrq_db",
    "avg_lte_sinr_db", "min_lte_sinr_db", "max_lte_sinr_db",
    "avg_lte_rssi_dbm", "min_lte_rssi_dbm", "max_lte_rssi_dbm",
    "avg_nr_rsrp_dbm", "avg_nr_sinr_db",
    "avg_3g_rscp_dbm", "avg_3g_ecno_db", "avg_3g_rssi_dbm",
    "avg_2g_rssi_dbm", "avg_2g_ber", "avg_2g_timing_advance",
    "voice_monitor_status", "final_call_state", "offhook_samples", "remarks"
  ];

  const row = {
    report_type: "session_summary",
    session_id: session?.id || "",
    mode: session?.mode || "",
    fe: user?.email || "",
    task: session?.taskLabel || getTaskLabel(activeTask),
    grid: session?.grid || getTaskGrid(activeTask),
    grid_internal_id: getTaskGridInternalId(activeTask),
    session_started_local: formatLocalDateTime(session?.startedAt),
    session_ended_local: formatLocalDateTime(session?.endedAt),
    session_duration: formatDuration(session?.durationMs),
    session_duration_ms: session?.durationMs ?? "",
    samples: session?.sampleCount ?? "",
    gps_points: session?.gpsCount ?? "",
    rat: session?.rat || "",
    thp_started_local: formatLocalDateTime(thpWindow.startedAt),
    thp_ended_local: formatLocalDateTime(thpWindow.endedAt),
    thp_duration: thpWindow.duration,
    thp_duration_ms: thpWindow.durationMs,
    app_dl_avg_mbps: compactNumber(session?.appDlMbps, 2),
    app_ul_avg_mbps: compactNumber(session?.appUlMbps, 2),
    thp_iterations_requested: session?.appIterationsRequested ?? "",
    thp_iterations_completed: session?.appCompletedIterations ?? "",
    thp_requested_duration_per_iteration_sec: session?.appDurationSeconds ?? "",
    thp_interval_sec: session?.appIntervalSeconds ?? "",
    thp_wait_between_iterations_sec: session?.appWaitSeconds ?? "",
    thp_direction: session?.appDirection ?? "",
    thp_status: session?.appCompletedIterations && session?.appCompletedIterations === session?.appIterationsRequested ? "complete" : session?.appCompletedIterations ? "partial" : "not_run",
    thp_summary_rule: "Avg DL/UL THP is the arithmetic average of completed THP iterations only.",
    report_scope: "Summary has one row. THP iteration details are in THP_Iterations CSV. RF/GPS sample rows are in RF_GPS_Trace CSV.",
    avg_lte_rsrp_dbm: compactNumber(stats?.lteRsrp?.avg ?? session?.avgLteRsrp, 1),
    min_lte_rsrp_dbm: compactNumber(stats?.lteRsrp?.min, 1),
    max_lte_rsrp_dbm: compactNumber(stats?.lteRsrp?.max, 1),
    avg_lte_rsrq_db: compactNumber(stats?.lteRsrq?.avg ?? session?.avgLteRsrq, 1),
    min_lte_rsrq_db: compactNumber(stats?.lteRsrq?.min, 1),
    max_lte_rsrq_db: compactNumber(stats?.lteRsrq?.max, 1),
    avg_lte_sinr_db: compactNumber(stats?.lteSinr?.avg ?? session?.avgLteSinr, 1),
    min_lte_sinr_db: compactNumber(stats?.lteSinr?.min, 1),
    max_lte_sinr_db: compactNumber(stats?.lteSinr?.max, 1),
    avg_lte_rssi_dbm: compactNumber(stats?.lteRssi?.avg ?? session?.avgLteRssi, 1),
    min_lte_rssi_dbm: compactNumber(stats?.lteRssi?.min, 1),
    max_lte_rssi_dbm: compactNumber(stats?.lteRssi?.max, 1),
    avg_nr_rsrp_dbm: compactNumber(stats?.nrRsrp?.avg ?? session?.avgNrRsrp, 1),
    avg_nr_sinr_db: compactNumber(stats?.nrSinr?.avg ?? session?.avgNrSinr, 1),
    avg_3g_rscp_dbm: compactNumber(stats?.threeGRscp?.avg ?? session?.avgThreeGRscp, 1),
    avg_3g_ecno_db: compactNumber(stats?.threeGEcno?.avg ?? session?.avgThreeGEcno, 1),
    avg_3g_rssi_dbm: compactNumber(stats?.threeGRssi?.avg ?? session?.avgThreeGRssi, 1),
    avg_2g_rssi_dbm: compactNumber(stats?.twoGRssi?.avg ?? session?.avgTwoGRssi, 1),
    avg_2g_ber: compactNumber(stats?.twoGBer?.avg ?? session?.avgTwoGBer, 1),
    avg_2g_timing_advance: compactNumber(stats?.twoGTimingAdvance?.avg ?? session?.avgTwoGTimingAdvance, 0),
    voice_monitor_status: voice.voice_monitor_status,
    final_call_state: voice.final_call_state,
    offhook_samples: voice.offhook_samples,
    remarks: "One clean session summary row. Iteration details are in the THP_Iterations CSV.",
  };

  return makeCsv(headers, [row]);
}

function buildTraceCsv(session) {
  const samples = session?.exportSamples || session?.traceSamples || [];
  const headers = [
    "sample_index", "sample_id", "session_id", "timestamp_local", "timestamp_iso", "mode", "recorded",
    "latitude", "longitude", "gps_accuracy_m", "rat", "carrier", "sim_carrier", "network_operator", "data_network_type", "call_state",
    "lte_pci", "lte_earfcn", "lte_tac", "lte_cell_id", "lte_rsrp_dbm", "lte_rsrq_db", "lte_sinr_db", "lte_sinr_source", "lte_rssi_dbm",
    "nr_pci", "nr_nrarfcn", "nr_tac", "nr_nci", "nr_ss_rsrp_dbm", "nr_ss_rsrq_db", "nr_ss_sinr_db", "nr_status",
    "threeg_uarfcn", "threeg_psc", "threeg_lac", "threeg_cell_id", "threeg_rscp_dbm", "threeg_ecno_db",
    "twog_arfcn", "twog_bsic", "twog_lac", "twog_cell_id", "twog_rssi_dbm", "twog_ber"
  ];
  const rows = samples.map((sample, index) => {
    const fields = getSnapshotExportFields(sample?.snapshot || {});
    return {
      sample_index: index + 1,
      sample_id: sample?.id || "",
      session_id: sample?.sessionId || session?.id || "",
      timestamp_local: formatLocalDateTime(sample?.timestamp),
      timestamp_iso: formatIso(sample?.timestamp),
      mode: sample?.mode || session?.mode || "",
      recorded: sample?.recorded ? "yes" : "no",
      latitude: compactNumber(sample?.gps?.lat, 7),
      longitude: compactNumber(sample?.gps?.lng, 7),
      gps_accuracy_m: compactNumber(sample?.gps?.accuracy, 1),
      ...fields,
    };
  });
  return makeCsv(headers, rows);
}


function buildThpCsv(session) {
  const headers = [
    "iteration", "status", "task", "grid", "session_id",
    "started_at_local", "ended_at_local", "wall_seconds",
    "direction", "requested_total_duration_sec", "requested_dl_duration_sec", "requested_ul_duration_sec", "interval_sec", "wait_after_iteration_sec",
    "dl_mbps", "ul_mbps", "dl_bytes", "ul_bytes", "dl_transfer_seconds", "ul_transfer_seconds", "dl_wall_seconds", "ul_wall_seconds", "dl_source", "ul_source", "summary_note"
  ];
  const totalRows = (session?.appIterationResults || []).length;
  const rows = (session?.appIterationResults || []).map((item) => ({
    iteration: item.iteration,
    status: item.status || "complete",
    task: session?.taskLabel || "",
    grid: session?.grid || "",
    session_id: session?.id || "",
    started_at_local: formatLocalDateTime(item.startedAt),
    ended_at_local: formatLocalDateTime(item.endedAt),
    wall_seconds: compactNumber(((getNumber(item.endedAt) || 0) - (getNumber(item.startedAt) || 0)) / 1000, 2),
    direction: item.direction || session?.appDirection || "",
    requested_total_duration_sec: item.durationSeconds ?? session?.appDurationSeconds ?? "",
    requested_dl_duration_sec: item.dlDurationSeconds ?? "",
    requested_ul_duration_sec: item.ulDurationSeconds ?? "",
    interval_sec: item.intervalSeconds ?? session?.appIntervalSeconds ?? "",
    wait_after_iteration_sec: item.iteration < totalRows ? (item.waitSeconds ?? session?.appWaitSeconds ?? "") : 0,
    dl_mbps: compactNumber(item.dlMbps, 2),
    ul_mbps: compactNumber(item.ulMbps, 2),
    dl_bytes: item.dlBytes || 0,
    ul_bytes: item.ulBytes || 0,
    dl_transfer_seconds: compactNumber(item.dlSeconds, 3),
    ul_transfer_seconds: compactNumber(item.ulSeconds, 3),
    dl_wall_seconds: compactNumber(item.dlWallSeconds, 3),
    ul_wall_seconds: compactNumber(item.ulWallSeconds, 3),
    dl_source: item.dlSource || item.source || "",
    ul_source: item.ulSource || item.source || "",
    summary_note: "One THP iteration. Averages are calculated from all completed iteration rows.",
  }));
  return makeCsv(headers, rows);
}


function buildVoiceCsv(session, activeTask) {
  const samples = session?.exportSamples || session?.traceSamples || [];
  const voice = buildVoiceSummary(session);
  const headers = [
    "row_type", "session_id", "mode", "task", "grid", "timestamp_local", "timestamp_iso", "call_state",
    "voice_monitor_status", "offhook_samples", "voice_attempts", "voice_connected", "voice_drops", "voice_failures", "remarks"
  ];
  const summaryRow = {
    row_type: "voice_summary",
    session_id: session?.id || "",
    mode: session?.mode || "",
    task: session?.taskLabel || getTaskLabel(activeTask),
    grid: session?.grid || getTaskGrid(activeTask),
    timestamp_local: formatLocalDateTime(session?.endedAt),
    timestamp_iso: formatIso(session?.endedAt),
    call_state: voice.final_call_state,
    voice_monitor_status: voice.voice_monitor_status,
    offhook_samples: voice.offhook_samples,
    voice_attempts: voice.attempts,
    voice_connected: voice.connected,
    voice_drops: voice.drops,
    voice_failures: voice.failures,
    remarks: voice.remarks,
  };

  if (session?.mode !== "voice") {
    return makeCsv(headers, [summaryRow]);
  }

  const sampleRows = samples.map((sample) => ({
    row_type: "voice_call_state_sample",
    session_id: session?.id || sample?.sessionId || "",
    mode: sample?.mode || session?.mode || "",
    task: session?.taskLabel || getTaskLabel(activeTask),
    grid: session?.grid || getTaskGrid(activeTask),
    timestamp_local: formatLocalDateTime(sample?.timestamp),
    timestamp_iso: formatIso(sample?.timestamp),
    call_state: sample?.snapshot?.callState || "N/A",
    voice_monitor_status: voice.voice_monitor_status,
    offhook_samples: "",
    voice_attempts: "",
    voice_connected: "",
    voice_drops: "",
    voice_failures: "",
    remarks: "Public Android call-state snapshot.",
  }));
  return makeCsv(headers, [summaryRow, ...sampleRows]);
}


function jsonNumber(value, digits = null) {
  const number = getNumber(value);
  if (number === null) return null;
  if (Number.isInteger(number) || digits === null) return number;
  return Number(number.toFixed(digits));
}

function jsonText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text || text === "N/A") return null;
  return text;
}

function jsonTimestamp(value) {
  const iso = formatIso(value);
  return iso || null;
}

function buildJsonRfSummary(session) {
  const stats = session?.stats || {};
  return {
    rat: session?.rat || null,
    lte: {
      avg_rsrp_dbm: jsonNumber(stats?.lteRsrp?.avg ?? session?.avgLteRsrp, 1),
      min_rsrp_dbm: jsonNumber(stats?.lteRsrp?.min, 1),
      max_rsrp_dbm: jsonNumber(stats?.lteRsrp?.max, 1),
      avg_rsrq_db: jsonNumber(stats?.lteRsrq?.avg ?? session?.avgLteRsrq, 1),
      min_rsrq_db: jsonNumber(stats?.lteRsrq?.min, 1),
      max_rsrq_db: jsonNumber(stats?.lteRsrq?.max, 1),
      avg_sinr_db: jsonNumber(stats?.lteSinr?.avg ?? session?.avgLteSinr, 1),
      min_sinr_db: jsonNumber(stats?.lteSinr?.min, 1),
      max_sinr_db: jsonNumber(stats?.lteSinr?.max, 1),
      avg_rssi_dbm: jsonNumber(stats?.lteRssi?.avg ?? session?.avgLteRssi, 1),
      min_rssi_dbm: jsonNumber(stats?.lteRssi?.min, 1),
      max_rssi_dbm: jsonNumber(stats?.lteRssi?.max, 1),
    },
    nr: {
      avg_ss_rsrp_dbm: jsonNumber(stats?.nrRsrp?.avg ?? session?.avgNrRsrp, 1),
      avg_ss_sinr_db: jsonNumber(stats?.nrSinr?.avg ?? session?.avgNrSinr, 1),
    },
    wcdma: {
      avg_rscp_dbm: jsonNumber(stats?.threeGRscp?.avg ?? session?.avgThreeGRscp, 1),
      avg_ecno_db: jsonNumber(stats?.threeGEcno?.avg ?? session?.avgThreeGEcno, 1),
      avg_rssi_dbm: jsonNumber(stats?.threeGRssi?.avg ?? session?.avgThreeGRssi, 1),
    },
    gsm: {
      avg_rxlev_rssi_dbm: jsonNumber(stats?.twoGRssi?.avg ?? session?.avgTwoGRssi, 1),
      avg_ber: jsonNumber(stats?.twoGBer?.avg ?? session?.avgTwoGBer, 1),
      avg_timing_advance: jsonNumber(stats?.twoGTimingAdvance?.avg ?? session?.avgTwoGTimingAdvance, 0),
    },
  };
}

function buildJsonTraceSamples(session) {
  const samples = session?.exportSamples || session?.traceSamples || [];
  return samples.map((sample, index) => {
    const fields = getSnapshotExportFields(sample?.snapshot || {});
    return {
      sample_index: index + 1,
      sample_id: sample?.id || null,
      session_id: sample?.sessionId || session?.id || null,
      timestamp_local: formatLocalDateTime(sample?.timestamp) || null,
      timestamp_iso: jsonTimestamp(sample?.timestamp),
      mode: sample?.mode || session?.mode || null,
      recorded: Boolean(sample?.recorded),
      gps: {
        latitude: jsonNumber(sample?.gps?.lat, 7),
        longitude: jsonNumber(sample?.gps?.lng, 7),
        accuracy_m: jsonNumber(sample?.gps?.accuracy, 1),
        speed_mps: jsonNumber(sample?.gps?.speed, 2),
        bearing_deg: jsonNumber(sample?.gps?.bearing, 1),
      },
      network: {
        rat: jsonText(fields.rat),
        carrier: jsonText(fields.carrier),
        sim_carrier: jsonText(fields.sim_carrier),
        operator: jsonText(fields.network_operator),
        data_network_type: jsonText(fields.data_network_type),
        call_state: jsonText(fields.call_state),
      },
      lte: {
        pci: jsonNumber(fields.lte_pci),
        earfcn: jsonNumber(fields.lte_earfcn),
        tac: jsonNumber(fields.lte_tac),
        cell_id: jsonNumber(fields.lte_cell_id),
        rsrp_dbm: jsonNumber(fields.lte_rsrp_dbm, 1),
        rsrq_db: jsonNumber(fields.lte_rsrq_db, 1),
        sinr_db: jsonNumber(fields.lte_sinr_db, 1),
        sinr_source: jsonText(fields.lte_sinr_source),
        rssi_dbm: jsonNumber(fields.lte_rssi_dbm, 1),
      },
      nr: {
        pci: jsonNumber(fields.nr_pci),
        nrarfcn: jsonNumber(fields.nr_nrarfcn),
        tac: jsonNumber(fields.nr_tac),
        nci: jsonNumber(fields.nr_nci),
        ss_rsrp_dbm: jsonNumber(fields.nr_ss_rsrp_dbm, 1),
        ss_rsrq_db: jsonNumber(fields.nr_ss_rsrq_db, 1),
        ss_sinr_db: jsonNumber(fields.nr_ss_sinr_db, 1),
        status: jsonText(fields.nr_status),
      },
      wcdma: {
        uarfcn: jsonNumber(fields.threeg_uarfcn),
        psc: jsonNumber(fields.threeg_psc),
        lac: jsonNumber(fields.threeg_lac),
        cell_id: jsonNumber(fields.threeg_cell_id),
        rscp_dbm: jsonNumber(fields.threeg_rscp_dbm, 1),
        ecno_db: jsonNumber(fields.threeg_ecno_db, 1),
      },
      gsm: {
        arfcn: jsonNumber(fields.twog_arfcn),
        bsic: jsonNumber(fields.twog_bsic),
        lac: jsonNumber(fields.twog_lac),
        cell_id: jsonNumber(fields.twog_cell_id),
        rxlev_rssi_dbm: jsonNumber(fields.twog_rssi_dbm, 1),
        ber: jsonNumber(fields.twog_ber),
      },
    };
  });
}

function buildJsonThpIterations(session) {
  const totalRows = (session?.appIterationResults || []).length;
  return (session?.appIterationResults || []).map((item) => ({
    iteration: item.iteration,
    status: item.status || "complete",
    started_at_local: formatLocalDateTime(item.startedAt) || null,
    started_at_iso: jsonTimestamp(item.startedAt),
    ended_at_local: formatLocalDateTime(item.endedAt) || null,
    ended_at_iso: jsonTimestamp(item.endedAt),
    wall_seconds: jsonNumber(((getNumber(item.endedAt) || 0) - (getNumber(item.startedAt) || 0)) / 1000, 2),
    direction: item.direction || session?.appDirection || null,
    requested_total_duration_sec: jsonNumber(item.durationSeconds ?? session?.appDurationSeconds),
    requested_dl_duration_sec: jsonNumber(item.dlDurationSeconds),
    requested_ul_duration_sec: jsonNumber(item.ulDurationSeconds),
    interval_sec: jsonNumber(item.intervalSeconds ?? session?.appIntervalSeconds),
    wait_after_iteration_sec: item.iteration < totalRows ? jsonNumber(item.waitSeconds ?? session?.appWaitSeconds) : 0,
    dl: {
      mbps: jsonNumber(item.dlMbps, 2),
      bytes: jsonNumber(item.dlBytes),
      transfer_seconds: jsonNumber(item.dlSeconds, 3),
      wall_seconds: jsonNumber(item.dlWallSeconds, 3),
      source: jsonText(item.dlSource || item.source),
    },
    ul: {
      mbps: jsonNumber(item.ulMbps, 2),
      bytes: jsonNumber(item.ulBytes),
      transfer_seconds: jsonNumber(item.ulSeconds, 3),
      wall_seconds: jsonNumber(item.ulWallSeconds, 3),
      source: jsonText(item.ulSource || item.source),
    },
  }));
}

function buildJsonReport(session, user, activeTask, baseName, generatedAt) {
  const voice = buildVoiceSummary(session);
  const thpWindow = getThpWindow(session);
  const samples = session?.exportSamples || session?.traceSamples || [];
  const thpRows = session?.appIterationResults || [];
  return JSON.stringify({
    schema: {
      name: "BabyDragon Android Info RF Report",
      version: "1.0.0-step-1f9",
      layout: "fcc_like_structured_json",
      owner: "MobbiTech Global LLC",
      note: "BabyDragon JSON is FCC-style for interoperability, but not an FCC-certified result unless imported from the FCC app export.",
    },
    report: {
      display_name: baseName,
      generated_at_local: formatLocalDateTime(generatedAt),
      generated_at_iso: jsonTimestamp(generatedAt),
      files_expected: ["summary_csv", "rf_gps_trace_csv", "thp_iterations_csv", "voice_kpis_csv", "json"],
    },
    session: {
      session_id: session?.id || null,
      mode: session?.mode || null,
      fe: user?.email || null,
      task: session?.taskLabel || getTaskLabel(activeTask),
      grid: session?.grid || getTaskGrid(activeTask),
      grid_internal_id: getTaskGridInternalId(activeTask) || null,
      started_at_local: formatLocalDateTime(session?.startedAt),
      started_at_iso: jsonTimestamp(session?.startedAt),
      ended_at_local: formatLocalDateTime(session?.endedAt),
      ended_at_iso: jsonTimestamp(session?.endedAt),
      duration_ms: jsonNumber(session?.durationMs),
      duration_text: formatDuration(session?.durationMs || 0),
      sample_count: jsonNumber(session?.sampleCount ?? samples.length),
      gps_points: jsonNumber(session?.gpsCount),
      rat: session?.rat || null,
    },
    rf_summary: buildJsonRfSummary(session),
    data_test: {
      type: "native_android_http",
      direction: session?.appDirection || null,
      status: session?.appTestStatus || null,
      summary_rule: "Average DL/UL THP is the arithmetic average of completed iteration rows only.",
      requested: {
        iterations: jsonNumber(session?.appIterations),
        duration_sec: jsonNumber(session?.appDurationSeconds),
        interval_sec: jsonNumber(session?.appIntervalSeconds),
        wait_between_iterations_sec: jsonNumber(session?.appWaitSeconds),
      },
      window: {
        started_at_local: formatLocalDateTime(thpWindow.startedAt),
        started_at_iso: jsonTimestamp(thpWindow.startedAt),
        ended_at_local: formatLocalDateTime(thpWindow.endedAt),
        ended_at_iso: jsonTimestamp(thpWindow.endedAt),
        duration_ms: jsonNumber(thpWindow.durationMs),
        duration_text: thpWindow.duration || null,
      },
      averages: {
        dl_mbps: jsonNumber(session?.appDlMbps, 2),
        ul_mbps: jsonNumber(session?.appUlMbps, 2),
      },
      completed_iterations: jsonNumber(session?.appCompletedIterations ?? thpRows.length),
      iterations: buildJsonThpIterations(session),
    },
    voice: {
      monitor_status: voice.voice_monitor_status,
      final_call_state: voice.final_call_state,
      offhook_samples: voice.offhook_samples,
      attempts: voice.attempts,
      connected: voice.connected,
      drops: voice.drops,
      failures: voice.failures,
      remarks: voice.remarks,
    },
    trace: {
      sample_count: samples.length,
      note: "RF/GPS samples are timestamped snapshots. Android may repeat cached RF values for multiple samples; repeated values are not invented by BabyDragon.",
      samples: buildJsonTraceSamples(session),
    },
    limitations: {
      android_rf_availability: "Fields depend on Android version, device chipset, carrier policy, SIM, RAT, and public API exposure.",
      nr_nsa: "NR secondary is reported only when Android exposes it; otherwise it remains not_exposed.",
      speed_tests: "Native HTTP/FTP/iPerf/OOKLA/FCC sources produce different KPI sets. Missing fields must remain null, not guessed.",
    },
  }, null, 2);
}

function buildReportPackage({ session, user, activeTask }) {
  const generatedAt = Date.now();
  const baseName = buildProfessionalReportName(session, activeTask);
  const sessionId = cleanFilePart(baseName, `bd-rf-${generatedAt}`);
  return {
    sessionId,
    displayName: baseName,
    generatedAt,
    files: [
      { fileName: `${baseName}_Summary.csv`, reportLabel: "Summary CSV", mimeType: "text/csv", content: buildSummaryCsv(session, user, activeTask) },
      { fileName: `${baseName}_RF_GPS_Trace.csv`, reportLabel: "RF/GPS Trace CSV", mimeType: "text/csv", content: buildTraceCsv(session) },
      { fileName: `${baseName}_THP_Iterations.csv`, reportLabel: "THP Iterations CSV", mimeType: "text/csv", content: buildThpCsv(session) },
      { fileName: `${baseName}_Voice_KPIs.csv`, reportLabel: "Voice KPI CSV", mimeType: "text/csv", content: buildVoiceCsv(session, activeTask) },
      { fileName: `${baseName}_Report.json`, reportLabel: "FCC-style JSON", mimeType: "application/json", content: buildJsonReport(session, user, activeTask, baseName, generatedAt) },
    ],
  };
}

function downloadTextFile(file) {
  if (typeof document === "undefined") return;
  const blob = new Blob([file.content || ""], { type: `${file.mimeType || "text/plain"};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.fileName || "babydragon_report.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function saveReportPackage(reportPackage) {
  if (typeof BabyDragonRfKpi.saveReportFiles === "function") {
    const response = await BabyDragonRfKpi.saveReportFiles(reportPackage);
    if (response?.ok) return response;
    throw new Error(response?.message || response?.status || "Native report save failed.");
  }

  reportPackage.files.forEach(downloadTextFile);
  return {
    ok: true,
    fallback: true,
    message: "Report files downloaded by browser fallback.",
    savedFiles: reportPackage.files.map((file) => ({ fileName: file.fileName, path: "browser-download" })),
  };
}


function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

function displayValue(value, suffix = "") {
  if (value === null || value === undefined || value === "") return "N/A";
  if (typeof value === "number" && !Number.isFinite(value)) return "N/A";
  if (typeof value === "number" && !Number.isInteger(value)) return `${value.toFixed(1)}${suffix}`;
  return `${value}${suffix}`;
}

function cleanSource(source) {
  const value = String(source || "").trim();
  if (!value) return "";
  if (value.toLowerCase().includes("signalstrength")) return "SignalStrength";
  if (value.toLowerCase().includes("cellinfo")) return "CellInfo";
  return value;
}

function displayWithSource(value, source) {
  const shown = displayValue(value);
  if (shown === "N/A") return "N/A";
  const shortSource = cleanSource(source);
  return shortSource ? `${shown} · ${shortSource}` : shown;
}

function getNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return null;
}

function getServing(snapshot) {
  return isObject(snapshot?.serving) ? snapshot.serving : {};
}

function getLteAnchor(snapshot) {
  if (isObject(snapshot?.lteAnchor)) return snapshot.lteAnchor;
  const serving = getServing(snapshot);
  return String(serving.rat || "").toUpperCase() === "LTE" ? serving : {};
}

function getNrSecondary(snapshot) {
  if (isObject(snapshot?.nrSecondary)) return snapshot.nrSecondary;
  const serving = getServing(snapshot);
  return String(serving.rat || "").toUpperCase() === "NR" ? serving : {};
}

function getThreeGServing(snapshot) {
  if (isObject(snapshot?.threeGServing)) return snapshot.threeGServing;
  const serving = getServing(snapshot);
  const rat = String(serving.rat || "").toUpperCase();
  return rat === "WCDMA" || rat === "CDMA" ? serving : {};
}

function getTwoGServing(snapshot) {
  if (isObject(snapshot?.twoGServing)) return snapshot.twoGServing;
  const serving = getServing(snapshot);
  return String(serving.rat || "").toUpperCase() === "GSM" ? serving : {};
}

function getCurrentRatName(snapshot) {
  return (
    snapshot?.currentRatName ||
    getServing(snapshot).technology ||
    snapshot?.dataNetworkTypeName ||
    "Waiting for Android"
  );
}

function hasLteOrNr(snapshot) {
  const servingRat = String(getServing(snapshot).rat || "").toUpperCase();
  const dataName = String(snapshot?.dataNetworkTypeName || "").toUpperCase();
  return (
    isObject(getLteAnchor(snapshot)) ||
    isObject(getNrSecondary(snapshot)) ||
    servingRat === "LTE" ||
    servingRat === "NR" ||
    dataName.includes("LTE") ||
    dataName.includes("NR") ||
    dataName.includes("5G")
  );
}

function getRatKeyFromSnapshot(snapshot) {
  if (hasLteOrNr(snapshot)) return "nrLte";
  const rat = String(getServing(snapshot).rat || "").toUpperCase();
  if (rat === "WCDMA" || rat === "CDMA") return "wcdma";
  if (rat === "GSM") return "gsm";

  const dataName = String(snapshot?.dataNetworkTypeName || "").toUpperCase();
  if (dataName.includes("HSPA") || dataName.includes("UMTS") || dataName.includes("CDMA") || dataName.includes("EVDO")) return "wcdma";
  if (dataName.includes("GSM") || dataName.includes("EDGE") || dataName.includes("GPRS")) return "gsm";
  return "auto";
}

function isRatFamilyActive(selectedRatKey, snapshot) {
  if (selectedRatKey === "auto") return true;
  if (!snapshot?.ok) return false;
  if (selectedRatKey === "nrLte") return hasLteOrNr(snapshot);
  if (selectedRatKey === "wcdma") return isObject(getThreeGServing(snapshot));
  if (selectedRatKey === "gsm") return isObject(getTwoGServing(snapshot));
  return false;
}

function getCellForRow(row, snapshot) {
  const group = String(row.group || "").toLowerCase();
  if (group.includes("lte")) return getLteAnchor(snapshot);
  if (group.includes("nr")) return getNrSecondary(snapshot);
  if (group.includes("3g")) return getThreeGServing(snapshot);
  if (group.includes("2g")) return getTwoGServing(snapshot);
  return getServing(snapshot);
}

function missingTextForRow(row, snapshot, selectedRatKey) {
  const group = String(row.group || "").toLowerCase();
  const currentTech = getCurrentRatName(snapshot);

  if (group.includes("nr")) return snapshot?.nrSecondaryMessage || "NR secondary not exposed by Android/device/carrier.";
  if (group.includes("lte")) return snapshot?.lteAnchorMessage || "LTE anchor not exposed by Android/device/carrier.";
  if (selectedRatKey === "wcdma") return `3G not active · current ${currentTech}`;
  if (selectedRatKey === "gsm") return `2G not active · current ${currentTech}`;
  return "N/A";
}

function getMetricValue(row, snapshot) {
  const group = String(row.group || "").toLowerCase();
  const kpi = String(row.kpi || "").toLowerCase();
  const cell = getCellForRow(row, snapshot);

  if (!isObject(cell)) return null;

  if (row.metric === "lteRsrp") return getNumber(cell.rsrp ?? cell.dbm);
  if (row.metric === "lteRsrq") return getNumber(cell.rsrq);
  if (row.metric === "lteSinr") return getNumber(cell.sinr ?? cell.rssnr);
  if (row.metric === "lteRssi") return getNumber(cell.rssi ?? cell.dbm);
  if (row.metric === "nrRsrp") return getNumber(cell.ssRsrp ?? cell.rsrp);
  if (row.metric === "nrRsrq") return getNumber(cell.ssRsrq ?? cell.rsrq);
  if (row.metric === "nrSinr") return getNumber(cell.ssSinr ?? cell.sinr);
  if (row.metric === "threeGRscp") return getNumber(cell.rscp ?? cell.dbm);
  if (row.metric === "threeGEcno") return getNumber(cell.ecno);
  if (row.metric === "threeGRssi") return getNumber(cell.rssi ?? cell.dbm);
  if (row.metric === "twoGRssi") return getNumber(cell.rxlev ?? cell.rssi ?? cell.dbm);
  if (row.metric === "twoGBer") return getNumber(cell.ber);
  if (row.metric === "twoGTimingAdvance") return getNumber(cell.timingAdvance);

  if (kpi.includes("rsrp") || kpi.includes("rscp")) return getNumber(cell.rsrp ?? cell.ssRsrp ?? cell.rscp ?? cell.dbm ?? cell.rssi ?? cell.rxlev);
  if (kpi.includes("rsrq") || kpi.includes("ecno") || kpi.includes("ec/no")) return getNumber(cell.rsrq ?? cell.ssRsrq ?? cell.ecno);
  if (kpi.includes("sinr")) return getNumber(cell.ssSinr ?? cell.sinr ?? cell.rssnr);
  if (kpi.includes("rssi") || kpi.includes("rxlev")) return getNumber(cell.rssi ?? cell.rxlev ?? cell.dbm);
  if (kpi.includes("ber")) return getNumber(cell.ber);
  if (kpi.includes("timing")) return getNumber(cell.timingAdvance);
  if (group.includes("voice") || group.includes("data")) return null;
  return null;
}

function formatIdentityParts(parts) {
  const cleaned = parts.filter(Boolean);
  return cleaned.length ? cleaned.join(" / ") : "N/A";
}

function getIdentityLive(row, snapshot, selectedRatKey, activeFamily) {
  const cell = getCellForRow(row, snapshot);
  const kpi = String(row.kpi || "").toLowerCase();
  const group = String(row.group || "").toLowerCase();

  if (!activeFamily) return missingTextForRow(row, snapshot, selectedRatKey);
  if (!isObject(cell)) return missingTextForRow(row, snapshot, selectedRatKey);

  if (cell.measurementOnly && (kpi.includes("pci") || kpi.includes("cell") || kpi.includes("nci") || kpi.includes("earfcn") || kpi.includes("arfcn") || kpi.includes("tac") || kpi.includes("lac"))) {
    return "RF exposed · identity N/A";
  }

  if (kpi.includes("current rat")) return getCurrentRatName(snapshot);
  if (kpi.includes("technology")) return cell.technology || getCurrentRatName(snapshot);

  if (group.includes("lte") && kpi.includes("pci")) {
    return formatIdentityParts([
      cell.pci !== undefined ? String(cell.pci) : "",
      cell.earfcn !== undefined ? String(cell.earfcn) : cell.channel !== undefined ? String(cell.channel) : "",
      cell.tac !== undefined ? String(cell.tac) : "",
    ]);
  }

  if (group.includes("nr") && kpi.includes("pci")) {
    return formatIdentityParts([
      cell.pci !== undefined ? String(cell.pci) : "",
      cell.nrarfcn !== undefined ? String(cell.nrarfcn) : cell.channel !== undefined ? String(cell.channel) : "",
      cell.tac !== undefined ? String(cell.tac) : "",
    ]);
  }

  if (group.includes("3g") && kpi.includes("uarfcn")) {
    return formatIdentityParts([
      cell.uarfcn !== undefined ? String(cell.uarfcn) : cell.channel !== undefined ? String(cell.channel) : "",
      cell.psc !== undefined ? String(cell.psc) : "",
    ]);
  }

  if (group.includes("2g") && kpi.includes("arfcn")) {
    return formatIdentityParts([
      cell.arfcn !== undefined ? String(cell.arfcn) : cell.channel !== undefined ? String(cell.channel) : "",
      cell.bsic !== undefined ? String(cell.bsic) : "",
    ]);
  }

  if (kpi.includes("cell id") || kpi.includes("nci") || kpi.includes("lac")) {
    if (group.includes("2g") || group.includes("3g")) {
      return formatIdentityParts([
        cell.lac !== undefined ? String(cell.lac) : "",
        cell.cellId !== undefined ? String(cell.cellId) : "",
      ]);
    }
    return formatIdentityParts([
      cell.cellId !== undefined ? String(cell.cellId) : "",
      cell.nci !== undefined ? String(cell.nci) : "",
    ]);
  }

  return "N/A";
}

function getLiveForRow(row, snapshot, selectedRatKey = "auto", activeFamily = true, dataContext = {}) {
  const kpi = String(row.kpi || "").toLowerCase();
  const group = String(row.group || "").toLowerCase();

  if (row.dataMetric) return formatThroughputLive(row.dataMetric, dataContext);

  if (!snapshot) return "N/A";

  if (group.includes("current") || kpi.includes("current rat")) {
    return getCurrentRatName(snapshot);
  }

  if (!activeFamily) {
    return missingTextForRow(row, snapshot, selectedRatKey);
  }

  if (row.planned || group.includes("data")) return "N/A";

  if (group.includes("voice") || kpi.includes("call state") || kpi.includes("volte") || kpi.includes("vonr")) {
    return snapshot?.callState || "N/A";
  }

  if (kpi.includes("pci") || kpi.includes("cell") || kpi.includes("nci") || kpi.includes("technology") || kpi.includes("earfcn") || kpi.includes("arfcn") || kpi.includes("lac")) {
    return getIdentityLive(row, snapshot, selectedRatKey, activeFamily);
  }

  const value = getMetricValue(row, snapshot);
  const cell = getCellForRow(row, snapshot);
  if (kpi.includes("sinr")) return displayWithSource(value, cell?.sinrSource);
  return displayValue(value);
}

function averageForRow(row, samples, snapshot, activeFamily = true, dataContext = {}) {
  if (row.dataMetric) {
    const value = pickThroughputValue(row.dataMetric, dataContext);
    return value === null ? "N/A" : formatThroughputValue(value);
  }
  if (!activeFamily || row.avgMode === "none" || row.planned) return "N/A";

  const pool = samples && samples.length ? samples : snapshot ? [{ snapshot }] : [];
  const values = pool
    .map((sample) => getMetricValue(row, sample.snapshot))
    .filter((value) => typeof value === "number" && Number.isFinite(value));

  if (!values.length) return "N/A";
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Number.isInteger(avg) ? String(avg) : avg.toFixed(1);
}

function statusForRow(row, snapshot, selectedRatKey = "auto", activeFamily = true, dataContext = {}) {
  if (row.dataMetric) return throughputStatus(row.dataMetric, dataContext);
  if (!snapshot) return "Pending";
  if (snapshot.status === "missing_location_permission") return "Need GPS";
  if (snapshot.status === "security_exception" || snapshot.status === "collector_exception") return "Check";
  if (!snapshot.ok) return "Waiting";

  const group = String(row.group || "").toLowerCase();
  const cell = getCellForRow(row, snapshot);

  if (!activeFamily) return "Inactive";
  if (row.planned) return "Planned";
  if (group.includes("current")) return "Live";

  if ((group.includes("lte") || group.includes("nr") || group.includes("3g") || group.includes("2g")) && !isObject(cell)) {
    return "Not exposed";
  }

  if (cell?.measurementOnly && (row.avgMode === "none" || String(row.kpi || "").toLowerCase().includes("pci") || String(row.kpi || "").toLowerCase().includes("cell") || String(row.kpi || "").toLowerCase().includes("nci"))) {
    return "Identity N/A";
  }

  const live = getLiveForRow(row, snapshot, selectedRatKey, activeFamily);
  const kpi = String(row.kpi || "").toLowerCase();
  if (kpi.includes("sinr") && (!live || live === "N/A")) {
    if (snapshot?.permissions?.readPhoneState === false || snapshot?.signalStrength?.status === "read_phone_state_permission_needed") return "Phone perm";
    if (snapshot?.signalStrength?.ok === false) return "No SINR";
  }
  if (cell?.measurementOnly && live && live !== "N/A" && !String(live).includes("identity N/A")) return "Meas only";
  return live && live !== "N/A" ? "Live" : "N/A";
}

function enrichRows(rows, snapshot, samples, selectedRatKey = "auto", dataContext = {}) {
  const activeFamily = isRatFamilyActive(selectedRatKey, snapshot);
  return rows.map((row) => ({
    ...row,
    live: getLiveForRow(row, snapshot, selectedRatKey, activeFamily, dataContext),
    avg: averageForRow(row, samples, snapshot, activeFamily, dataContext),
    status: statusForRow(row, snapshot, selectedRatKey, activeFamily, dataContext),
  }));
}

function formatGps(point) {
  if (!point?.lat || !point?.lng) return "No GPS";
  return `${Number(point.lat).toFixed(5)}, ${Number(point.lng).toFixed(5)}`;
}

function getActiveTask(tasks = []) {
  const list = Array.isArray(tasks) ? tasks : [];
  return list[0] || null;
}

function getTaskLabel(task) {
  if (!task) return "No active task";
  return (
    task.task_name ||
    task.title ||
    task.name ||
    task.grid_name ||
    task.gridName ||
    task.project_name ||
    "Active field task"
  );
}

function isUuidLike(value) {
  const text = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text);
}

function cleanTaskText(value) {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  if (!text || text.toLowerCase() === "null" || text.toLowerCase() === "undefined") return "";
  return text;
}

function getNameFromObject(value) {
  if (!value || typeof value !== "object") return "";
  return (
    cleanTaskText(value.grid_name) ||
    cleanTaskText(value.gridName) ||
    cleanTaskText(value.name) ||
    cleanTaskText(value.grid_code) ||
    cleanTaskText(value.gridCode) ||
    cleanTaskText(value.title) ||
    cleanTaskText(value.label)
  );
}

function joinGridList(list) {
  if (!Array.isArray(list)) return "";
  const names = list
    .map((item) => (typeof item === "string" ? cleanTaskText(item) : getNameFromObject(item)))
    .filter(Boolean)
    .filter((item) => !isUuidLike(item));
  return names.slice(0, 3).join(", ");
}

function inferGridFromTaskLabel(label) {
  const text = cleanTaskText(label);
  if (!text) return "";
  const parts = text.split(" - ").map((part) => part.trim()).filter(Boolean);
  const last = parts[parts.length - 1] || "";
  if (/^[A-Z0-9]+(?:[-_][A-Z0-9]+)+$/i.test(last)) return last.replace(/_/g, "-");
  const match = text.match(/\b[A-Z]{2,}[A-Z0-9]*[-_][A-Z0-9]+(?:[-_][A-Z0-9]+)?\b/i);
  return match ? match[0].replace(/_/g, "-") : "";
}

function getTaskGridInternalId(task) {
  if (!task) return "";
  return cleanTaskText(task.grid_id || task.gridId || task.assigned_grid_id || task.assignedGridId || task.selected_grid_id || task.selectedGridId);
}

function getTaskGrid(task) {
  if (!task) return "Grid pending";

  const readable = [
    task.grid_name,
    task.gridName,
    task.assigned_grid_name,
    task.assignedGridName,
    task.assigned_grid,
    task.grid_code,
    task.gridCode,
    task.grid_label,
    task.gridLabel,
    task.route_grid_name,
    task.routeGridName,
    task.selected_grid_name,
    task.selectedGridName,
    getNameFromObject(task.grid),
    getNameFromObject(task.assignedGrid),
    getNameFromObject(task.selectedGrid),
    joinGridList(task.grids),
    joinGridList(task.assigned_grids),
    joinGridList(task.task_grids),
  ]
    .map(cleanTaskText)
    .find((item) => item && !isUuidLike(item));

  if (readable) return readable;

  const inferred = inferGridFromTaskLabel(getTaskLabel(task));
  if (inferred) return inferred;

  const rawId = getTaskGridInternalId(task);
  if (rawId && isUuidLike(rawId)) return `Grid assigned ID ${rawId.slice(0, 8)}`;
  if (rawId) return rawId;
  return "Grid pending";
}

function describeRfSource(snapshot) {
  const signal = snapshot?.signalStrength || {};
  const permissions = snapshot?.permissions || {};
  if (signal.ok) {
    if (signal.rawParseUsed) return "CellInfo + SignalStrength + raw text";
    return "CellInfo + SignalStrength";
  }
  if (permissions.readPhoneState === false || signal.status === "read_phone_state_permission_needed") {
    return "CellInfo only · phone permission needed";
  }
  if (signal.status) return `CellInfo only · ${String(signal.status).replace(/_/g, " ")}`;
  return "CellInfo only";
}

function getStatusLabel(testState, selectedMode) {
  if (testState === "recording") return `${selectedMode === "voice" ? "Voice" : "Data"} armed`;
  if (testState === "paused") return "Saved locally";
  return "Ready";
}

function formatTime(timestamp) {
  if (!timestamp) return "Waiting";
  try {
    return new Date(timestamp).toLocaleTimeString();
  } catch (error) {
    return "Waiting";
  }
}

function describeLteAnchor(snapshot) {
  const cell = getLteAnchor(snapshot);
  if (!isObject(cell)) return snapshot?.lteAnchorMessage || "LTE anchor not exposed yet.";
  return formatIdentityParts([
    cell.technology || "4G LTE",
    cell.pci !== undefined ? `PCI ${cell.pci}` : "",
    cell.earfcn !== undefined ? `EARFCN ${cell.earfcn}` : "",
    cell.tac !== undefined ? `TAC ${cell.tac}` : "",
    cell.rsrp !== undefined ? `RSRP ${cell.rsrp}` : "",
    cell.sinr !== undefined ? `SINR ${displayValue(cell.sinr)}` : "",
  ]);
}

function describeNrSecondary(snapshot) {
  const cell = getNrSecondary(snapshot);
  if (!isObject(cell)) return snapshot?.nrSecondaryMessage || "NR secondary not exposed yet.";
  if (cell.measurementOnly) {
    return formatIdentityParts([
      "RF measurement exposed",
      "identity N/A",
      cell.ssRsrp !== undefined || cell.rsrp !== undefined ? `SS-RSRP ${cell.ssRsrp ?? cell.rsrp}` : "",
      cell.ssSinr !== undefined || cell.sinr !== undefined ? `SS-SINR ${displayValue(cell.ssSinr ?? cell.sinr)}` : "",
    ]);
  }
  return formatIdentityParts([
    cell.technology || "5G NR",
    cell.pci !== undefined ? `PCI ${cell.pci}` : "",
    cell.nrarfcn !== undefined ? `NRARFCN ${cell.nrarfcn}` : "",
    cell.tac !== undefined ? `TAC ${cell.tac}` : "",
    cell.ssRsrp !== undefined || cell.rsrp !== undefined ? `SS-RSRP ${cell.ssRsrp ?? cell.rsrp}` : "",
    cell.ssSinr !== undefined || cell.sinr !== undefined ? `SS-SINR ${displayValue(cell.ssSinr ?? cell.sinr)}` : "",
  ]);
}

function getCardStatus(snapshot, type) {
  if (!snapshot?.ok) return "waiting";
  if (type === "current") return "live";
  if (type === "lte") return isObject(getLteAnchor(snapshot)) ? "live" : "not-exposed";
  if (type === "nr") {
    const cell = getNrSecondary(snapshot);
    if (!isObject(cell)) return "not-exposed";
    return cell.measurementOnly ? "measurement-only" : "live";
  }
  return "waiting";
}

function RfCellCard({ title, status, children }) {
  const cleanStatus = String(status || "waiting").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const label = cleanStatus === "measurement-only" ? "MEAS ONLY" : cleanStatus.replace(/-/g, " ");
  return (
    <article className={`bd-rf-cell-card ${cleanStatus}`}>
      <header>
        <b>{title}</b>
        <em>{label}</em>
      </header>
      <span>{children}</span>
    </article>
  );
}

function normalizeGps(point) {
  const lat = getNumber(point?.lat ?? point?.latitude);
  const lng = getNumber(point?.lng ?? point?.longitude ?? point?.lon);
  if (lat === null || lng === null) return null;
  return {
    lat,
    lng,
    accuracy: getNumber(point?.accuracy),
    speed: getNumber(point?.speed),
    heading: getNumber(point?.heading),
    timestamp: point?.timestamp || point?.time || Date.now(),
  };
}

function buildRfSample({ snapshot, now, gps, session, mode, recording }) {
  return {
    id: `${now}-${Math.random().toString(16).slice(2, 8)}`,
    timestamp: now,
    isoTime: new Date(now).toISOString(),
    mode,
    sessionId: session?.id || null,
    recorded: Boolean(recording),
    gps: normalizeGps(gps),
    snapshot,
  };
}

function metricFromSnapshot(snapshot, metric) {
  const lte = getLteAnchor(snapshot);
  const nr = getNrSecondary(snapshot);
  const threeG = getThreeGServing(snapshot);
  const twoG = getTwoGServing(snapshot);

  if (metric === "lteRsrp") return getNumber(lte.rsrp ?? lte.dbm);
  if (metric === "lteRsrq") return getNumber(lte.rsrq);
  if (metric === "lteSinr") return getNumber(lte.sinr ?? lte.rssnr);
  if (metric === "lteRssi") return getNumber(lte.rssi ?? lte.dbm);
  if (metric === "nrRsrp") return getNumber(nr.ssRsrp ?? nr.rsrp);
  if (metric === "nrRsrq") return getNumber(nr.ssRsrq ?? nr.rsrq);
  if (metric === "nrSinr") return getNumber(nr.ssSinr ?? nr.sinr);
  if (metric === "threeGRscp") return getNumber(threeG.rscp ?? threeG.dbm);
  if (metric === "threeGEcno") return getNumber(threeG.ecno);
  if (metric === "twoGRssi") return getNumber(twoG.rxlev ?? twoG.rssi ?? twoG.dbm);
  return null;
}

function averageMetric(samples, metric) {
  let values = (samples || [])
    .map((sample) => metricFromSnapshot(sample.snapshot, metric))
    .filter((value) => typeof value === "number" && Number.isFinite(value));

  // Some Android builds intermittently report LTE RSSNR as 0 while the public
  // SignalStrength path exposes a decimal SINR around the same time. For SINR
  // summaries, avoid letting those brief zero placeholders flatten a valid trace.
  if (String(metric || "").toLowerCase().includes("sinr")) {
    const nonZeroValues = values.filter((value) => Math.abs(value) > 0.0001);
    if (nonZeroValues.length >= 2) values = nonZeroValues;
  }

  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatNumber(value, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  return Number.isInteger(value) ? String(value) : value.toFixed(digits);
}
function formatMetric(value, unit = "", digits = 1) {
  const shown = formatNumber(value, digits);
  return shown === "N/A" ? "N/A" : `${shown}${unit ? ` ${unit}` : ""}`;
}

function metricStats(samples, metric) {
  let values = (samples || [])
    .map((sample) => metricFromSnapshot(sample.snapshot, metric))
    .filter((value) => typeof value === "number" && Number.isFinite(value));

  if (String(metric || "").toLowerCase().includes("sinr")) {
    const nonZeroValues = values.filter((value) => Math.abs(value) > 0.0001);
    if (nonZeroValues.length >= 2) values = nonZeroValues;
  }

  if (!values.length) return { count: 0, avg: null, min: null, max: null };
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    count: values.length,
    avg,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}


function formatDuration(ms) {
  if (!ms || ms < 0) return "00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function buildSessionSummary({ session, samples, endedAt, mode, taskLabel, grid, appTest }) {
  const list = Array.isArray(samples) ? samples : [];
  const first = list[0];
  const last = list[list.length - 1];
  const start = session?.startedAt || first?.timestamp || endedAt;
  const end = endedAt || last?.timestamp || Date.now();
  const gpsCount = list.filter((sample) => sample.gps?.lat && sample.gps?.lng).length;
  const lastSnapshot = last?.snapshot || {};

  const lteRsrpStats = metricStats(list, "lteRsrp");
  const lteRsrqStats = metricStats(list, "lteRsrq");
  const lteSinrStats = metricStats(list, "lteSinr");
  const lteRssiStats = metricStats(list, "lteRssi");
  const nrRsrpStats = metricStats(list, "nrRsrp");
  const nrSinrStats = metricStats(list, "nrSinr");
  const threeGRscpStats = metricStats(list, "threeGRscp");
  const threeGEcnoStats = metricStats(list, "threeGEcno");
  const threeGRssiStats = metricStats(list, "threeGRssi");
  const twoGRssiStats = metricStats(list, "twoGRssi");
  const twoGBerStats = metricStats(list, "twoGBer");
  const twoGTimingAdvanceStats = metricStats(list, "twoGTimingAdvance");
  const appSource = appTest || session?.appTest || {};
  const appIterationResults = Array.isArray(appSource.iterationResults) ? appSource.iterationResults : [];
  const appDlMbps = getNumber(appSource.dlMbps);
  const appUlMbps = getNumber(appSource.ulMbps);
  const appIterationsRequested = clampInteger(appSource.iterationsRequested || appSource.iterations || DEFAULT_THP_ITERATIONS, 1, MAX_THP_ITERATIONS, DEFAULT_THP_ITERATIONS);
  const appCompletedIterations = clampInteger(appSource.completedIterations || appIterationResults.length || 0, 0, MAX_THP_ITERATIONS, 0);
  const appWaitSeconds = clampInteger(appSource.waitSeconds ?? DEFAULT_THP_WAIT_SECONDS, 0, MAX_THP_WAIT_SECONDS, DEFAULT_THP_WAIT_SECONDS);
  const appDurationSeconds = clampInteger(appSource.durationSeconds ?? DEFAULT_THP_DURATION_SECONDS, 1, MAX_THP_DURATION_SECONDS, DEFAULT_THP_DURATION_SECONDS);
  const appIntervalSeconds = clampInteger(appSource.intervalSeconds ?? DEFAULT_THP_INTERVAL_SECONDS, 1, MAX_THP_INTERVAL_SECONDS, DEFAULT_THP_INTERVAL_SECONDS);
  const appDirection = appSource.direction || DEFAULT_DATA_DIRECTION;

  return {
    id: session?.id || `bd-rf-${start}`,
    mode: session?.mode || mode || "data",
    taskLabel: session?.taskLabel || taskLabel || "Active field task",
    grid: session?.grid || grid || "Grid pending",
    startedAt: start,
    endedAt: end,
    durationMs: Math.max(0, end - start),
    sampleCount: list.length,
    gpsCount,
    rat: getCurrentRatName(lastSnapshot),
    avgLteRsrp: lteRsrpStats.avg,
    avgLteRsrq: lteRsrqStats.avg,
    avgLteSinr: lteSinrStats.avg,
    avgLteRssi: lteRssiStats.avg,
    avgNrRsrp: nrRsrpStats.avg,
    avgNrSinr: nrSinrStats.avg,
    avgThreeGRscp: threeGRscpStats.avg,
    avgThreeGEcno: threeGEcnoStats.avg,
    avgThreeGRssi: threeGRssiStats.avg,
    avgTwoGRssi: twoGRssiStats.avg,
    avgTwoGBer: twoGBerStats.avg,
    avgTwoGTimingAdvance: twoGTimingAdvanceStats.avg,
    appDlMbps,
    appUlMbps,
    appDownloadBytes: appSource.downloadBytes || 0,
    appUploadBytes: appSource.uploadBytes || 0,
    appIterationsRequested,
    appCompletedIterations,
    appWaitSeconds,
    appDurationSeconds,
    appIntervalSeconds,
    appDirection,
    appIterationResults,
    appTestStatus: appSource.status || "idle",
    appTestPhase: appSource.phase || "idle",
    appTestMessage: appSource.message || "Internal DL/UL test ready.",
    appTestError: appSource.error || "",
    stats: {
      lteRsrp: lteRsrpStats,
      lteRsrq: lteRsrqStats,
      lteSinr: lteSinrStats,
      lteRssi: lteRssiStats,
      nrRsrp: nrRsrpStats,
      nrSinr: nrSinrStats,
      threeGRscp: threeGRscpStats,
      threeGEcno: threeGEcnoStats,
      threeGRssi: threeGRssiStats,
      twoGRssi: twoGRssiStats,
      twoGBer: twoGBerStats,
      twoGTimingAdvance: twoGTimingAdvanceStats,
    },
    firstGps: first?.gps || null,
    lastGps: [...list].reverse().find((sample) => sample.gps)?.gps || null,
    traceSamples: list.slice(-240),
    exportSamples: list,
    frozen: Boolean(session?.endedAt || endedAt),
  };
}

function getSampleRsrp(sample) {
  return metricFromSnapshot(sample?.snapshot, "lteRsrp") ?? metricFromSnapshot(sample?.snapshot, "nrRsrp");
}

function getRsrpQualityClass(rsrp) {
  if (typeof rsrp !== "number" || !Number.isFinite(rsrp)) return "unknown";
  if (rsrp >= -90) return "good";
  if (rsrp >= -105) return "fair";
  return "poor";
}
function getBestTraceSamples({ currentSession, sessionSamples, savedSession, samples }) {
  if (currentSession && sessionSamples.length) return sessionSamples;
  if (savedSession?.traceSamples?.length) return savedSession.traceSamples;
  return (samples || []).slice(-60);
}

function buildTraceMapModel(traceSamples, maxPoints = 80) {
  const gpsSamples = (traceSamples || []).filter((sample) => sample.gps?.lat && sample.gps?.lng);
  const source = gpsSamples.length >= 2 ? gpsSamples : (traceSamples || []).slice(-maxPoints);
  const downsampleStep = Math.max(1, Math.ceil(source.length / maxPoints));
  const trimmed = source.filter((_, index) => index % downsampleStep === 0).slice(-maxPoints);

  const gpsPoints = trimmed
    .map((sample) => ({ sample, gps: sample.gps }))
    .filter((item) => item.gps?.lat && item.gps?.lng);

  const hasRealGps = gpsPoints.length >= 2;
  const latValues = gpsPoints.map((item) => item.gps.lat);
  const lngValues = gpsPoints.map((item) => item.gps.lng);
  const minLat = Math.min(...latValues);
  const maxLat = Math.max(...latValues);
  const minLng = Math.min(...lngValues);
  const maxLng = Math.max(...lngValues);
  const latSpan = Math.max(0.000001, maxLat - minLat);
  const lngSpan = Math.max(0.000001, maxLng - minLng);

  const points = trimmed.map((sample, index) => {
    let x;
    let y;
    if (hasRealGps && sample.gps?.lat && sample.gps?.lng) {
      x = 9 + ((sample.gps.lng - minLng) / lngSpan) * 82;
      y = 90 - ((sample.gps.lat - minLat) / latSpan) * 80;
    } else {
      const ratio = trimmed.length <= 1 ? 0.5 : index / (trimmed.length - 1);
      x = 10 + ratio * 80;
      y = 58 - Math.sin(ratio * Math.PI) * 25 + ((index % 3) - 1) * 3;
    }
    const rsrp = getSampleRsrp(sample);
    const sinr = metricFromSnapshot(sample.snapshot, "lteSinr") ?? metricFromSnapshot(sample.snapshot, "nrSinr");
    return {
      id: sample.id || `${sample.timestamp}-${index}`,
      x: Number.isFinite(x) ? Math.max(4, Math.min(96, x)) : 50,
      y: Number.isFinite(y) ? Math.max(6, Math.min(94, y)) : 50,
      rsrp,
      sinr,
      className: getRsrpQualityClass(rsrp),
      label: `${formatTime(sample.timestamp)} · RSRP ${displayValue(rsrp)} · SINR ${displayValue(sinr)}`,
      sample,
    };
  });

  const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
  const first = points[0] || null;
  const last = points[points.length - 1] || null;

  return {
    points,
    polyline,
    first,
    last,
    hasRealGps,
    displayedCount: points.length,
    totalCount: (traceSamples || []).length,
    gpsCount: gpsSamples.length,
  };
}

function readLatLngFromObject(value) {
  if (!value || typeof value !== "object") return null;
  const lat = getNumber(value.lat ?? value.latitude ?? value.gps_lat ?? value.gpsLatitude ?? value.y);
  const lng = getNumber(value.lng ?? value.lon ?? value.long ?? value.longitude ?? value.gps_lng ?? value.gpsLongitude ?? value.x);
  if (lat === null || lng === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lat, lng];
}

function readLatLngFromArray(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const first = getNumber(value[0]);
  const second = getNumber(value[1]);
  if (first === null || second === null) return null;

  if (Math.abs(first) <= 90 && Math.abs(second) <= 180) return [first, second];
  if (Math.abs(second) <= 90 && Math.abs(first) <= 180) return [second, first];
  return null;
}

function tryParseJson(value) {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text || !(text.startsWith("{") || text.startsWith("["))) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function flattenLatLngs(value, output = []) {
  const parsed = tryParseJson(value);
  if (!parsed) return output;

  const fromObject = readLatLngFromObject(parsed);
  if (fromObject) {
    output.push(fromObject);
    return output;
  }

  const fromArray = readLatLngFromArray(parsed);
  if (fromArray) {
    output.push(fromArray);
    return output;
  }

  if (Array.isArray(parsed)) {
    parsed.forEach((item) => flattenLatLngs(item, output));
    return output;
  }

  if (typeof parsed === "object") {
    if (parsed.type === "Feature") return flattenLatLngs(parsed.geometry, output);
    if (parsed.type === "FeatureCollection") return flattenLatLngs(parsed.features, output);
    if (parsed.type && parsed.coordinates) return flattenLatLngs(parsed.coordinates, output);

    [
      parsed.points,
      parsed.path,
      parsed.route,
      parsed.route_points,
      parsed.routePoints,
      parsed.coordinates,
      parsed.geometry,
      parsed.polygon,
      parsed.boundary,
      parsed.ring,
    ].forEach((candidate) => flattenLatLngs(candidate, output));
  }

  return output;
}

function uniqueLatLngs(points) {
  const seen = new Set();
  return (points || []).filter((point) => {
    if (!Array.isArray(point) || point.length < 2) return false;
    const key = `${Number(point[0]).toFixed(7)},${Number(point[1]).toFixed(7)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getTaskRouteLatLngs(task) {
  if (!task) return [];
  const candidates = [
    task.saved_route_points,
    task.savedRoutePoints,
    task.route_points,
    task.routePoints,
    task.route_geojson,
    task.routeGeojson,
    task.route_geometry,
    task.routeGeometry,
    task.saved_route,
    task.savedRoute,
    task.route,
    task.assigned_route,
    task.assignedRoute,
  ];

  for (const candidate of candidates) {
    const points = uniqueLatLngs(flattenLatLngs(candidate));
    if (points.length >= 2) return points;
  }
  return [];
}

function getTaskGridLatLngs(task) {
  if (!task) return [];
  const candidates = [
    task.grid_polygon,
    task.gridPolygon,
    task.grid_boundary,
    task.gridBoundary,
    task.grid_geojson,
    task.gridGeojson,
    task.polygon,
    task.boundary,
    task.grid?.polygon,
    task.grid?.boundary,
    task.grid?.geojson,
    task.selectedGrid?.polygon,
    task.assignedGrid?.polygon,
  ];

  for (const candidate of candidates) {
    const points = uniqueLatLngs(flattenLatLngs(candidate));
    if (points.length >= 3) return points;
  }
  return [];
}

function getTraceLatLngs(traceSamples, maxPoints = 220) {
  const gpsSamples = (traceSamples || []).filter((sample) => sample.gps?.lat && sample.gps?.lng);
  const step = Math.max(1, Math.ceil(gpsSamples.length / maxPoints));
  return gpsSamples
    .filter((_, index) => index % step === 0)
    .map((sample) => ({
      id: sample.id || `${sample.timestamp}-${sample.gps.lat}-${sample.gps.lng}`,
      position: [Number(sample.gps.lat), Number(sample.gps.lng)],
      rsrp: getSampleRsrp(sample),
      sinr: metricFromSnapshot(sample.snapshot, "lteSinr") ?? metricFromSnapshot(sample.snapshot, "nrSinr"),
      timestamp: sample.timestamp,
    }));
}

function getMapCenter({ tracePoints, routePoints, gridPoints, lastGpsLocation }) {
  const latest = tracePoints?.[tracePoints.length - 1]?.position;
  if (latest) return latest;
  const gps = readLatLngFromObject(lastGpsLocation);
  if (gps) return gps;
  if (routePoints?.length) return routePoints[Math.floor(routePoints.length / 2)];
  if (gridPoints?.length) return gridPoints[0];
  return [33.0433, -96.3018];
}

function getLeafletBounds({ tracePoints, routePoints, gridPoints, lastGpsLocation }) {
  const points = [
    ...(tracePoints || []).map((point) => point.position),
    ...(routePoints || []),
    ...(gridPoints || []),
  ];
  const gps = readLatLngFromObject(lastGpsLocation);
  if (gps) points.push(gps);
  return points.filter((point) => Array.isArray(point) && point.length >= 2);
}

function FitRfMapBounds({ bounds }) {
  const map = useMap();
  useEffect(() => {
    if (!bounds?.length) return;
    window.setTimeout(() => map.invalidateSize(), 80);
    if (bounds.length === 1) {
      map.setView(bounds[0], 17, { animate: true });
      return;
    }
    map.fitBounds(bounds, { padding: [18, 18], maxZoom: 18, animate: true });
  }, [map, JSON.stringify(bounds || [])]);
  return null;
}

function qualityColor(className) {
  if (className === "good") return "#22c55e";
  if (className === "fair") return "#f59e0b";
  if (className === "poor") return "#ef4444";
  return "#94a3b8";
}

function RfLeafletSessionMap({ traceSamples, traceMap, activeTask, lastGpsLocation }) {
  const tracePoints = useMemo(() => getTraceLatLngs(traceSamples, 220), [traceSamples]);
  const routePoints = useMemo(() => getTaskRouteLatLngs(activeTask), [activeTask]);
  const gridPoints = useMemo(() => getTaskGridLatLngs(activeTask), [activeTask]);
  const center = useMemo(
    () => getMapCenter({ tracePoints, routePoints, gridPoints, lastGpsLocation }),
    [tracePoints, routePoints, gridPoints, lastGpsLocation]
  );
  const bounds = useMemo(
    () => getLeafletBounds({ tracePoints, routePoints, gridPoints, lastGpsLocation }),
    [tracePoints, routePoints, gridPoints, lastGpsLocation]
  );
  const gps = readLatLngFromObject(lastGpsLocation);
  const traceLine = tracePoints.map((point) => point.position);
  const firstTrace = tracePoints[0];
  const lastTrace = tracePoints[tracePoints.length - 1];

  return (
    <div className="bd-rf-leaflet-shell">
      <MapContainer
        className="bd-rf-leaflet-map"
        center={center}
        zoom={17}
        zoomControl
        scrollWheelZoom={false}
        dragging
        doubleClickZoom
      >
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitRfMapBounds bounds={bounds} />

        {gridPoints.length >= 3 && (
          <Polygon
            positions={gridPoints}
            pathOptions={{ color: "#facc15", fillColor: "#facc15", fillOpacity: 0.14, weight: 2 }}
          />
        )}

        {routePoints.length >= 2 && (
          <Polyline positions={routePoints} pathOptions={{ color: "#2563eb", opacity: 0.95, weight: 5 }} />
        )}

        {traceLine.length >= 2 && (
          <Polyline positions={traceLine} pathOptions={{ color: "#fb923c", opacity: 0.9, weight: 4 }} />
        )}

        {tracePoints.map((point) => {
          const className = getRsrpQualityClass(point.rsrp);
          return (
            <CircleMarker
              key={point.id}
              center={point.position}
              radius={4.5}
              pathOptions={{ color: "#ffffff", weight: 1.4, fillColor: qualityColor(className), fillOpacity: 0.94 }}
            >
              <Tooltip direction="top" opacity={0.95}>
                {formatTime(point.timestamp)} · RSRP {displayValue(point.rsrp)} · SINR {displayValue(point.sinr)}
              </Tooltip>
            </CircleMarker>
          );
        })}

        {firstTrace && (
          <CircleMarker center={firstTrace.position} radius={7} pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#22c55e", fillOpacity: 1 }}>
            <Tooltip permanent direction="right" opacity={0.9}>Start</Tooltip>
          </CircleMarker>
        )}

        {lastTrace && (
          <CircleMarker center={lastTrace.position} radius={7} pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#ef4444", fillOpacity: 1 }}>
            <Tooltip permanent direction="left" opacity={0.9}>End</Tooltip>
          </CircleMarker>
        )}

        {gps && (
          <CircleMarker center={gps} radius={8} pathOptions={{ color: "#0f172a", weight: 2, fillColor: "#38bdf8", fillOpacity: 0.95 }}>
            <Tooltip direction="top" opacity={0.9}>Current GPS</Tooltip>
          </CircleMarker>
        )}
      </MapContainer>

      <div className="bd-rf-leaflet-overlay">
        <span>{traceMap.hasRealGps ? "Live street map" : "Waiting for GPS trace"}</span>
        <strong>{traceMap.gpsCount || tracePoints.length} GPS points · {traceMap.totalCount} samples</strong>
      </div>
    </div>
  );
}

function TraceQualityLegend() {
  return (
    <div className="bd-rf-trace-legend">
      <span><i className="good" />Good</span>
      <span><i className="fair" />Fair</span>
      <span><i className="poor" />Poor</span>
      <span><i className="unknown" />N/A</span>
    </div>
  );
}

function SessionMetricCard({ label, value, unit, min, max, digits = 1 }) {
  return (
    <span>
      <b>{label}</b>
      <strong>{formatMetric(value, unit, digits)}</strong>
      {(typeof min === "number" || typeof max === "number") && (
        <small>Min {formatMetric(min, unit, digits)} · Max {formatMetric(max, unit, digits)}</small>
      )}
    </span>
  );
}

function getSessionRfMetricCards(session) {
  const rat = String(session?.rat || "").toLowerCase();
  const stats = session?.stats || {};

  if (rat.includes("2g") || rat.includes("gsm")) {
    return [
      { label: "Avg RxLev / RSSI", value: session?.avgTwoGRssi, unit: "dBm", min: stats.twoGRssi?.min, max: stats.twoGRssi?.max },
      { label: "Avg BER", value: session?.avgTwoGBer, unit: "", min: stats.twoGBer?.min, max: stats.twoGBer?.max, digits: 1 },
      { label: "Avg Timing Adv", value: session?.avgTwoGTimingAdvance, unit: "symbols", min: stats.twoGTimingAdvance?.min, max: stats.twoGTimingAdvance?.max, digits: 0 },
    ];
  }

  if (rat.includes("3g") || rat.includes("wcdma") || rat.includes("umts")) {
    return [
      { label: "Avg RSCP", value: session?.avgThreeGRscp, unit: "dBm", min: stats.threeGRscp?.min, max: stats.threeGRscp?.max },
      { label: "Avg Ec/No", value: session?.avgThreeGEcno, unit: "dB", min: stats.threeGEcno?.min, max: stats.threeGEcno?.max },
      { label: "Avg RSSI", value: session?.avgThreeGRssi, unit: "dBm", min: stats.threeGRssi?.min, max: stats.threeGRssi?.max },
    ];
  }

  if (rat.includes("5g") || rat.includes("nr")) {
    return [
      { label: "Avg LTE RSRP", value: session?.avgLteRsrp, unit: "dBm", min: stats.lteRsrp?.min, max: stats.lteRsrp?.max },
      { label: "Avg LTE RSRQ", value: session?.avgLteRsrq, unit: "dB", min: stats.lteRsrq?.min, max: stats.lteRsrq?.max },
      { label: "Avg LTE SINR", value: session?.avgLteSinr, unit: "dB", min: stats.lteSinr?.min, max: stats.lteSinr?.max, digits: 2 },
      { label: "Avg NR RSRP", value: session?.avgNrRsrp, unit: "dBm", min: stats.nrRsrp?.min, max: stats.nrRsrp?.max },
      { label: "Avg NR SINR", value: session?.avgNrSinr, unit: "dB", min: stats.nrSinr?.min, max: stats.nrSinr?.max, digits: 2 },
    ];
  }

  return [
    { label: "Avg RSRP", value: session?.avgLteRsrp, unit: "dBm", min: stats.lteRsrp?.min, max: stats.lteRsrp?.max },
    { label: "Avg RSRQ", value: session?.avgLteRsrq, unit: "dB", min: stats.lteRsrq?.min, max: stats.lteRsrq?.max },
    { label: "Avg SINR", value: session?.avgLteSinr, unit: "dB", min: stats.lteSinr?.min, max: stats.lteSinr?.max, digits: 2 },
    { label: "Avg RSSI", value: session?.avgLteRssi, unit: "dBm", min: stats.lteRssi?.min, max: stats.lteRssi?.max },
  ];
}


export default function MobileRfKpi({
  user,
  activeFieldTasks = [],
  inProcessTasks = [],
  lastGpsLocation,
  gpsStatusMessage,
  gpsChecking,
  onRefreshGpsNow,
}) {
  const [selectedMode, setSelectedMode] = useState("data");
  const [testState, setTestState] = useState("idle");
  const [openPanel, setOpenPanel] = useState("none");
  const [ratView, setRatView] = useState("auto");
  const [nativeSnapshot, setNativeSnapshot] = useState(null);
  const [collectorBusy, setCollectorBusy] = useState(false);
  const [collectorRunning, setCollectorRunning] = useState(false);
  const [collectorMessage, setCollectorMessage] = useState("Native collector waiting for first read.");
  const [samples, setSamples] = useState([]);
  const [lastRfReadTime, setLastRfReadTime] = useState(null);
  const [permissionStatus, setPermissionStatus] = useState(null);
  const [currentSession, setCurrentSession] = useState(null);
  const [savedSession, setSavedSession] = useState(null);
  const [dataTest, setDataTest] = useState(makeDataTestIdle());
  const [exportStatus, setExportStatus] = useState("");
  const [exportFiles, setExportFiles] = useState([]);
  const [exportPackageName, setExportPackageName] = useState("");
  const [exportBasePath, setExportBasePath] = useState("");
  const [dataSetupOpen, setDataSetupOpen] = useState(false);
  const [dataTestType, setDataTestType] = useState(DEFAULT_DATA_TEST_TYPE);
  const [dataDirection, setDataDirection] = useState(DEFAULT_DATA_DIRECTION);
  const [thpIterations, setThpIterations] = useState(String(DEFAULT_THP_ITERATIONS));
  const [thpWaitSeconds, setThpWaitSeconds] = useState(String(DEFAULT_THP_WAIT_SECONDS));
  const [thpDurationSeconds, setThpDurationSeconds] = useState(String(DEFAULT_THP_DURATION_SECONDS));
  const [thpIntervalSeconds, setThpIntervalSeconds] = useState(String(DEFAULT_THP_INTERVAL_SECONDS));
  const [nativeDownloadUrl, setNativeDownloadUrl] = useState(DEFAULT_NATIVE_HTTP_SETUP.downloadUrl);
  const [nativeUploadUrl, setNativeUploadUrl] = useState(DEFAULT_NATIVE_HTTP_SETUP.uploadUrl);
  const [ftpSetup, setFtpSetup] = useState({});
  const [iperfSetup, setIperfSetup] = useState({});
  const [ooklaSetup, setOoklaSetup] = useState(DEFAULT_OOKLA_SETUP);
  const [fccSetup, setFccSetup] = useState(DEFAULT_FCC_IMPORT_SETUP);
  const resolvedThpIterations = clampInteger(thpIterations, 1, MAX_THP_ITERATIONS, DEFAULT_THP_ITERATIONS);
  const resolvedThpWaitSeconds = clampInteger(thpWaitSeconds, 0, MAX_THP_WAIT_SECONDS, DEFAULT_THP_WAIT_SECONDS);
  const resolvedThpDurationSeconds = clampInteger(thpDurationSeconds, 1, MAX_THP_DURATION_SECONDS, DEFAULT_THP_DURATION_SECONDS);
  const resolvedThpIntervalSeconds = clampInteger(thpIntervalSeconds, 1, MAX_THP_INTERVAL_SECONDS, DEFAULT_THP_INTERVAL_SECONDS);
  const [clockTick, setClockTick] = useState(Date.now());
  const [rfPollCount, setRfPollCount] = useState(0);
  const permissionRequestStarted = useRef(false);
  const testStateRef = useRef(testState);
  const selectedModeRef = useRef(selectedMode);
  const currentSessionRef = useRef(currentSession);
  const samplesRef = useRef(samples);
  const gpsRef = useRef(lastGpsLocation);
  const dataTestRef = useRef(dataTest);
  const throughputAbortRef = useRef(null);
  const rfReadInFlightRef = useRef(false);

  const activeTask = useMemo(
    () => getActiveTask(inProcessTasks.length ? inProcessTasks : activeFieldTasks),
    [activeFieldTasks, inProcessTasks]
  );

  const activeTaskLabel = useMemo(() => getTaskLabel(activeTask), [activeTask]);
  const activeGrid = useMemo(() => getTaskGrid(activeTask), [activeTask]);
  // Draft setup is used by the setup card so the FE can clear and retype numbers.
  const currentNativeHttpSetup = useMemo(() => ({
    ...DEFAULT_NATIVE_HTTP_SETUP,
    direction: dataDirection,
    iterations: thpIterations,
    waitSeconds: thpWaitSeconds,
    durationSeconds: thpDurationSeconds,
    intervalSeconds: thpIntervalSeconds,
    downloadUrl: nativeDownloadUrl,
    uploadUrl: nativeUploadUrl,
  }), [dataDirection, thpIterations, thpWaitSeconds, thpDurationSeconds, thpIntervalSeconds, nativeDownloadUrl, nativeUploadUrl]);

  // Run setup is resolved/clamped only when BabyDragon actually starts the test.
  const currentNativeHttpRunSetup = useMemo(() => ({
    ...DEFAULT_NATIVE_HTTP_SETUP,
    direction: dataDirection,
    iterations: resolvedThpIterations,
    waitSeconds: resolvedThpWaitSeconds,
    durationSeconds: resolvedThpDurationSeconds,
    intervalSeconds: resolvedThpIntervalSeconds,
    downloadUrl: nativeDownloadUrl?.trim() || DEFAULT_NATIVE_HTTP_SETUP.downloadUrl,
    uploadUrl: nativeUploadUrl?.trim() || DEFAULT_NATIVE_HTTP_SETUP.uploadUrl,
  }), [dataDirection, resolvedThpIterations, resolvedThpWaitSeconds, resolvedThpDurationSeconds, resolvedThpIntervalSeconds, nativeDownloadUrl, nativeUploadUrl]);

  const currentDataTestConfig = useMemo(() => ({
    ...currentNativeHttpRunSetup,
    testType: dataTestType,
    ftp: ftpSetup,
    iperf: iperfSetup,
    ookla: ooklaSetup,
    fcc: fccSetup,
  }), [currentNativeHttpRunSetup, dataTestType, ftpSetup, iperfSetup, ooklaSetup, fccSetup]);
  const modeOptions = selectedMode === "voice" ? VOICE_TEST_OPTIONS : DATA_TEST_OPTIONS;
  const liveRatKey = getRatKeyFromSnapshot(nativeSnapshot);
  const effectiveRatView = ratView === "auto" ? liveRatKey : ratView;
  const baseTableRows = KPI_ROW_SETS[effectiveRatView] || KPI_ROW_SETS.auto;
  const tableRows = useMemo(
    () => enrichRows(baseTableRows, nativeSnapshot, samples, effectiveRatView, { dataTest, savedSession, collectorRunning }),
    [baseTableRows, nativeSnapshot, samples, effectiveRatView, dataTest, savedSession, collectorRunning]
  );
  const hasRunningTask = inProcessTasks.length > 0;
  const servingTechnology = getCurrentRatName(nativeSnapshot);
  const sampleCount = samples.length;
  const sessionSamples = useMemo(() => {
    if (!currentSession) return [];
    return samples.filter((sample) => sample.sessionId === currentSession.id);
  }, [samples, currentSession]);
  const activeSessionSummary = useMemo(() => {
    if (!currentSession) return null;
    return buildSessionSummary({
      session: currentSession,
      samples: sessionSamples,
      endedAt: clockTick,
      mode: selectedMode,
      taskLabel: activeTaskLabel,
      grid: activeGrid,
      appTest: dataTest,
    });
  }, [currentSession, sessionSamples, clockTick, selectedMode, activeTaskLabel, activeGrid, dataTest]);
  const visibleSession = activeSessionSummary || savedSession;
  const exportCandidateSession = savedSession || activeSessionSummary;
  const thpIsRunning = dataTest?.status === "running";
  const canExportSession = Boolean(savedSession && !thpIsRunning && ((savedSession.sampleCount || 0) > 0 || savedSession?.appIterationResults?.length));
  const traceSamples = useMemo(
    () => getBestTraceSamples({ currentSession, sessionSamples, savedSession, samples }),
    [currentSession, sessionSamples, savedSession, samples]
  );
  const traceMap = useMemo(() => buildTraceMapModel(traceSamples, 80), [traceSamples]);
  const thpIterationRows = dataTest.iterationResults?.length ? dataTest.iterationResults : (visibleSession?.appIterationResults || []);

  useEffect(() => {
    testStateRef.current = testState;
  }, [testState]);

  useEffect(() => {
    selectedModeRef.current = selectedMode;
  }, [selectedMode]);

  useEffect(() => {
    currentSessionRef.current = currentSession;
  }, [currentSession]);

  useEffect(() => {
    samplesRef.current = samples;
  }, [samples]);

  useEffect(() => {
    dataTestRef.current = dataTest;
  }, [dataTest]);

  useEffect(() => {
    gpsRef.current = lastGpsLocation;
  }, [lastGpsLocation]);

  useEffect(() => {
    if (!collectorRunning) return undefined;
    const timer = window.setInterval(() => setClockTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [collectorRunning]);



  function handleNativeHttpSetupChange(nextSetup) {
    const setup = { ...DEFAULT_NATIVE_HTTP_SETUP, ...(nextSetup || {}) };
    setDataDirection(setup.direction || DEFAULT_DATA_DIRECTION);
    setThpIterations(cleanIntegerDraft(String(setup.iterations ?? ""), 2));
    setThpWaitSeconds(cleanIntegerDraft(String(setup.waitSeconds ?? ""), 3));
    setThpDurationSeconds(cleanIntegerDraft(String(setup.durationSeconds ?? ""), 3));
    setThpIntervalSeconds(cleanIntegerDraft(String(setup.intervalSeconds ?? ""), 2));
    setNativeDownloadUrl(setup.downloadUrl ?? DEFAULT_NATIVE_HTTP_SETUP.downloadUrl);
    setNativeUploadUrl(setup.uploadUrl ?? DEFAULT_NATIVE_HTTP_SETUP.uploadUrl);
  }

  async function requestRfPermissionsIfNeeded() {
    if (permissionRequestStarted.current) return;
    permissionRequestStarted.current = true;
    try {
      if (typeof BabyDragonRfKpi.requestRfPermissions === "function") {
        const response = await BabyDragonRfKpi.requestRfPermissions();
        if (response?.permissions) {
          setPermissionStatus(response.permissions);
        }
      }
    } catch (error) {
      setCollectorMessage("RF permission request skipped. Native collector will use whatever Android exposes.");
    }
  }

  async function refreshNativeSnapshot({ append = true } = {}) {
    if (rfReadInFlightRef.current) return null;
    rfReadInFlightRef.current = true;
    setCollectorBusy(true);
    try {
      const snapshot = await Promise.race([
        BabyDragonRfKpi.getSnapshot(),
        new Promise((_, reject) => {
          window.setTimeout(() => reject(new Error("RF read timeout. Retrying next second.")), 850);
        }),
      ]);
      setNativeSnapshot(snapshot);
      if (snapshot?.permissions) {
        setPermissionStatus(snapshot.permissions);
      }
      setCollectorMessage(snapshot?.message || snapshot?.status || "RF snapshot refreshed.");
      const readNow = Date.now();
      setLastRfReadTime(readNow);
      setRfPollCount((count) => count + 1);

      if (append && snapshot?.ok) {
        setSamples((current) => [
          ...current.slice(-899),
          buildRfSample({
            snapshot: { ...snapshot, babyDragonReadAt: readNow },
            now: readNow,
            gps: gpsRef.current,
            session: currentSessionRef.current,
            mode: selectedModeRef.current,
            recording: testStateRef.current === "recording",
          }),
        ]);
      }
      return snapshot;
    } catch (error) {
      setCollectorMessage(error?.message || "Native RF collector is not available yet.");
      return null;
    } finally {
      rfReadInFlightRef.current = false;
      setCollectorBusy(false);
    }
  }

  function patchDataTest(patch) {
    setDataTest((current) => {
      const next = { ...current, ...patch, updatedAt: Date.now() };
      dataTestRef.current = next;
      return next;
    });
  }

  async function runInternalThroughputTest(sessionId, options = {}) {
    if (selectedModeRef.current !== "data") return;

    if (throughputAbortRef.current) {
      throughputAbortRef.current.abort();
    }

    const config = { ...DEFAULT_NATIVE_HTTP_SETUP, ...(options || {}) };
    const iterations = clampInteger(config.iterations, 1, MAX_THP_ITERATIONS, DEFAULT_THP_ITERATIONS);
    const waitSeconds = clampInteger(config.waitSeconds, 0, MAX_THP_WAIT_SECONDS, DEFAULT_THP_WAIT_SECONDS);
    const durationSeconds = clampInteger(config.durationSeconds, 1, MAX_THP_DURATION_SECONDS, DEFAULT_THP_DURATION_SECONDS);
    const intervalSeconds = clampInteger(config.intervalSeconds, 1, MAX_THP_INTERVAL_SECONDS, DEFAULT_THP_INTERVAL_SECONDS);
    const direction = config.direction || DEFAULT_DATA_DIRECTION;
    const runDl = direction !== "ul";
    const runUl = direction !== "dl";
    const { dlDurationSeconds, ulDurationSeconds, phaseText } = splitIterationDuration(durationSeconds, direction);
    const maxPhaseDurationSeconds = Math.max(dlDurationSeconds || 0, ulDurationSeconds || 0, 1);
    const phasesPerIteration = (runDl ? 1 : 0) + (runUl ? 1 : 0);
    const controller = new AbortController();
    throughputAbortRef.current = controller;
    const sequenceTimeoutMs = ((maxPhaseDurationSeconds * 1000 + 12000) * Math.max(1, phasesPerIteration) * iterations) + (waitSeconds * 1000 * Math.max(0, iterations - 1)) + 8000;
    const clearTimeout = buildTimedSignal(controller, sequenceTimeoutMs);
    const startedAt = Date.now();
    const iterationResults = [];

    patchDataTest({
      status: "running",
      phase: runDl ? "download" : "upload",
      dlMbps: null,
      ulMbps: null,
      downloadBytes: 0,
      uploadBytes: 0,
      testType: config.testType || DEFAULT_DATA_TEST_TYPE,
      direction,
      iterationsRequested: iterations,
      waitSeconds,
      durationSeconds,
      intervalSeconds,
      downloadUrl: config.downloadUrl || DEFAULT_NATIVE_HTTP_SETUP.downloadUrl,
      uploadUrl: config.uploadUrl || DEFAULT_NATIVE_HTTP_SETUP.uploadUrl,
      currentIteration: 1,
      completedIterations: 0,
      iterationResults: [],
      error: "",
      startedAt,
      endedAt: null,
      sessionId,
      message: `Iteration 1/${iterations}: running native ${direction === "ul" ? "upload" : direction === "dl" ? "download" : "DL/UL"} for ${phaseText}...`,
    });

    try {
      for (let iteration = 1; iteration <= iterations; iteration += 1) {
        const iterationStartedAt = Date.now();
        let dl = null;
        let ul = null;

        if (runDl) {
          patchDataTest({
            status: "running",
            phase: "download",
            currentIteration: iteration,
            message: `Iteration ${iteration}/${iterations}: native DL for ${dlDurationSeconds}s...`,
          });

          dl = await measureDownloadThroughput({
            signal: controller.signal,
            config: { ...config, durationSeconds: dlDurationSeconds, intervalSeconds },
            onProgress: (received) => {
              if (throughputAbortRef.current === controller) {
                patchDataTest({
                  downloadBytes: received,
                  currentIteration: iteration,
                  message: `Iteration ${iteration}/${iterations}: downloading ${Math.round(received / 1024 / 1024)} MB...`,
                });
              }
            },
          });
          if (throughputAbortRef.current !== controller) return;
        }

        const interimDlResults = [...iterationResults, { iteration, dlMbps: dl?.mbps ?? null, ulMbps: null }];
        patchDataTest({
          dlMbps: averageThroughput(interimDlResults, "dlMbps") ?? dataTestRef.current.dlMbps,
          phase: runUl ? "upload" : "iteration_complete",
          currentIteration: iteration,
          iterationResults: interimDlResults,
          message: runUl ? `Iteration ${iteration}/${iterations}: native UL for ${ulDurationSeconds}s...` : `Iteration ${iteration}/${iterations}: DL complete.`,
        });

        if (runUl) {
          ul = await measureUploadThroughput({ signal: controller.signal, config: { ...config, durationSeconds: ulDurationSeconds, intervalSeconds } });
          if (throughputAbortRef.current !== controller) return;
        }

        const iterationResult = {
          iteration,
          dlMbps: dl?.mbps ?? null,
          ulMbps: ul?.mbps ?? null,
          dlBytes: dl?.bytes || 0,
          ulBytes: ul?.bytes || 0,
          dlSeconds: dl?.seconds || 0,
          ulSeconds: ul?.seconds || 0,
          dlWallSeconds: dl?.wallSeconds || dl?.seconds || 0,
          ulWallSeconds: ul?.wallSeconds || ul?.seconds || 0,
          dlSource: dl?.source || "",
          ulSource: ul?.source || "",
          source: [dl?.source, ul?.source].filter(Boolean).join(" + "),
          startedAt: iterationStartedAt,
          endedAt: Date.now(),
          durationSeconds,
          dlDurationSeconds,
          ulDurationSeconds,
          intervalSeconds,
          waitSeconds,
          direction,
        };
        iterationResults.push(iterationResult);
        const avgDl = averageThroughput(iterationResults, "dlMbps");
        const avgUl = averageThroughput(iterationResults, "ulMbps");

        patchDataTest({
          status: iteration === iterations ? "complete" : "running",
          phase: iteration === iterations ? "complete" : "wait",
          dlMbps: avgDl,
          ulMbps: avgUl,
          downloadBytes: (dataTestRef.current.downloadBytes || 0) + (dl?.bytes || 0),
          uploadBytes: (dataTestRef.current.uploadBytes || 0) + (ul?.bytes || 0),
          completedIterations: iteration,
          currentIteration: iteration,
          iterationResults: [...iterationResults],
          endedAt: iteration === iterations ? Date.now() : null,
          message: iteration === iterations
            ? `Complete ${iteration}/${iterations}. Avg DL ${formatThroughputValue(avgDl)} Mbps · Avg UL ${formatThroughputValue(avgUl)} Mbps.`
            : `Iteration ${iteration}/${iterations} complete. Waiting before next run...`,
        });

        if (iteration < iterations && waitSeconds > 0) {
          await waitForThroughputPause(waitSeconds, controller.signal, (remaining) => {
            if (throughputAbortRef.current === controller) {
              patchDataTest({
                status: "running",
                phase: "wait",
                currentIteration: iteration + 1,
                message: `Waiting ${remaining}s before iteration ${iteration + 1}/${iterations}...`,
              });
            }
          });
        }
      }
    } catch (error) {
      if (throughputAbortRef.current !== controller) return;
      const message = makeAbortErrorMessage(error);
      const avgDl = averageThroughput(iterationResults, "dlMbps") ?? getNumber(dataTestRef.current.dlMbps);
      const avgUl = averageThroughput(iterationResults, "ulMbps") ?? getNumber(dataTestRef.current.ulMbps);
      patchDataTest({
        status: error?.name === "AbortError" ? "stopped" : "error",
        phase: error?.name === "AbortError" ? "stopped" : "error",
        dlMbps: avgDl,
        ulMbps: avgUl,
        completedIterations: iterationResults.length,
        iterationResults: [...iterationResults],
        endedAt: Date.now(),
        error: error?.name === "AbortError" ? "" : message,
        message,
      });
    } finally {
      clearTimeout();
      if (throughputAbortRef.current === controller) throughputAbortRef.current = null;
    }
  }

  async function armWorkflow(mode) {
    const now = Date.now();
    const session = {
      id: `bd-rf-${now}`,
      mode,
      startedAt: now,
      taskLabel: activeTaskLabel,
      grid: activeGrid,
    };

    selectedModeRef.current = mode;
    currentSessionRef.current = session;
    testStateRef.current = "recording";
    setSelectedMode(mode);
    setCurrentSession(session);
    setSavedSession(null);
    setExportStatus("");
    setExportFiles([]);
    setDataTest(makeDataTestIdle());
    dataTestRef.current = makeDataTestIdle();
    setClockTick(now);
    setTestState("recording");
    setCollectorRunning(true);
    setSamples([]);
    await refreshNativeSnapshot({ append: true });
    if (mode === "data") {
      if (currentDataTestConfig.testType === "native_http") {
        runInternalThroughputTest(session.id, currentDataTestConfig);
      } else {
        const label = DATA_TEST_TYPES.find((item) => item.key === currentDataTestConfig.testType)?.label || currentDataTestConfig.testType;
        patchDataTest({
          status: "external_ready",
          phase: currentDataTestConfig.testType,
          testType: currentDataTestConfig.testType,
          direction: currentDataTestConfig.direction,
          iterationsRequested: currentDataTestConfig.iterations,
          waitSeconds: currentDataTestConfig.waitSeconds,
          durationSeconds: currentDataTestConfig.durationSeconds,
          intervalSeconds: currentDataTestConfig.intervalSeconds,
          sessionId: session.id,
          startedAt: now,
          endedAt: null,
          message: `${label} selected. BabyDragon is recording RF/GPS timestamps. Import/screenshot capture comes in the next focused step.`,
        });
      }
    }
  }

  function stopWorkflow() {
    const endedAt = Date.now();
    const session = currentSessionRef.current || {
      id: `bd-rf-${endedAt}`,
      mode: selectedModeRef.current,
      startedAt: samplesRef.current[0]?.timestamp || endedAt,
      taskLabel: activeTaskLabel,
      grid: activeGrid,
    };
    const recorded = samplesRef.current.filter((sample) => sample.sessionId === session.id || sample.recorded);
    const sessionList = recorded.length ? recorded : samplesRef.current;
    if (throughputAbortRef.current && dataTestRef.current?.status === "running") {
      throughputAbortRef.current.abort();
    }
    const finalDataTest = dataTestRef.current?.status === "running"
      ? { ...dataTestRef.current, status: "stopped", phase: "stopped", message: "Throughput test stopped by Stop / Save.", endedAt }
      : dataTestRef.current;
    dataTestRef.current = finalDataTest;
    setDataTest(finalDataTest);

    setSavedSession(buildSessionSummary({
      session: { ...session, endedAt },
      samples: sessionList,
      endedAt,
      mode: selectedModeRef.current,
      taskLabel: activeTaskLabel,
      grid: activeGrid,
      appTest: finalDataTest,
    }));
    currentSessionRef.current = null;
    testStateRef.current = "paused";
    setCurrentSession(null);
    setClockTick(endedAt);
    setTestState("paused");
    setCollectorRunning(false);
  }

  async function refreshGpsAndRf() {
    if (typeof onRefreshGpsNow === "function") {
      await onRefreshGpsNow();
    }
    await refreshNativeSnapshot({ append: true });
  }

  async function exportSavedSession() {
    if (dataTestRef.current?.status === "running") {
      setExportStatus("Finish the THP test or tap Stop / Save before export. BabyDragon will not export half-baked reports.");
      return;
    }
    const sessionToExport = savedSession;
    if (!sessionToExport || (!sessionToExport.sampleCount && !sessionToExport?.appIterationResults?.length)) {
      setExportStatus("Tap Stop / Save first, then export the saved report package.");
      return;
    }

    setExportStatus("Building Report package...");
    setExportFiles([]);
    setExportPackageName("");
    setExportBasePath("");
    try {
      const reportPackage = buildReportPackage({ session: sessionToExport, user, activeTask });
      const result = await saveReportPackage(reportPackage);
      const files = Array.isArray(result?.savedFiles) ? result.savedFiles : [];
      setExportFiles(files);
      setExportPackageName(reportPackage.displayName || result?.displayName || reportPackage.sessionId);
      setExportBasePath(result?.basePath || "Downloads/BabyDragon/Reports");
      setExportStatus(result?.fallback
        ? `Report package downloaded: ${files.length} files.`
        : `Report package saved successfully: ${files.length} files.`);
    } catch (error) {
      setExportStatus(error?.message || "Report export failed.");
    }
  }

  async function shareExportedReports() {
    if (!exportFiles.length) {
      setExportStatus("Export reports first, then share.");
      return;
    }
    const title = exportPackageName || "BabyDragon RF KPI Report";
    const text = `${title} saved under ${exportBasePath || "Downloads/BabyDragon/Reports"}`;
    try {
      if (typeof BabyDragonRfKpi.shareReportFiles === "function") {
        const response = await BabyDragonRfKpi.shareReportFiles({ files: exportFiles, title, text });
        setExportStatus(response?.message || "Share sheet opened.");
        return;
      }
      if (navigator?.share) {
        await navigator.share({ title, text });
        setExportStatus("Share sheet opened.");
        return;
      }
      setExportStatus(text);
    } catch (error) {
      setExportStatus(error?.message || "Share failed.");
    }
  }

  useEffect(() => {
    let cancelled = false;

    function tick() {
      if (!cancelled) {
        refreshNativeSnapshot({ append: true });
      }
    }

    requestRfPermissionsIfNeeded().finally(tick);
    const timer = window.setInterval(tick, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => () => {
    if (throughputAbortRef.current) throughputAbortRef.current.abort();
  }, []);

  function togglePanel(panelName) {
    setOpenPanel((current) => (current === panelName ? "none" : panelName));
  }

  return (
    <section className="bd-mobile-rf-view bd-mobile-rf-compact">
      <section className="bd-mobile-card bd-rf-control-card">
        <div className="bd-rf-compact-head">
          <div>
            <p className="bd-mobile-eyebrow">Android Info RF KPI</p>
            <h2>RF Cockpit</h2>
            <span>
              {hasRunningTask ? "Task live" : "Ready"} · {getStatusLabel(testState, selectedMode)} · Samples {sampleCount} · Duration {formatDuration(visibleSession?.durationMs || 0)} · Last RF {formatTime(lastRfReadTime)}
            </span>
          </div>
          <button type="button" onClick={() => togglePanel("about")}>Info</button>
        </div>

        {openPanel === "about" && (
          <p className="bd-rf-inline-note">
            BabyDragon now reads public Android CellInfo plus SignalStrength fallback. LTE anchor identity comes from CellInfo when available. Missing SINR/RF values can be filled from SignalStrength. NR values stay blank unless Android exposes real NR RF or NR cell data.
          </p>
        )}

        <div className="bd-rf-context-strip bd-rf-context-strip-f3">
          <span><b>FE</b>{user?.email || "Signed in FE"}</span>
          <span><b>Task</b>{activeTaskLabel}</span>
          <span><b>Grid</b>{activeGrid}</span>
          <span><b>GPS</b>{formatGps(lastGpsLocation)}</span>
          <span><b>RF Poll</b>{rfPollCount ? `#${nativeSnapshot?.snapshotSequence || rfPollCount} · ${formatLocalDateTime(lastRfReadTime)}` : "Waiting"}</span>
          <span><b>RF Rule</b>Android may repeat cached RSRP/RSRQ; BabyDragon records every read.</span>
        </div>

        <div className="bd-rf-mode-toggle">
          <button
            type="button"
            className={selectedMode === "data" ? "active" : ""}
            onClick={() => { setSelectedMode("data"); setDataSetupOpen(true); }}
          >
            Data Test
          </button>
          <button
            type="button"
            className={selectedMode === "voice" ? "active" : ""}
            onClick={() => { setSelectedMode("voice"); setDataSetupOpen(false); }}
          >
            Voice Test
          </button>
        </div>

        {selectedMode === "data" && (
          <section className={`bd-rf-data-setup-card ${dataSetupOpen ? "open" : "collapsed"}`}>
            <div className="bd-rf-data-setup-head">
              <div>
                <b>Data Test Setup</b>
                <span>{DATA_TEST_TYPES.find((item) => item.key === dataTestType)?.label || "Native Android HTTP"} · {DATA_DIRECTIONS.find((item) => item.key === dataDirection)?.label || "DL + UL"} · {resolvedThpDurationSeconds}s</span>
              </div>
              <button type="button" onClick={() => setDataSetupOpen((current) => !current)}>
                {dataSetupOpen ? "Hide" : "Setup"}
              </button>
            </div>

            {dataSetupOpen && (
              <>
                <div className="bd-rf-test-type-grid">
                  {DATA_TEST_TYPES.map((item) => (
                    <button
                      type="button"
                      key={item.key}
                      className={dataTestType === item.key ? "active" : ""}
                      disabled={dataTest.status === "running"}
                      onClick={() => setDataTestType(item.key)}
                    >
                      <strong>{item.label}</strong>
                      <span>{item.status}</span>
                    </button>
                  ))}
                </div>

                {dataTestType === "native_http" && (
                  <NativeHttpTestCard setup={currentNativeHttpSetup} onChange={handleNativeHttpSetupChange} disabled={dataTest.status === "running"} />
                )}
                {dataTestType === "ftp" && (
                  <FtpTestCard setup={ftpSetup} onChange={setFtpSetup} disabled={dataTest.status === "running"} />
                )}
                {dataTestType === "iperf" && (
                  <IperfTestCard setup={iperfSetup} onChange={setIperfSetup} disabled={dataTest.status === "running"} />
                )}
                {dataTestType === "ookla_app" && (
                  <OoklaTestCard setup={ooklaSetup} onChange={setOoklaSetup} disabled={dataTest.status === "running"} />
                )}
                {dataTestType === "fcc_app" && (
                  <FccTestCard setup={fccSetup} onChange={setFccSetup} disabled={dataTest.status === "running"} />
                )}
              </>
            )}
          </section>
        )}

        <div className="bd-rf-action-grid">
          <button type="button" className="bd-mobile-primary" onClick={() => armWorkflow(selectedMode)}>
            {collectorRunning ? "Restart" : selectedMode === "voice" ? "Start Voice" : "Start Data"}
          </button>
          <button type="button" className="bd-mobile-secondary" onClick={stopWorkflow} disabled={!collectorRunning && !samples.length}>
            {collectorRunning ? "Stop / Save" : savedSession ? "Saved" : "Stop / Save"}
          </button>
          <button type="button" className="bd-mobile-secondary" onClick={refreshGpsAndRf}>
            {gpsChecking || collectorBusy ? "Checking..." : "GPS + RF"}
          </button>
          <button type="button" className="bd-mobile-secondary" disabled={!canExportSession || exportStatus?.startsWith("Building")} onClick={exportSavedSession}>
            {exportStatus?.startsWith("Building") ? "Exporting..." : thpIsRunning ? "Finish Test" : savedSession ? "Export" : "Save First"}
          </button>
        </div>

        {exportStatus ? (
          <p className={`bd-rf-inline-note ${exportFiles.length ? "success" : exportStatus.toLowerCase().includes("failed") || exportStatus.toLowerCase().includes("error") ? "warning" : ""}`}>
            {exportStatus}
          </p>
        ) : null}
        {exportFiles.length ? (
          <div className="bd-rf-export-package-card">
            <div>
              <b>{exportPackageName || "BabyDragon RF KPI Report"}</b>
              <span>{exportFiles.length} report files saved</span>
              <small>{exportBasePath || "Downloads/BabyDragon/Reports"}</small>
            </div>
            <button type="button" onClick={shareExportedReports}>Share</button>
            <details>
              <summary>View files</summary>
              <div className="bd-rf-export-file-list-clean">
                {exportFiles.map((file) => (
                  <span key={`${file.fileName}-${file.path || file.uri || "saved"}`}>
                    <b>{file.reportLabel || file.label || file.fileName}</b>
                    <small>{file.fileName}</small>
                  </span>
                ))}
              </div>
            </details>
          </div>
        ) : null}

        {permissionStatus?.readPhoneState === false && (
          <p className="bd-rf-inline-note warning">
            Phone State permission is not granted. BabyDragon can still show CellInfo values, but LTE SINR/RSSNR may stay N/A until Android allows SignalStrength access.
          </p>
        )}

        <p className={`bd-rf-inline-note ${nativeSnapshot?.ok ? "success" : ""}`}>
          {servingTechnology} · {collectorMessage}
        </p>

        <div className="bd-rf-serving-compact">
          <div className="bd-rf-serving-main">
            <span>Current RAT</span>
            <strong>{servingTechnology}</strong>
          </div>
          <div className="bd-rf-serving-grid">
            <span><b>LTE Anchor</b>{describeLteAnchor(nativeSnapshot)}</span>
            <span className={getCardStatus(nativeSnapshot, "nr")}><b>NR Secondary</b>{describeNrSecondary(nativeSnapshot)}</span>
            <span><b>RF Source</b>{describeRfSource(nativeSnapshot)}</span>
          </div>
        </div>

        {visibleSession && (
          <div className={`bd-rf-session-card ${collectorRunning ? "recording" : "saved"}`}>
            <div className="bd-rf-session-head">
              <div>
                <b>{collectorRunning ? "Recording Session" : "Saved Session"}</b>
                <span>{String(visibleSession.mode || "data").toUpperCase()} · {visibleSession.rat || servingTechnology}</span>
              </div>
              <em>{collectorRunning ? "LIVE" : "FROZEN"}</em>
            </div>
            <div className="bd-rf-session-grid bd-rf-session-grid-c2">
              <span><b>Duration</b><strong>{formatDuration(visibleSession.durationMs)}</strong><small>{formatTime(visibleSession.startedAt)} → {formatTime(visibleSession.endedAt)}</small></span>
              <span><b>Samples</b><strong>{visibleSession.sampleCount}</strong><small>{visibleSession.gpsCount} GPS points</small></span>
              <span><b>RF Polls</b><strong>{rfPollCount}</strong><small>Android snapshots read</small></span>
              <span><b>RF Rule</b><strong>Real values</strong><small>No fake RF changes</small></span>
              {getSessionRfMetricCards(visibleSession).map((metric) => (
                <SessionMetricCard
                  key={metric.label}
                  label={metric.label}
                  value={metric.value}
                  unit={metric.unit}
                  min={metric.min}
                  max={metric.max}
                  digits={metric.digits ?? 1}
                />
              ))}
            </div>
          </div>
        )}

        {selectedMode === "data" && (dataTest.status !== "idle" || getNumber(visibleSession?.appDlMbps) !== null || getNumber(visibleSession?.appUlMbps) !== null) && (
          <div className={`bd-rf-thp-card ${dataTest.status || "idle"}`}>
            <div className="bd-rf-thp-head">
              <div>
                <b>Internal DL / UL Throughput</b>
                <span>{dataTest.message || visibleSession?.appTestMessage || "Avg values are from completed iterations. Details are listed below."}</span>
              </div>
              <em>{throughputStatus("dl", { dataTest, savedSession: visibleSession })}</em>
            </div>
            <div className="bd-rf-thp-grid bd-rf-thp-grid-d2">
              <span><b>Avg DL THP</b><strong>{formatThroughputWithUnit(formatThroughputLive("dl", { dataTest, savedSession: visibleSession }))}</strong></span>
              <span><b>Avg UL THP</b><strong>{formatThroughputWithUnit(formatThroughputLive("ul", { dataTest, savedSession: visibleSession }))}</strong></span>
              <span><b>Iterations</b><strong>{dataTest.completedIterations || visibleSession?.appCompletedIterations || 0}/{dataTest.iterationsRequested || visibleSession?.appIterationsRequested || resolvedThpIterations}</strong></span>
              <span><b>Wait</b><strong>{dataTest.waitSeconds ?? visibleSession?.appWaitSeconds ?? resolvedThpWaitSeconds}s</strong></span>
            </div>
            {thpIterationRows.length ? (
              <div className="bd-rf-thp-iteration-list">
                {thpIterationRows.map((row) => (
                  <span key={`${row.iteration}-${row.startedAt || row.endedAt || "row"}`}>
                    <b>#{row.iteration}</b>
                    <strong>{formatThpIterationSummary(row)}</strong>
                  </span>
                ))}
              </div>
            ) : null}
            {dataTest.error ? <p>{dataTest.error}</p> : null}
          </div>
        )}

        <div className="bd-rf-panel-buttons">
          <button type="button" className={openPanel === "map" ? "active" : ""} onClick={() => togglePanel("map")}>Map</button>
          <button type="button" className={openPanel === "legend" ? "active" : ""} onClick={() => togglePanel("legend")}>Legend</button>
        </div>
      </section>

      {openPanel === "map" && (
        <section className="bd-mobile-card bd-rf-hidden-panel">
          <div className="bd-rf-panel-head">
            <p><b>Route + KPI Map</b><span>Street map with grid, saved route, GPS trace, and KPI dots</span></p>
            <button type="button" onClick={() => setOpenPanel("none")}>Hide</button>
          </div>
          <RfLeafletSessionMap
            traceSamples={traceSamples}
            traceMap={traceMap}
            activeTask={activeTask}
            lastGpsLocation={lastGpsLocation}
          />
          <TraceQualityLegend />
          <div className="bd-rf-mini-facts bd-rf-mini-facts-c2">
            <span><b>Task</b>{activeTaskLabel}</span>
            <span><b>Session</b>{visibleSession ? `${visibleSession.sampleCount} samples · ${visibleSession.gpsCount} GPS` : "No saved session yet"}</span>
            <span><b>Start</b>{formatGps(visibleSession?.firstGps || traceSamples.find((sample) => sample.gps)?.gps)}</span>
            <span><b>End</b>{formatGps(visibleSession?.lastGps || [...traceSamples].reverse().find((sample) => sample.gps)?.gps)}</span>
            <span><b>Trace</b>{traceMap.hasRealGps ? `${traceMap.gpsCount} GPS fixes` : "Waiting for movement/GPS"}</span>
            <span><b>Last Point</b>{formatGps(visibleSession?.lastGps || traceSamples[traceSamples.length - 1]?.gps)}</span>
          </div>
        </section>
      )}

      <section className="bd-mobile-card bd-rf-table-card-compact">
        <div className="bd-rf-panel-head">
          <p><b>Live KPI Table</b><span>CellInfo + SignalStrength, rolling avg · RF Poll {rfPollCount ? `#${nativeSnapshot?.snapshotSequence || rfPollCount}` : "waiting"} · Last {formatTime(lastRfReadTime)}</span></p>
          <em>{nativeSnapshot?.ok ? "Native live" : collectorBusy ? "Reading..." : "Waiting"}</em>
        </div>

        <div className="bd-rf-rat-toggle" role="group" aria-label="Select KPI technology view">
          {RAT_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={ratView === option.key ? "active" : ""}
              onClick={() => setRatView(option.key)}
            >
              <b>{option.label}</b>
              <span>{option.hint}</span>
            </button>
          ))}
        </div>

        <p className="bd-rf-tech-note">
          Auto follows the serving RAT: {servingTechnology}. LTE anchor identity comes from CellInfo. SINR can come from SignalStrength or raw public Android signal text when Android exposes it.
        </p>

        <div className="bd-mobile-rf-kpi-table-wrap compact">
          <table className="bd-mobile-rf-kpi-table compact">
            <thead>
              <tr>
                <th>KPI</th>
                <th>Live</th>
                <th>Avg</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => (
                <tr key={`${effectiveRatView}-${row.group}-${row.kpi}`}>
                  <td>
                    <span className={`bd-rf-group-pill ${row.group.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{row.group}</span>
                    <strong>{row.kpi}</strong>
                    {row.unit ? <small>{row.unit}</small> : null}
                  </td>
                  <td>{row.live}</td>
                  <td>{row.avg}</td>
                  <td><span className={`bd-rf-status ${row.status.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{row.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="bd-rf-inline-note success">
          RF Poll confirms BabyDragon reads every second. Android may repeat cached RSRP/RSRQ/RSSI values; BabyDragon does not invent RF changes.
        </p>
      </section>

      {openPanel === "legend" && (
        <section className="bd-mobile-card bd-rf-hidden-panel">
          <div className="bd-rf-panel-head">
            <p><b>Legend / Thresholds</b><span>Configurable report colors</span></p>
            <button type="button" onClick={() => setOpenPanel("none")}>Hide</button>
          </div>
          <p className="bd-rf-inline-note">
            3GPP measurement families stay standard. BabyDragon report colors use configurable RF engineering thresholds by RAT: NR/LTE, WCDMA, GSM, data, and voice.
          </p>
          <div className="bd-mobile-rf-legend-list compact">
            {KPI_LEGENDS.map((legend) => (
              <article className="bd-mobile-rf-legend-card compact" key={legend.name}>
                <header>
                  <div>
                    <strong>{legend.name}</strong>
                    <small>{legend.note}</small>
                  </div>
                  <em>{legend.unit}</em>
                </header>
                <div className="bd-mobile-rf-bands compact">
                  {legend.bands.map((band) => (
                    <span className={`bd-rf-band ${band.className}`} key={`${legend.name}-${band.label}`}>
                      <b>{band.label}</b>
                      <small>{band.range}</small>
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {openPanel === "export" && (
        <section className="bd-mobile-card bd-rf-hidden-panel">
          <div className="bd-rf-panel-head">
            <p><b>Report Package</b><span>Summary, trace, THP, voice KPIs, and FCC-style JSON</span></p>
            <button type="button" onClick={() => setOpenPanel("none")}>Hide</button>
          </div>
          {savedSession && (
            <p className="bd-rf-inline-note success">
              Saved locally: {savedSession.sampleCount} RF samples, {savedSession.gpsCount} GPS points, duration {formatDuration(savedSession.durationMs)}.
            </p>
          )}
          <button type="button" className="bd-mobile-primary bd-rf-export-now" disabled={!canExportSession || exportStatus?.startsWith("Building")} onClick={exportSavedSession}>
            {exportStatus?.startsWith("Building") ? "Building report..." : thpIsRunning ? "Finish Test Before Export" : "Export Report Package"}
          </button>
          {exportStatus ? <p className="bd-rf-inline-note">{exportStatus}</p> : null}
          {exportFiles.length ? (
            <div className="bd-rf-export-files">
              {exportFiles.map((file) => (
                <span key={`${file.fileName}-${file.path || "saved"}`}>
                  <b>{file.fileName}</b>
                  <small>{file.path || "Saved"}</small>
                </span>
              ))}
            </div>
          ) : null}
          <div className="bd-mobile-rf-export-grid compact">
            {EXPORT_ITEMS.map((item) => (
              <div key={item.title}>
                <strong>{item.title}</strong>
                <p>{item.description}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
