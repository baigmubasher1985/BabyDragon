/**
 * BabyDragon-observed TrafficStats warmup estimates for OOKLA evidence reports.
 * Not official OOKLA internal warmup values.
 *
 * Uses Android Total TrafficStats byte deltas around the OOKLA result timestamp.
 */

import { parseOoklaCsvDateLocal } from "./ooklaCsvImport.js";

export const DEFAULT_KPI_WARMUP_DURATION_SEC = 3;
export const TRAFFICSTATS_WARMUP_SOURCE = "total_device_trafficstats";
export const TRAFFICSTATS_WARMUP_RULE =
  "Estimated from Android Total TrafficStats byte deltas around OOKLA result timestamp. Total counters include Wi-Fi + mobile + other device traffic. This is BabyDragon-observed device traffic, not official OOKLA internal warmup.";

const LOOKBACK_MS = 90_000;
const LOOKAHEAD_EXACT_MS = 30_000;
const LOOKAHEAD_MINUTE_MS = 90_000;
const MAX_SAMPLE_GAP_MS = 2_500;
const ACTIVE_BYTES_THRESHOLD = 8_192;
/** Keep above ambient chatter (e.g. ~0.06 Mbps ACK/control during DL). */
const ACTIVE_MBPS_THRESHOLD = 0.25;
const UL_PAIR_PRE_MS = 5_000;
const UL_PAIR_POST_MS = 60_000;

function toFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function toEpochMs(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value).trim();
  if (!text) return null;

  // True UTC / offset ISO must use Date.parse — do not force local calendar fields.
  if (/^\d{4}-\d{2}-\d{2}T/.test(text) && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const utc = Date.parse(text);
    if (Number.isFinite(utc)) return utc;
  }
  if (/^\d+$/.test(text)) {
    const asNumber = Number(text);
    if (Number.isFinite(asNumber)) return asNumber;
  }

  // Ookla/CSV/OCR local wall-clock strings (M/D/YYYY h:mm AM/PM, etc.).
  const local = parseOoklaCsvDateLocal(text);
  if (Number.isFinite(local?.ms)) return local.ms;

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Minute-level OCR/CSV timestamps lack trustworthy seconds.
 * Examples: "7/23/2026, 2:38 PM", "7/23/2026 2:38:00 PM"
 */
export function isMinuteLevelOoklaTimestamp(value) {
  if (value === null || value === undefined || value === "") return false;
  if (typeof value === "number" && Number.isFinite(value)) return false;
  const text = String(value).trim();
  if (!text) return false;

  // Exact ISO with timezone / offset → keep tight window (real device clock).
  if (/^\d{4}-\d{2}-\d{2}T/.test(text) && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    return false;
  }

  // M/D/YYYY with time but no seconds: "7/23/2026, 2:38 PM"
  if (
    /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(text)
    && /\d{1,2}:\d{2}/.test(text)
    && !/\d{1,2}:\d{2}:\d{2}/.test(text)
  ) {
    return true;
  }

  // Seconds present but only defaulted to :00
  if (
    /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(text)
    && /\d{1,2}:\d{2}:00\b/.test(text)
    && !/\d{1,2}:\d{2}:00\.\d*[1-9]/.test(text)
  ) {
    return true;
  }

  // Local ISO-like without offset, minute or :00 only
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(text)) return true;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:00$/.test(text)) return true;

  return false;
}

function toIso(ms) {
  const number = toFiniteNumber(ms);
  if (number === null) return null;
  return new Date(number).toISOString();
}

function safeMbps(bytes, seconds) {
  if (!Number.isFinite(bytes) || !Number.isFinite(seconds) || seconds <= 0) return null;
  const mbps = (bytes * 8) / seconds / 1_000_000;
  if (!Number.isFinite(mbps) || mbps < 0) return null;
  return Number(mbps.toFixed(4));
}

function emptyDirectionEstimate() {
  return {
    burstStart: null,
    burstEnd: null,
    warmupSec: null,
    warmupBytes: null,
    warmupMbps: null,
    measuredSec: null,
    measuredBytes: null,
    measuredMbps: null,
  };
}

