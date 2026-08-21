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
import { tryEnqueueFieldTestResultAfterSave } from "./submission/enqueueFieldTestResult.js";
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
import {
  buildExcelPlotReportModel,
  isExcelPlotExportableSession,
} from "./reports/excelPlotReportExport";
import { buildExcelPlotReportFile } from "./reports/excelPlotWorkbook";
import { buildUnifiedFieldReportFile } from "./reports/unifiedFieldReportExport";
import {
  listSavedReportPackages,
  hydrateDiscoveredPackage,
  buildUnifiedDraftFromSession,
  filterDraftsForActiveContext,
  summarizeDraftForUi,
} from "./reports/savedReportPackageDiscovery";
import { normalizeConnectivitySnapshot, toJsonConnectivityBlock } from "./reports/connectivitySnapshot";
import { classifyFtpFailure, classifyIperfFailure, classifyNativeHttpFailure } from "./reports/dataTestOutcome";
import { hasMeaningfulTrafficStatsMovement } from "./reports/trafficStatsMeasurement";
import { resolveScenarioKey, scenarioDisplayName } from "./reports/scenarioReportModel";
import {
  buildContinuousCanonicalOutcome,
  controlledEngineDisplayName,
  countControlledIterations,
  deriveContinuousOutcomeStatus,
  deriveControlledRunStatus,
  formatControlledIterationsDisplay,
  formatControlledRunStatusLabel,
  isCompletedIterationRow,
  isControlledTestIncomplete,
  isFailedIterationRow,
  successfulDirectionMbps,
} from "./reports/controlledIterationContract";
import { buildUiKpiLegends, classifyMetricValue } from "./config/rfKpiDisplayConfig";
import { buildVoiceEvents } from "./utils/rfEventDetector";
import {
  MOBILITY_MODE,
  ensureLiveRfPreview,
  promoteToRecordingMode,
  demoteToPreviewMode,
  startMobilitySession,
  stopMobilitySession,
  getMobilityGps,
  getMobilityGpsEvents,
  updateMobilityTestStatus,
  drainNativeMobilitySamples,
  takePendingMobilityRfSamples,
  isMobilitySessionActive,
  getMobilityMode,
  fetchMobilityDiagnostics,
  describeGpsUiStatus,
  describeRfStreamUiStatus,
  getMobilityStartError,
  getLastMobilityStartAck,
  getLatestMobilityRfSample,
  subscribeMobilitySession,
  getMobilitySessionSnapshot,
} from "./session/mobilitySessionController";
import {
  enrichMobilityGpsSample,
  GPS_FRESH_MAX_AGE_MS,
  GPS_LOST_AFTER_MS,
} from "./session/mobilityGpsFreshness";
import {
  ENGINE_IDS,
  engineIdFromUiTestType,
  engineDisplayName,
  jsonDataTestType,
  isControlledEngineId,
  normalizeEngineId,
  uiTestTypeFromEngineId,
} from "./config/engineIdentity";


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
    { group: "Data KPIs", kpi: "Android TrafficStats Mobile DL", unit: "Mbps", avgMode: "traffic", trafficMetric: "dl", trafficScope: "mobile" },
    { group: "Data KPIs", kpi: "Android TrafficStats Mobile UL", unit: "Mbps", avgMode: "traffic", trafficMetric: "ul", trafficScope: "mobile" },
    { group: "Data KPIs", kpi: "Android TrafficStats Total DL", unit: "Mbps", avgMode: "traffic", trafficMetric: "dl", trafficScope: "total" },
    { group: "Data KPIs", kpi: "Android TrafficStats Total UL", unit: "Mbps", avgMode: "traffic", trafficMetric: "ul", trafficScope: "total" },
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
    { group: "Data KPIs", kpi: "Android TrafficStats Mobile DL", unit: "Mbps", avgMode: "traffic", trafficMetric: "dl", trafficScope: "mobile" },
    { group: "Data KPIs", kpi: "Android TrafficStats Mobile UL", unit: "Mbps", avgMode: "traffic", trafficMetric: "ul", trafficScope: "mobile" },
    { group: "Data KPIs", kpi: "Android TrafficStats Total DL", unit: "Mbps", avgMode: "traffic", trafficMetric: "dl", trafficScope: "total" },
    { group: "Data KPIs", kpi: "Android TrafficStats Total UL", unit: "Mbps", avgMode: "traffic", trafficMetric: "ul", trafficScope: "total" },
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

