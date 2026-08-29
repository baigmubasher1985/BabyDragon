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

function flattenEndStreams(streams = []) {
  const flat = [];
  for (const item of streams || []) {
    if (!item || typeof item !== "object") continue;
    if (item.bits_per_second !== undefined || item.bytes !== undefined) {
      flat.push(item);
      continue;
    }
    if (item.sender && typeof item.sender === "object" && item.sender !== true && item.sender !== false) {
      flat.push({ ...item.sender, sender: true, socket: item.sender.socket ?? item.socket });
    }
    if (item.receiver && typeof item.receiver === "object") {
      flat.push({ ...item.receiver, sender: false, socket: item.receiver.socket ?? item.socket });
    }
  }
  return flat;
}

function pickBidirReverseBlock(end = {}) {
  return end.sum_received_bidir_reverse
    || end.sum_sent_bidir_reverse
    || end.sum_received_other
    || end.sum_sent_other
    || end.sum_bidir_reverse
    || null;
}

/**
 * Bidirectional iPerf JSON: end.sum_sent / end.sum_received are the FORWARD
 * (client-send / UL) pair. True DL lives on the reverse connection:
 * sum_received_bidir_reverse / sum_sent_other / the other socket's receiver.
 */
function mapBidirEndTotals(end = {}) {
  const sumSent = end.sum_sent || null;
  const reverse = pickBidirReverseBlock(end);

  let ulMbps = sumSent ? bpsToMbps(sumSent.bits_per_second) : null;
  let ulBytes = sumSent ? safeBytes(sumSent.bytes) : null;
  let dlMbps = reverse ? bpsToMbps(reverse.bits_per_second) : null;
  let dlBytes = reverse ? safeBytes(reverse.bytes) : null;

  const streams = flattenEndStreams(Array.isArray(end.streams) ? end.streams : []);
  if ((dlMbps == null || ulMbps == null) && streams.length) {
    const bySocket = new Map();
    for (const stream of streams) {
      const socket = stream.socket != null ? String(stream.socket) : "_";
      if (!bySocket.has(socket)) bySocket.set(socket, []);
      bySocket.get(socket).push(stream);
    }
    const sockets = [...bySocket.keys()];
    if (sockets.length >= 2) {
      const ulSocket = sumSent?.socket != null ? String(sumSent.socket) : sockets[0];
      const dlSocket = sockets.find((id) => id !== ulSocket) || sockets[1];
      const ulStreams = bySocket.get(ulSocket) || [];
      const dlStreams = bySocket.get(dlSocket) || [];
      const ulSender = ulStreams.find((s) => s.sender === true) || ulStreams[0];
      const dlReceiver = dlStreams.find((s) => s.sender === false) || dlStreams.find((s) => s.sender === true) || dlStreams[0];
      if (ulMbps == null && ulSender) {
        ulMbps = bpsToMbps(ulSender.bits_per_second);
        ulBytes = safeBytes(ulSender.bytes);
      }
      if (dlMbps == null && dlReceiver) {
        dlMbps = bpsToMbps(dlReceiver.bits_per_second);
        dlBytes = safeBytes(dlReceiver.bytes);
      }
    }
  }

  return { dlMbps, ulMbps, dlBytes, ulBytes, isReverse: false, isBidir: true };
}

function mapDirectionTotals(setup = {}, end = {}) {
  const isReverse = setup.reverseMode === true;
  const isBidir = setup.bidirMode === true || wantsBidir(setup);
  const protocol = String(setup.protocol || "TCP").toUpperCase();
  const sumSent = end.sum_sent || null;
  const sumReceived = end.sum_received || null;
  const sum = end.sum || null;

  let dlMbps = null;
  let ulMbps = null;
  let dlBytes = null;
  let ulBytes = null;

  if (isBidir) {
    return mapBidirEndTotals(end);
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
      return { start, end, seconds: resolveIntervalDuration({ start, end, seconds }) };
    }
  }
  return { start: null, end: null, seconds: null };
}

/**
 * Prefer (end - start) when `seconds` looks like a cumulative end timestamp
 * rather than this interval's duration.
 */
export function resolveIntervalDuration(timing = {}) {
  const start = safeNumber(timing.start);
  const end = safeNumber(timing.end);
  const seconds = safeNumber(timing.seconds);
  if (start !== null && end !== null && end > start) {
    const span = end - start;
    if (seconds === null || seconds <= 0) return span;
    const looksLikeEndTimestamp = Math.abs(seconds - end) <= 0.51 && seconds > span * 1.2;
    if (looksLikeEndTimestamp) return span;
    return seconds;
  }
  return seconds;
}

export const CONTINUOUS_IPERF_AGGREGATION_RULE = [
  "Per-iteration DL/UL is the iPerf end-direction total for that iteration.",
  "Bidirectional: UL = client sum_sent; DL = reverse receiver (sum_received_bidir_reverse / other socket), never forward sum_received.",
  "When end totals omit the reverse direction, reconstruct from interval samples (unweighted mean of interval Mbps; bytes summed).",
  "Session headline is the arithmetic mean of completed iteration totals only.",
  "Warmup, wait-between-iterations, and retries are not extra throughput iterations.",
  "Failed or missing measurements stay null and evaluate INCOMPLETE — never numeric 0 Mbps FAIL.",
].join(" ");

