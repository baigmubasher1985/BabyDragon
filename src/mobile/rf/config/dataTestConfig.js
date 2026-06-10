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
    status: "planned",
    description: "Planned FTP DL/UL workflow with server, credentials, path, and duration/file-size settings.",
  },
  {
    key: "iperf",
    label: "iPerf",
    status: "planned",
    description: "Planned TCP/UDP iPerf workflow with server, port, streams, duration, and interval settings.",
  },
  {
    key: "ookla_app",
    label: "OOKLA App",
    status: "planned",
    description: "Open OOKLA app, upload screenshot, OCR candidate values, then FE confirms final values.",
  },
  {
    key: "fcc_app",
    label: "FCC App",
    status: "planned",
    description: "Open FCC app, import FCC export, truncate by BabyDragon session timestamps, and save grid-named outputs.",
  },
];

export const DATA_DIRECTIONS = [
  { key: "dl_ul", label: "DL + UL" },
  { key: "dl", label: "DL only" },
  { key: "ul", label: "UL only" },
];

export const DEFAULT_NATIVE_HTTP_SETUP = {
  testType: "native_http",
  direction: "dl_ul",
  durationSeconds: 10,
  intervalSeconds: 1,
  iterations: 1,
  waitSeconds: 5,
  downloadUrl: "https://speed.cloudflare.com/__down",
  uploadUrl: "https://speed.cloudflare.com/__up",
};

export const DEFAULT_FCC_IMPORT_SETUP = {
  timestampBufferSeconds: 30,
  keepRawImport: true,
  saveTruncatedByGrid: true,
};

export const DEFAULT_OOKLA_SETUP = {
  ocrAssist: true,
  requireFeConfirmation: true,
  keepScreenshot: true,
};
