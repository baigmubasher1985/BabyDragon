/**
 * Shared normalized scenario report model + thin adapters (Step 1J2-F7).
 * Adapters populate only applicable fields; shared workbook renderers stay common.
 */

export const SCENARIO_KEYS = Object.freeze({
  NATIVE_HTTP: "native_http",
  FTP: "ftp",
  IPERF3: "iperf3",
  OOKLA: "ookla_app",
  FCC: "fcc_app",
  RF_ONLY: "rf_data",
  VOICE: "voice",
});

export function resolveScenarioKey(session = {}) {
  const engineId = String(session?.appEngineId || session?.engineId || "").toLowerCase();
  if (engineId === "ookla_external" || engineId.includes("ookla")) return SCENARIO_KEYS.OOKLA;
  if (engineId === "fcc_external" || engineId.includes("fcc")) return SCENARIO_KEYS.FCC;
  if (engineId === "iperf3" || engineId === "iperf") return SCENARIO_KEYS.IPERF3;
  if (engineId === "ftp") return SCENARIO_KEYS.FTP;
  if (engineId === "native_http") return SCENARIO_KEYS.NATIVE_HTTP;
  if (engineId === "rf_only") return SCENARIO_KEYS.RF_ONLY;

  const type = String(session?.appTestType || session?.appSetupSnapshot?.testType || "").toLowerCase();
  const provider = String(session?.appExternalEvidenceProvider || "").toLowerCase();
  if (type.includes("ookla") || provider.includes("ookla")) return SCENARIO_KEYS.OOKLA;
  if (type.includes("fcc") || provider.includes("fcc")) return SCENARIO_KEYS.FCC;
  if (type.includes("iperf") || session?.appIperfJson || session?.appIperfCsv) return SCENARIO_KEYS.IPERF3;
  if (type.includes("ftp")) return SCENARIO_KEYS.FTP;
  if (type.includes("http") || type.includes("native")) return SCENARIO_KEYS.NATIVE_HTTP;
  if (session?.mode === "voice") return SCENARIO_KEYS.VOICE;
  // Do not default empty FTP/iPerf sessions with zero iterations to Native HTTP.
  if (Array.isArray(session?.appOoklaEvidenceIterations) && session.appOoklaEvidenceIterations.length) return SCENARIO_KEYS.OOKLA;
  if (Array.isArray(session?.appFccEvidenceIterations) && session.appFccEvidenceIterations.length) return SCENARIO_KEYS.FCC;
  if (Array.isArray(session?.appIterationResults) && session.appIterationResults.length && type) {
    if (type.includes("ftp")) return SCENARIO_KEYS.FTP;
    if (type.includes("iperf")) return SCENARIO_KEYS.IPERF3;
    return SCENARIO_KEYS.NATIVE_HTTP;
  }
  return SCENARIO_KEYS.RF_ONLY;
}

export function resolveRunModeLabel(session = {}, scenarioKey = "") {
  if (scenarioKey === SCENARIO_KEYS.OOKLA || scenarioKey === SCENARIO_KEYS.FCC) {
    return "External Evidence";
  }
  if (scenarioKey === SCENARIO_KEYS.RF_ONLY || scenarioKey === SCENARIO_KEYS.VOICE) {
    return "RF / Session";
  }
  const mode = String(
    session?.appRunMode
    || session?.appSetupSnapshot?.runMode
    || session?.dataTest?.runMode
    || "",
  ).toLowerCase();
  if (mode === "continuous" || String(session?.appTestStatus || "").toLowerCase() === "continuous_complete") {
    return "Continuous";
  }
  return "Fixed";
}

export function scenarioDisplayName(scenarioKey = "") {
  switch (scenarioKey) {
    case SCENARIO_KEYS.NATIVE_HTTP: return "Native HTTP";
    case SCENARIO_KEYS.FTP: return "FTP";
    case SCENARIO_KEYS.IPERF3: return "iPerf3";
    case SCENARIO_KEYS.OOKLA: return "OOKLA External Evidence";
    case SCENARIO_KEYS.FCC: return "FCC External Evidence";
    case SCENARIO_KEYS.VOICE: return "Voice";
    default: return "RF Only";
  }
}

function emptyModel(scenarioKey) {
  return {
    scenario: scenarioKey,
    scenarioLabel: scenarioDisplayName(scenarioKey),
    sourceFamily: "none",
    runModeLabel: "RF / Session",
    supportsControlledIterations: false,
    supportsContinuous: false,
    supportsInternalThroughput: false,
    supportsIntervalSamples: false,
    supportsExternalEvidence: false,
    dataMapEngineLabel: null,
    kpiDataSection: null,
    sheets: {
      cover: true,
      index: true,
      kpiSummary: true,
      rfPlotData: true,
      rfRawData: true,
      dataThroughput: false,
      dataEvents: true,
      voiceEvents: false,
      externalEvidence: false,
      rfMaps: true,
      dataMaps: false,
      eventGraphs: true,
      eventMaps: true,
      readMe: true,
    },
  };
}

export function adaptNativeHttpScenario(session = {}) {
  return {
    ...emptyModel(SCENARIO_KEYS.NATIVE_HTTP),
    sourceFamily: "native_http_internal",
    runModeLabel: resolveRunModeLabel(session, SCENARIO_KEYS.NATIVE_HTTP),
    supportsControlledIterations: true,
    supportsContinuous: true,
    supportsInternalThroughput: true,
    dataMapEngineLabel: "APP",
    kpiDataSection: "native_http",
    sheets: {
      ...emptyModel(SCENARIO_KEYS.NATIVE_HTTP).sheets,
      dataThroughput: true,
      dataMaps: true,
    },
  };
}

