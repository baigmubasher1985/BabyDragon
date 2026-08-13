/**
 * BabyDragon RF / data / evidence event detector for Excel Plot Report.
 * Inferred events are labeled carefully — never claim confirmed HO without Android evidence.
 */

import { classifyNativeHttpFailure, classifyFtpFailure } from "../reports/dataTestOutcome.js";

function getNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return null;
}

function toIso(ms) {
  const n = getNumber(ms);
  if (n === null) return null;
  try {
    const d = new Date(n);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function elapsedSec(ms, sessionStartMs) {
  const t = getNumber(ms);
  const start = getNumber(sessionStartMs);
  if (t === null || start === null) return null;
  return Number(((t - start) / 1000).toFixed(3));
}

function sampleFields(sample = {}) {
  const snap = sample.snapshot || {};
  const serving = snap.serving && typeof snap.serving === "object" ? snap.serving : {};
  const lte = snap.lteAnchor && typeof snap.lteAnchor === "object"
    ? snap.lteAnchor
    : (String(serving.rat || "").toUpperCase() === "LTE" ? serving : {});
  const nr = snap.nrSecondary && typeof snap.nrSecondary === "object" ? snap.nrSecondary : {};
  const threeG = snap.wcdma || snap.umts || (String(serving.rat || "").toUpperCase().includes("WCDMA") ? serving : {});
  const twoG = snap.gsm || (String(serving.rat || "").toUpperCase() === "GSM" ? serving : {});
  const rat = cleanText(snap.currentRatName || serving.technology || snap.dataNetworkTypeName);
  const pci = getNumber(lte.pci) ?? getNumber(nr.pci) ?? getNumber(threeG.psc);
  const channel = getNumber(lte.earfcn ?? lte.channel)
    ?? getNumber(nr.nrarfcn ?? nr.channel)
    ?? getNumber(threeG.uarfcn ?? threeG.channel)
    ?? getNumber(twoG.arfcn ?? twoG.channel);
  const cellId = getNumber(lte.cellId ?? lte.ci)
    ?? getNumber(nr.nci ?? nr.cellId)
    ?? getNumber(threeG.cellId ?? threeG.cid)
    ?? getNumber(twoG.cellId ?? twoG.cid);
  return {
    timestamp: getNumber(sample.timestamp),
    rat,
    pci,
    channel,
    cellId,
    tac: getNumber(lte.tac) ?? getNumber(nr.tac) ?? getNumber(threeG.lac ?? threeG.tac) ?? getNumber(twoG.lac),
    psc: getNumber(threeG.psc),
    bsic: getNumber(twoG.bsic),
    earfcn: getNumber(lte.earfcn ?? lte.channel),
    nrarfcn: getNumber(nr.nrarfcn ?? nr.channel),
    uarfcn: getNumber(threeG.uarfcn ?? threeG.channel),
    arfcn: getNumber(twoG.arfcn ?? twoG.channel),
    nci: getNumber(nr.nci ?? nr.cellId),
    nrStatus: cleanText(snap.nrSecondaryStatus),
    dataNetworkTypeName: cleanText(snap.dataNetworkTypeName),
    gpsLat: getNumber(sample.gps?.lat),
    gpsLon: getNumber(sample.gps?.lng),
    recordState: cleanText(sample.recordState) || "active",
    callState: cleanText(snap.callState),
    trafficReset: sample.trafficStats?.trafficStatsCounterReset === true
      || sample.trafficStats?.counterReset === true,
    dlMbps: getNumber(sample.trafficStats?.trafficStatsDlMbps),
    ulMbps: getNumber(sample.trafficStats?.trafficStatsUlMbps),
  };
}

function makeEvent(partial, sessionStartMs, seq) {
  const ts = getNumber(partial.timestampMs);
  const gpsLat = getNumber(partial.mapLat ?? partial.gpsLat);
  const gpsLon = getNumber(partial.mapLon ?? partial.gpsLon);
  const hasDirectGps = gpsLat !== null && gpsLon !== null
    && gpsLat >= -90 && gpsLat <= 90 && gpsLon >= -180 && gpsLon <= 180
    && !(gpsLat === 0 && gpsLon === 0);
  return {
    eventId: partial.eventId || `evt_${String(seq).padStart(4, "0")}`,
    timestampIso: toIso(ts) || partial.timestampIso || null,
    elapsedSec: elapsedSec(ts, sessionStartMs),
    category: partial.category || "session",
    eventType: partial.eventType || "UNKNOWN",
    label: partial.label || partial.eventType || "Event",
    source: partial.source || "babydragon_inferred",
    confidence: partial.confidence || "inferred",
    rat: partial.rat ?? null,
    pci: partial.pci ?? null,
    channel: partial.channel ?? null,
    cellId: partial.cellId ?? null,
    dlMbps: partial.dlMbps ?? null,
    ulMbps: partial.ulMbps ?? null,
    notes: partial.notes || null,
    relatedIteration: partial.relatedIteration ?? null,
    relatedTestId: partial.relatedTestId ?? null,
    details: partial.details || null,
    direction: partial.direction ?? null,
    errorText: partial.errorText ?? null,
    callState: partial.callState ?? null,
    transitionFrom: partial.transitionFrom ?? null,
    transitionTo: partial.transitionTo ?? null,
    ringingEpisode: partial.ringingEpisode ?? null,
    setupTimeMs: partial.setupTimeMs ?? null,
    observedOffhookDurationSec: partial.observedOffhookDurationSec ?? null,
    timestampMs: ts,
    timestampOrigin: partial.timestampOrigin || "recorded",
    // Direct GPS only when the linked sample itself has valid coords (never invent / reuse prior)
    mapLat: hasDirectGps ? gpsLat : null,
    mapLon: hasDirectGps ? gpsLon : null,
    mapGpsAttachMode: hasDirectGps ? (partial.mapGpsAttachMode || "direct_sample") : null,
  };
}

function sampleHasValidGps(fields = {}) {
  const lat = getNumber(fields.gpsLat);
  const lon = getNumber(fields.gpsLon);
  if (lat === null || lon === null) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
  if (lat === 0 && lon === 0) return false;
  return true;
}

function withSampleGps(partial, cur) {
  if (!sampleHasValidGps(cur)) return partial;
  return {
    ...partial,
    gpsLat: cur.gpsLat,
    gpsLon: cur.gpsLon,
    mapGpsAttachMode: "direct_sample",
  };
}

function detectSampleTransitions(samples, sessionStartMs, push) {
  let prev = null;
  let prevGpsOk = null;
  (Array.isArray(samples) ? samples : []).forEach((sample) => {
    const cur = sampleFields(sample);
    if (!Number.isFinite(cur.timestamp)) return;

    if (prev) {
      if (cur.rat && prev.rat && cur.rat !== prev.rat) {
        push(withSampleGps({
          timestampMs: cur.timestamp,
          category: "rf",
          eventType: "RAT_CHANGE",
          label: `RAT change ${prev.rat} → ${cur.rat}`,
          source: "babydragon_inferred",
          confidence: "inferred",
          rat: cur.rat,
          pci: cur.pci,
          channel: cur.channel,
          cellId: cur.cellId,
          notes: "Inferred from consecutive RF samples.",
          oldValue: prev.rat,
          newValue: cur.rat,
        }, cur));
      }

      const cellChanged = (cur.cellId !== null && prev.cellId !== null && cur.cellId !== prev.cellId)
        || (cur.pci !== null && prev.pci !== null && cur.pci !== prev.pci && cur.channel !== null && prev.channel !== null && cur.channel !== prev.channel);
      if (cellChanged) {
        push(withSampleGps({
          timestampMs: cur.timestamp,
          category: "rf",
          eventType: "SERVING_CELL_CHANGE",
          label: "Serving cell change / possible handover or reselection",
          source: "babydragon_inferred",
          confidence: "inferred",
          rat: cur.rat,
          pci: cur.pci,
          channel: cur.channel,
          cellId: cur.cellId,
          notes: "Inferred. Not a confirmed handover signal.",
        }, cur));
      }

      if (cur.pci !== null && prev.pci !== null && cur.pci !== prev.pci) {
        push(withSampleGps({
          timestampMs: cur.timestamp,
          category: "rf",
          eventType: "PCI_CHANGE",
          label: `PCI change ${prev.pci} → ${cur.pci}`,
          source: "babydragon_inferred",
          confidence: "inferred",
          rat: cur.rat,
          pci: cur.pci,
          channel: cur.channel,
          cellId: cur.cellId,
          notes: "Serving cell change / possible handover or reselection",
        }, cur));
      }

      if (cur.psc !== null && prev.psc !== null && cur.psc !== prev.psc) {
        push(withSampleGps({
          timestampMs: cur.timestamp,
          category: "rf",
          eventType: "PSC_CHANGE",
          label: `PSC change ${prev.psc} → ${cur.psc}`,
          source: "babydragon_inferred",
          confidence: "inferred",
          rat: cur.rat,
          pci: cur.psc,
          notes: "Serving cell change / possible handover or reselection",
        }, cur));
      }

      if (cur.bsic !== null && prev.bsic !== null && cur.bsic !== prev.bsic) {
        push(withSampleGps({
          timestampMs: cur.timestamp,
          category: "rf",
          eventType: "BSIC_CHANGE",
          label: `BSIC change ${prev.bsic} → ${cur.bsic}`,
          source: "babydragon_inferred",
          confidence: "inferred",
          rat: cur.rat,
          pci: cur.bsic,
          notes: "Serving cell change / possible handover or reselection",
        }, cur));
      }

      if (cur.earfcn !== null && prev.earfcn !== null && cur.earfcn !== prev.earfcn) {
        push(withSampleGps({
          timestampMs: cur.timestamp,
          category: "rf",
          eventType: "EARFCN_CHANGE",
          label: `EARFCN change ${prev.earfcn} → ${cur.earfcn}`,
          source: "babydragon_inferred",
          confidence: "inferred",
          rat: cur.rat,
          channel: cur.earfcn,
          notes: "Serving cell change / possible handover or reselection",
        }, cur));
      } else if (cur.nrarfcn !== null && prev.nrarfcn !== null && cur.nrarfcn !== prev.nrarfcn) {
        push(withSampleGps({
          timestampMs: cur.timestamp,
          category: "rf",
          eventType: "NRARFCN_CHANGE",
          label: `NRARFCN change ${prev.nrarfcn} → ${cur.nrarfcn}`,
          source: "babydragon_inferred",
          confidence: "inferred",
          rat: cur.rat,
          channel: cur.nrarfcn,
          notes: "Serving cell change / possible handover or reselection",
        }, cur));
      } else if (cur.uarfcn !== null && prev.uarfcn !== null && cur.uarfcn !== prev.uarfcn) {
        push(withSampleGps({
          timestampMs: cur.timestamp,
          category: "rf",
          eventType: "UARFCN_CHANGE",
          label: `UARFCN change ${prev.uarfcn} → ${cur.uarfcn}`,
          source: "babydragon_inferred",
          confidence: "inferred",
          rat: cur.rat,
          channel: cur.uarfcn,
          notes: "Serving cell change / possible handover or reselection",
        }, cur));
      } else if (cur.arfcn !== null && prev.arfcn !== null && cur.arfcn !== prev.arfcn) {
        push(withSampleGps({
          timestampMs: cur.timestamp,
          category: "rf",
          eventType: "ARFCN_CHANGE",
          label: `ARFCN change ${prev.arfcn} → ${cur.arfcn}`,
          source: "babydragon_inferred",
          confidence: "inferred",
          rat: cur.rat,
          channel: cur.arfcn,
          notes: "Serving cell change / possible handover or reselection",
        }, cur));
      } else if (cur.channel !== null && prev.channel !== null && cur.channel !== prev.channel) {
        push(withSampleGps({
          timestampMs: cur.timestamp,
          category: "rf",
          eventType: "CHANNEL_CHANGE",
          label: `Channel change ${prev.channel} → ${cur.channel}`,
          source: "babydragon_inferred",
          confidence: "inferred",
          rat: cur.rat,
          pci: cur.pci,
          channel: cur.channel,
          cellId: cur.cellId,
          notes: "Serving cell change / possible handover or reselection",
        }, cur));
      }

      if (cur.tac !== null && prev.tac !== null && cur.tac !== prev.tac) {
        push(withSampleGps({
          timestampMs: cur.timestamp,
          category: "rf",
          eventType: "TAC_CHANGE",
          label: `TAC change ${prev.tac} → ${cur.tac}`,
          source: "babydragon_inferred",
          confidence: "inferred",
          rat: cur.rat,
          cellId: cur.cellId,
          notes: "Inferred from consecutive RF samples.",
        }, cur));
      }

      if (cur.nci !== null && prev.nci !== null && cur.nci !== prev.nci) {
        push(withSampleGps({
          timestampMs: cur.timestamp,
          category: "rf",
          eventType: "NCI_CHANGE",
          label: `NCI change ${prev.nci} → ${cur.nci}`,
          source: "babydragon_inferred",
          confidence: "inferred",
          rat: cur.rat,
          cellId: cur.nci,
          notes: "Serving cell change / possible handover or reselection",
        }, cur));
      } else if (cur.cellId !== null && prev.cellId !== null && cur.cellId !== prev.cellId
        && cur.nci === null && prev.nci === null) {
        push(withSampleGps({
          timestampMs: cur.timestamp,
          category: "rf",
          eventType: "CELL_ID_CHANGE",
          label: `Cell ID change ${prev.cellId} → ${cur.cellId}`,
          source: "babydragon_inferred",
          confidence: "inferred",
          rat: cur.rat,
          cellId: cur.cellId,
          notes: "Serving cell change / possible handover or reselection",
        }, cur));
      }

      if (cur.dataNetworkTypeName && prev.dataNetworkTypeName
        && cur.dataNetworkTypeName !== prev.dataNetworkTypeName
        && cur.dataNetworkTypeName !== cur.rat) {
        push(withSampleGps({
          timestampMs: cur.timestamp,
          category: "rf",
          eventType: "DATA_NETWORK_TYPE_CHANGE",
          label: `Data network type ${prev.dataNetworkTypeName} → ${cur.dataNetworkTypeName}`,
          source: "android_public_api",
          confidence: "confirmed",
          rat: cur.rat,
          notes: "TelephonyManager dataNetworkTypeName change.",
        }, cur));
      }

      if (prev.nrStatus && cur.nrStatus && prev.nrStatus !== cur.nrStatus) {
        if (cur.nrStatus === "live" || cur.nrStatus === "measurement_only") {
          if (prev.nrStatus === "not_exposed") {
            push(withSampleGps({
              timestampMs: cur.timestamp,
              category: "rf",
              eventType: "NR_SECONDARY_EXPOSED",
              label: `NR secondary exposed (${cur.nrStatus})`,
              source: "android_public_api",
              confidence: "confirmed",
              rat: cur.rat,
              pci: cur.pci,
              channel: cur.channel,
              notes: `nrSecondaryStatus ${prev.nrStatus} → ${cur.nrStatus}`,
            }, cur));
          } else {
            push(withSampleGps({
              timestampMs: cur.timestamp,
              category: "rf",
              eventType: "NR_SECONDARY_STATUS_CHANGE",
              label: `NR secondary status ${prev.nrStatus} → ${cur.nrStatus}`,
              source: "android_public_api",
              confidence: "confirmed",
              rat: cur.rat,
              notes: `live / measurement_only / not_exposed transition`,
            }, cur));
          }
        }
        if (cur.nrStatus === "not_exposed" && (prev.nrStatus === "live" || prev.nrStatus === "measurement_only")) {
          push(withSampleGps({
            timestampMs: cur.timestamp,
            category: "rf",
            eventType: "NR_SECONDARY_LOST",
            label: "NR secondary lost / not exposed",
            source: "android_public_api",
            confidence: "confirmed",
            rat: cur.rat,
            notes: `nrSecondaryStatus ${prev.nrStatus} → ${cur.nrStatus}`,
          }, cur));
        }
      }

      if (cur.trafficReset) {
        push(withSampleGps({
          timestampMs: cur.timestamp,
          category: "data",
          eventType: "TRAFFICSTATS_COUNTER_RESET",
          label: "TrafficStats counter reset detected",
          source: "android_public_api",
          confidence: "confirmed",
          dlMbps: cur.dlMbps,
          ulMbps: cur.ulMbps,
          notes: "Android TrafficStats counter wrap/reset flag.",
        }, cur));
      }
    }

    const gpsOk = sampleHasValidGps(cur);
    if (prevGpsOk === true && !gpsOk) {
      push({
        timestampMs: cur.timestamp,
        category: "gps",
        eventType: "GPS_LOST",
        label: "GPS lost / unavailable",
        source: "babydragon_inferred",
        confidence: "inferred",
        // intentionally no GPS coords — lost
      });
    } else if (prevGpsOk === false && gpsOk) {
      push(withSampleGps({
        timestampMs: cur.timestamp,
        category: "gps",
        eventType: "GPS_RESTORED",
        label: "GPS restored",
        source: "babydragon_inferred",
        confidence: "inferred",
        notes: `lat=${cur.gpsLat}, lon=${cur.gpsLon}`,
      }, cur));
    }
    prevGpsOk = gpsOk;
    prev = cur;
  });
}

function detectPauseResume(session, sessionStartMs, push) {
  const segments = Array.isArray(session?.pauseSegments) ? session.pauseSegments : [];
  segments.forEach((seg, index) => {
    const start = getNumber(seg?.startedAt ?? seg?.startMs ?? seg?.pausedAt);
    const end = getNumber(seg?.endedAt ?? seg?.endMs ?? seg?.resumedAt);
    if (start !== null) {
      push({
        timestampMs: start,
        category: "session",
        eventType: "PAUSE",
        label: `Pause #${index + 1}`,
        source: "babydragon_session",
        confidence: "confirmed",
        relatedIteration: index + 1,
      });
    }
    if (end !== null) {
      push({
        timestampMs: end,
        category: "session",
        eventType: "RESUME",
        label: `Resume #${index + 1}`,
        source: "babydragon_session",
        confidence: "confirmed",
        relatedIteration: index + 1,
      });
    }
  });
}

function resolveRecordedOutcome(row = {}, phase = "iteration") {
  const status = String(row.status || row.resultStatus || "").toLowerCase().trim();
  const errorText = cleanText(row.error || row.errorMessage || row.errorText);
  const phaseStatus = phase === "dl"
    ? String(row.dlStatus || "").toLowerCase()
    : phase === "ul"
      ? String(row.ulStatus || "").toLowerCase()
      : "";

  if (errorText && phase === "iteration") return { kind: "failure", errorText };
  if (phaseStatus.includes("fail") || phaseStatus.includes("error")) {
    return { kind: "failure", errorText: errorText || phaseStatus };
  }
  if (status === "error" || status === "failed" || status === "fail") {
    return { kind: "failure", errorText: errorText || status };
  }
  if (status === "complete" || status === "success" || status === "ok" || status === "passed") {
    if (phase === "dl" && phaseStatus && (phaseStatus.includes("fail") || phaseStatus.includes("error"))) {
      return { kind: "failure", errorText: phaseStatus };
    }
    if (phase === "ul" && phaseStatus && (phaseStatus.includes("fail") || phaseStatus.includes("error"))) {
      return { kind: "failure", errorText: phaseStatus };
    }
    if (phase === "dl" && phaseStatus.includes("success")) return { kind: "success", errorText: null };
    if (phase === "ul" && phaseStatus.includes("success")) return { kind: "success", errorText: null };
    if (phase === "iteration") return { kind: "success", errorText: null };
    // direction-complete with overall success but no phase status → neutral end for phase
    if (phaseStatus) return { kind: "success", errorText: null };
    return { kind: "end", errorText: null };
  }
  if (status === "partial" || status === "stopped" || status === "aborted") {
    return { kind: "end", errorText: errorText || status };
  }
  // Missing status: never invent success
  return { kind: "end", errorText: errorText || null };
}

function detectNativeHttpIterations(rows, push, source) {
  rows.forEach((row) => {
    const start = getNumber(row?.startedAt);
    const end = getNumber(row?.endedAt);
    const direction = String(row?.direction || "").toLowerCase();
    const runDl = direction === "dl" || direction === "dl_ul" || direction === "both"
      || getNumber(row?.dlMbps) !== null
      || getNumber(row?.dlSeconds) !== null
      || getNumber(row?.dlWallSeconds) !== null
      || getNumber(row?.dlMeasuredBytes) !== null
      || getNumber(row?.dlBytes) !== null;
    const runUl = direction === "ul" || direction === "dl_ul" || direction === "both"
      || getNumber(row?.ulMbps) !== null
      || getNumber(row?.ulSeconds) !== null
      || getNumber(row?.ulWallSeconds) !== null
      || getNumber(row?.ulMeasuredBytes) !== null
      || getNumber(row?.ulBytes) !== null;

    const dlWall = getNumber(row?.dlWallSeconds) ?? getNumber(row?.dlSeconds);
    const ulWall = getNumber(row?.ulWallSeconds) ?? getNumber(row?.ulSeconds);
    const dlEndedAtRecorded = getNumber(row?.dlEndedAt);
    const ulEndedAtRecorded = getNumber(row?.ulEndedAt);
    const dlEndedAt = dlEndedAtRecorded
      ?? (start !== null && dlWall !== null ? start + Math.round(dlWall * 1000) : null);
    const ulEndedAt = ulEndedAtRecorded
      ?? (end !== null && runUl ? end : null)
      ?? (dlEndedAt !== null && ulWall !== null ? dlEndedAt + Math.round(ulWall * 1000) : null);
    const dlDerivedFromWall = dlEndedAtRecorded == null && start !== null && dlWall !== null && dlEndedAt !== null;
    const ulDerivedFromWall = ulEndedAtRecorded == null
      && dlEndedAt !== null
      && ulWall !== null
      && ulEndedAt !== null
      && !(end !== null && runUl && ulEndedAt === end);

    const iter = row.iteration ?? null;
    const engine = cleanText(row.source) || "native_http";
    const relatedTestId = cleanText(row.testId || row.resultId || null);
    const baseDetails = {
      iteration: iter,
      direction: direction || null,
      startTimestampMs: start,
      dlEndTimestampMs: dlEndedAt,
      ulEndTimestampMs: ulEndedAt,
      iterationEndTimestampMs: end,
      sourceEngine: engine,
      relatedTestId,
      status: cleanText(row.status) || null,
      errorText: cleanText(row.error || row.errorMessage) || null,
      dlMbps: getNumber(row.dlMbps),
      ulMbps: getNumber(row.ulMbps),
    };

    if (start !== null) {
      push({
        timestampMs: start,
        category: "data",
        eventType: "NATIVE_HTTP_ITERATION_START",
        label: `Native HTTP iteration ${iter ?? ""} start`.trim(),
        source,
        confidence: "confirmed",
        relatedIteration: iter,
        relatedTestId,
        direction: direction || null,
        // Temporal truth: start events must not carry end-of-iteration results.
        dlMbps: null,
        ulMbps: null,
        status: "started",
        details: JSON.stringify({
          iteration: iter,
          direction: direction || null,
          startTimestampMs: start,
          sourceEngine: engine,
          relatedTestId,
          status: "started",
          requestedDirection: direction || null,
        }),
        notes: "Recorded iteration start timestamp",
      });
    }

    if (runDl && (dlEndedAt !== null || end !== null)) {
      const dlTs = dlEndedAt ?? (runUl ? null : end);
      if (dlTs !== null) {
        const outcome = resolveRecordedOutcome(row, "dl");
        const eventType = outcome.kind === "success"
          ? "NATIVE_HTTP_DL_SUCCESS"
          : outcome.kind === "failure"
            ? "NATIVE_HTTP_DL_FAILURE"
            : "NATIVE_HTTP_DL_END";
        push({
          timestampMs: dlTs,
          category: "data",
          eventType,
          label: `Native HTTP iteration ${iter ?? ""} DL ${outcome.kind === "end" ? "end" : outcome.kind}`.trim(),
          source,
          confidence: "confirmed",
          relatedIteration: iter,
          relatedTestId,
          direction: "dl",
          dlMbps: getNumber(row.dlMbps),
          errorText: outcome.errorText,
          details: JSON.stringify({ ...baseDetails, phase: "dl", outcome: outcome.kind }),
          notes: (() => {
            const base = outcome.errorText
              ? `DL recorded state: ${outcome.kind}; error=${outcome.errorText}`
              : `DL recorded state: ${outcome.kind} (success only when status confirms)`;
            return dlDerivedFromWall
              ? `${base}. Derived from recorded wall duration`
              : base;
          })(),
          timestampOrigin: dlDerivedFromWall ? "derived_wall_duration" : "recorded",
        });
      }
    }

    if (runUl && (ulEndedAt !== null || end !== null)) {
      const ulTs = ulEndedAt ?? end;
      if (ulTs !== null) {
        const outcome = resolveRecordedOutcome(row, "ul");
        const eventType = outcome.kind === "success"
          ? "NATIVE_HTTP_UL_SUCCESS"
          : outcome.kind === "failure"
            ? "NATIVE_HTTP_UL_FAILURE"
            : "NATIVE_HTTP_UL_END";
        push({
          timestampMs: ulTs,
          category: "data",
          eventType,
          label: `Native HTTP iteration ${iter ?? ""} UL ${outcome.kind === "end" ? "end" : outcome.kind}`.trim(),
          source,
          confidence: "confirmed",
          relatedIteration: iter,
          relatedTestId,
          direction: "ul",
          ulMbps: getNumber(row.ulMbps),
          errorText: outcome.errorText,
          details: JSON.stringify({ ...baseDetails, phase: "ul", outcome: outcome.kind }),
          notes: (() => {
            const base = outcome.errorText
              ? `UL recorded state: ${outcome.kind}; error=${outcome.errorText}`
              : `UL recorded state: ${outcome.kind} (success only when status confirms)`;
            return ulDerivedFromWall
              ? `${base}. Derived from recorded wall duration`
              : base;
          })(),
          timestampOrigin: ulDerivedFromWall ? "derived_wall_duration" : "recorded",
        });
      }
    }

    if (end !== null) {
      const outcome = resolveRecordedOutcome(row, "iteration");
      // Prefer specific phase events; iteration end is always recorded when timestamp exists
      push({
        timestampMs: end,
        category: "data",
        eventType: "NATIVE_HTTP_ITERATION_END",
        label: `Native HTTP iteration ${iter ?? ""} end`.trim(),
        source,
        confidence: "confirmed",
        relatedIteration: iter,
        relatedTestId,
        direction: direction || null,
        dlMbps: getNumber(row.dlMbps),
        ulMbps: getNumber(row.ulMbps),
        errorText: outcome.errorText,
        details: JSON.stringify({ ...baseDetails, phase: "iteration", outcome: outcome.kind }),
        notes: outcome.kind === "success"
          ? "Iteration end with recorded success/complete status"
          : outcome.kind === "failure"
            ? `Iteration end with recorded failure: ${outcome.errorText || "error"}`
            : "Iteration end (neutral — status missing or non-success; success not invented)",
      });
    }
  });
}

function isFailedAppStatus(status) {
  const s = String(status || "").toLowerCase();
  return s === "error" || s === "failed" || s === "failure" || s === "fail";
}

function isSuccessAppStatus(status) {
  const s = String(status || "").toLowerCase();
  return s === "complete" || s === "success" || s === "ok" || s === "passed";
}

function rowIsFailed(row = {}) {
  if (isFailedAppStatus(row.status)) return true;
  return Boolean(cleanText(row.error || row.errorMessage || row.errorText));
}

function rowHasThroughput(row = {}) {
  const dl = getNumber(row.dlMbps);
  const ul = getNumber(row.ulMbps);
  return (dl !== null && dl > 0) || (ul !== null && ul > 0);
}

function resolveEnginePrefix(session, rows, testType) {
  let prefix = "NATIVE_HTTP";
  if (testType.includes("ftp")) prefix = "FTP";
  else if (testType.includes("iperf")) prefix = "IPERF3";
  else if (testType.includes("http") || testType.includes("native")) prefix = "NATIVE_HTTP";
  else if (session?.appCommand || rows.some((r) => Array.isArray(r?.intervalSamples) && r.intervalSamples.length)) {
    prefix = "IPERF3";
  }
  return prefix;
}

function failureLabelForPrefix(prefix) {
  if (prefix === "FTP") return "FTP test failed";
  if (prefix === "IPERF3") return "iPerf3 test failed";
  return "Native HTTP test failed";
}

function buildTestFailureMeta(session, rows, prefix) {
  // Prefer one atomic failed iteration record — never mix code from one row with message from another / session.
  const failedRows = (Array.isArray(rows) ? rows : []).filter(rowIsFailed);
  const atomic = failedRows.length ? failedRows[failedRows.length - 1] : null;
  if (atomic) {
    const errorText = cleanText(atomic.error || atomic.errorMessage || atomic.errorText)
      || cleanText(session?.appTestError || session?.appTestMessage);
    let errorCode = cleanText(atomic.errorCode);
    let failureStage = cleanText(atomic.failureStage);
    if (prefix === "NATIVE_HTTP" && errorText && (!errorCode || !failureStage)) {
      const classif = classifyNativeHttpFailure(errorText);
      errorCode = errorCode || classif.errorCode;
      failureStage = failureStage || classif.failureStage;
    }
    if (prefix === "FTP" && errorText && (!errorCode || !failureStage)) {
      const classif = classifyFtpFailure(errorText, {
        direction: atomic.direction,
        failureStage: atomic.failureStage,
        dlFailed: atomic.dlOk === false,
        ulFailed: atomic.ulOk === false,
      });
      errorCode = errorCode || classif.errorCode;
      failureStage = failureStage || classif.failureStage;
    }
    const noteParts = [];
    if (atomic.iteration != null) noteParts.push(`iteration=${atomic.iteration}`);
    if (atomic.direction) noteParts.push(`direction=${atomic.direction}`);
    if (errorCode) noteParts.push(`errorCode=${errorCode}`);
    if (failureStage) noteParts.push(`failureStage=${failureStage}`);
    return {
      errorText,
      errorCode,
      failureStage,
      iteration: atomic.iteration ?? null,
      direction: cleanText(atomic.direction),
      notes: noteParts.length ? noteParts.join("; ") : "Recorded test failure",
    };
  }
  const errorText = cleanText(session?.appTestError || session?.appTestMessage);
  let errorCode = cleanText(session?.appTestErrorCode);
  let failureStage = cleanText(session?.appTestFailureStage);
  if (prefix === "NATIVE_HTTP" && errorText) {
    const classif = classifyNativeHttpFailure(errorText);
    errorCode = errorCode || classif.errorCode;
    failureStage = failureStage || classif.failureStage;
  }
  const noteParts = [];
  if (errorCode) noteParts.push(`errorCode=${errorCode}`);
  if (failureStage) noteParts.push(`failureStage=${failureStage}`);
  return { errorText, errorCode, failureStage, notes: noteParts.length ? noteParts.join("; ") : "Recorded test failure" };
}

function resolveTestStartMs(session, rows, testActuallyStarted) {
  const appTestStartedAt = getNumber(session?.appTestStartedAt);
  const firstRowStart = rows.length ? getNumber(rows[0]?.startedAt) : null;
  if (appTestStartedAt !== null) return appTestStartedAt;
  if (firstRowStart !== null) return firstRowStart;
  if (testActuallyStarted) return getNumber(session?.startedAt);
  return null;
}

function detectThpIterations(session, push) {
  const testType = String(session?.appTestType || session?.appSetupSnapshot?.testType || "").toLowerCase();
  const rows = Array.isArray(session?.appIterationResults) ? session.appIterationResults : [];
  const appStatus = String(session?.appTestStatus || "").toLowerCase();
  const sessionFailed = isFailedAppStatus(appStatus);
  const hasFailedRows = rows.some(rowIsFailed);
  const hasSuccessfulRows = rows.some((row) => !rowIsFailed(row) && (isSuccessAppStatus(row.status) || rowHasThroughput(row)));
  const testActuallyStarted = getNumber(session?.appTestStartedAt) !== null
    || rows.some((row) => getNumber(row?.startedAt) !== null)
    || sessionFailed
    || appStatus === "running"
    || appStatus === "complete"
    || appStatus === "stopped";
  const testFailed = sessionFailed
    || (rows.length === 0 && sessionFailed)
    || (hasFailedRows && !hasSuccessfulRows);

  const prefix = resolveEnginePrefix(session, rows, testType);
  const source = "babydragon_engine";

  if (testFailed) {
    const startMs = resolveTestStartMs(session, rows, testActuallyStarted);
    const failureMs = getNumber(session?.appTestEndedAt)
      ?? (rows.length ? getNumber(rows[rows.length - 1]?.endedAt) : null)
      ?? getNumber(session?.endedAt);
    const meta = buildTestFailureMeta(session, rows, prefix);

    if (startMs !== null) {
      push({
        timestampMs: startMs,
        category: "data",
        eventType: `${prefix}_START`,
        label: `${prefix} test start`,
        source,
        confidence: "confirmed",
        dlMbps: null,
        ulMbps: null,
        status: "started",
      });
    }

    if (failureMs !== null || startMs !== null) {
      push({
        timestampMs: failureMs ?? startMs,
        category: "data",
        eventType: `${prefix}_TEST_FAILURE`,
        label: failureLabelForPrefix(prefix),
        source,
        confidence: "confirmed",
        errorText: meta.errorText,
        notes: meta.notes,
        details: JSON.stringify({
          errorCode: meta.errorCode,
          failureStage: meta.failureStage,
          appTestStatus: session?.appTestStatus || null,
        }),
      });
    }

    if (rows.length) {
      if (prefix === "NATIVE_HTTP") {
        detectNativeHttpIterations(rows, push, source);
      } else {
        rows.forEach((row) => {
          const start = getNumber(row?.startedAt);
          const end = getNumber(row?.endedAt);
          if (start !== null) {
            push({
              timestampMs: start,
              category: "data",
              eventType: `${prefix}_ITERATION_START`,
              label: `${prefix} iteration ${row.iteration || ""} start`,
              source,
              confidence: "confirmed",
              relatedIteration: row.iteration ?? null,
              dlMbps: null,
              ulMbps: null,
              status: "started",
              direction: cleanText(row.direction),
            });
          }
          if (end !== null) {
            push({
              timestampMs: end,
              category: "data",
              eventType: `${prefix}_ITERATION_END`,
              label: `${prefix} iteration ${row.iteration || ""} end`,
              source,
              confidence: "confirmed",
              relatedIteration: row.iteration ?? null,
              dlMbps: getNumber(row.dlMbps),
              ulMbps: getNumber(row.ulMbps),
              direction: cleanText(row.direction),
              errorText: cleanText(row.error || row.errorMessage),
              notes: cleanText(row.status) ? `Recorded status=${row.status}` : "Iteration end timestamp recorded",
            });
          }
        });
      }
    }
    return;
  }

  if (!rows.length) return;

  const firstStart = resolveTestStartMs(session, rows, testActuallyStarted);
  const lastEnd = getNumber(rows[rows.length - 1]?.endedAt) ?? getNumber(session?.appTestEndedAt) ?? getNumber(session?.endedAt);
  if (firstStart !== null) {
    push({
      timestampMs: firstStart,
      category: "data",
      eventType: `${prefix}_START`,
      label: `${prefix} test start`,
      source,
      confidence: "confirmed",
      dlMbps: null,
      ulMbps: null,
      status: "started",
    });
  }

  if (prefix === "NATIVE_HTTP") {
    detectNativeHttpIterations(rows, push, source);
  } else {
    rows.forEach((row) => {
      const start = getNumber(row?.startedAt);
      const end = getNumber(row?.endedAt);
      if (start !== null) {
        push({
          timestampMs: start,
          category: "data",
          eventType: `${prefix}_ITERATION_START`,
          label: `${prefix} iteration ${row.iteration || ""} start`,
          source,
          confidence: "confirmed",
          relatedIteration: row.iteration ?? null,
          dlMbps: null,
          ulMbps: null,
          status: "started",
          direction: cleanText(row.direction),
        });
      }
      if (end !== null) {
        push({
          timestampMs: end,
          category: "data",
          eventType: `${prefix}_ITERATION_END`,
          label: `${prefix} iteration ${row.iteration || ""} end`,
          source,
          confidence: "confirmed",
          relatedIteration: row.iteration ?? null,
          dlMbps: getNumber(row.dlMbps),
          ulMbps: getNumber(row.ulMbps),
          direction: cleanText(row.direction),
          errorText: cleanText(row.error || row.errorMessage),
          notes: cleanText(row.status) ? `Recorded status=${row.status}` : "Iteration end timestamp recorded",
        });
      }
    });
  }

  if (lastEnd !== null) {
    push({
      timestampMs: lastEnd,
      category: "data",
      eventType: `${prefix}_END`,
      label: `${prefix} test end`,
      source,
      confidence: "confirmed",
    });
  }
}

function detectOoklaEvents(ooklaIterations, push) {
  (Array.isArray(ooklaIterations) ? ooklaIterations : []).forEach((item, index) => {
    const resultMs = getNumber(item?.fccTestAtMs)
      ?? (() => {
        const parsed = Date.parse(String(item?.ooklaDateTime || item?.testDateTime || item?.capturedAt || item?.savedAt || ""));
        return Number.isNaN(parsed) ? null : parsed;
      })();
    const capturedMs = (() => {
      const parsed = Date.parse(String(item?.capturedAt || item?.savedAt || item?.feConfirmedAt || ""));
      return Number.isNaN(parsed) ? null : parsed;
    })();

    if (resultMs !== null) {
      push({
        timestampMs: resultMs,
        category: "external",
        eventType: "OOKLA_RESULT_TIME",
        label: `OOKLA result time #${item.iterationNumber || index + 1}`,
        source: "external_ookla_evidence",
        confidence: "external",
        relatedIteration: item.iterationNumber ?? index + 1,
        relatedTestId: cleanText(item.resultId || item.ooklaResultId),
        dlMbps: getNumber(item.dlMbps),
        ulMbps: getNumber(item.ulMbps),
        notes: "External evidence result timestamp only. No invented OOKLA start/end.",
      });
    }
    if (capturedMs !== null) {
      push({
        timestampMs: capturedMs,
        category: "external",
        eventType: "OOKLA_EVIDENCE_CAPTURED",
        label: `OOKLA evidence captured #${item.iterationNumber || index + 1}`,
        source: "external_ookla_evidence",
        confidence: "external",
        relatedIteration: item.iterationNumber ?? index + 1,
        relatedTestId: cleanText(item.resultId || item.ooklaResultId),
        dlMbps: getNumber(item.dlMbps),
        ulMbps: getNumber(item.ulMbps),
      });
    }
    push({
      timestampMs: capturedMs ?? resultMs ?? null,
      category: "external",
      eventType: "OOKLA_IMPORT_ADDED",
      label: `OOKLA import added #${item.iterationNumber || index + 1}`,
      source: "external_ookla_evidence",
      confidence: "external",
      relatedIteration: item.iterationNumber ?? index + 1,
      relatedTestId: cleanText(item.resultId || item.ooklaResultId),
      dlMbps: getNumber(item.dlMbps),
      ulMbps: getNumber(item.ulMbps),
      notes: cleanText(item.evidenceSource || item.source) || "ookla_external_evidence",
    });
  });
}

function detectFccEvents(fccIterations, push) {
  (Array.isArray(fccIterations) ? fccIterations : []).forEach((item, index) => {
    const start = getNumber(item?.testStartMs);
    const end = getNumber(item?.testEndMs);
    const result = getNumber(item?.fccTestAtMs) ?? (() => {
      const parsed = Date.parse(String(item?.fccTestAt || ""));
      return Number.isNaN(parsed) ? null : parsed;
    })();
    const saved = (() => {
      const parsed = Date.parse(String(item?.savedAt || item?.capturedAt || ""));
      return Number.isNaN(parsed) ? null : parsed;
    })();

    if (start !== null) {
      push({
        timestampMs: start,
        category: "external",
        eventType: "FCC_TEST_START",
        label: `FCC test start ${item.fccTestId || ""}`.trim(),
        source: "external_fcc_export",
        confidence: "confirmed",
        relatedTestId: cleanText(item.fccTestId),
        relatedIteration: item.iterationNumber ?? index + 1,
        dlMbps: getNumber(item.fccDlMbps),
        ulMbps: getNumber(item.fccUlMbps),
        notes: "From FCC export phase timestamps.",
      });
    }
    if (end !== null) {
      push({
        timestampMs: end,
        category: "external",
        eventType: "FCC_TEST_END",
        label: `FCC test end ${item.fccTestId || ""}`.trim(),
        source: "external_fcc_export",
        confidence: "confirmed",
        relatedTestId: cleanText(item.fccTestId),
        relatedIteration: item.iterationNumber ?? index + 1,
        dlMbps: getNumber(item.fccDlMbps),
        ulMbps: getNumber(item.fccUlMbps),
        notes: "From FCC export phase timestamps.",
      });
    }
    push({
      timestampMs: saved ?? result ?? end ?? start,
      category: "external",
      eventType: "FCC_IMPORT_ADDED",
      label: `FCC import added ${item.fccTestId || ""}`.trim(),
      source: "external_fcc_export",
      confidence: "external",
      relatedTestId: cleanText(item.fccTestId),
      relatedIteration: item.iterationNumber ?? index + 1,
      dlMbps: getNumber(item.fccDlMbps),
      ulMbps: getNumber(item.fccUlMbps),
    });
  });
}

/**
 * Build chronological RF/data/evidence events for Excel Plot Report.
 */
export function buildRfEvents({
  samples = [],
  session = {},
  ooklaIterations = [],
  fccIterations = [],
} = {}) {
  const sessionStartMs = getNumber(session?.startedAt) ?? getNumber(samples?.[0]?.timestamp);
  const sessionEndMs = getNumber(session?.endedAt)
    ?? getNumber(samples?.[samples.length - 1]?.timestamp)
    ?? Date.now();
  const raw = [];
  const push = (partial) => {
    if (partial.timestampMs === null || partial.timestampMs === undefined) {
      // Still keep import-added style events with null timestamp as notes-only at end.
      raw.push({ ...partial, timestampMs: null });
      return;
    }
    raw.push(partial);
  };

  if (sessionStartMs !== null) {
    push({
      timestampMs: sessionStartMs,
      category: "session",
      eventType: "SESSION_START",
      label: "BabyDragon session start",
      source: "babydragon_session",
      confidence: "confirmed",
    });
  }

  detectPauseResume(session, sessionStartMs, push);
  detectSampleTransitions(samples, sessionStartMs, push);
  detectThpIterations(session, push);
  detectOoklaEvents(ooklaIterations, push);
  detectFccEvents(fccIterations, push);

  if (sessionEndMs !== null) {
    push({
      timestampMs: sessionEndMs,
      category: "session",
      eventType: "SESSION_END",
      label: "BabyDragon session end",
      source: "babydragon_session",
      confidence: "confirmed",
    });
  }

  const sorted = raw
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const ta = getNumber(a.item.timestampMs);
      const tb = getNumber(b.item.timestampMs);
      if (ta === null && tb === null) return a.index - b.index;
      if (ta === null) return 1;
      if (tb === null) return -1;
      if (ta !== tb) return ta - tb;
      return a.index - b.index;
    })
    .map((entry, seq) => makeEvent(entry.item, sessionStartMs, seq + 1));

  return {
    sessionStartMs,
    sessionEndMs,
    events: sorted,
  };
}

