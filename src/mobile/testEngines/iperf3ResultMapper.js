import { classifyIperfFailure } from "../rf/reports/dataTestOutcome.js";

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function safeMbps(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 1000) / 1000;
}

export function safeBytes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function bpsToMbps(bps) {
  return safeMbps(Number(bps) / 1_000_000);
}

function wantsBidir(setup = {}) {
  return setup.bidirMode === true || String(setup.direction || "").toLowerCase() === "dl_ul";
}

function extractUsefulIperfLine(text = "") {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const useful = lines.find((line) => /error|failed|unsupported|refused|bidir|not supported|invalid/i.test(line));
  return useful || lines[lines.length - 1] || "";
}

function applyBidirResultPolicy(mapped = {}, setup = {}) {
  if (!wantsBidir(setup)) return mapped;

  const hint = extractUsefulIperfLine(mapped.stderr) || extractUsefulIperfLine(mapped.stdout);
  const hintSuffix = hint ? ` ${hint}` : "";
  const concrete = String(mapped.message || hint || "").trim();
  const isServerBusy = /server is busy|busy running a test/i.test(concrete);
  const isUnsupported = /unsupported|not supported|invalid.*bidir|unknown option.*bidir/i.test(concrete);

  if (!mapped.ok) {
    if (isServerBusy) {
      mapped.message = concrete.match(/the server is busy[^"]*/i)?.[0]
        || "the server is busy running a test. try again later";
      return mapped;
    }
    if (isUnsupported || /bidirectional requires/i.test(concrete)) {
      mapped.message = concrete;
      return mapped;
    }
    // Keep concrete process/server errors; only add bidir guidance when no useful error exists.
    mapped.message = concrete
      || `Bidirectional requires --bidir and server support.${hintSuffix}`.trim();
    return mapped;
  }

  if (mapped.dlMbps === null && mapped.ulMbps === null) {
    mapped.ok = false;
    mapped.message = isServerBusy
      ? (concrete.match(/the server is busy[^"]*/i)?.[0] || "the server is busy running a test. try again later")
      : `Bidirectional requires --bidir and server support. No DL/UL totals were returned.${hintSuffix}`.trim();
    return mapped;
  }

  if (mapped.dlMbps === null || mapped.ulMbps === null) {
    const missing = mapped.dlMbps === null ? "DL" : "UL";
    mapped.bidirIncomplete = true;
    mapped.message = `Bidirectional result incomplete: missing ${missing}.${hintSuffix || " Server may not support --bidir."}`.trim();
  }

  return mapped;
}

function readJsonFromNativeResult(nativeResult = {}) {
  if (nativeResult.raw_json && typeof nativeResult.raw_json === "object") {
    return nativeResult.raw_json;
  }
  const stdout = String(nativeResult.stdout || "").trim();
  if (!stdout) return null;
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function mapDirectionTotals(setup = {}, end = {}) {
  const isReverse = setup.reverseMode === true;
  const isBidir = setup.bidirMode === true;
  const protocol = String(setup.protocol || "TCP").toUpperCase();
  const sumSent = end.sum_sent || null;
  const sumReceived = end.sum_received || null;
  const sum = end.sum || null;

  let dlMbps = null;
  let ulMbps = null;
  let dlBytes = null;
  let ulBytes = null;

  if (isBidir) {
    if (sumSent) {
      ulMbps = bpsToMbps(sumSent.bits_per_second);
      ulBytes = safeBytes(sumSent.bytes);
    }
    if (sumReceived) {
      dlMbps = bpsToMbps(sumReceived.bits_per_second);
      dlBytes = safeBytes(sumReceived.bytes);
    }
  } else if (isReverse) {
    if (sumReceived) {
      dlMbps = bpsToMbps(sumReceived.bits_per_second);
      dlBytes = safeBytes(sumReceived.bytes);
    } else if (protocol === "UDP" && sum) {
      dlMbps = bpsToMbps(sum.bits_per_second);
      dlBytes = safeBytes(sum.bytes);
    }
  } else if (sumSent) {
    ulMbps = bpsToMbps(sumSent.bits_per_second);
    ulBytes = safeBytes(sumSent.bytes);
  } else if (protocol === "UDP" && sum) {
    ulMbps = bpsToMbps(sum.bits_per_second);
    ulBytes = safeBytes(sum.bytes);
  }

  return { dlMbps, ulMbps, dlBytes, ulBytes, isReverse, isBidir };
}

function readStatsObject(obj) {
  if (!obj || typeof obj !== "object") return null;
  return {
    bps: obj.bits_per_second,
    bytes: obj.bytes,
    start: obj.start,
    end: obj.end,
    seconds: obj.seconds,
    sender: obj.sender,
  };
}

function pickTiming(...candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const start = safeNumber(candidate.start);
    const end = safeNumber(candidate.end);
    const seconds = safeNumber(candidate.seconds);
    if (start !== null || end !== null || seconds !== null) {
      return { start, end, seconds };
    }
  }
  return { start: null, end: null, seconds: null };
}

function aggregateStreamStats(streams = []) {
  if (!streams.length) return null;
  let bps = 0;
  let bytes = 0;
  for (const stream of streams) {
    bps += Number(stream?.bits_per_second) || 0;
    bytes += Number(stream?.bytes) || 0;
  }
  return {
    bps,
    bytes,
    start: streams[0]?.start,
    end: streams[0]?.end,
    seconds: streams[0]?.seconds,
    sender: streams[0]?.sender,
  };
}

function collectSumBlocks(item = {}) {
  const blocks = [];
  if (Array.isArray(item.sum)) {
    blocks.push(...item.sum);
  } else if (item.sum && typeof item.sum === "object") {
    blocks.push(item.sum);
  }
  return blocks;
}

function resolveBidirIntervalSums(item = {}) {
  let sumSent = readStatsObject(item.sum_sent);
  let sumReceived = readStatsObject(item.sum_received);

  for (const block of collectSumBlocks(item)) {
    if (!block || typeof block !== "object") continue;

    if (block.sum_sent) {
      const sent = readStatsObject(block.sum_sent);
      if (sent?.sender === false) {
        sumReceived = sumReceived || sent;
      } else {
        sumSent = sumSent || sent;
      }
    }

    if (block.sum_received) {
      const received = readStatsObject(block.sum_received);
      if (received?.sender === false) {
        sumSent = sumSent || received;
      } else {
        sumReceived = sumReceived || received;
      }
    }

    if (block.bits_per_second !== undefined) {
      const flat = readStatsObject(block);
      if (flat.sender === false) sumReceived = sumReceived || flat;
      else sumSent = sumSent || flat;
    }
  }

  const streams = Array.isArray(item.streams) ? item.streams : [];
  if (streams.length) {
    const senderStreams = streams.filter((stream) => stream && stream.sender === true);
    const receiverStreams = streams.filter((stream) => stream && stream.sender === false);

    if (senderStreams.length && !sumSent) {
      sumSent = aggregateStreamStats(senderStreams);
    }
    if (receiverStreams.length && !sumReceived) {
      sumReceived = aggregateStreamStats(receiverStreams);
    }

    if (!sumSent && !sumReceived && streams.length >= 2) {
      const first = readStatsObject(streams[0]);
      const second = readStatsObject(streams[1]);
      if (first && second) {
        const firstBps = Number(first.bps) || 0;
        const secondBps = Number(second.bps) || 0;
        if (firstBps >= secondBps) {
          sumSent = first;
          sumReceived = second;
        } else {
          sumSent = second;
          sumReceived = first;
        }
      }
    }
  }

  if (item.sum_bidir && !sumSent) {
    sumSent = readStatsObject(item.sum_bidir);
  }
  if (item.sum_bidir_reverse && !sumReceived) {
    sumReceived = readStatsObject(item.sum_bidir_reverse);
  }

  return { sumSent, sumReceived };
}

function mapIntervalSample(setup = {}, item = {}, index = 0) {
  const isReverse = setup.reverseMode === true;
  const isBidir = wantsBidir(setup);
  const sum = item.sum && !Array.isArray(item.sum) ? item.sum : null;
  const streams = Array.isArray(item.streams) ? item.streams : [];
  const stream = streams.length ? streams[0] : null;

  let dlMbps = null;
  let ulMbps = null;
  let dlBytes = null;
  let ulBytes = null;
  let bytes = null;
  let bitsPerSecond = null;
  let timing = pickTiming(stream, sum);

  if (isBidir) {
    const { sumSent, sumReceived } = resolveBidirIntervalSums(item);
    if (sumSent) {
      ulMbps = bpsToMbps(sumSent.bps);
      ulBytes = safeBytes(sumSent.bytes);
      bytes = ulBytes;
      bitsPerSecond = safeNumber(sumSent.bps);
    }
    if (sumReceived) {
      dlMbps = bpsToMbps(sumReceived.bps);
      dlBytes = safeBytes(sumReceived.bytes);
      if (bytes === null) bytes = dlBytes;
      if (bitsPerSecond === null) bitsPerSecond = safeNumber(sumReceived.bps);
    }
    timing = pickTiming(sumSent, sumReceived, stream, sum);
  } else if (isReverse) {
    const sumReceived = readStatsObject(item.sum_received);
    const sumSent = readStatsObject(item.sum_sent);
    if (sumReceived) {
      dlMbps = bpsToMbps(sumReceived.bps);
      dlBytes = safeBytes(sumReceived.bytes);
      bytes = dlBytes;
      bitsPerSecond = safeNumber(sumReceived.bps);
      timing = pickTiming(sumReceived, stream, sum);
    } else if (sum) {
      dlMbps = bpsToMbps(sum.bits_per_second);
      dlBytes = safeBytes(sum.bytes);
      bytes = dlBytes;
      bitsPerSecond = safeNumber(sum.bits_per_second);
      timing = pickTiming(sum, stream);
    } else if (stream) {
      dlMbps = bpsToMbps(stream.bits_per_second);
      dlBytes = safeBytes(stream.bytes);
      bytes = dlBytes;
      bitsPerSecond = safeNumber(stream.bits_per_second);
      timing = pickTiming(stream);
    } else if (sumSent) {
      dlMbps = bpsToMbps(sumSent.bps);
      dlBytes = safeBytes(sumSent.bytes);
      bytes = dlBytes;
      bitsPerSecond = safeNumber(sumSent.bps);
      timing = pickTiming(sumSent);
    }
  } else {
    const sumSent = readStatsObject(item.sum_sent);
    const sumReceived = readStatsObject(item.sum_received);
    if (sumSent) {
      ulMbps = bpsToMbps(sumSent.bps);
      ulBytes = safeBytes(sumSent.bytes);
      bytes = ulBytes;
      bitsPerSecond = safeNumber(sumSent.bps);
      timing = pickTiming(sumSent, stream, sum);
    } else if (sum) {
      ulMbps = bpsToMbps(sum.bits_per_second);
      ulBytes = safeBytes(sum.bytes);
      bytes = ulBytes;
      bitsPerSecond = safeNumber(sum.bits_per_second);
      timing = pickTiming(sum, stream);
    } else if (stream) {
      ulMbps = bpsToMbps(stream.bits_per_second);
      ulBytes = safeBytes(stream.bytes);
      bytes = ulBytes;
      bitsPerSecond = safeNumber(stream.bits_per_second);
      timing = pickTiming(stream);
    } else if (sumReceived) {
      ulMbps = bpsToMbps(sumReceived.bps);
      ulBytes = safeBytes(sumReceived.bytes);
      bytes = ulBytes;
      bitsPerSecond = safeNumber(sumReceived.bps);
      timing = pickTiming(sumReceived);
    }
  }

  return {
    index: index + 1,
    start: timing.start,
    end: timing.end,
    seconds: timing.seconds,
    bytes,
    dlBytes,
    ulBytes,
    bitsPerSecond,
    dlMbps,
    ulMbps,
  };
}

export function mapIperf3NativeResult(nativeResult = {}, setup = {}) {
  const rawJson = readJsonFromNativeResult(nativeResult);
  const mapped = {
    ok: Boolean(nativeResult?.ok),
    status: nativeResult?.status || "error",
    message: nativeResult?.message || "",
    errorCode: nativeResult?.error_code || nativeResult?.errorCode || "",
    exitCode: nativeResult?.exit_code ?? nativeResult?.exitCode ?? null,
    stdout: nativeResult?.stdout || "",
    stderr: nativeResult?.stderr || "",
    command: nativeResult?.command || [],
    startedAt: nativeResult?.started_at_ms ?? nativeResult?.startedAt ?? null,
    endedAt: nativeResult?.ended_at_ms ?? nativeResult?.endedAt ?? null,
    elapsedMs: nativeResult?.elapsed_ms ?? nativeResult?.elapsedMs ?? null,
    dlMbps: null,
    ulMbps: null,
    dlBytes: null,
    ulBytes: null,
    intervalSamples: [],
    jsonParseFailed: false,
    source: nativeResult?.source || "native-iperf3-v1g4b",
    failureClass: nativeResult?.failure_class || nativeResult?.failureClass || "",
  };

  if (mapped.failureClass) {
    mapped.errorCode = mapped.errorCode || mapped.failureClass;
  }

  if (!rawJson) {
    if (String(nativeResult?.status || "").toLowerCase() === "timeout") {
      mapped.status = "incomplete";
      mapped.message = mapped.message || "iPerf3 process wait timed out before JSON output. Server connectivity was not confirmed.";
      mapped.errorCode = mapped.errorCode || "timeout";
      return mapped;
    }
    if (String(nativeResult?.stdout || "").trim() || nativeResult?.json_parse_warning) {
      mapped.jsonParseFailed = true;
      mapped.message = mapped.message || "iPerf3 JSON parse failed.";
    }
    mapped.status = mapped.status === "error" ? "incomplete" : mapped.status;
    return mapped;
  }

  const end = rawJson.end || {};
  const totals = mapDirectionTotals(setup, end);
  mapped.dlMbps = totals.dlMbps;
  mapped.ulMbps = totals.ulMbps;
  mapped.dlBytes = totals.dlBytes;
  mapped.ulBytes = totals.ulBytes;

  const intervals = Array.isArray(rawJson.intervals) ? rawJson.intervals : [];
  mapped.intervalSamples = intervals.map((item, index) => mapIntervalSample(setup, item, index));

  applyBidirResultPolicy(mapped, setup);

  // Prefer real iPerf JSON/text errors over generic exit-code fallbacks.
  // Public servers often put the failure only in stdout JSON: { "error": "..." }.
  if (!mapped.ok) {
    const jsonError = typeof rawJson.error === "string" ? rawJson.error.trim() : "";
    const stdoutHint = extractUsefulIperfLine(mapped.stdout);
    const stderrHint = extractUsefulIperfLine(mapped.stderr);
    const realError = jsonError || stderrHint || stdoutHint;
    const isGenericExit = !mapped.message
      || /^iPerf3 exited with code\b/i.test(mapped.message)
      || mapped.message === "iPerf3 iteration failed.";
    if (realError && (isGenericExit || !mapped.message)) {
      mapped.message = realError;
    } else if (!mapped.message) {
      mapped.message = `iPerf3 exited with code ${mapped.exitCode ?? "unknown"}.`;
    }
  }

  return mapped;
}

export function buildIperfIterationResult(iteration, mapped = {}, setup = {}, nativeResult = {}) {
  const elapsedMs = mapped.elapsedMs ?? (
    mapped.endedAt && mapped.startedAt ? mapped.endedAt - mapped.startedAt : null
  );
  const durationSeconds = safeNumber(setup.durationSeconds) ?? (
    elapsedMs !== null ? Math.round(elapsedMs / 1000) : null
  );
  const ok = mapped.ok === true && !mapped.bidirIncomplete;
  const status = mapped.ok
    ? (mapped.bidirIncomplete ? "partial" : "complete")
    : "incomplete";
  const classif = ok ? null : classifyIperfFailure(mapped.failureClass || mapped.message || mapped.errorCode || mapped.status || "");

  return {
    iteration,
    kind: "iteration",
    status,
    direction: setup.direction || "ul",
    dlMbps: mapped.dlMbps,
    ulMbps: mapped.ulMbps,
    dlBytes: mapped.dlBytes ?? null,
    ulBytes: mapped.ulBytes ?? null,
    dlMeasuredBytes: mapped.dlBytes ?? null,
    ulMeasuredBytes: mapped.ulBytes ?? null,
    source: mapped.source,
    startedAt: mapped.startedAt || Date.now(),
    endedAt: mapped.endedAt || Date.now(),
    durationSeconds,
    intervalSeconds: safeNumber(setup.intervalSeconds),
    warmupSeconds: safeNumber(setup.warmupSeconds),
    waitSeconds: safeNumber(setup.waitSeconds),
    intervalSamples: mapped.intervalSamples || [],
    exitCode: mapped.exitCode,
    stdout: mapped.stdout,
    stderr: mapped.stderr,
    command: mapped.command,
    message: mapped.message,
    // Canonical customer-facing failure fields (concise; raw stdout/stderr retained above).
    error: ok ? "" : (classif?.conciseReason || mapped.message || ""),
    errorMessage: ok ? "" : (classif?.conciseReason || mapped.message || ""),
    errorCode: ok ? "" : (classif?.errorCode || mapped.errorCode || ""),
    failureStage: ok ? null : (classif?.failureStage || null),
    conciseReason: ok ? null : (classif?.conciseReason || null),
    failureClass: ok ? null : (classif?.failureClass || mapped.failureClass || null),
    jsonParseFailed: mapped.jsonParseFailed === true,
    nativeStatus: nativeResult?.status || mapped.status,
  };
}