function emptyWarmupEstimate(status, kpiWarmupDurationSec, confidence = null) {
  return {
    source: TRAFFICSTATS_WARMUP_SOURCE,
    rule: TRAFFICSTATS_WARMUP_RULE,
    status,
    confidence,
    kpiWarmupDurationSec,
    note: TRAFFICSTATS_WARMUP_RULE,
    minuteLevelAnchor: false,
    searchLookaheadSec: LOOKAHEAD_EXACT_MS / 1000,
    dl: emptyDirectionEstimate(),
    ul: emptyDirectionEstimate(),
  };
}

export function resolveKpiWarmupDurationSec(session = {}, fallback = DEFAULT_KPI_WARMUP_DURATION_SEC) {
  const candidates = [
    session?.kpiWarmupDurationSec,
    session?.appWarmupSeconds,
    session?.appSetupSnapshot?.warmupSeconds,
  ];
  for (const value of candidates) {
    const number = toFiniteNumber(value);
    if (number !== null && number >= 0 && number <= 30) return number;
  }
  const defaultValue = toFiniteNumber(fallback);
  return defaultValue !== null && defaultValue >= 0 ? defaultValue : DEFAULT_KPI_WARMUP_DURATION_SEC;
}

export function resolveOoklaIterationTimestampMs(iteration = {}, session = {}) {
  return resolveOoklaAnchor(iteration, session).ms;
}

/**
 * Resolve OOKLA iteration anchor + whether the primary timestamp is minute-level.
 * Prefer ooklaDateTime / testDateTime for minute-level detection.
 */
export function resolveOoklaAnchor(iteration = {}, session = {}) {
  const primaryCandidates = [
    iteration?.ooklaDateTime,
    iteration?.testDateTime,
  ];
  for (const value of primaryCandidates) {
    const ms = toEpochMs(value);
    if (ms !== null) {
      return {
        ms,
        minuteLevel: isMinuteLevelOoklaTimestamp(value),
        sourceText: value,
      };
    }
  }

  const fallbackCandidates = [
    iteration?.savedAt,
    iteration?.capturedAt,
    iteration?.feConfirmedAt,
    session?.endedAt,
    session?.startedAt,
  ];
  for (const value of fallbackCandidates) {
    const ms = toEpochMs(value);
    if (ms !== null) {
      return {
        ms,
        minuteLevel: isMinuteLevelOoklaTimestamp(value),
        sourceText: value,
      };
    }
  }
  return { ms: null, minuteLevel: false, sourceText: null };
}

function isActiveSample(sample = {}) {
  if (sample.recordState === "paused") return false;
  return sample.recorded !== false;
}

function readTotalStats(sample = {}) {
  const stats = sample?.trafficStats && typeof sample.trafficStats === "object"
    ? sample.trafficStats
    : {};
  const totalRxAbs = toFiniteNumber(
    stats.trafficStatsTotalRxBytes ?? stats.traffic_stats_total_rx_bytes,
  );
  const totalTxAbs = toFiniteNumber(
    stats.trafficStatsTotalTxBytes ?? stats.traffic_stats_total_tx_bytes,
  );
  const deltaRx = toFiniteNumber(
    stats.trafficStatsTotalDeltaRxBytes ?? stats.traffic_stats_total_delta_rx_bytes,
  );
  const deltaTx = toFiniteNumber(
    stats.trafficStatsTotalDeltaTxBytes ?? stats.traffic_stats_total_delta_tx_bytes,
  );
  const dlMbps = toFiniteNumber(
    stats.trafficStatsTotalDlMbps ?? stats.traffic_stats_total_dl_mbps,
  );
  const ulMbps = toFiniteNumber(
    stats.trafficStatsTotalUlMbps ?? stats.traffic_stats_total_ul_mbps,
  );
  const deltaSec = toFiniteNumber(
    stats.trafficStatsDeltaSec ?? stats.traffic_stats_delta_sec,
  );
  const counterReset = stats.trafficStatsCounterReset === true
    || stats.traffic_stats_counter_reset === true
    || stats.traffic_stats_counter_reset === "yes";
  const totalSupported = stats.trafficStatsTotalSupported === true
    || totalRxAbs !== null
    || totalTxAbs !== null
    || deltaRx !== null
    || deltaTx !== null;

  return {
    totalSupported,
    totalRxAbs,
    totalTxAbs,
    deltaRx,
    deltaTx,
    dlMbps,
    ulMbps,
    deltaSec,
    counterReset,
  };
}