/** Legends/thresholds/colors from shared rfKpiDisplayConfig (also used by Excel Plot Report). */
const KPI_LEGENDS = [
  ...buildUiKpiLegends(),
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
const MAX_THP_ITERATIONS = 999999;
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
    failedIterations: 0,
    attemptedIterations: 0,
    remainingIterations: DEFAULT_THP_ITERATIONS,
    iterationResults: [],
    message: "Internal DL/UL test ready.",
    error: "",
    endReason: null,
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

function directionAppliesToMetric(direction, metric) {
  const d = String(direction || "").toLowerCase();
  if (!d || d === "n/a" || d === "na") return true;
  if (metric === "dl") {
    return d === "dl" || d === "download" || d === "dl_ul" || d === "both"
      || d.includes("dl") || d.includes("down");
  }
  if (metric === "ul") {
    return d === "ul" || d === "upload" || d === "dl_ul" || d === "both"
      || d.includes("ul") || d.includes("up");
  }
  return true;
}

function formatThroughputLive(metric, dataContext = {}) {
  const value = pickThroughputValue(metric, dataContext);
  if (value !== null) return formatThroughputValue(value);

  const active = dataContext.dataTest || {};
  if (active.status === "running") {
    if (active.phase === "session_paused") return "N/A";
    // Native HTTP uses download/upload phases.
    if (metric === "dl" && active.phase === "download") return "Testing...";
    if (metric === "ul" && active.phase === "upload") return "Testing...";
    // FTP / iPerf (and waiting between iterations) use engine phase names.
    const tt = String(active.testType || "").toLowerCase();
    if (tt === "ftp" || tt === "iperf" || tt.includes("http") || tt === "native_http") {
      if (!directionAppliesToMetric(active.direction, metric)) return "N/A";
      return "Testing...";
    }
  }

  return "N/A";
}

function formatThroughputWithUnit(value) {
  if (value === null || value === undefined || value === "") return "N/A";
  const shown = String(value);
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
    .filter((row) => isCompletedIterationRow(row))
    .map((row) => getNumber(row?.[key]))
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** APP throughput from successful directions only (includes partial FTP iterations). */
function averageSuccessfulDirectionThroughput(results, direction) {
  const values = (Array.isArray(results) ? results : [])
    .map((row) => successfulDirectionMbps(row, direction))
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isRealFtpFailureText(text = "") {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return false;
  if (["complete", "success", "ok", "passed", "n/a", "na", "measured"].includes(t)) return false;
  return /fail|error|denied|550|530|timeout|timed out|reject|unable|cannot|refused|not found|permission|passive/.test(t);
}

function resolveContinuousStopPresentation(iterationResults = [], engineLabel = "Data test") {
  const counts = summarizeControlledIterationCounts(iterationResults, null, "continuous_complete");
  const failedRow = [...iterationResults].reverse().find(isFailedIterationRow);
  const reason = String(
    failedRow?.conciseReason
    || failedRow?.error
    || failedRow?.errorMessage
    || failedRow?.message
    || "",
  ).trim();
  const canonical = buildContinuousCanonicalOutcome({
    attempted: counts.attemptedIterations,
    completed: counts.completedIterations,
    failed: counts.failedIterations,
    engineLabel,
    failureReason: reason,
  });
  return {
    counts,
    status: canonical.status,
    error: canonical.error,
    message: canonical.message,
    overall: canonical.overall,
    errorSummary: reason,
    endReason: canonical.endReason,
    title: canonical.status === "failed"
      ? `Continuous ${engineLabel} Failed`
      : canonical.status === "complete_with_failures"
        ? `Continuous ${engineLabel} Saved with Failures`
        : `Continuous ${engineLabel} Saved`,
  };
}

function summarizeControlledIterationCounts(iterationResults, requested, status) {
  return countControlledIterations({
    requested,
    iterationResults,
    status,
  });
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

function isContinuousDataMode(dataTest = {}, visibleSession = {}) {
  const mode = String(
    dataTest.runMode
    || dataTest.setupSnapshot?.runMode
    || visibleSession?.appRunMode
    || visibleSession?.appSetupSnapshot?.runMode
    || "",
  ).toLowerCase();
  const status = String(dataTest.status || visibleSession?.appTestStatus || "").toLowerCase();
  const endReason = String(dataTest.endReason || visibleSession?.appEndReason || "").toLowerCase();
  return mode === "continuous"
    || status === "continuous_complete"
    || endReason === "user_stopped_continuous";
}

function iperfMonitorHeadline(dataTest = {}, visibleSession = {}) {
  const completed = dataTest.completedIterations
    ?? visibleSession?.appCompletedIterations
    ?? 0;
  const continuous = isContinuousDataMode(dataTest, visibleSession);
  const requestedRaw = continuous
    ? null
    : (dataTest.iterationsRequested ?? visibleSession?.appIterationsRequested ?? null);
  const requested = requestedRaw == null || requestedRaw === "" ? null : Number(requestedRaw);
  const statusWord = dataTest.status === "running"
    ? "running"
    : dataTest.status === "complete" || dataTest.status === "continuous_complete"
      ? "complete"
      : dataTest.status === "partial"
        ? "partial"
        : dataTest.status === "error"
          ? "failed"
          : dataTest.status === "stopped" || dataTest.status === "incomplete"
            ? "stopped"
            : "ready";
  if (continuous) return `iPerf3 ${statusWord} · Completed ${completed}`;
  if (requested != null && Number.isFinite(requested)) return `iPerf3 ${statusWord} ${completed}/${requested}`;
  return `iPerf3 ${statusWord} · Completed ${completed}`;
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
  const voice = buildVoiceEvents({ samples, session });
  const events = voice.events || [];
  const ringingEpisodes = events.filter((e) => e.eventType === "CALL_STATE_RINGING").length;
  const answeredObserved = events.filter((e) => e.eventType === "CALL_STATE_OFFHOOK").length;
  const ringingToIdleWithoutOffhook = events.filter((e) => String(e.notes || "").includes("without observed offhook")).length;
  const offhookTransitionCount = answeredObserved;
  const offhookDurations = events
    .map((e) => getNumber(e.observedOffhookDurationSec))
    .filter((n) => n !== null);
  const setupTimes = events
    .map((e) => getNumber(e.setupTimeMs))
    .filter((n) => n !== null);
  const avgRingToOffhookSec = setupTimes.length
    ? Number((setupTimes.reduce((a, b) => a + b, 0) / setupTimes.length / 1000).toFixed(3))
    : null;
  const observedOffhookDurationSec = offhookDurations.length
    ? Number(offhookDurations.reduce((a, b) => a + b, 0).toFixed(3))
    : null;
  const hasPassive = !voiceMode && events.length > 0;
  return {
    voice_monitor_status: voiceMode
      ? "recorded"
      : (hasPassive ? "passive_call_state_observation_in_data_mode" : "not_run_in_data_mode"),
    final_call_state: finalCallState,
    offhook_samples: offhookCount,
    ringing_episodes: ringingEpisodes,
    answered_observed: answeredObserved,
    ringing_to_idle_without_offhook: ringingToIdleWithoutOffhook,
    offhook_transition_count: offhookTransitionCount,
    observed_offhook_duration_sec: observedOffhookDurationSec ?? "N/A",
    average_ringing_to_offhook_sec: avgRingToOffhookSec ?? "N/A",
    attempts: "N/A",
    connected: offhookCount > 0 || answeredObserved > 0 ? "observed_by_call_state" : "N/A",
    drops: "N/A",
    failures: "N/A",
    events,
    remarks: voiceMode
      ? "Public Android call-state samples captured. Manual attempt/connect/drop counters will be added in the dedicated Voice KPI step."
      : (hasPassive
        ? "Data session with passive TelephonyManager call-state observation. Drops/failures/MO/MT/SRVCC/CSFB are N/A."
        : "Data session. No call-state transitions observed."),
  };
}


function getThpWindow(session) {
  const rows = Array.isArray(session?.appIterationResults) ? session.appIterationResults : [];
  const starts = rows.map((row) => getNumber(row.startedAt)).filter((value) => value !== null);
  const ends = rows.map((row) => getNumber(row.endedAt)).filter((value) => value !== null);
  const fallbackStart = getNumber(session?.appTestStartedAt);
  const fallbackEnd = getNumber(session?.appTestEndedAt);
  if ((!starts.length || !ends.length) && fallbackStart !== null && fallbackEnd !== null) {
    const durationMs = Math.max(0, fallbackEnd - fallbackStart);
    return {
      startedAt: fallbackStart,
      endedAt: fallbackEnd,
      durationMs,
      duration: formatDuration(durationMs),
    };
  }
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
    "thp_status", "thp_iterations_attempted", "thp_iterations_failed", "thp_iterations_remaining", "thp_error", "thp_failure_stage", "thp_summary_rule", "thp_end_reason", "report_scope",
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
    "traffic_stats_mobile_avg_dl_mbps", "traffic_stats_mobile_avg_ul_mbps", "traffic_stats_mobile_sample_count",
    "traffic_stats_total_avg_dl_mbps", "traffic_stats_total_avg_ul_mbps", "traffic_stats_total_sample_count",
    "traffic_stats_active_source_note",
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
    app_dl_avg_mbps: (ooklaSession || fccSession)
      ? "N/A"
      : (() => {
        const rows = Array.isArray(session?.appIterationResults) ? session.appIterationResults : [];
        const hasDl = rows.some((r) => {
          if (String(r.dl_status || r.dlStatus || "").toLowerCase() === "failed" || r.dlOk === false) return false;
          return getNumber(r.dlMbps) !== null;
        });
        if (["error", "failed", "failed_before_start"].includes(String(session?.appTestStatus || "").toLowerCase()) && !hasDl) {
          return "N/A";
        }
        return compactNumber(session?.appDlMbps, 2);
      })(),
    app_ul_avg_mbps: (ooklaSession || fccSession)
      ? "N/A"
      : (() => {
        const rows = Array.isArray(session?.appIterationResults) ? session.appIterationResults : [];
        const hasUl = rows.some((r) => {
          if (String(r.ul_status || r.ulStatus || "").toLowerCase() === "failed" || r.ulOk === false) return false;
          return getNumber(r.ulMbps) !== null;
        });
        if (["error", "failed", "failed_before_start"].includes(String(session?.appTestStatus || "").toLowerCase()) && !hasUl) {
          return "N/A";
        }
        return compactNumber(session?.appUlMbps, 2);
      })(),
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
        : (() => {
          const counts = countControlledIterations({
            requested: session?.appIterationsRequested,
            iterationResults: session?.appIterationResults,
            completedIterations: session?.appCompletedIterations,
            failedIterations: session?.appFailedIterations,
            status: session?.appTestStatus,
          });
          return deriveControlledRunStatus({
            requested: counts.requestedIterations,
            attempted: counts.attemptedIterations,
            completed: counts.completedIterations,
            failed: counts.failedIterations,
            remaining: counts.remainingIterations,
            rawStatus: session?.appTestStatus,
            endReason: session?.appEndReason,
          });
        })(),
    thp_error: (() => {
      const st = String(session?.appTestStatus || "").toLowerCase();
      if (st === "error" || st === "failed" || st === "complete_with_failures" || st === "failed_before_start") {
        return session?.appTestError || session?.appTestMessage || "";
      }
      const rows = Array.isArray(session?.appIterationResults) ? session.appIterationResults : [];
      if (rows.some(isFailedIterationRow)) {
        return session?.appTestError || rows.filter(isFailedIterationRow).map((r) => r.error || r.errorCode).filter(Boolean).join("; ") || "";
      }
      return "";
    })(),
    thp_failure_stage: (() => {
      const rows = Array.isArray(session?.appIterationResults) ? session.appIterationResults : [];
      const failed = rows.find(isFailedIterationRow);
      if (failed?.failureStage) return failed.failureStage;
      const st = String(session?.appTestStatus || "").toLowerCase();
      if (st !== "error" && st !== "failed" && st !== "complete_with_failures" && st !== "failed_before_start") return "";
      return "before_transfer";
    })(),
    thp_iterations_attempted: (() => {
      const counts = countControlledIterations({
        requested: session?.appIterationsRequested,
        iterationResults: session?.appIterationResults,
        completedIterations: session?.appCompletedIterations,
        failedIterations: session?.appFailedIterations,
        status: session?.appTestStatus,
      });
      return counts.attemptedIterations;
    })(),
    thp_iterations_failed: (() => {
      const counts = countControlledIterations({
        requested: session?.appIterationsRequested,
        iterationResults: session?.appIterationResults,
        completedIterations: session?.appCompletedIterations,
        failedIterations: session?.appFailedIterations,
        status: session?.appTestStatus,
      });
      return counts.failedIterations;
    })(),
    thp_iterations_remaining: (() => {
      const counts = countControlledIterations({
        requested: session?.appIterationsRequested,
        iterationResults: session?.appIterationResults,
        completedIterations: session?.appCompletedIterations,
        failedIterations: session?.appFailedIterations,
        status: session?.appTestStatus,
      });
      return counts.remainingIterations ?? "";
    })(),
    thp_end_reason: session?.appEndReason || "",
    thp_summary_rule: iperfSession
      ? "Avg DL/UL THP is the arithmetic average of completed iPerf3 iteration rows only."
      : ooklaSession
        ? "OOKLA App DL/UL are FE-confirmed external manual evidence only. Native app DL/UL throughput columns remain N/A."
        : fccSession
          ? "FCC App data is external. BabyDragon-generated FCC evidence is session context only; not BabyDragon engine THP."
          : "Avg DL/UL THP is the arithmetic average of completed THP iterations only. Failed attempts before transfer keep APP DL/UL N/A. Averages label as based on completed iterations.",
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
    traffic_stats_mobile_avg_dl_mbps: compactNumber(session?.trafficStatsAvgDlMbps ?? stats?.trafficStatsDl?.avg, 2),
    traffic_stats_mobile_avg_ul_mbps: compactNumber(session?.trafficStatsAvgUlMbps ?? stats?.trafficStatsUl?.avg, 2),
    traffic_stats_mobile_sample_count: session?.trafficStatsSampleCount ?? stats?.trafficStatsDl?.count ?? "",
    traffic_stats_total_avg_dl_mbps: compactNumber(session?.trafficStatsTotalAvgDlMbps ?? stats?.trafficStatsTotalDl?.avg, 2),
    traffic_stats_total_avg_ul_mbps: compactNumber(session?.trafficStatsTotalAvgUlMbps ?? stats?.trafficStatsTotalUl?.avg, 2),
    traffic_stats_total_sample_count: session?.trafficStatsTotalSampleCount ?? stats?.trafficStatsTotalDl?.count ?? "",
    traffic_stats_active_source_note: session?.trafficStatsActiveSourceNote
      || resolveTrafficStatsSummaryNote(session, stats),
    traffic_stats_supported: session?.trafficStatsSupported ? "yes" : "no",
    traffic_stats_source: "mobile_and_total",
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
    "latitude", "longitude", "gps_accuracy_m", "gps_speed_mps", "gps_status", "gps_fix_age_ms",
    "location_fix_timestamp_iso", "gps_provider",
    "rat", "carrier", "sim_carrier", "network_operator", "data_network_type", "call_state",
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
      gps_accuracy_m: compactNumber(sample?.gps?.accuracy ?? sample?.gps?.accuracy_m, 1),
      gps_speed_mps: compactNumber(sample?.gps?.speed ?? sample?.gps?.speed_mps, 2),
      gps_status: sample?.gps?.gps_status || "",
      gps_fix_age_ms: compactNumber(sample?.gps?.gps_fix_age_ms, 0),
      location_fix_timestamp_iso: sample?.gps?.location_fix_timestamp_iso || "",
      gps_provider: sample?.gps?.provider || "",
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
    "dl_mbps", "ul_mbps", "dl_warmup_bytes", "ul_warmup_bytes", "dl_measured_bytes", "ul_measured_bytes", "dl_total_bytes", "ul_total_bytes", "dl_transfer_seconds", "ul_transfer_seconds", "dl_wall_seconds", "ul_wall_seconds", "dl_source", "ul_source",
    "failure_stage", "error_code", "error_message", "summary_note",
  ];
  const totalRows = (session?.appIterationResults || []).length;
  const rows = (session?.appIterationResults || []).map((item) => {
    const failed = String(item.status || "").toLowerCase() === "failed" || Boolean(item.error || item.errorMessage);
    return {
      iteration: item.iteration,
      status: item.status || (failed ? "failed" : "complete"),
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
      dl_mbps: failed ? "N/A" : compactNumber(item.dlMbps, 2),
      ul_mbps: failed ? "N/A" : compactNumber(item.ulMbps, 2),
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
      failure_stage: item.failureStage || (() => {
        if (!failed || item.failureStage) return item.failureStage || "";
        const msg = item.error || item.errorMessage || "";
        if (!msg) return "";
        const isFtp = String(session?.appTestType || session?.appEngineId || item.source || "").toLowerCase().includes("ftp");
        if (!isFtp) return "";
        return classifyFtpFailure(msg).failureStage || "";
      })(),
      error_code: item.errorCode || (() => {
        if (!failed || item.errorCode) return item.errorCode || "";
        const msg = item.error || item.errorMessage || "";
        if (!msg) return "";
        const isFtp = String(session?.appTestType || session?.appEngineId || item.source || "").toLowerCase().includes("ftp");
        if (!isFtp) return "";
        return classifyFtpFailure(msg).errorCode || "";
      })(),
      error_message: item.error || item.errorMessage || "",
      summary_note: failed
        ? "Failed attempt before successful transfer. APP DL/UL unavailable for this row."
        : "One THP iteration. Averages are calculated from all completed iteration rows.",
    };
  });
  return makeCsv(headers, rows);
}


function buildVoiceCsv(session, activeTask) {
  const samples = session?.exportSamples || session?.traceSamples || [];
  const voice = buildVoiceSummary(session);
  const headers = [
    "row_type", "session_id", "mode", "task", "grid", "timestamp_local", "timestamp_iso",
    "monitor_status", "call_state", "transition", "duration_sec", "source", "confidence", "notes",
    "voice_monitor_status", "offhook_samples", "voice_attempts", "voice_connected", "voice_drops", "voice_failures",
    "ringing_episodes", "answered_observed", "ringing_to_idle_without_offhook", "offhook_transition_count",
    "observed_offhook_duration_sec", "average_ringing_to_offhook_sec", "remarks",
  ];
  const summaryRow = {
    row_type: "voice_summary",
    session_id: session?.id || "",
    mode: session?.mode || "",
    task: session?.taskLabel || getTaskLabel(activeTask),
    grid: session?.grid || getTaskGrid(activeTask),
    timestamp_local: formatLocalDateTime(session?.endedAt),
    timestamp_iso: formatIso(session?.endedAt),
    monitor_status: voice.voice_monitor_status,
    call_state: voice.final_call_state,
    transition: "",
    duration_sec: voice.observed_offhook_duration_sec,
    source: "android_public_api",
    confidence: "confirmed",
    notes: "",
    voice_monitor_status: voice.voice_monitor_status,
    offhook_samples: voice.offhook_samples,
    voice_attempts: voice.attempts,
    voice_connected: voice.connected,
    voice_drops: voice.drops,
    voice_failures: voice.failures,
    ringing_episodes: voice.ringing_episodes,
    answered_observed: voice.answered_observed,
    ringing_to_idle_without_offhook: voice.ringing_to_idle_without_offhook,
    offhook_transition_count: voice.offhook_transition_count,
    observed_offhook_duration_sec: voice.observed_offhook_duration_sec,
    average_ringing_to_offhook_sec: voice.average_ringing_to_offhook_sec,
    remarks: voice.remarks,
  };

  const eventRows = (voice.events || []).map((evt) => ({
    row_type: "voice_event",
    session_id: session?.id || "",
    mode: session?.mode || "",
    task: session?.taskLabel || getTaskLabel(activeTask),
    grid: session?.grid || getTaskGrid(activeTask),
    timestamp_local: formatLocalDateTime(evt.timestampMs),
    timestamp_iso: evt.timestampIso || formatIso(evt.timestampMs),
    monitor_status: voice.voice_monitor_status,
    call_state: evt.callState || "",
    transition: `${evt.transitionFrom || "n/a"} → ${evt.transitionTo || ""}`,
    duration_sec: evt.observedOffhookDurationSec ?? "",
    source: evt.source || "android_public_api",
    confidence: evt.confidence || "confirmed",
    notes: evt.notes || "",
    voice_monitor_status: voice.voice_monitor_status,
    offhook_samples: "",
    voice_attempts: "",
    voice_connected: "",
    voice_drops: "N/A",
    voice_failures: "N/A",
    ringing_episodes: evt.ringingEpisode ?? "",
    answered_observed: "",
    ringing_to_idle_without_offhook: "",
    offhook_transition_count: "",
    observed_offhook_duration_sec: evt.observedOffhookDurationSec ?? "",
    average_ringing_to_offhook_sec: "",
    remarks: evt.details || "",
  }));

  if (session?.mode !== "voice") {
    return makeCsv(headers, [summaryRow, ...eventRows]);
  }

  const sampleRows = samples.map((sample) => ({
    row_type: "voice_call_state_sample",
    session_id: session?.id || sample?.sessionId || "",
    mode: sample?.mode || session?.mode || "",
    task: session?.taskLabel || getTaskLabel(activeTask),
    grid: session?.grid || getTaskGrid(activeTask),
    timestamp_local: formatLocalDateTime(sample?.timestamp),
    timestamp_iso: formatIso(sample?.timestamp),
    monitor_status: voice.voice_monitor_status,
    call_state: sample?.snapshot?.callState || "N/A",
    transition: "",
    duration_sec: "",
    source: "android_public_api",
    confidence: "confirmed",
    notes: "",
    voice_monitor_status: voice.voice_monitor_status,
    offhook_samples: "",
    voice_attempts: "",
    voice_connected: "",
    voice_drops: "",
    voice_failures: "",
    ringing_episodes: "",
    answered_observed: "",
    ringing_to_idle_without_offhook: "",
    offhook_transition_count: "",
    observed_offhook_duration_sec: "",
    average_ringing_to_offhook_sec: "",
    remarks: "Public Android call-state snapshot.",
  }));
  return makeCsv(headers, [summaryRow, ...eventRows, ...sampleRows]);
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
      active_source_note: resolveTrafficStatsSummaryNote(session, stats),
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
        accuracy_m: jsonNumber(sample?.gps?.accuracy ?? sample?.gps?.accuracy_m, 1),
        speed_mps: jsonNumber(sample?.gps?.speed ?? sample?.gps?.speed_mps, 2),
        bearing_deg: jsonNumber(sample?.gps?.bearing ?? sample?.gps?.bearing_deg, 1),
        altitude_m: jsonNumber(sample?.gps?.altitude ?? sample?.gps?.altitude_m, 1),
        gps_status: jsonText(sample?.gps?.gps_status),
        gps_fix_age_ms: jsonNumber(sample?.gps?.gps_fix_age_ms),
        location_fix_timestamp_iso: jsonText(sample?.gps?.location_fix_timestamp_iso),
        location_fix_timestamp_ms: jsonNumber(sample?.gps?.location_fix_timestamp_ms),
        gps_provider: jsonText(sample?.gps?.provider || sample?.gps?.gps_provider),
        gps_is_mock: sample?.gps?.gps_is_mock === true || sample?.gps?.is_mock === true ? true : (sample?.gps?.gps_is_mock === false ? false : null),
        gps_freshness_source: jsonText(sample?.gps?.gps_freshness_source || sample?.source || null),
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
  return (session?.appIterationResults || []).map((item) => {
    const failed = String(item.status || "").toLowerCase() === "failed"
      || String(item.status || "").toLowerCase() === "error"
      || Boolean(item.error || item.errorMessage);
    const engineHint = String(session?.appTestType || session?.appEngineId || item.source || "").toLowerCase();
    const isFtp = engineHint.includes("ftp");
    const isIperf = engineHint.includes("iperf");
    const failText = item.conciseReason || item.error || item.errorMessage || item.message || "";
    const classif = failed && failText
      ? (isFtp
        ? classifyFtpFailure(failText)
        : isIperf
          ? classifyIperfFailure(failText)
          : null)
      : null;
    return {
      iteration: item.iteration,
      status: item.status || (failed ? "failed" : "complete"),
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
        mbps: failed ? null : jsonNumber(item.dlMbps, 2),
        measured_bytes: jsonNumber(item.dlMeasuredBytes ?? item.dlBytes),
        warmup_bytes: jsonNumber(item.dlWarmupBytes || 0),
        total_bytes: jsonNumber((item.dlBytes || 0) + (item.dlWarmupBytes || 0)),
        transfer_seconds: jsonNumber(item.dlSeconds, 3),
        wall_seconds: jsonNumber(item.dlWallSeconds, 3),
        source: jsonText(item.dlSource || item.source),
      },
      ul: {
        mbps: failed ? null : jsonNumber(item.ulMbps, 2),
        measured_bytes: jsonNumber(item.ulMeasuredBytes ?? item.ulBytes),
        warmup_bytes: jsonNumber(item.ulWarmupBytes || 0),
        total_bytes: jsonNumber((item.ulBytes || 0) + (item.ulWarmupBytes || 0)),
        transfer_seconds: jsonNumber(item.ulSeconds, 3),
        wall_seconds: jsonNumber(item.ulWallSeconds, 3),
        source: jsonText(item.ulSource || item.source),
      },
      failure_stage: item.failureStage || classif?.failureStage || null,
      error_code: item.errorCode || classif?.errorCode || null,
      error_message: item.conciseReason || item.error || item.errorMessage || classif?.conciseReason || null,
      failure_reason: item.conciseReason || classif?.conciseReason || item.error || item.errorMessage || null,
    };
  });
}

function resolveSessionEngineId(session = {}) {
  if (session?.appEngineId) return normalizeEngineId(session.appEngineId);
  if (session?.engineId) return normalizeEngineId(session.engineId);
  const type = session?.appTestType || session?.appSetupSnapshot?.testType || "";
  if (isOoklaSession(session) || String(type).includes("ookla")) return ENGINE_IDS.OOKLA_EXTERNAL;
  if (isFccSession(session) || String(type).includes("fcc")) return ENGINE_IDS.FCC_EXTERNAL;
  if (isIperf3Session(session) || String(type).includes("iperf")) return ENGINE_IDS.IPERF3;
  if (String(type).toLowerCase().includes("ftp") || session?.appSource?.includes?.("ftp")) return ENGINE_IDS.FTP;
  if (String(type).includes("http") || String(type).includes("native")) return ENGINE_IDS.NATIVE_HTTP;
  if (Array.isArray(session?.appIterationResults) && session.appIterationResults.length) {
    return ENGINE_IDS.NATIVE_HTTP;
  }
  return ENGINE_IDS.RF_ONLY;
}

function buildJsonDataTest(session) {
  const engineId = resolveSessionEngineId(session);
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

  if (engineId === ENGINE_IDS.RF_ONLY) {
    return {
      type: jsonDataTestType(ENGINE_IDS.RF_ONLY),
      engine_id: ENGINE_IDS.RF_ONLY,
      label: engineDisplayName(ENGINE_IDS.RF_ONLY),
      status: session?.appTestStatus || "rf_only",
      note: "No controlled data-test engine iterations were attempted for this session.",
      requested: null,
      attempted_iterations: 0,
      completed_iterations: 0,
      failed_iterations: 0,
      iterations: [],
      averages: { dl_mbps: null, ul_mbps: null },
    };
  }

  if (engineId === ENGINE_IDS.IPERF3 || isIperf3Session(session)) {
    const iperfModes = resolveIperfExportModes(session?.appCommand || "", session?.appSetupSnapshot || {});
    const iperfFailedRows = thpRows.filter((r) => isFailedIterationRow(r));
    const iperfCompletedRows = thpRows.filter((r) => String(r.status || "").toLowerCase() === "complete");
    const iperfContinuous = String(session?.appRunMode || "").toLowerCase() === "continuous"
      || String(session?.appEndReason || "").toLowerCase() === "user_stopped_continuous"
      || String(session?.appTestStatus || "").toLowerCase() === "continuous_complete";
    const iperfCounts = countControlledIterations({
      requested: iperfContinuous ? null : session?.appIterationsRequested,
      iterationResults: thpRows,
      completedIterations: session?.appCompletedIterations,
      failedIterations: session?.appFailedIterations,
      status: session?.appTestStatus,
    });
    const iperfCanonicalStatus = iperfContinuous
      ? deriveContinuousOutcomeStatus({
        attempted: iperfCounts.attemptedIterations,
        completed: iperfCounts.completedIterations,
        failed: iperfCounts.failedIterations,
      })
      : null;
    const iperfStatus = iperfCanonicalStatus
      || session?.appExportStatus
      || mapIperfExportStatus(session?.appTestStatus)
      || null;
    const iperfFailMessage = (iperfStatus === "continuous_complete" || iperfStatus === "cancelled")
      ? null
      : (session?.appTestError
        || (String(session?.appTestMessage || "").toLowerCase().includes("no attempts") ? "" : session?.appTestMessage)
        || iperfFailedRows.map((r) => r.error || r.errorMessage || r.message).filter(Boolean).join("; ")
        || null);
    const iperfMessage = iperfContinuous
      ? buildContinuousCanonicalOutcome({
        attempted: iperfCounts.attemptedIterations,
        completed: iperfCounts.completedIterations,
        failed: iperfCounts.failedIterations,
        engineLabel: "iPerf3",
        failureReason: session?.appTestError || "",
      }).message
      : (session?.appTestMessage || iperfFailMessage);
    return {
      type: jsonDataTestType(ENGINE_IDS.IPERF3),
      engine_id: ENGINE_IDS.IPERF3,
      label: engineDisplayName(ENGINE_IDS.IPERF3),
      direction: session?.appDirectionLabel || session?.appDirection || null,
      status: iperfStatus,
      error: iperfFailMessage,
      message: iperfMessage,
      summary_rule: "Average DL/UL THP is the arithmetic average of completed iPerf3 iteration rows only.",
      note: "Primary iPerf3 evidence is exported in dedicated iPerf3 CSV/JSON files.",
      requested: {
        server: jsonText(session?.appServer),
        port: jsonNumber(session?.appPort),
        protocol: jsonText(session?.appProtocol),
        streams: jsonNumber(session?.appStreams),
        iterations: session?.appRunMode === "continuous" || session?.appIterationsRequested == null
          ? null
          : jsonNumber(session?.appIterationsRequested ?? thpRows.length),
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
      attempted_iterations: jsonNumber(thpRows.length),
      completed_iterations: jsonNumber(session?.appCompletedIterations ?? iperfCompletedRows.length),
      failed_iterations: jsonNumber(
        session?.appFailedIterations != null
          ? session.appFailedIterations
          : iperfFailedRows.length
            || (String(session?.appTestStatus || session?.appExportStatus || "").toLowerCase().includes("fail")
              || String(session?.appTestStatus || "").toLowerCase() === "error"
              ? Math.max(1, thpRows.length)
              : 0),
      ),
      iterations: buildJsonThpIterations(session),
    };
  }

  if (engineId === ENGINE_IDS.FTP) {
    return {
      type: jsonDataTestType(ENGINE_IDS.FTP),
      engine_id: ENGINE_IDS.FTP,
      label: engineDisplayName(ENGINE_IDS.FTP),
      direction: session?.appDirection || null,
      status: session?.appTestStatus || null,
      error: session?.appTestError || null,
      message: session?.appTestMessage || null,
      summary_rule: "Average DL/UL THP is the arithmetic average of completed FTP iteration rows only.",
      requested: {
        iterations: session?.appRunMode === "continuous" || session?.appIterationsRequested == null
          ? null
          : jsonNumber(session?.appIterationsRequested ?? session?.appIterations ?? thpRows.length),
        duration_sec: jsonNumber(session?.appDurationSeconds),
        warmup_sec: jsonNumber(session?.appWarmupSeconds || 0),
        interval_sec: jsonNumber(session?.appIntervalSeconds),
        wait_between_iterations_sec: jsonNumber(session?.appWaitSeconds),
        host: jsonText(session?.appSetupSnapshot?.host),
        port: jsonNumber(session?.appSetupSnapshot?.port),
      },
      window: windowBlock,
      averages: averagesBlock,
      attempted_iterations: jsonNumber(thpRows.length || (String(session?.appTestStatus || "").toLowerCase() === "error" ? 1 : 0)),
      completed_iterations: jsonNumber(session?.appCompletedIterations ?? thpRows.filter((r) => String(r.status || "").toLowerCase() === "complete").length),
      failed_iterations: jsonNumber(thpRows.filter((r) => String(r.status || "").toLowerCase() === "failed" || r.error).length
        || (String(session?.appTestStatus || "").toLowerCase() === "error" ? 1 : 0)),
      iterations: buildJsonThpIterations(session),
    };
  }

  if (isOoklaSession(session) || engineId === ENGINE_IDS.OOKLA_EXTERNAL) {
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
    type: jsonDataTestType(ENGINE_IDS.NATIVE_HTTP),
    engine_id: ENGINE_IDS.NATIVE_HTTP,
    label: engineDisplayName(ENGINE_IDS.NATIVE_HTTP),
    direction: session?.appDirection || null,
    status: session?.appTestStatus || null,
    error: session?.appTestError || null,
    message: session?.appTestMessage || null,
    failure_stage: (() => {
      const rows = session?.appIterationResults || [];
      const failed = rows.find((r) => String(r.status || "").toLowerCase() === "failed");
      return failed?.failureStage || (String(session?.appTestStatus || "").toLowerCase() === "error" ? "before_transfer" : null);
    })(),
    summary_rule: "Average DL/UL THP is the arithmetic average of completed iteration rows only. Failed attempts before transfer keep APP DL/UL null.",
    requested: {
      iterations: session?.appRunMode === "continuous" || session?.appIterationsRequested == null
        ? null
        : jsonNumber(session?.appIterationsRequested ?? session?.appIterations ?? thpRows.length),
      duration_sec: jsonNumber(session?.appDurationSeconds),
      warmup_sec: jsonNumber(session?.appWarmupSeconds || 0),
      interval_sec: jsonNumber(session?.appIntervalSeconds),
      wait_between_iterations_sec: jsonNumber(session?.appWaitSeconds),
    },
    window: windowBlock,
    averages: averagesBlock,
    completed_iterations: jsonNumber(session?.appCompletedIterations ?? thpRows.filter((r) => String(r.status || "").toLowerCase() === "complete").length),
    attempted_iterations: jsonNumber(thpRows.length || (String(session?.appTestStatus || "").toLowerCase() === "error" ? 1 : 0)),
    failed_iterations: jsonNumber(thpRows.filter((r) => String(r.status || "").toLowerCase() === "failed" || r.error).length
      || (String(session?.appTestStatus || "").toLowerCase() === "error" ? 1 : 0)),
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
    connectivity: toJsonConnectivityBlock(session, samples),
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
  let blob;
  if (file?.encoding === "base64" && file?.contentBase64) {
    const buffer = base64ToArrayBuffer(file.contentBase64);
    blob = new Blob([buffer], { type: file.mimeType || "application/octet-stream" });
  } else {
    blob = new Blob([file.content || ""], { type: `${file.mimeType || "text/plain"};charset=utf-8` });
  }
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
    // Text files use content; binary .xlsx uses encoding=base64 + contentBase64.
    const sessionId = cleanFilePart(reportPackage?.sessionId, `bd-rf-${Date.now()}`);
    const response = await BabyDragonRfKpi.saveReportFiles({
      sessionId,
      displayName: String(reportPackage?.displayName || sessionId),
      files: Array.isArray(reportPackage?.files) ? reportPackage.files : [],
    });
    if (response?.ok) return response;
    throw new Error(response?.message || response?.status || "Native report save failed.");
  }

  (reportPackage.files || []).forEach(downloadTextFile);
  return {
    ok: true,
    fallback: true,
    message: "Report files downloaded by browser fallback.",
    savedFiles: (reportPackage.files || []).map((file) => ({ fileName: file.fileName, path: "browser-download" })),
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

function getCurrentRatName(snapshot, waitLabel = "Waiting for Android") {
  return (
    snapshot?.currentRatName ||
    getServing(snapshot).technology ||
    snapshot?.dataNetworkTypeName ||
    waitLabel
  );
}

function formatAgeSeconds(timestampMs, nowMs = Date.now()) {
  const ts = Number(timestampMs);
  if (!Number.isFinite(ts) || ts <= 0) return "—";
  const ageSec = Math.max(0, Math.round((nowMs - ts) / 1000));
  if (ageSec > 86400 * 365) return "—";
  if (ageSec < 1) return "just now";
  return `${ageSec}s ago`;
}

function resolveNativeRfWaitLabel({
  nativeSnapshot,
  streamStartedAt,
  diagnostics,
  startError,
  lastDrainError,
  firstSampleReceived,
  nowMs = Date.now(),
}) {
  // Valid RF sample (RAT/network) means stream is live — never fail solely due to missing GPS.
  if (
    nativeSnapshot?.ok
    || getServing(nativeSnapshot).technology
    || nativeSnapshot?.dataNetworkTypeName
    || nativeSnapshot?.currentRatName
    || firstSampleReceived
  ) {
    return null;
  }
  const ageMs = streamStartedAt != null ? nowMs - streamStartedAt : null;
  const stream = describeRfStreamUiStatus({
    diagnostics,
    firstSampleReceived,
    startError,
    streamAgeMs: ageMs,
  });
  if (stream.label === "Live") return null;
  if (stream.label === "Starting") {
    if (ageMs != null && ageMs >= 3000) return "Waiting for first native RF sample";
    return "Starting native RF service";
  }
  const reason = stream.reason || startError || lastDrainError || "first_sample_timeout";
  return `Native RF stream unavailable · ${reason}`;
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
    const live = getTrafficStatsLive(row.trafficMetric, dataContext.samples || [], row.trafficScope || "mobile");
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
    const stats = metricStatsFromTrafficSamples(samples, row.trafficMetric, row.trafficScope || "mobile");
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
    const live = getTrafficStatsLive(row.trafficMetric, dataContext.samples || [], row.trafficScope || "mobile");
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

/** F10C2 Phase 2 — task context for result packaging (no secrets). */
function buildSubmissionTaskContext(task) {
  if (!task?.id) return null;
  const projectId = task.project_id || task.projectId || task.projects?.id || null;
  if (!projectId) return null;
  return {
    taskId: task.id,
    projectId,
    gridId: task.grid_id || task.gridId || null,
  };
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
  if (!point) return null;
  const enriched = enrichMobilityGpsSample(point, {
    nowMs: Date.now(),
    previousStatus: point?.gps_status || null,
    source: point?.source || "rf_sample",
  });
  if (enriched.lat == null || enriched.lng == null) return null;
  return {
    lat: enriched.lat,
    lng: enriched.lng,
    accuracy: enriched.accuracy_m ?? enriched.accuracy,
    accuracy_m: enriched.accuracy_m ?? enriched.accuracy,
    speed: enriched.speed_mps ?? enriched.speed,
    speed_mps: enriched.speed_mps ?? enriched.speed,
    heading: enriched.bearing_deg ?? enriched.heading,
    bearing_deg: enriched.bearing_deg ?? enriched.heading,
    altitude: enriched.altitude_m ?? enriched.altitude,
    altitude_m: enriched.altitude_m ?? enriched.altitude,
    provider: enriched.provider,
    location_fix_timestamp_iso: enriched.location_fix_timestamp_iso,
    location_fix_timestamp_ms: enriched.location_fix_timestamp_ms,
    elapsed_realtime_nanos: enriched.elapsed_realtime_nanos,
    gps_fix_age_ms: enriched.gps_fix_age_ms,
    is_mock: enriched.is_mock,
    gps_status: enriched.gps_status,
    timestamp: enriched.location_fix_timestamp_ms || enriched.timestamp || Date.now(),
  };
}

function resolveGpsForSample(fallbackGps) {
  return getMobilityGps() || fallbackGps || null;
}

const TRAFFIC_STATS_NOTE = "android_mobile_and_total_byte_delta";
const TRAFFIC_STATS_SUMMARY_RULE = "Android mobile/total byte deltas; not OOKLA result; not BabyDragon engine THP";
const TRAFFIC_STATS_ENGINE_CONTEXT_NOTE = "BabyDragon engine throughput remains the application test result; TrafficStats is device-network context only.";
const TRAFFIC_STATS_MOBILE_ZERO_TOTAL_MOVED_NOTE = `Mobile-interface counters did not move; total-device counters moved. This may indicate Wi-Fi/routed/offload traffic. ${TRAFFIC_STATS_ENGINE_CONTEXT_NOTE}`;

function resolveTrafficStatsSummaryNote(session = {}, stats = {}) {
  if (session?.trafficStatsActiveSourceNote) return session.trafficStatsActiveSourceNote;
  const mobileMoved = hasMeaningfulTrafficStatsMovement(
    { avg: session?.trafficStatsAvgDlMbps ?? stats?.trafficStatsDl?.avg, max: stats?.trafficStatsDl?.max },
    { avg: session?.trafficStatsAvgUlMbps ?? stats?.trafficStatsUl?.avg, max: stats?.trafficStatsUl?.max },
  );
  const totalMoved = hasMeaningfulTrafficStatsMovement(
    { avg: session?.trafficStatsTotalAvgDlMbps ?? stats?.trafficStatsTotalDl?.avg, max: stats?.trafficStatsTotalDl?.max },
    { avg: session?.trafficStatsTotalAvgUlMbps ?? stats?.trafficStatsTotalUl?.avg, max: stats?.trafficStatsTotalUl?.max },
  );
  if (mobileMoved && totalMoved) return `Mobile and total device counters moved. ${TRAFFIC_STATS_ENGINE_CONTEXT_NOTE}`;
  if (!mobileMoved && totalMoved) return TRAFFIC_STATS_MOBILE_ZERO_TOTAL_MOVED_NOTE;
  if (mobileMoved && !totalMoved) {
    return `Mobile counters moved; total-device counters did not show meaningful movement. ${TRAFFIC_STATS_ENGINE_CONTEXT_NOTE}`;
  }
  if (!mobileMoved && !totalMoved) return "No meaningful TrafficStats movement observed.";
  return TRAFFIC_STATS_SUMMARY_RULE;
}

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

function isValidTrafficStatsSample(sample, scope = "mobile") {
  const stats = sample?.trafficStats;
  if (!stats || stats.trafficStatsSupported !== true) return false;
  // Prefer non-invalid samples, but still allow reading an explicit 0.00 rate when present.
  const dlField = trafficStatsField("dl", scope);
  const ulField = trafficStatsField("ul", scope);
  const hasScopedRate = getNumber(stats?.[dlField]) !== null || getNumber(stats?.[ulField]) !== null;
  if (hasScopedRate) return true;
  return stats.trafficStatsInvalid !== true;
}

function getTrafficStatsLive(metric, samples = [], scope = "mobile") {
  const field = trafficStatsField(metric, scope);
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const sample = samples[index];
    if (!isActiveRfSample(sample)) continue;
    if (!isValidTrafficStatsSample(sample, scope)) continue;
    const value = getNumber(sample.trafficStats?.[field]);
    // Nullish check only — 0 must display as 0.00.
    if (value !== null) return formatThroughputValue(value);
  }
  return "N/A";
}

function buildTrafficStatsActiveSourceNote(samples = []) {
  const mobileDl = metricStatsFromTrafficSamples(samples, "dl", "mobile");
  const mobileUl = metricStatsFromTrafficSamples(samples, "ul", "mobile");
  const totalDl = metricStatsFromTrafficSamples(samples, "dl", "total");
  const totalUl = metricStatsFromTrafficSamples(samples, "ul", "total");
  const mobileMoved = hasMeaningfulTrafficStatsMovement(mobileDl, mobileUl);
  const totalMoved = hasMeaningfulTrafficStatsMovement(totalDl, totalUl);
  if (mobileMoved && totalMoved) {
    return `Mobile and total device counters moved. ${TRAFFIC_STATS_ENGINE_CONTEXT_NOTE}`;
  }
  if (!mobileMoved && totalMoved) return TRAFFIC_STATS_MOBILE_ZERO_TOTAL_MOVED_NOTE;
  if (mobileMoved && !totalMoved) {
    return `Mobile counters moved; total-device counters did not show meaningful movement. ${TRAFFIC_STATS_ENGINE_CONTEXT_NOTE}`;
  }
  return "No meaningful TrafficStats movement observed.";
}

function sessionHasMeaningfulMobileTraffic(samples = []) {
  const mobileDl = metricStatsFromTrafficSamples(samples, "dl", "mobile");
  const mobileUl = metricStatsFromTrafficSamples(samples, "ul", "mobile");
  return hasMeaningfulTrafficStatsMovement(mobileDl, mobileUl);
}

function metricStatsFromTrafficSamples(samples, metric, scope = "mobile") {
  const field = trafficStatsField(metric, scope);
  const values = (samples || [])
    .filter((sample) => isActiveRfSample(sample) && isValidTrafficStatsSample(sample, scope))
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
  const isContinuousApp = String(appSource.runMode || appSource.setupSnapshot?.runMode || "").toLowerCase() === "continuous"
    || String(appSource.status || "").toLowerCase() === "continuous_complete"
    || String(appSource.endReason || "").toLowerCase() === "user_stopped_continuous";
  // Continuous must never invent Requested=1 from placeholder defaults.
  const appIterationsRequested = (isOokla || isFcc)
    ? 0
    : (isContinuousApp
      ? null
      : (appSource.iterationsRequested != null && appSource.iterationsRequested !== ""
        ? clampInteger(appSource.iterationsRequested, 1, MAX_THP_ITERATIONS, DEFAULT_THP_ITERATIONS)
        : clampInteger(appSource.iterations || DEFAULT_THP_ITERATIONS, 1, MAX_THP_ITERATIONS, DEFAULT_THP_ITERATIONS)));
  const iterationCounts = (isOokla || isFcc)
    ? { requestedIterations: 0, attemptedIterations: 0, completedIterations: 0, failedIterations: 0, remainingIterations: 0 }
    : countControlledIterations({
      requested: isContinuousApp ? null : appIterationsRequested,
      iterationResults: appIterationResults,
      completedIterations: appSource.completedIterations,
      failedIterations: appSource.failedIterations,
      status: appSource.status,
    });
  const appCompletedIterations = iterationCounts.completedIterations;
  const appAttemptedIterations = iterationCounts.attemptedIterations;
  const appFailedIterations = iterationCounts.failedIterations;
  const appRemainingIterations = isContinuousApp ? null : iterationCounts.remainingIterations;
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
    // Prefer the exact argv list returned by the native process for the executed iteration.
    const rows = Array.isArray(appIterationResults) ? appIterationResults : [];
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const command = rows[index]?.command;
      if (Array.isArray(command) && command.length) {
        const text = command.map((part) => String(part)).join(" ").trim();
        if (text) return text;
      }
      if (typeof command === "string" && command.trim()) return command.trim();
    }
    if (Array.isArray(diagnosticIperfIter?.command) && diagnosticIperfIter.command.length) {
      return diagnosticIperfIter.command.map((part) => String(part)).join(" ").trim();
    }
    // Only use a pasted customer command when commandMode was the execution path.
    if (setupSnapshot?.commandMode === true) {
      const customer = String(setupSnapshot?.customerCommand || setupSnapshot?.rawCommand || "").trim();
      if (customer) return customer;
    }
    try {
      return buildIperf3CommandFromSetup(setupSnapshot || {});
    } catch {
      return "";
    }
  }

  const savedIperfCommand = isIperf ? resolveSavedIperfCommand() : "";
  const iperfExportModes = isIperf ? resolveIperfExportModes(savedIperfCommand, setupSnapshot || {}) : null;

  // Continuous: canonicalize status/message from frozen iteration counts (never keep stale cancelled/no-attempts).
  const continuousCanonical = (() => {
    if (!isContinuousApp) return null;
    const reason = String(appSource.endReason || "").toLowerCase();
    const st = String(appSource.status || "").toLowerCase();
    const shouldCanonicalize = reason === "user_stopped_continuous"
      || st === "cancelled"
      || st === "continuous_complete"
      || st === "complete_with_failures"
      || st === "failed"
      || st === "stopped"
      || st === "incomplete";
    if (!shouldCanonicalize) return null;
    const failedRow = [...appIterationResults].reverse().find(isFailedIterationRow);
    return buildContinuousCanonicalOutcome({
      attempted: appAttemptedIterations,
      completed: appCompletedIterations,
      failed: appFailedIterations,
      engineLabel: isIperf ? "iPerf3" : controlledEngineDisplayName(appSource.testType),
      failureReason: failedRow?.conciseReason || failedRow?.error || appSource.error || "",
    });
  })();
  const resolvedAppTestStatus = continuousCanonical?.status || appSource.status || "idle";
  const resolvedAppTestMessage = continuousCanonical?.message
    || appSource.message
    || "Internal DL/UL test ready.";
  const resolvedAppTestError = continuousCanonical
    ? continuousCanonical.error
    : (appSource.error || "");
  const resolvedAppEndReason = continuousCanonical?.endReason || appSource.endReason || null;

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
    appExportStatus: mapIperfExportStatus(resolvedAppTestStatus),
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
    trafficStatsActiveSourceNote: buildTrafficStatsActiveSourceNote(activeList),
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
    trafficStatsActiveSourceNote: buildTrafficStatsActiveSourceNote(activeList),
    kpiWarmupDurationSec,
    appDlMbps,
    appUlMbps,
    appDownloadBytes: appSource.downloadBytes || 0,
    appUploadBytes: appSource.uploadBytes || 0,
    appIterationsRequested,
    appCompletedIterations,
    appAttemptedIterations,
    appFailedIterations,
    appRemainingIterations,
    appWaitSeconds,
    appDurationSeconds,
    appIntervalSeconds,
    appWarmupSeconds,
    appDirection,
    appIterationResults,
    appTestStatus: resolvedAppTestStatus,
    appTestPhase: continuousCanonical?.status || appSource.phase || "idle",
    appTestMessage: resolvedAppTestMessage,
    appTestError: resolvedAppTestError,
    appEndReason: resolvedAppEndReason,
    appTestStartedAt: appSource.startedAt || null,
    appTestEndedAt: appSource.endedAt || null,
    appEngineId: (() => {
      if (appSource.engineId) return normalizeEngineId(appSource.engineId);
      if (isIperf) return ENGINE_IDS.IPERF3;
      if (isOokla) return ENGINE_IDS.OOKLA_EXTERNAL;
      if (isFcc) return ENGINE_IDS.FCC_EXTERNAL;
      if (appSource.testType === "ftp") return ENGINE_IDS.FTP;
      if (appSource.testType === "native_http") return ENGINE_IDS.NATIVE_HTTP;
      if (appSource.testType === "iperf") return ENGINE_IDS.IPERF3;
      if (appSource.testType === "ookla_app") return ENGINE_IDS.OOKLA_EXTERNAL;
      if (appSource.testType === "fcc_app") return ENGINE_IDS.FCC_EXTERNAL;
      if (appSource.testType === "rf_only") return ENGINE_IDS.RF_ONLY;
      return ENGINE_IDS.RF_ONLY;
    })(),
    appTestType: appSource.testType
      || (isIperf ? "iperf" : isOokla ? "ookla_app" : isFcc ? "fcc_app" : "rf_only"),
    appRunMode: String(appSource.runMode || appSource.setupSnapshot?.runMode || "fixed").toLowerCase() === "continuous"
      ? "continuous"
      : "fixed",
    appRunModeLabel: String(appSource.runMode || appSource.setupSnapshot?.runMode || "").toLowerCase() === "continuous"
      ? "Continuous"
      : (isOokla || isFcc ? "External Evidence" : "Fixed"),
    appSetupSnapshot: appSource.setupSnapshot || null,
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
    connectivityStart: session?.connectivityStart
      ? normalizeConnectivitySnapshot(session.connectivityStart)
      : null,
    connectivityEnd: (() => {
      if (session?.connectivityEnd) return normalizeConnectivitySnapshot(session.connectivityEnd);
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const c = list[i]?.snapshot?.connectivity;
        if (c && typeof c === "object") return normalizeConnectivitySnapshot(c);
      }
      return null;
    })(),
    connectivitySnapshot: (() => {
      if (session?.connectivityEnd) return normalizeConnectivitySnapshot(session.connectivityEnd);
      if (session?.connectivitySnapshot) return normalizeConnectivitySnapshot(session.connectivitySnapshot);
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const c = list[i]?.snapshot?.connectivity;
        if (c && typeof c === "object") return normalizeConnectivitySnapshot(c);
      }
      return session?.connectivityStart ? normalizeConnectivitySnapshot(session.connectivityStart) : null;
    })(),
    traceSamples: list.slice(-240),
    exportSamples: list,
    frozen: Boolean(session?.endedAt || endedAt),
  };
}