export function aggregateDirectionFromIntervals(samples = []) {
  const list = Array.isArray(samples) ? samples : [];
  const dlValues = [];
  const ulValues = [];
  let dlBytes = 0;
  let ulBytes = 0;
  let hasDlBytes = false;
  let hasUlBytes = false;
  for (const sample of list) {
    const dl = safeNumber(sample?.dlMbps);
    const ul = safeNumber(sample?.ulMbps);
    if (dl !== null) dlValues.push(dl);
    if (ul !== null) ulValues.push(ul);
    const dlb = safeBytes(sample?.dlBytes);
    const ulb = safeBytes(sample?.ulBytes);
    if (dlb !== null) {
      dlBytes += dlb;
      hasDlBytes = true;
    }
    if (ulb !== null) {
      ulBytes += ulb;
      hasUlBytes = true;
    }
  }
  const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  return {
    dlMbps: safeMbps(mean(dlValues)),
    ulMbps: safeMbps(mean(ulValues)),
    dlBytes: hasDlBytes ? Math.round(dlBytes) : null,
    ulBytes: hasUlBytes ? Math.round(ulBytes) : null,
    intervalCount: list.length,
  };
}

export function aggregateCompletedIterationThroughput(iterations = []) {
  const rows = (Array.isArray(iterations) ? iterations : []).filter((row) => {
    const status = String(row?.status || "").toLowerCase();
    return status === "complete" || status === "completed" || status === "success" || status === "ok";
  });
  const mean = (key) => {
    const values = rows.map((row) => safeNumber(row?.[key])).filter((value) => value !== null);
    if (!values.length) return null;
    return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000;
  };
  return {
    avgDlMbps: mean("dlMbps"),
    avgUlMbps: mean("ulMbps"),
    completed: rows.length,
    rule: CONTINUOUS_IPERF_AGGREGATION_RULE,
  };
}

function reconcileBidirFromIntervals(mapped = {}, setup = {}) {
  if (!wantsBidir(setup)) return mapped;
  const fromIntervals = aggregateDirectionFromIntervals(mapped.intervalSamples || []);
  if (fromIntervals.dlMbps == null && fromIntervals.ulMbps == null) return mapped;

  const endDl = mapped.dlMbps;
  const intervalDl = fromIntervals.dlMbps;
  const looksLikeForwardReceiverAsDl = intervalDl != null && (
    endDl == null
    || (intervalDl > endDl * 1.25 && (intervalDl - endDl) >= 0.5)
  );
  if (looksLikeForwardReceiverAsDl) {
    mapped.dlMbps = fromIntervals.dlMbps;
    if (fromIntervals.dlBytes != null) mapped.dlBytes = fromIntervals.dlBytes;
    mapped.throughputSource = "interval_reconciled_bidir";
  }
  if (mapped.ulMbps == null && fromIntervals.ulMbps != null) {
    mapped.ulMbps = fromIntervals.ulMbps;
    if (fromIntervals.ulBytes != null) mapped.ulBytes = fromIntervals.ulBytes;
  }
  return mapped;
}

export function reconcileIperfSessionThroughput(session = {}) {
  const rows = Array.isArray(session.appIterationResults) ? session.appIterationResults : [];
  const nextRows = rows.map((row) => {
    const samples = Array.isArray(row.intervalSamples) ? row.intervalSamples : [];
    if (!samples.length) return row;
    const fromIntervals = aggregateDirectionFromIntervals(samples);
    const endDl = safeNumber(row.dlMbps);
    const intervalDl = fromIntervals.dlMbps;
    if (intervalDl == null) return row;
    if (endDl != null && !(intervalDl > endDl * 1.25 && (intervalDl - endDl) >= 0.5)) return row;
    return {
      ...row,
      dlMbps: fromIntervals.dlMbps,
      ulMbps: fromIntervals.ulMbps ?? row.ulMbps,
      dlBytes: fromIntervals.dlBytes ?? row.dlBytes,
      ulBytes: fromIntervals.ulBytes ?? row.ulBytes,
      dlMeasuredBytes: fromIntervals.dlBytes ?? row.dlMeasuredBytes,
      ulMeasuredBytes: fromIntervals.ulBytes ?? row.ulMeasuredBytes,
      throughputSource: "interval_reconciled_bidir",
    };
  });
  const summary = aggregateCompletedIterationThroughput(nextRows);
  return {
    ...session,
    appIterationResults: nextRows,
    appDlMbps: summary.avgDlMbps,
    appUlMbps: summary.avgUlMbps,
    iperfAggregationRule: CONTINUOUS_IPERF_AGGREGATION_RULE,
  };
}

export function attachIperfExportIntervals(session = {}, iperfJson = {}) {
  const intervals = Array.isArray(iperfJson?.intervals) ? iperfJson.intervals : [];
  if (!intervals.length) return session;
  const byIter = new Map();
  for (const row of intervals) {
    const n = Number(row.iteration);
    if (!Number.isFinite(n)) continue;
    if (!byIter.has(n)) byIter.set(n, []);
    byIter.get(n).push({
      index: row.interval ?? row.intervalIndex,
      seconds: row.seconds,
      dlMbps: row.dlMbps,
      ulMbps: row.ulMbps,
      dlBytes: row.dlBytes,
      ulBytes: row.ulBytes,
    });
  }
  const rows = (Array.isArray(session.appIterationResults) ? session.appIterationResults : []).map((row) => {
    const samples = Array.isArray(row.intervalSamples) && row.intervalSamples.length
      ? row.intervalSamples
      : (byIter.get(Number(row.iteration)) || []);
    return samples.length ? { ...row, intervalSamples: samples } : row;
  });
  return reconcileIperfSessionThroughput({ ...session, appIterationResults: rows });
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
  reconcileBidirFromIntervals(mapped, setup);

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