function sampleTimestampMs(sample = {}) {
  const direct = toFiniteNumber(sample?.timestamp ?? sample?.timestampMs);
  if (direct !== null) return direct;
  return toEpochMs(sample?.isoTime || sample?.timestamp_iso || sample?.timestampIso || null);
}

function buildTotalIntervalSeries(samples = []) {
  const series = [];
  let prev = null;

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const timestamp = sampleTimestampMs(sample);
    if (timestamp === null) continue;

    const stats = readTotalStats(sample);
    if (!stats.totalSupported) {
      prev = { timestamp, stats };
      continue;
    }

    let deltaSec = stats.deltaSec;
    if (deltaSec === null && prev?.timestamp != null) {
      deltaSec = (timestamp - prev.timestamp) / 1000;
    }
    if (!Number.isFinite(deltaSec) || deltaSec <= 0 || deltaSec > 10) {
      prev = { timestamp, stats };
      continue;
    }

    let deltaRx = stats.deltaRx;
    let deltaTx = stats.deltaTx;
    // Prefer stored deltas; fall back to absolute Total counter diffs even after a reset flag.
    if ((deltaRx === null || stats.counterReset) && prev?.stats?.totalRxAbs != null && stats.totalRxAbs != null) {
      const diff = stats.totalRxAbs - prev.stats.totalRxAbs;
      if (diff >= 0) deltaRx = diff;
    }
    if ((deltaTx === null || stats.counterReset) && prev?.stats?.totalTxAbs != null && stats.totalTxAbs != null) {
      const diff = stats.totalTxAbs - prev.stats.totalTxAbs;
      if (diff >= 0) deltaTx = diff;
    }

    // Skip only when this sample has no usable Total RX/TX delta at all.
    if (deltaRx === null && deltaTx === null && stats.dlMbps === null && stats.ulMbps === null) {
      prev = { timestamp, stats };
      continue;
    }

    const dlMbps = stats.dlMbps !== null ? stats.dlMbps : safeMbps(deltaRx ?? 0, deltaSec);
    const ulMbps = stats.ulMbps !== null ? stats.ulMbps : safeMbps(deltaTx ?? 0, deltaSec);

    series.push({
      index,
      timestamp,
      startMs: timestamp - (deltaSec * 1000),
      endMs: timestamp,
      deltaSec,
      deltaRxBytes: deltaRx,
      deltaTxBytes: deltaTx,
      dlMbps,
      ulMbps,
    });
    prev = { timestamp, stats };
  }

  return series;
}

function isDirectionActive(interval, direction) {
  const bytes = direction === "ul" ? interval.deltaTxBytes : interval.deltaRxBytes;
  const mbps = direction === "ul" ? interval.ulMbps : interval.dlMbps;
  const bytesOk = Number.isFinite(bytes) && bytes > ACTIVE_BYTES_THRESHOLD;
  const mbpsOk = Number.isFinite(mbps) && mbps > ACTIVE_MBPS_THRESHOLD;
  if (bytesOk) return true;
  if (mbpsOk && (!Number.isFinite(bytes) || bytes > (ACTIVE_BYTES_THRESHOLD / 2))) return true;
  return false;
}

function isSignificantBurst(burst) {
  if (!burst || !burst.intervals?.length) return false;
  return burst.totalBytes >= 64_000 || burst.peakMbps >= 0.25;
}

