import { Capacitor, registerPlugin } from '@capacitor/core';

export const BabyDragonFtp = registerPlugin('BabyDragonFtp');

export const FTP_PRESETS = {
  rebexDownloadDemo: {
    label: 'Rebex DL demo',
    note: 'Read-only FTP demo for download/list testing.',
    host: 'test.rebex.net',
    port: 21,
    username: 'demo',
    password: 'password',
    direction: 'DL_ONLY',
    passiveMode: true,
    secureFtps: false,
    dlRemotePath: '/readme.txt',
    ulRemoteFolder: '/',
    ulFileSizeMb: 10,
  },
  dlpUploadDemo: {
    label: 'DLPTest UL demo',
    note: 'Public FTP upload demo. Password can rotate, verify before field use.',
    host: 'ftp.dlptest.com',
    port: 21,
    username: 'dlpuser',
    password: 'rNrKYTX9g7z3RgJRmxWuGHbeu',
    direction: 'UL_ONLY',
    passiveMode: true,
    secureFtps: false,
    dlRemotePath: '/',
    ulRemoteFolder: '/',
    ulFileSizeMb: 10,
  },
  custom: {
    label: 'Custom FTP server',
    note: 'Use customer/server-specific FTP settings.',
    host: '',
    port: 21,
    username: '',
    password: '',
    direction: 'DL_UL',
    passiveMode: true,
    secureFtps: false,
    dlRemotePath: '/',
    ulRemoteFolder: '/',
    ulFileSizeMb: 10,
  },
};

const clampNumber = (value, fallback, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

const normalizeDirection = (direction) => {
  const d = String(direction || 'DL_ONLY').toUpperCase();
  if (d.includes('DL') && d.includes('UL')) return 'DL_UL';
  if (d.includes('UL')) return 'UL_ONLY';
  return 'DL_ONLY';
};

export function normalizeFtpConfig(config = {}) {
  return {
    host: String(config.host || 'test.rebex.net').trim(),
    port: Math.round(clampNumber(config.port, 21, 1, 65535)),
    username: String(config.username ?? 'demo'),
    password: String(config.password ?? 'password'),
    direction: normalizeDirection(config.direction),
    durationSec: clampNumber(config.durationSec, 10, 1, 3600),
    warmupSec: clampNumber(config.warmupSec, 3, 0, 120),
    intervalSec: clampNumber(config.intervalSec, 1, 0.25, 60),
    iterations: Math.round(clampNumber(config.iterations, 1, 1, 100)),
    waitSec: clampNumber(config.waitSec, 5, 0, 3600),
    passiveMode: config.passiveMode !== false,
    secureFtps: Boolean(config.secureFtps),
    dlRemotePath: String(config.dlRemotePath || '/readme.txt'),
    ulRemoteFolder: String(config.ulRemoteFolder || '/'),
    ulFileSizeMb: Math.round(clampNumber(config.ulFileSizeMb, 10, 1, 2048)),
    sessionId: String(config.sessionId || `bd-ftp-${Date.now()}`),
    taskName: String(config.taskName || ''),
    gridId: String(config.gridId || ''),
  };
}

export async function runFtpTest(config = {}, options = {}) {
  const finalConfig = normalizeFtpConfig(config);

  if (Capacitor.getPlatform() === 'web') {
    return {
      ok: false,
      test_type: 'FTP',
      error_code: 'FTP_NATIVE_ONLY',
      error_message: 'FTP runner is native Android only. Build and test on device/emulator.',
      config: finalConfig,
    };
  }

  let listenerHandle = null;
  if (typeof options.onProgress === 'function' && BabyDragonFtp.addListener) {
    listenerHandle = await BabyDragonFtp.addListener('ftpTestProgress', options.onProgress);
  }

  try {
    return await BabyDragonFtp.runFtpTest(finalConfig);
  } finally {
    if (listenerHandle?.remove) {
      await listenerHandle.remove();
    }
  }
}

export async function cancelFtpTest() {
  if (Capacitor.getPlatform() === 'web') {
    return { ok: true, status: 'web_noop' };
  }
  return BabyDragonFtp.cancelFtpTest();
}

export function summarizeFtpResult(result) {
  if (!result) return 'FTP: no result';
  if (!result.ok) return `FTP error: ${result.error_code || 'UNKNOWN'} - ${result.error_message || 'No details'}`;
  const dl = result.summary?.avg_dl_mbps ?? 'N/A';
  const ul = result.summary?.avg_ul_mbps ?? 'N/A';
  return `FTP ${result.direction}: DL ${dl} Mbps, UL ${ul} Mbps, iterations ${result.iterations_completed}/${result.iterations_requested}`;
}
