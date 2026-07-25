import React, { useEffect, useMemo, useRef, useState } from "react";
import { registerPlugin } from "@capacitor/core";
import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { DATA_TEST_TYPES, DATA_DIRECTIONS, DEFAULT_NATIVE_HTTP_SETUP, DEFAULT_FTP_SETUP, DEFAULT_IPERF_SETUP, DEFAULT_FCC_IMPORT_SETUP, DEFAULT_OOKLA_SETUP } from "./config/dataTestConfig";
import NativeHttpTestCard from "./components/testcards/NativeHttpTestCard";
import FtpTestCard from "./components/testcards/FtpTestCard";
import Iperf3TestPage from "./pages/Iperf3TestPage";
import OoklaTestCard from "./components/testcards/OoklaTestCard";
import FccTestCard from "./components/testcards/FccTestCard";
import { runBabyDragonFtpTest } from "../testEngines/ftpTestEngine";
import { cancelIperf3, runIperf3ThroughputTest } from "../testEngines/iperf3Runner";
import { buildIperf3CommandFromSetup } from "../testEngines/iperf3CommandParser";
import { buildIperf3ReportFiles, isIperf3Session, mapIperfExportStatus, resolveIperfExportModes } from "./reports/iperf3ReportExport";
import {
  buildFccIterationSummary,
  buildOoklaIterationSummary,
  resolveOoklaEvidenceMode,
  resolveOoklaIterations,
} from "./reports/externalEvidenceSummary";
import {
  buildFccReportFiles,
  buildFccFileBaseName,
  buildFccGeneratedEvidenceSnapshot,
  isFccSession,
  mapFccExportStatus,
  matchNearestFccContextSample,
} from "./reports/fccReportExport";
import {
  buildOoklaDeveloperDebugFiles,
  buildOoklaEvidenceExportFile,
  INCLUDE_DEVELOPER_DEBUG_EXPORT_DEFAULT,
  isOoklaSession,
  mapOoklaExportStatus,
  matchNearestActiveRfSample,
} from "./reports/ooklaReportExport";
import {
  finalizeOoklaCsvTimeWindowOnExport,
  resolveOoklaDisplayResultId,
} from "./utils/ooklaCsvImport";
import {
  base64ToArrayBuffer,
  buildFccDedupeKey,
  buildFccImportDebugPayload,
  FCC_DEFAULT_BUFFER_SECONDS,
  finalizeFccTimeWindowOnExport,
  parseFccExportZip,
  previewRowToEvidenceIteration,
  resolveFccIterations,
  validateFccZipDownloadUrl,
} from "./utils/fccExportImport";
import {
  DEFAULT_KPI_WARMUP_DURATION_SEC,
  assignOoklaTrafficStatsWarmupEstimates,
  isExportableOoklaIteration,
  resolveKpiWarmupDurationSec,
} from "./utils/ooklaTrafficStatsWarmup";


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
    { group: "Data KPIs", kpi: "Android TrafficStats DL", unit: "Mbps", avgMode: "traffic", trafficMetric: "dl" },
    { group: "Data KPIs", kpi: "Android TrafficStats UL", unit: "Mbps", avgMode: "traffic", trafficMetric: "ul" },
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
    { group: "Data KPIs", kpi: "Android TrafficStats DL", unit: "Mbps", avgMode: "traffic", trafficMetric: "dl" },
    { group: "Data KPIs", kpi: "Android TrafficStats UL", unit: "Mbps", avgMode: "traffic", trafficMetric: "ul" },
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
  { label: "iPerf", status: "Setup", note: "Setup + placeholder active; native iPerf runner comes in Step 1G4." },
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
const DEFAULT_THP_WARMUP_SECONDS = Number(DEFAULT_NATIVE_HTTP_SETUP.warmupSeconds ?? 3);
const MAX_THP_ITERATIONS = 20;
const MAX_THP_WAIT_SECONDS = 120;
const MAX_THP_DURATION_SECONDS = 300;
const MAX_THP_INTERVAL_SECONDS = 10;
const MAX_THP_WARMUP_SECONDS = 30;

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
    warmupSeconds: DEFAULT_THP_WARMUP_SECONDS,
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

function isExternalAppThroughputBlocked(dataContext = {}) {
  const active = dataContext.dataTest || {};
  const saved = dataContext.savedSession || {};
  return active.testType === "ookla_app"
    || active.testType === "fcc_app"
    || saved.appTestType === "ookla_app"
    || saved.appTestType === "fcc_app";
}

function isOoklaThroughputBlocked(dataContext = {}) {
  return isExternalAppThroughputBlocked(dataContext);
}

function pickThroughputValue(metric, dataContext = {}) {
  if (isExternalAppThroughputBlocked(dataContext)) return null;
  const active = dataContext.dataTest || {};
  const saved = dataContext.savedSession || {};
  if (metric === "dl") return getNumber(active.dlMbps ?? saved.appDlMbps);
  if (metric === "ul") return getNumber(active.ulMbps ?? saved.appUlMbps);
  return null;
}

function formatThroughputValue(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  if (value > 0 && value < 0.01) return "<0.01";
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

function formatBytesCompact(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function ftpFinalPolishNote(dataTest = {}) {
  if (dataTest.testType !== "ftp") return "";
  if (dataTest.status === "running") return "FTP running natively. RF/GPS recording continues in parallel.";
  if (dataTest.status === "partial") return "Partial FTP result: one direction completed, another direction failed or produced zero measured bytes.";
  if (dataTest.status === "error") return "FTP needs a reachable server and valid path/permission. Rebex is DL smoke only; DLPTest is UL smoke only.";
  if (dataTest.status === "complete") return "FTP result saved. Use a controlled FTP server with a large file for final DL/UL throughput validation.";
  return "";
}


function iperfRunNote(dataTest = {}) {
  if (dataTest.testType !== "iperf") return "";
  if (dataTest.status === "running") return "iPerf3 running natively. RF/GPS recording continues in parallel.";
  if (dataTest.status === "complete") return "iPerf3 result saved. Interval samples are listed under each completed run.";
  if (dataTest.status === "partial") {
    if (String(dataTest.direction || "").toLowerCase() === "dl_ul" || dataTest.setupSnapshot?.bidirMode) {
      return "Partial bidirectional iPerf3 result. DL+UL requires --bidir and a server that supports bidirectional mode.";
    }
    return "Partial iPerf3 result: one or more iterations failed or returned unparseable JSON.";
  }
  if (dataTest.status === "error") return "iPerf3 needs a reachable server, valid port, and prepared binary. Check stderr/exit code in the monitor message.";
  if (dataTest.status === "stopped") return "iPerf3 test stopped. Completed iterations are kept.";
  return "";
}

function dataTestMonitorTitle(dataTest = {}) {
  if (dataTest.testType === "ftp") return "FTP Test Monitor";
  if (dataTest.testType === "iperf") return "iPerf3 Test Monitor";
  if (dataTest.testType === "ookla_app") return "OOKLA App Monitor";
  if (dataTest.testType === "fcc_app") return "FCC App Monitor";
  return "Internal DL / UL Throughput";
}

function resolveOoklaEvidence(dataContext = {}) {
  return dataContext.dataTest?.ooklaEvidence || dataContext.savedSession?.appOoklaEvidence || null;
}

function resolveOoklaEvidenceIterations(dataContext = {}) {
  const fromLive = dataContext.dataTest?.ooklaEvidenceIterations;
  const fromSaved = dataContext.savedSession?.appOoklaEvidenceIterations;
  if (Array.isArray(fromLive) && fromLive.length) return fromLive;
  if (Array.isArray(fromSaved) && fromSaved.length) return fromSaved;
  const latest = resolveOoklaEvidence(dataContext);
  return latest ? [latest] : [];
}

function isOoklaContext(dataContext = {}) {
  const active = dataContext.dataTest || {};
  const saved = dataContext.savedSession || {};
  return active.testType === "ookla_app" || saved.appTestType === "ookla_app";
}

function isFccContext(dataContext = {}) {
  const active = dataContext.dataTest || {};
  const saved = dataContext.savedSession || {};
  return active.testType === "fcc_app" || saved.appTestType === "fcc_app";
}

function ooklaMonitorHeadline(dataTest = {}, session = {}) {
  const iterations = dataTest.ooklaEvidenceIterations?.length
    ? dataTest.ooklaEvidenceIterations
    : (session?.appOoklaEvidenceIterations?.length ? session.appOoklaEvidenceIterations : resolveOoklaIterations(session || {}));
  const count = iterations.length;
  const evidence = dataTest.ooklaEvidence || session?.appOoklaEvidence || iterations[iterations.length - 1];
  if (count > 1) {
    if (evidence?.confirmation === "fe_confirmed") return `${count} OOKLA iterations saved. Latest is FE-confirmed.`;
    return `${count} OOKLA iterations saved. Latest is draft.`;
  }
  if (evidence?.confirmation === "fe_confirmed") return "Manual OOKLA App evidence, FE-confirmed.";
  if (evidence) return "Manual OOKLA App evidence saved as draft.";
  return dataTest.message || "Recording RF/GPS. Enter OOKLA App results and save evidence.";
}

function fccMonitorHeadline(dataTest = {}, session = {}) {
  const iterations = Array.isArray(dataTest?.fccEvidenceIterations) && dataTest.fccEvidenceIterations.length
    ? dataTest.fccEvidenceIterations
    : resolveFccIterations(session || {});
  const fccImport = dataTest?.appFccImport || session?.appFccImport || null;
  const sourceTotal = fccImport?.originalSourceSummary?.collapsedTestsTotal
    ?? fccImport?.collapsedTestCount
    ?? fccImport?.stats?.collapsedTestCount
    ?? null;
  const insideTotal = fccImport?.sessionWindowSummary?.collapsedTestsInsideWindow
    ?? fccImport?.insideWindowCount
    ?? fccImport?.stats?.insideWindowCount
    ?? null;
  if (sourceTotal != null || iterations.length) {
    return `FCC source parsed: ${sourceTotal ?? "—"} tests · Inside BabyDragon session: ${insideTotal ?? "—"} tests · Saved FCC evidence: ${iterations.length} tests`;
  }
  if (session?.appFccGeneratedEvidence?.sampleCount > 0 || session?.sampleCount > 0) {
    return "FCC session context recorded. Import FCC ZIP and add inside-window rows as evidence.";
  }
  return dataTest.message || "Recording RF/GPS for FCC App external evidence.";
}

function shouldShowDataTestMonitor(selectedMode, dataTest, visibleSession) {
  if (selectedMode !== "data") return false;
  if (isOoklaContext({ dataTest, savedSession: visibleSession })) {
    return dataTest.status !== "idle"
      || Boolean(visibleSession?.appOoklaEvidence)
      || Boolean(visibleSession?.appOoklaEvidenceIterations?.length)
      || visibleSession?.appTestType === "ookla_app";
  }
  if (isFccContext({ dataTest, savedSession: visibleSession })) {
    return dataTest.status !== "idle" || visibleSession?.appTestType === "fcc_app";
  }
  return dataTest.status !== "idle"
    || getNumber(visibleSession?.appDlMbps) !== null
    || getNumber(visibleSession?.appUlMbps) !== null;
}

function parseOoklaOptionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function throughputStatus(metric, dataContext = {}) {
  const active = dataContext.dataTest || {};
  const saved = dataContext.savedSession || {};
  const value = pickThroughputValue(metric, dataContext);

  if (active.status === "running") {
    if (active.phase === "session_paused") return "Paused";
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

function throughputStatusBadge(dataContext = {}) {
  const active = dataContext.dataTest || {};
  const saved = dataContext.savedSession || {};

  if (active.testType === "ftp") {
    if (active.status === "running") {
      if (active.phase === "iteration_start") return "Testing";
      if (active.phase === "iteration_done") return "Testing";
      if (active.phase === "starting") return "Starting";
      return "Testing";
    }

    if (active.status === "complete") return "Saved";
    if (active.status === "partial") return "Partial";
    if (active.status === "error") {
      const hasAnyBytes = Number(active.downloadBytes || 0) > 0 || Number(active.uploadBytes || 0) > 0;
      return hasAnyBytes ? "Partial" : "Error";
    }
    if (active.status === "stopped") return "Stopped";

    const hasSavedFtp = saved?.appTestType === "ftp" || saved?.appSource === "native-ftp-v1g2a" || saved?.appSource === "native-ftp-v1g2";
    if (hasSavedFtp && (getNumber(saved.appDlMbps) !== null || getNumber(saved.appUlMbps) !== null)) return "Saved";
    return "Ready";
  }

  if (active.testType === "iperf") {
    if (active.status === "running") {
      if (active.phase === "wait") return "Waiting";
      if (active.phase === "iperf") return "Testing";
      return "Testing";
    }
    if (active.status === "complete") return "Saved";
    if (active.status === "partial") return "Partial";
    if (active.status === "error") return "Error";
    if (active.status === "stopped") return "Stopped";
    return "Ready";
  }

  if (active.status === "running" && active.phase === "session_paused") return "Paused";

  if (active.testType === "ookla_app" || saved?.appTestType === "ookla_app") {
    const iterations = resolveOoklaEvidenceIterations({ dataTest: active, savedSession: saved });
    const evidence = active.ooklaEvidence || saved?.appOoklaEvidence || iterations[iterations.length - 1];
    if (active.status === "external_ready" && !iterations.length) return "Recording";
    if (active.status === "evidence_saved" || saved?.appExportStatus === "saved") return "Saved";
    if (active.status === "evidence_partial" || saved?.appExportStatus === "partial") return "Partial";
    if (iterations.some((item) => item.confirmation === "fe_confirmed")) {
      return iterations.every((item) => item.confirmation === "fe_confirmed") ? "Saved" : "Partial";
    }
    if (active.status === "evidence_draft" || saved?.appExportStatus === "draft" || iterations.length) return "Draft";
    return "Ready";
  }

  if (active.testType === "fcc_app" || saved?.appTestType === "fcc_app") {
    if (active.status === "external_ready") return "Recording";
    if (saved?.appFccGeneratedEvidence || saved?.appExportStatus === "saved") return "Saved";
    if (saved?.appExportStatus === "partial") return "Partial";
    if (saved?.appExportStatus === "draft") return "Draft";
    return active.status !== "idle" ? "Recording" : "Ready";
  }

  return throughputStatus("dl", dataContext);
}

function statusClassName(label) {
  return String(label || "ready")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "ready";
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
  const base = `DL ${formatThroughputValue(getNumber(row.dlMbps))} / UL ${formatThroughputValue(getNumber(row.ulMbps))} Mbps`;
  const isFtp = row.source === "native-ftp-v1g2" || row.source === "native-ftp-v1g2a" || row.dlSource === "native-ftp-v1g2" || row.dlSource === "native-ftp-v1g2a";
  if (!isFtp) return base;
  const dlBytes = row.dlMeasuredBytes ?? row.dlBytes ?? 0;
  const ulBytes = row.ulMeasuredBytes ?? row.ulBytes ?? 0;
  return `${base} · DL ${formatBytesCompact(dlBytes)} / UL ${formatBytesCompact(ulBytes)}`;
}

function formatIperfIntervalSeconds(value) {
  const n = getNumber(value);
  if (n === null) return "N/A";
  return `${n.toFixed(2)}s`;
}

function formatIperfIntervalLine(parentIteration, sample = {}) {
  const iterLabel = `#${parentIteration}.${sample.index || "?"}`;
  const secondsText = formatIperfIntervalSeconds(sample.seconds);
  const dl = getNumber(sample.dlMbps);
  const ul = getNumber(sample.ulMbps);
  const segments = [iterLabel, secondsText];
  if (dl !== null) segments.push(`DL ${formatThroughputValue(dl)} Mbps`);
  if (ul !== null) segments.push(`UL ${formatThroughputValue(ul)} Mbps`);
  const missingNote = (dl === null || ul === null) && (dl !== null || ul !== null)
    ? "missing from iperf JSON"
    : (dl === null && ul === null ? "missing from iperf JSON" : "");
  if (dl === null && ul === null) segments.push("no throughput parsed");
  return { line: segments.join(" • "), missingNote };
}

function flattenIperfIntervalRows(iterationRows = []) {
  const flat = [];
  for (const row of iterationRows) {
    if (!Array.isArray(row.intervalSamples)) continue;
    for (const sample of row.intervalSamples) {
      flat.push({ parentIteration: row.iteration, sample });
    }
  }
  return flat;
}

function iperfMonitorHeadline(dataTest = {}, visibleSession = {}) {
  const completed = dataTest.completedIterations || visibleSession?.appCompletedIterations || 0;
  const requested = dataTest.iterationsRequested || visibleSession?.appIterationsRequested || 1;
  const statusWord = dataTest.status === "running"
    ? "running"
    : dataTest.status === "complete"
      ? "complete"
      : dataTest.status === "partial"
        ? "partial"
        : dataTest.status === "error"
          ? "failed"
          : dataTest.status === "stopped"
            ? "stopped"
            : "ready";
  return `iPerf3 ${statusWord} ${completed}/${requested}`;
}

function iperfMonitorInfoLine(dataTest = {}) {
  const dlBytes = formatBytesCompact(dataTest.downloadBytes || 0);
  const ulBytes = formatBytesCompact(dataTest.uploadBytes || 0);
  const durationMs = dataTest.startedAt && dataTest.endedAt ? dataTest.endedAt - dataTest.startedAt : null;
  const durationText = durationMs ? formatDuration(durationMs) : `${dataTest.durationSeconds || "?"}s per iter`;
  return `DL ${dlBytes} / UL ${ulBytes} / ${durationText}`;
}

function iperfIntervalsShouldOpen(dataTest = {}) {
  if (dataTest.status === "running") return true;
  if (dataTest.status === "error" || dataTest.status === "partial") return true;
  return false;
}

function formatIperfIntervalSummary(parentIteration, sample = {}) {
  return formatIperfIntervalLine(parentIteration, sample).line;
}

const NATIVE_HTTP_SESSION_PAUSED_MESSAGE = "Paused - data test waiting to resume";

async function waitForSessionResumeGate(sessionPausedRef, signal, onPaused) {
  if (!sessionPausedRef?.current) return;
  if (typeof onPaused === "function") onPaused();
  await waitWhileSessionPaused(sessionPausedRef, signal);
}

async function measureThroughputPhaseWithSessionPause({
  measureFn,
  sessionPausedRef,
  sequenceSignal,
  phaseAbortRef,
  onPaused,
}) {
  while (true) {
    await waitWhileSessionPaused(sessionPausedRef, sequenceSignal);
    const phaseController = new AbortController();
    if (phaseAbortRef) phaseAbortRef.current = phaseController;

    const abortFromSequence = () => {
      if (!phaseController.signal.aborted) phaseController.abort();
    };
    if (sequenceSignal?.addEventListener) {
      sequenceSignal.addEventListener("abort", abortFromSequence, { once: true });
    }

    try {
      return await measureFn(phaseController.signal);
    } catch (error) {
      if (error?.name === "AbortError") {
        if (sequenceSignal?.aborted) throw error;
        if (sessionPausedRef?.current) {
          if (typeof onPaused === "function") onPaused();
          continue;
        }
      }
      throw error;
    } finally {
      if (phaseAbortRef) phaseAbortRef.current = null;
      if (sequenceSignal?.removeEventListener) {
        sequenceSignal.removeEventListener("abort", abortFromSequence);
      }
    }
  }
}

function waitWhileSessionPaused(sessionPausedRef, signal) {
  if (!sessionPausedRef?.current) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (signal?.aborted) {
        reject(makeAbortError());
        return;
      }
      if (!sessionPausedRef?.current) {
        resolve();
        return;
      }
      window.setTimeout(check, 500);
    };
    check();
  });
}

function waitForThroughputPause(waitSeconds, signal, onTick, sessionPausedRef) {
  const totalMs = Math.max(0, Number(waitSeconds || 0) * 1000);
  if (!totalMs) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let pausedAccumulatedMs = 0;
    let pauseStartedAt = null;
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
      if (sessionPausedRef?.current) {
        if (pauseStartedAt === null) pauseStartedAt = Date.now();
        const elapsed = Date.now() - startedAt - pausedAccumulatedMs;
        const remaining = Math.max(0, Math.ceil((totalMs - elapsed) / 1000));
        if (typeof onTick === "function") onTick(remaining);
        return;
      }
      if (pauseStartedAt !== null) {
        pausedAccumulatedMs += Date.now() - pauseStartedAt;
        pauseStartedAt = null;
      }
      const elapsed = Date.now() - startedAt - pausedAccumulatedMs;
      const remaining = Math.max(0, Math.ceil((totalMs - elapsed) / 1000));
      if (typeof onTick === "function") onTick(remaining);
      if (elapsed >= totalMs) {
        cleanup();
        resolve();
      }
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
    }, totalMs + 3600000);
  });
}

function shouldFallbackToWeb(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("not implemented") || message.includes("not available") || message.includes("plugin") || message.includes("web");
}

async function runNativeThroughputPhase({ phase, bytes, url, durationSeconds, intervalSeconds, warmupSeconds, signal }) {
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
      warmupSeconds,
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
      warmupSeconds: Number(response.warmupSeconds || 0),
      warmupBytes: Number(response.warmupBytes || 0),
      measuredBytes: Number(response.measuredBytes || response.bytes || 0),
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
    warmupSeconds: config.warmupSeconds,
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
  return { mbps: (received * 8) / seconds / 1000000, bytes: received, measuredBytes: received, warmupBytes: 0, warmupSeconds: 0, seconds };
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
    warmupSeconds: config.warmupSeconds,
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
  return { mbps: (body.byteLength * 8) / seconds / 1000000, bytes: body.byteLength, measuredBytes: body.byteLength, warmupBytes: 0, warmupSeconds: 0, seconds };
}

const EXPORT_ITEMS = [
  { title: "Summary CSV", description: "One clean row with task, grid, RF averages, THP averages, and voice monitor status." },
  { title: "Trace CSV", description: "One row per RF/GPS sample with LTE, NR, 3G, 2G, call state, and GPS fields." },
  { title: "THP Iteration CSV", description: "One row per DL/UL iteration with warmup bytes, measured bytes, seconds, Mbps, and source." },
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
  const reportName = String(session?.reportLogName || "").trim();
  const namePart = reportName ? cleanFilePart(reportName, "BabyDragon_Report") : cleanFilePart(taskName, "BabyDragon_Task");
  const mode = session?.mode === "voice" ? "Voice" : "Data";
  const started = session?.startedAt || session?.endedAt || Date.now();
  return cleanFilePart(`${namePart}_${mode}_RF_Report_${formatFileDateTime(started)}`, "BabyDragon_RF_Report");
}

const PAUSE_SUMMARY_RULE = "RF and TrafficStats averages exclude paused GPS-only samples. Paused wall time is excluded from active recording duration.";

function isActiveRfSample(sample) {
  if (!sample) return false;
  if (sample.recordState === "paused") return false;
  if (sample.recordState === "active") return true;
  return sample.recorded === true;
}

function buildRecordingStateSummary(session, endedAt) {
  const end = endedAt || Date.now();
  const start = session?.startedAt || end;
  const rawSegments = Array.isArray(session?.pauseSegments) ? session.pauseSegments : [];
  const pauseSegments = rawSegments
    .filter((segment) => segment?.startedAt)
    .map((segment) => ({
      startedAt: segment.startedAt,
      endedAt: segment.endedAt ?? end,
      startedAtIso: formatIso(segment.startedAt),
      endedAtIso: formatIso(segment.endedAt ?? end),
    }));
  const pausedDurationMs = pauseSegments.reduce(
    (sum, segment) => sum + Math.max(0, (segment.endedAt || end) - segment.startedAt),
    0,
  );
  const wallDurationMs = Math.max(0, end - start);
  const activeDurationMs = Math.max(0, wallDurationMs - pausedDurationMs);
  return {
    activeDurationMs,
    pausedDurationMs,
    pauseSegmentCount: pauseSegments.length,
    pauseSegments,
    pauseSummaryRule: PAUSE_SUMMARY_RULE,
  };
}