export function adaptFtpScenario(session = {}) {
  return {
    ...emptyModel(SCENARIO_KEYS.FTP),
    sourceFamily: "ftp_internal",
    runModeLabel: resolveRunModeLabel(session, SCENARIO_KEYS.FTP),
    supportsControlledIterations: true,
    supportsContinuous: true,
    supportsInternalThroughput: true,
    dataMapEngineLabel: "FTP",
    kpiDataSection: "ftp",
    sheets: {
      ...emptyModel(SCENARIO_KEYS.FTP).sheets,
      dataThroughput: true,
      dataMaps: true,
    },
  };
}

export function adaptIperf3Scenario(session = {}) {
  return {
    ...emptyModel(SCENARIO_KEYS.IPERF3),
    sourceFamily: "iperf3_internal",
    runModeLabel: resolveRunModeLabel(session, SCENARIO_KEYS.IPERF3),
    supportsControlledIterations: true,
    supportsContinuous: true,
    supportsInternalThroughput: true,
    supportsIntervalSamples: true,
    dataMapEngineLabel: "iPerf3",
    kpiDataSection: "iperf3",
    sheets: {
      ...emptyModel(SCENARIO_KEYS.IPERF3).sheets,
      dataThroughput: true,
      dataMaps: true,
    },
  };
}

export function adaptOoklaScenario(session = {}) {
  return {
    ...emptyModel(SCENARIO_KEYS.OOKLA),
    sourceFamily: "ookla_external_evidence",
    runModeLabel: "External Evidence",
    supportsExternalEvidence: true,
    dataMapEngineLabel: "OOKLA External Evidence",
    kpiDataSection: "ookla",
    sheets: {
      ...emptyModel(SCENARIO_KEYS.OOKLA).sheets,
      dataThroughput: true,
      externalEvidence: true,
      dataMaps: true,
    },
  };
}

export function adaptFccScenario(session = {}) {
  return {
    ...emptyModel(SCENARIO_KEYS.FCC),
    sourceFamily: "fcc_external_evidence",
    runModeLabel: "External Evidence",
    supportsExternalEvidence: true,
    dataMapEngineLabel: "FCC External Evidence",
    kpiDataSection: "fcc",
    sheets: {
      ...emptyModel(SCENARIO_KEYS.FCC).sheets,
      dataThroughput: true,
      externalEvidence: true,
      dataMaps: true,
    },
  };
}

export function adaptRfOnlyScenario(session = {}) {
  return {
    ...emptyModel(SCENARIO_KEYS.RF_ONLY),
    sourceFamily: "rf_session",
    runModeLabel: resolveRunModeLabel(session, SCENARIO_KEYS.RF_ONLY),
    sheets: {
      ...emptyModel(SCENARIO_KEYS.RF_ONLY).sheets,
      dataThroughput: true,
    },
  };
}

/**
 * Build the thin scenario adapter used by shared Excel renderers.
 */
export function buildScenarioAdapter(session = {}, explicitScenario = null) {
  const key = explicitScenario || resolveScenarioKey(session);
  switch (key) {
    case SCENARIO_KEYS.NATIVE_HTTP: return adaptNativeHttpScenario(session);
    case SCENARIO_KEYS.FTP: return adaptFtpScenario(session);
    case SCENARIO_KEYS.IPERF3: return adaptIperf3Scenario(session);
    case SCENARIO_KEYS.OOKLA: return adaptOoklaScenario(session);
    case SCENARIO_KEYS.FCC: return adaptFccScenario(session);
    case SCENARIO_KEYS.VOICE:
      return { ...adaptRfOnlyScenario(session), scenario: SCENARIO_KEYS.VOICE, scenarioLabel: "Voice" };
    default:
      return adaptRfOnlyScenario(session);
  }
}

/**
 * Normalized report envelope — adapters fill only applicable families.
 */
export function createNormalizedScenarioReportModel({
  session = {},
  scenarioAdapter = null,
  network = null,
  connectivity = null,
  gps = null,
  rf = null,
  testOutcome = null,
  iterations = [],
  intervalSamples = [],
  trafficStats = null,
  voiceEvents = [],
  externalEvidence = [],
  events = [],
  maps = null,
  paletteSnapshot = null,
} = {}) {
  const adapter = scenarioAdapter || buildScenarioAdapter(session);
  return {
    scenario: adapter.scenario,
    scenarioLabel: adapter.scenarioLabel,
    sourceFamily: adapter.sourceFamily,
    runModeLabel: adapter.runModeLabel,
    session: {
      id: session?.id || null,
      startedAt: session?.startedAt || null,
      endedAt: session?.endedAt || null,
      reportLogName: session?.reportLogName || null,
      mode: session?.mode || null,
    },
    network,
    connectivity,
    gps,
    rf,
    testOutcome,
    iterations: Array.isArray(iterations) ? iterations : [],
    intervalSamples: Array.isArray(intervalSamples) ? intervalSamples : [],
    trafficStats,
    voiceEvents: Array.isArray(voiceEvents) ? voiceEvents : [],
    externalEvidence: Array.isArray(externalEvidence) ? externalEvidence : [],
    events: Array.isArray(events) ? events : [],
    maps,
    paletteSnapshot,
    adapter,
  };
}

export default {
  SCENARIO_KEYS,
  resolveScenarioKey,
  resolveRunModeLabel,
  scenarioDisplayName,
  buildScenarioAdapter,
  createNormalizedScenarioReportModel,
};