export function buildVoiceEvents({ samples = [], session = {} } = {}) {
  const sessionStartMs = getNumber(session?.startedAt) ?? getNumber(samples?.[0]?.timestamp);
  const events = [];
  let prevState = null;
  let ringingEpisode = 0;
  let ringingStartedAt = null;
  let offhookStartedAt = null;
  (Array.isArray(samples) ? samples : []).forEach((sample) => {
    const fields = sampleFields(sample);
    const state = fields.callState;
    if (!state || !Number.isFinite(fields.timestamp)) return;
    if (state === prevState) return;
    let eventType = "CALL_STATE_CHANGE";
    const upper = String(state).toUpperCase();
    if (upper.includes("IDLE")) eventType = "CALL_STATE_IDLE";
    else if (upper.includes("RING")) eventType = "CALL_STATE_RINGING";
    else if (upper.includes("OFFHOOK") || upper.includes("ACTIVE")) eventType = "CALL_STATE_OFFHOOK";

    if (eventType === "CALL_STATE_RINGING") {
      ringingEpisode += 1;
      ringingStartedAt = fields.timestamp;
    }

    let setupTimeMs = null;
    let observedOffhookDurationSec = null;
    let notes = null;
    if (eventType === "CALL_STATE_OFFHOOK" && ringingStartedAt != null) {
      setupTimeMs = Math.max(0, fields.timestamp - ringingStartedAt);
      offhookStartedAt = fields.timestamp;
    }
    if (eventType === "CALL_STATE_IDLE" && String(prevState || "").toUpperCase().includes("RING")) {
      notes = "Ringing ended without observed offhook";
      ringingStartedAt = null;
    }
    if (eventType === "CALL_STATE_IDLE" && offhookStartedAt != null) {
      observedOffhookDurationSec = Number(((fields.timestamp - offhookStartedAt) / 1000).toFixed(3));
      offhookStartedAt = null;
      ringingStartedAt = null;
    }

    events.push(makeEvent({
      timestampMs: fields.timestamp,
      category: "voice",
      eventType,
      label: `Call state ${prevState || "n/a"} → ${state}`,
      source: "android_public_api",
      confidence: "confirmed",
      rat: fields.rat,
      callState: state,
      transitionFrom: prevState || "n/a",
      transitionTo: state,
      ringingEpisode: eventType === "CALL_STATE_RINGING" || eventType === "CALL_STATE_OFFHOOK" || (notes && ringingEpisode > 0)
        ? ringingEpisode
        : null,
      setupTimeMs,
      observedOffhookDurationSec,
      notes: notes || null,
      details: "Passive TelephonyManager callState observation only. MO/MT/SRVCC/CSFB/dropped/missed are not claimed.",
    }, sessionStartMs, events.length + 1));
    prevState = state;
  });

  return {
    supported: events.length > 0,
    note: "Passive call-state observation during data mode. Android callState transitions only; MO/MT/SRVCC/CSFB/drop/reject/missed are not confirmed.",
    events,
  };
}

export default buildRfEvents;
