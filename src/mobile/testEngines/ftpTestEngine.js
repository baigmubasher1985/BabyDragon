import { BabyDragonFtp } from "../plugins/babyDragonFtp";

export const FTP_PRESETS = {
  rebexDlDemo: {
    id: "rebexDlDemo",
    label: "Rebex DL demo",
    note: "Read-only FTP demo for download/list testing.",
    host: "test.rebex.net",
    port: 21,
    username: "demo",
    password: "password",
    direction: "DL only",
    dlPath: "/readme.txt",
    ulFolder: "/",
    passive: true,
    secure: false,
  },
  dlptestUlDemo: {
    id: "dlptestUlDemo",
    label: "DLPTest UL demo",
    note: "Public FTP upload demo. Password may rotate, verify before field use.",
    host: "ftp.dlptest.com",
    port: 21,
    username: "dlpuser",
    password: "rNrKYTX9g7z3RgJRmxWuGHbeu",
    direction: "UL only",
    dlPath: "/",
    ulFolder: "/",
    passive: true,
    secure: false,
  },
  custom: {
    id: "custom",
    label: "Custom FTP server",
    note: "Use your own controlled FTP server for final validation.",
    host: "",
    port: 21,
    username: "",
    password: "",
    direction: "DL + UL",
    dlPath: "/",
    ulFolder: "/",
    passive: true,
    secure: false,
  },
};

const toNumber = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const normalizeDirection = (direction) => {
  const d = String(direction || "DL only").toLowerCase();

  if (d.includes("dl") && d.includes("ul")) return "DL + UL";
  if (d.includes("ul")) return "UL only";
  return "DL only";
};

export const buildFtpPayload = ({
  ftpConfig = {},
  sessionId,
  task,
  grid,
} = {}) => {
  const preset =
    FTP_PRESETS[ftpConfig.presetId] ||
    FTP_PRESETS.rebexDlDemo;

  const merged = {
    ...preset,
    ...ftpConfig,
  };

  return {
    sessionId:
      sessionId ||
      `bd-ftp-${Date.now()}`,

    taskName:
      task?.name ||
      task?.title ||
      task?.task_name ||
      "",

    gridId:
      grid?.grid_id ||
      grid?.id ||
      grid?.name ||
      "",

    host: merged.host || "test.rebex.net",
    port: toNumber(merged.port, 21),

    username: merged.username || "anonymous",
    password: merged.password || "",

    direction: normalizeDirection(merged.direction),

    durationSec: toNumber(merged.durationSec ?? merged.durationSeconds ?? merged.duration, 10),
    warmupSec: toNumber(merged.warmupSec ?? merged.warmupSeconds ?? merged.warmup, 3),
    intervalSec: toNumber(merged.intervalSec ?? merged.intervalSeconds ?? merged.interval, 1),
    waitSec: toNumber(merged.waitSec ?? merged.waitSeconds ?? merged.wait, 5),
    iterations: toNumber(merged.iterations, 1),

    dlPath: merged.dlPath || merged.downloadRemotePath || merged.remoteFile || "/readme.txt",
    ulFolder: merged.ulFolder || merged.uploadRemotePath || merged.remoteFolder || "/",

    passive: merged.passive ?? merged.passiveMode ?? true,
    secure: merged.secure === true,
  };
};

