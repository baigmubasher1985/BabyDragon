import { BabyDragonIperf } from "../plugins/babyDragonIperf";
import { DEFAULT_IPERF_SETUP } from "../rf/config/dataTestConfig";
import { resolveIperf3RunSetup } from "./iperf3CommandParser";
import { buildIperfIterationResult, mapIperf3NativeResult } from "./iperf3ResultMapper";

const asNumber = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function makeAbortError() {
  const error = new Error("Throughput test stopped.");
  error.name = "AbortError";
  return error;
}

function waitWithSignal(waitSeconds, signal, onTick) {
  const totalMs = Math.max(0, Number(waitSeconds || 0) * 1000);
  if (!totalMs) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(makeAbortError());

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (signal?.aborted) {
        window.clearInterval(timer);
        reject(makeAbortError());
        return;
      }
      const remaining = Math.max(0, Math.ceil((totalMs - (Date.now() - startedAt)) / 1000));
      if (typeof onTick === "function") onTick(remaining);
      if (Date.now() - startedAt >= totalMs) {
        window.clearInterval(timer);
        resolve();
      }
    }, 250);
  });
}

export const buildIperf3Payload = (setup = {}) => ({
  server: String(setup.server || "").trim(),
  port: asNumber(setup.port, 5201),
  protocol: String(setup.protocol || "TCP").toUpperCase(),
  direction: String(setup.direction || "ul").toLowerCase(),
  durationSeconds: asNumber(setup.durationSeconds, 10),
  intervalSeconds: asNumber(setup.intervalSeconds, 1),
  streams: asNumber(setup.streams, 1),
  reverseMode: setup.reverseMode === true,
  bidirMode: setup.bidirMode === true,
  udpBitrateMbps: asNumber(setup.udpBitrateMbps, 10),
  commandMode: setup.commandMode === true,
  customerCommand: String(setup.customerCommand || setup.rawCommand || "").trim(),
  rawCommand: String(setup.rawCommand || setup.customerCommand || "").trim(),
});

export async function getIperf3Status() {
  return BabyDragonIperf.getIperfStatus();
}

export async function probeIperf3Version() {
  if (typeof BabyDragonIperf.probeIperfVersion !== "function") {
    const status = await getIperf3Status();
    return {
      ok: Boolean(status?.ok || status?.executionProbeOk),
      status: status?.status || "probe_unavailable",
      stdout: status?.stdout || "",
      message: status?.message || "Version probe method not present; used getIperfStatus.",
      abi: status?.abi || null,
    };
  }
  return BabyDragonIperf.probeIperfVersion();
}

export async function cancelIperf3() {
  try {
    return await BabyDragonIperf.cancelIperf3();
  } catch {
    return { ok: false };
  }
}

export async function runIperf3Once(setup, onProgress) {
  let listener = null;
  const payload = buildIperf3Payload(setup);

  try {
    listener = await BabyDragonIperf.addListener("iperfProgress", (event) => {
      if (typeof onProgress === "function") onProgress(event);
    });

    return await BabyDragonIperf.runIperf3(payload);
  } finally {
    if (listener) await listener.remove();
  }
}

