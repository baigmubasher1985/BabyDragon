export const DATA_TEST_TYPES = [
  {
    key: "native_http",
    label: "Native Android HTTP",
    status: "active",
    description: "Runs BabyDragon native Android DL/UL throughput tests inside the APK.",
  },
  {
    key: "ftp",
    label: "FTP",
    status: "active",
    description: "Native Android FTP DL/UL runner is wired. Use public servers for smoke testing only and controlled FTP for final throughput.",
  },
  {
    key: "iperf",
    label: "iPerf3",
    status: "active",
    description: "Native iPerf3 client with form mode, carrier command parsing, and real bundled binary execution while RF/GPS records.",
  },
  {
    key: "ookla_app",
    label: "OOKLA App",
    status: "EXTERNAL",
    description: "Open OOKLA app, upload screenshot, OCR candidate values, then FE confirms final values.",
  },
  {
    key: "fcc_app",
    label: "FCC App",
    status: "external",
    description: "Open FCC app externally, import FCC ZIP, select rows inside BabyDragon session window, and save as external evidence.",
  },
];

export const DATA_DIRECTIONS = [
  { key: "dl_ul", label: "DL + UL" },
  { key: "dl", label: "DL only" },
  { key: "ul", label: "UL only" },
];

export const DATA_TEST_STORAGE_KEYS = {
  nativeHttp: "bd_rf_native_http_setup_v1",
  ftp: "bd_rf_ftp_setup_v1",
  iperf: "bd_rf_iperf_setup_v1",
  ookla: "bd_rf_ookla_setup_v1",
};

export const NATIVE_HTTP_PRESETS = [
  {
    key: "cloudflare_demo",
    label: "Cloudflare demo",
    hint: "Default BabyDragon HTTP DL/UL preset",
    values: {
      testType: "native_http",
      presetKey: "cloudflare_demo",
      direction: "dl_ul",
      durationSeconds: 10,
      warmupSeconds: 3,
      intervalSeconds: 1,
      iterations: 1,
      waitSeconds: 5,
      downloadUrl: "https://speed.cloudflare.com/__down",
      uploadUrl: "https://speed.cloudflare.com/__up",
    },
  },
  {
    key: "custom",
    label: "Custom HTTP server",
    hint: "Keep fields editable for customer/project URLs",
    values: {
      testType: "native_http",
      presetKey: "custom",
    },
  },
];

export const FTP_PRESETS = [
  {
    key: "rebex_dl_demo",
    label: "Rebex DL demo",
    hint: "Read-only FTP demo for download/list testing",
    values: {
      testType: "ftp",
      presetKey: "rebex_dl_demo",
      direction: "dl",
      durationSeconds: 10,
      warmupSeconds: 3,
      intervalSeconds: 1,
      iterations: 1,
      waitSeconds: 5,
      host: "test.rebex.net",
      port: "21",
      username: "demo",
      password: "password",
      passiveMode: true,
      secure: false,
      downloadRemotePath: "/readme.txt",
      uploadRemotePath: "/",
      uploadFileSizeMb: 10,
      notes: "Rebex is DL smoke only. It is read-only, speed-limited, and /readme.txt is tiny, so it is not valid for final throughput.",
    },
  },
  {
    key: "dlptest_ul_demo",
    label: "DLPTest UL demo",
    hint: "Public FTP upload demo; password may rotate",
    values: {
      testType: "ftp",
      presetKey: "dlptest_ul_demo",
      direction: "ul",
      durationSeconds: 10,
      warmupSeconds: 3,
      intervalSeconds: 1,
      iterations: 1,
      waitSeconds: 5,
      host: "ftp.dlptest.com",
      port: "21",
      username: "dlpuser",
      password: "rNrKYTX9g7z3RgJRmxWuGHbeu",
      passiveMode: true,
      secure: false,
      downloadRemotePath: "/",
      uploadRemotePath: "/",
      uploadFileSizeMb: 10,
      notes: "DLPTest is UL smoke only. It stores files temporarily and the password may rotate. Verify before field use.",
    },
  },
  {
    key: "custom",
    label: "Custom FTP server",
    hint: "Use customer/project FTP server details",
    values: {
      testType: "ftp",
      presetKey: "custom",
    },
  },
];

export const IPERF_PRESETS = [
  {
    key: "iperf_fr_ping_online",
    label: "Public iPerf3 demo",
    hint: "ping.online.net, port 5201",
    values: {
      testType: "iperf",
      presetKey: "iperf_fr_ping_online",
      direction: "dl_ul",
      server: "ping.online.net",
      port: "5201",
      protocol: "TCP",
      streams: "1",
      durationSeconds: "10",
      warmupSeconds: "3",
      intervalSeconds: "1",
      iterations: "1",
      waitSeconds: "5",
      reverseMode: false,
      udpBitrateMbps: "10",
      notes: "Public iPerf3 demo only. ping.online.net uses public iPerf3 ports and may be busy or refuse parallel sessions. Use a customer-controlled iPerf3 server for final throughput.",
    },
  },
  {
    key: "custom",
    label: "Custom iPerf server",
    hint: "Use your own iPerf3 server/IP and port",
    values: {
      testType: "iperf",
      presetKey: "custom",
    },
  },
];

export const DEFAULT_NATIVE_HTTP_SETUP = {
  ...NATIVE_HTTP_PRESETS[0].values,
};

export const DEFAULT_FTP_SETUP = {
  ...FTP_PRESETS[0].values,
};

export const DEFAULT_IPERF_SETUP = {
  ...IPERF_PRESETS[0].values,
};

export const DEFAULT_FCC_IMPORT_SETUP = {
  timestampBufferSeconds: 30,
  keepRawImport: true,
  saveTruncatedByGrid: true,
  fccZipUrl: "",
  appFccImport: null,
};

export const DEFAULT_OOKLA_MANUAL_EVIDENCE = {
  provider: "ookla_app",
  source: "ookla_app_manual_v1h3",
  evidenceType: "external_manual",
  confirmation: "draft",
  capturedAt: null,
  savedAt: null,
  feConfirmedAt: null,
  dlMbps: null,
  ulMbps: null,
  pingMs: null,
  jitterMs: null,
  serverName: "",
  providerName: "",
  resultUrl: "",
  resultId: "",
  notes: "",
  ocrAssistUsed: false,
  ocrConfidence: null,
  ocrSource: null,
  ocrExtractedFields: {},
  userConfirmedFields: {},
  ocrRawTextPreview: "",
  screenshot: null,
  nearestSample: null,
};

export const DEFAULT_OOKLA_SETUP = {
  ocrAssist: false,
  requireFeConfirmation: true,
  keepScreenshot: true,
  /** Report-only BabyDragon KPI warmup window used for TrafficStats burst estimates. */
  kpiWarmupDurationSec: 3,
  evidenceDraft: { ...DEFAULT_OOKLA_MANUAL_EVIDENCE },
};