function closeOpenPauseSegment(session, endedAt) {
  const segments = Array.isArray(session?.pauseSegments) ? [...session.pauseSegments] : [];
  if (!segments.length) return segments;
  const lastIndex = segments.length - 1;
  const last = segments[lastIndex];
  if (last && !last.endedAt) {
    segments[lastIndex] = { ...last, endedAt };
  }
  return segments;
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
  const iperfSession = isIperf3Session(session);
  const ooklaSession = isOoklaSession(session);
  const fccSession = isFccSession(session);
  const ooklaIterations = resolveOoklaIterations(session);
  const ooklaEvidence = session?.appOoklaEvidence || ooklaIterations[ooklaIterations.length - 1] || {};
  const fccBaseName = fccSession ? buildFccFileBaseName(session, { activeTask, getTaskLabel, getTaskGrid }) : "";
  const recordingSummary = session?.recordingStateSummary || buildRecordingStateSummary(session, session?.endedAt);
  const headers = [
    "report_type", "report_log_name", "session_id", "mode", "fe", "task", "grid", "grid_internal_id",
    "session_started_local", "session_ended_local", "session_duration", "session_duration_ms",
    "active_recording_duration_sec", "paused_duration_sec", "pause_segment_count", "pause_summary_rule",
    "samples", "gps_points", "rat",
    "thp_started_local", "thp_ended_local", "thp_duration", "thp_duration_ms",
    "app_dl_avg_mbps", "app_ul_avg_mbps", "thp_iterations_requested", "thp_iterations_completed",
    "thp_requested_duration_sec", "thp_warmup_sec", "thp_interval_sec", "thp_wait_between_iterations_sec", "thp_direction",
    "thp_status", "thp_summary_rule", "report_scope",
    "external_evidence_provider", "ookla_iteration_count", "ookla_evidence_mode", "ookla_iterations_saved",
    "ookla_csv_rows_imported", "ookla_csv_rows_inside_window", "ookla_csv_rows_selected",
    "avg_ookla_dl_mbps", "avg_ookla_ul_mbps", "avg_ookla_ping_ms", "avg_ookla_jitter_ms",
    "min_ookla_dl_mbps", "max_ookla_dl_mbps", "min_ookla_ul_mbps", "max_ookla_ul_mbps",
    "ookla_evidence_completeness_summary",
    "fcc_import_status", "fcc_generated_evidence_file", "external_evidence_rule",
    "avg_lte_rsrp_dbm", "min_lte_rsrp_dbm", "max_lte_rsrp_dbm",
    "avg_lte_rsrq_db", "min_lte_rsrq_db", "max_lte_rsrq_db",
    "avg_lte_sinr_db", "min_lte_sinr_db", "max_lte_sinr_db",
    "avg_lte_rssi_dbm", "min_lte_rssi_dbm", "max_lte_rssi_dbm",
    "avg_nr_rsrp_dbm", "min_nr_rsrp_dbm", "max_nr_rsrp_dbm",
    "avg_nr_rsrq_db", "min_nr_rsrq_db", "max_nr_rsrq_db",
    "avg_nr_sinr_db", "min_nr_sinr_db", "max_nr_sinr_db",
    "avg_3g_rscp_dbm", "avg_3g_ecno_db", "avg_3g_rssi_dbm",
    "avg_2g_rssi_dbm", "avg_2g_ber", "avg_2g_timing_advance",
    "traffic_stats_avg_dl_mbps", "traffic_stats_avg_ul_mbps", "traffic_stats_sample_count",
    "traffic_stats_supported", "traffic_stats_source", "traffic_stats_summary_rule",
    "voice_monitor_status", "final_call_state", "offhook_samples", "remarks"
  ];

  const row = {
    report_type: "session_summary",
    report_log_name: textOrBlank(session?.reportLogName),
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
    active_recording_duration_sec: compactNumber((recordingSummary.activeDurationMs || 0) / 1000, 1),
    paused_duration_sec: compactNumber((recordingSummary.pausedDurationMs || 0) / 1000, 1),
    pause_segment_count: recordingSummary.pauseSegmentCount ?? "",
    pause_summary_rule: recordingSummary.pauseSummaryRule || PAUSE_SUMMARY_RULE,
    samples: session?.sampleCount ?? "",
    gps_points: session?.gpsCount ?? "",
    rat: session?.rat || "",
    thp_started_local: formatLocalDateTime(thpWindow.startedAt),
    thp_ended_local: formatLocalDateTime(thpWindow.endedAt),
    thp_duration: thpWindow.duration,
    thp_duration_ms: thpWindow.durationMs,
    app_dl_avg_mbps: (ooklaSession || fccSession) ? "N/A" : compactNumber(session?.appDlMbps, 2),
    app_ul_avg_mbps: (ooklaSession || fccSession) ? "N/A" : compactNumber(session?.appUlMbps, 2),
    thp_iterations_requested: session?.appIterationsRequested ?? "",
    thp_iterations_completed: session?.appCompletedIterations ?? "",
    thp_requested_duration_sec: session?.appDurationSeconds ?? "",
    thp_warmup_sec: session?.appWarmupSeconds ?? "",
    thp_interval_sec: session?.appIntervalSeconds ?? "",
    thp_wait_between_iterations_sec: session?.appWaitSeconds ?? "",
    thp_direction: session?.appDirection ?? "",
    thp_status: ooklaSession
      ? (session?.appExportStatus || mapOoklaExportStatus(session?.appTestStatus, ooklaEvidence, ooklaIterations) || "draft")
      : fccSession
        ? (session?.appExportStatus || mapFccExportStatus(session) || "draft")
        : (session?.appCompletedIterations && session?.appCompletedIterations === session?.appIterationsRequested ? "complete" : session?.appCompletedIterations ? "partial" : "not_run"),
    thp_summary_rule: iperfSession
      ? "Avg DL/UL THP is the arithmetic average of completed iPerf3 iteration rows only."
      : ooklaSession
        ? "OOKLA App DL/UL are FE-confirmed external manual evidence only. Native app DL/UL throughput columns remain N/A."
        : fccSession
          ? "FCC App data is external. BabyDragon-generated FCC evidence is session context only; not BabyDragon engine THP."
          : "Avg DL/UL THP is the arithmetic average of completed THP iterations only.",
    report_scope: iperfSession
      ? "Summary has one row. iPerf3 summary and interval details are in dedicated iPerf3 CSV/JSON files. RF/GPS sample rows are in RF_GPS_Trace CSV."
      : ooklaSession
        ? "Summary has one row. OOKLA manual evidence is in dedicated OOKLA CSV/JSON files. RF/GPS sample rows are in RF_GPS_Trace CSV."
        : fccSession
          ? "Summary has one row. BabyDragon FCC context evidence is in dedicated FCC Evidence CSV/JSON files. RF/GPS sample rows are in RF_GPS_Trace CSV."
          : "Summary has one row. THP iteration details are in THP_Iterations CSV. RF/GPS sample rows are in RF_GPS_Trace CSV.",
    external_evidence_provider: session?.appExternalEvidenceProvider || (ooklaSession ? "ookla_app" : fccSession ? "fcc_app" : ""),
    ookla_iteration_count: ooklaSession ? (ooklaIterations.length || "") : "",
    ...(ooklaSession ? (() => {
      const ooklaSummary = buildOoklaIterationSummary(ooklaIterations, session?.appOoklaCsvImportDebug || null);
      return {
        ookla_evidence_mode: ooklaSummary.ooklaEvidenceMode || resolveOoklaEvidenceMode(ooklaIterations) || "",
        ookla_iterations_saved: ooklaSummary.ooklaIterationsSaved ?? ooklaIterations.length,
        ookla_csv_rows_imported: ooklaSummary.csvRowsImported ?? "",
        ookla_csv_rows_inside_window: ooklaSummary.csvRowsInsideWindow ?? "",
        ookla_csv_rows_selected: ooklaSummary.csvRowsSelected ?? "",
        avg_ookla_dl_mbps: compactNumber(ooklaSummary.avgDlMbps, 2),
        avg_ookla_ul_mbps: compactNumber(ooklaSummary.avgUlMbps, 2),
        avg_ookla_ping_ms: compactNumber(ooklaSummary.avgPingMs, 1),
        avg_ookla_jitter_ms: compactNumber(ooklaSummary.avgJitterMs, 1),
        min_ookla_dl_mbps: compactNumber(ooklaSummary.minDlMbps, 2),
        max_ookla_dl_mbps: compactNumber(ooklaSummary.maxDlMbps, 2),
        min_ookla_ul_mbps: compactNumber(ooklaSummary.minUlMbps, 2),
        max_ookla_ul_mbps: compactNumber(ooklaSummary.maxUlMbps, 2),
        ookla_evidence_completeness_summary: ooklaSummary.evidenceCompletenessSummary
          ? JSON.stringify(ooklaSummary.evidenceCompletenessSummary)
          : "",
      };
    })() : {
      ookla_evidence_mode: "",
      ookla_iterations_saved: "",
      ookla_csv_rows_imported: "",
      ookla_csv_rows_inside_window: "",
      ookla_csv_rows_selected: "",
      avg_ookla_dl_mbps: "",
      avg_ookla_ul_mbps: "",
      avg_ookla_ping_ms: "",
      avg_ookla_jitter_ms: "",
      min_ookla_dl_mbps: "",
      max_ookla_dl_mbps: "",
      min_ookla_ul_mbps: "",
      max_ookla_ul_mbps: "",
      ookla_evidence_completeness_summary: "",
    }),
    fcc_import_status: fccSession ? (session?.appFccImport?.status || "not_imported") : "",
    fcc_iterations_saved: fccSession ? (resolveFccIterations(session).length || 0) : "",
    fcc_generated_evidence_file: fccSession && fccBaseName
      ? `${fccBaseName}_FCC_Evidence.csv; ${fccBaseName}_FCC_Evidence.json; ${fccBaseName}_FCC_Import_Metadata.json`
      : "",
    external_evidence_rule: ooklaSession
      ? "OOKLA App DL/UL/Ping/Jitter are external manual evidence only. APP DL/UL THP columns remain N/A."
      : fccSession
        ? "FCC App results are external imported evidence. BabyDragon RF/GPS/TrafficStats fields are context only; APP DL/UL THP remain N/A."
        : "",
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
    min_nr_rsrp_dbm: compactNumber(stats?.nrRsrp?.min, 1),
    max_nr_rsrp_dbm: compactNumber(stats?.nrRsrp?.max, 1),
    avg_nr_rsrq_db: compactNumber(stats?.nrRsrq?.avg ?? session?.avgNrRsrq, 1),
    min_nr_rsrq_db: compactNumber(stats?.nrRsrq?.min, 1),
    max_nr_rsrq_db: compactNumber(stats?.nrRsrq?.max, 1),
    avg_nr_sinr_db: compactNumber(stats?.nrSinr?.avg ?? session?.avgNrSinr, 1),
    min_nr_sinr_db: compactNumber(stats?.nrSinr?.min, 1),
    max_nr_sinr_db: compactNumber(stats?.nrSinr?.max, 1),
    avg_3g_rscp_dbm: compactNumber(stats?.threeGRscp?.avg ?? session?.avgThreeGRscp, 1),
    avg_3g_ecno_db: compactNumber(stats?.threeGEcno?.avg ?? session?.avgThreeGEcno, 1),
    avg_3g_rssi_dbm: compactNumber(stats?.threeGRssi?.avg ?? session?.avgThreeGRssi, 1),
    avg_2g_rssi_dbm: compactNumber(stats?.twoGRssi?.avg ?? session?.avgTwoGRssi, 1),
    avg_2g_ber: compactNumber(stats?.twoGBer?.avg ?? session?.avgTwoGBer, 1),
    avg_2g_timing_advance: compactNumber(stats?.twoGTimingAdvance?.avg ?? session?.avgTwoGTimingAdvance, 0),
    traffic_stats_avg_dl_mbps: compactNumber(session?.trafficStatsAvgDlMbps ?? stats?.trafficStatsDl?.avg, 2),
    traffic_stats_avg_ul_mbps: compactNumber(session?.trafficStatsAvgUlMbps ?? stats?.trafficStatsUl?.avg, 2),
    traffic_stats_sample_count: session?.trafficStatsSampleCount ?? stats?.trafficStatsDl?.count ?? "",
    traffic_stats_supported: session?.trafficStatsSupported ? "yes" : "no",
    traffic_stats_source: "mobile",
    traffic_stats_summary_rule: TRAFFIC_STATS_SUMMARY_RULE,
    voice_monitor_status: voice.voice_monitor_status,
    final_call_state: voice.final_call_state,
    offhook_samples: voice.offhook_samples,
    remarks: iperfSession
      ? "One clean session summary row. iPerf3 evidence is exported in dedicated iPerf3 CSV/JSON files."
      : ooklaSession
        ? "One clean session summary row. OOKLA manual evidence is exported in dedicated OOKLA CSV/JSON files."
        : fccSession
          ? "One clean session summary row. BabyDragon FCC context evidence is exported in dedicated FCC Evidence CSV/JSON files."
          : "One clean session summary row. Iteration details are in the THP_Iterations CSV.",
  };

  return makeCsv(headers, [row]);
}

function getPausedTraceExportFields() {
  return {
    rat: "",
    carrier: "",
    sim_carrier: "",
    network_operator: "",
    data_network_type: "",
    call_state: "",
    lte_pci: "",
    lte_earfcn: "",
    lte_tac: "",
    lte_cell_id: "",
    lte_rsrp_dbm: "",
    lte_rsrq_db: "",
    lte_sinr_db: "",
    lte_sinr_source: "",
    lte_rssi_dbm: "",
    nr_pci: "",
    nr_nrarfcn: "",
    nr_tac: "",
    nr_nci: "",
    nr_ss_rsrp_dbm: "",
    nr_ss_rsrq_db: "",
    nr_ss_sinr_db: "",
    nr_status: "",
    threeg_uarfcn: "",
    threeg_psc: "",
    threeg_lac: "",
    threeg_cell_id: "",
    threeg_rscp_dbm: "",
    threeg_ecno_db: "",
    twog_arfcn: "",
    twog_bsic: "",
    twog_lac: "",
    twog_cell_id: "",
    twog_rssi_dbm: "",
    twog_ber: "",
  };
}

function getPausedTraceTrafficStatsExportFields() {
  return {
    traffic_stats_supported: "",
    traffic_stats_source: "",
    traffic_stats_mobile_rx_bytes: "",
    traffic_stats_mobile_tx_bytes: "",
    traffic_stats_delta_rx_bytes: "",
    traffic_stats_delta_tx_bytes: "",
    traffic_stats_delta_sec: "",
    traffic_stats_dl_mbps: "",
    traffic_stats_ul_mbps: "",
    traffic_stats_total_rx_bytes: "",
    traffic_stats_total_tx_bytes: "",
    traffic_stats_total_delta_rx_bytes: "",
    traffic_stats_total_delta_tx_bytes: "",
    traffic_stats_total_dl_mbps: "",
    traffic_stats_total_ul_mbps: "",
    traffic_stats_counter_reset: "",
    traffic_stats_note: "paused_gps_only",
  };
}

function buildTraceCsv(session) {
  const samples = session?.exportSamples || session?.traceSamples || [];
  const headers = [
    "sample_index", "sample_id", "session_id", "timestamp_local", "timestamp_iso", "mode", "record_state", "recorded",
    "latitude", "longitude", "gps_accuracy_m", "gps_speed_mps", "rat", "carrier", "sim_carrier", "network_operator", "data_network_type", "call_state",
    "lte_pci", "lte_earfcn", "lte_tac", "lte_cell_id", "lte_rsrp_dbm", "lte_rsrq_db", "lte_sinr_db", "lte_sinr_source", "lte_rssi_dbm",
    "nr_pci", "nr_nrarfcn", "nr_tac", "nr_nci", "nr_ss_rsrp_dbm", "nr_ss_rsrq_db", "nr_ss_sinr_db", "nr_status",
    "threeg_uarfcn", "threeg_psc", "threeg_lac", "threeg_cell_id", "threeg_rscp_dbm", "threeg_ecno_db",
    "twog_arfcn", "twog_bsic", "twog_lac", "twog_cell_id", "twog_rssi_dbm", "twog_ber",
    "traffic_stats_supported", "traffic_stats_source", "traffic_stats_mobile_rx_bytes", "traffic_stats_mobile_tx_bytes",
    "traffic_stats_delta_rx_bytes", "traffic_stats_delta_tx_bytes", "traffic_stats_delta_sec",
    "traffic_stats_dl_mbps", "traffic_stats_ul_mbps",
    "traffic_stats_total_rx_bytes", "traffic_stats_total_tx_bytes",
    "traffic_stats_total_delta_rx_bytes", "traffic_stats_total_delta_tx_bytes",
    "traffic_stats_total_dl_mbps", "traffic_stats_total_ul_mbps",
    "traffic_stats_counter_reset", "traffic_stats_note",
  ];
  const rows = samples.map((sample, index) => {
    const isPausedGps = sample?.recordState === "paused";
    const fields = isPausedGps
      ? getPausedTraceExportFields()
      : getSnapshotExportFields(sample?.snapshot || {});
    const trafficFields = isPausedGps
      ? getPausedTraceTrafficStatsExportFields()
      : getTrafficStatsExportFields(sample?.trafficStats || {});
    return {
      sample_index: index + 1,
      sample_id: sample?.id || "",
      session_id: sample?.sessionId || session?.id || "",
      timestamp_local: formatLocalDateTime(sample?.timestamp),
      timestamp_iso: formatIso(sample?.timestamp),
      mode: sample?.mode || session?.mode || "",
      record_state: isPausedGps ? "paused" : "active",
      recorded: sample?.recorded ? "yes" : "no",
      latitude: compactNumber(sample?.gps?.lat, 7),
      longitude: compactNumber(sample?.gps?.lng, 7),
      gps_accuracy_m: compactNumber(sample?.gps?.accuracy, 1),
      gps_speed_mps: compactNumber(sample?.gps?.speed, 2),
      ...fields,
      ...trafficFields,
    };
  });
  return makeCsv(headers, rows);
}


function buildThpCsv(session) {
  const headers = [
    "iteration", "status", "task", "grid", "session_id",
    "started_at_local", "ended_at_local", "wall_seconds",
    "direction", "requested_duration_sec", "warmup_sec", "requested_dl_duration_sec", "requested_ul_duration_sec", "interval_sec", "wait_after_iteration_sec",
    "dl_mbps", "ul_mbps", "dl_warmup_bytes", "ul_warmup_bytes", "dl_measured_bytes", "ul_measured_bytes", "dl_total_bytes", "ul_total_bytes", "dl_transfer_seconds", "ul_transfer_seconds", "dl_wall_seconds", "ul_wall_seconds", "dl_source", "ul_source", "summary_note"
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
    requested_duration_sec: item.durationSeconds ?? session?.appDurationSeconds ?? "",
    warmup_sec: item.warmupSeconds ?? session?.appWarmupSeconds ?? 0,
    requested_dl_duration_sec: item.dlDurationSeconds ?? "",
    requested_ul_duration_sec: item.ulDurationSeconds ?? "",
    interval_sec: item.intervalSeconds ?? session?.appIntervalSeconds ?? "",
    wait_after_iteration_sec: item.iteration < totalRows ? (item.waitSeconds ?? session?.appWaitSeconds ?? "") : 0,
    dl_mbps: compactNumber(item.dlMbps, 2),
    ul_mbps: compactNumber(item.ulMbps, 2),
    dl_warmup_bytes: item.dlWarmupBytes || 0,
    ul_warmup_bytes: item.ulWarmupBytes || 0,
    dl_measured_bytes: item.dlMeasuredBytes || item.dlBytes || 0,
    ul_measured_bytes: item.ulMeasuredBytes || item.ulBytes || 0,
    dl_total_bytes: (item.dlBytes || 0) + (item.dlWarmupBytes || 0),
    ul_total_bytes: (item.ulBytes || 0) + (item.ulWarmupBytes || 0),
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
      min_ss_rsrp_dbm: jsonNumber(stats?.nrRsrp?.min, 1),
      max_ss_rsrp_dbm: jsonNumber(stats?.nrRsrp?.max, 1),
      avg_ss_rsrq_db: jsonNumber(stats?.nrRsrq?.avg ?? session?.avgNrRsrq, 1),
      min_ss_rsrq_db: jsonNumber(stats?.nrRsrq?.min, 1),
      max_ss_rsrq_db: jsonNumber(stats?.nrRsrq?.max, 1),
      avg_ss_sinr_db: jsonNumber(stats?.nrSinr?.avg ?? session?.avgNrSinr, 1),
      min_ss_sinr_db: jsonNumber(stats?.nrSinr?.min, 1),
      max_ss_sinr_db: jsonNumber(stats?.nrSinr?.max, 1),
    },
    wcdma: {
      avg_rscp_dbm: jsonNumber(stats?.threeGRscp?.avg ?? session?.avgThreeGRscp, 1),
      min_rscp_dbm: jsonNumber(stats?.threeGRscp?.min, 1),
      max_rscp_dbm: jsonNumber(stats?.threeGRscp?.max, 1),
      avg_ecno_db: jsonNumber(stats?.threeGEcno?.avg ?? session?.avgThreeGEcno, 1),
      min_ecno_db: jsonNumber(stats?.threeGEcno?.min, 1),
      max_ecno_db: jsonNumber(stats?.threeGEcno?.max, 1),
      avg_rssi_dbm: jsonNumber(stats?.threeGRssi?.avg ?? session?.avgThreeGRssi, 1),
      min_rssi_dbm: jsonNumber(stats?.threeGRssi?.min, 1),
      max_rssi_dbm: jsonNumber(stats?.threeGRssi?.max, 1),
    },
    gsm: {
      avg_rxlev_rssi_dbm: jsonNumber(stats?.twoGRssi?.avg ?? session?.avgTwoGRssi, 1),
      min_rxlev_rssi_dbm: jsonNumber(stats?.twoGRssi?.min, 1),
      max_rxlev_rssi_dbm: jsonNumber(stats?.twoGRssi?.max, 1),
      avg_ber: jsonNumber(stats?.twoGBer?.avg ?? session?.avgTwoGBer, 1),
      min_ber: jsonNumber(stats?.twoGBer?.min, 1),
      max_ber: jsonNumber(stats?.twoGBer?.max, 1),
      avg_timing_advance: jsonNumber(stats?.twoGTimingAdvance?.avg ?? session?.avgTwoGTimingAdvance, 0),
      min_timing_advance: jsonNumber(stats?.twoGTimingAdvance?.min, 0),
      max_timing_advance: jsonNumber(stats?.twoGTimingAdvance?.max, 0),
    },
    traffic_stats: {
      supported: session?.trafficStatsSupported === true,
      summary_rule: TRAFFIC_STATS_SUMMARY_RULE,
      note: TRAFFIC_STATS_NOTE,
      mobile: {
        supported: session?.trafficStatsMobileSupported !== false && session?.trafficStatsSupported === true,
        source: "mobile",
        avg_dl_mbps: jsonNumber(session?.trafficStatsAvgDlMbps ?? stats?.trafficStatsDl?.avg, 2),
        avg_ul_mbps: jsonNumber(session?.trafficStatsAvgUlMbps ?? stats?.trafficStatsUl?.avg, 2),
        min_dl_mbps: jsonNumber(stats?.trafficStatsDl?.min, 2),
        max_dl_mbps: jsonNumber(stats?.trafficStatsDl?.max, 2),
        min_ul_mbps: jsonNumber(stats?.trafficStatsUl?.min, 2),
        max_ul_mbps: jsonNumber(stats?.trafficStatsUl?.max, 2),
        sample_count: jsonNumber(session?.trafficStatsSampleCount ?? stats?.trafficStatsDl?.count),
      },
      total: {
        supported: session?.trafficStatsTotalSupported === true,
        source: "total",
        avg_dl_mbps: jsonNumber(session?.trafficStatsTotalAvgDlMbps ?? stats?.trafficStatsTotalDl?.avg, 2),
        avg_ul_mbps: jsonNumber(session?.trafficStatsTotalAvgUlMbps ?? stats?.trafficStatsTotalUl?.avg, 2),
        min_dl_mbps: jsonNumber(stats?.trafficStatsTotalDl?.min, 2),
        max_dl_mbps: jsonNumber(stats?.trafficStatsTotalDl?.max, 2),
        min_ul_mbps: jsonNumber(stats?.trafficStatsTotalUl?.min, 2),
        max_ul_mbps: jsonNumber(stats?.trafficStatsTotalUl?.max, 2),
        sample_count: jsonNumber(session?.trafficStatsTotalSampleCount ?? stats?.trafficStatsTotalDl?.count),
      },
    },
  };
}

function buildJsonTraceSamples(session) {
  const samples = session?.exportSamples || session?.traceSamples || [];
  return samples.map((sample, index) => {
    const isPausedGps = sample?.recordState === "paused";
    const baseSample = {
      sample_index: index + 1,
      sample_id: sample?.id || null,
      session_id: sample?.sessionId || session?.id || null,
      timestamp_local: formatLocalDateTime(sample?.timestamp) || null,
      timestamp_iso: jsonTimestamp(sample?.timestamp),
      mode: sample?.mode || session?.mode || null,
      record_state: isPausedGps ? "paused" : "active",
      recorded: isPausedGps ? false : Boolean(sample?.recorded),
      gps: {
        latitude: jsonNumber(sample?.gps?.lat, 7),
        longitude: jsonNumber(sample?.gps?.lng, 7),
        accuracy_m: jsonNumber(sample?.gps?.accuracy, 1),
        speed_mps: jsonNumber(sample?.gps?.speed, 2),
        bearing_deg: jsonNumber(sample?.gps?.bearing, 1),
      },
    };

    if (isPausedGps) {
      return {
        ...baseSample,
        network: null,
        lte: null,
        nr: null,
        wcdma: null,
        gsm: null,
        traffic_stats: null,
        note: "paused_gps_only",
      };
    }

    const fields = getSnapshotExportFields(sample?.snapshot || {});
    return {
      ...baseSample,
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
      traffic_stats: buildJsonTrafficStatsBlock(sample?.trafficStats),
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
    requested_duration_sec: jsonNumber(item.durationSeconds ?? session?.appDurationSeconds),
    warmup_sec: jsonNumber(item.warmupSeconds ?? session?.appWarmupSeconds ?? 0),
    requested_dl_duration_sec: jsonNumber(item.dlDurationSeconds),
    requested_ul_duration_sec: jsonNumber(item.ulDurationSeconds),
    interval_sec: jsonNumber(item.intervalSeconds ?? session?.appIntervalSeconds),
    wait_after_iteration_sec: item.iteration < totalRows ? jsonNumber(item.waitSeconds ?? session?.appWaitSeconds) : 0,
    dl: {
      mbps: jsonNumber(item.dlMbps, 2),
      measured_bytes: jsonNumber(item.dlMeasuredBytes ?? item.dlBytes),
      warmup_bytes: jsonNumber(item.dlWarmupBytes || 0),
      total_bytes: jsonNumber((item.dlBytes || 0) + (item.dlWarmupBytes || 0)),
      transfer_seconds: jsonNumber(item.dlSeconds, 3),
      wall_seconds: jsonNumber(item.dlWallSeconds, 3),
      source: jsonText(item.dlSource || item.source),
    },
    ul: {
      mbps: jsonNumber(item.ulMbps, 2),
      measured_bytes: jsonNumber(item.ulMeasuredBytes ?? item.ulBytes),
      warmup_bytes: jsonNumber(item.ulWarmupBytes || 0),
      total_bytes: jsonNumber((item.ulBytes || 0) + (item.ulWarmupBytes || 0)),
      transfer_seconds: jsonNumber(item.ulSeconds, 3),
      wall_seconds: jsonNumber(item.ulWallSeconds, 3),
      source: jsonText(item.ulSource || item.source),
    },
  }));
}