function groupBursts(series = [], direction = "dl", windowStartMs, windowEndMs) {
  const inWindow = series.filter((item) => (
    item.endMs >= windowStartMs && item.startMs <= windowEndMs
  ));
  const bursts = [];
  let current = null;

  inWindow.forEach((item) => {
    const active = isDirectionActive(item, direction);
    if (!active) {
      current = null;
      return;
    }
    const bytes = direction === "ul" ? (item.deltaTxBytes || 0) : (item.deltaRxBytes || 0);
    const mbps = direction === "ul" ? (item.ulMbps || 0) : (item.dlMbps || 0);

    if (current && (item.startMs - current.endMs) <= MAX_SAMPLE_GAP_MS) {
      current.intervals.push({
        ...item,
        deltaBytes: bytes,
        mbps,
      });
      current.endMs = item.endMs;
      current.totalBytes += Math.max(0, bytes);
      current.peakMbps = Math.max(current.peakMbps, mbps || 0);
    } else {
      current = {
        intervals: [{
          ...item,
          deltaBytes: bytes,
          mbps,
        }],
        startMs: item.startMs,
        endMs: item.endMs,
        totalBytes: Math.max(0, bytes),
        peakMbps: mbps || 0,
      };
      bursts.push(current);
    }
  });

  return bursts.filter((burst) => isSignificantBurst(burst));
}

function burstKey(direction, burst) {
  if (!burst) return null;
  return `${direction}:${burst.startMs}:${burst.endMs}`;
}

/**
 * Largest Total TrafficStats burst first; distance to anchor is tie-breaker only.
 */
function pickBestBurst(bursts = [], anchorMs, {
  direction = "dl",
  reservedBurstKeys = null,
} = {}) {
  if (!bursts.length) return { burst: null, ambiguous: false, reusedReserved: false };

  const reserved = reservedBurstKeys instanceof Set ? reservedBurstKeys : null;
  const available = reserved
    ? bursts.filter((burst) => !reserved.has(burstKey(direction, burst)))
    : bursts;
  // Prefer unused bursts; only reuse if no safer unused match exists.
  const pool = available.length ? available : bursts;
  const reusedReserved = Boolean(reserved && available.length === 0 && pool.length);

  const scored = pool.map((burst) => {
    const mid = (burst.startMs + burst.endMs) / 2;
    const distance = Math.abs(mid - anchorMs);
    const overlapsAnchor = anchorMs >= burst.startMs && anchorMs <= burst.endMs;
    return { burst, distance, overlapsAnchor };
  });

  scored.sort((a, b) => {
    // Prefer OOKLA-scale peaks (e.g. 1000+ Mbps DL) over tiny chatter even if bytes are close.
    const aPeak = a.burst.peakMbps || 0;
    const bPeak = b.burst.peakMbps || 0;
    const aOoklaLike = aPeak >= 50 ? 1 : 0;
    const bOoklaLike = bPeak >= 50 ? 1 : 0;
    if (bOoklaLike !== aOoklaLike) return bOoklaLike - aOoklaLike;
    if (b.burst.totalBytes !== a.burst.totalBytes) {
      return b.burst.totalBytes - a.burst.totalBytes;
    }
    if (bPeak !== aPeak) return bPeak - aPeak;
    return a.distance - b.distance;
  });

  const best = scored[0];
  const second = scored[1] || null;
  let ambiguous = false;
  if (second) {
    const bestPeak = best.burst.peakMbps || 0;
    const secondPeak = second.burst.peakMbps || 0;
    // Clear winner by peak (real OOKLA DL vs noise) is never ambiguous.
    if (!(bestPeak >= 50 && secondPeak < 20) && !(bestPeak >= (secondPeak * 3))) {
      const bytesDiff = Math.abs(best.burst.totalBytes - second.burst.totalBytes);
      const larger = Math.max(best.burst.totalBytes, second.burst.totalBytes) || 1;
      const similarBytes = (bytesDiff / larger) <= 0.15;
      const bothNear = best.distance <= 45_000 && second.distance <= 45_000;
      const distanceGap = Math.abs(best.distance - second.distance);
      ambiguous = similarBytes && bothNear && distanceGap <= 15_000;
    }
  }

  return {
    burst: {
      ...best.burst,
      burstSec: Math.max(0, (best.burst.endMs - best.burst.startMs) / 1000),
      distanceToAnchorMs: best.distance,
      overlapsAnchor: best.overlapsAnchor,
    },
    // Ambiguous only lowers confidence — never discard the largest burst.
    ambiguous,
    reusedReserved,
  };
}