export const normalizeFtpResult = (result, payload) => {
  const rawIterations = Array.isArray(result?.iterations)
    ? result.iterations
    : [];

  const iterations = rawIterations.map((it) => {
    const dlPresent = it.dl != null;
    const ulPresent = it.ul != null;
    const dlOk = it.dl?.ok === true || (it.dl?.ok !== false && Number(it.dl?.mbps) > 0);
    const ulOk = it.ul?.ok === true || (it.ul?.ok !== false && Number(it.ul?.mbps) > 0);
    const dlFailed = dlPresent && (it.dl.ok === false || (!(it.dl.mbps > 0) && (it.dl.measured_bytes || 0) <= 0 && String(it.dl.message || "")));
    const ulFailed = ulPresent && (it.ul.ok === false || (!(it.ul.mbps > 0) && (it.ul.measured_bytes || 0) <= 0 && String(it.ul.message || "")));
    const failedSide = ulFailed && !dlFailed
      ? it.ul
      : (dlFailed && !ulFailed ? it.dl : (dlFailed ? it.dl : (ulFailed ? it.ul : null)));
    const errorMessage = String(
      failedSide?.message
      || "",
    ).trim();
    const nativeCode = String(
      failedSide?.error_code
      || failedSide?.errorCode
      || "",
    ).trim();
    const lower = errorMessage.toLowerCase();
    let errorCode = nativeCode;
    let failureStage = "";
    if (lower.includes("550") || lower.includes("access denied") || lower.includes("failed to open file")) {
      errorCode = nativeCode && /550|ACCESS|DENIED|UPLOAD_REJECTED|DOWNLOAD/i.test(nativeCode)
        ? (nativeCode.includes("550") ? nativeCode : "FTP_550_ACCESS_DENIED")
        : "FTP_550_ACCESS_DENIED";
      failureStage = ulFailed && !dlFailed ? "ftp_upload" : "ftp_download";
    } else if (lower.includes("passive") && (lower.includes("timeout") || lower.includes("timed out"))) {
      errorCode = nativeCode || "PASSIVE_DATA_CONNECTION";
      failureStage = "ftp_download";
    } else if (nativeCode) {
      errorCode = nativeCode;
      failureStage = ulFailed && !dlFailed ? "ftp_upload" : (dlFailed ? "ftp_download" : "during_transfer");
    } else if (errorMessage) {
      errorCode = "FTP_FAILED";
      failureStage = ulFailed && !dlFailed ? "ftp_upload" : (dlFailed ? "ftp_download" : "during_transfer");
    }

    const anySuccess = (dlPresent && dlOk && !dlFailed) || (ulPresent && ulOk && !ulFailed);
    const anyFailure = dlFailed || ulFailed;
    let status = "complete";
    if (anyFailure && anySuccess) status = "partial_failure";
    else if (anyFailure) status = "failed";
    else if (!anySuccess && (dlPresent || ulPresent)) status = "failed";

    const dlErrorText = dlFailed ? String(it.dl?.message || "").trim() : "";
    const ulErrorText = ulFailed ? String(it.ul?.message || "").trim() : "";

    return {
      iteration: it.iteration,
      direction: it.direction,
      startedAtMs: it.started_at_ms,
      endedAtMs: it.ended_at_ms,
      status,
      overall_status: status,

      dlMbps: dlFailed ? null : (it.dl?.mbps ?? null),
      ulMbps: ulFailed ? null : (it.ul?.mbps ?? null),

      dlWarmupBytes: it.dl?.warmup_bytes ?? 0,
      dlMeasuredBytes: it.dl?.measured_bytes ?? 0,
      ulWarmupBytes: it.ul?.warmup_bytes ?? 0,
      ulMeasuredBytes: it.ul?.measured_bytes ?? 0,

      dlDurationMs: it.dl?.measured_duration_ms ?? null,
      ulDurationMs: it.ul?.measured_duration_ms ?? null,

      dlStatus: dlFailed ? "failed" : (dlPresent && dlOk ? "complete" : (dlPresent ? "failed" : "N/A")),
      ulStatus: ulFailed ? "failed" : (ulPresent && ulOk ? "complete" : (ulPresent ? "failed" : "N/A")),
      dl_status: dlFailed ? "failed" : (dlPresent && dlOk ? "complete" : (dlPresent ? "failed" : "N/A")),
      ul_status: ulFailed ? "failed" : (ulPresent && ulOk ? "complete" : (ulPresent ? "failed" : "N/A")),
      dlOk: it.dl?.ok,
      ulOk: it.ul?.ok,
      dl_error: dlErrorText,
      ul_error: ulErrorText,
      error: errorMessage || dlErrorText || ulErrorText,
      errorMessage: errorMessage || dlErrorText || ulErrorText,
      errorCode,
      failureStage,
      raw_server_reply: String(failedSide?.raw_reply || failedSide?.rawServerReply || errorMessage || dlErrorText || ulErrorText || "").trim(),
    };
  });

  return {
    ok: result?.ok === true,
    status: result?.status || "saved",
    source: result?.source || "native-ftp-v1g2a",
    errorCode: result?.error_code || "",
    message: result?.message || "",
    testType: "ftp",
    sessionId: result?.session_id || payload?.sessionId || "",
    startedAtMs: result?.started_at_ms,
    endedAtMs: result?.ended_at_ms,
    elapsedMs: result?.elapsed_ms,

    host: result?.host || payload?.host || "",
    port: result?.port || payload?.port || 21,
    username: result?.username || payload?.username || "",
    direction: result?.direction || payload?.direction || "DL only",

    durationSec: result?.duration_sec ?? payload?.durationSec,
    warmupSec: result?.warmup_sec ?? payload?.warmupSec,
    intervalSec: result?.interval_sec ?? payload?.intervalSec,
    waitSec: result?.wait_sec ?? payload?.waitSec,

    iterationsRequested:
      result?.iterations_requested ||
      payload?.iterations ||
      iterations.length,
    iterationsCompleted:
      result?.iterations_completed ||
      iterations.length,

    avgDlMbps: result?.avg_dl_mbps ?? null,
    avgUlMbps: result?.avg_ul_mbps ?? null,

    dlWarmupBytes: result?.dl_warmup_bytes || 0,
    dlMeasuredBytes: result?.dl_measured_bytes || 0,
    ulWarmupBytes: result?.ul_warmup_bytes || 0,
    ulMeasuredBytes: result?.ul_measured_bytes || 0,

    iterations,
    raw: result,
  };
};

export const runBabyDragonFtpTest = async ({
  ftpConfig,
  sessionId,
  task,
  grid,
  onProgress,
} = {}) => {
  const payload = buildFtpPayload({
    ftpConfig,
    sessionId,
    task,
    grid,
  });

  let progressListener = null;

  try {
    progressListener = await BabyDragonFtp.addListener("ftpProgress", (event) => {
      if (typeof onProgress === "function") {
        onProgress({
          ...event,
          testType: "ftp",
          source: "native-ftp-v1g2a",
          iterationsRequested:
            event?.iterations_requested || payload.iterations,
        });
      }
    });

    const result = await BabyDragonFtp.runFtpTest(payload);
    return normalizeFtpResult(result, payload);
  } finally {
    if (progressListener) {
      await progressListener.remove();
    }
  }
};