function buildJsonDataTest(session) {
  const thpWindow = getThpWindow(session);
  const thpRows = session?.appIterationResults || [];
  const windowBlock = {
    started_at_local: formatLocalDateTime(thpWindow.startedAt),
    started_at_iso: jsonTimestamp(thpWindow.startedAt),
    ended_at_local: formatLocalDateTime(thpWindow.endedAt),
    ended_at_iso: jsonTimestamp(thpWindow.endedAt),
    duration_ms: jsonNumber(thpWindow.durationMs),
    duration_text: thpWindow.duration || null,
  };
  const averagesBlock = {
    dl_mbps: jsonNumber(session?.appDlMbps, 2),
    ul_mbps: jsonNumber(session?.appUlMbps, 2),
  };

  if (isIperf3Session(session)) {
    const iperfModes = resolveIperfExportModes(session?.appCommand || "", session?.appSetupSnapshot || {});
    return {
      type: "iperf3_native",
      label: "iPerf3 Native",
      direction: session?.appDirectionLabel || session?.appDirection || null,
      status: session?.appExportStatus || mapIperfExportStatus(session?.appTestStatus) || null,
      summary_rule: "Average DL/UL THP is the arithmetic average of completed iPerf3 iteration rows only.",
      note: "Primary iPerf3 evidence is exported in dedicated iPerf3 CSV/JSON files.",
      requested: {
        server: jsonText(session?.appServer),
        port: jsonNumber(session?.appPort),
        protocol: jsonText(session?.appProtocol),
        streams: jsonNumber(session?.appStreams),
        iterations: jsonNumber(session?.appIterationsRequested ?? thpRows.length),
        duration_sec: jsonNumber(session?.appDurationSeconds),
        warmup_sec: jsonNumber(session?.appWarmupSeconds || 0),
        interval_sec: jsonNumber(session?.appIntervalSeconds),
        wait_between_iterations_sec: jsonNumber(session?.appWaitSeconds),
        reverse_mode: iperfModes.reverseMode,
        bidir_mode: iperfModes.bidirMode,
        command: jsonText(session?.appCommand),
      },
      window: windowBlock,
      averages: averagesBlock,
      completed_iterations: jsonNumber(session?.appCompletedIterations ?? thpRows.length),
      iterations: buildJsonThpIterations(session),
    };
  }

  if (isOoklaSession(session)) {
    const finalized = finalizeOoklaCsvTimeWindowOnExport({
      iterations: resolveOoklaIterations(session),
      csvImportDebug: session?.appOoklaCsvImportDebug || null,
      sessionStartMs: session?.startedAt ?? null,
      sessionEndMs: session?.endedAt ?? null,
      bufferSeconds: session?.appOoklaCsvImportDebug?.bufferSeconds ?? 60,
      exportStopMs: Date.now(),
    });
    const kpiWarmupDurationSec = resolveKpiWarmupDurationSec(session, DEFAULT_KPI_WARMUP_DURATION_SEC);
    const iterations = assignOoklaTrafficStatsWarmupEstimates(session, finalized.iterations, {
      kpiWarmupDurationSec,
    });
    const csvImportDebug = finalized.csvImportDebug;
    const evidence = session?.appOoklaEvidence || iterations[iterations.length - 1] || {};
    const ooklaSummary = buildOoklaIterationSummary(iterations, csvImportDebug);
    return {
      type: "ookla_app_external",
      label: "OOKLA App External Evidence",
      status: session?.appExportStatus || mapOoklaExportStatus(session?.appTestStatus, evidence, iterations) || null,
      summary_rule: "OOKLA App DL/UL/Ping/Jitter are external evidence only. APP DL/UL THP remain null/N/A.",
      note: "OOKLA iterations live in Report.json and OOKLA_Evidence.csv. Native app DL/UL throughput fields remain null.",
      app_dl_thp_mbps: null,
      app_ul_thp_mbps: null,
      external_evidence: {
        provider: "ookla_app",
        source: jsonText(evidence.evidenceSource || evidence.source),
        confirmation: jsonText(evidence.confirmation),
        iteration_count: jsonNumber(iterations.length),
        captured_at_iso: jsonTimestamp(evidence.capturedAt),
        fe_confirmed_at_iso: jsonTimestamp(evidence.feConfirmedAt),
        dl_mbps: jsonNumber(evidence.dlMbps, 2),
        ul_mbps: jsonNumber(evidence.ulMbps, 2),
        ping_ms: jsonNumber(evidence.pingMs, 1),
        jitter_ms: jsonNumber(evidence.jitterMs, 1),
        server_name: jsonText(evidence.serverName),
        provider_name: jsonText(evidence.providerName),
        result_url: jsonText(evidence.resultUrl),
        result_id: jsonText(evidence.resultId),
        notes: jsonText(evidence.notes),
        ocr_assist_used: Boolean(evidence.ocrAssistUsed),
        ocr_source: jsonText(evidence.ocrSource),
        ocr_confidence: jsonNumber(evidence.ocrConfidence),
        screenshot_attached: Boolean(evidence.mainScreenshot || evidence.screenshot),
        screenshot_filename: jsonText((evidence.mainScreenshot || evidence.screenshot)?.fileName),
        screenshot_storage_key: jsonText((evidence.mainScreenshot || evidence.screenshot)?.storageKey),
      },
      ookla_summary: ooklaSummary,
      csv_import_summary: csvImportDebug
        ? {
          source_file_name: csvImportDebug.sourceFileName || null,
          imported_at: csvImportDebug.importedAt || null,
          stats: csvImportDebug.stats || null,
          buffer_seconds: csvImportDebug.bufferSeconds ?? 60,
          session_start_time: csvImportDebug.sessionStartTime || null,
          session_end_time: csvImportDebug.sessionEndTime || null,
          csvRowsImported: csvImportDebug.csvRowsImported ?? csvImportDebug.stats?.imported ?? null,
          csvRowsInsideWindow: csvImportDebug.csvRowsInsideWindow ?? csvImportDebug.stats?.insideWindow ?? null,
          csvRowsSelected: csvImportDebug.csvRowsSelected ?? csvImportDebug.stats?.selected ?? null,
          duplicates: csvImportDebug.duplicates ?? csvImportDebug.stats?.duplicates ?? null,
        }
        : null,
      ookla_iterations: iterations.map((item) => {
        const mainScreenshot = item.mainScreenshot || item.screenshot || null;
        const detailedScreenshot = item.detailedScreenshot || null;
        const matched = matchNearestActiveRfSample(session, item);
        return {
          iterationNumber: jsonNumber(item.iterationNumber),
          evidenceSource: jsonText(item.evidenceSource || item.source),
          confirmation: jsonText(item.confirmation),
          ooklaDateTime: jsonText(item.ooklaDateTime || item.testDateTime),
          dlMbps: jsonNumber(item.dlMbps, 2),
          ulMbps: jsonNumber(item.ulMbps, 2),
          pingMs: jsonNumber(item.pingMs, 1),
          jitterMs: jsonNumber(item.jitterMs, 1),
          resultId: jsonText(item.resultId),
          resultUrl: jsonText(item.resultUrl),
          providerName: jsonText(item.providerName),
          serverName: jsonText(item.serverName),
          serverLocation: jsonText(item.serverLocation),
          connectionType: jsonText(item.connectionType),
          deviceName: jsonText(item.deviceName),
          connectionsMode: jsonText(item.connectionsMode),
          packetLossPercent: jsonNumber(item.packetLossPercent, 2),
          ooklaUserLatitude: jsonNumber(item.ooklaUserLatitude, 6),
          ooklaUserLongitude: jsonNumber(item.ooklaUserLongitude, 6),
          downloadSizeBytes: jsonNumber(item.downloadSizeBytes),
          uploadSizeBytes: jsonNumber(item.uploadSizeBytes),
          internalIp: jsonText(item.internalIp),
          externalIp: jsonText(item.externalIp),
          fieldSources: item.fieldSources || {},
          evidenceCompleteness: jsonText(item.evidenceCompleteness),
          missingFields: Array.isArray(item.missingFields) ? item.missingFields : [],
          mainScreenshot: mainScreenshot
            ? {
              fileName: jsonText(mainScreenshot.fileName),
              storageKey: jsonText(mainScreenshot.storageKey),
              mimeType: jsonText(mainScreenshot.mimeType),
              sizeBytes: jsonNumber(mainScreenshot.sizeBytes),
            }
            : null,
          detailedScreenshot: detailedScreenshot
            ? {
              fileName: jsonText(detailedScreenshot.fileName),
              storageKey: jsonText(detailedScreenshot.storageKey),
              mimeType: jsonText(detailedScreenshot.mimeType),
              sizeBytes: jsonNumber(detailedScreenshot.sizeBytes),
            }
            : null,
          csvImportMeta: item.csvImportMeta || null,
          matchedRf: matched,
          trafficStatsWarmupEstimate: item.trafficStatsWarmupEstimate || null,
          capturedAt: jsonTimestamp(item.capturedAt),
          savedAt: jsonTimestamp(item.savedAt),
        };
      }),
      window: windowBlock,
      averages: { dl_mbps: null, ul_mbps: null },
      completed_iterations: null,
      iterations: [],
    };
  }

  if (isFccSession(session)) {
    const generated = session?.appFccGeneratedEvidence || {};
    const fccIterations = resolveFccIterations(session);
    const fccSummary = buildFccIterationSummary(fccIterations, session?.appFccImport || null);
    return {
      type: "fcc_app",
      label: "FCC App External Evidence",
      status: session?.appExportStatus || mapFccExportStatus(session) || null,
      summary_rule: "FCC App results are external imported evidence. BabyDragon RF/GPS/TrafficStats fields are context captured by BabyDragon and are not FCC official throughput.",
      note: "APP DL/UL THP remain null/N/A. Imported FCC KPIs are in dedicated FCC Evidence CSV/JSON files.",
      external_evidence: {
        provider: "fcc_app",
      },
      fcc_generated_evidence: generated,
      fcc_import: session?.appFccImport || { status: "not_imported" },
      fcc_evidence_iterations: fccIterations,
      fcc_iteration_summary: fccSummary,
      appDlMbps: null,
      appUlMbps: null,
      window: windowBlock,
      averages: { dl_mbps: null, ul_mbps: null },
      completed_iterations: fccIterations.length || null,
      iterations: [],
    };
  }

  return {
    type: "native_android_http",
    direction: session?.appDirection || null,
    status: session?.appTestStatus || null,
    summary_rule: "Average DL/UL THP is the arithmetic average of completed iteration rows only.",
    requested: {
      iterations: jsonNumber(session?.appIterationsRequested ?? session?.appIterations ?? thpRows.length),
      duration_sec: jsonNumber(session?.appDurationSeconds),
      warmup_sec: jsonNumber(session?.appWarmupSeconds || 0),
      interval_sec: jsonNumber(session?.appIntervalSeconds),
      wait_between_iterations_sec: jsonNumber(session?.appWaitSeconds),
    },
    window: windowBlock,
    averages: averagesBlock,
    completed_iterations: jsonNumber(session?.appCompletedIterations ?? thpRows.length),
    iterations: buildJsonThpIterations(session),
  };
}