function splitWarmupMeasured(burst, warmupSec) {
  if (!burst?.intervals?.length) return emptyDirectionEstimate();

  let remainingWarmup = Math.max(0, warmupSec);
  let warmupBytes = 0;
  let warmupSecAccum = 0;
  let measuredBytes = 0;
  let measuredSecAccum = 0;

  burst.intervals.forEach((interval) => {
    let secondsLeft = Number(interval.deltaSec) || 0;
    let bytesLeft = Math.max(0, Number(interval.deltaBytes) || 0);
    const bytesPerSec = secondsLeft > 0 ? (bytesLeft / secondsLeft) : 0;

    if (remainingWarmup > 0 && secondsLeft > 0) {
      const takeSec = Math.min(remainingWarmup, secondsLeft);
      const takeBytes = bytesPerSec * takeSec;
      warmupSecAccum += takeSec;
      warmupBytes += takeBytes;
      remainingWarmup -= takeSec;
      secondsLeft -= takeSec;
      bytesLeft = Math.max(0, bytesLeft - takeBytes);
    }

    if (secondsLeft > 0) {
      measuredSecAccum += secondsLeft;
      measuredBytes += bytesLeft;
    }
  });

  const warmupSecOut = warmupSecAccum > 0 ? Number(warmupSecAccum.toFixed(3)) : null;
  const measuredSecOut = measuredSecAccum > 0
    ? Number(measuredSecAccum.toFixed(3))
    : (warmupSecOut !== null ? 0 : null);
  const measuredBytesOut = measuredSecAccum > 0
    ? Math.round(measuredBytes)
    : (warmupSecOut !== null ? 0 : null);

  return {
    burstStart: toIso(burst.startMs),
    burstEnd: toIso(burst.endMs),
    warmupSec: warmupSecOut,
    warmupBytes: Number.isFinite(warmupBytes) ? Math.round(warmupBytes) : null,
    warmupMbps: safeMbps(warmupBytes, warmupSecAccum),
    measuredSec: measuredSecOut,
    measuredBytes: measuredBytesOut,
    measuredMbps: measuredSecAccum > 0 ? safeMbps(measuredBytes, measuredSecAccum) : null,
  };
}

function confidenceForBurst(burst, anchorMs, minuteLevel) {
  if (!burst) return null;
  const distanceSec = Math.abs((burst.distanceToAnchorMs ?? Math.abs(((burst.startMs + burst.endMs) / 2) - anchorMs))) / 1000;
  const strong = burst.totalBytes >= 500_000 || burst.peakMbps >= 1;
  const longEnough = burst.burstSec >= 2;
  const nearLimit = minuteLevel ? 60 : 30;
  if ((burst.overlapsAnchor || distanceSec <= 5) && strong && longEnough) return "high";
  if (distanceSec <= nearLimit && (strong || longEnough)) return "medium";
  return "low";
}

function directionStatus(estimate, warmupSec) {
  if (!estimate || estimate.warmupSec === null) return null;
  if (estimate.measuredSec === 0 || (estimate.measuredSec === null && estimate.warmupSec > 0)) {
    if (estimate.warmupSec > 0 && estimate.warmupSec <= warmupSec + 0.05) {
      return "warmup_only_burst";
    }
  }
  return "estimated";
}

function claimBurst(reservedBurstKeys, direction, burst) {
  if (!(reservedBurstKeys instanceof Set) || !burst) return;
  const key = burstKey(direction, burst);
  if (key) reservedBurstKeys.add(key);
}

/**
 * Estimate DL/UL warmup vs measured periods from Total TrafficStats around an OOKLA iteration.
 * options.reservedBurstKeys: Set mutated to avoid reuse across Result IDs when possible.
 */