export async function runIperf3ThroughputTest({ config = {}, onProgress, signal } = {}) {
  const resolved = resolveIperf3RunSetup(config, DEFAULT_IPERF_SETUP);
  if (!resolved.ok) {
    throw new Error(resolved.error || "Invalid iPerf3 setup.");
  }

  const setup = resolved.setup;
  const probe = await probeIperf3Version();
  if (!probe?.ok) {
    const failMapped = {
      ok: false,
      status: "incomplete",
      message: probe?.message || "iPerf3 version/help probe failed before network testing.",
      errorCode: probe?.failure_class || probe?.status || "binary_missing",
      dlMbps: null,
      ulMbps: null,
      stdout: probe?.stdout || "",
      stderr: probe?.stderr || "",
    };
    const iterationResult = buildIperfIterationResult(1, failMapped, setup, probe);
    return {
      ok: false,
      source: "native-iperf3-v1g4b",
      setup,
      warnings: resolved.warnings,
      runMode: String(setup.runMode || config.runMode || "fixed").toLowerCase() === "continuous" ? "continuous" : "fixed",
      iterations: [iterationResult],
      iterationResults: [iterationResult],
      avgDlMbps: null,
      avgUlMbps: null,
      downloadBytes: null,
      uploadBytes: null,
      lastMapped: failMapped,
      probe,
      message: failMapped.message,
    };
  }

  const continuous = String(setup.runMode || config.runMode || "fixed").toLowerCase() === "continuous";
  const MAX_IPERF_ITERATIONS = 999999;
  const iterations = continuous
    ? null
    : clamp(asNumber(setup.iterations, 1), 1, MAX_IPERF_ITERATIONS);
  const waitSeconds = clamp(asNumber(setup.waitSeconds, 0), 0, 120);
  const iterationResults = [];
  let lastMapped = null;

  for (let iteration = 1; continuous ? !signal?.aborted : iteration <= iterations; iteration += 1) {
    if (signal?.aborted) {
      await cancelIperf3();
      throw makeAbortError();
    }

    const iterLabel = continuous
      ? `Continuous · iter ${iteration}`
      : `iPerf3 iteration ${iteration}/${iterations}`;

    onProgress?.({
      phase: "iperf",
      status: "running",
      currentIteration: iteration,
      completedIterations: iterationResults.filter((r) => r.status === "complete").length,
      iterationsRequested: continuous ? null : iterations,
      runMode: continuous ? "continuous" : "fixed",
      message: `${iterLabel} starting on ${setup.server}:${setup.port}...`,
      warnings: resolved.warnings,
    });

    let nativeResult;
    try {
      nativeResult = await runIperf3Once(setup, (event) => {
        onProgress?.({
          ...event,
          phase: "iperf",
          status: "running",
          currentIteration: iteration,
          completedIterations: iterationResults.filter((r) => r.status === "complete").length,
          iterationsRequested: continuous ? null : iterations,
          runMode: continuous ? "continuous" : "fixed",
        });
      });
    } catch (error) {
      if (signal?.aborted) {
        await cancelIperf3();
        throw makeAbortError();
      }
      // Runtime iteration failure: record and continue (do not abort sequence).
      const failMapped = {
        ok: false,
        message: error?.message || "iPerf3 iteration failed.",
        errorCode: "IPERF3_ITERATION_FAILED",
        dlMbps: null,
        ulMbps: null,
      };
      lastMapped = failMapped;
      iterationResults.push(buildIperfIterationResult(iteration, failMapped, setup, null));
      onProgress?.({
        phase: "iperf",
        status: "running",
        currentIteration: iteration,
        completedIterations: iterationResults.filter((r) => r.status === "complete").length,
        iterationsRequested: continuous ? null : iterations,
        runMode: continuous ? "continuous" : "fixed",
        iterationResults: [...iterationResults],
        dlMbps: averageMbps(iterationResults, "dlMbps"),
        ulMbps: averageMbps(iterationResults, "ulMbps"),
        message: `${iterLabel} failed (${failMapped.message}). Continuing...`,
      });
      const shouldWaitFail = continuous ? waitSeconds > 0 : (iteration < iterations && waitSeconds > 0);
      if (shouldWaitFail) {
        await waitWithSignal(waitSeconds, signal, (remaining) => {
          onProgress?.({
            phase: "wait",
            status: "running",
            currentIteration: iteration + 1,
            completedIterations: iterationResults.filter((r) => r.status === "complete").length,
            iterationsRequested: continuous ? null : iterations,
            runMode: continuous ? "continuous" : "fixed",
            message: continuous
              ? `Waiting ${remaining}s before continuous iter ${iteration + 1}...`
              : `Waiting ${remaining}s before iPerf3 iteration ${iteration + 1}/${iterations}...`,
          });
        });
      }
      continue;
    }

    if (signal?.aborted) {
      await cancelIperf3();
      throw makeAbortError();
    }

    lastMapped = mapIperf3NativeResult(nativeResult, setup);
    const iterationResult = buildIperfIterationResult(iteration, lastMapped, setup, nativeResult);
    iterationResults.push(iterationResult);

    onProgress?.({
      phase: "iperf",
      status: "running",
      currentIteration: iteration,
      completedIterations: iterationResults.filter((r) => r.status === "complete").length,
      iterationsRequested: continuous ? null : iterations,
      runMode: continuous ? "continuous" : "fixed",
      iterationResults: [...iterationResults],
      dlMbps: averageMbps(iterationResults, "dlMbps"),
      ulMbps: averageMbps(iterationResults, "ulMbps"),
      message: lastMapped.ok
        ? `${iterLabel} complete.`
        : (lastMapped.message || `${iterLabel} failed.`),
    });

    const shouldWait = continuous ? waitSeconds > 0 : (iteration < iterations && waitSeconds > 0);
    if (shouldWait) {
      await waitWithSignal(waitSeconds, signal, (remaining) => {
        onProgress?.({
          phase: "wait",
          status: "running",
          currentIteration: iteration + 1,
          completedIterations: iterationResults.filter((r) => r.status === "complete").length,
          iterationsRequested: continuous ? null : iterations,
          runMode: continuous ? "continuous" : "fixed",
          message: continuous
            ? `Waiting ${remaining}s before continuous iter ${iteration + 1}...`
            : `Waiting ${remaining}s before iPerf3 iteration ${iteration + 1}/${iterations}...`,
        });
      });
    }
  }

  const avgDl = averageMbps(iterationResults, "dlMbps");
  const avgUl = averageMbps(iterationResults, "ulMbps");
  const totalDlBytes = iterationResults.reduce((sum, item) => {
    const n = Number(item.dlMeasuredBytes);
    return Number.isFinite(n) && n > 0 ? sum + n : sum;
  }, 0);
  const totalUlBytes = iterationResults.reduce((sum, item) => {
    const n = Number(item.ulMeasuredBytes);
    return Number.isFinite(n) && n > 0 ? sum + n : sum;
  }, 0);
  const completed = iterationResults.filter((item) => item.status === "complete").length;
  const failed = iterationResults.length - completed;
  const allOk = failed === 0 && completed > 0;

  return {
    ok: allOk,
    source: "native-iperf3-v1g4b",
    setup,
    warnings: resolved.warnings,
    runMode: continuous ? "continuous" : "fixed",
    iterations: iterationResults,
    iterationResults,
    avgDlMbps: avgDl,
    avgUlMbps: avgUl,
    downloadBytes: completed ? totalDlBytes : null,
    uploadBytes: completed ? totalUlBytes : null,
    lastMapped,
    probe,
    message: continuous
      ? `iPerf3 continuous stopped. Attempted ${iterationResults.length}, completed ${completed}, failed ${failed}.`
      : (allOk
        ? `iPerf3 complete ${iterationResults.length}/${iterations}.`
        : (lastMapped?.message || "iPerf3 test finished with errors.")),
  };
}

function averageMbps(results, key) {
  const values = (Array.isArray(results) ? results : [])
    .map((row) => {
      const n = Number(row?.[key]);
      return Number.isFinite(n) && n > 0 ? n : null;
    })
    .filter((value) => value !== null);
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000;
}