function buildJsonReport(session, user, activeTask, baseName, generatedAt) {
  const voice = buildVoiceSummary(session);
  const samples = session?.exportSamples || session?.traceSamples || [];
  const iperfSession = isIperf3Session(session);
  const ooklaSession = isOoklaSession(session);
  const fccSession = isFccSession(session);
  const recordingSummary = session?.recordingStateSummary || buildRecordingStateSummary(session, session?.endedAt);
  return JSON.stringify({
    schema: {
      name: "BabyDragon Android Info RF Report",
      version: "1.0.1-step-1f10a",
      layout: "fcc_like_structured_json",
      owner: "MobbiTech Global LLC",
      note: "BabyDragon JSON is FCC-style for interoperability, but not an FCC-certified result unless imported from the FCC app export.",
    },
    report: {
      display_name: baseName,
      generated_at_local: formatLocalDateTime(generatedAt),
      generated_at_iso: jsonTimestamp(generatedAt),
      files_expected: iperfSession
        ? ["summary_csv", "rf_gps_trace_csv", "iperf3_csv", "iperf3_json", "voice_kpis_csv", "json"]
        : ooklaSession
          ? ["report_json", "rf_gps_trace_csv", "ookla_evidence_csv"]
          : fccSession
            ? ["summary_csv", "rf_gps_trace_csv", "fcc_evidence_csv", "fcc_evidence_json", "voice_kpis_csv", "json"]
            : ["summary_csv", "rf_gps_trace_csv", "thp_iterations_csv", "voice_kpis_csv", "json"],
    },
    session: {
      session_id: session?.id || null,
      report_log_name: jsonText(session?.reportLogName) || null,
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
      kpi_warmup_duration_sec: jsonNumber(resolveKpiWarmupDurationSec(session, DEFAULT_KPI_WARMUP_DURATION_SEC)),
      recording_state_summary: {
        active_duration_ms: jsonNumber(recordingSummary.activeDurationMs),
        paused_duration_ms: jsonNumber(recordingSummary.pausedDurationMs),
        pause_segment_count: jsonNumber(recordingSummary.pauseSegmentCount),
        pause_segments: (recordingSummary.pauseSegments || []).map((segment) => ({
          started_at_iso: segment.startedAtIso || jsonTimestamp(segment.startedAt),
          ended_at_iso: segment.endedAtIso || jsonTimestamp(segment.endedAt),
        })),
        pause_summary_rule: recordingSummary.pauseSummaryRule || PAUSE_SUMMARY_RULE,
      },
    },
    rf_summary: buildJsonRfSummary(session),
    data_test: buildJsonDataTest(session),
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

function buildReportPackage({
  session,
  user,
  activeTask,
  includeDeveloperDebugExport = INCLUDE_DEVELOPER_DEBUG_EXPORT_DEFAULT,
}) {
  const generatedAt = Date.now();
  const baseName = buildProfessionalReportName(session, activeTask);
  // Unique folder per export action so MediaStore never creates "file (1)" duplicates in-folder.
  const exportStamp = (() => {
    const date = new Date(generatedAt);
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  })();
  const sessionId = cleanFilePart(`${baseName}_${exportStamp}`, `bd-rf-${generatedAt}`);
  const iperfSession = isIperf3Session(session);
  const ooklaSession = isOoklaSession(session);
  const fccSession = isFccSession(session);

  // Final OOKLA export contract: Report.json + RF_GPS_Trace.csv + OOKLA_Evidence.csv only.
  if (ooklaSession) {
    const evidenceFile = buildOoklaEvidenceExportFile({
      session,
      user,
      activeTask,
      getTaskLabel,
      getTaskGrid,
      baseName,
    });
    const files = [
      {
        fileName: `${baseName}_Report.json`,
        reportLabel: "Report JSON",
        mimeType: "application/json",
        content: buildJsonReport(session, user, activeTask, baseName, generatedAt),
      },
      {
        fileName: `${baseName}_RF_GPS_Trace.csv`,
        reportLabel: "RF/GPS Trace CSV",
        mimeType: "text/csv",
        content: buildTraceCsv(session),
      },
      evidenceFile,
    ];
    // Deduplicate by fileName in case a helper accidentally returns a repeat.
    const uniqueFiles = [];
    const seenNames = new Set();
    files.forEach((file) => {
      const name = String(file?.fileName || "").trim();
      if (!name || seenNames.has(name)) return;
      seenNames.add(name);
      uniqueFiles.push(file);
    });
    if (includeDeveloperDebugExport) {
      uniqueFiles.push(...buildOoklaDeveloperDebugFiles({
        session,
        user,
        activeTask,
        getTaskLabel,
        getTaskGrid,
      }));
    }
    return {
      sessionId,
      displayName: baseName,
      generatedAt,
      files: uniqueFiles,
      iperfSession: false,
      ooklaSession: true,
      fccSession: false,
      includeDeveloperDebugExport: Boolean(includeDeveloperDebugExport),
    };
  }

  const files = [
    { fileName: `${baseName}_Summary.csv`, reportLabel: "Summary CSV", mimeType: "text/csv", content: buildSummaryCsv(session, user, activeTask) },
    { fileName: `${baseName}_RF_GPS_Trace.csv`, reportLabel: "RF/GPS Trace CSV", mimeType: "text/csv", content: buildTraceCsv(session) },
  ];

  if (iperfSession) {
    files.push(...buildIperf3ReportFiles({
      session,
      user,
      activeTask,
      getTaskLabel,
      getTaskGrid,
    }));
  } else if (fccSession) {
    // Final FCC export contract: exactly 3 FCC evidence files (no THP / OOKLA / extra debug).
    // Use sessionId as both folder name and file prefix (same Reports/<sessionId>/ pattern as Data RF / OOKLA).
    const fccFiles = buildFccReportFiles({
      session,
      user,
      activeTask,
      getTaskLabel,
      getTaskGrid,
      baseName: sessionId,
    });
    return {
      sessionId,
      displayName: sessionId,
      generatedAt,
      files: fccFiles,
      iperfSession: false,
      ooklaSession: false,
      fccSession: true,
      includeDeveloperDebugExport: false,
    };
  } else {
    files.push({
      fileName: `${baseName}_THP_Iterations.csv`,
      reportLabel: "THP Iterations CSV",
      mimeType: "text/csv",
      content: buildThpCsv(session),
    });
  }

  files.push(
    { fileName: `${baseName}_Voice_KPIs.csv`, reportLabel: "Voice KPI CSV", mimeType: "text/csv", content: buildVoiceCsv(session, activeTask) },
    { fileName: `${baseName}_Report.json`, reportLabel: "FCC-style JSON", mimeType: "application/json", content: buildJsonReport(session, user, activeTask, baseName, generatedAt) },
  );

  return {
    sessionId,
    displayName: baseName,
    generatedAt,
    files,
    iperfSession,
    ooklaSession: false,
    fccSession,
    includeDeveloperDebugExport: false,
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
    // Pass explicit folder + file payload (native creates Downloads/BabyDragon/Reports/<sessionId>/).
    const sessionId = cleanFilePart(reportPackage?.sessionId, `bd-rf-${Date.now()}`);
    const response = await BabyDragonRfKpi.saveReportFiles({
      sessionId,
      displayName: String(reportPackage?.displayName || sessionId),
      files: Array.isArray(reportPackage?.files) ? reportPackage.files : [],
    });
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
  if (row.trafficMetric) {
    const live = getTrafficStatsLive(row.trafficMetric, dataContext.samples || []);
    return live === "N/A" ? live : formatThroughputWithUnit(live);
  }

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
  if (kpi.includes("sinr")) {
    if (group.includes("nr")) return displayValue(value);
    return displayWithSource(value, cell?.sinrSource);
  }
  return displayValue(value);
}

function averageForRow(row, samples, snapshot, activeFamily = true, dataContext = {}) {
  if (row.dataMetric) {
    const value = pickThroughputValue(row.dataMetric, dataContext);
    return value === null ? "N/A" : formatThroughputValue(value);
  }
  if (row.trafficMetric) {
    const stats = metricStatsFromTrafficSamples(samples, row.trafficMetric);
    if (stats.avg === null) return "N/A";
    return formatThroughputValue(stats.avg);
  }
  if (!activeFamily || row.avgMode === "none" || row.planned) return "N/A";

  const pool = (samples && samples.length ? samples : snapshot ? [{ snapshot }] : [])
    .filter((sample) => !sample?.recordState || isActiveRfSample(sample));
  const values = pool
    .map((sample) => getMetricValue(row, sample.snapshot))
    .filter((value) => typeof value === "number" && Number.isFinite(value));

  if (!values.length) return "N/A";
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Number.isInteger(avg) ? String(avg) : avg.toFixed(1);
}

function statusForRow(row, snapshot, selectedRatKey = "auto", activeFamily = true, dataContext = {}) {
  if (row.dataMetric) return throughputStatus(row.dataMetric, dataContext);
  if (row.trafficMetric) {
    const live = getTrafficStatsLive(row.trafficMetric, dataContext.samples || []);
    return live === "N/A" ? "N/A" : "Live";
  }
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
  const activeSamples = (samples || []).filter(isActiveRfSample);
  const avgSamples = activeSamples.length ? activeSamples : (samples || []);
  const mergedContext = { ...dataContext, samples: avgSamples };
  return rows.map((row) => ({
    ...row,
    live: getLiveForRow(row, snapshot, selectedRatKey, activeFamily, mergedContext),
    avg: averageForRow(row, avgSamples, snapshot, activeFamily, mergedContext),
    status: statusForRow(row, snapshot, selectedRatKey, activeFamily, mergedContext),
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
  if (testState === "recording") return "Recording";
  if (testState === "paused") return "Paused · GPS only";
  if (testState === "saved") return "Saved";
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

const TRAFFIC_STATS_NOTE = "android_mobile_and_total_byte_delta";
const TRAFFIC_STATS_SUMMARY_RULE = "Android mobile/total byte deltas; not OOKLA result; not BabyDragon engine THP";

function readNativeTrafficStatsBlock(snapshot = {}) {
  const block = snapshot?.trafficStats && typeof snapshot.trafficStats === "object"
    ? snapshot.trafficStats
    : snapshot;
  const mobileRx = getNumber(block?.trafficStatsMobileRxBytes);
  const mobileTx = getNumber(block?.trafficStatsMobileTxBytes);
  const totalRx = getNumber(block?.trafficStatsTotalRxBytes);
  const totalTx = getNumber(block?.trafficStatsTotalTxBytes);
  const mobileSupported = (
    block?.trafficStatsMobileSupported === true
    || (block?.trafficStatsMobileSupported !== false && mobileRx !== null && mobileTx !== null)
  ) && mobileRx !== null && mobileTx !== null;
  const totalSupported = (
    block?.trafficStatsTotalSupported === true
    || (block?.trafficStatsTotalSupported !== false && totalRx !== null && totalTx !== null)
  ) && totalRx !== null && totalTx !== null;
  const supported = mobileSupported || totalSupported;
  let source = "unsupported";
  if (mobileSupported && totalSupported) source = "mobile_and_total";
  else if (totalSupported) source = "total";
  else if (mobileSupported) source = "mobile";

  return {
    trafficStatsSupported: supported,
    trafficStatsMobileSupported: mobileSupported,
    trafficStatsTotalSupported: totalSupported,
    trafficStatsSource: source,
    trafficStatsMobileRxBytes: mobileSupported ? mobileRx : null,
    trafficStatsMobileTxBytes: mobileSupported ? mobileTx : null,
    trafficStatsTotalRxBytes: totalSupported ? totalRx : null,
    trafficStatsTotalTxBytes: totalSupported ? totalTx : null,
    trafficStatsReadAt: block?.trafficStatsReadAt || snapshot?.timestamp || null,
  };
}

function buildSampleTrafficStats(snapshot = {}, previousSample = null, now = Date.now(), options = {}) {
  const skipDelta = options?.skipDelta === true;
  const native = readNativeTrafficStatsBlock(snapshot);
  const base = {
    trafficStatsSupported: native.trafficStatsSupported,
    trafficStatsMobileSupported: native.trafficStatsMobileSupported,
    trafficStatsTotalSupported: native.trafficStatsTotalSupported,
    trafficStatsSource: native.trafficStatsSource,
    trafficStatsMobileRxBytes: native.trafficStatsMobileRxBytes,
    trafficStatsMobileTxBytes: native.trafficStatsMobileTxBytes,
    trafficStatsTotalRxBytes: native.trafficStatsTotalRxBytes,
    trafficStatsTotalTxBytes: native.trafficStatsTotalTxBytes,
    trafficStatsDeltaRxBytes: null,
    trafficStatsDeltaTxBytes: null,
    trafficStatsTotalDeltaRxBytes: null,
    trafficStatsTotalDeltaTxBytes: null,
    trafficStatsDeltaSec: null,
    trafficStatsDlMbps: null,
    trafficStatsUlMbps: null,
    trafficStatsTotalDlMbps: null,
    trafficStatsTotalUlMbps: null,
    trafficStatsCounterReset: false,
    trafficStatsInvalid: !native.trafficStatsSupported,
    trafficStatsNote: TRAFFIC_STATS_NOTE,
  };

  if (!native.trafficStatsSupported) return base;

  if (skipDelta) {
    return {
      ...base,
      trafficStatsInvalid: true,
      trafficStatsNote: "baseline_reset_after_pause",
    };
  }

  const prevStats = previousSample?.trafficStats;
  if (!prevStats?.trafficStatsSupported || previousSample?.recordState === "paused") return base;

  const prevAt = getNumber(previousSample?.timestamp);
  if (prevAt === null) {
    return { ...base, trafficStatsInvalid: true };
  }

  const deltaSec = (now - prevAt) / 1000;
  if (!Number.isFinite(deltaSec) || deltaSec <= 0 || deltaSec > 10) {
    return { ...base, trafficStatsInvalid: true };
  }

  let mobileReset = false;
  let totalReset = false;
  let mobileDeltaRx = null;
  let mobileDeltaTx = null;
  let mobileDl = null;
  let mobileUl = null;
  if (native.trafficStatsMobileSupported) {
    const prevRx = getNumber(prevStats.trafficStatsMobileRxBytes);
    const prevTx = getNumber(prevStats.trafficStatsMobileTxBytes);
    if (prevRx !== null && prevTx !== null) {
      if (native.trafficStatsMobileRxBytes < prevRx || native.trafficStatsMobileTxBytes < prevTx) {
        mobileReset = true;
      } else {
        mobileDeltaRx = native.trafficStatsMobileRxBytes - prevRx;
        mobileDeltaTx = native.trafficStatsMobileTxBytes - prevTx;
        const dlMbps = (mobileDeltaRx * 8) / deltaSec / 1_000_000;
        const ulMbps = (mobileDeltaTx * 8) / deltaSec / 1_000_000;
        mobileDl = Number.isFinite(dlMbps) && dlMbps >= 0 ? dlMbps : null;
        mobileUl = Number.isFinite(ulMbps) && ulMbps >= 0 ? ulMbps : null;
      }
    }
  }

  // Total counters are independent of mobile. Wi-Fi bursts must still compute when mobile is 0/reset.
  let totalDeltaRx = null;
  let totalDeltaTx = null;
  let totalDl = null;
  let totalUl = null;
  if (native.trafficStatsTotalSupported) {
    const prevTotalRx = getNumber(prevStats.trafficStatsTotalRxBytes);
    const prevTotalTx = getNumber(prevStats.trafficStatsTotalTxBytes);
    if (prevTotalRx !== null && prevTotalTx !== null) {
      if (native.trafficStatsTotalRxBytes < prevTotalRx || native.trafficStatsTotalTxBytes < prevTotalTx) {
        totalReset = true;
      } else {
        totalDeltaRx = native.trafficStatsTotalRxBytes - prevTotalRx;
        totalDeltaTx = native.trafficStatsTotalTxBytes - prevTotalTx;
        const dlMbps = (totalDeltaRx * 8) / deltaSec / 1_000_000;
        const ulMbps = (totalDeltaTx * 8) / deltaSec / 1_000_000;
        totalDl = Number.isFinite(dlMbps) && dlMbps >= 0 ? dlMbps : null;
        totalUl = Number.isFinite(ulMbps) && ulMbps >= 0 ? ulMbps : null;
      }
    }
  }

  const counterReset = mobileReset || totalReset;
  // Only invalidate the sample when BOTH families failed to produce a rate.
  const anyRate = mobileDl !== null || mobileUl !== null || totalDl !== null || totalUl !== null;
  if (counterReset && !anyRate) {
    return {
      ...base,
      trafficStatsCounterReset: true,
      trafficStatsInvalid: true,
      trafficStatsDeltaSec: Number(deltaSec.toFixed(3)),
    };
  }

  return {
    ...base,
    trafficStatsDeltaRxBytes: mobileDeltaRx,
    trafficStatsDeltaTxBytes: mobileDeltaTx,
    trafficStatsTotalDeltaRxBytes: totalDeltaRx,
    trafficStatsTotalDeltaTxBytes: totalDeltaTx,
    trafficStatsDeltaSec: Number(deltaSec.toFixed(3)),
    trafficStatsDlMbps: mobileDl,
    trafficStatsUlMbps: mobileUl,
    trafficStatsTotalDlMbps: totalDl,
    trafficStatsTotalUlMbps: totalUl,
    trafficStatsCounterReset: counterReset && !anyRate,
    trafficStatsInvalid: !anyRate,
  };
}

function trafficStatsField(metric, scope = "mobile") {
  if (scope === "total") {
    return metric === "ul" ? "trafficStatsTotalUlMbps" : "trafficStatsTotalDlMbps";
  }
  return metric === "ul" ? "trafficStatsUlMbps" : "trafficStatsDlMbps";
}

function isValidTrafficStatsSample(sample) {
  const stats = sample?.trafficStats;
  return Boolean(stats?.trafficStatsSupported && !stats?.trafficStatsInvalid);
}

function getTrafficStatsLive(metric, samples = []) {
  const field = trafficStatsField(metric);
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const sample = samples[index];
    if (!isActiveRfSample(sample)) continue;
    if (!isValidTrafficStatsSample(sample)) continue;
    const value = getNumber(sample.trafficStats?.[field]);
    if (value !== null) return formatThroughputValue(value);
  }
  return "N/A";
}

function metricStatsFromTrafficSamples(samples, metric, scope = "mobile") {
  const field = trafficStatsField(metric, scope);
  const values = (samples || [])
    .filter((sample) => isActiveRfSample(sample) && isValidTrafficStatsSample(sample))
    .map((sample) => getNumber(sample.trafficStats?.[field]))
    .filter((value) => value !== null);

  if (!values.length) return { count: 0, avg: null, min: null, max: null };
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    count: values.length,
    avg,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function getTrafficStatsExportFields(trafficStats = {}) {
  const supported = trafficStats.trafficStatsSupported === true;
  return {
    traffic_stats_supported: supported ? "yes" : "no",
    traffic_stats_source: trafficStats.trafficStatsSource || "mobile",
    traffic_stats_mobile_rx_bytes: compactNumber(trafficStats.trafficStatsMobileRxBytes, 0),
    traffic_stats_mobile_tx_bytes: compactNumber(trafficStats.trafficStatsMobileTxBytes, 0),
    traffic_stats_delta_rx_bytes: compactNumber(trafficStats.trafficStatsDeltaRxBytes, 0),
    traffic_stats_delta_tx_bytes: compactNumber(trafficStats.trafficStatsDeltaTxBytes, 0),
    traffic_stats_delta_sec: compactNumber(trafficStats.trafficStatsDeltaSec, 3),
    traffic_stats_dl_mbps: compactNumber(trafficStats.trafficStatsDlMbps, 2),
    traffic_stats_ul_mbps: compactNumber(trafficStats.trafficStatsUlMbps, 2),
    traffic_stats_total_rx_bytes: compactNumber(trafficStats.trafficStatsTotalRxBytes, 0),
    traffic_stats_total_tx_bytes: compactNumber(trafficStats.trafficStatsTotalTxBytes, 0),
    traffic_stats_total_delta_rx_bytes: compactNumber(trafficStats.trafficStatsTotalDeltaRxBytes, 0),
    traffic_stats_total_delta_tx_bytes: compactNumber(trafficStats.trafficStatsTotalDeltaTxBytes, 0),
    traffic_stats_total_dl_mbps: compactNumber(trafficStats.trafficStatsTotalDlMbps, 2),
    traffic_stats_total_ul_mbps: compactNumber(trafficStats.trafficStatsTotalUlMbps, 2),
    traffic_stats_counter_reset: trafficStats.trafficStatsCounterReset ? "yes" : "no",
    traffic_stats_note: trafficStats.trafficStatsNote || TRAFFIC_STATS_NOTE,
  };
}

function buildJsonTrafficStatsBlock(trafficStats = {}) {
  if (!trafficStats || typeof trafficStats !== "object") return null;
  return {
    supported: trafficStats.trafficStatsSupported === true,
    source: jsonText(trafficStats.trafficStatsSource) || "mobile",
    delta_sec: jsonNumber(trafficStats.trafficStatsDeltaSec, 3),
    counter_reset: trafficStats.trafficStatsCounterReset === true,
    invalid: trafficStats.trafficStatsInvalid === true,
    note: jsonText(trafficStats.trafficStatsNote) || TRAFFIC_STATS_NOTE,
    mobile: {
      supported: trafficStats.trafficStatsMobileSupported === true
        || (trafficStats.trafficStatsMobileRxBytes != null && trafficStats.trafficStatsMobileTxBytes != null),
      rx_bytes: jsonNumber(trafficStats.trafficStatsMobileRxBytes),
      tx_bytes: jsonNumber(trafficStats.trafficStatsMobileTxBytes),
      delta_rx_bytes: jsonNumber(trafficStats.trafficStatsDeltaRxBytes),
      delta_tx_bytes: jsonNumber(trafficStats.trafficStatsDeltaTxBytes),
      dl_mbps: jsonNumber(trafficStats.trafficStatsDlMbps, 2),
      ul_mbps: jsonNumber(trafficStats.trafficStatsUlMbps, 2),
    },
    total: {
      supported: trafficStats.trafficStatsTotalSupported === true
        || (trafficStats.trafficStatsTotalRxBytes != null && trafficStats.trafficStatsTotalTxBytes != null),
      rx_bytes: jsonNumber(trafficStats.trafficStatsTotalRxBytes),
      tx_bytes: jsonNumber(trafficStats.trafficStatsTotalTxBytes),
      delta_rx_bytes: jsonNumber(trafficStats.trafficStatsTotalDeltaRxBytes),
      delta_tx_bytes: jsonNumber(trafficStats.trafficStatsTotalDeltaTxBytes),
      dl_mbps: jsonNumber(trafficStats.trafficStatsTotalDlMbps, 2),
      ul_mbps: jsonNumber(trafficStats.trafficStatsTotalUlMbps, 2),
    },
  };
}

function buildPausedGpsSample({ now, gps, session, mode }) {
  return {
    id: `${now}-${Math.random().toString(16).slice(2, 8)}`,
    timestamp: now,
    isoTime: new Date(now).toISOString(),
    mode,
    sessionId: session?.id || null,
    recordState: "paused",
    recorded: false,
    gps: normalizeGps(gps),
    snapshot: null,
    trafficStats: null,
  };
}

function buildRfSample({ snapshot, now, gps, session, mode, recording }) {
  const recordState = recording ? "active" : "paused";
  return {
    id: `${now}-${Math.random().toString(16).slice(2, 8)}`,
    timestamp: now,
    isoTime: new Date(now).toISOString(),
    mode,
    sessionId: session?.id || null,
    recordState,
    recorded: recordState === "active",
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
    .filter((sample) => isActiveRfSample(sample))
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
    .filter((sample) => isActiveRfSample(sample))
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
  const activeList = list.filter(isActiveRfSample);
  const first = list[0];
  const last = list[list.length - 1];
  const start = session?.startedAt || first?.timestamp || endedAt;
  const end = endedAt || last?.timestamp || Date.now();
  const gpsCount = list.filter((sample) => sample.gps?.lat && sample.gps?.lng).length;
  const lastActiveSample = [...activeList].reverse().find((sample) => sample?.snapshot) || last;
  const lastSnapshot = lastActiveSample?.snapshot || {};
  const closedSession = {
    ...session,
    pauseSegments: closeOpenPauseSegment(session, end),
    endedAt: session?.endedAt || endedAt,
  };
  const recordingStateSummary = buildRecordingStateSummary(closedSession, end);

  const lteRsrpStats = metricStats(activeList, "lteRsrp");
  const lteRsrqStats = metricStats(activeList, "lteRsrq");
  const lteSinrStats = metricStats(activeList, "lteSinr");
  const lteRssiStats = metricStats(activeList, "lteRssi");
  const nrRsrpStats = metricStats(activeList, "nrRsrp");
  const nrRsrqStats = metricStats(activeList, "nrRsrq");
  const nrSinrStats = metricStats(activeList, "nrSinr");
  const threeGRscpStats = metricStats(activeList, "threeGRscp");
  const threeGEcnoStats = metricStats(activeList, "threeGEcno");
  const threeGRssiStats = metricStats(activeList, "threeGRssi");
  const twoGRssiStats = metricStats(activeList, "twoGRssi");
  const twoGBerStats = metricStats(activeList, "twoGBer");
  const twoGTimingAdvanceStats = metricStats(activeList, "twoGTimingAdvance");
  const trafficStatsDlStats = metricStatsFromTrafficSamples(activeList, "dl");
  const trafficStatsUlStats = metricStatsFromTrafficSamples(activeList, "ul");
  const trafficStatsTotalDlStats = metricStatsFromTrafficSamples(activeList, "dl", "total");
  const trafficStatsTotalUlStats = metricStatsFromTrafficSamples(activeList, "ul", "total");
  const appSource = appTest || session?.appTest || {};
  const isOokla = appSource.testType === "ookla_app";
  const isFcc = appSource.testType === "fcc_app";
  const appIterationResults = (isOokla || isFcc)
    ? []
    : (Array.isArray(appSource.iterationResults) ? appSource.iterationResults : []);
  const appDlMbps = (isOokla || isFcc) ? null : getNumber(appSource.dlMbps);
  const appUlMbps = (isOokla || isFcc) ? null : getNumber(appSource.ulMbps);
  const appIterationsRequested = (isOokla || isFcc)
    ? 0
    : clampInteger(appSource.iterationsRequested || appSource.iterations || DEFAULT_THP_ITERATIONS, 1, MAX_THP_ITERATIONS, DEFAULT_THP_ITERATIONS);
  const appCompletedIterations = (isOokla || isFcc)
    ? 0
    : clampInteger(appSource.completedIterations || appIterationResults.length || 0, 0, MAX_THP_ITERATIONS, 0);
  const appWaitSeconds = clampInteger(appSource.waitSeconds ?? DEFAULT_THP_WAIT_SECONDS, 0, MAX_THP_WAIT_SECONDS, DEFAULT_THP_WAIT_SECONDS);
  const appDurationSeconds = clampInteger(appSource.durationSeconds ?? DEFAULT_THP_DURATION_SECONDS, 1, MAX_THP_DURATION_SECONDS, DEFAULT_THP_DURATION_SECONDS);
  const appIntervalSeconds = clampInteger(appSource.intervalSeconds ?? DEFAULT_THP_INTERVAL_SECONDS, 1, MAX_THP_INTERVAL_SECONDS, DEFAULT_THP_INTERVAL_SECONDS);
  const appWarmupSeconds = clampInteger(appSource.warmupSeconds ?? DEFAULT_THP_WARMUP_SECONDS, 0, MAX_THP_WARMUP_SECONDS, DEFAULT_THP_WARMUP_SECONDS);
  const kpiWarmupDurationSec = resolveKpiWarmupDurationSec({
    kpiWarmupDurationSec: appSource.kpiWarmupDurationSec ?? session?.kpiWarmupDurationSec,
    appWarmupSeconds: isOokla
      ? (appSource.kpiWarmupDurationSec ?? appSource.warmupSeconds ?? DEFAULT_KPI_WARMUP_DURATION_SEC)
      : appWarmupSeconds,
  }, DEFAULT_KPI_WARMUP_DURATION_SEC);
  const appDirection = appSource.direction || DEFAULT_DATA_DIRECTION;
  const isIperf = appSource.testType === "iperf";
  const setupSnapshot = isIperf ? (appSource.setupSnapshot || {}) : null;
  const lastIperfIter = isIperf && appIterationResults.length ? appIterationResults[appIterationResults.length - 1] : null;
  const failedIperfIter = isIperf
    ? appIterationResults.find((row) => row?.status === "error" || row?.jsonParseFailed)
    : null;
  const diagnosticIperfIter = failedIperfIter || lastIperfIter;

  function resolveSavedIperfCommand() {
    const customer = String(setupSnapshot?.customerCommand || setupSnapshot?.rawCommand || "").trim();
    if (customer) return customer;
    if (Array.isArray(diagnosticIperfIter?.command) && diagnosticIperfIter.command.length) {
      return diagnosticIperfIter.command.join(" ");
    }
    try {
      return buildIperf3CommandFromSetup(setupSnapshot || {});
    } catch {
      return "";
    }
  }

  const savedIperfCommand = isIperf ? resolveSavedIperfCommand() : "";
  const iperfExportModes = isIperf ? resolveIperfExportModes(savedIperfCommand, setupSnapshot || {}) : null;

  const iperfMetadata = isIperf ? {
    appTestType: "iperf",
    appSource: lastIperfIter?.source || "native-iperf3-v1g4b",
    appSetupSnapshot: setupSnapshot,
    appServer: String(setupSnapshot?.server || "").trim(),
    appPort: clampInteger(setupSnapshot?.port, 1, 65535, DEFAULT_IPERF_SETUP.port),
    appProtocol: String(setupSnapshot?.protocol || "TCP").toUpperCase(),
    appStreams: clampInteger(setupSnapshot?.streams, 1, 64, DEFAULT_IPERF_SETUP.streams),
    appReverseMode: iperfExportModes.reverseMode,
    appBidirMode: iperfExportModes.bidirMode,
    appCommand: savedIperfCommand,
    appStdoutSummary: String(diagnosticIperfIter?.stdout || "").trim().slice(0, 1200),
    appStderrSummary: String(diagnosticIperfIter?.stderr || "").trim().slice(0, 1200),
    appTestStartedAt: appSource.startedAt || null,
    appTestEndedAt: appSource.endedAt || end,
    appExportStatus: mapIperfExportStatus(appSource.status),
    appDirectionLabel: DATA_DIRECTIONS.find((item) => item.key === appDirection)?.label || appDirection,
  } : {};

  const ooklaIterations = isOokla
    ? (Array.isArray(appSource.ooklaEvidenceIterations) && appSource.ooklaEvidenceIterations.length
      ? appSource.ooklaEvidenceIterations
      : (appSource.ooklaEvidence ? [appSource.ooklaEvidence] : []))
    : [];
  const ooklaLatest = ooklaIterations[ooklaIterations.length - 1] || appSource.ooklaEvidence || null;

  const ooklaMetadata = isOokla ? {
    appTestType: "ookla_app",
    appExternalEvidenceProvider: "ookla_app",
    appOoklaEvidenceIterations: ooklaIterations,
    appOoklaEvidence: ooklaLatest,
    appOoklaCsvImportDebug: appSource.ooklaCsvImportDebug || null,
    appExportStatus: mapOoklaExportStatus(appSource.status, ooklaLatest || {}, ooklaIterations),
    appTestStartedAt: appSource.startedAt || null,
    appTestEndedAt: appSource.endedAt || end,
    appTestMessage: appSource.message || "OOKLA App manual evidence workflow.",
    kpiWarmupDurationSec,
  } : {};

  const partialSessionForFcc = {
    id: session?.id || `bd-rf-${start}`,
    mode: session?.mode || mode || "data",
    taskLabel: session?.taskLabel || taskLabel || "Active field task",
    grid: session?.grid || grid || "Grid pending",
    reportLogName: String(session?.reportLogName || "").trim(),
    startedAt: start,
    endedAt: end,
    sampleCount: list.length,
    activeSampleCount: activeList.length,
    gpsCount,
    rat: getCurrentRatName(lastSnapshot),
    stats: {
      lteRsrp: lteRsrpStats,
      lteRsrq: lteRsrqStats,
      lteSinr: lteSinrStats,
      lteRssi: lteRssiStats,
      nrRsrp: nrRsrpStats,
      nrRsrq: nrRsrqStats,
      nrSinr: nrSinrStats,
      threeGRscp: threeGRscpStats,
      threeGEcno: threeGEcnoStats,
      threeGRssi: threeGRssiStats,
      twoGRssi: twoGRssiStats,
      twoGBer: twoGBerStats,
      twoGTimingAdvance: twoGTimingAdvanceStats,
      trafficStatsDl: trafficStatsDlStats,
      trafficStatsUl: trafficStatsUlStats,
      trafficStatsTotalDl: trafficStatsTotalDlStats,
      trafficStatsTotalUl: trafficStatsTotalUlStats,
    },
    firstGps: first?.gps || null,
    lastGps: [...list].reverse().find((sample) => sample.gps)?.gps || null,
    trafficStatsAvgDlMbps: trafficStatsDlStats.avg,
    trafficStatsAvgUlMbps: trafficStatsUlStats.avg,
    trafficStatsSampleCount: Math.max(trafficStatsDlStats.count, trafficStatsUlStats.count),
    trafficStatsSupported: list.some((sample) => sample?.trafficStats?.trafficStatsSupported),
    trafficStatsMobileSupported: list.some((sample) => sample?.trafficStats?.trafficStatsMobileSupported),
    trafficStatsTotalSupported: list.some((sample) => sample?.trafficStats?.trafficStatsTotalSupported),
    trafficStatsTotalAvgDlMbps: trafficStatsTotalDlStats.avg,
    trafficStatsTotalAvgUlMbps: trafficStatsTotalUlStats.avg,
    trafficStatsTotalSampleCount: Math.max(trafficStatsTotalDlStats.count, trafficStatsTotalUlStats.count),
    kpiWarmupDurationSec,
    recordingStateSummary,
    activeRecordingDurationMs: recordingStateSummary.activeDurationMs,
    pausedDurationMs: recordingStateSummary.pausedDurationMs,
    pauseSegmentCount: recordingStateSummary.pauseSegmentCount,
    appTestStatus: appSource.status || "idle",
  };

  const fccEvidenceIterationsRaw = isFcc
    ? (Array.isArray(appSource.fccEvidenceIterations)
      ? appSource.fccEvidenceIterations
      : (Array.isArray(appSource.appFccEvidenceIterations) ? appSource.appFccEvidenceIterations : []))
    : [];
  const fccFinalized = isFcc
    ? finalizeFccTimeWindowOnExport({
      iterations: fccEvidenceIterationsRaw,
      fccImport: appSource.appFccImport || null,
      sessionStartMs: start,
      sessionEndMs: end,
      bufferSeconds: appSource.appFccImport?.timestampBufferSeconds ?? appSource.appFccImport?.bufferSeconds,
    })
    : null;
  const fccEvidenceIterations = isFcc
    ? (fccFinalized.iterations || []).map((item) => ({
      ...item,
      matchedContext: matchNearestFccContextSample({
        ...partialSessionForFcc,
        exportSamples: list,
        traceSamples: list,
      }, item),
    }))
    : [];
  const fccMetadata = isFcc ? {
    appTestType: "fcc_app",
    appExternalEvidenceProvider: "fcc_app",
    appFccGeneratedEvidence: buildFccGeneratedEvidenceSnapshot({
      ...partialSessionForFcc,
      appFccImport: fccFinalized?.fccImport || appSource.appFccImport || null,
      appFccEvidenceIterations: fccEvidenceIterations,
    }, {}),
    appFccImport: fccFinalized?.fccImport || appSource.appFccImport || null,
    appFccEvidenceIterations: fccEvidenceIterations,
    appExportStatus: mapFccExportStatus({
      ...partialSessionForFcc,
      appTestStatus: appSource.status,
      appFccEvidenceIterations: fccEvidenceIterations,
    }),
    appTestStartedAt: appSource.startedAt || null,
    appTestEndedAt: appSource.endedAt || end,
    appTestMessage: appSource.message || "FCC App external evidence recording.",
  } : {};

  return {
    id: session?.id || `bd-rf-${start}`,
    mode: session?.mode || mode || "data",
    taskLabel: session?.taskLabel || taskLabel || "Active field task",
    grid: session?.grid || grid || "Grid pending",
    reportLogName: String(session?.reportLogName || "").trim(),
    pauseSegments: closedSession.pauseSegments || [],
    recordingStateSummary,
    activeRecordingDurationMs: recordingStateSummary.activeDurationMs,
    pausedDurationMs: recordingStateSummary.pausedDurationMs,
    pauseSegmentCount: recordingStateSummary.pauseSegmentCount,
    startedAt: start,
    endedAt: end,
    durationMs: Math.max(0, end - start),
    sampleCount: list.length,
    activeSampleCount: activeList.length,
    gpsCount,
    rat: getCurrentRatName(lastSnapshot),
    avgLteRsrp: lteRsrpStats.avg,
    avgLteRsrq: lteRsrqStats.avg,
    avgLteSinr: lteSinrStats.avg,
    avgLteRssi: lteRssiStats.avg,
    avgNrRsrp: nrRsrpStats.avg,
    avgNrRsrq: nrRsrqStats.avg,
    avgNrSinr: nrSinrStats.avg,
    avgThreeGRscp: threeGRscpStats.avg,
    avgThreeGEcno: threeGEcnoStats.avg,
    avgThreeGRssi: threeGRssiStats.avg,
    avgTwoGRssi: twoGRssiStats.avg,
    avgTwoGBer: twoGBerStats.avg,
    avgTwoGTimingAdvance: twoGTimingAdvanceStats.avg,
    trafficStatsAvgDlMbps: trafficStatsDlStats.avg,
    trafficStatsAvgUlMbps: trafficStatsUlStats.avg,
    trafficStatsSampleCount: Math.max(trafficStatsDlStats.count, trafficStatsUlStats.count),
    trafficStatsSupported: list.some((sample) => sample?.trafficStats?.trafficStatsSupported),
    trafficStatsMobileSupported: list.some((sample) => sample?.trafficStats?.trafficStatsMobileSupported),
    trafficStatsTotalSupported: list.some((sample) => sample?.trafficStats?.trafficStatsTotalSupported),
    trafficStatsTotalAvgDlMbps: trafficStatsTotalDlStats.avg,
    trafficStatsTotalAvgUlMbps: trafficStatsTotalUlStats.avg,
    trafficStatsTotalSampleCount: Math.max(trafficStatsTotalDlStats.count, trafficStatsTotalUlStats.count),
    kpiWarmupDurationSec,
    appDlMbps,
    appUlMbps,
    appDownloadBytes: appSource.downloadBytes || 0,
    appUploadBytes: appSource.uploadBytes || 0,
    appIterationsRequested,
    appCompletedIterations,
    appWaitSeconds,
    appDurationSeconds,
    appIntervalSeconds,
    appWarmupSeconds,
    appDirection,
    appIterationResults,
    appTestStatus: appSource.status || "idle",
    appTestPhase: appSource.phase || "idle",
    appTestMessage: appSource.message || "Internal DL/UL test ready.",
    appTestError: appSource.error || "",
    ...iperfMetadata,
    ...ooklaMetadata,
    ...fccMetadata,
    stats: {
      lteRsrp: lteRsrpStats,
      lteRsrq: lteRsrqStats,
      lteSinr: lteSinrStats,
      lteRssi: lteRssiStats,
      nrRsrp: nrRsrpStats,
      nrRsrq: nrRsrqStats,
      nrSinr: nrSinrStats,
      threeGRscp: threeGRscpStats,
      threeGEcno: threeGEcnoStats,
      threeGRssi: threeGRssiStats,
      twoGRssi: twoGRssiStats,
      twoGBer: twoGBerStats,
      twoGTimingAdvance: twoGTimingAdvanceStats,
      trafficStatsDl: trafficStatsDlStats,
      trafficStatsUl: trafficStatsUlStats,
      trafficStatsTotalDl: trafficStatsTotalDlStats,
      trafficStatsTotalUl: trafficStatsTotalUlStats,
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
    const isPausedGps = sample.recordState === "paused";
    return {
      id: sample.id || `${sample.timestamp}-${index}`,
      x: Number.isFinite(x) ? Math.max(4, Math.min(96, x)) : 50,
      y: Number.isFinite(y) ? Math.max(6, Math.min(94, y)) : 50,
      rsrp,
      sinr,
      className: isPausedGps ? "paused-gps" : getRsrpQualityClass(rsrp),
      label: isPausedGps
        ? `${formatTime(sample.timestamp)} · Paused GPS only`
        : `${formatTime(sample.timestamp)} · RSRP ${displayValue(rsrp)} · SINR ${displayValue(sinr)}`,
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
      recordState: sample.recordState || (sample.recorded ? "active" : "paused"),
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
  if (className === "paused-gps") return "#64748b";
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
          const isPausedGps = point.recordState === "paused";
          const className = isPausedGps ? "paused-gps" : getRsrpQualityClass(point.rsrp);
          return (
            <CircleMarker
              key={point.id}
              center={point.position}
              radius={isPausedGps ? 4 : 4.5}
              pathOptions={{
                color: isPausedGps ? "#cbd5e1" : "#ffffff",
                weight: isPausedGps ? 1 : 1.4,
                fillColor: qualityColor(className),
                fillOpacity: isPausedGps ? 0.45 : 0.94,
                dashArray: isPausedGps ? "4 4" : undefined,
              }}
            >
              <Tooltip direction="top" opacity={0.95}>
                {isPausedGps
                  ? `${formatTime(point.timestamp)} · Paused GPS only`
                  : `${formatTime(point.timestamp)} · RSRP ${displayValue(point.rsrp)} · SINR ${displayValue(point.sinr)}`}
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
      { label: "Avg NR RSRQ", value: session?.avgNrRsrq, unit: "dB", min: stats.nrRsrq?.min, max: stats.nrRsrq?.max },
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
  const [dataSetupOpen, setDataSetupOpen] = useState(true);
  const [advancedRfOpen, setAdvancedRfOpen] = useState(false);
  const [dataTestType, setDataTestType] = useState(DEFAULT_DATA_TEST_TYPE);
  const [dataDirection, setDataDirection] = useState(DEFAULT_DATA_DIRECTION);
  const [thpIterations, setThpIterations] = useState(String(DEFAULT_THP_ITERATIONS));
  const [thpWaitSeconds, setThpWaitSeconds] = useState(String(DEFAULT_THP_WAIT_SECONDS));
  const [thpDurationSeconds, setThpDurationSeconds] = useState(String(DEFAULT_THP_DURATION_SECONDS));
  const [thpIntervalSeconds, setThpIntervalSeconds] = useState(String(DEFAULT_THP_INTERVAL_SECONDS));
  const [thpWarmupSeconds, setThpWarmupSeconds] = useState(String(DEFAULT_THP_WARMUP_SECONDS));
  const [nativeDownloadUrl, setNativeDownloadUrl] = useState(DEFAULT_NATIVE_HTTP_SETUP.downloadUrl);
  const [nativeUploadUrl, setNativeUploadUrl] = useState(DEFAULT_NATIVE_HTTP_SETUP.uploadUrl);
  const [ftpSetup, setFtpSetup] = useState(DEFAULT_FTP_SETUP);
  const [iperfSetup, setIperfSetup] = useState(DEFAULT_IPERF_SETUP);
  const [iperfBinaryStatus, setIperfBinaryStatus] = useState(null);
  const [ooklaSetup, setOoklaSetup] = useState(DEFAULT_OOKLA_SETUP);
  const [ooklaDraftResetToken, setOoklaDraftResetToken] = useState(0);
  const [ooklaCsvImportDebug, setOoklaCsvImportDebug] = useState(null);
  const [fccSetup, setFccSetup] = useState(DEFAULT_FCC_IMPORT_SETUP);
  const resolvedThpIterations = clampInteger(thpIterations, 1, MAX_THP_ITERATIONS, DEFAULT_THP_ITERATIONS);
  const resolvedThpWaitSeconds = clampInteger(thpWaitSeconds, 0, MAX_THP_WAIT_SECONDS, DEFAULT_THP_WAIT_SECONDS);
  const resolvedThpDurationSeconds = clampInteger(thpDurationSeconds, 1, MAX_THP_DURATION_SECONDS, DEFAULT_THP_DURATION_SECONDS);
  const resolvedThpIntervalSeconds = clampInteger(thpIntervalSeconds, 1, MAX_THP_INTERVAL_SECONDS, DEFAULT_THP_INTERVAL_SECONDS);
  const resolvedThpWarmupSeconds = clampInteger(thpWarmupSeconds, 0, MAX_THP_WARMUP_SECONDS, DEFAULT_THP_WARMUP_SECONDS);
  const [reportLogName, setReportLogName] = useState("");
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
  const throughputPhaseAbortRef = useRef(null);
  const rfReadInFlightRef = useRef(false);
  const collectorRunningRef = useRef(collectorRunning);
  const sessionPausedRef = useRef(false);
  const trafficStatsSkipBaselineRef = useRef(false);
  const reportLogNameRef = useRef(reportLogName);

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
    warmupSeconds: thpWarmupSeconds,
    downloadUrl: nativeDownloadUrl,
    uploadUrl: nativeUploadUrl,
  }), [dataDirection, thpIterations, thpWaitSeconds, thpDurationSeconds, thpIntervalSeconds, thpWarmupSeconds, nativeDownloadUrl, nativeUploadUrl]);

  // Run setup is resolved/clamped only when BabyDragon actually starts the test.
  const currentNativeHttpRunSetup = useMemo(() => ({
    ...DEFAULT_NATIVE_HTTP_SETUP,
    direction: dataDirection,
    iterations: resolvedThpIterations,
    waitSeconds: resolvedThpWaitSeconds,
    durationSeconds: resolvedThpDurationSeconds,
    intervalSeconds: resolvedThpIntervalSeconds,
    warmupSeconds: resolvedThpWarmupSeconds,
    downloadUrl: nativeDownloadUrl?.trim() || DEFAULT_NATIVE_HTTP_SETUP.downloadUrl,
    uploadUrl: nativeUploadUrl?.trim() || DEFAULT_NATIVE_HTTP_SETUP.uploadUrl,
  }), [dataDirection, resolvedThpIterations, resolvedThpWaitSeconds, resolvedThpDurationSeconds, resolvedThpIntervalSeconds, resolvedThpWarmupSeconds, nativeDownloadUrl, nativeUploadUrl]);

  const currentFtpRunSetup = useMemo(() => ({
    ...DEFAULT_FTP_SETUP,
    ...(ftpSetup || {}),
    testType: "ftp",
    direction: ftpSetup?.direction || DEFAULT_FTP_SETUP.direction,
    iterations: clampInteger(ftpSetup?.iterations, 1, MAX_THP_ITERATIONS, DEFAULT_FTP_SETUP.iterations),
    waitSeconds: clampInteger(ftpSetup?.waitSeconds, 0, MAX_THP_WAIT_SECONDS, DEFAULT_FTP_SETUP.waitSeconds),
    durationSeconds: clampInteger(ftpSetup?.durationSeconds, 1, MAX_THP_DURATION_SECONDS, DEFAULT_FTP_SETUP.durationSeconds),
    intervalSeconds: clampInteger(ftpSetup?.intervalSeconds, 1, MAX_THP_INTERVAL_SECONDS, DEFAULT_FTP_SETUP.intervalSeconds),
    warmupSeconds: clampInteger(ftpSetup?.warmupSeconds, 0, MAX_THP_WARMUP_SECONDS, DEFAULT_FTP_SETUP.warmupSeconds),
    port: clampInteger(ftpSetup?.port, 1, 65535, DEFAULT_FTP_SETUP.port),
    uploadFileSizeMb: clampInteger(ftpSetup?.uploadFileSizeMb, 1, 2048, DEFAULT_FTP_SETUP.uploadFileSizeMb),
    host: String(ftpSetup?.host || "").trim(),
    username: String(ftpSetup?.username || DEFAULT_FTP_SETUP.username).trim(),
    password: String(ftpSetup?.password || ""),
    downloadRemotePath: String(ftpSetup?.downloadRemotePath || "").trim(),
    uploadRemotePath: String(ftpSetup?.uploadRemotePath || "").trim(),
    passiveMode: ftpSetup?.passiveMode !== false,
    secure: Boolean(ftpSetup?.secure),
  }), [ftpSetup]);

  const currentIperfRunSetup = useMemo(() => ({
    ...DEFAULT_IPERF_SETUP,
    ...(iperfSetup || {}),
    testType: "iperf",
    direction: iperfSetup?.direction || DEFAULT_IPERF_SETUP.direction,
    iterations: clampInteger(iperfSetup?.iterations, 1, MAX_THP_ITERATIONS, DEFAULT_IPERF_SETUP.iterations),
    waitSeconds: clampInteger(iperfSetup?.waitSeconds, 0, MAX_THP_WAIT_SECONDS, DEFAULT_IPERF_SETUP.waitSeconds),
    durationSeconds: clampInteger(iperfSetup?.durationSeconds, 1, MAX_THP_DURATION_SECONDS, DEFAULT_IPERF_SETUP.durationSeconds),
    intervalSeconds: clampInteger(iperfSetup?.intervalSeconds, 1, MAX_THP_INTERVAL_SECONDS, DEFAULT_IPERF_SETUP.intervalSeconds),
    warmupSeconds: clampInteger(iperfSetup?.warmupSeconds, 0, MAX_THP_WARMUP_SECONDS, DEFAULT_IPERF_SETUP.warmupSeconds),
    port: clampInteger(iperfSetup?.port, 1, 65535, DEFAULT_IPERF_SETUP.port),
    streams: clampInteger(iperfSetup?.streams, 1, 64, DEFAULT_IPERF_SETUP.streams),
    udpBitrateMbps: clampInteger(iperfSetup?.udpBitrateMbps, 1, 100000, DEFAULT_IPERF_SETUP.udpBitrateMbps),
    server: String(iperfSetup?.server || DEFAULT_IPERF_SETUP.server || "").trim(),
    protocol: String(iperfSetup?.protocol || DEFAULT_IPERF_SETUP.protocol || "TCP").toUpperCase(),
    reverseMode: iperfSetup?.reverseMode === true,
    bidirMode: iperfSetup?.bidirMode === true
      || (String(iperfSetup?.direction || "").toLowerCase() === "dl_ul"
        && String(iperfSetup?.protocol || "TCP").toUpperCase() === "TCP"
        && iperfSetup?.reverseMode !== true),
  }), [iperfSetup]);

  const currentDataTestConfig = useMemo(() => {
    if (dataTestType === "ftp") {
      return {
        ...currentFtpRunSetup,
        ftp: currentFtpRunSetup,
        iperf: currentIperfRunSetup,
        ookla: ooklaSetup,
        fcc: fccSetup,
      };
    }
    if (dataTestType === "iperf") {
      return {
        ...currentIperfRunSetup,
        ftp: currentFtpRunSetup,
        iperf: currentIperfRunSetup,
        ookla: ooklaSetup,
        fcc: fccSetup,
      };
    }
    return {
      ...currentNativeHttpRunSetup,
      testType: dataTestType,
      ftp: currentFtpRunSetup,
      iperf: currentIperfRunSetup,
      ookla: ooklaSetup,
      fcc: fccSetup,
    };
  }, [currentNativeHttpRunSetup, currentFtpRunSetup, currentIperfRunSetup, dataTestType, ooklaSetup, fccSetup]);

  const currentDataTestSummary = useMemo(() => {
    const label = DATA_TEST_TYPES.find((item) => item.key === dataTestType)?.label || "Data Test";
    const directionLabel = DATA_DIRECTIONS.find((item) => item.key === currentDataTestConfig.direction)?.label || "DL + UL";
    const ftpHostText = dataTestType === "ftp" && currentDataTestConfig.host ? ` · ${currentDataTestConfig.host}:${currentDataTestConfig.port}` : "";
    if (dataTestType === "iperf") {
      const hostPort = currentDataTestConfig.server
        ? `${currentDataTestConfig.server}:${currentDataTestConfig.port || 5201}`
        : "server pending";
      const binaryLabel = iperfBinaryStatus?.ok ? "Binary Ready" : "Binary Check";
      return `${label} • ${directionLabel} • ${hostPort} • ${currentDataTestConfig.durationSeconds}s • ${currentDataTestConfig.intervalSeconds}s interval • ${currentDataTestConfig.iterations} iter • ${binaryLabel}`;
    }
    return `${label} · ${directionLabel} · ${currentDataTestConfig.durationSeconds}s + ${currentDataTestConfig.warmupSeconds}s warmup${ftpHostText}`;
  }, [dataTestType, currentDataTestConfig, iperfBinaryStatus]);
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
  const canExportSession = Boolean(savedSession && !thpIsRunning && (
    (savedSession.sampleCount || 0) > 0
    || savedSession?.appIterationResults?.length
    || savedSession?.appOoklaEvidence
    || savedSession?.appOoklaEvidenceIterations?.length
    || savedSession?.appFccGeneratedEvidence
  ));
  const traceSamples = useMemo(
    () => getBestTraceSamples({ currentSession, sessionSamples, savedSession, samples }),
    [currentSession, sessionSamples, savedSession, samples]
  );
  const traceMap = useMemo(() => buildTraceMapModel(traceSamples, 80), [traceSamples]);
  const thpIterationRows = dataTest.iterationResults?.length ? dataTest.iterationResults : (visibleSession?.appIterationResults || []);
  const iperfFlatIntervals = useMemo(
    () => (dataTest.testType === "iperf" || visibleSession?.appTestType === "iperf" ? flattenIperfIntervalRows(thpIterationRows) : []),
    [dataTest.testType, visibleSession?.appTestType, thpIterationRows],
  );
  const selectedTestLabel = DATA_TEST_TYPES.find((item) => item.key === dataTestType)?.label || "Data Test";
  const recordingStateLabel = getStatusLabel(testState, selectedMode);
  const mapHasGpsSamples = (visibleSession?.gpsCount || 0) > 0 || Boolean(traceMap?.hasRealGps);
  const kpiLive = (kpiName) => {
    const row = tableRows.find((item) => item.kpi === kpiName || String(item.kpi || "").startsWith(kpiName));
    return row?.live ?? "N/A";
  };
  const summaryAppDl = (isOoklaContext({ dataTest, savedSession: visibleSession }) || isFccContext({ dataTest, savedSession: visibleSession }))
    ? "N/A"
    : formatThroughputWithUnit(formatThroughputLive("dl", { dataTest, savedSession: visibleSession }));
  const summaryAppUl = (isOoklaContext({ dataTest, savedSession: visibleSession }) || isFccContext({ dataTest, savedSession: visibleSession }))
    ? "N/A"
    : formatThroughputWithUnit(formatThroughputLive("ul", { dataTest, savedSession: visibleSession }));
  const summaryTrafficDl = getTrafficStatsLive("dl", samples);
  const summaryTrafficUl = getTrafficStatsLive("ul", samples);
  const summaryCallState = nativeSnapshot?.callState || "N/A";

  useEffect(() => {
    testStateRef.current = testState;
    sessionPausedRef.current = testState === "paused";
  }, [testState]);

  useEffect(() => {
    collectorRunningRef.current = collectorRunning;
  }, [collectorRunning]);

  useEffect(() => {
    reportLogNameRef.current = reportLogName;
  }, [reportLogName]);

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
    setThpWarmupSeconds(cleanIntegerDraft(String(setup.warmupSeconds ?? ""), 2));
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
    const isPausedSession = testStateRef.current === "paused" && collectorRunningRef.current;
    const isRecordingSession = testStateRef.current === "recording" && collectorRunningRef.current;

    if (isPausedSession && append) {
      const readNow = Date.now();
      setSamples((current) => {
        const sample = buildPausedGpsSample({
          now: readNow,
          gps: gpsRef.current,
          session: currentSessionRef.current,
          mode: selectedModeRef.current,
        });
        return [...current.slice(-899), sample];
      });
      setCollectorMessage("Session paused. GPS-only samples continue.");
      return null;
    }

    if (!isRecordingSession && append) return null;

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

      if (append && snapshot?.ok && isRecordingSession) {
        setSamples((current) => {
          const previousSample = [...current].reverse().find((item) => isActiveRfSample(item)) || current[current.length - 1] || null;
          const skipTrafficDelta = trafficStatsSkipBaselineRef.current === true;
          if (skipTrafficDelta) trafficStatsSkipBaselineRef.current = false;
          const sample = buildRfSample({
            snapshot: { ...snapshot, babyDragonReadAt: readNow },
            now: readNow,
            gps: gpsRef.current,
            session: currentSessionRef.current,
            mode: selectedModeRef.current,
            recording: true,
          });
          sample.trafficStats = buildSampleTrafficStats(snapshot, previousSample, readNow, { skipDelta: skipTrafficDelta });
          return [...current.slice(-899), sample];
        });
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

  function pauseRecording() {
    if (testStateRef.current !== "recording" || !collectorRunningRef.current) return;
    const now = Date.now();
    const session = currentSessionRef.current;
    if (!session) return;
    const pauseSegments = [...(session.pauseSegments || []), { startedAt: now, endedAt: null }];
    const nextSession = { ...session, pauseSegments };
    currentSessionRef.current = nextSession;
    setCurrentSession(nextSession);
    testStateRef.current = "paused";
    sessionPausedRef.current = true;
    setTestState("paused");
    if (dataTestRef.current?.status === "running" && dataTestRef.current?.testType === "native_http") {
      if (throughputPhaseAbortRef.current) {
        throughputPhaseAbortRef.current.abort();
      }
      patchDataTest({
        phase: "session_paused",
        message: NATIVE_HTTP_SESSION_PAUSED_MESSAGE,
      });
    }
    setCollectorMessage("Session paused. GPS-only recording continues.");
  }

  function resumeRecording() {
    if (testStateRef.current !== "paused" || !collectorRunningRef.current) return;
    const now = Date.now();
    const session = currentSessionRef.current;
    if (!session) return;
    const pauseSegments = closeOpenPauseSegment(session, now);
    const nextSession = { ...session, pauseSegments };
    currentSessionRef.current = nextSession;
    setCurrentSession(nextSession);
    testStateRef.current = "recording";
    sessionPausedRef.current = false;
    trafficStatsSkipBaselineRef.current = true;
    setTestState("recording");
    setCollectorMessage("Session resumed. RF and TrafficStats recording restored.");
    refreshNativeSnapshot({ append: true });
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
    const warmupSeconds = clampInteger(config.warmupSeconds, 0, MAX_THP_WARMUP_SECONDS, DEFAULT_THP_WARMUP_SECONDS);
    const direction = config.direction || DEFAULT_DATA_DIRECTION;
    const runDl = direction !== "ul";
    const runUl = direction !== "dl";
    const { dlDurationSeconds, ulDurationSeconds, phaseText } = splitIterationDuration(durationSeconds, direction);
    const maxPhaseDurationSeconds = Math.max(dlDurationSeconds || 0, ulDurationSeconds || 0, 1);
    const phasesPerIteration = (runDl ? 1 : 0) + (runUl ? 1 : 0);
    const controller = new AbortController();
    throughputAbortRef.current = controller;
    const sequenceTimeoutMs = ((maxPhaseDurationSeconds * 1000 + 12000) * Math.max(1, phasesPerIteration) * iterations)
      + (waitSeconds * 1000 * Math.max(0, iterations - 1))
      + 8000
      + (2 * 60 * 60 * 1000);
    const clearTimeout = buildTimedSignal(controller, sequenceTimeoutMs);
    const startedAt = Date.now();
    const iterationResults = [];

    const reportNativeHttpPaused = () => {
      if (throughputAbortRef.current !== controller) return;
      patchDataTest({
        status: "running",
        phase: "session_paused",
        message: NATIVE_HTTP_SESSION_PAUSED_MESSAGE,
      });
    };

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
      warmupSeconds,
      downloadUrl: config.downloadUrl || DEFAULT_NATIVE_HTTP_SETUP.downloadUrl,
      uploadUrl: config.uploadUrl || DEFAULT_NATIVE_HTTP_SETUP.uploadUrl,
      currentIteration: 1,
      completedIterations: 0,
      iterationResults: [],
      error: "",
      startedAt,
      endedAt: null,
      sessionId,
      message: `Iteration 1/${iterations}: warmup ${warmupSeconds}s, then native ${direction === "ul" ? "upload" : direction === "dl" ? "download" : "DL/UL"} for ${phaseText}...`,
    });

    try {
      for (let iteration = 1; iteration <= iterations; iteration += 1) {
        await waitWhileSessionPaused(sessionPausedRef, controller.signal);
        const iterationStartedAt = Date.now();
        let dl = null;
        let ul = null;

        if (runDl) {
          await waitForSessionResumeGate(sessionPausedRef, controller.signal, reportNativeHttpPaused);
          patchDataTest({
            status: "running",
            phase: "download",
            currentIteration: iteration,
            message: `Iteration ${iteration}/${iterations}: DL warmup ${warmupSeconds}s + measure ${dlDurationSeconds}s...`,
          });

          dl = await measureThroughputPhaseWithSessionPause({
            sessionPausedRef,
            sequenceSignal: controller.signal,
            phaseAbortRef: throughputPhaseAbortRef,
            onPaused: reportNativeHttpPaused,
            measureFn: (phaseSignal) => measureDownloadThroughput({
              signal: phaseSignal,
              config: { ...config, durationSeconds: dlDurationSeconds, intervalSeconds, warmupSeconds },
              onProgress: (received) => {
                if (sessionPausedRef.current) {
                  reportNativeHttpPaused();
                  return;
                }
                if (throughputAbortRef.current === controller) {
                  patchDataTest({
                    downloadBytes: received,
                    currentIteration: iteration,
                    message: `Iteration ${iteration}/${iterations}: downloading ${Math.round(received / 1024 / 1024)} MB...`,
                  });
                }
              },
            }),
          });
          if (throughputAbortRef.current !== controller) return;
          await waitForSessionResumeGate(sessionPausedRef, controller.signal, reportNativeHttpPaused);
        }

        if (runUl) {
          await waitForSessionResumeGate(sessionPausedRef, controller.signal, reportNativeHttpPaused);
          patchDataTest({
            status: "running",
            phase: "upload",
            currentIteration: iteration,
            dlMbps: runDl ? (dl?.mbps ?? dataTestRef.current.dlMbps) : dataTestRef.current.dlMbps,
            message: `Iteration ${iteration}/${iterations}: UL warmup ${warmupSeconds}s + measure ${ulDurationSeconds}s...`,
          });

          ul = await measureThroughputPhaseWithSessionPause({
            sessionPausedRef,
            sequenceSignal: controller.signal,
            phaseAbortRef: throughputPhaseAbortRef,
            onPaused: reportNativeHttpPaused,
            measureFn: (phaseSignal) => measureUploadThroughput({
              signal: phaseSignal,
              config: { ...config, durationSeconds: ulDurationSeconds, intervalSeconds, warmupSeconds },
            }),
          });
          if (throughputAbortRef.current !== controller) return;
          await waitForSessionResumeGate(sessionPausedRef, controller.signal, reportNativeHttpPaused);
        } else if (runDl) {
          patchDataTest({
            status: "running",
            phase: "iteration_complete",
            currentIteration: iteration,
            message: `Iteration ${iteration}/${iterations}: DL complete.`,
          });
        }

        await waitForSessionResumeGate(sessionPausedRef, controller.signal, reportNativeHttpPaused);
        const iterationEndedAt = Date.now();
        const iterationResult = {
          iteration,
          dlMbps: dl?.mbps ?? null,
          ulMbps: ul?.mbps ?? null,
          dlBytes: dl?.bytes || 0,
          ulBytes: ul?.bytes || 0,
          dlMeasuredBytes: dl?.measuredBytes || dl?.bytes || 0,
          ulMeasuredBytes: ul?.measuredBytes || ul?.bytes || 0,
          dlWarmupBytes: dl?.warmupBytes || 0,
          ulWarmupBytes: ul?.warmupBytes || 0,
          dlSeconds: dl?.seconds || 0,
          ulSeconds: ul?.seconds || 0,
          dlWallSeconds: dl?.wallSeconds || dl?.seconds || 0,
          ulWallSeconds: ul?.wallSeconds || ul?.seconds || 0,
          dlSource: dl?.source || "",
          ulSource: ul?.source || "",
          source: [dl?.source, ul?.source].filter(Boolean).join(" + "),
          startedAt: iterationStartedAt,
          endedAt: iterationEndedAt,
          durationSeconds,
          dlDurationSeconds,
          ulDurationSeconds,
          intervalSeconds,
          warmupSeconds,
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
          endedAt: iteration === iterations ? iterationEndedAt : null,
          message: iteration === iterations
            ? `Complete ${iteration}/${iterations}. Avg DL ${formatThroughputValue(avgDl)} Mbps · Avg UL ${formatThroughputValue(avgUl)} Mbps.`
            : `Iteration ${iteration}/${iterations} complete. Waiting before next run...`,
        });

        if (iteration < iterations && waitSeconds > 0) {
          await waitForSessionResumeGate(sessionPausedRef, controller.signal, reportNativeHttpPaused);
          await waitForThroughputPause(waitSeconds, controller.signal, (remaining) => {
            if (throughputAbortRef.current === controller) {
              patchDataTest({
                status: "running",
                phase: sessionPausedRef.current ? "session_paused" : "wait",
                currentIteration: iteration + 1,
                message: sessionPausedRef.current
                  ? NATIVE_HTTP_SESSION_PAUSED_MESSAGE
                  : `Waiting ${remaining}s before iteration ${iteration + 1}/${iterations}...`,
              });
            }
          }, sessionPausedRef);
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




  async function runIperfThroughputTest(sessionId, options = {}) {
    if (selectedModeRef.current !== "data") return;

    if (throughputAbortRef.current) {
      throughputAbortRef.current.abort();
      throughputAbortRef.current = null;
    }

    const config = { ...DEFAULT_IPERF_SETUP, ...(options || {}) };
    const iterations = clampInteger(config.iterations, 1, MAX_THP_ITERATIONS, DEFAULT_THP_ITERATIONS);
    const waitSeconds = clampInteger(config.waitSeconds, 0, MAX_THP_WAIT_SECONDS, DEFAULT_THP_WAIT_SECONDS);
    const durationSeconds = clampInteger(config.durationSeconds, 1, MAX_THP_DURATION_SECONDS, DEFAULT_THP_DURATION_SECONDS);
    const intervalSeconds = clampInteger(config.intervalSeconds, 1, MAX_THP_INTERVAL_SECONDS, DEFAULT_THP_INTERVAL_SECONDS);
    const warmupSeconds = clampInteger(config.warmupSeconds, 0, MAX_THP_WARMUP_SECONDS, DEFAULT_THP_WARMUP_SECONDS);
    const direction = config.direction || DEFAULT_DATA_DIRECTION;
    const protocol = String(config.protocol || "TCP").toUpperCase();
    const server = String(config.server || DEFAULT_IPERF_SETUP.server || "").trim();
    const port = clampInteger(config.port, 1, 65535, DEFAULT_IPERF_SETUP.port);
    const streams = clampInteger(config.streams, 1, 64, DEFAULT_IPERF_SETUP.streams);
    const udpBitrateMbps = clampInteger(config.udpBitrateMbps, 1, 100000, DEFAULT_IPERF_SETUP.udpBitrateMbps);
    const reverseMode = config.reverseMode === true;
    const bidirMode = config.bidirMode === true
      || (String(direction).toLowerCase() === "dl_ul" && protocol === "TCP" && !reverseMode);
    const startedAt = Date.now();
    const controller = new AbortController();
    throughputAbortRef.current = controller;
    const sequenceTimeoutMs = ((durationSeconds * 1000 + 30000) * iterations) + (waitSeconds * 1000 * Math.max(0, iterations - 1)) + 10000;
    const clearTimeout = buildTimedSignal(controller, sequenceTimeoutMs);

    patchDataTest({
      status: "running",
      phase: "iperf",
      dlMbps: null,
      ulMbps: null,
      downloadBytes: 0,
      uploadBytes: 0,
      testType: "iperf",
      direction,
      iterationsRequested: iterations,
      waitSeconds,
      durationSeconds,
      intervalSeconds,
      warmupSeconds,
      currentIteration: 1,
      completedIterations: 0,
      iterationResults: [],
      error: "",
      startedAt,
      endedAt: null,
      sessionId,
      setupSnapshot: {
        ...config,
        testType: "iperf",
        server,
        port,
        protocol,
        streams,
        udpBitrateMbps,
        reverseMode,
        bidirMode,
        iterations,
        waitSeconds,
        durationSeconds,
        intervalSeconds,
        warmupSeconds,
        direction,
      },
      message: `iPerf3 starting on ${server || "server"}:${port} · ${protocol} · ${reverseMode ? "reverse DL" : bidirMode ? "bidirectional" : "client UL"} · ${durationSeconds}s.`,
    });

    try {
      const iperfResult = await runIperf3ThroughputTest({
        config,
        signal: controller.signal,
        onProgress: (event) => {
          if (selectedModeRef.current !== "data") return;
          patchDataTest({
            status: "running",
            phase: event?.phase || "iperf",
            testType: "iperf",
            currentIteration: event?.currentIteration || dataTestRef.current.currentIteration || 1,
            completedIterations: event?.completedIterations ?? dataTestRef.current.completedIterations ?? 0,
            iterationsRequested: event?.iterationsRequested || iterations,
            dlMbps: event?.dlMbps ?? dataTestRef.current.dlMbps,
            ulMbps: event?.ulMbps ?? dataTestRef.current.ulMbps,
            iterationResults: event?.iterationResults || dataTestRef.current.iterationResults || [],
            message: event?.message || dataTestRef.current.message || "iPerf3 test running.",
          });
        },
      });

      const iterationResults = (iperfResult.iterationResults || []).map((item) => ({
        ...item,
        direction,
        durationSeconds,
        intervalSeconds,
        warmupSeconds,
        waitSeconds,
      }));

      const avgDl = averageThroughput(iterationResults, "dlMbps") ?? getNumber(iperfResult.avgDlMbps);
      const avgUl = averageThroughput(iterationResults, "ulMbps") ?? getNumber(iperfResult.avgUlMbps);
      const totalDlBytes = iterationResults.reduce((sum, item) => sum + (item.dlMeasuredBytes || 0), 0);
      const totalUlBytes = iterationResults.reduce((sum, item) => sum + (item.ulMeasuredBytes || 0), 0);
      const hasAnyMbps = getNumber(avgDl) !== null || getNumber(avgUl) !== null;
      const bidirRequested = bidirMode || String(direction).toLowerCase() === "dl_ul";
      const bidirIncomplete = bidirRequested && (getNumber(avgDl) === null || getNumber(avgUl) === null);
      const finalStatus = iperfResult.ok && !bidirIncomplete
        ? "complete"
        : hasAnyMbps
          ? "partial"
          : "error";
      const finalMessage = iperfResult.ok
        ? `iPerf3 complete ${iterationResults.length}/${iterations}. Avg DL ${formatThroughputValue(avgDl)} Mbps · Avg UL ${formatThroughputValue(avgUl)} Mbps · DL ${formatBytesCompact(totalDlBytes)} / UL ${formatBytesCompact(totalUlBytes)}.`
        : (iperfResult.message || iperfResult.lastMapped?.message || "iPerf3 test failed.");

      patchDataTest({
        status: finalStatus,
        phase: finalStatus,
        testType: "iperf",
        dlMbps: avgDl,
        ulMbps: avgUl,
        downloadBytes: totalDlBytes,
        uploadBytes: totalUlBytes,
        completedIterations: iterationResults.length,
        currentIteration: iterationResults.length || 0,
        iterationResults,
        endedAt: Date.now(),
        error: finalStatus === "complete" ? "" : finalMessage,
        message: finalMessage,
      });
    } catch (error) {
      if (throughputAbortRef.current === controller) {
        await cancelIperf3();
      }
      if (throughputAbortRef.current !== controller) return;
      const message = makeAbortErrorMessage(error);
      const iterationResults = dataTestRef.current.iterationResults || [];
      const avgDl = averageThroughput(iterationResults, "dlMbps") ?? getNumber(dataTestRef.current.dlMbps);
      const avgUl = averageThroughput(iterationResults, "ulMbps") ?? getNumber(dataTestRef.current.ulMbps);
      patchDataTest({
        status: error?.name === "AbortError" ? "stopped" : "error",
        phase: error?.name === "AbortError" ? "stopped" : "error",
        testType: "iperf",
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


  async function runFtpThroughputTest(sessionId, options = {}) {
    if (selectedModeRef.current !== "data") return;

    if (throughputAbortRef.current) {
      throughputAbortRef.current.abort();
      throughputAbortRef.current = null;
    }

    const config = { ...DEFAULT_FTP_SETUP, ...(options || {}) };
    const iterations = clampInteger(config.iterations, 1, MAX_THP_ITERATIONS, DEFAULT_THP_ITERATIONS);
    const waitSeconds = clampInteger(config.waitSeconds, 0, MAX_THP_WAIT_SECONDS, DEFAULT_THP_WAIT_SECONDS);
    const durationSeconds = clampInteger(config.durationSeconds, 1, MAX_THP_DURATION_SECONDS, DEFAULT_THP_DURATION_SECONDS);
    const intervalSeconds = clampInteger(config.intervalSeconds, 1, MAX_THP_INTERVAL_SECONDS, DEFAULT_THP_INTERVAL_SECONDS);
    const warmupSeconds = clampInteger(config.warmupSeconds, 0, MAX_THP_WARMUP_SECONDS, DEFAULT_THP_WARMUP_SECONDS);
    const direction = config.direction || DEFAULT_DATA_DIRECTION;
    const { dlDurationSeconds, ulDurationSeconds, phaseText } = splitIterationDuration(durationSeconds, direction);
    const startedAt = Date.now();

    patchDataTest({
      status: "running",
      phase: "ftp",
      dlMbps: null,
      ulMbps: null,
      downloadBytes: 0,
      uploadBytes: 0,
      testType: "ftp",
      direction,
      iterationsRequested: iterations,
      waitSeconds,
      durationSeconds,
      intervalSeconds,
      warmupSeconds,
      currentIteration: 1,
      completedIterations: 0,
      iterationResults: [],
      error: "",
      startedAt,
      endedAt: null,
      sessionId,
      setupSnapshot: {
        ...config,
        iterations,
        waitSeconds,
        durationSeconds,
        intervalSeconds,
        warmupSeconds,
      },
      message: `FTP test starting on ${config.host || "FTP host"} · ${phaseText} · warmup ${warmupSeconds}s.`,
    });

    try {
      const ftpResult = await runBabyDragonFtpTest({
        sessionId,
        task: activeTask,
        grid: activeGrid ? { name: activeGrid } : null,
        ftpConfig: {
          ...config,
          iterations,
          waitSeconds,
          durationSeconds,
          intervalSeconds,
          warmupSeconds,
          durationSec: durationSeconds,
          warmupSec: warmupSeconds,
          intervalSec: intervalSeconds,
          waitSec: waitSeconds,
          dlPath: config.downloadRemotePath || config.dlPath || "/readme.txt",
          ulFolder: config.uploadRemotePath || config.ulFolder || "/",
          passive: config.passiveMode !== false,
          secure: Boolean(config.secure),
        },
        onProgress: (event) => {
          if (selectedModeRef.current !== "data") return;
          patchDataTest({
            status: "running",
            phase: event?.status || "ftp",
            testType: "ftp",
            currentIteration: event?.iteration || dataTestRef.current.currentIteration || 1,
            completedIterations: event?.status === "iteration_done"
              ? Math.max(dataTestRef.current.completedIterations || 0, event?.iteration || 0)
              : dataTestRef.current.completedIterations || 0,
            iterationsRequested: event?.iterationsRequested || iterations,
            message: event?.message || dataTestRef.current.message || "FTP test running.",
          });
        },
      });

      const iterationResults = (ftpResult.iterations || []).map((item) => ({
        iteration: item.iteration,
        status: item.dlStatus || item.ulStatus ? (item.dlStatus?.toLowerCase?.().includes("failed") || item.ulStatus?.toLowerCase?.().includes("failed") ? "partial" : "complete") : "complete",
        direction,
        dlMbps: item.dlMbps ?? null,
        ulMbps: item.ulMbps ?? null,
        dlBytes: item.dlMeasuredBytes || 0,
        ulBytes: item.ulMeasuredBytes || 0,
        dlMeasuredBytes: item.dlMeasuredBytes || 0,
        ulMeasuredBytes: item.ulMeasuredBytes || 0,
        dlWarmupBytes: item.dlWarmupBytes || 0,
        ulWarmupBytes: item.ulWarmupBytes || 0,
        dlSeconds: item.dlDurationMs ? item.dlDurationMs / 1000 : 0,
        ulSeconds: item.ulDurationMs ? item.ulDurationMs / 1000 : 0,
        dlWallSeconds: item.dlDurationMs ? item.dlDurationMs / 1000 : 0,
        ulWallSeconds: item.ulDurationMs ? item.ulDurationMs / 1000 : 0,
        dlSource: ftpResult.source || "native-ftp-v1g2a",
        ulSource: ftpResult.source || "native-ftp-v1g2a",
        source: ftpResult.source || "native-ftp-v1g2a",
        startedAt: item.startedAtMs || startedAt,
        endedAt: item.endedAtMs || Date.now(),
        durationSeconds,
        dlDurationSeconds,
        ulDurationSeconds,
        intervalSeconds,
        warmupSeconds,
        waitSeconds,
        dlStatus: item.dlStatus || "",
        ulStatus: item.ulStatus || "",
      }));

      const avgDl = averageThroughput(iterationResults, "dlMbps") ?? getNumber(ftpResult.avgDlMbps);
      const avgUl = averageThroughput(iterationResults, "ulMbps") ?? getNumber(ftpResult.avgUlMbps);
      const totalDlBytes = iterationResults.reduce((sum, item) => sum + (item.dlMeasuredBytes || 0), 0);
      const totalUlBytes = iterationResults.reduce((sum, item) => sum + (item.ulMeasuredBytes || 0), 0);
      const totalDlWarmupBytes = iterationResults.reduce((sum, item) => sum + (item.dlWarmupBytes || 0), 0);
      const totalUlWarmupBytes = iterationResults.reduce((sum, item) => sum + (item.ulWarmupBytes || 0), 0);
      const needsDlBytes = direction !== "ul";
      const needsUlBytes = direction !== "dl";
      const hasRequestedBytes = (!needsDlBytes || totalDlBytes > 0) && (!needsUlBytes || totalUlBytes > 0);
      const hasAnyMeasuredBytes = totalDlBytes > 0 || totalUlBytes > 0;
      const finalFtpStatus = ftpResult.ok && hasRequestedBytes ? "complete" : hasAnyMeasuredBytes ? "partial" : "error";
      const finalFtpPhase = finalFtpStatus;
      const zeroByteMessage = "FTP completed but no measured bytes were captured. Use a larger FTP file or a controlled FTP server. For Rebex smoke test, try Warmup 0.";
      const partialMessage = ftpResult?.message || "FTP partial result. One direction completed, another direction failed or captured zero measured bytes.";

      patchDataTest({
        status: finalFtpStatus,
        phase: finalFtpPhase,
        testType: "ftp",
        dlMbps: avgDl,
        ulMbps: avgUl,
        downloadBytes: totalDlBytes,
        uploadBytes: totalUlBytes,
        downloadWarmupBytes: totalDlWarmupBytes,
        uploadWarmupBytes: totalUlWarmupBytes,
        completedIterations: iterationResults.length,
        currentIteration: iterationResults.length || 0,
        iterationResults,
        endedAt: Date.now(),
        error: finalFtpStatus === "complete" ? "" : finalFtpStatus === "partial" ? partialMessage : (ftpResult?.message || zeroByteMessage),
        message: finalFtpStatus === "complete"
          ? `FTP complete ${iterationResults.length}/${iterations}. Avg DL ${formatThroughputValue(avgDl)} Mbps · Avg UL ${formatThroughputValue(avgUl)} Mbps · DL ${formatBytesCompact(totalDlBytes)} / UL ${formatBytesCompact(totalUlBytes)}.`
          : finalFtpStatus === "partial"
            ? `${partialMessage} · DL ${formatBytesCompact(totalDlBytes)} / UL ${formatBytesCompact(totalUlBytes)}.`
            : (ftpResult?.message || zeroByteMessage),
      });
    } catch (error) {
      const message = error?.message || "FTP test failed.";
      patchDataTest({
        status: "error",
        phase: "error",
        testType: "ftp",
        completedIterations: dataTestRef.current.completedIterations || 0,
        iterationResults: dataTestRef.current.iterationResults || [],
        endedAt: Date.now(),
        error: message,
        message,
      });
    }
  }


  function findNearestRfGpsSample(timestamp) {
    const list = samplesRef.current || [];
    if (!list.length || !timestamp) {
      return {
        sampleId: null,
        timestamp: null,
        isoTime: null,
        gps: null,
        trafficStatsRef: null,
      };
    }
    let nearest = null;
    let minDelta = Infinity;
    list.forEach((sample) => {
      const sampleTs = getNumber(sample?.timestamp);
      if (sampleTs === null) return;
      const delta = Math.abs(sampleTs - timestamp);
      if (delta < minDelta) {
        minDelta = delta;
        nearest = sample;
      }
    });
    if (!nearest) {
      return {
        sampleId: null,
        timestamp: null,
        isoTime: null,
        gps: null,
        trafficStatsRef: null,
      };
    }
    const sampleId = nearest.sessionId && nearest.timestamp
      ? `${nearest.sessionId}-${nearest.timestamp}`
      : (nearest.timestamp ? String(nearest.timestamp) : null);
    return {
      sampleId,
      timestamp: nearest.timestamp || null,
      isoTime: nearest.timestamp ? new Date(nearest.timestamp).toISOString() : null,
      gps: nearest.gps || null,
        trafficStatsRef: nearest.trafficStats
        ? {
          trafficStatsSupported: nearest.trafficStats.trafficStatsSupported === true,
          dlMbps: getNumber(nearest.trafficStats.trafficStatsDlMbps ?? nearest.trafficStats.dlMbps),
          ulMbps: getNumber(nearest.trafficStats.trafficStatsUlMbps ?? nearest.trafficStats.ulMbps),
          trafficStatsDlMbps: getNumber(nearest.trafficStats.trafficStatsDlMbps ?? nearest.trafficStats.dlMbps),
          trafficStatsUlMbps: getNumber(nearest.trafficStats.trafficStatsUlMbps ?? nearest.trafficStats.ulMbps),
        }
        : null,
    };
  }

  function buildOoklaScreenshotMetadata(screenshot, role = "main") {
    if (!screenshot) return null;
    const safeRole = role === "detailed" ? "detailed" : "main";
    return {
      role: screenshot.role || safeRole,
      fileName: screenshot.fileName || `ookla-${safeRole}-screenshot`,
      mimeType: screenshot.mimeType || "image/jpeg",
      sizeBytes: getNumber(screenshot.sizeBytes) ?? 0,
      capturedAt: screenshot.capturedAt || new Date().toISOString(),
      storageKey: screenshot.storageKey || null,
      exportRelativePath: screenshot.exportRelativePath || null,
    };
  }

  function resolveOoklaIterationStatus(iterations = []) {
    const confirmed = iterations.filter((item) => item.confirmation === "fe_confirmed");
    if (confirmed.length === iterations.length && iterations.length > 0) return "evidence_saved";
    if (confirmed.length > 0) return "evidence_partial";
    if (iterations.length) return "evidence_draft";
    return "external_ready";
  }

  async function saveOoklaEvidenceIteration(draft) {
    const draftDl = parseOoklaOptionalNumber(draft?.dlMbps);
    const draftUl = parseOoklaOptionalNumber(draft?.ulMbps);
    if (draftDl === null || draftUl === null) {
      patchDataTest({
        message: "Enter or auto-fill DL and UL before saving OOKLA iteration.",
      });
      return { ok: false, reason: "missing_dl_ul" };
    }

    const savedAt = new Date().toISOString();
    const capturedAt = savedAt;
    const capturedTs = Date.parse(capturedAt) || Date.now();
    const feConfirmed = Boolean(draft?.feConfirmed);
    const existing = Array.isArray(dataTestRef.current.ooklaEvidenceIterations)
      ? dataTestRef.current.ooklaEvidenceIterations
      : [];
    const iterationNumber = existing.length + 1;
    const mainScreenshot = buildOoklaScreenshotMetadata(draft?.mainScreenshot || draft?.screenshot, "main");
    const detailedScreenshot = buildOoklaScreenshotMetadata(draft?.detailedScreenshot, "detailed");
    const evidenceSource = String(draft?.evidenceSource || "ookla_app_manual_v1h3");
    const iteration = {
      iterationNumber,
      provider: "ookla_app",
      source: evidenceSource.includes("csv") ? "ookla_csv_import" : "ookla_app_manual_v1h3",
      evidenceSource,
      evidenceType: "external_manual",
      confirmation: feConfirmed ? "fe_confirmed" : "draft",
      capturedAt,
      savedAt,
      feConfirmedAt: feConfirmed ? savedAt : null,
      dlMbps: parseOoklaOptionalNumber(draft?.dlMbps),
      ulMbps: parseOoklaOptionalNumber(draft?.ulMbps),
      pingMs: parseOoklaOptionalNumber(draft?.pingMs),
      jitterMs: parseOoklaOptionalNumber(draft?.jitterMs),
      serverName: String(draft?.serverName || "").trim(),
      serverLocation: String(draft?.serverLocation || "").trim(),
      providerName: String(draft?.providerName || "").trim(),
      resultUrl: String(draft?.resultUrl || "").trim(),
      resultId: String(draft?.resultId || "").trim(),
      testDateTime: String(draft?.testDateTime || draft?.ooklaDateTime || "").trim(),
      ooklaDateTime: String(draft?.ooklaDateTime || draft?.testDateTime || "").trim(),
      connectionType: String(draft?.connectionType || "").trim(),
      deviceName: String(draft?.deviceName || "").trim(),
      connectionsMode: String(draft?.connectionsMode || "").trim(),
      packetLossPercent: parseOoklaOptionalNumber(draft?.packetLossPercent),
      ooklaUserLatitude: parseOoklaOptionalNumber(draft?.ooklaUserLatitude),
      ooklaUserLongitude: parseOoklaOptionalNumber(draft?.ooklaUserLongitude),
      downloadSizeBytes: parseOoklaOptionalNumber(draft?.downloadSizeBytes),
      uploadSizeBytes: parseOoklaOptionalNumber(draft?.uploadSizeBytes),
      internalIp: String(draft?.internalIp || "").trim(),
      externalIp: String(draft?.externalIp || "").trim(),
      notes: String(draft?.notes || "").trim(),
      csvImportMeta: draft?.csvImportMeta || null,
      mainScreenshot,
      detailedScreenshot,
      screenshot: mainScreenshot,
      ocrAssistUsed: Boolean(draft?.ocrAssistUsed || draft?.mainOcrAssistUsed || draft?.detailedOcrAssistUsed),
      mainOcrAssistUsed: Boolean(draft?.mainOcrAssistUsed),
      detailedOcrAssistUsed: Boolean(draft?.detailedOcrAssistUsed),
      ocrConfidence: getNumber(draft?.ocrConfidence),
      ocrSource: draft?.ocrSource ? String(draft.ocrSource) : null,
      ocrExtractedFields: draft?.ocrExtractedFields || {},
      detailedOcrExtractedFields: draft?.detailedOcrExtractedFields || {},
      userConfirmedFields: feConfirmed
        ? {
          dlMbps: parseOoklaOptionalNumber(draft?.dlMbps),
          ulMbps: parseOoklaOptionalNumber(draft?.ulMbps),
          pingMs: parseOoklaOptionalNumber(draft?.pingMs),
          jitterMs: parseOoklaOptionalNumber(draft?.jitterMs),
          serverName: String(draft?.serverName || "").trim(),
          serverLocation: String(draft?.serverLocation || "").trim(),
          providerName: String(draft?.providerName || "").trim(),
          resultId: String(draft?.resultId || "").trim(),
          resultUrl: String(draft?.resultUrl || "").trim(),
          testDateTime: String(draft?.testDateTime || "").trim(),
          connectionType: String(draft?.connectionType || "").trim(),
          deviceName: String(draft?.deviceName || "").trim(),
          connectionsMode: String(draft?.connectionsMode || "").trim(),
          packetLossPercent: parseOoklaOptionalNumber(draft?.packetLossPercent),
          ooklaUserLatitude: parseOoklaOptionalNumber(draft?.ooklaUserLatitude),
          ooklaUserLongitude: parseOoklaOptionalNumber(draft?.ooklaUserLongitude),
        }
        : (draft?.userConfirmedFields || {}),
      ocrRawTextPreview: String(draft?.ocrRawTextPreview || "").trim(),
      detailedOcrRawTextPreview: String(draft?.detailedOcrRawTextPreview || "").trim(),
      mainOcrDebug: draft?.mainOcrDebug || draft?.ocrDebug || null,
      detailedOcrDebug: draft?.detailedOcrDebug || null,
      ocrDebug: draft?.mainOcrDebug || draft?.ocrDebug || null,
      urlFetchStatus: String(draft?.urlFetchStatus || "not_attempted"),
      urlExtractedFields: draft?.urlExtractedFields || {},
      urlAssistUsed: Boolean(draft?.urlAssistUsed),
      evidenceCompleteness: String(draft?.evidenceCompleteness || "partial"),
      requiredEvidenceStatus: String(draft?.requiredEvidenceStatus || draft?.evidenceCompleteness || "partial"),
      optionalMissingFields: Array.isArray(draft?.optionalMissingFields) ? draft.optionalMissingFields : (Array.isArray(draft?.missingFields) ? draft.missingFields : []),
      missingFields: Array.isArray(draft?.missingFields) ? draft.missingFields : [],
      valueSource: String(draft?.valueSource || "manual"),
      fieldSources: draft?.fieldSources || {},
      nearestSample: findNearestRfGpsSample(capturedTs),
    };
    const iterations = [...existing, iteration];
    const status = resolveOoklaIterationStatus(iterations);

    patchDataTest({
      testType: "ookla_app",
      phase: "ookla_app",
      status,
      ooklaEvidenceIterations: iterations,
      ooklaEvidence: iteration,
      message: `OOKLA iteration ${iterationNumber} saved. RF/GPS recording remains active.`,
    });
    setOoklaDraftResetToken((value) => value + 1);
  }

  async function saveOoklaEvidence(draft) {
    return saveOoklaEvidenceIteration(draft);
  }

  function buildOoklaIterationDedupeKey(item = {}) {
    const resultId = String(item?.resultId || "").trim();
    if (resultId) return `id:${resultId}`;
    const resultUrl = String(item?.resultUrl || "").trim().toLowerCase();
    if (resultUrl) return `url:${resultUrl}`;
    // Empty / incomplete rows must not collapse to combo:||| or bypass identity checks.
    if (!isExportableOoklaIteration(item)) return null;
    const date = String(item?.ooklaDateTime || item?.testDateTime || "").trim().toLowerCase();
    const dl = parseOoklaOptionalNumber(item?.dlMbps);
    const ul = parseOoklaOptionalNumber(item?.ulMbps);
    const ping = parseOoklaOptionalNumber(item?.pingMs);
    if (!date) return null;
    return `combo:${date}|${dl ?? ""}|${ul ?? ""}|${ping ?? ""}`;
  }

  async function saveOoklaCsvIterations(drafts = [], debugPayload = null) {
    const list = Array.isArray(drafts) ? drafts : [];
    if (!list.length) return { added: 0, skippedDuplicates: 0 };
    if (debugPayload) {
      setOoklaCsvImportDebug(debugPayload);
      patchDataTest({
        ooklaCsvImportDebug: debugPayload,
      });
    }

    const existing = Array.isArray(dataTestRef.current.ooklaEvidenceIterations)
      ? dataTestRef.current.ooklaEvidenceIterations
      : [];
    const existingKeys = new Set(
      existing.map((item) => buildOoklaIterationDedupeKey(item)).filter(Boolean),
    );
    let nextIterations = [...existing];
    const savedAt = new Date().toISOString();
    let added = 0;
    let skippedDuplicates = 0;

    list.forEach((draft) => {
      if (!isExportableOoklaIteration(draft)) {
        return;
      }
      const dedupeKey = buildOoklaIterationDedupeKey(draft);
      if (!dedupeKey) return;
      if (existingKeys.has(dedupeKey)) {
        skippedDuplicates += 1;
        return;
      }
      existingKeys.add(dedupeKey);
      const iterationNumber = nextIterations.length + 1;
      const capturedTs = Date.parse(draft?.ooklaDateTime) || Date.now();
      const feConfirmed = Boolean(draft?.feConfirmed);
      const requiredOk = Boolean(
        parseOoklaOptionalNumber(draft?.dlMbps) !== null
        && parseOoklaOptionalNumber(draft?.ulMbps) !== null
        && (String(draft?.resultId || "").trim() || String(draft?.resultUrl || "").trim())
        && (String(draft?.ooklaDateTime || draft?.testDateTime || "").trim()),
      );
      const confirmation = feConfirmed && requiredOk ? "fe_confirmed" : "draft";
      const optionalMissing = Array.isArray(draft?.missingFields) ? draft.missingFields : [];
      nextIterations = [...nextIterations, {
        iterationNumber,
        provider: "ookla_app",
        source: "ookla_csv_import",
        evidenceSource: "ookla_csv_import",
        evidenceType: "external_manual",
        confirmation,
        capturedAt: savedAt,
        savedAt,
        feConfirmedAt: confirmation === "fe_confirmed" ? savedAt : null,
        dlMbps: parseOoklaOptionalNumber(draft?.dlMbps),
        ulMbps: parseOoklaOptionalNumber(draft?.ulMbps),
        pingMs: parseOoklaOptionalNumber(draft?.pingMs),
        jitterMs: parseOoklaOptionalNumber(draft?.jitterMs),
        serverName: String(draft?.serverName || "").trim(),
        serverLocation: String(draft?.serverLocation || "").trim(),
        providerName: String(draft?.providerName || "").trim(),
        resultUrl: String(draft?.resultUrl || "").trim(),
        resultId: String(draft?.resultId || "").trim(),
        testDateTime: String(draft?.testDateTime || draft?.ooklaDateTime || "").trim(),
        ooklaDateTime: String(draft?.ooklaDateTime || draft?.testDateTime || "").trim(),
        connectionType: String(draft?.connectionType || "").trim(),
        deviceName: "",
        connectionsMode: "",
        packetLossPercent: null,
        ooklaUserLatitude: parseOoklaOptionalNumber(draft?.ooklaUserLatitude),
        ooklaUserLongitude: parseOoklaOptionalNumber(draft?.ooklaUserLongitude),
        downloadSizeBytes: parseOoklaOptionalNumber(draft?.downloadSizeBytes),
        uploadSizeBytes: parseOoklaOptionalNumber(draft?.uploadSizeBytes),
        internalIp: String(draft?.internalIp || "").trim(),
        externalIp: String(draft?.externalIp || "").trim(),
        notes: String(draft?.notes || "").trim(),
        mainScreenshot: null,
        detailedScreenshot: null,
        screenshot: null,
        ocrAssistUsed: false,
        mainOcrAssistUsed: false,
        detailedOcrAssistUsed: false,
        evidenceCompleteness: String(draft?.evidenceCompleteness || (requiredOk ? "complete" : "partial")),
        requiredEvidenceStatus: requiredOk ? "complete" : "partial",
        optionalMissingFields: optionalMissing,
        missingFields: optionalMissing,
        valueSource: "ookla_csv_import",
        fieldSources: draft?.fieldSources || {},
        csvImportMeta: draft?.csvImportMeta || null,
        nearestSample: findNearestRfGpsSample(capturedTs),
      }];
      added += 1;
    });

    const status = resolveOoklaIterationStatus(nextIterations);
    const skipNote = skippedDuplicates > 0 ? ` Duplicate OOKLA CSV rows skipped: ${skippedDuplicates}.` : "";
    patchDataTest({
      testType: "ookla_app",
      phase: "ookla_app",
      status,
      ooklaEvidenceIterations: nextIterations,
      ooklaEvidence: nextIterations[nextIterations.length - 1] || null,
      ooklaCsvImportDebug: debugPayload || dataTestRef.current.ooklaCsvImportDebug || ooklaCsvImportDebug,
      message: `Added ${added} OOKLA CSV iteration(s).${skipNote} RF/GPS recording remains active.`,
    });
    return { added, skippedDuplicates };
  }

  function resetOoklaEvidenceDraft() {
    setOoklaDraftResetToken((value) => value + 1);
    patchDataTest({
      message: "Current OOKLA iteration draft cleared. RF/GPS recording remains active.",
    });
  }

  function resetAllOoklaEvidence() {
    patchDataTest({
      testType: "ookla_app",
      phase: "ookla_app",
      status: "external_ready",
      ooklaEvidenceIterations: [],
      ooklaEvidence: null,
      message: "All OOKLA iterations cleared. RF/GPS recording remains active.",
    });
    setOoklaDraftResetToken((value) => value + 1);
  }

  function resolveFccImportSessionWindow(options = {}) {
    const bufferSeconds = getNumber(options.bufferSeconds)
      ?? getNumber(fccSetup.timestampBufferSeconds)
      ?? FCC_DEFAULT_BUFFER_SECONDS;
    const sessionStartMs = Number.isFinite(options.sessionStartMs)
      ? options.sessionStartMs
      : (Number.isFinite(dataTestRef.current.startedAt)
        ? dataTestRef.current.startedAt
        : (Number.isFinite(currentSessionRef.current?.startedAt) ? currentSessionRef.current.startedAt : null));
    const sessionEndMs = Number.isFinite(options.sessionEndMs)
      ? options.sessionEndMs
      : (Number.isFinite(dataTestRef.current.endedAt)
        ? dataTestRef.current.endedAt
        : Date.now());
    return { bufferSeconds, sessionStartMs, sessionEndMs };
  }

  async function ingestFccZipBuffer(buffer, {
    fileName = "fcc-export.zip",
    mimeType = "application/zip",
    sizeBytes = null,
    importMode = "manual_zip",
    sourceUrl = null,
    downloadedFilename = null,
    downloadedSizeBytes = null,
    downloadedAtIso = null,
    contentType = null,
    statusCode = null,
    sessionStartMs = null,
    sessionEndMs = null,
    bufferSeconds = FCC_DEFAULT_BUFFER_SECONDS,
    statusMessage = null,
  } = {}) {
    if (statusMessage) {
      const parsingMeta = {
        status: "parsing",
        parseStatus: "parsing",
        importMode,
        sourceType: importMode === "url_zip" ? "url" : "file",
        sourceUrl,
        fileName,
        downloadedFilename: downloadedFilename || fileName,
        downloadedSizeBytes,
        downloadedAtIso,
        contentType,
        statusCode,
        message: statusMessage,
        timestampBufferSeconds: bufferSeconds,
        rows: [],
        stats: { phaseRowCount: 0, collapsedTestCount: 0, selectedCount: 0 },
      };
      setFccSetup((prev) => ({ ...prev, appFccImport: parsingMeta }));
      patchDataTest({ appFccImport: parsingMeta, message: statusMessage });
    }

    const parsed = await parseFccExportZip(buffer, {
      fileName,
      sessionStartMs,
      sessionEndMs,
      bufferSeconds,
      importMode,
      sourceType: importMode === "url_zip" ? "url" : "file",
      sourceUrl,
      downloadedFilename: downloadedFilename || fileName,
      downloadedSizeBytes: downloadedSizeBytes ?? sizeBytes,
      downloadedAtIso,
      contentType: contentType || mimeType,
      statusCode,
    });
    const importMeta = {
      ...buildFccImportDebugPayload(parsed),
      mimeType: mimeType || contentType || "application/zip",
      sizeBytes: Number.isFinite(Number(sizeBytes))
        ? Number(sizeBytes)
        : (Number.isFinite(Number(downloadedSizeBytes)) ? Number(downloadedSizeBytes) : null),
      message: parsed.ok
        ? (importMode === "url_zip"
          ? `FCC source parsed · ${parsed.stats?.collapsedTestCount || 0} test(s) from ${parsed.stats?.phaseRowCount || 0} phase row(s).`
          : `Parsed ${parsed.stats?.collapsedTestCount || 0} FCC test(s) from ${parsed.stats?.phaseRowCount || 0} phase row(s).`)
        : ((parsed.errors || []).join(" ") || "FCC ZIP parse failed."),
    };
    if (parsed.ok) {
      importMeta.parseStatus = "parsed";
      importMeta.status = "parsed";
    }
    setFccSetup((prev) => ({ ...prev, appFccImport: importMeta, timestampBufferSeconds: bufferSeconds }));
    patchDataTest({
      testType: "fcc_app",
      appFccImport: importMeta,
      message: importMeta.message,
    });
    return importMeta;
  }

  async function handleFccImportFile(file, options = {}) {
    if (!file) return;

    const fileName = file.name || "fcc-export.zip";
    const extension = String(fileName.split(".").pop() || "").toLowerCase();
    const { bufferSeconds, sessionStartMs, sessionEndMs } = resolveFccImportSessionWindow(options);

    if (extension !== "zip") {
      const importMeta = {
        status: "unsupported_format",
        parseStatus: "unsupported_format",
        importMode: "manual_zip",
        sourceType: "file",
        fileName,
        message: "Select an FCC App ZIP export (FCC-Mobile-Speed-Test-ANDROID-*.zip).",
        timestampBufferSeconds: bufferSeconds,
        rows: [],
        stats: { phaseRowCount: 0, collapsedTestCount: 0, selectedCount: 0 },
      };
      setFccSetup((prev) => ({ ...prev, appFccImport: importMeta }));
      patchDataTest({ appFccImport: importMeta, message: importMeta.message });
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      await ingestFccZipBuffer(buffer, {
        fileName,
        mimeType: file.type || "application/zip",
        sizeBytes: Number.isFinite(file.size) ? file.size : null,
        importMode: "manual_zip",
        sourceType: "file",
        sessionStartMs,
        sessionEndMs,
        bufferSeconds,
        statusMessage: "Parsing FCC ZIP...",
      });
    } catch (error) {
      const importMeta = {
        status: "read_failed",
        parseStatus: "read_failed",
        importMode: "manual_zip",
        sourceType: "file",
        fileName,
        message: String(error?.message || error || "Unable to read FCC ZIP."),
        timestampBufferSeconds: bufferSeconds,
        rows: [],
        stats: { phaseRowCount: 0, collapsedTestCount: 0, selectedCount: 0 },
      };
      setFccSetup((prev) => ({ ...prev, appFccImport: importMeta }));
      patchDataTest({ appFccImport: importMeta, message: importMeta.message });
    }
  }

  async function handleFccImportFromUrl(rawUrl, options = {}) {
    const validation = validateFccZipDownloadUrl(rawUrl);
    const { bufferSeconds, sessionStartMs, sessionEndMs } = resolveFccImportSessionWindow(options);

    if (!validation.ok) {
      const importMeta = {
        status: "invalid_url",
        parseStatus: "invalid_url",
        importMode: "url_zip",
        sourceType: "url",
        sourceUrl: String(rawUrl || "").trim() || null,
        message: validation.message || "Invalid URL: HTTPS FCC ZIP URL required",
        timestampBufferSeconds: bufferSeconds,
        rows: [],
        stats: { phaseRowCount: 0, collapsedTestCount: 0, selectedCount: 0 },
      };
      setFccSetup((prev) => ({ ...prev, appFccImport: importMeta }));
      patchDataTest({ appFccImport: importMeta, message: importMeta.message });
      return importMeta;
    }

    const sourceUrl = validation.url;
    const downloadingMeta = {
      status: "downloading",
      parseStatus: "downloading",
      importMode: "url_zip",
      sourceType: "url",
      sourceUrl,
      message: validation.warning
        ? `Downloading FCC ZIP... (${validation.warning})`
        : "Downloading FCC ZIP...",
      timestampBufferSeconds: bufferSeconds,
      rows: [],
      stats: { phaseRowCount: 0, collapsedTestCount: 0, selectedCount: 0 },
    };
    setFccSetup((prev) => ({ ...prev, fccZipUrl: sourceUrl, appFccImport: downloadingMeta }));
    patchDataTest({ appFccImport: downloadingMeta, message: downloadingMeta.message });

    if (typeof BabyDragonRfKpi.downloadFccZipFromUrl !== "function") {
      const importMeta = {
        ...downloadingMeta,
        status: "download_failed",
        parseStatus: "download_failed",
        message: "Download failed: native FCC ZIP download is unavailable on this build",
      };
      setFccSetup((prev) => ({ ...prev, appFccImport: importMeta }));
      patchDataTest({ appFccImport: importMeta, message: importMeta.message });
      return importMeta;
    }

    try {
      const response = await BabyDragonRfKpi.downloadFccZipFromUrl({ url: sourceUrl });
      if (!response?.ok || !response?.base64Zip) {
        const safeReason = String(response?.message || response?.error || "download failed")
          .replace(/[\r\n]+/g, " ")
          .slice(0, 180);
        const importMeta = {
          status: "download_failed",
          parseStatus: "download_failed",
          importMode: "url_zip",
          sourceType: "url",
          sourceUrl,
          contentType: response?.contentType || null,
          statusCode: response?.statusCode ?? null,
          downloadedFilename: response?.filename || null,
          downloadedSizeBytes: response?.sizeBytes ?? null,
          message: safeReason.startsWith("Download failed") || safeReason.startsWith("Invalid URL")
            ? safeReason
            : `Download failed: ${safeReason}`,
          timestampBufferSeconds: bufferSeconds,
          rows: [],
          stats: { phaseRowCount: 0, collapsedTestCount: 0, selectedCount: 0 },
        };
        setFccSetup((prev) => ({ ...prev, appFccImport: importMeta }));
        patchDataTest({ appFccImport: importMeta, message: importMeta.message });
        return importMeta;
      }

      const downloadedAtIso = new Date().toISOString();
      const fileName = response.filename || "fcc-export.zip";
      const downloadedMeta = {
        status: "downloaded",
        parseStatus: "downloaded",
        importMode: "url_zip",
        sourceType: "url",
        sourceUrl,
        fileName,
        downloadedFilename: fileName,
        downloadedSizeBytes: response.sizeBytes ?? null,
        downloadedAtIso,
        contentType: response.contentType || null,
        statusCode: response.statusCode ?? null,
        message: "FCC ZIP downloaded",
        timestampBufferSeconds: bufferSeconds,
        rows: [],
        stats: { phaseRowCount: 0, collapsedTestCount: 0, selectedCount: 0 },
      };
      setFccSetup((prev) => ({ ...prev, appFccImport: downloadedMeta }));
      patchDataTest({ appFccImport: downloadedMeta, message: downloadedMeta.message });

      const buffer = base64ToArrayBuffer(response.base64Zip);
      return await ingestFccZipBuffer(buffer, {
        fileName,
        mimeType: response.contentType || "application/zip",
        sizeBytes: response.sizeBytes ?? null,
        importMode: "url_zip",
        sourceUrl,
        downloadedFilename: fileName,
        downloadedSizeBytes: response.sizeBytes ?? null,
        downloadedAtIso,
        contentType: response.contentType || null,
        statusCode: response.statusCode ?? null,
        sessionStartMs,
        sessionEndMs,
        bufferSeconds,
        statusMessage: "Parsing FCC ZIP...",
      });
    } catch (error) {
      const safeReason = String(error?.message || error || "download failed")
        .replace(/[\r\n]+/g, " ")
        .slice(0, 180);
      const importMeta = {
        status: "download_failed",
        parseStatus: "download_failed",
        importMode: "url_zip",
        sourceType: "url",
        sourceUrl,
        message: `Download failed: ${safeReason}`,
        timestampBufferSeconds: bufferSeconds,
        rows: [],
        stats: { phaseRowCount: 0, collapsedTestCount: 0, selectedCount: 0 },
      };
      setFccSetup((prev) => ({ ...prev, appFccImport: importMeta }));
      patchDataTest({ appFccImport: importMeta, message: importMeta.message });
      return importMeta;
    }
  }

  async function saveFccEvidenceIterations(rows = [], debugPayload = null) {
    const incoming = Array.isArray(rows) ? rows : [];
    const outside = incoming.filter((row) => row?.insideBabyDragonTimeWindow !== "yes");
    const list = incoming.filter((row) => row?.insideBabyDragonTimeWindow === "yes");
    if (!incoming.length) return { added: 0, skippedDuplicates: 0, skippedOutsideWindow: 0, addedTestIds: [] };

    if (debugPayload) {
      setFccSetup((prev) => ({ ...prev, appFccImport: debugPayload }));
      patchDataTest({ appFccImport: debugPayload });
    }

    const existing = Array.isArray(dataTestRef.current.fccEvidenceIterations)
      ? dataTestRef.current.fccEvidenceIterations
      : [];
    const existingKeys = new Set(
      existing.map((item) => buildFccDedupeKey(item)).filter(Boolean),
    );
    let nextIterations = [...existing];
    const savedAt = new Date().toISOString();
    let added = 0;
    let skippedDuplicates = 0;
    const skippedOutsideWindow = outside.length;
    const addedTestIds = [];
    const liveSession = {
      ...(currentSessionRef.current || {}),
      exportSamples: samplesRef.current || currentSessionRef.current?.exportSamples || [],
      traceSamples: samplesRef.current || currentSessionRef.current?.traceSamples || [],
    };

    list.forEach((row) => {
      const key = buildFccDedupeKey(row);
      if (key && existingKeys.has(key)) {
        skippedDuplicates += 1;
        return;
      }
      const matchedContext = matchNearestFccContextSample(liveSession, row);
      const iterationNumber = nextIterations.length + 1;
      const iteration = previewRowToEvidenceIteration(row, {
        iterationNumber,
        matchedContext,
        savedAt,
      });
      nextIterations.push(iteration);
      if (key) existingKeys.add(key);
      added += 1;
      if (iteration.fccTestId) addedTestIds.push(iteration.fccTestId);
    });

    const status = nextIterations.length ? "evidence_saved" : (dataTestRef.current.status || "external_ready");
    const parts = [];
    if (added) parts.push(`Saved ${added} inside-window FCC evidence iteration(s).`);
    if (skippedDuplicates) parts.push(`Skipped ${skippedDuplicates} duplicate(s).`);
    if (skippedOutsideWindow) parts.push(`Blocked ${skippedOutsideWindow} outside-window row(s).`);
    patchDataTest({
      testType: "fcc_app",
      phase: "fcc_app",
      status,
      fccEvidenceIterations: nextIterations,
      appFccEvidenceIterations: nextIterations,
      appFccImport: debugPayload || dataTestRef.current.appFccImport || fccSetup.appFccImport || null,
      message: parts.join(" ") || "No FCC rows added.",
    });

    return { added, skippedDuplicates, skippedOutsideWindow, addedTestIds };
  }

  async function armWorkflow(mode) {
    const now = Date.now();
    const sessionReportName = String(reportLogNameRef.current || "").trim();
    const session = {
      id: `bd-rf-${now}`,
      mode,
      startedAt: now,
      taskLabel: activeTaskLabel,
      grid: activeGrid,
      reportLogName: sessionReportName,
      pauseSegments: [],
    };

    selectedModeRef.current = mode;
    currentSessionRef.current = session;
    testStateRef.current = "recording";
    sessionPausedRef.current = false;
    trafficStatsSkipBaselineRef.current = false;
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
    collectorRunningRef.current = true;
    setSamples([]);
    await refreshNativeSnapshot({ append: true });
    if (mode === "data") {
      if (currentDataTestConfig.testType === "native_http") {
        runInternalThroughputTest(session.id, currentDataTestConfig);
      } else if (currentDataTestConfig.testType === "ftp") {
        runFtpThroughputTest(session.id, currentDataTestConfig);
      } else if (currentDataTestConfig.testType === "iperf") {
        runIperfThroughputTest(session.id, currentDataTestConfig);
      } else {
        const label = DATA_TEST_TYPES.find((item) => item.key === currentDataTestConfig.testType)?.label || currentDataTestConfig.testType;
        const externalTestType = currentDataTestConfig.testType;
        let externalMessage = `${label} selected. BabyDragon is recording RF/GPS timestamps. Import/screenshot capture comes in the next focused step.`;
        if (externalTestType === "ookla_app") {
          externalMessage = "OOKLA App selected. BabyDragon is recording RF/GPS timestamps. Run the OOKLA Speedtest app, return here, and save manual FE-confirmed evidence.";
        } else if (externalTestType === "fcc_app") {
          externalMessage = "FCC App selected. BabyDragon is recording RF/GPS timestamps. Run the FCC app externally, then import the FCC ZIP and add selected rows as external evidence.";
        }
        const ooklaKpiWarmup = resolveKpiWarmupDurationSec({
          kpiWarmupDurationSec: currentDataTestConfig?.ookla?.kpiWarmupDurationSec,
          appWarmupSeconds: currentDataTestConfig.warmupSeconds,
        }, DEFAULT_KPI_WARMUP_DURATION_SEC);
        patchDataTest({
          status: "external_ready",
          phase: currentDataTestConfig.testType,
          testType: currentDataTestConfig.testType,
          direction: currentDataTestConfig.direction,
          iterationsRequested: currentDataTestConfig.iterations,
          waitSeconds: currentDataTestConfig.waitSeconds,
          durationSeconds: currentDataTestConfig.durationSeconds,
          intervalSeconds: currentDataTestConfig.intervalSeconds,
          warmupSeconds: externalTestType === "ookla_app" ? ooklaKpiWarmup : currentDataTestConfig.warmupSeconds,
          kpiWarmupDurationSec: externalTestType === "ookla_app" ? ooklaKpiWarmup : undefined,
          setupSnapshot: currentDataTestConfig,
          sessionId: session.id,
          startedAt: now,
          endedAt: null,
          message: externalMessage,
        });
      }
    }
  }

  function stopWorkflow() {
    const endedAt = Date.now();
    const baseSession = currentSessionRef.current || {
      id: `bd-rf-${endedAt}`,
      mode: selectedModeRef.current,
      startedAt: samplesRef.current[0]?.timestamp || endedAt,
      taskLabel: activeTaskLabel,
      grid: activeGrid,
      reportLogName: String(reportLogNameRef.current || "").trim(),
      pauseSegments: [],
    };
    const session = {
      ...baseSession,
      reportLogName: String(baseSession.reportLogName || reportLogNameRef.current || "").trim(),
      pauseSegments: closeOpenPauseSegment(baseSession, endedAt),
      endedAt,
    };
    const recorded = samplesRef.current.filter((sample) => sample.sessionId === session.id || sample.recorded || sample.recordState === "paused");
    const sessionList = recorded.length ? recorded : samplesRef.current;
    if (throughputAbortRef.current && dataTestRef.current?.status === "running") {
      throughputAbortRef.current.abort();
      if (dataTestRef.current?.testType === "iperf") {
        cancelIperf3();
      }
    }
    const finalDataTest = dataTestRef.current?.status === "running"
      ? { ...dataTestRef.current, status: "stopped", phase: "stopped", message: "Throughput test stopped by Stop / Save.", endedAt }
      : dataTestRef.current;
    dataTestRef.current = finalDataTest;
    setDataTest(finalDataTest);

    setSavedSession(buildSessionSummary({
      session,
      samples: sessionList,
      endedAt,
      mode: selectedModeRef.current,
      taskLabel: activeTaskLabel,
      grid: activeGrid,
      appTest: finalDataTest,
    }));
    currentSessionRef.current = null;
    testStateRef.current = "saved";
    sessionPausedRef.current = false;
    collectorRunningRef.current = false;
    setCurrentSession(null);
    setClockTick(endedAt);
    setTestState("saved");
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
    if (!sessionToExport || (!sessionToExport.sampleCount && !sessionToExport?.appIterationResults?.length && !sessionToExport?.appOoklaEvidence && !sessionToExport?.appOoklaEvidenceIterations?.length && !sessionToExport?.appFccGeneratedEvidence && !sessionToExport?.appFccEvidenceIterations?.length)) {
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
      const exportExtra = reportPackage.iperfSession
        ? " iPerf3 CSV + JSON included."
        : reportPackage.ooklaSession
          ? " OOKLA package: Report.json + RF_GPS_Trace.csv + OOKLA_Evidence.csv."
          : reportPackage.fccSession
            ? " FCC package: exactly 3 FCC evidence files."
            : "";
      setExportStatus(result?.fallback
        ? `Report package downloaded: ${files.length} files.${exportExtra}`
        : `Report package saved successfully: ${files.length} files.${exportExtra}`);
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

  function handleReportLogNameChange(value) {
    setReportLogName(value);
    reportLogNameRef.current = value;
    if (currentSessionRef.current) {
      const nextSession = {
        ...currentSessionRef.current,
        reportLogName: String(value || "").trim(),
      };
      currentSessionRef.current = nextSession;
      setCurrentSession(nextSession);
    }
  }

  function togglePanel(panelName) {
    setOpenPanel((current) => (current === panelName ? "none" : panelName));
  }

  return (
    <section className="bd-mobile-rf-view bd-mobile-rf-compact bd-rf-ux-simplified">
      <section className="bd-mobile-card bd-rf-control-card bd-rf-top-summary bd-rf-cockpit-compact">
        <div className="bd-rf-compact-head">
          <div>
            <p className="bd-mobile-eyebrow">Field RF</p>
            <h2>RF Cockpit</h2>
          </div>
          <button type="button" onClick={() => togglePanel("about")}>Info</button>
        </div>

        {openPanel === "about" && (
          <p className="bd-rf-inline-note">
            Select a test, start recording, capture evidence, then Stop / Save and Export.
          </p>
        )}

        <div className="bd-rf-context-strip bd-rf-context-strip-compact">
          <span><b>Task</b>{activeTaskLabel}</span>
          <span><b>FE</b>{user?.email || "Signed in FE"}</span>
          <span><b>Grid</b>{activeGrid}</span>
          <span><b>GPS</b>{formatGps(lastGpsLocation)}</span>
          <span><b>Test</b>{selectedMode === "data" ? selectedTestLabel : "Voice Test"}</span>
          <span><b>State</b>{recordingStateLabel}</span>
        </div>

        <label className="bd-rf-report-name-field">
          <span>Log / Report Name</span>
          <input
            type="text"
            value={reportLogName}
            placeholder="Optional custom export name"
            onChange={(event) => handleReportLogNameChange(event.target.value)}
          />
        </label>

        {(testState === "paused" || testState === "recording") && collectorRunning ? (
          <p className="bd-rf-inline-note bd-rf-pause-note">
            {testState === "paused"
              ? "Paused: GPS only. RF and TrafficStats suspended."
              : "Recording RF, GPS, and TrafficStats."}
          </p>
        ) : null}

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
          <section className={`bd-rf-data-setup-card open ${dataTestType === "iperf" ? "iperf-setup" : ""}`}>
            <div className="bd-rf-data-setup-head bd-rf-data-setup-head-compact">
              <div>
                <b>Test Type</b>
                <span className="bd-rf-data-setup-summary-oneline">{currentDataTestSummary}</span>
              </div>
              <button type="button" onClick={() => setDataSetupOpen((current) => !current)}>
                {dataSetupOpen ? "Collapse" : "Expand"}
              </button>
            </div>

            <div className="bd-rf-test-type-grid bd-rf-test-type-grid-compact">
              {DATA_TEST_TYPES.map((item) => (
                <button
                  type="button"
                  key={item.key}
                  className={dataTestType === item.key ? "active" : ""}
                  disabled={dataTest.status === "running"}
                  onClick={() => { setDataTestType(item.key); setDataSetupOpen(true); }}
                >
                  <strong>{item.label}</strong>
                  <span>{item.status}</span>
                </button>
              ))}
            </div>

            {dataSetupOpen && (
              <div className="bd-rf-selected-workflow">
                {dataTestType === "native_http" && (
                  <NativeHttpTestCard setup={currentNativeHttpSetup} onChange={handleNativeHttpSetupChange} disabled={dataTest.status === "running"} />
                )}
                {dataTestType === "ftp" && (
                  <FtpTestCard setup={ftpSetup} onChange={setFtpSetup} disabled={dataTest.status === "running"} />
                )}
                {dataTestType === "iperf" && (
                  <Iperf3TestPage
                    setup={iperfSetup}
                    onChange={setIperfSetup}
                    onBinaryStatusChange={setIperfBinaryStatus}
                    disabled={dataTest.status === "running"}
                  />
                )}
                {dataTestType === "ookla_app" && (
                  <OoklaTestCard
                    savedIterations={resolveOoklaEvidenceIterations({ dataTest, savedSession: visibleSession })}
                    draftResetToken={ooklaDraftResetToken}
                    sessionId={currentSession?.id || dataTest.sessionId || "session"}
                    sessionStartMs={
                      Number.isFinite(dataTest.startedAt)
                        ? dataTest.startedAt
                        : (Number.isFinite(currentSession?.startedAt) ? currentSession.startedAt : null)
                    }
                    sessionEndMs={
                      Number.isFinite(dataTest.endedAt)
                        ? dataTest.endedAt
                        : (dataTest.status === "running" || dataTest.status === "paused"
                          ? Date.now()
                          : (Number.isFinite(currentSession?.endedAt) ? currentSession.endedAt : null))
                    }
                    provisionalSessionEnd={
                      !Number.isFinite(dataTest.endedAt)
                      && (dataTest.status === "running" || dataTest.status === "paused" || dataTest.status === "external_ready" || String(dataTest.status || "").startsWith("evidence"))
                    }
                    onSaveEvidence={saveOoklaEvidenceIteration}
                    onSaveCsvIterations={saveOoklaCsvIterations}
                    onCsvImportDebugChange={(debug) => {
                      setOoklaCsvImportDebug(debug);
                      patchDataTest({ ooklaCsvImportDebug: debug });
                    }}
                    onNewIteration={resetOoklaEvidenceDraft}
                    onResetDraft={resetOoklaEvidenceDraft}
                    onResetAll={resetAllOoklaEvidence}
                    disabled={false}
                  />
                )}
                {dataTestType === "fcc_app" && (
                  <FccTestCard
                    setup={fccSetup}
                    importMeta={dataTest.appFccImport || fccSetup.appFccImport || null}
                    onChange={(next) => {
                      setFccSetup(next);
                      if (next?.appFccImport) {
                        patchDataTest({ appFccImport: next.appFccImport });
                      }
                    }}
                    onImportFile={handleFccImportFile}
                    onImportFromUrl={handleFccImportFromUrl}
                    onAddSelectedRows={saveFccEvidenceIterations}
                    sessionStartMs={
                      Number.isFinite(dataTest.startedAt)
                        ? dataTest.startedAt
                        : (Number.isFinite(currentSession?.startedAt) ? currentSession.startedAt : null)
                    }
                    sessionEndMs={
                      Number.isFinite(dataTest.endedAt)
                        ? dataTest.endedAt
                        : (dataTest.status === "running" || dataTest.status === "paused" || dataTest.status === "external_ready" || String(dataTest.status || "").startsWith("evidence")
                          ? Date.now()
                          : (Number.isFinite(currentSession?.endedAt) ? currentSession.endedAt : null))
                    }
                    provisionalSessionEnd={
                      !Number.isFinite(dataTest.endedAt)
                      && (dataTest.status === "running" || dataTest.status === "paused" || dataTest.status === "external_ready" || String(dataTest.status || "").startsWith("evidence"))
                    }
                    disabled={false}
                  />
                )}
              </div>
            )}
          </section>
        )}

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


        {visibleSession && (
          <details
            key={collectorRunning || testState === "paused" ? "session-live" : `session-saved-${visibleSession.id || "local"}`}
            className={`bd-rf-session-card bd-rf-session-collapsible ${testState === "paused" ? "paused" : collectorRunning ? "recording" : "saved"}`}
            defaultOpen={collectorRunning || testState === "paused"}
          >
            <summary className="bd-rf-session-head">
              <div>
                <b>{testState === "paused" ? "Paused Session" : collectorRunning ? "Recording Session" : "Saved Session"}</b>
                <span>{String(visibleSession.mode || "data").toUpperCase()} · {visibleSession.rat || servingTechnology}</span>
              </div>
              <em>{testState === "paused" ? "GPS ONLY" : collectorRunning ? "LIVE" : "FROZEN"}</em>
            </summary>
            <div className="bd-rf-session-grid bd-rf-session-grid-c2">
              <span><b>Duration</b><strong>{formatDuration(visibleSession.durationMs)}</strong><small>{formatTime(visibleSession.startedAt)} → {formatTime(visibleSession.endedAt)}</small></span>
              <span><b>Active RF</b><strong>{formatDuration(visibleSession.activeRecordingDurationMs || 0)}</strong><small>{visibleSession.pauseSegmentCount ? `${visibleSession.pauseSegmentCount} pause segment(s)` : "No pauses"}</small></span>
              <span><b>Samples</b><strong>{visibleSession.sampleCount}</strong><small>{visibleSession.gpsCount} GPS points · {visibleSession.activeSampleCount ?? visibleSession.sampleCount} active RF</small></span>
              <span><b>Paused</b><strong>{formatDuration(visibleSession.pausedDurationMs || 0)}</strong><small>GPS-only rows excluded from RF averages</small></span>
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
          </details>
        )}

        {shouldShowDataTestMonitor(selectedMode, dataTest, visibleSession) && (
          <div className={`bd-rf-thp-card bd-rf-thp-monitor-compact ${dataTest.status || "idle"}`}>
            <div className="bd-rf-thp-head bd-rf-thp-head-compact">
              <div>
                <b>{dataTestMonitorTitle(dataTest)}</b>
                <span className="bd-rf-thp-headline">
                  {dataTest.testType === "iperf"
                    ? iperfMonitorHeadline(dataTest, visibleSession)
                    : isOoklaContext({ dataTest, savedSession: visibleSession })
                      ? ooklaMonitorHeadline(dataTest, visibleSession)
                      : isFccContext({ dataTest, savedSession: visibleSession })
                        ? fccMonitorHeadline(dataTest, visibleSession)
                        : (dataTest.message || visibleSession?.appTestMessage || "Avg values are from completed iterations.")}
                </span>
              </div>
              {(() => {
                const badge = throughputStatusBadge({ dataTest, savedSession: visibleSession });
                return <em className={`bd-rf-status ${statusClassName(badge)}`}>{badge}</em>;
              })()}
            </div>
            {isOoklaContext({ dataTest, savedSession: visibleSession }) ? (
              <div className="bd-rf-thp-grid bd-rf-ookla-evidence-grid bd-rf-thp-grid-d2 bd-rf-thp-grid-compact">
                {(() => {
                  const iterations = resolveOoklaEvidenceIterations({ dataTest, savedSession: visibleSession });
                  const evidence = resolveOoklaEvidence({ dataTest, savedSession: visibleSession }) || iterations[iterations.length - 1];
                  const summary = buildOoklaIterationSummary(iterations, dataTest?.ooklaCsvImportDebug || visibleSession?.appOoklaCsvImportDebug || null);
                  const resultIdOnly = resolveOoklaDisplayResultId(evidence);
                  return (
                    <>
                      <span><b>Saved Iterations</b><strong>{iterations.length}</strong></span>
                      <span><b>Evidence Source</b><strong>{displayValue(evidence?.evidenceSource || evidence?.source || "N/A")}</strong></span>
                      <span><b>Avg OOKLA DL Mbps</b><strong>{displayValue(summary.avgDlMbps, " Mbps")}</strong></span>
                      <span><b>Avg OOKLA UL Mbps</b><strong>{displayValue(summary.avgUlMbps, " Mbps")}</strong></span>
                      <span><b>Avg Ping ms</b><strong>{displayValue(summary.avgPingMs, " ms")}</strong></span>
                      <span><b>Avg Jitter ms</b><strong>{displayValue(summary.avgJitterMs, " ms")}</strong></span>
                      <span><b>Latest Result ID</b><strong>{displayValue(resultIdOnly)}</strong></span>
                      <span><b>Latest Server</b><strong>{displayValue(evidence?.serverName || evidence?.serverLocation)}</strong></span>
                      <span><b>Latest Iteration</b><strong>{evidence?.iterationNumber ?? (iterations.length || "N/A")}</strong></span>
                      <span><b>Confirmation</b><strong>{evidence?.confirmation === "fe_confirmed" ? "Confirmed" : evidence ? "Draft" : "N/A"}</strong></span>
                      <span className="bd-rf-ookla-span-2"><b>Captured At</b><strong>{evidence?.capturedAt ? formatLocalDateTime(evidence.capturedAt) : "N/A"}</strong></span>
                    </>
                  );
                })()}
              </div>
            ) : isFccContext({ dataTest, savedSession: visibleSession }) ? (
              <div className="bd-rf-thp-grid bd-rf-thp-grid-d2 bd-rf-thp-grid-compact">
                {(() => {
                  const iterations = Array.isArray(dataTest?.fccEvidenceIterations) && dataTest.fccEvidenceIterations.length
                    ? dataTest.fccEvidenceIterations
                    : resolveFccIterations(visibleSession || {});
                  const fccImport = dataTest?.appFccImport || visibleSession?.appFccImport || null;
                  const summary = buildFccIterationSummary(iterations, fccImport);
                  const latest = iterations[iterations.length - 1] || null;
                  const sourceTotal = fccImport?.originalSourceSummary?.collapsedTestsTotal
                    ?? fccImport?.collapsedTestCount
                    ?? fccImport?.stats?.collapsedTestCount
                    ?? "—";
                  const insideTotal = fccImport?.sessionWindowSummary?.collapsedTestsInsideWindow
                    ?? fccImport?.insideWindowCount
                    ?? fccImport?.stats?.insideWindowCount
                    ?? "—";
                  return (
                    <>
                      <span><b>FCC source parsed</b><strong>{sourceTotal} tests</strong></span>
                      <span><b>Inside BabyDragon session</b><strong>{insideTotal} tests</strong></span>
                      <span><b>Saved FCC evidence</b><strong>{summary.fccIterationsSaved || 0} tests</strong></span>
                      <span><b>Import Status</b><strong>{fccImport?.status || "not_imported"}</strong></span>
                      <span><b>Avg FCC DL Mbps</b><strong>{displayValue(summary.avgFccDlMbps, " Mbps")}</strong></span>
                      <span><b>Avg FCC UL Mbps</b><strong>{displayValue(summary.avgFccUlMbps, " Mbps")}</strong></span>
                      <span><b>Avg FCC Ping ms</b><strong>{displayValue(summary.avgFccPingMs, " ms")}</strong></span>
                      <span><b>Avg FCC Jitter ms</b><strong>{displayValue(summary.avgFccJitterMs, " ms")}</strong></span>
                      <span><b>Saved Wi‑Fi / Cell</b><strong>{summary.wifiCount || 0} / {summary.cellCount || 0}</strong></span>
                      <span><b>Latest Server</b><strong>{displayValue(latest?.fccServerName)}</strong></span>
                      <span><b>APP DL/UL THP</b><strong>N/A</strong></span>
                      <span><b>Evidence Label</b><strong>Imported FCC App</strong></span>
                    </>
                  );
                })()}
              </div>
            ) : (
              <div className="bd-rf-thp-grid bd-rf-thp-grid-d2 bd-rf-thp-grid-compact">
                <span><b>Avg DL THP</b><strong>{formatThroughputWithUnit(formatThroughputLive("dl", { dataTest, savedSession: visibleSession }))}</strong></span>
                <span><b>Avg UL THP</b><strong>{formatThroughputWithUnit(formatThroughputLive("ul", { dataTest, savedSession: visibleSession }))}</strong></span>
                <span><b>Iterations</b><strong>{dataTest.completedIterations || visibleSession?.appCompletedIterations || 0}/{dataTest.iterationsRequested || visibleSession?.appIterationsRequested || resolvedThpIterations}</strong></span>
                <span><b>Wait</b><strong>{dataTest.waitSeconds ?? visibleSession?.appWaitSeconds ?? resolvedThpWaitSeconds}s</strong></span>
              </div>
            )}
            {dataTest.testType === "iperf" ? (
              <>
                <p className="bd-rf-iperf-info-line">{iperfMonitorInfoLine(dataTest)}</p>
                {iperfRunNote(dataTest) ? (
                  <p className="bd-rf-iperf-final-note">{iperfRunNote(dataTest)}</p>
                ) : null}
                {iperfFlatIntervals.length ? (
                  <details className="bd-rf-iperf-intervals-panel" open={iperfIntervalsShouldOpen(dataTest)}>
                    <summary>Intervals ({iperfFlatIntervals.length})</summary>
                    <div className="bd-rf-thp-iteration-list bd-rf-iperf-interval-list">
                      {iperfFlatIntervals.map(({ parentIteration, sample }) => {
                        const formatted = formatIperfIntervalLine(parentIteration, sample);
                        return (
                          <span key={`${parentIteration}-int-${sample.index || sample.start || "sample"}`} className="bd-rf-iperf-interval-row">
                            <strong>{formatted.line}</strong>
                            {formatted.missingNote ? <small>{formatted.missingNote}</small> : null}
                          </span>
                        );
                      })}
                    </div>
                  </details>
                ) : null}
              </>
            ) : null}
            {dataTest.testType === "ftp" ? (
              <div className="bd-rf-thp-iteration-list">
                <span><b>Measured Bytes</b><strong>DL {formatBytesCompact(dataTest.downloadBytes)} / UL {formatBytesCompact(dataTest.uploadBytes)}</strong></span>
                <span><b>Warmup Bytes</b><strong>DL {formatBytesCompact(dataTest.downloadWarmupBytes)} / UL {formatBytesCompact(dataTest.uploadWarmupBytes)}</strong></span>
              </div>
            ) : null}
            {ftpFinalPolishNote(dataTest) ? (
              <p className="bd-rf-ftp-final-note">{ftpFinalPolishNote(dataTest)}</p>
            ) : null}
            {dataTest.testType !== "iperf" && dataTest.testType !== "ookla_app" && thpIterationRows.length ? (
              <div className="bd-rf-thp-iteration-list">
                {thpIterationRows.map((row) => (
                  <span key={`${row.iteration}-${row.startedAt || row.endedAt || "row"}`}>
                    <b>#{row.iteration}</b>
                    <strong>{formatThpIterationSummary(row)}</strong>
                  </span>
                ))}
              </div>
            ) : null}
            {dataTest.error ? <p className="bd-rf-thp-error-note">{dataTest.error}</p> : null}
          </div>
        )}

      </section>

      <details className="bd-mobile-card bd-rf-live-summary-card bd-rf-live-summary-collapsible">
        <summary className="bd-rf-live-summary-head">
          <b>Live RF Summary</b>
          <small>{servingTechnology} · tap to expand live KPIs</small>
        </summary>
        <div className="bd-rf-live-summary-grid">
          <span><b>RAT</b><strong>{servingTechnology}</strong></span>
          <span><b>LTE RSRP</b><strong>{kpiLive("RSRP")}</strong></span>
          <span><b>LTE RSRQ</b><strong>{kpiLive("RSRQ")}</strong></span>
          <span><b>LTE SINR</b><strong>{kpiLive("SINR / RSSNR")}</strong></span>
          <span><b>NR SS-RSRP</b><strong>{kpiLive("SS-RSRP")}</strong></span>
          <span><b>NR SS-RSRQ</b><strong>{kpiLive("SS-RSRQ")}</strong></span>
          <span><b>NR SS-SINR</b><strong>{kpiLive("SS-SINR")}</strong></span>
          <span><b>App DL THP</b><strong>{summaryAppDl}</strong></span>
          <span><b>App UL THP</b><strong>{summaryAppUl}</strong></span>
          <span><b>TrafficStats DL</b><strong>{summaryTrafficDl}</strong></span>
          <span><b>TrafficStats UL</b><strong>{summaryTrafficUl}</strong></span>
          <span><b>Call State</b><strong>{summaryCallState}</strong></span>
        </div>
      </details>

      <details
        className={`bd-mobile-card bd-rf-table-card-compact bd-rf-kpi-table-collapsible ${advancedRfOpen ? "" : "is-collapsed"}`}
        open={advancedRfOpen}
        onToggle={(event) => setAdvancedRfOpen(event.currentTarget.open)}
      >
        <summary className="bd-rf-kpi-table-summary">
          <span>
            <b>Show Advanced RF Table</b>
            <small>RF Poll {rfPollCount ? `#${nativeSnapshot?.snapshotSequence || rfPollCount}` : "waiting"} · {nativeSnapshot?.ok ? "Native live" : collectorBusy ? "Reading..." : "Waiting"}</small>
          </span>
        </summary>
        <div className="bd-rf-kpi-table-body">
          <div className="bd-rf-panel-head bd-rf-panel-head-inline">
            <p><span>CellInfo + SignalStrength · Last {formatTime(lastRfReadTime)}</span></p>
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
            Auto follows serving RAT: {servingTechnology}.
          </p>
          <p className="bd-rf-traffic-stats-note">
            Android TrafficStats DL/UL are mobile byte deltas, not OOKLA or engine THP.
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
        </div>
      </details>

      <details
        key={mapHasGpsSamples ? "rf-map-with-gps" : "rf-map-empty"}
        className="bd-mobile-card bd-rf-map-collapsible"
        defaultOpen={false}
      >
        <summary className="bd-rf-kpi-table-summary">
          <span>
            <b>Route + KPI Map</b>
            <small>{mapHasGpsSamples ? `${visibleSession?.gpsCount || traceMap.gpsCount || 0} GPS samples` : "No GPS samples yet"}</small>
          </span>
        </summary>
        <div className="bd-rf-map-collapsible-body">
          {mapHasGpsSamples ? (
            <>
              <RfLeafletSessionMap
                traceSamples={traceSamples}
                traceMap={traceMap}
                activeTask={activeTask}
                lastGpsLocation={lastGpsLocation}
              />
              <div className="bd-rf-mini-facts bd-rf-mini-facts-c2">
                <span><b>Task</b>{activeTaskLabel}</span>
                <span><b>Session</b>{visibleSession ? `${visibleSession.sampleCount} samples · ${visibleSession.gpsCount} GPS` : "No saved session yet"}</span>
                <span><b>Start</b>{formatGps(visibleSession?.firstGps || traceSamples.find((sample) => sample.gps)?.gps)}</span>
                <span><b>End</b>{formatGps(visibleSession?.lastGps || [...traceSamples].reverse().find((sample) => sample.gps)?.gps)}</span>
              </div>
            </>
          ) : (
            <p className="bd-rf-inline-note">Map opens when GPS samples are available.</p>
          )}
        </div>
      </details>

      <details className="bd-mobile-card bd-rf-legend-collapsible">
        <summary className="bd-rf-kpi-table-summary">
          <span>
            <b>Legend</b>
            <small>RF color thresholds</small>
          </span>
        </summary>
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
      </details>

      {openPanel === "export" && (
        <section className="bd-mobile-card bd-rf-hidden-panel">
          <div className="bd-rf-panel-head">
            <p><b>Report Package</b><span>Summary, trace, THP, voice KPIs, and FCC-style JSON</span></p>
            <button type="button" onClick={() => setOpenPanel("none")}>Hide</button>
          </div>
          {savedSession && testState === "saved" && (
            <p className="bd-rf-inline-note success">
              Saved locally: {savedSession.sampleCount} samples ({savedSession.activeSampleCount ?? savedSession.sampleCount} active RF), {savedSession.gpsCount} GPS points, active {formatDuration(savedSession.activeRecordingDurationMs || 0)}, paused {formatDuration(savedSession.pausedDurationMs || 0)}.
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

      <div className="bd-rf-sticky-action-bar" aria-label="Session actions">
        <div className="bd-rf-action-grid bd-rf-action-grid-safe">
          <button type="button" className="bd-mobile-primary" onClick={() => armWorkflow(selectedMode)}>
            {collectorRunning ? "Restart" : selectedMode === "voice" ? "Start Voice" : "Start Data"}
          </button>
          {testState === "recording" ? (
            <button type="button" className="bd-mobile-secondary bd-rf-pause-btn" onClick={pauseRecording}>
              Pause Recording
            </button>
          ) : null}
          {testState === "paused" ? (
            <button type="button" className="bd-mobile-secondary bd-rf-resume-btn" onClick={resumeRecording}>
              Resume Recording
            </button>
          ) : null}
          <button type="button" className="bd-mobile-secondary" onClick={stopWorkflow} disabled={!collectorRunning && !samples.length}>
            {collectorRunning ? "Stop / Save" : savedSession ? "Saved" : "Stop / Save"}
          </button>
          <button type="button" className="bd-mobile-secondary" onClick={refreshGpsAndRf}>
            {gpsChecking || collectorBusy ? "Checking..." : "GPS + RF"}
          </button>
          {(canExportSession || exportStatus?.startsWith("Building")) ? (
            <button
              type="button"
              className="bd-mobile-secondary"
              disabled={!canExportSession || exportStatus?.startsWith("Building")}
              onClick={exportSavedSession}
            >
              {exportStatus?.startsWith("Building") ? "Exporting..." : "Export"}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