export function estimateOoklaTrafficStatsWarmup(session = {}, iteration = {}, options = {}) {
  const kpiWarmupDurationSec = resolveKpiWarmupDurationSec(
    { ...session, kpiWarmupDurationSec: options.kpiWarmupDurationSec ?? session?.kpiWarmupDurationSec },
    DEFAULT_KPI_WARMUP_DURATION_SEC,
  );
  const reservedBurstKeys = options.reservedBurstKeys instanceof Set
    ? options.reservedBurstKeys
    : null;

  const samples = (session.exportSamples || session.traceSamples || []).filter(isActiveSample);
  if (!samples.length) {
    return emptyWarmupEstimate("insufficient_trafficstats_samples", kpiWarmupDurationSec);
  }

  const sorted = [...samples].sort((a, b) => (
    (sampleTimestampMs(a) || 0) - (sampleTimestampMs(b) || 0)
  ));
  const series = buildTotalIntervalSeries(sorted);
  if (!series.length) {
    return emptyWarmupEstimate("insufficient_trafficstats_samples", kpiWarmupDurationSec);
  }

  const hasAnyTotalBytes = series.some((item) => (
    (Number.isFinite(item.deltaRxBytes) && item.deltaRxBytes >= 0)
    || (Number.isFinite(item.deltaTxBytes) && item.deltaTxBytes >= 0)
    || Number.isFinite(item.dlMbps)
    || Number.isFinite(item.ulMbps)
  ));
  if (!hasAnyTotalBytes) {
    return emptyWarmupEstimate("trafficstats_unsupported", kpiWarmupDurationSec);
  }

  const anchor = resolveOoklaAnchor(iteration, session);
  const targetMs = anchor.ms;
  if (!Number.isFinite(targetMs)) {
    return emptyWarmupEstimate("insufficient_trafficstats_samples", kpiWarmupDurationSec);
  }

  const minuteLevel = Boolean(anchor.minuteLevel);
  const lookaheadMs = minuteLevel ? LOOKAHEAD_MINUTE_MS : LOOKAHEAD_EXACT_MS;
  const windowStart = targetMs - LOOKBACK_MS;
  const windowEnd = targetMs + lookaheadMs;

  const dlCandidates = groupBursts(series, "dl", windowStart, windowEnd);
  const dlPick = pickBestBurst(dlCandidates, targetMs, {
    direction: "dl",
    reservedBurstKeys,
  });
  const dlBurst = dlPick.burst;

  // Prefer UL burst paired after the chosen DL burst (OOKLA: DL then UL).
  let ulCandidates = groupBursts(series, "ul", windowStart, windowEnd);
  if (dlBurst) {
    const pairStart = dlBurst.startMs - UL_PAIR_PRE_MS;
    const pairEnd = dlBurst.endMs + UL_PAIR_POST_MS;
    const paired = groupBursts(series, "ul", pairStart, pairEnd);
    if (paired.length) ulCandidates = paired;
  }

  const ulPick = pickBestBurst(ulCandidates, targetMs, {
    direction: "ul",
    reservedBurstKeys,
  });
  const ulBurst = ulPick.burst;

  // Always keep the largest selected burst. Ambiguous only downgrades confidence.
  const dl = dlBurst ? splitWarmupMeasured(dlBurst, kpiWarmupDurationSec) : emptyDirectionEstimate();
  const ul = ulBurst ? splitWarmupMeasured(ulBurst, kpiWarmupDurationSec) : emptyDirectionEstimate();

  const dlSide = directionStatus(dl, kpiWarmupDurationSec);
  const ulSide = directionStatus(ul, kpiWarmupDurationSec);
  const dlOk = dlSide !== null;
  const ulOk = ulSide !== null;

  let status = "no_clear_burst_detected";
  if (dlOk && ulOk) {
    status = (dlSide === "warmup_only_burst" && ulSide === "warmup_only_burst")
      ? "warmup_only_burst"
      : "estimated";
  } else if (dlOk && !ulOk) {
    status = dlSide === "warmup_only_burst" ? "warmup_only_burst" : "estimated_dl_only";
  } else if (!dlOk && ulOk) {
    status = ulSide === "warmup_only_burst" ? "warmup_only_burst" : "estimated_ul_only";
  }

  if (dlOk) claimBurst(reservedBurstKeys, "dl", dlBurst);
  if (ulOk) claimBurst(reservedBurstKeys, "ul", ulBurst);

  const confidences = [
    dlOk ? confidenceForBurst(dlBurst, targetMs, minuteLevel) : null,
    ulOk ? confidenceForBurst(ulBurst, targetMs, minuteLevel) : null,
  ].filter(Boolean);
  const confidenceRank = { high: 3, medium: 2, low: 1 };
  let confidence = null;
  if (confidences.length) {
    confidence = confidences.reduce((worst, item) => (
      (confidenceRank[item] || 0) < (confidenceRank[worst] || 0) ? item : worst
    ));
  }
  if ((dlPick.ambiguous || ulPick.ambiguous) && confidence === "high") {
    confidence = "medium";
  }
  if ((dlPick.ambiguous && ulPick.ambiguous) && !confidence) {
    confidence = "low";
  }

  return {
    source: TRAFFICSTATS_WARMUP_SOURCE,
    rule: TRAFFICSTATS_WARMUP_RULE,
    status,
    confidence,
    kpiWarmupDurationSec,
    note: TRAFFICSTATS_WARMUP_RULE,
    minuteLevelAnchor: minuteLevel,
    searchLookaheadSec: lookaheadMs / 1000,
    dl: dlOk ? dl : emptyDirectionEstimate(),
    ul: ulOk ? ul : emptyDirectionEstimate(),
  };
}