function getSampleRsrp(sample) {
  return metricFromSnapshot(sample?.snapshot, "lteRsrp") ?? metricFromSnapshot(sample?.snapshot, "nrRsrp");
}

function getRsrpQualityClass(rsrp) {
  const classified = classifyMetricValue("lte_rsrp", rsrp);
  if (!classified?.className || classified.className === "missing") return "unknown";
  // Live map CSS historically used 3 bands; collapse excellent→good and bad→poor for class names.
  if (classified.className === "excellent") return "good";
  if (classified.className === "bad") return "poor";
  return classified.className;
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
  mobilityGpsStatus = null,
  rfWorkspaceActive = false,
}) {
  const [selectedMode, setSelectedMode] = useState("data");
  const [testState, setTestState] = useState("idle");
  const [openPanel, setOpenPanel] = useState("none");
  const [ratView, setRatView] = useState("auto");
  const [nativeSnapshot, setNativeSnapshot] = useState(null);
  const [collectorBusy, setCollectorBusy] = useState(false);
  const [collectorRunning, setCollectorRunning] = useState(false);
  const [collectorMessage, setCollectorMessage] = useState("Starting native RF preview…");
  const [mobilityDiagnostics, setMobilityDiagnostics] = useState(null);
  const [nativeStreamStartedAt, setNativeStreamStartedAt] = useState(null);
  const [nativeGpsUiStatus, setNativeGpsUiStatus] = useState(null);
  const [mobilityStartError, setMobilityStartError] = useState(null);
  const [lastMobilityDrainError, setLastMobilityDrainError] = useState(null);
  const [clockForNativeWait, setClockForNativeWait] = useState(Date.now());
  const [firstNativeSampleReceived, setFirstNativeSampleReceived] = useState(false);
  const [lastUiRfTimestamp, setLastUiRfTimestamp] = useState(null);
  const [checkingStartedAt, setCheckingStartedAt] = useState(null);
  const [checkingTimeoutReason, setCheckingTimeoutReason] = useState(null);
  const [rfStreamUi, setRfStreamUi] = useState({ label: "Starting", reason: null });
  const previewEnsureRef = useRef(false);
  const checkingStartedAtRef = useRef(null);
  const firstNativeSampleReceivedRef = useRef(false);
  const collectorBusyRef = useRef(false);
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
  const [excelPlotExportStatus, setExcelPlotExportStatus] = useState("");
  const [excelPlotExportBusy, setExcelPlotExportBusy] = useState(false);
  const [unifiedScenarioDrafts, setUnifiedScenarioDrafts] = useState([]);
  const [unifiedExportBusy, setUnifiedExportBusy] = useState(false);
  const [unifiedExportStatus, setUnifiedExportStatus] = useState("");
  const [unifiedReviewOpen, setUnifiedReviewOpen] = useState(false);
  const [unifiedPanelOpen, setUnifiedPanelOpen] = useState(false);
  const [unifiedManageOpen, setUnifiedManageOpen] = useState(false);
  const [unifiedDiscoveryBusy, setUnifiedDiscoveryBusy] = useState(false);
  const [unifiedDiscoveryWarnings, setUnifiedDiscoveryWarnings] = useState([]);
  const [unifiedCompatibleCount, setUnifiedCompatibleCount] = useState(0);
  const [unifiedPackageCount, setUnifiedPackageCount] = useState(0);
  const [iterationRunMode, setIterationRunMode] = useState("fixed"); // fixed | continuous
  const [controlledTestDialog, setControlledTestDialog] = useState(null);
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
  const exportSamplesRef = useRef([]);
  const LIVE_SAMPLE_PREVIEW_CAP = 900;
  const gpsRef = useRef(lastGpsLocation);
  const dataTestRef = useRef(dataTest);
  const throughputAbortRef = useRef(null);
  const throughputRunPromiseRef = useRef(null);
  const continuousSaveInFlightRef = useRef(false);
  const throughputPhaseAbortRef = useRef(null);
  const controlledTestCompletionRef = useRef(null);
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
    runMode: iterationRunMode,
    iterations: thpIterations,
    waitSeconds: thpWaitSeconds,
    durationSeconds: thpDurationSeconds,
    intervalSeconds: thpIntervalSeconds,
    warmupSeconds: thpWarmupSeconds,
    downloadUrl: nativeDownloadUrl,
    uploadUrl: nativeUploadUrl,
  }), [dataDirection, iterationRunMode, thpIterations, thpWaitSeconds, thpDurationSeconds, thpIntervalSeconds, thpWarmupSeconds, nativeDownloadUrl, nativeUploadUrl]);

  // Run setup is resolved/clamped only when BabyDragon actually starts the test.
  const currentNativeHttpRunSetup = useMemo(() => ({
    ...DEFAULT_NATIVE_HTTP_SETUP,
    direction: dataDirection,
    runMode: iterationRunMode,
    iterations: resolvedThpIterations,
    waitSeconds: resolvedThpWaitSeconds,
    durationSeconds: resolvedThpDurationSeconds,
    intervalSeconds: resolvedThpIntervalSeconds,
    warmupSeconds: resolvedThpWarmupSeconds,
    downloadUrl: nativeDownloadUrl?.trim() || DEFAULT_NATIVE_HTTP_SETUP.downloadUrl,
    uploadUrl: nativeUploadUrl?.trim() || DEFAULT_NATIVE_HTTP_SETUP.uploadUrl,
  }), [dataDirection, iterationRunMode, resolvedThpIterations, resolvedThpWaitSeconds, resolvedThpDurationSeconds, resolvedThpIntervalSeconds, resolvedThpWarmupSeconds, nativeDownloadUrl, nativeUploadUrl]);

  const currentFtpRunSetup = useMemo(() => {
    const runMode = String(ftpSetup?.runMode || iterationRunMode || "fixed").toLowerCase() === "continuous"
      ? "continuous"
      : "fixed";
    return {
      ...DEFAULT_FTP_SETUP,
      ...(ftpSetup || {}),
      testType: "ftp",
      runMode,
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
    };
  }, [ftpSetup, iterationRunMode]);

  const currentIperfRunSetup = useMemo(() => {
    const runMode = String(iperfSetup?.runMode || iterationRunMode || "fixed").toLowerCase() === "continuous"
      ? "continuous"
      : "fixed";
    const direction = String(iperfSetup?.direction || DEFAULT_IPERF_SETUP.direction || "ul").toLowerCase();
    const protocol = String(iperfSetup?.protocol || DEFAULT_IPERF_SETUP.protocol || "TCP").toUpperCase();
    const reverseMode = direction === "dl";
    const bidirMode = direction === "dl_ul" && protocol === "TCP";
    return {
      ...DEFAULT_IPERF_SETUP,
      ...(iperfSetup || {}),
      testType: "iperf",
      runMode,
      direction,
      iterations: clampInteger(iperfSetup?.iterations, 1, MAX_THP_ITERATIONS, DEFAULT_IPERF_SETUP.iterations),
      waitSeconds: clampInteger(iperfSetup?.waitSeconds, 0, MAX_THP_WAIT_SECONDS, DEFAULT_IPERF_SETUP.waitSeconds),
      durationSeconds: clampInteger(iperfSetup?.durationSeconds, 1, MAX_THP_DURATION_SECONDS, DEFAULT_IPERF_SETUP.durationSeconds),
      intervalSeconds: clampInteger(iperfSetup?.intervalSeconds, 1, MAX_THP_INTERVAL_SECONDS, DEFAULT_IPERF_SETUP.intervalSeconds),
      warmupSeconds: clampInteger(iperfSetup?.warmupSeconds, 0, MAX_THP_WARMUP_SECONDS, DEFAULT_IPERF_SETUP.warmupSeconds),
      port: clampInteger(iperfSetup?.port, 1, 65535, DEFAULT_IPERF_SETUP.port),
      streams: clampInteger(iperfSetup?.streams, 1, 64, DEFAULT_IPERF_SETUP.streams),
      udpBitrateMbps: clampInteger(iperfSetup?.udpBitrateMbps, 1, 100000, DEFAULT_IPERF_SETUP.udpBitrateMbps),
      server: String(iperfSetup?.server || DEFAULT_IPERF_SETUP.server || "").trim(),
      protocol,
      reverseMode,
      bidirMode,
    };
  }, [iperfSetup, iterationRunMode]);

  const currentDataTestConfig = useMemo(() => {
    if (dataTestType === "rf_only") {
      return {
        testType: "rf_only",
        engineId: ENGINE_IDS.RF_ONLY,
        ftp: currentFtpRunSetup,
        iperf: currentIperfRunSetup,
        ookla: ooklaSetup,
        fcc: fccSetup,
      };
    }
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
    if (dataTestType === "rf_only") {
      return `${label} · RF/GPS recording only · no data engine`;
    }
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
  const streamAgeMs = nativeStreamStartedAt != null ? clockForNativeWait - nativeStreamStartedAt : null;
  const nativeRfWaitLabel = resolveNativeRfWaitLabel({
    nativeSnapshot,
    streamStartedAt: nativeStreamStartedAt,
    diagnostics: mobilityDiagnostics,
    startError: mobilityStartError || getMobilityStartError(),
    lastDrainError: lastMobilityDrainError,
    firstSampleReceived: firstNativeSampleReceived,
    nowMs: clockForNativeWait,
  });
  const servingTechnology = getCurrentRatName(
    nativeSnapshot,
    rfStreamUi.label === "Live" ? "Waiting for RAT" : (nativeRfWaitLabel || rfStreamUi.label || "Starting native RF service")
  );
  const showRecordingControls = Boolean(
    collectorRunning
    && currentSession?.id
    && (testState === "recording" || testState === "paused")
  );
  const lastGpsFixMs = mobilityDiagnostics?.lastNativeLocationTimestamp
    || mobilityDiagnostics?.lastGpsFixMs
    || getMobilitySessionSnapshot()?.lastNativeGpsFixMs
    || null;
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
  const summaryTrafficMobileDl = getTrafficStatsLive("dl", samples, "mobile");
  const summaryTrafficMobileUl = getTrafficStatsLive("ul", samples, "mobile");
  const summaryTrafficTotalDl = getTrafficStatsLive("dl", samples, "total");
  const summaryTrafficTotalUl = getTrafficStatsLive("ul", samples, "total");
  const showLiveMobileTraffic = sessionHasMeaningfulMobileTraffic(samples);
  const trafficStatsUiNote = buildTrafficStatsActiveSourceNote(samples);
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
    controlledTestCompletionRef.current = (payload) => {
      setControlledTestDialog(payload);
    };
  }, []);

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
    setThpIterations(cleanIntegerDraft(String(setup.iterations ?? ""), 6));
    setThpWaitSeconds(cleanIntegerDraft(String(setup.waitSeconds ?? ""), 3));
    setThpDurationSeconds(cleanIntegerDraft(String(setup.durationSeconds ?? ""), 3));
    setThpIntervalSeconds(cleanIntegerDraft(String(setup.intervalSeconds ?? ""), 2));
    setThpWarmupSeconds(cleanIntegerDraft(String(setup.warmupSeconds ?? ""), 2));
    setNativeDownloadUrl(setup.downloadUrl ?? DEFAULT_NATIVE_HTTP_SETUP.downloadUrl);
    setNativeUploadUrl(setup.uploadUrl ?? DEFAULT_NATIVE_HTTP_SETUP.uploadUrl);
    if (setup.runMode === "continuous" || setup.runMode === "fixed") {
      setIterationRunMode(setup.runMode);
    }
  }

  function handleFtpSetupChange(nextSetup) {
    const setup = { ...DEFAULT_FTP_SETUP, ...(nextSetup || {}) };
    setFtpSetup(setup);
    if (setup.runMode === "continuous" || setup.runMode === "fixed") {
      setIterationRunMode(setup.runMode);
    }
  }

  function handleIperfSetupChange(nextSetup) {
    const setup = { ...DEFAULT_IPERF_SETUP, ...(nextSetup || {}) };
    setIperfSetup(setup);
    if (setup.runMode === "continuous" || setup.runMode === "fixed") {
      setIterationRunMode(setup.runMode);
    }
  }

  async function requestRfPermissionsIfNeeded() {
    if (permissionRequestStarted.current) return;
    permissionRequestStarted.current = true;
    try {
      if (typeof BabyDragonRfKpi.requestRfPermissions === "function") {
        // Never block GPS+RF / mobility start on a stuck permission callback.
        const response = await Promise.race([
          BabyDragonRfKpi.requestRfPermissions(),
          new Promise((resolve) => window.setTimeout(() => resolve({ timedOut: true }), 1500)),
        ]);
        if (response?.permissions) {
          setPermissionStatus(response.permissions);
        }
      }
    } catch (error) {
      setCollectorMessage("RF permission request skipped. Native collector will use whatever Android exposes.");
    }
  }

  function appendBuiltRfSample(snapshot, readNow, { recording = true } = {}) {
    setSamples((current) => {
      const previousSample = [...current].reverse().find((item) => isActiveRfSample(item)) || current[current.length - 1] || null;
      const skipTrafficDelta = trafficStatsSkipBaselineRef.current === true;
      if (skipTrafficDelta) trafficStatsSkipBaselineRef.current = false;
      const gps = resolveGpsForSample(gpsRef.current);
      const sample = buildRfSample({
        snapshot: { ...snapshot, babyDragonReadAt: readNow },
        now: readNow,
        gps,
        session: currentSessionRef.current,
        mode: selectedModeRef.current,
        recording,
      });
      sample.source = snapshot?.mobilityOwned ? "android_mobility_service" : (sample.source || "react_poll");
      sample.trafficStats = buildSampleTrafficStats(snapshot, previousSample, readNow, { skipDelta: skipTrafficDelta });
      exportSamplesRef.current = [...(exportSamplesRef.current || []), sample];
      return [...current.slice(-(LIVE_SAMPLE_PREVIEW_CAP - 1)), sample];
    });
  }

  async function drainAndAppendMobilitySamples() {
    if (!isMobilitySessionActive()) return 0;
    const isPausedSession = testStateRef.current === "paused" && collectorRunningRef.current;
    const isRecordingSession = testStateRef.current === "recording" && collectorRunningRef.current;

    await drainNativeMobilitySamples();
    const batch = takePendingMobilityRfSamples();
    if (!batch.length) return 0;

    let appended = 0;
    for (const raw of batch) {
      const readNow = getNumber(raw?.timestamp) || Date.now();
      const snapshot = raw?.snapshot || raw;
      if (raw?.gps) {
        const lat = raw.gps.lat ?? raw.gps.latitude;
        const lng = raw.gps.lng ?? raw.gps.longitude;
        if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
          gpsRef.current = {
            ...(gpsRef.current || {}),
            ...raw.gps,
            lat: Number(lat),
            lng: Number(lng),
          };
        }
      }
      // Preview + recording: always update Live RF from native samples (RF independent of GPS).
      setNativeSnapshot(snapshot);
      setFirstNativeSampleReceived(true);
      setLastUiRfTimestamp(readNow);
      setCollectorBusy(false);
      setCheckingTimeoutReason(null);
      if (isPausedSession) {
        setSamples((current) => {
          const sample = buildPausedGpsSample({
            now: readNow,
            gps: resolveGpsForSample(raw?.gps || gpsRef.current),
            session: currentSessionRef.current,
            mode: selectedModeRef.current,
          });
          sample.source = "android_mobility_service";
          exportSamplesRef.current = [...(exportSamplesRef.current || []), sample];
          return [...current.slice(-(LIVE_SAMPLE_PREVIEW_CAP - 1)), sample];
        });
      } else if (isRecordingSession) {
        appendBuiltRfSample({ ...snapshot, mobilityOwned: true }, readNow, { recording: true });
      }
      appended += 1;
      setLastRfReadTime(readNow);
      setRfPollCount((count) => count + 1);
    }
    if (appended) {
      setCollectorMessage(`Native RF live · ${appended} sample(s)`);
      setLastMobilityDrainError(null);
      setRfStreamUi({ label: "Live", reason: null });
    }
    return appended;
  }

  async function refreshNativeSnapshot({ append = true } = {}) {
    const isPausedSession = testStateRef.current === "paused" && collectorRunningRef.current;

    // Mobility preview/recording owns Live RF — drain only; never gate on Saved/engine/GPS.
    if (isMobilitySessionActive()) {
      const drained = await drainAndAppendMobilitySamples();
      if (drained > 0) return { ok: true, drained };
      if (Date.now() % 3000 < 1100) {
        try {
          const diagnostics = await fetchMobilityDiagnostics();
          setMobilityDiagnostics(diagnostics);
          setNativeGpsUiStatus(describeGpsUiStatus(diagnostics));
          setLastMobilityDrainError(diagnostics?.lastDrainError || getMobilityStartError() || null);
          const stream = describeRfStreamUiStatus({
            diagnostics,
            firstSampleReceived: firstNativeSampleReceived,
            mode: getMobilityMode(),
            startError: mobilityStartError || getMobilityStartError(),
            streamAgeMs: nativeStreamStartedAt != null ? Date.now() - nativeStreamStartedAt : null,
          });
          setRfStreamUi(stream);
          if (stream.reason && stream.label === "Unavailable") {
            setCheckingTimeoutReason(stream.reason);
            setCollectorBusy(false);
          }
        } catch {
          // keep prior diagnostics
        }
      }
      return { ok: true, drained: 0, waiting_native: true };
    }

    if (isPausedSession && append) {
      const readNow = Date.now();
      setSamples((current) => {
        const sample = buildPausedGpsSample({
          now: readNow,
          gps: resolveGpsForSample(gpsRef.current),
          session: currentSessionRef.current,
          mode: selectedModeRef.current,
        });
        exportSamplesRef.current = [...(exportSamplesRef.current || []), sample];
        return [...current.slice(-(LIVE_SAMPLE_PREVIEW_CAP - 1)), sample];
      });
      setCollectorMessage("Session paused. GPS-only samples continue.");
      return null;
    }

    return null;
  }

  async function bootstrapLiveRfPreview({ forceRestart = false } = {}) {
    setCollectorBusy(true);
    if (!checkingStartedAtRef.current) {
      const startedAt = Date.now();
      checkingStartedAtRef.current = startedAt;
      setCheckingStartedAt(startedAt);
    }
    if (forceRestart) {
      setCheckingTimeoutReason(null);
      setMobilityStartError(null);
    }
    if (!nativeStreamStartedAt || forceRestart) {
      setNativeStreamStartedAt(Date.now());
    }
    setRfStreamUi({ label: "Starting", reason: null });
    try {
      void requestRfPermissionsIfNeeded();
      const started = await ensureLiveRfPreview({
        forceRestart,
        notificationText: collectorRunningRef.current
          ? "Recording RF / GPS / data test"
          : "Live RF / GPS preview",
      });
      setMobilityDiagnostics(started?.diagnostics || null);
      setNativeGpsUiStatus(describeGpsUiStatus(started?.diagnostics, started?.gpsStatus));
      if (started?.firstSampleReceived || started?.lastNativeRfTimestamp) {
        setFirstNativeSampleReceived(true);
        setRfStreamUi({ label: "Live", reason: null });
        setCollectorMessage("Native RF stream live");
        await drainAndAppendMobilitySamples();
      } else if (started?.ok === false && !started?.pendingReady && started?.reason !== "waiting_first_sample") {
        const reason = started?.reason || started?.message || "service_start_failed";
        setMobilityStartError(reason);
        setCheckingTimeoutReason(reason);
        setRfStreamUi({
          label: reason === "permission_error" ? "Permission required" : "Unavailable",
          reason,
        });
        setCollectorMessage(started?.message || reason);
      } else {
        setRfStreamUi({ label: "Starting", reason: started?.reason || "waiting_first_sample" });
        setCollectorMessage(started?.attached ? "Attached — waiting for first RF sample" : "Native RF preview starting");
        await drainAndAppendMobilitySamples();
      }
      return started;
    } catch (error) {
      const reason = "native_exception";
      setMobilityStartError(reason);
      setCheckingTimeoutReason(reason);
      setRfStreamUi({ label: "Unavailable", reason });
      setCollectorMessage(error?.message || reason);
      return null;
    } finally {
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
    // Keep dataTestRef synchronous so Stop & Save never finalizes from a stale empty list
    // while React still has a pending setState updater from native progress events.
    const next = { ...dataTestRef.current, ...patch, updatedAt: Date.now() };
    dataTestRef.current = next;
    setDataTest(next);
  }

  async function runInternalThroughputTest(sessionId, options = {}) {
    if (selectedModeRef.current !== "data") return;

    if (throughputAbortRef.current) {
      throughputAbortRef.current.abort();
    }

    const config = { ...DEFAULT_NATIVE_HTTP_SETUP, ...(options || {}) };
    const continuous = String(config.runMode || iterationRunMode || "fixed").toLowerCase() === "continuous";
    const iterations = continuous
      ? null
      : clampInteger(config.iterations, 1, MAX_THP_ITERATIONS, DEFAULT_THP_ITERATIONS);
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
    const sequenceTimeoutMs = continuous
      ? (24 * 60 * 60 * 1000)
      : (((maxPhaseDurationSeconds * 1000 + 12000) * Math.max(1, phasesPerIteration) * iterations)
        + (waitSeconds * 1000 * Math.max(0, iterations - 1))
        + 8000
        + (2 * 60 * 60 * 1000));
    const clearTimeout = buildTimedSignal(controller, sequenceTimeoutMs);
    const startedAt = Date.now();
    const iterationResults = [];
    let currentAttempt = 0;
    let settleThroughputRun = null;
    const throughputSettlePromise = new Promise((resolve) => { settleThroughputRun = resolve; });
    throughputRunPromiseRef.current = throughputSettlePromise;

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
      runMode: continuous ? "continuous" : "fixed",
      iterationsRequested: continuous ? null : iterations,
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
      message: continuous
        ? `Continuous mode · iteration 1: warmup ${warmupSeconds}s, then native ${direction === "ul" ? "upload" : direction === "dl" ? "download" : "DL/UL"} for ${phaseText}...`
        : `Iteration 1/${iterations}: warmup ${warmupSeconds}s, then native ${direction === "ul" ? "upload" : direction === "dl" ? "download" : "DL/UL"} for ${phaseText}...`,
    });
    updateMobilityTestStatus({
      status: "running",
      notificationText: continuous
        ? "Native HTTP continuous · running until stopped"
        : `Native HTTP ${iterations} iter`,
    });

    const iterLabel = (n) => (continuous ? `Continuous · iter ${n}` : `Iteration ${n}/${iterations}`);

    try {
      for (let iteration = 1; continuous ? !controller.signal.aborted : iteration <= iterations; iteration += 1) {
        if (controller.signal.aborted) break;
        currentAttempt = iteration;
        await waitWhileSessionPaused(sessionPausedRef, controller.signal);
        const iterationStartedAt = Date.now();
        let dl = null;
        let ul = null;

        try {
          if (runDl) {
            await waitForSessionResumeGate(sessionPausedRef, controller.signal, reportNativeHttpPaused);
            patchDataTest({
              status: "running",
              phase: "download",
              currentIteration: iteration,
              message: `${iterLabel(iteration)}: DL warmup ${warmupSeconds}s + measure ${dlDurationSeconds}s...`,
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
                      message: `${iterLabel(iteration)}: downloading ${Math.round(received / 1024 / 1024)} MB...`,
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
              message: `${iterLabel(iteration)}: UL warmup ${warmupSeconds}s + measure ${ulDurationSeconds}s...`,
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
              message: `${iterLabel(iteration)}: DL complete.`,
            });
          }

          await waitForSessionResumeGate(sessionPausedRef, controller.signal, reportNativeHttpPaused);
          const iterationEndedAt = Date.now();
          const iterationResult = {
            iteration,
            status: "complete",
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
            started_at_iso: new Date(iterationStartedAt).toISOString(),
            ended_at_iso: new Date(iterationEndedAt).toISOString(),
            wall_seconds: Math.max(0, (iterationEndedAt - iterationStartedAt) / 1000),
            durationSeconds,
            dlDurationSeconds,
            ulDurationSeconds,
            intervalSeconds,
            warmupSeconds,
            waitSeconds,
            direction,
          };
          iterationResults.push(iterationResult);
        } catch (iterError) {
          if (throughputAbortRef.current !== controller) return;
          if (iterError?.name === "AbortError") throw iterError;

          const message = makeAbortErrorMessage(iterError);
          const endedAt = Date.now();
          const failClass = classifyNativeHttpFailure(message);
          const alreadyRecorded = iterationResults.some((row) => Number(row.iteration) === iteration);
          if (!alreadyRecorded) {
            iterationResults.push({
              iteration,
              status: "failed",
              dlStatus: "failed",
              ulStatus: "not_run",
              dlMbps: null,
              ulMbps: null,
              dlBytes: 0,
              ulBytes: 0,
              dlMeasuredBytes: 0,
              ulMeasuredBytes: 0,
              startedAt: iterationStartedAt,
              endedAt,
              started_at_iso: new Date(iterationStartedAt).toISOString(),
              ended_at_iso: new Date(endedAt).toISOString(),
              wall_seconds: Math.max(0, (endedAt - iterationStartedAt) / 1000),
              direction,
              durationSeconds,
              warmupSeconds,
              intervalSeconds,
              waitSeconds,
              source: "native_http_internal",
              error: message,
              errorMessage: message,
              errorCode: failClass.errorCode,
              failureStage: failClass.failureStage,
              conciseReason: failClass.conciseReason,
            });
          }
        }

        if (throughputAbortRef.current !== controller) return;

        const counts = summarizeControlledIterationCounts(iterationResults, continuous ? null : iterations, "running");
        const avgDl = averageThroughput(iterationResults, "dlMbps");
        const avgUl = averageThroughput(iterationResults, "ulMbps");
        const justCompleted = iterationResults.find((row) => Number(row.iteration) === iteration && isCompletedIterationRow(row));
        const lastFail = [...iterationResults].reverse().find(isFailedIterationRow);
        const allDone = continuous ? false : iteration >= iterations;

        patchDataTest({
          status: "running",
          phase: allDone ? "finalizing" : "wait",
          dlMbps: avgDl,
          ulMbps: avgUl,
          downloadBytes: (dataTestRef.current.downloadBytes || 0) + (justCompleted?.dlBytes || 0),
          uploadBytes: (dataTestRef.current.uploadBytes || 0) + (justCompleted?.ulBytes || 0),
          completedIterations: counts.completedIterations,
          failedIterations: counts.failedIterations,
          attemptedIterations: counts.attemptedIterations,
          remainingIterations: continuous ? null : counts.remainingIterations,
          currentIteration: iteration,
          iterationResults: [...iterationResults],
          error: lastFail?.error || "",
          message: continuous
            ? (lastFail && Number(lastFail.iteration) === iteration
              ? `Continuous · iter ${iteration} failed (${lastFail.errorCode || "ERROR"}). Continuing until stopped...`
              : `Continuous · iter ${iteration} complete. Attempted ${counts.attemptedIterations}, completed ${counts.completedIterations}, failed ${counts.failedIterations}.`)
            : (lastFail && Number(lastFail.iteration) === iteration
              ? `Iteration ${iteration}/${iterations} failed (${lastFail.errorCode || "ERROR"}). ${allDone ? "Sequence finished." : "Waiting before next run..."}`
              : allDone
                ? `Attempt slots finished ${counts.attemptedIterations}/${iterations}. Completed ${counts.completedIterations}, failed ${counts.failedIterations}.`
                : `Iteration ${iteration}/${iterations} complete. Waiting before next run...`),
        });
        updateMobilityTestStatus({
          status: "running",
          notificationText: continuous
            ? `Continuous · ${counts.completedIterations} ok / ${counts.failedIterations} fail`
            : `Native HTTP ${counts.attemptedIterations}/${iterations}`,
        });

        const shouldWait = continuous ? waitSeconds > 0 : (iteration < iterations && waitSeconds > 0);
        if (shouldWait) {
          await waitForSessionResumeGate(sessionPausedRef, controller.signal, reportNativeHttpPaused);
          await waitForThroughputPause(waitSeconds, controller.signal, (remaining) => {
            if (throughputAbortRef.current === controller) {
              patchDataTest({
                status: "running",
                phase: sessionPausedRef.current ? "session_paused" : "wait",
                currentIteration: iteration + 1,
                message: sessionPausedRef.current
                  ? NATIVE_HTTP_SESSION_PAUSED_MESSAGE
                  : continuous
                    ? `Waiting ${remaining}s before continuous iter ${iteration + 1}...`
                    : `Waiting ${remaining}s before iteration ${iteration + 1}/${iterations}...`,
              });
            }
          }, sessionPausedRef);
        }
      }

      if (throughputAbortRef.current !== controller) return;
      if (continuous) {
        // Continuous mode exits the loop only via abort; normal completion path unused.
        return;
      }
      const finalCounts = summarizeControlledIterationCounts(iterationResults, iterations, "complete");
      const finalStatus = deriveControlledRunStatus({
        requested: finalCounts.requestedIterations,
        attempted: finalCounts.attemptedIterations,
        completed: finalCounts.completedIterations,
        failed: finalCounts.failedIterations,
        remaining: finalCounts.remainingIterations,
        rawStatus: "complete",
      });
      const avgDl = averageThroughput(iterationResults, "dlMbps");
      const avgUl = averageThroughput(iterationResults, "ulMbps");
      const endedAt = Date.now();
      const failSummary = iterationResults
        .filter(isFailedIterationRow)
        .map((row) => `Iter ${row.iteration}: ${row.errorCode || "FAILED"}`)
        .join("; ");
      patchDataTest({
        status: finalStatus,
        phase: finalStatus,
        dlMbps: avgDl,
        ulMbps: avgUl,
        completedIterations: finalCounts.completedIterations,
        failedIterations: finalCounts.failedIterations,
        attemptedIterations: finalCounts.attemptedIterations,
        remainingIterations: 0,
        currentIteration: iterations,
        iterationResults: [...iterationResults],
        endedAt,
        error: finalCounts.failedIterations > 0 ? (failSummary || dataTestRef.current.error || "") : "",
        endReason: null,
        message: `Native HTTP ${formatControlledRunStatusLabel(finalStatus)}. Requested ${iterations}, attempted ${finalCounts.attemptedIterations}, completed ${finalCounts.completedIterations}, failed ${finalCounts.failedIterations}.`,
      });
      if (controlledTestCompletionRef.current) {
        controlledTestCompletionRef.current({
          kind: "complete",
          testType: "native_http",
          title: "Native HTTP Test Completed",
          requested: iterations,
          attempted: finalCounts.attemptedIterations,
          completed: finalCounts.completedIterations,
          failed: finalCounts.failedIterations,
          remaining: 0,
          overall: formatControlledRunStatusLabel(finalStatus),
          errorSummary: failSummary,
        });
      }
    } catch (error) {
      if (throughputAbortRef.current !== controller) return;
      const message = makeAbortErrorMessage(error);
      const endedAt = Date.now();
      const isAbort = error?.name === "AbortError";
      if (continuous && isAbort) {
        const stop = resolveContinuousStopPresentation(iterationResults, "Native HTTP");
        const counts = stop.counts;
        const avgDl = averageThroughput(iterationResults, "dlMbps");
        const avgUl = averageThroughput(iterationResults, "ulMbps");
        const totalDlBytes = iterationResults.reduce(
          (sum, item) => sum + (Number(item.dlMeasuredBytes ?? item.dlBytes) || 0),
          0,
        );
        const totalUlBytes = iterationResults.reduce(
          (sum, item) => sum + (Number(item.ulMeasuredBytes ?? item.ulBytes) || 0),
          0,
        );
        patchDataTest({
          status: stop.status,
          phase: stop.status,
          runMode: "continuous",
          dlMbps: avgDl,
          ulMbps: avgUl,
          downloadBytes: totalDlBytes,
          uploadBytes: totalUlBytes,
          completedIterations: counts.completedIterations,
          failedIterations: counts.failedIterations,
          attemptedIterations: counts.attemptedIterations,
          remainingIterations: null,
          iterationsRequested: null,
          currentIteration: currentAttempt,
          iterationResults: [...iterationResults],
          endedAt,
          endReason: stop.endReason,
          error: stop.error,
          message: stop.message,
        });
        if (!continuousSaveInFlightRef.current && controlledTestCompletionRef.current) {
          controlledTestCompletionRef.current({
            kind: "continuous_complete",
            testType: "native_http",
            title: stop.title,
            requested: null,
            attempted: counts.attemptedIterations,
            completed: counts.completedIterations,
            failed: counts.failedIterations,
            remaining: null,
            overall: stop.overall,
            errorSummary: stop.errorSummary,
          });
        }
        return;
      }
      const counts = summarizeControlledIterationCounts(iterationResults, iterations, isAbort ? "incomplete" : "failed");
      const avgDl = averageThroughput(iterationResults, "dlMbps") ?? getNumber(dataTestRef.current.dlMbps);
      const avgUl = averageThroughput(iterationResults, "ulMbps") ?? getNumber(dataTestRef.current.ulMbps);
      if (isAbort) {
        patchDataTest({
          status: "incomplete",
          phase: "incomplete",
          dlMbps: avgDl,
          ulMbps: avgUl,
          completedIterations: counts.completedIterations,
          failedIterations: counts.failedIterations,
          attemptedIterations: counts.attemptedIterations,
          remainingIterations: counts.remainingIterations,
          currentIteration: currentAttempt || dataTestRef.current?.currentIteration || 1,
          iterationResults: [...iterationResults],
          endedAt,
          error: "",
          endReason: "user_stopped_incomplete",
          message: `Native HTTP incomplete. Requested ${iterations}, attempted ${counts.attemptedIterations}, completed ${counts.completedIterations}, failed ${counts.failedIterations}, remaining ${counts.remainingIterations}.`,
        });
      } else {
        // Unexpected escape outside per-iteration catch — record current attempt if needed, then continue is impossible; mark failed_before_start only if nothing attempted
        if (!iterationResults.length && currentAttempt <= 1) {
          patchDataTest({
            status: "failed_before_start",
            phase: "failed_before_start",
            endedAt,
            error: message,
            endReason: "failed_before_start",
            message: `Native HTTP — Failed before start: ${message}`,
          });
        } else {
          const finalStatus = deriveControlledRunStatus({
            requested: counts.requestedIterations,
            attempted: counts.attemptedIterations,
            completed: counts.completedIterations,
            failed: counts.failedIterations,
            remaining: counts.remainingIterations,
            rawStatus: "error",
          });
          patchDataTest({
            status: finalStatus,
            phase: finalStatus,
            dlMbps: avgDl,
            ulMbps: avgUl,
            completedIterations: counts.completedIterations,
            failedIterations: counts.failedIterations,
            attemptedIterations: counts.attemptedIterations,
            remainingIterations: counts.remainingIterations,
            currentIteration: currentAttempt || 1,
            iterationResults: [...iterationResults],
            endedAt,
            error: message,
            message: `Native HTTP — ${formatControlledRunStatusLabel(finalStatus)}: ${message}`,
          });
        }
      }
    } finally {
      clearTimeout();
      if (throughputAbortRef.current === controller) throughputAbortRef.current = null;
      if (typeof settleThroughputRun === "function") settleThroughputRun();
      if (throughputRunPromiseRef.current === throughputSettlePromise) {
        throughputRunPromiseRef.current = null;
      }
    }
  }




  async function runIperfThroughputTest(sessionId, options = {}) {
    if (selectedModeRef.current !== "data") return;

    if (throughputAbortRef.current) {
      throughputAbortRef.current.abort();
      throughputAbortRef.current = null;
    }

    const config = { ...DEFAULT_IPERF_SETUP, ...(options || {}) };
    const continuous = String(config.runMode || iterationRunMode || "fixed").toLowerCase() === "continuous";
    const iterations = continuous
      ? null
      : clampInteger(config.iterations, 1, MAX_THP_ITERATIONS, DEFAULT_THP_ITERATIONS);
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
    const sequenceTimeoutMs = continuous
      ? (24 * 60 * 60 * 1000)
      : (((durationSeconds * 1000 + 30000) * iterations) + (waitSeconds * 1000 * Math.max(0, iterations - 1)) + 10000);
    const clearTimeout = buildTimedSignal(controller, sequenceTimeoutMs);
    let settleThroughputRun = null;
    const throughputSettlePromise = new Promise((resolve) => { settleThroughputRun = resolve; });
    throughputRunPromiseRef.current = throughputSettlePromise;
    let iperfIterationMirror = [];

    patchDataTest({
      status: "running",
      phase: "iperf",
      dlMbps: null,
      ulMbps: null,
      downloadBytes: 0,
      uploadBytes: 0,
      testType: "iperf",
      direction,
      runMode: continuous ? "continuous" : "fixed",
      iterationsRequested: continuous ? null : iterations,
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
        runMode: continuous ? "continuous" : "fixed",
        server,
        port,
        protocol,
        streams,
        udpBitrateMbps,
        reverseMode,
        bidirMode,
        iterations: continuous ? null : iterations,
        waitSeconds,
        durationSeconds,
        intervalSeconds,
        warmupSeconds,
        direction,
      },
      message: continuous
        ? `iPerf3 continuous on ${server || "server"}:${port} · until stopped.`
        : `iPerf3 starting on ${server || "server"}:${port} · ${protocol} · ${reverseMode ? "reverse DL" : bidirMode ? "bidirectional" : "client UL"} · ${durationSeconds}s.`,
    });
    updateMobilityTestStatus({
      status: "running",
      notificationText: continuous ? "iPerf3 continuous · until stopped" : `iPerf3 ${iterations} iter`,
    });

    try {
      const iperfResult = await runIperf3ThroughputTest({
        config: { ...config, runMode: continuous ? "continuous" : "fixed", iterations: continuous ? 1 : iterations },
        signal: controller.signal,
        onProgress: (event) => {
          if (selectedModeRef.current !== "data") return;
          if (Array.isArray(event?.iterationResults) && event.iterationResults.length) {
            iperfIterationMirror = event.iterationResults;
          }
          const rows = (Array.isArray(event?.iterationResults) && event.iterationResults.length)
            ? event.iterationResults
            : (iperfIterationMirror.length
              ? iperfIterationMirror
              : (dataTestRef.current.iterationResults || []));
          patchDataTest({
            status: "running",
            phase: event?.phase || "iperf",
            testType: "iperf",
            runMode: continuous ? "continuous" : "fixed",
            currentIteration: event?.currentIteration || dataTestRef.current.currentIteration || 1,
            completedIterations: event?.completedIterations ?? dataTestRef.current.completedIterations ?? 0,
            iterationsRequested: continuous ? null : (event?.iterationsRequested || iterations),
            dlMbps: event?.dlMbps ?? dataTestRef.current.dlMbps,
            ulMbps: event?.ulMbps ?? dataTestRef.current.ulMbps,
            iterationResults: rows,
            message: event?.message || dataTestRef.current.message || "iPerf3 test running.",
          });
          updateMobilityTestStatus({
            status: "running",
            notificationText: continuous
              ? `iPerf3 continuous · iter ${event?.currentIteration || 1}`
              : `iPerf3 ${event?.currentIteration || 1}/${iterations}`,
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
      if (iterationResults.length) iperfIterationMirror = iterationResults;

      const avgDl = averageThroughput(iterationResults, "dlMbps") ?? getNumber(iperfResult.avgDlMbps);
      const avgUl = averageThroughput(iterationResults, "ulMbps") ?? getNumber(iperfResult.avgUlMbps);
      const totalDlBytes = iterationResults.reduce((sum, item) => sum + (item.dlMeasuredBytes || 0), 0);
      const totalUlBytes = iterationResults.reduce((sum, item) => sum + (item.ulMeasuredBytes || 0), 0);
      if (continuous) {
        const stop = resolveContinuousStopPresentation(iterationResults, "iPerf3");
        const counts = stop.counts;
        patchDataTest({
          status: stop.status,
          phase: stop.status,
          testType: "iperf",
          runMode: "continuous",
          dlMbps: avgDl,
          ulMbps: avgUl,
          downloadBytes: totalDlBytes,
          uploadBytes: totalUlBytes,
          completedIterations: counts.completedIterations,
          failedIterations: counts.failedIterations,
          attemptedIterations: counts.attemptedIterations,
          remainingIterations: null,
          iterationsRequested: null,
          currentIteration: iterationResults.length || 0,
          iterationResults,
          endedAt: Date.now(),
          endReason: stop.endReason,
          error: stop.error,
          message: stop.message,
        });
        if (!continuousSaveInFlightRef.current && controlledTestCompletionRef.current) {
          controlledTestCompletionRef.current({
            kind: "continuous_complete",
            testType: "iperf",
            title: stop.title,
            requested: null,
            attempted: counts.attemptedIterations,
            completed: counts.completedIterations,
            failed: counts.failedIterations,
            remaining: null,
            overall: stop.overall,
            errorSummary: stop.errorSummary,
          });
        }
        return;
      }
      const counts = summarizeControlledIterationCounts(iterationResults, iterations, iperfResult.ok ? "complete" : "error");
      const bidirRequested = bidirMode || String(direction).toLowerCase() === "dl_ul";
      const bidirIncomplete = bidirRequested && (getNumber(avgDl) === null || getNumber(avgUl) === null);
      const finalStatus = deriveControlledRunStatus({
        requested: counts.requestedIterations,
        attempted: counts.attemptedIterations,
        completed: counts.completedIterations,
        failed: counts.failedIterations,
        remaining: counts.remainingIterations,
        rawStatus: iperfResult.ok && !bidirIncomplete ? "complete" : (counts.completedIterations > 0 ? "partial" : "error"),
      });
      const finalMessage = finalStatus === "complete" || finalStatus === "complete_with_failures"
        ? `iPerf3 ${formatControlledRunStatusLabel(finalStatus)} ${counts.attemptedIterations}/${iterations}. Avg DL ${formatThroughputValue(avgDl)} Mbps · Avg UL ${formatThroughputValue(avgUl)} Mbps · DL ${formatBytesCompact(totalDlBytes)} / UL ${formatBytesCompact(totalUlBytes)}.`
        : (iperfResult.message || iperfResult.lastMapped?.message || "iPerf3 test failed.");

      patchDataTest({
        status: finalStatus,
        phase: finalStatus,
        testType: "iperf",
        runMode: "fixed",
        dlMbps: avgDl,
        ulMbps: avgUl,
        downloadBytes: totalDlBytes,
        uploadBytes: totalUlBytes,
        completedIterations: counts.completedIterations,
        failedIterations: counts.failedIterations,
        attemptedIterations: counts.attemptedIterations,
        remainingIterations: counts.remainingIterations,
        currentIteration: iterationResults.length || 0,
        iterationResults,
        endedAt: Date.now(),
        error: finalStatus === "complete" ? "" : finalMessage,
        message: finalMessage,
      });
      if (controlledTestCompletionRef.current) {
        controlledTestCompletionRef.current({
          kind: "complete",
          testType: "iperf",
          title: "iPerf3 Test Completed",
          requested: iterations,
          attempted: counts.attemptedIterations,
          completed: counts.completedIterations,
          failed: counts.failedIterations,
          remaining: counts.remainingIterations,
          overall: formatControlledRunStatusLabel(finalStatus),
          errorSummary: finalStatus === "complete" ? "" : finalMessage,
        });
      }
    } catch (error) {
      if (throughputAbortRef.current === controller) {
        await cancelIperf3();
      }
      if (throughputAbortRef.current !== controller) return;
      const message = makeAbortErrorMessage(error);
      const iterationResults = (iperfIterationMirror.length
        ? iperfIterationMirror
        : (dataTestRef.current.iterationResults || [])).map((item) => ({
        ...item,
        direction,
        durationSeconds,
        intervalSeconds,
        warmupSeconds,
        waitSeconds,
      }));
      if (continuous && error?.name === "AbortError") {
        const stop = resolveContinuousStopPresentation(iterationResults, "iPerf3");
        const counts = stop.counts;
        const avgDl = averageThroughput(iterationResults, "dlMbps") ?? getNumber(dataTestRef.current.dlMbps);
        const avgUl = averageThroughput(iterationResults, "ulMbps") ?? getNumber(dataTestRef.current.ulMbps);
        const totalDlBytes = iterationResults.reduce(
          (sum, item) => sum + (Number(item.dlMeasuredBytes ?? item.dlBytes) || 0),
          0,
        );
        const totalUlBytes = iterationResults.reduce(
          (sum, item) => sum + (Number(item.ulMeasuredBytes ?? item.ulBytes) || 0),
          0,
        );
        patchDataTest({
          status: stop.status,
          phase: stop.status,
          testType: "iperf",
          runMode: "continuous",
          dlMbps: avgDl,
          ulMbps: avgUl,
          downloadBytes: totalDlBytes,
          uploadBytes: totalUlBytes,
          completedIterations: counts.completedIterations,
          failedIterations: counts.failedIterations,
          attemptedIterations: counts.attemptedIterations,
          remainingIterations: null,
          iterationsRequested: null,
          iterationResults: [...iterationResults],
          endedAt: Date.now(),
          endReason: stop.endReason,
          error: stop.error,
          message: stop.message,
        });
        if (!continuousSaveInFlightRef.current && controlledTestCompletionRef.current) {
          controlledTestCompletionRef.current({
            kind: "continuous_complete",
            testType: "iperf",
            title: stop.title,
            requested: null,
            attempted: counts.attemptedIterations,
            completed: counts.completedIterations,
            failed: counts.failedIterations,
            remaining: null,
            overall: stop.overall,
            errorSummary: stop.errorSummary,
          });
        }
        return;
      }
      const counts = summarizeControlledIterationCounts(iterationResults, iterations, error?.name === "AbortError" ? "incomplete" : "failed");
      const avgDl = averageThroughput(iterationResults, "dlMbps") ?? getNumber(dataTestRef.current.dlMbps);
      const avgUl = averageThroughput(iterationResults, "ulMbps") ?? getNumber(dataTestRef.current.ulMbps);
      patchDataTest({
        status: error?.name === "AbortError" ? "incomplete" : deriveControlledRunStatus({
          requested: counts.requestedIterations,
          attempted: counts.attemptedIterations,
          completed: counts.completedIterations,
          failed: counts.failedIterations,
          remaining: counts.remainingIterations,
          rawStatus: "error",
          endReason: error?.name === "AbortError" ? "user_stopped_incomplete" : null,
        }),
        phase: error?.name === "AbortError" ? "incomplete" : "failed",
        testType: "iperf",
        dlMbps: avgDl,
        ulMbps: avgUl,
        completedIterations: counts.completedIterations,
        failedIterations: counts.failedIterations,
        attemptedIterations: counts.attemptedIterations,
        remainingIterations: counts.remainingIterations,
        iterationResults: [...iterationResults],
        endedAt: Date.now(),
        error: error?.name === "AbortError" ? "" : message,
        endReason: error?.name === "AbortError" ? "user_stopped_incomplete" : null,
        message,
      });
    } finally {
      clearTimeout();
      if (throughputAbortRef.current === controller) throughputAbortRef.current = null;
      if (typeof settleThroughputRun === "function") settleThroughputRun();
      if (throughputRunPromiseRef.current === throughputSettlePromise) {
        throughputRunPromiseRef.current = null;
      }
    }
  }


  async function runFtpThroughputTest(sessionId, options = {}) {
    if (selectedModeRef.current !== "data") return;

    if (throughputAbortRef.current) {
      throughputAbortRef.current.abort();
      throughputAbortRef.current = null;
    }

    const config = { ...DEFAULT_FTP_SETUP, ...(options || {}) };
    const continuous = String(config.runMode || iterationRunMode || "fixed").toLowerCase() === "continuous";
    const iterations = continuous
      ? null
      : clampInteger(config.iterations, 1, MAX_THP_ITERATIONS, DEFAULT_THP_ITERATIONS);
    const waitSeconds = clampInteger(config.waitSeconds, 0, MAX_THP_WAIT_SECONDS, DEFAULT_THP_WAIT_SECONDS);
    const durationSeconds = clampInteger(config.durationSeconds, 1, MAX_THP_DURATION_SECONDS, DEFAULT_THP_DURATION_SECONDS);
    const intervalSeconds = clampInteger(config.intervalSeconds, 1, MAX_THP_INTERVAL_SECONDS, DEFAULT_THP_INTERVAL_SECONDS);
    const warmupSeconds = clampInteger(config.warmupSeconds, 0, MAX_THP_WARMUP_SECONDS, DEFAULT_THP_WARMUP_SECONDS);
    const direction = config.direction || DEFAULT_DATA_DIRECTION;
    const { dlDurationSeconds, ulDurationSeconds, phaseText } = splitIterationDuration(durationSeconds, direction);
    const startedAt = Date.now();
    const controller = new AbortController();
    throughputAbortRef.current = controller;
    const iterationResults = [];
    let settleThroughputRun = null;
    const throughputSettlePromise = new Promise((resolve) => { settleThroughputRun = resolve; });
    throughputRunPromiseRef.current = throughputSettlePromise;

    patchDataTest({
      status: "running",
      phase: "ftp",
      dlMbps: null,
      ulMbps: null,
      downloadBytes: 0,
      uploadBytes: 0,
      testType: "ftp",
      direction,
      runMode: continuous ? "continuous" : "fixed",
      iterationsRequested: continuous ? null : iterations,
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
        runMode: continuous ? "continuous" : "fixed",
        iterations: continuous ? null : iterations,
        waitSeconds,
        durationSeconds,
        intervalSeconds,
        warmupSeconds,
      },
      message: continuous
        ? `FTP continuous starting on ${config.host || "FTP host"} · ${phaseText}.`
        : `FTP test starting on ${config.host || "FTP host"} · ${phaseText} · warmup ${warmupSeconds}s.`,
    });
    updateMobilityTestStatus({
      status: "running",
      notificationText: continuous ? "FTP continuous · until stopped" : `FTP ${iterations} iter`,
    });

    const mapFtpIterations = (rows, baseIterationOffset = 0) => (rows || []).map((item, idx) => {
      // Never treat direction status labels ("complete") as error text — that polluted
      // isFailedIterationRow and flipped successful UL into overall failed (F9A).
      const sideError = [
        item.dl_error,
        item.ul_error,
        item.error,
        item.errorMessage,
      ].map((v) => String(v || "").trim()).find((v) => isRealFtpFailureText(v)) || "";
      const statusRaw = String(item.status || item.overall_status || "").toLowerCase();
      const failedByStatus = statusRaw === "failed"
        || statusRaw === "partial_failure"
        || statusRaw === "partial"
        || String(item.dl_status || item.dlStatus || "").toLowerCase() === "failed"
        || String(item.ul_status || item.ulStatus || "").toLowerCase() === "failed"
        || item.dlOk === false
        || item.ulOk === false
        || isRealFtpFailureText(sideError);
      let status = item.status || item.overall_status || "complete";
      if (statusRaw === "partial_failure" || statusRaw === "partial") status = "partial_failure";
      else if (failedByStatus && statusRaw !== "complete" && statusRaw !== "success") status = statusRaw === "partial_failure" ? "partial_failure" : "failed";
      else if (failedByStatus && (item.dlOk === false || item.ulOk === false) && (item.dlOk === true || item.ulOk === true || getNumber(item.ulMbps) != null || getNumber(item.dlMbps) != null)) {
        status = "partial_failure";
      } else if (failedByStatus) {
        status = "failed";
      } else {
        status = "complete";
      }
      const classif = sideError
        ? classifyFtpFailure(sideError, {
          direction: item.direction || direction,
          failureStage: item.failureStage,
          dlFailed: item.dlOk === false || String(item.dl_status || item.dlStatus || "").toLowerCase() === "failed",
          ulFailed: item.ulOk === false || String(item.ul_status || item.ulStatus || "").toLowerCase() === "failed",
        })
        : null;
      const dlFailed = item.dlOk === false || String(item.dl_status || item.dlStatus || "").toLowerCase() === "failed";
      const ulFailed = item.ulOk === false || String(item.ul_status || item.ulStatus || "").toLowerCase() === "failed";
      return {
        iteration: item.iteration != null ? (Number(item.iteration) + baseIterationOffset) : (baseIterationOffset + idx + 1),
        status,
        overall_status: status,
        direction,
        // APP throughput only — null when that direction failed (do not keep invalid Mbps).
        dlMbps: dlFailed ? null : (item.dlMbps ?? null),
        ulMbps: ulFailed ? null : (item.ulMbps ?? null),
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
        dlSource: "native-ftp-v1g2a",
        ulSource: "native-ftp-v1g2a",
        source: "native-ftp-v1g2a",
        startedAt: item.startedAtMs || startedAt,
        endedAt: item.endedAtMs || Date.now(),
        durationSeconds,
        dlDurationSeconds,
        ulDurationSeconds,
        intervalSeconds,
        warmupSeconds,
        waitSeconds,
        dlOk: item.dlOk,
        ulOk: item.ulOk,
        dlStatus: item.dl_status || item.dlStatus || "",
        ulStatus: item.ul_status || item.ulStatus || "",
        dl_status: item.dl_status || item.dlStatus || "",
        ul_status: item.ul_status || item.ulStatus || "",
        dl_error: item.dl_error || (dlFailed ? sideError : ""),
        ul_error: item.ul_error || (ulFailed ? sideError : ""),
        error: sideError,
        errorMessage: sideError,
        errorCode: item.errorCode || classif?.errorCode || "",
        failureStage: item.failureStage || classif?.failureStage || "",
        raw_server_reply: item.raw_server_reply || sideError || "",
      };
    });

    try {
      if (continuous) {
        // One native slot at a time so Stop can end between iterations without changing transfer math.
        for (let iteration = 1; !controller.signal.aborted; iteration += 1) {
          if (controller.signal.aborted) break;
          patchDataTest({
            status: "running",
            phase: "ftp",
            currentIteration: iteration,
            message: `FTP continuous · iter ${iteration}...`,
          });
          let ftpResult;
          try {
            ftpResult = await runBabyDragonFtpTest({
              sessionId,
              task: activeTask,
              grid: activeGrid ? { name: activeGrid } : null,
              ftpConfig: {
                ...config,
                iterations: 1,
                waitSeconds: 0,
                durationSeconds,
                intervalSeconds,
                warmupSeconds,
                durationSec: durationSeconds,
                warmupSec: warmupSeconds,
                intervalSec: intervalSeconds,
                waitSec: 0,
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
                  currentIteration: iteration,
                  message: event?.message || `FTP continuous · iter ${iteration}`,
                });
              },
            });
          } catch (iterError) {
            if (controller.signal.aborted) break;
            iterationResults.push({
              iteration,
              status: "failed",
              direction,
              dlMbps: null,
              ulMbps: null,
              startedAt: Date.now(),
              endedAt: Date.now(),
              error: iterError?.message || "FTP iteration failed",
              errorCode: "FTP_ITERATION_FAILED",
              source: "native-ftp-v1g2a",
            });
          }
          if (ftpResult) {
            const mapped = mapFtpIterations(ftpResult.iterations || [], iteration - 1);
            if (mapped.length) iterationResults.push(...mapped.map((row, i) => ({ ...row, iteration: iteration + i })));
            else {
              iterationResults.push({
                iteration,
                status: ftpResult.ok ? "complete" : "failed",
                direction,
                dlMbps: ftpResult.avgDlMbps ?? null,
                ulMbps: ftpResult.avgUlMbps ?? null,
                dlMeasuredBytes: ftpResult.dlMeasuredBytes || 0,
                ulMeasuredBytes: ftpResult.ulMeasuredBytes || 0,
                startedAt: ftpResult.startedAtMs || Date.now(),
                endedAt: ftpResult.endedAtMs || Date.now(),
                error: ftpResult.ok ? "" : (ftpResult.message || ""),
                source: ftpResult.source || "native-ftp-v1g2a",
              });
            }
          }
          const counts = summarizeControlledIterationCounts(iterationResults, null, "running");
          const avgDl = averageSuccessfulDirectionThroughput(iterationResults, "dl");
          const avgUl = averageSuccessfulDirectionThroughput(iterationResults, "ul");
          patchDataTest({
            status: "running",
            phase: "ftp",
            runMode: "continuous",
            dlMbps: avgDl,
            ulMbps: avgUl,
            completedIterations: counts.completedIterations,
            failedIterations: counts.failedIterations,
            attemptedIterations: counts.attemptedIterations,
            remainingIterations: null,
            currentIteration: iteration,
            iterationResults: [...iterationResults],
            message: `FTP continuous · attempted ${counts.attemptedIterations}, completed ${counts.completedIterations}, failed ${counts.failedIterations}.`,
          });
          updateMobilityTestStatus({
            status: "running",
            notificationText: `FTP continuous · ${counts.completedIterations} ok / ${counts.failedIterations} fail`,
          });
          if (controller.signal.aborted) break;
          if (waitSeconds > 0) {
            await waitForThroughputPause(waitSeconds, controller.signal, (remaining) => {
              patchDataTest({
                status: "running",
                phase: "wait",
                message: `Waiting ${remaining}s before FTP continuous iter ${iteration + 1}...`,
              });
            }, sessionPausedRef);
          }
        }
        const stop = resolveContinuousStopPresentation(iterationResults, "FTP");
        const counts = stop.counts;
        const avgDl = averageSuccessfulDirectionThroughput(iterationResults, "dl");
        const avgUl = averageSuccessfulDirectionThroughput(iterationResults, "ul");
        patchDataTest({
          status: stop.status,
          phase: stop.status,
          runMode: "continuous",
          dlMbps: avgDl,
          ulMbps: avgUl,
          completedIterations: counts.completedIterations,
          failedIterations: counts.failedIterations,
          attemptedIterations: counts.attemptedIterations,
          remainingIterations: null,
          iterationsRequested: null,
          iterationResults: [...iterationResults],
          endedAt: Date.now(),
          endReason: stop.endReason,
          error: stop.error,
          message: stop.message,
        });
        if (!continuousSaveInFlightRef.current && controlledTestCompletionRef.current) {
          controlledTestCompletionRef.current({
            kind: "continuous_complete",
            testType: "ftp",
            title: stop.title,
            requested: null,
            attempted: counts.attemptedIterations,
            completed: counts.completedIterations,
            failed: counts.failedIterations,
            remaining: null,
            overall: stop.overall,
            errorSummary: stop.errorSummary,
          });
        }
        return;
      }

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
          updateMobilityTestStatus({
            status: "running",
            notificationText: `FTP ${event?.iteration || 1}/${iterations}`,
          });
        },
      });

      iterationResults.push(...mapFtpIterations(ftpResult.iterations || []));

      const avgDl = averageSuccessfulDirectionThroughput(iterationResults, "dl");
      const avgUl = averageSuccessfulDirectionThroughput(iterationResults, "ul");
      const totalDlBytes = iterationResults.reduce((sum, item) => sum + (item.dlMeasuredBytes || 0), 0);
      const totalUlBytes = iterationResults.reduce((sum, item) => sum + (item.ulMeasuredBytes || 0), 0);
      const totalDlWarmupBytes = iterationResults.reduce((sum, item) => sum + (item.dlWarmupBytes || 0), 0);
      const totalUlWarmupBytes = iterationResults.reduce((sum, item) => sum + (item.ulWarmupBytes || 0), 0);
      const needsDlBytes = direction !== "ul";
      const needsUlBytes = direction !== "dl";
      const hasRequestedBytes = (!needsDlBytes || totalDlBytes > 0) && (!needsUlBytes || totalUlBytes > 0);
      const hasAnyMeasuredBytes = totalDlBytes > 0 || totalUlBytes > 0;
      const counts = summarizeControlledIterationCounts(iterationResults, iterations, ftpResult.ok ? "complete" : "error");
      const finalFtpStatus = deriveControlledRunStatus({
        requested: counts.requestedIterations,
        attempted: counts.attemptedIterations,
        completed: counts.completedIterations,
        failed: counts.failedIterations,
        remaining: counts.remainingIterations,
        rawStatus: ftpResult.ok && hasRequestedBytes ? "complete" : hasAnyMeasuredBytes ? "partial" : "error",
      });
      const finalFtpPhase = finalFtpStatus;
      const zeroByteMessage = "FTP completed but no measured bytes were captured. Use a larger FTP file or a controlled FTP server. For Rebex smoke test, try Warmup 0.";
      const partialMessage = ftpResult?.message || "FTP partial result. One direction completed, another direction failed or captured zero measured bytes.";
      // Prefer atomic per-iteration failure text — never invent FTP_FAILED from status labels.
      const atomicFail = iterationResults.find(isFailedIterationRow);
      const failureMessage = atomicFail?.errorMessage || atomicFail?.error || ftpResult?.message || zeroByteMessage;

      patchDataTest({
        status: finalFtpStatus,
        phase: finalFtpPhase,
        testType: "ftp",
        runMode: "fixed",
        dlMbps: avgDl,
        ulMbps: avgUl,
        downloadBytes: totalDlBytes,
        uploadBytes: totalUlBytes,
        downloadWarmupBytes: totalDlWarmupBytes,
        uploadWarmupBytes: totalUlWarmupBytes,
        completedIterations: counts.completedIterations,
        failedIterations: counts.failedIterations,
        attemptedIterations: counts.attemptedIterations,
        remainingIterations: counts.remainingIterations,
        currentIteration: iterationResults.length || 0,
        iterationResults,
        endedAt: Date.now(),
        error: finalFtpStatus === "complete" ? "" : finalFtpStatus === "complete_with_failures" || finalFtpStatus === "incomplete" ? partialMessage : failureMessage,
        message: finalFtpStatus === "complete"
          ? `FTP complete ${counts.attemptedIterations}/${iterations}. Avg DL ${formatThroughputValue(avgDl)} Mbps · Avg UL ${formatThroughputValue(avgUl)} Mbps · DL ${formatBytesCompact(totalDlBytes)} / UL ${formatBytesCompact(totalUlBytes)}.`
          : finalFtpStatus === "complete_with_failures"
            ? `FTP completed with failures: ${counts.attemptedIterations} attempted, ${counts.completedIterations} completed, ${counts.failedIterations} failed. ${partialMessage}`
            : finalFtpStatus === "incomplete"
              ? `${partialMessage} · DL ${formatBytesCompact(totalDlBytes)} / UL ${formatBytesCompact(totalUlBytes)}.`
            : failureMessage,
      });
      if (controlledTestCompletionRef.current) {
        controlledTestCompletionRef.current({
          kind: "complete",
          testType: "ftp",
          title: finalFtpStatus === "complete_with_failures"
            ? "FTP Completed with Failures"
            : "FTP Test Completed",
          requested: iterations,
          attempted: counts.attemptedIterations,
          completed: counts.completedIterations,
          failed: counts.failedIterations,
          remaining: counts.remainingIterations,
          overall: finalFtpStatus === "complete_with_failures"
            ? `FTP completed with failures: ${counts.attemptedIterations} attempted, ${counts.completedIterations} completed, ${counts.failedIterations} failed.`
            : formatControlledRunStatusLabel(finalFtpStatus),
          errorSummary: finalFtpStatus === "complete" ? "" : (ftpResult?.message || partialMessage),
        });
      }
    } catch (error) {
      if (continuous && error?.name === "AbortError") {
        const stop = resolveContinuousStopPresentation(iterationResults, "FTP");
        const counts = stop.counts;
        patchDataTest({
          status: stop.status,
          phase: stop.status,
          runMode: "continuous",
          completedIterations: counts.completedIterations,
          failedIterations: counts.failedIterations,
          attemptedIterations: counts.attemptedIterations,
          remainingIterations: null,
          iterationResults: [...iterationResults],
          endedAt: Date.now(),
          endReason: stop.endReason,
          error: stop.error,
          message: stop.message,
        });
        if (!continuousSaveInFlightRef.current && controlledTestCompletionRef.current) {
          controlledTestCompletionRef.current({
            kind: "continuous_complete",
            testType: "ftp",
            title: stop.title,
            requested: null,
            attempted: counts.attemptedIterations,
            completed: counts.completedIterations,
            failed: counts.failedIterations,
            remaining: null,
            overall: stop.overall,
            errorSummary: stop.errorSummary,
          });
        }
        return;
      }
      const message = error?.message || "FTP test failed.";
      patchDataTest({
        status: "failed",
        phase: "failed",
        testType: "ftp",
        completedIterations: dataTestRef.current.completedIterations || 0,
        iterationResults: dataTestRef.current.iterationResults || iterationResults,
        endedAt: Date.now(),
        error: message,
        message,
      });
    } finally {
      if (throughputAbortRef.current === controller) throughputAbortRef.current = null;
      if (typeof settleThroughputRun === "function") settleThroughputRun();
      if (throughputRunPromiseRef.current === throughputSettlePromise) {
        throughputRunPromiseRef.current = null;
      }
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

    // F10B: once inside-window tests are matched, promote them to saved FCC evidence automatically.
    // Avoids Parsed/Selected > 0 with Saved = 0 after a successful import.
    if (parsed.ok) {
      const selected = (importMeta.rows || []).filter(
        (row) => row?.include && row?.insideBabyDragonTimeWindow === "yes" && !row?.addedToIterations,
      );
      if (selected.length) {
        const saveResult = await saveFccEvidenceIterations(selected, importMeta);
        const addedIds = new Set((saveResult?.addedTestIds || []).map((id) => String(id)));
        const rows = (importMeta.rows || []).map((row) => (
          addedIds.has(String(row.fccTestId))
            ? {
              ...row,
              include: false,
              manualInclude: false,
              addedToIterations: true,
              status: "added",
            }
            : row
        ));
        const savedCount = rows.filter((row) => row.addedToIterations).length;
        const nextImport = {
          ...importMeta,
          rows,
          status: savedCount ? "evidence_saved" : importMeta.status,
          parseStatus: importMeta.parseStatus,
          stats: {
            ...(importMeta.stats || {}),
            // Preserve auto-selected count for audit (do not drop to 0 after include flags clear).
            selectedCount: selected.length,
            autoSelectedCount: selected.length,
            savedCount,
          },
          message: savedCount
            ? `FCC Results Imported · ${selected.length} test(s) matched this BabyDragon session · ${savedCount} test(s) saved.`
            : importMeta.message,
        };
        setFccSetup((prev) => ({ ...prev, appFccImport: nextImport, timestampBufferSeconds: bufferSeconds }));
        patchDataTest({
          testType: "fcc_app",
          appFccImport: nextImport,
          message: nextImport.message,
        });
        return nextImport;
      }
    }
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
    if (collectorRunningRef.current && isControlledTestIncomplete(dataTestRef.current)) {
      const counts = summarizeControlledIterationCounts(
        dataTestRef.current.iterationResults,
        dataTestRef.current.iterationsRequested,
        dataTestRef.current.status,
      );
      setControlledTestDialog({
        kind: "incomplete_restart",
        testType: dataTestRef.current.testType,
        title: `${controlledEngineDisplayName(dataTestRef.current.testType)} test is incomplete.`,
        requested: counts.requestedIterations,
        attempted: counts.attemptedIterations,
        completed: counts.completedIterations,
        failed: counts.failedIterations,
        remaining: counts.remainingIterations,
        pendingMode: mode,
      });
      return;
    }
    await armWorkflowConfirmed(mode);
  }

  async function armWorkflowConfirmed(mode) {
    const now = Date.now();
    const sessionReportName = String(reportLogNameRef.current || "").trim();
    const engineId = mode === "data"
      ? engineIdFromUiTestType(currentDataTestConfig.testType)
      : ENGINE_IDS.RF_ONLY;
    let connectivityStart = null;
    try {
      if (typeof BabyDragonRfKpi.getConnectivitySnapshot === "function") {
        const snap = await BabyDragonRfKpi.getConnectivitySnapshot();
        connectivityStart = normalizeConnectivitySnapshot(snap?.connectivity, now);
      }
    } catch {
      connectivityStart = null;
    }

    const session = {
      id: `bd-rf-${now}`,
      mode,
      startedAt: now,
      taskLabel: activeTaskLabel,
      grid: activeGrid,
      reportLogName: sessionReportName,
      pauseSegments: [],
      appEngineId: engineId,
      engineId,
      connectivityStart,
      connectivitySnapshot: connectivityStart,
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
    setExportPackageName("");
    setExportBasePath("");
    setExcelPlotExportStatus("");
    setExcelPlotExportBusy(false);
    // UX: collapse Unified Report panel when any new test starts; keep discovery counts.
    setUnifiedPanelOpen(false);
    setUnifiedManageOpen(false);
    setUnifiedExportStatus("");
    const idleWithEngine = {
      ...makeDataTestIdle(),
      engineId,
      testType: uiTestTypeFromEngineId(engineId),
      lifecycleEvents: [{ type: "START_REQUESTED", at: now, engineId }],
    };
    setDataTest(idleWithEngine);
    dataTestRef.current = idleWithEngine;
    setClockTick(now);
    setTestState("recording");
    setCollectorRunning(true);
    collectorRunningRef.current = true;
    setSamples([]);
    exportSamplesRef.current = [];
    setControlledTestDialog(null);
    if (!nativeStreamStartedAt) setNativeStreamStartedAt(now);
    // Reuse the live preview stream — do not restart ticker / clear GPS.
    const mobilityStart = await promoteToRecordingMode({
      reportSessionId: session.id,
      notificationText: mode === "data"
        ? `Recording ${engineDisplayName(engineId)} / RF / GPS`
        : "Recording voice / RF / GPS",
    });
    setMobilityDiagnostics(mobilityStart?.diagnostics || null);
    setNativeGpsUiStatus(describeGpsUiStatus(mobilityStart?.diagnostics, mobilityStart?.gpsStatus));
    if (mobilityStart?.ok === false) {
      setMobilityStartError(mobilityStart?.message || "Native mobility service failed to start");
      setCollectorMessage(mobilityStart?.message || "Native mobility service failed to start");
    } else {
      setMobilityStartError(null);
      setRfStreamUi({ label: "Live", reason: null });
    }
    patchDataTest({
      lifecycleEvents: [
        ...(dataTestRef.current.lifecycleEvents || []),
        { type: "START_ACCEPTED", at: Date.now(), engineId },
      ],
    });
    await refreshNativeSnapshot({ append: true });
    if (mode === "data") {
      if (engineId === ENGINE_IDS.RF_ONLY) {
        updateMobilityTestStatus({
          status: "rf_only",
          notificationText: "Recording RF / GPS only",
        });
        patchDataTest({
          status: "rf_only",
          phase: "rf_only",
          testType: "rf_only",
          engineId: ENGINE_IDS.RF_ONLY,
          sessionId: session.id,
          startedAt: now,
          endedAt: null,
          message: "RF-only recording. No data engine is running.",
          iterationResults: [],
          lifecycleEvents: [
            ...(dataTestRef.current.lifecycleEvents || []),
            { type: "ENGINE_STARTED", at: Date.now(), engineId: ENGINE_IDS.RF_ONLY },
          ],
        });
        setCollectorMessage("RF-only recording started. Stop / Save when finished.");
      } else if (engineId === ENGINE_IDS.NATIVE_HTTP) {
        patchDataTest({
          engineId,
          testType: "native_http",
          lifecycleEvents: [
            ...(dataTestRef.current.lifecycleEvents || []),
            { type: "ENGINE_STARTED", at: Date.now(), engineId },
          ],
        });
        runInternalThroughputTest(session.id, {
          ...currentDataTestConfig,
          runMode: iterationRunMode,
          engineId,
        });
      } else if (engineId === ENGINE_IDS.FTP) {
        patchDataTest({
          engineId,
          testType: "ftp",
          lifecycleEvents: [
            ...(dataTestRef.current.lifecycleEvents || []),
            { type: "ENGINE_STARTED", at: Date.now(), engineId },
          ],
        });
        runFtpThroughputTest(session.id, {
          ...currentDataTestConfig,
          runMode: currentDataTestConfig.runMode || iterationRunMode,
          engineId,
        });
      } else if (engineId === ENGINE_IDS.IPERF3) {
        patchDataTest({
          engineId,
          testType: "iperf",
          lifecycleEvents: [
            ...(dataTestRef.current.lifecycleEvents || []),
            { type: "ENGINE_STARTED", at: Date.now(), engineId },
          ],
        });
        runIperfThroughputTest(session.id, {
          ...currentDataTestConfig,
          runMode: currentDataTestConfig.runMode || iterationRunMode,
          engineId,
        });
      } else {
        updateMobilityTestStatus({
          status: "external_ready",
          notificationText: engineId === ENGINE_IDS.OOKLA_EXTERNAL
            ? "OOKLA external · RF/GPS recording"
            : engineId === ENGINE_IDS.FCC_EXTERNAL
              ? "FCC external · RF/GPS recording"
              : "External evidence · RF/GPS recording",
        });
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
          engineId,
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
          lifecycleEvents: [
            ...(dataTestRef.current.lifecycleEvents || []),
            { type: "ENGINE_STARTED", at: Date.now(), engineId },
          ],
        });
      }
    }
  }

  function stopWorkflow() {
    const dt = dataTestRef.current || {};
    const engineId = normalizeEngineId(dt.engineId || engineIdFromUiTestType(dt.testType));
    if (
      collectorRunningRef.current
      && isControlledEngineId(engineId)
      && String(dt.status || "").toLowerCase() !== "idle"
      && (!Array.isArray(dt.iterationResults) || dt.iterationResults.length === 0)
      && String(dt.status || "").toLowerCase() !== "continuous_complete"
      && String(dt.status || "").toLowerCase() !== "complete"
      && String(dt.status || "").toLowerCase() !== "complete_with_failures"
    ) {
      // Zero-attempt save guard: running/armed controlled engine with no iteration rows.
      const status = String(dt.status || "").toLowerCase();
      if (status === "running" || status === "external_ready" || status === "starting" || status === "idle") {
        setControlledTestDialog({
          kind: "zero_attempt",
          testType: dt.testType,
          engineId,
          title: "No data-test iteration was attempted.",
          requested: dt.iterationsRequested ?? null,
          attempted: 0,
          completed: 0,
          failed: 0,
          remaining: dt.iterationsRequested ?? null,
        });
        return;
      }
    }
    if (collectorRunningRef.current && String(dt.runMode || "").toLowerCase() === "continuous" && String(dt.status || "").toLowerCase() === "running") {
      const counts = summarizeControlledIterationCounts(
        dt.iterationResults,
        null,
        dt.status,
      );
      const startedAt = getNumber(dt.startedAt) || Date.now();
      const elapsedMs = Math.max(0, Date.now() - startedAt);
      const totalSec = Math.floor(elapsedMs / 1000);
      const hh = String(Math.floor(totalSec / 3600)).padStart(2, "0");
      const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
      const ss = String(totalSec % 60).padStart(2, "0");
      setControlledTestDialog({
        kind: "continuous_stop",
        testType: dt.testType,
        title: "Continuous test is still running.",
        requested: null,
        attempted: counts.attemptedIterations,
        completed: counts.completedIterations,
        failed: counts.failedIterations,
        remaining: null,
        durationLabel: `${hh}:${mm}:${ss}`,
      });
      return;
    }
    if (collectorRunningRef.current && isControlledTestIncomplete(dt)) {
      const counts = summarizeControlledIterationCounts(
        dt.iterationResults,
        dt.iterationsRequested,
        dt.status,
      );
      setControlledTestDialog({
        kind: "incomplete_stop",
        testType: dt.testType,
        title: `${controlledEngineDisplayName(dt.testType)} test is incomplete.`,
        requested: counts.requestedIterations,
        attempted: counts.attemptedIterations,
        completed: counts.completedIterations,
        failed: counts.failedIterations,
        remaining: counts.remainingIterations,
      });
      return;
    }
    stopWorkflowConfirmed({ markIncomplete: false });
  }

  async function stopWorkflowConfirmed({ markIncomplete = false, saveAsRfOnly = false } = {}) {
    const endedAt = Date.now();
    let connectivityEnd = null;
    try {
      if (typeof BabyDragonRfKpi.getConnectivitySnapshot === "function") {
        const snap = await BabyDragonRfKpi.getConnectivitySnapshot();
        connectivityEnd = normalizeConnectivitySnapshot(snap?.connectivity, endedAt);
      }
    } catch {
      connectivityEnd = null;
    }
    const baseSession = currentSessionRef.current || {
      id: `bd-rf-${endedAt}`,
      mode: selectedModeRef.current,
      startedAt: (exportSamplesRef.current[0] || samplesRef.current[0])?.timestamp || endedAt,
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
      connectivityStart: baseSession.connectivityStart || null,
      connectivityEnd,
      connectivitySnapshot: connectivityEnd || baseSession.connectivitySnapshot || null,
      ...(saveAsRfOnly ? {
        appEngineId: ENGINE_IDS.RF_ONLY,
        engineId: ENGINE_IDS.RF_ONLY,
      } : {}),
    };
    const fullList = (exportSamplesRef.current && exportSamplesRef.current.length)
      ? exportSamplesRef.current
      : samplesRef.current;
    const recorded = fullList.filter((sample) => sample.sessionId === session.id || sample.recorded || sample.recordState === "paused");
    const sessionList = recorded.length ? recorded : fullList;
    const continuousRunning = !saveAsRfOnly && String(dataTestRef.current?.runMode || "").toLowerCase() === "continuous"
      && (String(dataTestRef.current?.status || "").toLowerCase() === "running" || markIncomplete);

    if (continuousRunning) continuousSaveInFlightRef.current = true;
    if (throughputAbortRef.current && dataTestRef.current?.status === "running") {
      throughputAbortRef.current.abort();
      if (dataTestRef.current?.testType === "iperf") {
        cancelIperf3().catch(() => {});
      }
    }
    // Continuous: settle the in-flight runner so iterationResults are frozen before canonical outcome.
    if (continuousRunning && throughputRunPromiseRef.current) {
      try {
        await throughputRunPromiseRef.current;
      } catch {
        // AbortError / runner failure is finalized in the engine catch path.
      }
    }

    let finalDataTest = dataTestRef.current;
    if (saveAsRfOnly) {
      finalDataTest = {
        ...makeDataTestIdle(),
        engineId: ENGINE_IDS.RF_ONLY,
        testType: "rf_only",
        status: "rf_only",
        phase: "rf_only",
        message: "Saved as RF-only session. No data-test iteration was attempted.",
        iterationResults: [],
        startedAt: dataTestRef.current?.startedAt || session.startedAt,
        endedAt,
        sessionId: session.id,
      };
    } else if (continuousRunning) {
      const engineLabel = controlledEngineDisplayName(dataTestRef.current?.testType);
      const frozenRows = Array.isArray(dataTestRef.current?.iterationResults)
        ? dataTestRef.current.iterationResults
        : [];
      const stop = resolveContinuousStopPresentation(frozenRows, engineLabel);
      const counts = stop.counts;
      finalDataTest = {
        ...dataTestRef.current,
        status: stop.status,
        phase: stop.status,
        runMode: "continuous",
        completedIterations: counts.completedIterations,
        failedIterations: counts.failedIterations,
        attemptedIterations: counts.attemptedIterations,
        remainingIterations: null,
        iterationsRequested: null,
        iterationResults: frozenRows,
        endReason: stop.endReason,
        error: stop.error,
        message: stop.message,
        endedAt,
      };
    } else if (dataTestRef.current?.status === "running" || markIncomplete) {
      const counts = summarizeControlledIterationCounts(
        dataTestRef.current.iterationResults,
        dataTestRef.current.iterationsRequested,
        "incomplete",
      );
      finalDataTest = {
        ...dataTestRef.current,
        status: "incomplete",
        phase: "incomplete",
        completedIterations: counts.completedIterations,
        failedIterations: counts.failedIterations,
        attemptedIterations: counts.attemptedIterations,
        remainingIterations: counts.remainingIterations,
        endReason: "user_stopped_incomplete",
        message: `Throughput test stopped as incomplete. Requested ${counts.requestedIterations}, attempted ${counts.attemptedIterations}, completed ${counts.completedIterations}, failed ${counts.failedIterations}, remaining ${counts.remainingIterations}.`,
        endedAt,
      };
    }
    dataTestRef.current = finalDataTest;
    setDataTest(finalDataTest);
    setControlledTestDialog(null);
    continuousSaveInFlightRef.current = false;

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
    // Return to preview while RF KPI remains visible; do not kill the native stream.
    demoteToPreviewMode({ notificationText: "Live RF / GPS preview" }).catch(() => {});
  }

  async function restartRfStream() {
    setFirstNativeSampleReceived(false);
    setLastUiRfTimestamp(null);
    await bootstrapLiveRfPreview({ forceRestart: true });
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
      const primaryName = reportPackage.displayName || result?.displayName || files[0]?.fileName || files[0]?.name || "report package";
      setExportStatus(result?.fallback
        ? `Downloaded: ${primaryName}${exportExtra}`
        : `Saved: ${primaryName}${exportExtra}`);

      // Soft enqueue for durable mock upload — never blocks / never fails local save.
      const taskContext = buildSubmissionTaskContext(activeTask);
      if (taskContext) {
        void tryEnqueueFieldTestResultAfterSave({
          session: sessionToExport,
          taskContext,
          device: { model: "Android", platform: "android", appVersion: null },
          network: { rat: sessionToExport?.networkRat || null },
          files: (reportPackage.files || []).map((f) => ({
            fileName: f.fileName,
            mimeType: f.mimeType,
            content: f.content,
            contentBase64: f.contentBase64,
            path: null,
          })),
          reportName: reportPackage.displayName || sessionToExport.reportLogName,
          ownerUserId: user?.id || null,
        });
      }
    } catch (error) {
      setExportStatus(error?.message || "Report export failed.");
    }
  }

  function addSavedSessionToUnifiedReport() {
    if (!savedSession) {
      setUnifiedExportStatus("Tap Stop / Save first, then add the scenario to the Unified Field Report.");
      return;
    }
    const entry = buildUnifiedDraftFromSession(savedSession, {
      origin: "current_saved_session",
      selected: true,
    });
    setUnifiedScenarioDrafts((current) => {
      const withoutDup = current.filter((item) => item.draftId !== entry.draftId);
      const next = [...withoutDup, entry];
      setUnifiedExportStatus(`Added ${entry.label} to Unified Field Report (${next.filter((item) => item.selected).length} selected).`);
      return next;
    });
  }

  async function refreshUnifiedPackageCount() {
    try {
      if (typeof BabyDragonRfKpi.listReportPackages !== "function") {
        setUnifiedCompatibleCount(0);
        setUnifiedPackageCount(0);
        return;
      }
      const listed = await listSavedReportPackages(BabyDragonRfKpi);
      if (!listed.ok) {
        setUnifiedCompatibleCount(0);
        setUnifiedPackageCount(0);
        return;
      }
      const packages = listed.packages || [];
      setUnifiedPackageCount(packages.length);
      const gridToken = String(activeGrid || "").trim();
      const taskToken = String(activeTaskLabel || "").replace(/[^a-zA-Z0-9]+/g, "_");
      const compatible = packages.filter((pkg) => {
        const id = String(pkg.packageId || "");
        if (gridToken && id.includes(gridToken)) return true;
        if (taskToken && taskToken.length >= 8 && id.includes(taskToken.slice(0, 24))) return true;
        // If no active task/grid context, treat all BabyDragon report packages as eligible for review.
        return !gridToken && !taskToken;
      });
      setUnifiedCompatibleCount(compatible.length || packages.length);
    } catch {
      setUnifiedCompatibleCount(0);
      setUnifiedPackageCount(0);
    }
  }

  async function reviewSavedPackagesForUnifiedReport() {
    if (unifiedDiscoveryBusy) return;
    setUnifiedDiscoveryBusy(true);
    setUnifiedExportStatus("Scanning saved BabyDragon report packages...");
    setUnifiedDiscoveryWarnings([]);
    try {
      const listed = await listSavedReportPackages(BabyDragonRfKpi);
      if (!listed.ok) {
        setUnifiedExportStatus(listed.message || "Unable to list saved report packages.");
        return;
      }
      setUnifiedPackageCount((listed.packages || []).length);
      const hydrated = [];
      for (const pkg of listed.packages || []) {
        try {
          const result = await hydrateDiscoveredPackage(BabyDragonRfKpi, pkg);
          if (!result?.ok || !result.session) continue;
          hydrated.push(buildUnifiedDraftFromSession(result.session, {
            packageId: result.packageId,
            sourcePackage: result.sourcePackage,
            origin: "saved_package",
            selected: false,
            draftId: `${result.packageId || result.session.id}-${result.modifiedAtMs || result.session.endedAt || Date.now()}`,
          }));
        } catch (error) {
          console.warn("[BabyDragon] Unified package hydrate skipped:", pkg?.packageId, error);
        }
      }
      const { matched, others, warnings } = filterDraftsForActiveContext(hydrated, {
        taskLabel: activeTaskLabel,
        grid: activeGrid,
      });
      const preferred = matched.length ? matched : hydrated;
      const drafts = preferred.map((item) => ({ ...item, selected: true }));
      // Keep any in-memory current-session drafts that are not already present by package id.
      setUnifiedScenarioDrafts((current) => {
        const packageIds = new Set(drafts.map((d) => d.packageId || d.draftId));
        const retained = current.filter((item) => item.origin === "current_saved_session" && !packageIds.has(item.packageId || item.draftId));
        return [...retained, ...drafts];
      });
      setUnifiedDiscoveryWarnings([
        ...warnings,
        ...(others.length && matched.length
          ? [`${others.length} package(s) from other task/grid available but not auto-selected.`]
          : []),
      ]);
      setUnifiedCompatibleCount(drafts.length || hydrated.length);
      setUnifiedReviewOpen(true);
      setUnifiedExportStatus(
        drafts.length
          ? `Found ${drafts.length} saved scenario package(s) for ${activeTaskLabel || "current task"} / ${activeGrid || "current grid"}. Native packages: ${(listed.packages || []).length}.`
          : "No compatible saved scenario packages found for the current task/grid.",
      );
    } catch (error) {
      setUnifiedExportStatus(error?.message || "Saved package discovery failed.");
    } finally {
      setUnifiedDiscoveryBusy(false);
    }
  }

  function toggleUnifiedDraft(draftId) {
    setUnifiedScenarioDrafts((current) => current.map((item) => (
      item.draftId === draftId ? { ...item, selected: !item.selected } : item
    )));
  }

  function clearUnifiedDrafts() {
    setUnifiedScenarioDrafts([]);
    setUnifiedExportStatus("Unified Field Report selection cleared.");
  }

  async function exportUnifiedFieldReport() {
    if (unifiedExportBusy) return;
    const selected = unifiedScenarioDrafts.filter((item) => item.selected && item.session);
    if (!selected.length) {
      setUnifiedExportStatus("Select one or more added scenarios, then generate the Unified Field Report.");
      return;
    }
    setUnifiedExportBusy(true);
    setUnifiedExportStatus(`Building Unified Field Report from ${selected.length} scenario(s)...`);
    try {
      const built = await buildUnifiedFieldReportFile({
        scenarios: selected.map((item) => ({
          session: item.session,
          sourcePackage: item.sourcePackage,
        })),
        fieldContext: {
          task: selected[0].taskLabel || activeTaskLabel,
          grid: selected[0].grid || activeGrid,
          project: "BabyDragon",
          reportName: selected[0].taskLabel || activeTaskLabel,
        },
        deviceContext: {
          device: "Android",
          feEmail: user?.email || null,
        },
        user,
        skipMaps: false,
      });
      const generatedAt = Date.now();
      const sessionId = cleanFilePart(built.baseName, `bd-unified-${generatedAt}`);
      let result = null;
      if (typeof BabyDragonRfKpi.saveBinaryReportFile === "function") {
        result = await BabyDragonRfKpi.saveBinaryReportFile({
          sessionId,
          displayName: sessionId,
          fileName: built.fileName,
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          reportLabel: "Unified Field Test Report",
          contentBase64: built.base64,
        });
      }
      if (!result?.ok) {
        result = await saveReportPackage({
          sessionId,
          displayName: sessionId,
          generatedAt,
          files: [{
            fileName: built.fileName,
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            reportLabel: "Unified Field Test Report",
            contentBase64: built.base64,
          }],
        });
      }
      if (!result?.ok) {
        throw new Error(result?.message || "Unified Field Report save failed.");
      }
      // Compact success: filename only, then collapse panel back to sticky button.
      setUnifiedExportStatus(built.fileName);
      setUnifiedPanelOpen(false);
      setUnifiedManageOpen(false);
      setExportFiles((current) => [
        { fileName: built.fileName, path: result?.folderPath || result?.path || null },
        ...current,
      ].slice(0, 12));

      const taskContext = buildSubmissionTaskContext(activeTask);
      if (taskContext) {
        void tryEnqueueFieldTestResultAfterSave({
          unifiedReport: {
            reportKind: "unified_field_report",
            reportName: built.baseName || built.fileName,
            sessionId: sessionId,
            scenarios: selected.map((item) => ({
              session: item.session,
              scenarioKey: item.scenarioKey,
              scenarioId: item.draftId,
            })),
          },
          taskContext,
          device: { model: "Android", platform: "android" },
          files: [{
            fileName: built.fileName,
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            contentBase64: built.base64,
            artifactType: "excel_plot",
          }],
          reportName: built.baseName || built.fileName,
          ownerUserId: user?.id || null,
        });
      }
    } catch (error) {
      setUnifiedExportStatus(error?.message || "Unified Field Report export failed.");
    } finally {
      setUnifiedExportBusy(false);
    }
  }

  async function exportExcelPlotReport() {
    if (excelPlotExportBusy) return;
    if (dataTestRef.current?.status === "running") {
      setExcelPlotExportStatus("Finish the THP test or tap Stop / Save before Excel Plot Report export.");
      return;
    }
    const sessionToExport = savedSession;
    if (!isExcelPlotExportableSession(sessionToExport)) {
      setExcelPlotExportStatus("Tap Stop / Save first, then export the Excel Plot Report.");
      return;
    }

    setExcelPlotExportBusy(true);
    setExcelPlotExportStatus("Preparing session data...");
    try {
      const generatedAt = Date.now();
      const baseName = buildProfessionalReportName(sessionToExport, activeTask);
      const pad = (value) => String(value).padStart(2, "0");
      const date = new Date(generatedAt);
      const exportStamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
      const sessionId = cleanFilePart(`${baseName}_${exportStamp}`, `bd-rf-${generatedAt}`);
      const reportProgress = (stage) => {
        setExcelPlotExportStatus(String(stage || "Building Excel Plot Report..."));
      };
      const model = buildExcelPlotReportModel(sessionToExport, user, {
        activeTask,
        getTaskLabel,
        getTaskGrid,
      }, {
        onProgress: reportProgress,
        activeSettings: null,
      });
      reportProgress("Writing workbook");
      const excelFile = await buildExcelPlotReportFile(model, `${sessionId}_Plots_Report.xlsx`, {
        onProgress: reportProgress,
      });
      if (!excelFile?.looksZip || !excelFile?.contentBase64) {
        throw new Error("Excel workbook build failed (invalid .xlsx payload).");
      }
      reportProgress("Saving report");

      let result = null;
      // Prefer dedicated binary save (top-level contentBase64) — more reliable on Capacitor Android.
      if (typeof BabyDragonRfKpi.saveBinaryReportFile === "function") {
        result = await BabyDragonRfKpi.saveBinaryReportFile({
          sessionId,
          displayName: sessionId,
          fileName: excelFile.fileName,
          mimeType: excelFile.mimeType,
          reportLabel: excelFile.reportLabel,
          contentBase64: excelFile.contentBase64,
        });
      }
      if (!result?.ok) {
        const reportPackage = {
          sessionId,
          displayName: sessionId,
          generatedAt,
          files: [excelFile],
        };
        try {
          result = await saveReportPackage(reportPackage);
        } catch (nestedError) {
          // Last-resort browser/blob download so export is never silently skipped.
          downloadTextFile(excelFile);
          const detail = String(result?.message || nestedError?.message || nestedError || "native save failed");
          console.error("[BabyDragon] Excel Plot Report save failed:", detail, result || nestedError);
          setExcelPlotExportStatus(`Excel Plot Report downloaded via fallback (native save failed: ${detail})`);
          return;
        }
      }

      if (!result?.ok) {
        const detail = String(result?.message || result?.status || "native save failed");
        console.error("[BabyDragon] Excel Plot Report save failed:", detail, result);
        downloadTextFile(excelFile);
        setExcelPlotExportStatus(`Excel Plot Report downloaded via fallback (native save failed: ${detail})`);
        return;
      }

      const files = Array.isArray(result?.savedFiles) ? result.savedFiles : [];
      if (!files.length) {
        console.error("[BabyDragon] Excel Plot Report save returned no savedFiles:", result);
        downloadTextFile(excelFile);
        setExcelPlotExportStatus("Excel Plot Report downloaded via fallback (native returned no saved files).");
        return;
      }

      setExportBasePath(result?.basePath || `Downloads/BabyDragon/Reports/${sessionId}`);
      const savedName = excelFile.fileName || `${sessionId}_Plots_Report.xlsx`;
      setExcelPlotExportStatus(result?.fallback
        ? `Excel Plot Report Saved\n${savedName}`
        : `Excel Plot Report Saved\n${savedName}`);
      // Keep full path only in package details / base path — not in primary sticky status.
    } catch (error) {
      console.error("[BabyDragon] Excel Plot Report export failed:", error);
      setExcelPlotExportStatus(error?.message || "Excel Plot Report export failed.");
    } finally {
      setExcelPlotExportBusy(false);
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

  // Sanitize phantom recording controls after force-stop / APK replace.
  useEffect(() => {
    if ((testState === "recording" || testState === "paused") && (!collectorRunning || !currentSession?.id)) {
      testStateRef.current = "idle";
      collectorRunningRef.current = false;
      currentSessionRef.current = null;
      setTestState("idle");
      setCollectorRunning(false);
      setCurrentSession(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // F10B: keep Unified Field Report package count fresh so the card is visible without opening Export panel.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await refreshUnifiedPackageCount();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTaskLabel, activeGrid, testState, exportStatus, excelPlotExportStatus]);

  useEffect(() => {
    collectorBusyRef.current = collectorBusy;
  }, [collectorBusy]);

  useEffect(() => {
    firstNativeSampleReceivedRef.current = firstNativeSampleReceived;
  }, [firstNativeSampleReceived]);

  useEffect(() => {
    let cancelled = false;
    let retryBusy = false;
    let stopTimer = null;
    let lastHardStartAt = 0;

    async function activatePreview({ forceRestart = false } = {}) {
      if (!rfWorkspaceActive || cancelled) return;
      if (!forceRestart && previewEnsureRef.current && firstNativeSampleReceivedRef.current && isMobilitySessionActive()) {
        refreshNativeSnapshot({ append: true });
        return;
      }
      previewEnsureRef.current = true;
      if (!checkingStartedAtRef.current) {
        const startedAt = Date.now();
        checkingStartedAtRef.current = startedAt;
        setCheckingStartedAt(startedAt);
      }
      setCollectorBusy(true);
      collectorBusyRef.current = true;
      try {
        await bootstrapLiveRfPreview({ forceRestart });
      } finally {
        if (!cancelled) {
          setCollectorBusy(false);
          collectorBusyRef.current = false;
        }
      }
    }

    async function tick() {
      if (cancelled) return;
      setClockForNativeWait(Date.now());
      if (rfWorkspaceActive || collectorRunningRef.current) {
        await refreshNativeSnapshot({ append: true });
      }
      const startedAt = checkingStartedAtRef.current;
      const ageMs = startedAt != null ? Date.now() - startedAt : null;
      if (collectorBusyRef.current && ageMs != null && ageMs > 15000 && !firstNativeSampleReceivedRef.current) {
        setCollectorBusy(false);
        collectorBusyRef.current = false;
      }
      if (
        rfWorkspaceActive
        && ageMs != null
        && ageMs > 10000
        && !firstNativeSampleReceivedRef.current
      ) {
        setCheckingTimeoutReason((current) => current || "first_sample_timeout");
        // Prefer diagnostics-backed reason when service is down.
        try {
          const diagnostics = await fetchMobilityDiagnostics();
          setMobilityDiagnostics(diagnostics);
          if (diagnostics?.serviceRunning === false) {
            setRfStreamUi({ label: "Service stopped", reason: "service_start_failed" });
          } else if (!firstNativeSampleReceivedRef.current) {
            setRfStreamUi({ label: "Unavailable", reason: "first_sample_timeout" });
          }
        } catch {
          if (!firstNativeSampleReceivedRef.current) {
            setRfStreamUi({ label: "Unavailable", reason: "first_sample_timeout" });
          }
        }
      }
      // Soft re-ensure (attach/drain only). Hard restart at most once every 8s if service is dead.
      if (
        rfWorkspaceActive
        && !firstNativeSampleReceivedRef.current
        && !retryBusy
        && !collectorBusyRef.current
        && ageMs != null
        && ageMs > 3000
      ) {
        retryBusy = true;
        try {
          let forceRestart = false;
          try {
            const diagnostics = await fetchMobilityDiagnostics();
            setMobilityDiagnostics(diagnostics);
            const serviceDead = diagnostics?.serviceRunning !== true;
            const now = Date.now();
            if (serviceDead && now - lastHardStartAt > 8000) {
              forceRestart = true;
              lastHardStartAt = now;
            }
          } catch {
            // soft ensure only
          }
          await activatePreview({ forceRestart });
        } finally {
          retryBusy = false;
        }
      }
    }

    if (rfWorkspaceActive) {
      if (stopTimer) {
        window.clearTimeout(stopTimer);
        stopTimer = null;
      }
      void requestRfPermissionsIfNeeded();
      lastHardStartAt = Date.now();
      activatePreview({ forceRestart: false });
    } else if (!collectorRunningRef.current) {
      // Delay stop so brief tab switches / remounts do not kill a healthy stream.
      previewEnsureRef.current = false;
      checkingStartedAtRef.current = null;
      stopTimer = window.setTimeout(() => {
        if (cancelled || collectorRunningRef.current) return;
        const mode = getMobilityMode();
        if (mode === MOBILITY_MODE.PREVIEW || mode === MOBILITY_MODE.ERROR) {
          stopMobilitySession({ clearTrail: false, stopService: true }).catch(() => {});
          setRfStreamUi({ label: "Service stopped", reason: null });
        }
      }, 2500);
    }

    const timer = window.setInterval(() => { void tick(); }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (stopTimer) window.clearTimeout(stopTimer);
    };
  }, [rfWorkspaceActive]);

  useEffect(() => subscribeMobilitySession((snapshot) => {
    if (snapshot?.lastDiagnostics) setMobilityDiagnostics(snapshot.lastDiagnostics);
    if (snapshot?.startError) setMobilityStartError(snapshot.startError);
    if (snapshot?.lastDrainError) setLastMobilityDrainError(snapshot.lastDrainError);
    if (snapshot?.firstSampleReceived) setFirstNativeSampleReceived(true);
    if (snapshot?.lastNativeRfTimestamp) setLastUiRfTimestamp(snapshot.lastNativeRfTimestamp);
    setNativeGpsUiStatus(describeGpsUiStatus(snapshot?.lastDiagnostics, snapshot?.gpsStatus));
    const latest = snapshot?.latestRfSample?.snapshot || getLatestMobilityRfSample()?.snapshot;
    if (latest && (latest.ok || latest.currentRatName || latest.dataNetworkTypeName)) {
      setNativeSnapshot((prev) => prev?.snapshotSequence === latest.snapshotSequence ? prev : latest);
      setCollectorBusy(false);
      setRfStreamUi({ label: "Live", reason: null });
    }
  }), []);

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
          <span><b>Test</b>{selectedMode === "data" ? selectedTestLabel : "Voice Test"}</span>
          <span><b>State</b>{showRecordingControls ? recordingStateLabel : (savedSession ? "Saved" : "Ready")}</span>
        </div>
        <div className="bd-rf-live-stream-status" aria-label="Live RF and GPS status">
          <span><b>RF Stream</b><strong>{rfStreamUi.label}</strong></span>
          <span><b>GPS</b><strong>{nativeGpsUiStatus || describeGpsUiStatus(mobilityDiagnostics, mobilityGpsStatus) || "Waiting for native fix"}</strong></span>
          <span><b>Last RF</b><strong>{formatAgeSeconds(lastUiRfTimestamp || mobilityDiagnostics?.lastNativeRfTimestamp, clockForNativeWait)}</strong></span>
          <span><b>Last GPS</b><strong>{formatAgeSeconds(lastGpsFixMs, clockForNativeWait)}</strong></span>
        </div>
        {rfStreamUi.reason && rfStreamUi.label !== "Live" ? (
          <p className="bd-rf-inline-note bd-rf-thp-error-note">{rfStreamUi.reason}</p>
        ) : null}
        {mobilityStartError && rfStreamUi.label !== "Live" ? (
          <p className="bd-rf-inline-note bd-rf-thp-error-note">{mobilityStartError}</p>
        ) : null}

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
                {dataTestType === "rf_only" && (
                  <p className="bd-rf-inline-note">
                    RF Only records live RF and GPS. Start Data begins recording without HTTP, FTP, iPerf3, OOKLA, or FCC.
                  </p>
                )}
                {dataTestType === "native_http" && (
                  <NativeHttpTestCard setup={currentNativeHttpSetup} onChange={handleNativeHttpSetupChange} disabled={dataTest.status === "running"} />
                )}
                {dataTestType === "ftp" && (
                  <FtpTestCard setup={ftpSetup} onChange={handleFtpSetupChange} disabled={dataTest.status === "running"} />
                )}
                {dataTestType === "iperf" && (
                  <Iperf3TestPage
                    setup={iperfSetup}
                    onChange={handleIperfSetupChange}
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
            <div className="bd-rf-export-package-primary">
              <b>Report Package Saved</b>
              <span className="bd-rf-export-package-name">{exportPackageName || "BabyDragon RF KPI Report"}</span>
              <span>{exportFiles.length} report files saved</span>
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
              {exportBasePath ? (
                <small className="bd-rf-export-path-detail">Saved under: {exportBasePath}</small>
              ) : null}
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
                <span>
                  <b>{isContinuousDataMode(dataTest, visibleSession) ? "Completed" : "Iterations"}</b>
                  <strong>
                    {formatControlledIterationsDisplay({
                      runMode: dataTest.runMode || visibleSession?.appRunMode,
                      completed: dataTest.completedIterations || visibleSession?.appCompletedIterations || 0,
                      requested: dataTest.iterationsRequested ?? visibleSession?.appIterationsRequested ?? resolvedThpIterations,
                      status: dataTest.status || visibleSession?.appTestStatus,
                      endReason: dataTest.endReason || visibleSession?.appEndReason,
                    })}
                  </strong>
                </span>
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
        {nativeRfWaitLabel && !nativeSnapshot?.ok ? (
          <p className="bd-rf-inline-note">{nativeRfWaitLabel}</p>
        ) : null}
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
          {showLiveMobileTraffic ? (
            <>
              <span><b>TrafficStats Mobile DL</b><strong>{summaryTrafficMobileDl === "N/A" ? "N/A" : `${summaryTrafficMobileDl} Mbps`}</strong></span>
              <span><b>TrafficStats Mobile UL</b><strong>{summaryTrafficMobileUl === "N/A" ? "N/A" : `${summaryTrafficMobileUl} Mbps`}</strong></span>
            </>
          ) : null}
          <span><b>TrafficStats Total DL</b><strong>{summaryTrafficTotalDl === "N/A" ? "N/A" : `${summaryTrafficTotalDl} Mbps`}</strong></span>
          <span><b>TrafficStats Total UL</b><strong>{summaryTrafficTotalUl === "N/A" ? "N/A" : `${summaryTrafficTotalUl} Mbps`}</strong></span>
          <span><b>Call State</b><strong>{summaryCallState}</strong></span>
        </div>
        {!showLiveMobileTraffic && (summaryTrafficTotalDl !== "N/A" || summaryTrafficTotalUl !== "N/A") ? (
          <p className="bd-rf-traffic-stats-note">Mobile-interface counters inactive; total-device counters shown.</p>
        ) : null}
        {trafficStatsUiNote && showLiveMobileTraffic === false && !(summaryTrafficTotalDl !== "N/A" || summaryTrafficTotalUl !== "N/A") ? (
          <p className="bd-rf-traffic-stats-note">{trafficStatsUiNote}</p>
        ) : null}
        {trafficStatsUiNote && showLiveMobileTraffic ? (
          <p className="bd-rf-traffic-stats-note">{trafficStatsUiNote}</p>
        ) : null}
      </details>

      {(import.meta.env?.DEV || mobilityDiagnostics || isMobilitySessionActive() || openPanel === "about") ? (
        <details className="bd-mobile-card bd-rf-dev-mobility-diag">
          <summary className="bd-rf-live-summary-head">
            <b>Dev Mobility Diagnostics</b>
            <small>not included in customer reports</small>
          </summary>
          <div className="bd-rf-live-summary-grid">
            <span><b>mobilityMode</b><strong>{getMobilityMode()}</strong></span>
            <span><b>serviceRunning</b><strong>{String(mobilityDiagnostics?.serviceRunning ?? "n/a")}</strong></span>
            <span><b>serviceSessionId</b><strong>{mobilityDiagnostics?.sessionId || "—"}</strong></span>
            <span><b>jsSessionId</b><strong>{mobilityDiagnostics?.jsSessionId || getMobilitySessionSnapshot()?.sessionId || "—"}</strong></span>
            <span><b>rfTickerActive</b><strong>{String(mobilityDiagnostics?.rfTickerActive ?? "n/a")}</strong></span>
            <span><b>nativeRfCount</b><strong>{String(mobilityDiagnostics?.nativeRfSampleCount ?? 0)}</strong></span>
            <span><b>nativeGpsCount</b><strong>{String(mobilityDiagnostics?.nativeGpsSampleCount ?? 0)}</strong></span>
            <span><b>bufferCount</b><strong>{String(mobilityDiagnostics?.bufferCount ?? mobilityDiagnostics?.bufferedCount ?? 0)}</strong></span>
            <span><b>lastNativeRf</b><strong>{mobilityDiagnostics?.lastNativeRfTimestamp || lastUiRfTimestamp || "—"}</strong></span>
            <span><b>lastDrain</b><strong>{mobilityDiagnostics?.lastDrainCount ?? 0} @ {mobilityDiagnostics?.lastDrainTimestamp || "—"}</strong></span>
            <span><b>lastDrainError</b><strong>{mobilityDiagnostics?.lastDrainError || lastMobilityDrainError || "—"}</strong></span>
            <span><b>firstSample</b><strong>{String(firstNativeSampleReceived)}</strong></span>
            <span><b>uiRfAgeMs</b><strong>{lastUiRfTimestamp != null ? String(clockForNativeWait - lastUiRfTimestamp) : "—"}</strong></span>
            <span><b>checking</b><strong>{String(collectorBusy)}</strong></span>
            <span><b>checkingTimeout</b><strong>{checkingTimeoutReason || "—"}</strong></span>
            <span><b>drainLoops</b><strong>{String(mobilityDiagnostics?.activeDrainLoopCount ?? getMobilitySessionSnapshot()?.activeDrainLoopCount ?? 0)}</strong></span>
            <span><b>tickerCount</b><strong>{String(mobilityDiagnostics?.activeNativeTickerCount ?? (mobilityDiagnostics?.rfTickerActive ? 1 : 0))}</strong></span>
          </div>
          <button type="button" className="bd-mobile-secondary" onClick={restartRfStream}>
            Restart RF Stream
          </button>
        </details>
      ) : null}

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
            Android TrafficStats Mobile = mobile interface byte deltas. Total = whole-device counters.
            APP DL/UL THP remains BabyDragon engine throughput. {trafficStatsUiNote}
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

      <section className="bd-mobile-card bd-rf-unified-page-section" aria-label="Unified Field Report">
        {!unifiedPanelOpen ? (
          <div className="bd-rf-unified-page-collapsed">
            <button
              type="button"
              className="bd-rf-unified-page-toggle"
              disabled={unifiedExportBusy}
              onClick={() => {
                setUnifiedPanelOpen(true);
                setUnifiedManageOpen(false);
              }}
            >
              <span className="bd-rf-unified-page-toggle-copy">
                <b>Unified Field Report</b>
                <small>Combine saved test scenarios</small>
              </span>
              <span className="bd-rf-unified-page-open-group">
                {(unifiedCompatibleCount || unifiedPackageCount) ? (
                  <em className="bd-rf-unified-page-count">
                    {unifiedCompatibleCount || unifiedPackageCount}
                  </em>
                ) : null}
                <strong className="bd-rf-unified-page-open">Open</strong>
              </span>
            </button>
            {unifiedExportStatus && !unifiedExportBusy ? (
              <p className="bd-rf-unified-compact-status" title={unifiedExportStatus}>
                {unifiedExportStatus}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="bd-rf-unified-report-box bd-rf-unified-page-panel">
            <div className="bd-rf-unified-panel-head">
              <p>
                <b>Unified Field Report</b>
                <span>
                  Task / Grid: {activeTaskLabel || "—"} · {activeGrid || "—"}
                </span>
              </p>
              <button
                type="button"
                className="bd-rf-unified-close-btn"
                aria-label="Close Unified Report panel"
                onClick={() => {
                  setUnifiedPanelOpen(false);
                  setUnifiedManageOpen(false);
                }}
              >
                Close
              </button>
            </div>
            <p className="bd-rf-inline-note">
              Saved scenarios found: {unifiedCompatibleCount || unifiedPackageCount || (unifiedReviewOpen ? unifiedScenarioDrafts.length : "…")}
              {unifiedPackageCount > 0 ? ` · Packages on device: ${unifiedPackageCount}` : ""}
            </p>
            <div className="bd-rf-unified-actions">
              <button
                type="button"
                className="bd-mobile-primary"
                disabled={unifiedDiscoveryBusy || unifiedExportBusy}
                onClick={reviewSavedPackagesForUnifiedReport}
              >
                {unifiedDiscoveryBusy ? "Scanning packages..." : "Review & Generate"}
              </button>
            </div>
            {unifiedReviewOpen && unifiedScenarioDrafts.length ? (
              <div className="bd-rf-unified-review">
                {/* Generate stays above the scrollable list so sticky Start Data cannot bury it. */}
                <button
                  type="button"
                  className="bd-mobile-primary bd-rf-unified-generate-btn"
                  disabled={unifiedExportBusy || !unifiedScenarioDrafts.some((item) => item.selected)}
                  onClick={exportUnifiedFieldReport}
                >
                  {unifiedExportBusy ? "Building Unified..." : "Generate Unified Report"}
                </button>
                <div className="bd-rf-unified-scenario-list" role="list" aria-label="Saved scenarios">
                  {unifiedScenarioDrafts.map((item, scenarioIndex) => {
                    const ui = summarizeDraftForUi(item);
                    const sourceLabel = item.sourcePackage || item.packageId || item.draftId || "";
                    const scenarioId = `S${String(scenarioIndex + 1).padStart(2, "0")}`;
                    const metaLine = [item.mode, item.direction, ui.detail].filter(Boolean).join(" · ");
                    return (
                      <label key={item.draftId} className="bd-rf-unified-scenario-row" role="listitem">
                        <input
                          type="checkbox"
                          checked={item.selected !== false}
                          onChange={() => toggleUnifiedDraft(item.draftId)}
                        />
                        <span className="bd-rf-unified-scenario-copy">
                          <b className="bd-rf-unified-scenario-title">
                            {scenarioId} · {item.label}
                          </b>
                          {metaLine ? (
                            <small className="bd-rf-unified-scenario-meta">{metaLine}</small>
                          ) : null}
                          {ui.timeLabel ? (
                            <small className="bd-rf-unified-scenario-time">{ui.timeLabel}</small>
                          ) : null}
                          {sourceLabel ? (
                            <details className="bd-rf-unified-source-details">
                              <summary>Package identity</summary>
                              <code className="bd-rf-unified-source" title={sourceLabel}>
                                {sourceLabel}
                              </code>
                            </details>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
                {unifiedDiscoveryWarnings.length ? (
                  <p className="bd-rf-inline-note">{unifiedDiscoveryWarnings.join(" ")}</p>
                ) : null}
              </div>
            ) : null}
            <details
              className="bd-rf-unified-manage"
              open={unifiedManageOpen}
              onToggle={(event) => setUnifiedManageOpen(event.currentTarget.open)}
            >
              <summary>Manage / Advanced</summary>
              <div className="bd-rf-unified-actions bd-rf-unified-manage-actions">
                <button
                  type="button"
                  className="bd-mobile-secondary"
                  disabled={!savedSession || testState !== "saved"}
                  onClick={addSavedSessionToUnifiedReport}
                >
                  Add Current Saved Scenario
                </button>
                <button
                  type="button"
                  className="bd-mobile-secondary"
                  disabled={!unifiedScenarioDrafts.length}
                  onClick={() => {
                    clearUnifiedDrafts();
                    setUnifiedReviewOpen(false);
                  }}
                >
                  Clear
                </button>
              </div>
            </details>
            {unifiedExportStatus ? (
              <p className="bd-rf-inline-note bd-rf-unified-status-line">{unifiedExportStatus}</p>
            ) : null}
          </div>
        )}
      </section>

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
          <button
            type="button"
            className="bd-mobile-secondary bd-rf-export-excel-plot"
            disabled={!canExportSession || excelPlotExportBusy}
            onClick={exportExcelPlotReport}
          >
            {excelPlotExportBusy ? "Building Excel..." : "Export Excel Plot Report"}
          </button>
          <p className="bd-rf-excel-plot-hint">
            Optional parallel .xlsx with plot-ready RF/data sheets. Does not change OOKLA/FCC package exports.
          </p>
          {exportStatus ? <p className="bd-rf-inline-note">{exportStatus}</p> : null}
          {excelPlotExportStatus ? (
            <p className="bd-rf-inline-note success bd-rf-excel-saved-status">{excelPlotExportStatus}</p>
          ) : null}
          {exportFiles.length ? (
            <div className="bd-rf-export-files">
              {exportFiles.map((file) => (
                <span key={`${file.fileName}-${file.path || "saved"}`}>
                  <b>{file.fileName}</b>
                  <small>Saved</small>
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
            {showRecordingControls ? "Restart" : selectedMode === "voice" ? "Start Voice" : "Start Data"}
          </button>
          {showRecordingControls && testState === "recording" ? (
            <button type="button" className="bd-mobile-secondary bd-rf-pause-btn" onClick={pauseRecording}>
              Pause Recording
            </button>
          ) : null}
          {showRecordingControls && testState === "paused" ? (
            <button type="button" className="bd-mobile-secondary bd-rf-resume-btn" onClick={resumeRecording}>
              Resume Recording
            </button>
          ) : null}
          <button type="button" className="bd-mobile-secondary" onClick={stopWorkflow} disabled={!showRecordingControls && !savedSession}>
            {showRecordingControls ? "Stop / Save" : savedSession ? "Saved" : "Stop / Save"}
          </button>
          {(canExportSession || exportStatus?.startsWith("Building") || excelPlotExportBusy) ? (
            <button
              type="button"
              className="bd-mobile-secondary"
              disabled={!canExportSession || exportStatus?.startsWith("Building")}
              onClick={exportSavedSession}
            >
              {exportStatus?.startsWith("Building") ? "Exporting..." : "Export"}
            </button>
          ) : null}
          {(canExportSession || excelPlotExportBusy) ? (
            <button
              type="button"
              className="bd-mobile-secondary bd-rf-export-excel-plot-sticky"
              disabled={!canExportSession || excelPlotExportBusy}
              onClick={exportExcelPlotReport}
            >
              {excelPlotExportBusy ? "Excel..." : "Excel Plot"}
            </button>
          ) : null}
        </div>
        {excelPlotExportStatus ? (
          <p className="bd-rf-inline-note success bd-rf-excel-sticky-status bd-rf-excel-saved-status">{excelPlotExportStatus}</p>
        ) : null}
      </div>

      {controlledTestDialog ? (
        <div className="bd-rf-confirm-overlay" role="dialog" aria-modal="true" aria-label={controlledTestDialog.title || "Test status"}>
          <div className="bd-mobile-card bd-rf-confirm-card">
            <h3>{controlledTestDialog.title}</h3>
            <p>
              {controlledTestDialog.kind === "continuous_complete" || controlledTestDialog.kind === "continuous_stop" || controlledTestDialog.requested == null ? (
                <>
                  Attempted: {controlledTestDialog.attempted ?? "—"}
                  <br />
                  Completed: {controlledTestDialog.completed ?? "—"}
                  <br />
                  Failed: {controlledTestDialog.failed ?? "—"}
                </>
              ) : (
                <>
                  Requested: {controlledTestDialog.requested ?? "—"}
                  <br />
                  Attempted: {controlledTestDialog.attempted ?? "—"}
                  <br />
                  Completed: {controlledTestDialog.completed ?? "—"}
                  <br />
                  Failed: {controlledTestDialog.failed ?? "—"}
                  <br />
                  Remaining: {controlledTestDialog.remaining ?? (controlledTestDialog.kind === "complete" ? 0 : "—")}
                </>
              )}
            </p>
            {controlledTestDialog.overall ? <p><b>Overall:</b> {controlledTestDialog.overall}</p> : null}
            {controlledTestDialog.errorSummary ? <p className="bd-rf-inline-note">{controlledTestDialog.errorSummary}</p> : null}
            {controlledTestDialog.kind === "continuous_stop" ? (
              <p>
                Continuous test is still running.<br />
                Attempted: {controlledTestDialog.attempted ?? 0}<br />
                Completed: {controlledTestDialog.completed ?? 0}<br />
                Failed: {controlledTestDialog.failed ?? 0}<br />
                Duration: {controlledTestDialog.durationLabel || "00:00:00"}
              </p>
            ) : null}
            {controlledTestDialog.kind === "incomplete_stop" ? (
              <p>Are you sure you want to stop and save this incomplete test?</p>
            ) : null}
            {controlledTestDialog.kind === "incomplete_restart" ? (
              <p>Restart will stop the current incomplete sequence and start a new session.</p>
            ) : null}
            {controlledTestDialog.kind === "zero_attempt" ? (
              <p>
                No data-test iteration was attempted.
                <br />
                Engine: {engineDisplayName(controlledTestDialog.engineId || controlledTestDialog.testType)}
              </p>
            ) : null}
            <div className="bd-rf-action-grid">
              {controlledTestDialog.kind === "zero_attempt" ? (
                <>
                  <button type="button" className="bd-mobile-secondary" onClick={() => setControlledTestDialog(null)}>
                    Return to Test
                  </button>
                  <button
                    type="button"
                    className="bd-mobile-primary"
                    onClick={() => stopWorkflowConfirmed({ markIncomplete: false, saveAsRfOnly: true })}
                  >
                    Save as RF-Only Session
                  </button>
                  <button
                    type="button"
                    className="bd-mobile-secondary"
                    onClick={() => {
                      setControlledTestDialog(null);
                      if (throughputAbortRef.current) throughputAbortRef.current.abort();
                      stopMobilitySession({ clearTrail: true }).catch(() => {});
                      collectorRunningRef.current = false;
                      setCollectorRunning(false);
                      testStateRef.current = "idle";
                      setTestState("idle");
                      currentSessionRef.current = null;
                      setCurrentSession(null);
                      setDataTest(makeDataTestIdle());
                      dataTestRef.current = makeDataTestIdle();
                    }}
                  >
                    Cancel Session
                  </button>
                </>
              ) : null}
              {controlledTestDialog.kind === "complete" ? (
                <>
                  <button type="button" className="bd-mobile-secondary" onClick={() => setControlledTestDialog(null)}>
                    Continue RF Recording
                  </button>
                  <button type="button" className="bd-mobile-primary" onClick={() => { setControlledTestDialog(null); stopWorkflowConfirmed({ markIncomplete: false }); }}>
                    Stop and Save
                  </button>
                  <button type="button" className="bd-mobile-secondary" onClick={() => { setControlledTestDialog(null); setOpenPanel("export"); }}>
                    View Results
                  </button>
                  <button type="button" className="bd-mobile-secondary" onClick={() => { setControlledTestDialog(null); armWorkflowConfirmed(selectedMode); }}>
                    Run Again
                  </button>
                </>
              ) : null}
              {controlledTestDialog.kind === "continuous_complete" ? (
                <>
                  <button
                    type="button"
                    className="bd-mobile-secondary"
                    onClick={() => {
                      setControlledTestDialog(null);
                      setOpenPanel("export");
                    }}
                  >
                    View Results
                  </button>
                  <button
                    type="button"
                    className="bd-mobile-primary"
                    onClick={() => {
                      setControlledTestDialog(null);
                      setOpenPanel("export");
                      window.setTimeout(() => {
                        exportSavedSession().catch(() => {});
                      }, 0);
                    }}
                  >
                    Export Reports
                  </button>
                  <button
                    type="button"
                    className="bd-mobile-secondary"
                    onClick={() => {
                      setControlledTestDialog(null);
                      armWorkflowConfirmed(selectedMode);
                    }}
                  >
                    Run Again
                  </button>
                  <button type="button" className="bd-mobile-secondary" onClick={() => setControlledTestDialog(null)}>
                    Close
                  </button>
                </>
              ) : null}
              {controlledTestDialog.kind === "continuous_stop" ? (
                <>
                  <button type="button" className="bd-mobile-secondary" onClick={() => setControlledTestDialog(null)}>
                    Continue Testing
                  </button>
                  <button type="button" className="bd-mobile-primary" onClick={() => stopWorkflowConfirmed({ markIncomplete: true })}>
                    Stop and Save Continuous Test
                  </button>
                  <button type="button" className="bd-mobile-secondary" onClick={() => setControlledTestDialog(null)}>
                    Cancel
                  </button>
                </>
              ) : null}
              {controlledTestDialog.kind === "incomplete_stop" ? (
                <>
                  <button type="button" className="bd-mobile-secondary" onClick={() => setControlledTestDialog(null)}>
                    Continue Testing
                  </button>
                  <button type="button" className="bd-mobile-primary" onClick={() => stopWorkflowConfirmed({ markIncomplete: true })}>
                    Stop and Save as Incomplete
                  </button>
                </>
              ) : null}
              {controlledTestDialog.kind === "incomplete_restart" ? (
                <>
                  <button type="button" className="bd-mobile-secondary" onClick={() => setControlledTestDialog(null)}>
                    Continue Current Test
                  </button>
                  <button
                    type="button"
                    className="bd-mobile-primary"
                    onClick={() => {
                      const mode = controlledTestDialog.pendingMode || selectedMode;
                      stopWorkflowConfirmed({ markIncomplete: true });
                      window.setTimeout(() => armWorkflowConfirmed(mode), 50);
                    }}
                  >
                    Stop and Restart
                  </button>
                  <button type="button" className="bd-mobile-secondary" onClick={() => setControlledTestDialog(null)}>
                    Cancel
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