/** Exportable OOKLA rows must have both DL and UL Mbps. */
export function isExportableOoklaIteration(item = {}) {
  const dl = toFiniteNumber(item?.dlMbps);
  const ul = toFiniteNumber(item?.ulMbps);
  return dl !== null && ul !== null;
}

/**
 * Assign warmup estimates across many OOKLA iterations without reusing the same
 * DL/UL burst for different Result IDs when a safer unused burst exists.
 * Empty rows (no DL/UL) are excluded and never get a warmup estimate.
 */
export function assignOoklaTrafficStatsWarmupEstimates(session = {}, iterations = [], options = {}) {
  const reservedBurstKeys = options.reservedBurstKeys instanceof Set
    ? options.reservedBurstKeys
    : new Set();
  const kpiWarmupDurationSec = resolveKpiWarmupDurationSec(
    { ...session, kpiWarmupDurationSec: options.kpiWarmupDurationSec ?? session?.kpiWarmupDurationSec },
    DEFAULT_KPI_WARMUP_DURATION_SEC,
  );

  return (iterations || [])
    .filter((item) => isExportableOoklaIteration(item))
    .map((item, index) => ({
      ...item,
      iterationNumber: item.iterationNumber ?? (index + 1),
      trafficStatsWarmupEstimate: estimateOoklaTrafficStatsWarmup(session, item, {
        ...options,
        kpiWarmupDurationSec,
        reservedBurstKeys,
      }),
    }));
}

export function flattenWarmupEstimateForCsv(estimate = {}) {
  const dl = estimate.dl || emptyDirectionEstimate();
  const ul = estimate.ul || emptyDirectionEstimate();
  return {
    kpi_warmup_duration_sec: estimate.kpiWarmupDurationSec ?? null,
    trafficstats_warmup_source: estimate.source || TRAFFICSTATS_WARMUP_SOURCE,
    trafficstats_warmup_rule: estimate.rule || TRAFFICSTATS_WARMUP_RULE,
    trafficstats_warmup_status: estimate.status || null,
    trafficstats_warmup_confidence: estimate.confidence || null,
    trafficstats_dl_burst_start: dl.burstStart,
    trafficstats_dl_burst_end: dl.burstEnd,
    trafficstats_dl_warmup_sec: dl.warmupSec,
    trafficstats_dl_warmup_bytes: dl.warmupBytes,
    trafficstats_dl_warmup_mbps: dl.warmupMbps,
    trafficstats_dl_measured_sec: dl.measuredSec,
    trafficstats_dl_measured_bytes: dl.measuredBytes,
    trafficstats_dl_measured_mbps: dl.measuredMbps,
    trafficstats_ul_burst_start: ul.burstStart,
    trafficstats_ul_burst_end: ul.burstEnd,
    trafficstats_ul_warmup_sec: ul.warmupSec,
    trafficstats_ul_warmup_bytes: ul.warmupBytes,
    trafficstats_ul_warmup_mbps: ul.warmupMbps,
    trafficstats_ul_measured_sec: ul.measuredSec,
    trafficstats_ul_measured_bytes: ul.measuredBytes,
    trafficstats_ul_measured_mbps: ul.measuredMbps,
  };
}
