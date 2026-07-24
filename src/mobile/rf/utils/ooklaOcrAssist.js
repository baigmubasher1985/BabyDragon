const FIELD_LABELS = {
  dlMbps: "DL Mbps",
  ulMbps: "UL Mbps",
  pingMs: "Ping ms",
  jitterMs: "Jitter ms",
  serverName: "Server Name",
  serverLocation: "Server Location",
  providerName: "Provider Name",
  resultId: "Result ID",
  resultUrl: "Result URL",
  testDateTime: "Test Date/Time",
  connectionType: "Connection Type",
  deviceName: "Device Name",
  connectionsMode: "Connections Mode",
  packetLossPercent: "Packet Loss %",
  ooklaUserLatitude: "OOKLA User Latitude",
  ooklaUserLongitude: "OOKLA User Longitude",
  mainScreenshot: "Main Screenshot",
  detailedScreenshot: "Detailed Screenshot",
  screenshot: "Screenshot",
  resultIdentity: "Result ID or Result URL",
};

export const OOKLA_SUGGESTION_DISPLAY_KEYS = [
  "dlMbps",
  "ulMbps",
  "pingMs",
  "jitterMs",
  "serverName",
  "providerName",
  "resultId",
];

/** Recommended fields for evidenceCompleteness = complete. */
export const OOKLA_EVIDENCE_FIELD_KEYS = [
  "dlMbps",
  "ulMbps",
  "pingMs",
  "jitterMs",
  "providerName",
  "testDateTime",
  "resultIdentity",
  "mainScreenshot",
  "detailedScreenshot",
];

export const OOKLA_OPTIONAL_FIELD_KEYS = [
  "serverName",
  "serverLocation",
  "deviceName",
  "connectionType",
  "connectionsMode",
  "packetLossPercent",
  "ooklaUserLatitude",
  "ooklaUserLongitude",
];

export const OOKLA_MAIN_SUGGESTION_KEYS = [
  "dlMbps",
  "ulMbps",
  "pingMs",
  "jitterMs",
  "resultId",
  "testDateTime",
];

/** Visible Detailed OCR suggestion cards (no duplicate Main Result ID / DateTime). */
export const OOKLA_DETAILED_SUGGESTION_KEYS = [
  "connectionType",
  "deviceName",
  "serverName",
  "serverLocation",
  "providerName",
  "connectionsMode",
  "packetLossPercent",
  "ooklaUserLatitude",
  "ooklaUserLongitude",
];

const SPEED_FIELD_KEYS = ["dlMbps", "ulMbps", "pingMs", "jitterMs"];
const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };

function cleanNumber(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(/,/g, "");
  if (!text || text === "NaN" || text === "Infinity" || text === "-Infinity") return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text || null;
}

function normalizeOcrText(rawText = "") {
  return String(rawText || "")
    .replace(/\r/g, "\n")
    .replace(/\bOUpload\b/gi, "Upload")
    .replace(/\bOJitter\b/gi, "Jitter")
    .replace(/\bldle\b/gi, "Idle")
    .replace(/\bjitter(\d+(?:\.\d+)?)/gi, "Jitter $1")
    .replace(/\bping(\d+(?:\.\d+)?)/gi, "Ping $1")
    .replace(/[|]{2,}/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

function lineBox(line = {}) {
  const left = Number.isFinite(line.left) ? line.left : null;
  const top = Number.isFinite(line.top) ? line.top : null;
  const width = Number.isFinite(line.width) ? line.width : null;
  const height = Number.isFinite(line.height) ? line.height : null;
  const centerX = left !== null && width !== null ? left + (width / 2) : left;
  const centerY = top !== null && height !== null ? top + (height / 2) : top;
  const right = left !== null && width !== null ? left + width : left;
  const bottom = top !== null && height !== null ? top + height : top;
  return { left, top, width, height, centerX, centerY, right, bottom };
}

function enrichLines(rawText = "", lines = []) {
  const normalizedRaw = normalizeOcrText(rawText);
  const sourceLines = Array.isArray(lines) && lines.length
    ? lines
    : normalizedRaw.split(/\n+/).map((text) => ({ text })).filter((line) => String(line.text || "").trim());

  const originalOrder = sourceLines
    .map((line, index) => {
      const text = normalizeOcrText(typeof line === "string" ? line : (line?.text || ""));
      if (!text) return null;
      const box = lineBox(typeof line === "string" ? {} : line);
      return { index, text, originalText: typeof line === "string" ? line : String(line?.text || ""), ...box };
    })
    .filter(Boolean);

  const linesSortedByTopLeft = [...originalOrder].sort((a, b) => {
    const topA = a.top ?? Number.MAX_SAFE_INTEGER;
    const topB = b.top ?? Number.MAX_SAFE_INTEGER;
    if (topA !== topB) return topA - topB;
    return (a.left ?? Number.MAX_SAFE_INTEGER) - (b.left ?? Number.MAX_SAFE_INTEGER);
  });

  return { rawText: normalizedRaw, lines: originalOrder, linesSortedByTopLeft };
}

function computeBounds(lines = []) {
  const withGeo = lines.filter((line) => line.top !== null && line.left !== null);
  if (!withGeo.length) {
    return { minLeft: 0, minTop: 0, maxRight: 1, maxBottom: 1, width: 1, height: 1, hasGeometry: false };
  }
  const minLeft = Math.min(...withGeo.map((line) => line.left));
  const minTop = Math.min(...withGeo.map((line) => line.top));
  const maxRight = Math.max(...withGeo.map((line) => line.right ?? line.left));
  const maxBottom = Math.max(...withGeo.map((line) => line.bottom ?? line.top));
  const width = Math.max(1, maxRight - minLeft);
  const height = Math.max(1, maxBottom - minTop);
  return { minLeft, minTop, maxRight, maxBottom, width, height, hasGeometry: true };
}

function relY(line, bounds) {
  if (!bounds.hasGeometry || line.top === null) return null;
  return (line.top - bounds.minTop) / bounds.height;
}

function relX(line, bounds) {
  if (!bounds.hasGeometry || line.left === null) return null;
  return ((line.centerX ?? line.left) - bounds.minLeft) / bounds.width;
}

function isLongIdNumber(value) {
  if (value === null || value === undefined) return false;
  return String(Math.trunc(Math.abs(Number(value)))).length >= 7;
}

function matchesResultId(value, resultId) {
  if (value === null || value === undefined || !resultId) return false;
  return String(value) === String(resultId);
}

function isAdLine(text = "") {
  return /\b(ad|advert|sponsored|promo|install|download the app)\b/i.test(text);
}

function isDataUsedLine(text = "") {
  return /\bdata used\b/i.test(text) || /\b\d+(?:\.\d+)?\s*mb\b/i.test(text);
}

function isLowHighLine(text = "") {
  return /\b(low|high)\b/i.test(text);
}

function isResultIdLine(text = "") {
  return /\b(result\s*id|test\s*id)\b/i.test(text);
}

function isDecorativeNoise(text = "") {
  return /^\s*x\s*$/i.test(text) || /^\s*mbps\s*$/i.test(text) || /^\s*[^\d\w]*\s*$/i.test(text);
}

function isDeviceModelLine(text = "") {
  return /\b(kb\d+|pixel|galaxy|iphone|oneplus|sm-|cph|device)\b/i.test(text);
}

function extractResultIdFromText(text = "") {
  // Prefer full Ookla-length IDs (typically 10–12 digits). Avoid short truncations.
  const labelledLong = text.match(/(?:test|result)\s*(?:id|#)?\s*[:#]?\s*(\d{10,})/i);
  if (labelledLong?.[1]) return labelledLong[1];
  const bareLong = text.match(/\b(\d{10,})\b/);
  if (bareLong?.[1]) return bareLong[1];
  const labelled = text.match(/(?:test|result)\s*(?:id|#)?\s*[:#]?\s*(\d{6,})/i);
  if (labelled?.[1]) return labelled[1];
  return null;
}

/**
 * Prefer the fuller Result ID when screenshot OCR truncates vs URL / other source.
 * Never use Result ID as a speed KPI.
 */
export function preferFullResultId(candidates = [], { preferUrl = true } = {}) {
  const list = (Array.isArray(candidates) ? candidates : [])
    .map((item) => {
      if (item == null) return null;
      if (typeof item === "string" || typeof item === "number") {
        return { value: String(item).trim(), source: "unknown" };
      }
      return {
        value: String(item.value || "").trim(),
        source: item.source || "unknown",
      };
    })
    .filter((item) => item?.value && /^\d{6,}$/.test(item.value));

  if (!list.length) return null;

  list.sort((a, b) => {
    if (b.value.length !== a.value.length) return b.value.length - a.value.length;
    if (preferUrl && a.source === "result_url" && b.source !== "result_url") return -1;
    if (preferUrl && b.source === "result_url" && a.source !== "result_url") return 1;
    return 0;
  });

  const best = list[0];
  const truncated = list.filter((item) => (
    item.value !== best.value
    && best.value.startsWith(item.value)
    && item.value.length < best.value.length
  ));

  return {
    value: best.value,
    source: best.source,
    truncatedCandidates: truncated.map((item) => item.value),
    warning: truncated.length
      ? "Screenshot Result ID looks truncated. Keeping the fuller Result ID (URL preferred when available)."
      : null,
  };
}

export function checkResultIdTruncation(screenshotResultId, urlResultId) {
  const shot = String(screenshotResultId || "").trim();
  const url = String(urlResultId || "").trim();
  if (!shot || !url) return null;
  if (shot === url) return null;
  if (/^\d+$/.test(shot) && /^\d+$/.test(url) && url.startsWith(shot) && url.length > shot.length) {
    return "Screenshot Result ID looks truncated. Keeping the fuller Result ID from URL.";
  }
  if (/^\d+$/.test(shot) && /^\d+$/.test(url) && shot.startsWith(url) && shot.length > url.length) {
    return "URL Result ID looks shorter than screenshot Result ID. Keeping the fuller screenshot Result ID.";
  }
  return null;
}

function extractTestDateTimeFromText(text = "") {
  const patterns = [
    /(\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}\s*(?:AM|PM)?(?:\s*[A-Z]{2,4})?)/i,
    /(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)/,
    /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}.*?\d{1,2}:\d{2}\s*(?:AM|PM)?)/i,
  ];
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match?.[1]) return cleanText(match[1]);
  }
  return null;
}

function pickTestDateTime(linesSorted, tracker) {
  for (const line of linesSorted) {
    const value = extractTestDateTimeFromText(line.text);
    if (!value) continue;
    tracker.accept("testDateTime", value, "Main screenshot date/time", line, "medium");
    return makeField(value, "medium", "Main screenshot date/time", line);
  }
  return null;
}

function findLabel(linesSorted, matcher, { afterRelY = -Infinity, beforeRelY = Infinity, bounds } = {}) {
  return linesSorted.find((line) => {
    const y = relY(line, bounds);
    if (y !== null && (y < afterRelY || y > beforeRelY)) return false;
    return matcher(line.text);
  }) || null;
}

function serializeLabel(label) {
  if (!label) return null;
  return {
    text: label.text,
    left: label.left,
    top: label.top,
    width: label.width,
    height: label.height,
    centerX: label.centerX,
    centerY: label.centerY,
    index: label.index,
  };
}

function serializeBox(line) {
  if (!line) return null;
  return {
    left: line.left ?? null,
    top: line.top ?? null,
    width: line.width ?? null,
    height: line.height ?? null,
    centerX: line.centerX ?? null,
    centerY: line.centerY ?? null,
  };
}

function createCandidateTracker() {
  const acceptedCandidates = [];
  const rejectedCandidates = [];
  const parserWarnings = [];

  const reject = (fieldName, candidateText, reason, sourceLine = null) => {
    rejectedCandidates.push({
      fieldName,
      candidateText: String(candidateText ?? ""),
      reason,
      sourceLine: sourceLine?.text || null,
      boundingBox: serializeBox(sourceLine),
    });
  };

  const accept = (fieldName, candidateText, reason, sourceLine = null, confidence = "high") => {
    acceptedCandidates.push({
      fieldName,
      candidateText: String(candidateText ?? ""),
      reason,
      confidence,
      sourceLine: sourceLine?.text || null,
      boundingBox: serializeBox(sourceLine),
    });
  };

  const warn = (message) => {
    if (message) parserWarnings.push(String(message));
  };

  return { acceptedCandidates, rejectedCandidates, parserWarnings, reject, accept, warn };
}

function detectLabels(linesSorted, bounds) {
  const speed = findLabel(linesSorted, (text) => /\bspeed\b/i.test(text) && !/\bresponsiveness\b/i.test(text), { bounds });
  const responsiveness = findLabel(linesSorted, (text) => /\bresponsiveness\b/i.test(text), { bounds });
  const ping = findLabel(linesSorted, (text) => /\bping\s*ms\b/i.test(text) || (/^\s*ping\b/i.test(text) && !/\bmbps\b/i.test(text)), { bounds });
  const respRelY = responsiveness ? relY(responsiveness, bounds) : (ping ? relY(ping, bounds) : 0.55);

  const downloadSpeed = findLabel(
    linesSorted,
    (text) => /\bdownload\b/i.test(text)
      && !/\b(latency|responsiveness|low|high|jitter)\b/i.test(text)
      && !/\d+(?:\.\d+)?\s*mbps/i.test(text),
    { beforeRelY: respRelY ?? 0.55, bounds },
  );
  const uploadSpeed = findLabel(
    linesSorted,
    (text) => /\bupload\b/i.test(text)
      && !/\b(latency|responsiveness|low|high|jitter)\b/i.test(text)
      && !/\d+(?:\.\d+)?\s*mbps/i.test(text),
    { afterRelY: downloadSpeed ? (relY(downloadSpeed, bounds) ?? -Infinity) : -Infinity, beforeRelY: respRelY ?? 0.55, bounds },
  );
  const idle = findLabel(
    linesSorted,
    (text) => /\bidle\b/i.test(text),
    { afterRelY: (respRelY ?? 0.5) - 0.02, bounds },
  );
  const downloadResp = findLabel(
    linesSorted,
    (text) => /\bdownload\b/i.test(text) && !/\bmbps\b/i.test(text),
    { afterRelY: (respRelY ?? 0.5) - 0.02, bounds },
  );
  const uploadResp = findLabel(
    linesSorted,
    (text) => /\bupload\b/i.test(text) && !/\bmbps\b/i.test(text),
    { afterRelY: (respRelY ?? 0.5) - 0.02, bounds },
  );
  const resultId = findLabel(linesSorted, (text) => isResultIdLine(text), { bounds });
  const provider = findLabel(linesSorted, (text) => /\b(provider|isp)\b/i.test(text), { bounds });
  const server = findLabel(linesSorted, (text) => /\b(server|connections)\b/i.test(text), { bounds });

  return {
    downloadLabel: downloadSpeed,
    uploadLabel: uploadSpeed,
    speedSection: speed,
    responsivenessSection: responsiveness || ping,
    idleLabel: idle,
    downloadResponsivenessLabel: downloadResp,
    uploadResponsivenessLabel: uploadResp,
    pingLabel: ping,
    resultIdLabel: resultId,
    providerLabel: provider,
    serverLabel: server,
  };
}

/**
 * Portrait OOKLA layout zones using image-relative coordinates + labels.
 * Values are only accepted from the matching zone.
 */
function buildLayoutZones(linesSorted, labels, bounds) {
  const respTop = labels.responsivenessSection?.top
    ?? labels.pingLabel?.top
    ?? (bounds.minTop + bounds.height * 0.52);
  const speedTop = labels.speedSection?.top
    ?? labels.downloadLabel?.top
    ?? (bounds.minTop + bounds.height * 0.12);

  const headerZone = {
    name: "header",
    topMin: bounds.minTop - 1,
    topMax: speedTop,
    leftMin: -Infinity,
    leftMax: Infinity,
  };

  const speedZone = {
    name: "speed",
    topMin: speedTop - 1,
    topMax: respTop,
    leftMin: -Infinity,
    leftMax: Infinity,
  };

  const downloadLeft = labels.downloadLabel?.left ?? null;
  const uploadLeft = labels.uploadLabel?.left ?? null;
  const sideBySide = downloadLeft !== null
    && uploadLeft !== null
    && Math.abs((labels.downloadLabel?.top ?? 0) - (labels.uploadLabel?.top ?? 0)) < bounds.height * 0.12;

  const midX = sideBySide
    ? (downloadLeft + uploadLeft) / 2
    : (bounds.minLeft + bounds.width * 0.5);

  const downloadCardZone = {
    name: "download_card",
    topMin: labels.downloadLabel?.top ?? speedZone.topMin,
    topMax: sideBySide ? respTop : (labels.uploadLabel?.top ?? respTop),
    leftMin: sideBySide ? (downloadLeft - bounds.width * 0.05) : -Infinity,
    leftMax: sideBySide ? midX : Infinity,
  };

  const uploadCardZone = {
    name: "upload_card",
    topMin: labels.uploadLabel?.top ?? speedZone.topMin,
    topMax: respTop,
    leftMin: sideBySide ? midX : -Infinity,
    leftMax: Infinity,
  };

  const responsivenessZone = {
    name: "responsiveness",
    topMin: respTop - 1,
    topMax: bounds.minTop + bounds.height * 0.95,
    leftMin: -Infinity,
    leftMax: Infinity,
  };

  const idleLeft = labels.idleLabel?.left ?? null;
  const downloadRespLeft = labels.downloadResponsivenessLabel?.left ?? null;
  const uploadRespLeft = labels.uploadResponsivenessLabel?.left ?? null;

  const idleColumnZone = {
    name: "idle_column",
    topMin: labels.idleLabel?.top ?? responsivenessZone.topMin,
    // Keep Idle column tall enough for Ping + Low/High + Jitter rows on clear screenshots.
    topMax: Math.min(
      bounds.maxBottom + 1,
      Math.max(
        responsivenessZone.topMax,
        (labels.idleLabel?.top ?? responsivenessZone.topMin) + bounds.height * 0.4,
      ),
    ),
    leftMin: idleLeft !== null ? idleLeft - bounds.width * 0.08 : bounds.minLeft - 1,
    leftMax: downloadRespLeft !== null
      ? downloadRespLeft - 4
      : (uploadRespLeft !== null ? uploadRespLeft - 4 : bounds.minLeft + bounds.width * 0.38),
  };

  const downloadRespColumnZone = {
    name: "download_resp_column",
    topMin: labels.downloadResponsivenessLabel?.top ?? responsivenessZone.topMin,
    topMax: idleColumnZone.topMax,
    leftMin: downloadRespLeft !== null ? downloadRespLeft - bounds.width * 0.05 : midX,
    leftMax: uploadRespLeft !== null ? uploadRespLeft - 4 : Infinity,
  };

  const uploadRespColumnZone = {
    name: "upload_resp_column",
    topMin: labels.uploadResponsivenessLabel?.top ?? responsivenessZone.topMin,
    topMax: idleColumnZone.topMax,
    leftMin: uploadRespLeft !== null ? uploadRespLeft - bounds.width * 0.05 : bounds.minLeft + bounds.width * 0.62,
    leftMax: Infinity,
  };

  const footerZone = {
    name: "footer",
    topMin: bounds.minTop + bounds.height * 0.78,
    topMax: bounds.maxBottom + 1,
    leftMin: -Infinity,
    leftMax: Infinity,
  };

  return {
    hasGeometry: bounds.hasGeometry,
    headerZone,
    speedZone,
    downloadCardZone,
    uploadCardZone,
    responsivenessZone,
    idleColumnZone,
    downloadRespColumnZone,
    uploadRespColumnZone,
    footerZone,
    sideBySide,
  };
}

function lineInZone(line, zone) {
  if (!zone || line.top === null || line.left === null) return false;
  if (line.top < zone.topMin || line.top > zone.topMax) return false;
  if (line.left < (zone.leftMin ?? -Infinity) || line.left > (zone.leftMax ?? Infinity)) return false;
  return true;
}

function extractNumbersFromLine(line) {
  return [...String(line?.text || "").matchAll(/(\d+(?:\.\d+)?)/g)]
    .map((match) => ({ value: cleanNumber(match[1]), raw: match[1], line }))
    .filter((item) => item.value !== null);
}

function lineHasNearbyMbps(line, lines = [], bounds) {
  if (/\bmbps\b/i.test(line?.text || "")) return true;
  if (line?.top === null) return lines.some((other) => /\bmbps\b/i.test(other.text));
  const maxGap = bounds?.height ? bounds.height * 0.12 : 110;
  return lines.some((other) => {
    if (!/\bmbps\b/i.test(other.text) || other.top === null) return false;
    if (other.top < line.top - 10 || other.top > line.top + maxGap) return false;
    const delta = Math.abs((other.centerX ?? other.left ?? 0) - (line.centerX ?? line.left ?? 0));
    return delta < (bounds?.width ? bounds.width * 0.22 : 160);
  });
}

function nearestSpeedField(line, labels, zones, bounds) {
  if (zones.sideBySide && labels.downloadLabel && labels.uploadLabel) {
    const point = line.centerX ?? line.left;
    const dl = labels.downloadLabel.centerX ?? labels.downloadLabel.left;
    const ul = labels.uploadLabel.centerX ?? labels.uploadLabel.left;
    if (point === null || dl === null || ul === null) return null;
    return Math.abs(point - dl) <= Math.abs(point - ul) ? "dlMbps" : "ulMbps";
  }
  if (lineInZone(line, zones.downloadCardZone)) return "dlMbps";
  if (lineInZone(line, zones.uploadCardZone)) return "ulMbps";
  const x = relX(line, bounds);
  if (x === null) return null;
  return x < 0.5 ? "dlMbps" : "ulMbps";
}

function rejectSpeedNoise(fieldName, value, line, resultId, tracker, zones) {
  if (matchesResultId(value, resultId) || isLongIdNumber(value)) {
    tracker.reject(fieldName, value, "Result ID / long ID rejected as speed", line);
    return true;
  }
  if (isResultIdLine(line?.text || "") || isDataUsedLine(line?.text || "") || isAdLine(line?.text || "")) {
    tracker.reject(fieldName, value, "Data-used / Result ID / ad rejected as speed", line);
    return true;
  }
  if (isLowHighLine(line?.text || "") && !/\bmbps\b/i.test(line?.text || "")) {
    tracker.reject(fieldName, value, "Low/High row rejected as speed", line);
    return true;
  }
  if (zones.hasGeometry && line && lineInZone(line, zones.responsivenessZone)) {
    tracker.reject(fieldName, value, "Speed value found after Responsiveness begins", line);
    return true;
  }
  if (/\b(ping|jitter|idle|ms)\b/i.test(line?.text || "") && !/\bmbps\b/i.test(line?.text || "")) {
    tracker.reject(fieldName, value, "Ping/Jitter number rejected as speed", line);
    return true;
  }
  return false;
}

function makeField(value, confidence, reason, sourceLine, source = "main_screenshot_ocr") {
  if (value === null || value === undefined || value === "") return null;
  return {
    value,
    source,
    confidence,
    reason,
    sourceLine: sourceLine?.text || null,
    boundingBox: serializeBox(sourceLine),
  };
}

function pickSpeedsFromZones(linesSorted, labels, zones, bounds, resultId, tracker) {
  const speedLines = linesSorted.filter((line) => (
    line.top !== null
    && line.top < zones.responsivenessZone.topMin
    && !lineInZone(line, zones.responsivenessZone)
  ));

  const grouped = { dlMbps: [], ulMbps: [] };

  for (const line of speedLines) {
    if (isDecorativeNoise(line.text)) continue;
    if (isDataUsedLine(line.text) || isAdLine(line.text) || isResultIdLine(line.text)) {
      for (const item of extractNumbersFromLine(line)) {
        rejectSpeedNoise("dlMbps", item.value, line, resultId, tracker, zones);
      }
      continue;
    }

    const mbpsMatch = line.text.match(/(\d+(?:\.\d+)?)\s*mbps/i);
    const bareMatch = line.text.match(/^\s*(\d+(?:\.\d+)?)\s*$/);
    const raw = mbpsMatch?.[1] || bareMatch?.[1];
    if (!raw) continue;
    const value = cleanNumber(raw);
    if (value === null || value <= 0) continue;

    const field = nearestSpeedField(line, labels, zones, bounds);
    if (!field) {
      tracker.reject("dlMbps", value, "Speed number outside Download/Upload card zones", line);
      continue;
    }
    if (rejectSpeedNoise(field, value, line, resultId, tracker, zones)) continue;

    const inCard = field === "dlMbps"
      ? lineInZone(line, zones.downloadCardZone)
      : lineInZone(line, zones.uploadCardZone);
    const nearbyMbps = Boolean(mbpsMatch) || lineHasNearbyMbps(line, speedLines, bounds);

    let confidence = "low";
    let reason = `${field === "dlMbps" ? "Download" : "Upload"} candidate`;
    if (inCard && nearbyMbps) {
      confidence = "high";
      reason = `${field === "dlMbps" ? "Download" : "Upload"} card value with Mbps nearby`;
    } else if (inCard && bareMatch) {
      confidence = "high";
      reason = `${field === "dlMbps" ? "Download" : "Upload"} card bare value (split Mbps layout)`;
    } else if (nearbyMbps) {
      confidence = "medium";
      reason = `${field === "dlMbps" ? "Download" : "Upload"} nearest-label with Mbps`;
    } else {
      confidence = "low";
      reason = `${field === "dlMbps" ? "Download" : "Upload"} uncertain bare number`;
    }

    grouped[field].push({ value, line, confidence, reason, score: value + (CONFIDENCE_RANK[confidence] * 10000) });
  }

  const pick = (fieldName) => {
    let list = grouped[fieldName] || [];
    if (fieldName === "ulMbps") {
      // Hard rule: Upload must come from Upload card only — never Download card / DL fallback.
      list = list.filter((item) => {
        const inUpload = lineInZone(item.line, zones.uploadCardZone);
        const inDownload = lineInZone(item.line, zones.downloadCardZone);
        if (inDownload && !inUpload) {
          tracker.reject("ulMbps", item.value, "UL candidate was in Download card — ignored", item.line);
          return false;
        }
        if (!inUpload && item.confidence !== "high") {
          tracker.reject("ulMbps", item.value, "UL not confidently in Upload card — left blank", item.line);
          return false;
        }
        return true;
      });
    }
    if (!list.length) return null;
    list.sort((a, b) => b.score - a.score || b.value - a.value);
    const best = list[0];
    list.slice(1).forEach((item) => {
      tracker.reject(fieldName, item.value, "Secondary speed candidate ignored", item.line);
    });
    tracker.accept(fieldName, best.value, best.reason, best.line, best.confidence);
    return makeField(best.value, best.confidence, best.reason, best.line, "main_screenshot_ocr");
  };

  const dlMbps = pick("dlMbps");
  let ulMbps = pick("ulMbps");
  if (ulMbps && dlMbps && Number(ulMbps.value) === Number(dlMbps.value)) {
    tracker.reject("ulMbps", ulMbps.value, "UL equals DL — not copied; leave blank", null);
    tracker.warn("UL not confidently read. Please enter manually.");
    ulMbps = null;
  }
  if (!ulMbps && grouped.ulMbps?.length) {
    tracker.warn("UL not confidently read. Please enter manually.");
  }

  return { dlMbps, ulMbps };
}

function pickIdlePingJitter(idleLines, zones, resultId, tracker) {
  let ping = null;
  let jitter = null;
  const usable = idleLines.filter((line) => {
    if (isAdLine(line.text) || isResultIdLine(line.text) || isDataUsedLine(line.text)) return false;
    if (/\b(download|upload)\b/i.test(line.text) && !/\bidle\b/i.test(line.text)) return false;
    if (zones.hasGeometry && (lineInZone(line, zones.downloadRespColumnZone) || lineInZone(line, zones.uploadRespColumnZone))) {
      return false;
    }
    return true;
  });

  const jitterLabel = usable.find((line) => /\bjitter\b/i.test(line.text));

  for (const line of usable) {
    if (/\bjitter\b/i.test(line.text)) {
      const glued = line.text.match(/\bjitter\s*(\d+(?:\.\d+)?)/i) || line.text.match(/jitter(\d+(?:\.\d+)?)/i);
      if (glued?.[1]) {
        const value = cleanNumber(glued[1]);
        if (value !== null && value <= 200 && !matchesResultId(value, resultId) && !jitter) {
          jitter = makeField(value, "high", "Idle column jitter", line);
          tracker.accept("jitterMs", value, "Idle column jitter", line, "high");
        }
        continue;
      }
      const below = usable.find((other) => (
        other.index !== line.index
        && other.top !== null
        && line.top !== null
        && other.top >= line.top
        && other.top <= line.top + 80
        && /^\s*(\d+(?:\.\d+)?)\s*$/.test(other.text)
      ));
      const splitValue = cleanNumber(below?.text.match(/(\d+(?:\.\d+)?)/)?.[1] ?? null);
      if (splitValue !== null && splitValue <= 200 && !jitter) {
        jitter = makeField(splitValue, "high", "Idle column jitter (split label/value)", below);
        tracker.accept("jitterMs", splitValue, "Idle column jitter (split label/value)", below, "high");
      }
      continue;
    }

    if (isLowHighLine(line.text) && !/\bjitter\b/i.test(line.text)) {
      for (const item of extractNumbersFromLine(line)) {
        tracker.reject("pingMs", item.value, "Low/High row rejected as ping", line);
      }
      continue;
    }

    if (/\bidle\b/i.test(line.text)) {
      const value = cleanNumber(line.text.match(/\bidle\b[\s:]*(\d+(?:\.\d+)?)/i)?.[1] ?? null);
      if (value !== null && value <= 400 && !matchesResultId(value, resultId) && !ping) {
        ping = makeField(value, "high", "Idle label line ping", line);
        tracker.accept("pingMs", value, "Idle label line ping", line, "high");
      }
      continue;
    }

    if (!/^\s*(\d+(?:\.\d+)?)\s*$/.test(line.text)) continue;
    const value = cleanNumber(line.text);
    if (value === null || value > 400 || matchesResultId(value, resultId)) continue;

    if (
      ping
      && !jitter
      && jitterLabel
      && line.top !== null
      && jitterLabel.top !== null
      && line.top >= jitterLabel.top
      && line.top <= jitterLabel.top + 80
    ) {
      jitter = makeField(value, "high", "Idle bare value under Jitter label", line);
      tracker.accept("jitterMs", value, "Idle bare value under Jitter label", line, "high");
      continue;
    }

    if (!ping) {
      ping = makeField(value, "high", "Idle column ping value", line);
      tracker.accept("pingMs", value, "Idle column ping value", line, "high");
    } else {
      tracker.reject("pingMs", value, "Extra idle-column number ignored after ping accepted", line);
    }
  }

  return { pingMs: ping, jitterMs: jitter };
}

function pickResultId(linesSorted, labels, tracker) {
  const idAfterLabel = (text = "") => {
    const match = String(text).match(/(?:test|result)\s*(?:id|#)?\s*[:#]?\s*(\d{6,})/i);
    return match?.[1] || null;
  };

  /** Stitch only when OCR splits the ID onto the next pure-digit line(s). */
  const tryStitchDigits = (labelLine) => {
    if (!labelLine) return null;
    const idx = linesSorted.findIndex((line) => line === labelLine || (
      line.top === labelLine.top && line.left === labelLine.left && line.text === labelLine.text
    ));
    const start = idx >= 0 ? idx : -1;
    if (start < 0) return null;

    // Only digits immediately after Test/Result ID on this line — never every number on the line.
    let digits = idAfterLabel(labelLine.text) || "";
    if (!digits && /(?:test|result)\s*(?:id|#)?\s*$/i.test(labelLine.text.trim())) {
      digits = "";
    } else if (!digits) {
      return null;
    }

    for (let offset = 1; offset <= 2; offset += 1) {
      const next = linesSorted[start + offset];
      if (!next) break;
      const nextText = String(next.text || "").trim();
      if (labelLine.top !== null && next.top !== null && next.top > labelLine.top + 60) break;
      if (!/^\d{2,8}$/.test(nextText)) break;
      // Avoid gluing unrelated values (ping/jitter) — only extend short/truncated IDs.
      if (digits.length >= 10) break;
      digits += nextText;
    }

    if (/^\d{10,14}$/.test(digits)) return digits;
    if (/^\d{6,9}$/.test(digits)) return digits;
    return null;
  };

  const chooseId = (line) => {
    const inline = idAfterLabel(line.text) || extractResultIdFromText(line.text);
    const stitched = tryStitchDigits(line);
    if (stitched && (!inline || stitched.length > inline.length)) return stitched;
    return inline || stitched;
  };

  if (labels.resultIdLabel) {
    const value = chooseId(labels.resultIdLabel);
    if (value) {
      const confidence = value.length >= 10 ? "high" : "medium";
      tracker.accept("resultId", value, "Test ID / Result ID label line", labels.resultIdLabel, confidence);
      if (value.length < 10) {
        tracker.warn("Screenshot Result ID may be truncated. Prefer Result URL ID when available.");
      }
      return makeField(value, confidence, "Test ID / Result ID label line", labels.resultIdLabel);
    }
  }
  for (const line of linesSorted) {
    if (!isResultIdLine(line.text)) continue;
    const value = chooseId(line);
    if (value) {
      const confidence = value.length >= 10 ? "high" : "medium";
      tracker.accept("resultId", value, "Test ID / Result ID line", line, confidence);
      if (value.length < 10) {
        tracker.warn("Screenshot Result ID may be truncated. Prefer Result URL ID when available.");
      }
      return makeField(value, confidence, "Test ID / Result ID line", line);
    }
  }
  tracker.warn("Result ID not clearly visible in screenshot");
  return null;
}

function pickFooterNames(linesSorted, labels, zones, tracker) {
  let providerName = null;
  let serverName = null;

  const readName = (label, fieldName) => {
    if (!label) return null;
    const same = label.text.replace(/^(server|connections|provider|isp)\s*[:#-]?/i, "").trim();
    if (same && same.length >= 2 && !/\b(download|upload|ping|jitter|mbps|result|test|idle)\b/i.test(same) && !isDeviceModelLine(same)) {
      tracker.accept(fieldName, same, "Name on label line", label, "high");
      return makeField(same, "high", "Name on label line", label);
    }
    if (label.top === null) return null;
    const nearby = linesSorted.find((line) => (
      line.index !== label.index
      && line.top !== null
      && line.top >= label.top
      && line.top <= label.top + 70
      && Math.abs((line.left ?? 0) - (label.left ?? 0)) < 280
      && /[A-Za-z]/.test(line.text)
      && !/\b(download|upload|ping|jitter|mbps|result|test|idle|low|high|speed|responsiveness)\b/i.test(line.text)
      && !isDeviceModelLine(line.text)
      && !isAdLine(line.text)
    ));
    if (nearby) {
      const value = cleanText(nearby.text);
      if (value) {
        tracker.accept(fieldName, value, "Name near clear footer label", nearby, "high");
        return makeField(value, "high", "Name near clear footer label", nearby);
      }
    }
    tracker.warn(`${fieldName} label seen but name not confidently identified`);
    return null;
  };

  if (labels.providerLabel) providerName = readName(labels.providerLabel, "providerName");
  if (labels.serverLabel) serverName = readName(labels.serverLabel, "serverName");

  // Footer-only speculative names stay medium/low and will not auto-fill.
  if (!providerName || !serverName) {
    const footerLines = linesSorted.filter((line) => lineInZone(line, zones.footerZone));
    for (const line of footerLines) {
      if (isDeviceModelLine(line.text) || isAdLine(line.text) || isResultIdLine(line.text)) continue;
      if (!/[A-Za-z]{3,}/.test(line.text)) continue;
      if (/\b(share|copy|done|save|close|retry)\b/i.test(line.text)) continue;
      if (!providerName && /\b(spectrum|verizon|t-mobile|att|comcast|xfinity|sprint|isp)\b/i.test(line.text)) {
        providerName = makeField(cleanText(line.text), "medium", "Footer ISP-like text", line);
        tracker.accept("providerName", providerName.value, providerName.reason, line, "medium");
      }
    }
  }

  if (serverName && providerName && String(serverName.value).toLowerCase() === String(providerName.value).toLowerCase()) {
    tracker.reject("serverName", serverName.value, "Provider must not be copied as Server", null);
    serverName = null;
  }

  return { providerName, serverName };
}

function parseFromTextFallback(rawText, resultId, tracker) {
  const text = normalizeOcrText(rawText);
  const split = text.match(/\b(responsiveness|ping\s*ms)\b/i);
  const speedSection = split?.index >= 0 ? text.slice(0, split.index) : text;
  const respSection = split?.index >= 0 ? text.slice(split.index) : "";

  let dlMbps = null;
  let ulMbps = null;
  let pingMs = null;
  let jitterMs = null;

  const dlMatch = speedSection.match(/download\s*mbps\s+(\d+(?:\.\d+)?)/i)
    || speedSection.match(/download[\s\S]{0,120}?(\d+(?:\.\d+)?)\s*mbps/i)
    || speedSection.match(/download(?:(?!\bupload\b)[\s\S]){0,80}?(\d+(?:\.\d+)?)(?:(?!\bupload\b)[\s\S]){0,40}?\bmbps\b/i);
  if (dlMatch?.[1]) {
    const value = cleanNumber(dlMatch[1]);
    if (value !== null && !matchesResultId(value, resultId) && !isLongIdNumber(value) && !/\bdata used\b/i.test(dlMatch[0])) {
      dlMbps = makeField(value, "medium", "Text-fallback Download (no geometry)", null);
      tracker.accept("dlMbps", value, dlMbps.reason, null, "medium");
    }
  }

  const ulMatch = speedSection.match(/upload\s*mbps\s+(\d+(?:\.\d+)?)/i)
    || speedSection.match(/upload[\s\S]{0,120}?(\d+(?:\.\d+)?)\s*mbps/i)
    || speedSection.match(/upload(?:(?!\bdownload\b)[\s\S]){0,80}?(\d+(?:\.\d+)?)(?:(?!\bdownload\b)[\s\S]){0,40}?\bmbps\b/i);
  if (ulMatch?.[1]) {
    const value = cleanNumber(ulMatch[1]);
    if (value !== null && !matchesResultId(value, resultId) && !isLongIdNumber(value) && value !== dlMbps?.value) {
      ulMbps = makeField(value, "medium", "Text-fallback Upload (no geometry)", null);
      tracker.accept("ulMbps", value, ulMbps.reason, null, "medium");
    }
  }

  // Idle ping/jitter may appear even when OCR omits the "Responsiveness" heading.
  const idleSource = respSection || text;
  const idleColumn = idleSource.match(/\bidle\b([\s\S]{0,160}?)(?=\bdownload\b|\bupload\b|$)/i)?.[1] || "";
  const idlePing = idleSource.match(/\bidle\b[\s:]*(\d+(?:\.\d+)?)/i)
    || idleColumn.match(/^\s*(\d+(?:\.\d+)?)/i);
  if (idlePing?.[1]) {
    const value = cleanNumber(idlePing[1]);
    if (value !== null && value <= 400 && !matchesResultId(value, resultId)) {
      pingMs = makeField(value, "medium", "Text-fallback Idle ping", null);
      tracker.accept("pingMs", value, pingMs.reason, null, "medium");
    }
  }

  const idleJitter = idleColumn.match(/\bjitter\s*(\d+(?:\.\d+)?)/i)
    || idleColumn.match(/jitter(\d+(?:\.\d+)?)/i)
    // Only Idle→Jitter when Download/Upload responsiveness columns are not crossed.
    || idleSource.match(/\bidle\b(?:(?!\bdownload\b)(?!\bupload\b)[\s\S]){0,120}?\bjitter\s*(\d+(?:\.\d+)?)/i);
  if (idleJitter?.[1]) {
    const value = cleanNumber(idleJitter[1]);
    if (value !== null && value <= 200 && !matchesResultId(value, resultId)) {
      jitterMs = makeField(value, "medium", "Text-fallback Idle jitter", null);
      tracker.accept("jitterMs", value, jitterMs.reason, null, "medium");
    }
  }

  return { dlMbps, ulMbps, pingMs, jitterMs };
}

function fieldValue(field) {
  return field?.value ?? null;
}

function confidenceMap(fields) {
  const map = {};
  Object.entries(fields).forEach(([key, field]) => {
    if (field?.confidence) map[key] = field.confidence;
  });
  return map;
}

function fieldMetaMap(fields) {
  const map = {};
  Object.entries(fields).forEach(([key, field]) => {
    if (field) map[key] = field;
  });
  return map;
}

function emptyMainOcrSuggestions() {
  return {
    dlMbps: null,
    ulMbps: null,
    pingMs: null,
    jitterMs: null,
    resultId: null,
    testDateTime: null,
  };
}

function emptyMainOcrDebug(extra = {}) {
  return {
    rawText: "",
    lines: [],
    sortedLines: [],
    linesSortedByTopLeft: [],
    detectedLabels: {},
    detectedZones: {},
    acceptedCandidates: [],
    rejectedCandidates: [],
    finalSuggestions: {},
    fieldMeta: {},
    parserWarnings: [],
    errors: [],
    ...extra,
  };
}

/** Always-safe main OCR parse result (never undefined nested collections). */
function buildSafeMainOcrResult(partial = {}) {
  const suggestions = {
    ...emptyMainOcrSuggestions(),
    ...(partial.suggestions || {}),
  };
  const debug = emptyMainOcrDebug(partial.debug || partial.ocrDebug || {});
  debug.lines = Array.isArray(debug.lines) ? debug.lines : [];
  debug.sortedLines = Array.isArray(debug.sortedLines)
    ? debug.sortedLines
    : (Array.isArray(debug.linesSortedByTopLeft) ? debug.linesSortedByTopLeft : []);
  debug.linesSortedByTopLeft = Array.isArray(debug.linesSortedByTopLeft) ? debug.linesSortedByTopLeft : debug.sortedLines;
  debug.acceptedCandidates = Array.isArray(debug.acceptedCandidates) ? debug.acceptedCandidates : [];
  debug.rejectedCandidates = Array.isArray(debug.rejectedCandidates) ? debug.rejectedCandidates : [];
  debug.detectedLabels = debug.detectedLabels && typeof debug.detectedLabels === "object" ? debug.detectedLabels : {};
  debug.detectedZones = debug.detectedZones && typeof debug.detectedZones === "object" ? debug.detectedZones : {};
  debug.finalSuggestions = debug.finalSuggestions && typeof debug.finalSuggestions === "object" ? debug.finalSuggestions : {};
  debug.fieldMeta = debug.fieldMeta && typeof debug.fieldMeta === "object" ? debug.fieldMeta : {};
  debug.parserWarnings = Array.isArray(debug.parserWarnings) ? debug.parserWarnings : [];
  debug.errors = Array.isArray(debug.errors) ? debug.errors : [];

  return {
    dlMbps: suggestions.dlMbps ?? partial.dlMbps ?? null,
    ulMbps: suggestions.ulMbps ?? partial.ulMbps ?? null,
    pingMs: suggestions.pingMs ?? partial.pingMs ?? null,
    jitterMs: suggestions.jitterMs ?? partial.jitterMs ?? null,
    resultId: suggestions.resultId ?? partial.resultId ?? null,
    testDateTime: suggestions.testDateTime ?? partial.testDateTime ?? null,
    serverName: partial.serverName ?? null,
    providerName: partial.providerName ?? null,
    suggestions,
    fieldConfidence: partial.fieldConfidence && typeof partial.fieldConfidence === "object" ? partial.fieldConfidence : {},
    fieldSources: partial.fieldSources && typeof partial.fieldSources === "object" ? partial.fieldSources : {},
    fieldMeta: partial.fieldMeta && typeof partial.fieldMeta === "object" ? partial.fieldMeta : {},
    fieldsFound: Array.isArray(partial.fieldsFound) ? partial.fieldsFound : [],
    warnings: Array.isArray(partial.warnings)
      ? partial.warnings
      : (Array.isArray(partial.parserWarnings) ? partial.parserWarnings : []),
    parserWarnings: Array.isArray(partial.parserWarnings) ? partial.parserWarnings : [],
    errors: Array.isArray(partial.errors) ? partial.errors : [],
    rejectedSuspicious: Boolean(partial.rejectedSuspicious),
    debug,
    ocrDebug: debug,
  };
}

function compactDetectedLabels(labels = {}) {
  const out = {};
  Object.entries(labels || {}).forEach(([key, label]) => {
    if (!label || typeof label !== "object") return;
    out[key] = label;
  });
  return out;
}

export function parseOoklaOcrText(rawText = "", lines = []) {
  try {
    const tracker = createCandidateTracker();
    const enriched = enrichLines(rawText, lines);

    if (!enriched.rawText.trim() && !enriched.lines.length) {
      return buildSafeMainOcrResult({
        suggestions: emptyMainOcrSuggestions(),
        parserWarnings: ["OCR text empty"],
        warnings: ["OCR text empty"],
        debug: emptyMainOcrDebug({ parserWarnings: ["OCR text empty"] }),
      });
    }

    const bounds = computeBounds(enriched.linesSortedByTopLeft);
    const labels = detectLabels(enriched.linesSortedByTopLeft, bounds);
    const zones = buildLayoutZones(enriched.linesSortedByTopLeft, labels, bounds);

    const resultIdField = pickResultId(enriched.linesSortedByTopLeft, labels, tracker)
      || (() => {
        const fromText = extractResultIdFromText(enriched.rawText);
        if (!fromText) return null;
        tracker.accept("resultId", fromText, "Result ID from OCR text", null, "medium");
        return makeField(fromText, "medium", "Result ID from OCR text", null);
      })();
    const resultId = fieldValue(resultIdField);

    let dlMbps = null;
    let ulMbps = null;
    let pingMs = null;
    let jitterMs = null;
    let serverName = null;
    let providerName = null;

    if (zones.hasGeometry && (labels.downloadLabel || labels.uploadLabel || labels.idleLabel || labels.speedSection)) {
      const speeds = pickSpeedsFromZones(enriched.linesSortedByTopLeft, labels, zones, bounds, resultId, tracker);
      dlMbps = speeds?.dlMbps ?? null;
      ulMbps = speeds?.ulMbps ?? null;

      const idleLines = enriched.linesSortedByTopLeft.filter((line) => lineInZone(line, zones.idleColumnZone));
      if (labels.idleLabel) {
        const idleValues = pickIdlePingJitter(idleLines, zones, resultId, tracker);
        pingMs = idleValues?.pingMs ?? null;
        jitterMs = idleValues?.jitterMs ?? null;
      } else {
        tracker.warn("Idle column not confidently identified; Ping/Jitter left blank");
      }

      const names = pickFooterNames(enriched.linesSortedByTopLeft, labels, zones, tracker);
      providerName = names?.providerName ?? null;
      serverName = names?.serverName ?? null;
    } else {
      tracker.warn("Geometry incomplete; using conservative text fallback (medium confidence only)");
      const fallback = parseFromTextFallback(enriched.rawText, resultId, tracker);
      dlMbps = fallback?.dlMbps ?? null;
      ulMbps = fallback?.ulMbps ?? null;
      pingMs = fallback?.pingMs ?? null;
      jitterMs = fallback?.jitterMs ?? null;
    }

    // Hard final guards
    if (dlMbps && (matchesResultId(dlMbps.value, resultId) || isLongIdNumber(dlMbps.value))) {
      tracker.reject("dlMbps", dlMbps.value, "Final guard: Result ID as DL", null);
      dlMbps = null;
    }
    if (ulMbps && (matchesResultId(ulMbps.value, resultId) || isLongIdNumber(ulMbps.value) || (pingMs && ulMbps.value === pingMs.value))) {
      tracker.reject("ulMbps", ulMbps.value, "Final guard: Result ID / ping-like UL", null);
      ulMbps = null;
    }
    if (pingMs && matchesResultId(pingMs.value, resultId)) {
      tracker.reject("pingMs", pingMs.value, "Final guard: Result ID as Ping", null);
      pingMs = null;
    }
    if (jitterMs && (matchesResultId(jitterMs.value, resultId) || (dlMbps && jitterMs.value === dlMbps.value) || (ulMbps && jitterMs.value === ulMbps.value))) {
      tracker.reject("jitterMs", jitterMs.value, "Final guard: suspicious jitter", null);
      jitterMs = null;
    }

    const testDateTimeField = pickTestDateTime(enriched.linesSortedByTopLeft, tracker)
      || (() => {
        const fromText = extractTestDateTimeFromText(enriched.rawText);
        if (!fromText) return null;
        tracker.accept("testDateTime", fromText, "Main screenshot date/time (text)", null, "medium");
        return makeField(fromText, "medium", "Main screenshot date/time (text)", null);
      })();

    const fieldObjects = {
      dlMbps,
      ulMbps,
      pingMs,
      jitterMs,
      serverName,
      providerName,
      resultId: resultIdField,
      testDateTime: testDateTimeField,
    };

    const fields = {
      dlMbps: fieldValue(dlMbps),
      ulMbps: fieldValue(ulMbps),
      pingMs: fieldValue(pingMs),
      jitterMs: fieldValue(jitterMs),
      serverName: fieldValue(serverName),
      providerName: fieldValue(providerName),
      resultId: fieldValue(resultIdField),
      testDateTime: fieldValue(testDateTimeField),
    };

    const fieldConfidence = confidenceMap(fieldObjects);
    const fieldMeta = fieldMetaMap(fieldObjects);
    const fieldsFound = Object.entries(fields)
      .filter(([, value]) => value !== null && value !== "")
      .map(([key]) => key);

    const finalSuggestions = buildOcrSuggestionsForDraft({ ...fields, fieldConfidence, fieldMeta });
    const detectedZones = Object.fromEntries(
      Object.entries(zones || {})
        .filter(([, zone]) => zone && typeof zone === "object" && zone.name)
        .map(([key, zone]) => [key, {
          name: zone.name,
          topMin: Number.isFinite(zone.topMin) ? zone.topMin : null,
          topMax: Number.isFinite(zone.topMax) ? zone.topMax : null,
          leftMin: Number.isFinite(zone.leftMin) ? zone.leftMin : null,
          leftMax: Number.isFinite(zone.leftMax) ? zone.leftMax : null,
        }]),
    );

    // Omit null labels — rendering null.label.text caused black-screen crash (Fix13).
    const detectedLabels = compactDetectedLabels({
      downloadLabel: serializeLabel(labels.downloadLabel),
      uploadLabel: serializeLabel(labels.uploadLabel),
      speedSection: serializeLabel(labels.speedSection),
      responsivenessSection: serializeLabel(labels.responsivenessSection),
      idleLabel: serializeLabel(labels.idleLabel),
      downloadResponsivenessLabel: serializeLabel(labels.downloadResponsivenessLabel),
      uploadResponsivenessLabel: serializeLabel(labels.uploadResponsivenessLabel),
      pingLabel: serializeLabel(labels.pingLabel),
      resultIdLabel: serializeLabel(labels.resultIdLabel),
      providerLabel: serializeLabel(labels.providerLabel),
      serverLabel: serializeLabel(labels.serverLabel),
    });

    const sortedLines = (enriched.linesSortedByTopLeft || []).map((line) => ({
      text: line?.text ?? "",
      left: line?.left ?? null,
      top: line?.top ?? null,
      width: line?.width ?? null,
      height: line?.height ?? null,
      centerX: line?.centerX ?? null,
      centerY: line?.centerY ?? null,
    }));

    const ocrDebug = emptyMainOcrDebug({
      rawText: enriched.rawText || "",
      lines: (enriched.lines || []).map((line) => ({
        text: line?.text ?? "",
        left: line?.left ?? null,
        top: line?.top ?? null,
        width: line?.width ?? null,
        height: line?.height ?? null,
        centerX: line?.centerX ?? null,
        centerY: line?.centerY ?? null,
      })),
      sortedLines,
      linesSortedByTopLeft: sortedLines,
      detectedLabels,
      detectedZones,
      acceptedCandidates: Array.isArray(tracker.acceptedCandidates) ? tracker.acceptedCandidates : [],
      rejectedCandidates: Array.isArray(tracker.rejectedCandidates) ? tracker.rejectedCandidates : [],
      finalSuggestions: finalSuggestions || {},
      fieldMeta: fieldMeta || {},
      parserWarnings: Array.isArray(tracker.parserWarnings) ? tracker.parserWarnings : [],
      errors: [],
    });

    return buildSafeMainOcrResult({
      ...fields,
      suggestions: {
        dlMbps: fields.dlMbps,
        ulMbps: fields.ulMbps,
        pingMs: fields.pingMs,
        jitterMs: fields.jitterMs,
        resultId: fields.resultId,
        testDateTime: fields.testDateTime,
      },
      fieldsFound,
      fieldConfidence,
      fieldMeta,
      fieldSources: {},
      rejectedSuspicious: (tracker.rejectedCandidates || []).length > 0,
      parserWarnings: tracker.parserWarnings || [],
      warnings: tracker.parserWarnings || [],
      errors: [],
      debug: ocrDebug,
      ocrDebug,
    });
  } catch (error) {
    const message = String(error?.message || error || "Main screenshot OCR parser failed");
    return buildSafeMainOcrResult({
      suggestions: emptyMainOcrSuggestions(),
      parserWarnings: [message],
      warnings: [message],
      errors: [message],
      debug: emptyMainOcrDebug({
        rawText: String(rawText || ""),
        parserWarnings: [message],
        errors: [message],
      }),
    });
  }
}

function confidenceIsHigh(confidence) {
  if (confidence === "high") return true;
  if (typeof confidence === "number") return confidence >= 0.8;
  return false;
}

export function buildOcrSuggestionsForDraft(parsed = {}, { highConfidenceOnly = false } = {}) {
  const suggestions = {};
  const confidence = parsed.fieldConfidence || {};
  const meta = parsed.fieldMeta || {};
  const maybeSet = (key, value) => {
    if (value === null || value === undefined || String(value).trim() === "") return;
    const conf = meta[key]?.confidence || confidence[key];
    if (highConfidenceOnly && !confidenceIsHigh(conf)) return;
    suggestions[key] = String(value);
  };

  maybeSet("dlMbps", parsed.dlMbps);
  maybeSet("ulMbps", parsed.ulMbps);
  maybeSet("pingMs", parsed.pingMs);
  maybeSet("jitterMs", parsed.jitterMs);
  maybeSet("serverName", parsed.serverName);
  maybeSet("providerName", parsed.providerName);
  maybeSet("resultId", parsed.resultId);
  return suggestions;
}

export function buildHighConfidenceOcrSuggestions(parsed = {}) {
  return buildOcrSuggestionsForDraft(parsed, { highConfidenceOnly: true });
}

export function getOcrSuggestionMessage(parsed = {}, suggestions = {}) {
  const keys = Object.keys(suggestions);
  const expectedKeys = ["dlMbps", "ulMbps", "pingMs", "jitterMs"];
  const missing = expectedKeys.filter((key) => parsed[key] === null || parsed[key] === undefined || parsed[key] === "");
  const hasMediumOrLow = Object.values(parsed.fieldConfidence || {}).some((value) => value === "medium" || value === "low");

  if (!keys.length) {
    return "Some screenshot values could not be read confidently. Please enter missing values manually.";
  }

  let message = "OCR filled confident fields. Review and correct before saving.";
  if (missing.length || hasMediumOrLow) {
    message = "Some screenshot values could not be read confidently. Please enter missing values manually.";
  }
  if (parsed.rejectedSuspicious || (parsed.ocrDebug?.rejectedCandidates || []).length) {
    message += " Some OCR numbers were ignored because they looked like Result ID, data-used, or responsiveness values.";
  }
  return message;
}

export function checkResultIdMismatch(screenshotResultId, urlResultId) {
  const shot = String(screenshotResultId || "").trim();
  const url = String(urlResultId || "").trim();
  if (!shot || !url) return null;
  if (shot === url) return null;
  const truncation = checkResultIdTruncation(shot, url);
  if (truncation) return truncation;
  return "OOKLA Result ID mismatch between URL and screenshot. Please review.";
}

export function checkScreenshotResultIdMismatch(mainResultId, detailedResultId) {
  const main = String(mainResultId || "").trim();
  const detailed = String(detailedResultId || "").trim();
  if (!main || !detailed) return null;
  if (main === detailed) return null;
  return "OOKLA Result ID mismatch between screenshots. Please review.";
}

export function formatSuggestionLabel(key) {
  return FIELD_LABELS[key] || key;
}

export function applyOcrSuggestionsToDraft(draft, suggestions = {}) {
  return applySuggestionsToDraft(draft, suggestions);
}

export function applySuggestionsToDraft(draft, suggestions = {}) {
  const next = { ...draft };
  const applied = {};
  const skipped = {};

  Object.entries(suggestions).forEach(([key, value]) => {
    if (value === null || value === undefined || String(value).trim() === "") return;
    const current = String(next[key] ?? "").trim();
    const suggested = String(value).trim();
    if (!current) {
      next[key] = suggested;
      applied[key] = suggested;
      return;
    }
    // Result ID truncation upgrade: replace short prefix with fuller ID.
    if (
      key === "resultId"
      && /^\d+$/.test(current)
      && /^\d+$/.test(suggested)
      && suggested.length > current.length
      && suggested.startsWith(current)
    ) {
      next[key] = suggested;
      applied[key] = suggested;
      return;
    }
    if (current !== suggested) {
      skipped[key] = { current, suggested };
    }
  });

  return { draft: next, applied, skipped };
}

/**
 * Merge priority: manual > main OCR (speeds) > detailed OCR (details) > URL (identity).
 */
function trackFieldSource(value, source, confidence = null, reason = "") {
  return {
    value: String(value),
    source,
    confidence: confidence || null,
    reason: reason || "",
  };
}

function sourceLabel(entry) {
  if (!entry) return null;
  if (typeof entry === "string") return entry;
  return entry.source || null;
}

export function mergeOoklaEvidenceSuggestions({
  draft = {},
  mainSuggestions = {},
  detailedSuggestions = {},
  urlSuggestions = {},
  mainFieldMeta = {},
  detailedFieldMeta = {},
} = {}) {
  const merged = {};
  const fieldSources = { ...(draft.fieldSources || {}) };
  const mismatches = {};
  const allKeys = new Set([
    ...OOKLA_MAIN_SUGGESTION_KEYS,
    ...OOKLA_DETAILED_SUGGESTION_KEYS,
    "resultUrl",
  ]);

  allKeys.forEach((key) => {
    const existing = String(draft[key] ?? "").trim();
    const existingSource = sourceLabel(draft.fieldSources?.[key]);
    const mainVal = mainSuggestions[key] != null && String(mainSuggestions[key]).trim() !== ""
      ? String(mainSuggestions[key]).trim()
      : "";
    const detailedVal = detailedSuggestions[key] != null && String(detailedSuggestions[key]).trim() !== ""
      ? String(detailedSuggestions[key]).trim()
      : "";
    const urlVal = urlSuggestions[key] != null && String(urlSuggestions[key]).trim() !== ""
      ? String(urlSuggestions[key]).trim()
      : "";

    if (key === "resultId") {
      const preferred = preferFullResultId([
        urlVal ? { value: urlVal, source: "result_url" } : null,
        mainVal ? { value: mainVal, source: "main_screenshot_ocr" } : null,
        detailedVal ? { value: detailedVal, source: "detailed_screenshot_ocr" } : null,
        existing ? { value: existing, source: existingSource || "manual" } : null,
      ]);
      if (mainVal && detailedVal && mainVal !== detailedVal && !(
        mainVal.startsWith(detailedVal) || detailedVal.startsWith(mainVal)
      )) {
        mismatches[key] = { main: mainVal, detailed: detailedVal };
      }
      if (urlVal && (mainVal || detailedVal)) {
        const shot = mainVal || detailedVal;
        if (shot && urlVal !== shot && !urlVal.startsWith(shot) && !shot.startsWith(urlVal)) {
          mismatches.urlResultId = { url: urlVal, screenshot: shot };
        }
      }
      if (preferred?.warning) {
        mismatches.resultIdTruncation = {
          kept: preferred.value,
          source: preferred.source,
          truncated: preferred.truncatedCandidates,
          warning: preferred.warning,
        };
      }

      // Keep true FE manual edits unless a clearly fuller ID is available (truncation upgrade).
      if (existing && existingSource === "manual" && preferred?.value) {
        const upgradeTruncation = /^\d+$/.test(existing)
          && preferred.value.length > existing.length
          && preferred.value.startsWith(existing);
        if (!upgradeTruncation) {
          fieldSources[key] = trackFieldSource(existing, "manual", "high", "FE-entered or kept manual value");
          return;
        }
      }

      if (preferred?.value) {
        merged[key] = preferred.value;
        fieldSources[key] = trackFieldSource(
          preferred.value,
          preferred.source === "unknown" ? "main_screenshot_ocr" : preferred.source,
          preferred.value.length >= 10 ? "high" : "medium",
          preferred.warning || "Fuller Result ID preferred",
        );
      }
      return;
    }

    if (existing) {
      fieldSources[key] = trackFieldSource(existing, existingSource || "manual", "high", "FE-entered or kept draft value");
      return;
    }

    // Speed KPIs: main screenshot only — never detailed, never URL, never Result ID.
    if (["dlMbps", "ulMbps", "pingMs", "jitterMs"].includes(key)) {
      if (mainVal) {
        merged[key] = mainVal;
        const meta = mainFieldMeta[key] || {};
        fieldSources[key] = trackFieldSource(
          mainVal,
          "main_screenshot_ocr",
          meta.confidence || "high",
          meta.reason || "Main result screenshot OCR",
        );
      }
      return;
    }

    // Detailed identity/meta: prefer main when present, else detailed, else URL identity.
    if (mainVal) {
      merged[key] = mainVal;
      const meta = mainFieldMeta[key] || {};
      fieldSources[key] = trackFieldSource(
        mainVal,
        "main_screenshot_ocr",
        meta.confidence || "high",
        meta.reason || "Main result screenshot OCR",
      );
      return;
    }
    if (detailedVal) {
      merged[key] = detailedVal;
      const meta = detailedFieldMeta[key] || {};
      fieldSources[key] = trackFieldSource(
        detailedVal,
        "detailed_screenshot_ocr",
        meta.confidence || "high",
        meta.reason || "Detailed result screenshot OCR",
      );
      return;
    }
    if (key === "providerName" && urlVal) {
      merged[key] = urlVal;
      fieldSources[key] = trackFieldSource(urlVal, "result_url", "medium", "Result URL assist (identity only)");
    }
  });

  return { merged, fieldSources, mismatches };
}

export function mergeOoklaFieldSuggestions(urlSuggestions = {}, ocrSuggestions = {}, draft = {}) {
  return mergeOoklaEvidenceSuggestions({
    draft,
    mainSuggestions: ocrSuggestions,
    detailedSuggestions: {},
    urlSuggestions,
  });
}

export function applyHybridSuggestionsToDraft(draft, urlSuggestions = {}, ocrSuggestions = {}) {
  return applyOoklaEvidenceSuggestionsToDraft({
    draft,
    mainSuggestions: ocrSuggestions,
    detailedSuggestions: {},
    urlSuggestions,
  });
}

export function applyOoklaEvidenceSuggestionsToDraft({
  draft = {},
  mainSuggestions = {},
  detailedSuggestions = {},
  urlSuggestions = {},
  mainFieldMeta = {},
  detailedFieldMeta = {},
} = {}) {
  const { merged, fieldSources, mismatches } = mergeOoklaEvidenceSuggestions({
    draft,
    mainSuggestions,
    detailedSuggestions,
    urlSuggestions,
    mainFieldMeta,
    detailedFieldMeta,
  });
  const { draft: nextDraft, applied, skipped } = applySuggestionsToDraft(draft, merged);
  const mismatchNotes = [];
  if (mismatches.resultId) {
    mismatchNotes.push("OOKLA Result ID mismatch between screenshots. Please review.");
  }
  if (mismatches.urlResultId) {
    mismatchNotes.push("OOKLA Result ID mismatch between URL and screenshot. Please review.");
  }
  if (mismatches.resultIdTruncation?.warning) {
    mismatchNotes.push(mismatches.resultIdTruncation.warning);
  }

  return {
    draft: {
      ...nextDraft,
      fieldSources,
      urlAssistUsed: Object.keys(urlSuggestions).some((key) => applied[key] && sourceLabel(fieldSources[key]) === "result_url"),
      ocrAssistUsed: Object.keys(applied).some((key) => (
        sourceLabel(fieldSources[key]) === "main_screenshot_ocr"
        || sourceLabel(fieldSources[key]) === "detailed_screenshot_ocr"
      )),
      mainOcrAssistUsed: Object.keys(applied).some((key) => sourceLabel(fieldSources[key]) === "main_screenshot_ocr"),
      detailedOcrAssistUsed: Object.keys(applied).some((key) => sourceLabel(fieldSources[key]) === "detailed_screenshot_ocr"),
    },
    applied,
    skipped,
    mismatches,
    mismatchNotes,
    merged,
  };
}

export function countUrlValueFields(suggestions = {}) {
  return Object.keys(suggestions).filter((key) => key !== "resultId").length;
}

export function truncateOcrPreview(rawText = "", maxLength = 1200) {
  const text = String(rawText || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}

export function hasFeConfirmedSpeedValues(draft = {}) {
  const dl = String(draft.dlMbps ?? "").trim();
  const ul = String(draft.ulMbps ?? "").trim();
  return Boolean(dl) && Boolean(ul);
}

function hasFieldValue(draft = {}, key = "") {
  if (key === "mainScreenshot" || key === "screenshot") {
    return Boolean(
      draft?.mainScreenshot?.storageKey
      || draft?.mainScreenshot?.fileName
      || draft?.mainScreenshotFile
      || draft?.screenshot?.storageKey
      || draft?.screenshot?.fileName
      || draft?.screenshotFile,
    );
  }
  if (key === "detailedScreenshot") {
    return Boolean(
      draft?.detailedScreenshot?.storageKey
      || draft?.detailedScreenshot?.fileName
      || draft?.detailedScreenshotFile,
    );
  }
  if (key === "resultIdentity") {
    return Boolean(String(draft?.resultId || "").trim() || String(draft?.resultUrl || "").trim());
  }
  const value = draft?.[key];
  if (value === null || value === undefined) return false;
  return String(value).trim() !== "";
}

/** Required for basic OOKLA evidence save: DL + UL only. */
export const OOKLA_REQUIRED_EVIDENCE_KEYS = ["dlMbps", "ulMbps"];

export function getMissingRequiredOoklaFields(draft = {}) {
  return OOKLA_REQUIRED_EVIDENCE_KEYS.filter((key) => !hasFieldValue(draft, key));
}

export function getMissingOptionalOoklaFields(draft = {}) {
  const optionalKeys = [
    ...OOKLA_OPTIONAL_FIELD_KEYS,
    "pingMs",
    "jitterMs",
    "providerName",
    "serverName",
    "serverLocation",
    "resultId",
    "resultUrl",
    "testDateTime",
  ];
  // de-dupe while preserving order
  const seen = new Set();
  return optionalKeys.filter((key) => {
    if (seen.has(key)) return false;
    seen.add(key);
    if (key === "resultId" || key === "resultUrl") {
      return !hasFieldValue(draft, "resultIdentity");
    }
    return !hasFieldValue(draft, key);
  });
}

export function getMissingOoklaFields(draft = {}) {
  return getMissingOptionalOoklaFields(draft);
}

export function getMissingRecommendedOoklaFields(draft = {}) {
  return OOKLA_EVIDENCE_FIELD_KEYS.filter((key) => !hasFieldValue(draft, key));
}

export function canFeConfirmOoklaDraft(draft = {}) {
  const hasDl = Boolean(String(draft?.dlMbps ?? "").trim());
  const hasUl = Boolean(String(draft?.ulMbps ?? "").trim());
  const hasIdentity = hasFieldValue(draft, "resultIdentity");
  const hasMain = hasFieldValue(draft, "mainScreenshot");
  return hasDl && hasUl && hasIdentity && hasMain;
}

export function getFeConfirmBlockReason(draft = {}) {
  const missing = [];
  if (!String(draft?.dlMbps ?? "").trim()) missing.push("DL Mbps");
  if (!String(draft?.ulMbps ?? "").trim()) missing.push("UL Mbps");
  if (!hasFieldValue(draft, "resultIdentity")) missing.push("Result ID or Result URL");
  if (!hasFieldValue(draft, "mainScreenshot")) missing.push("Main screenshot");
  if (!missing.length) return "";
  return `Cannot save as FE-confirmed. Missing: ${missing.join(", ")}.`;
}

export function computeOoklaEvidenceCompleteness(draft = {}) {
  // Required-field completeness only (DL + UL). Optional blanks do not force partial.
  return getMissingRequiredOoklaFields(draft).length === 0 ? "complete" : "partial";
}

export function buildOoklaEvidenceStatus(draft = {}) {
  const requiredMissing = getMissingRequiredOoklaFields(draft);
  const optionalMissingFields = getMissingOptionalOoklaFields(draft);
  const requiredEvidenceStatus = requiredMissing.length === 0 ? "complete" : "partial";
  return {
    evidenceCompleteness: requiredEvidenceStatus,
    requiredEvidenceStatus,
    optionalMissingFields,
    missingFields: optionalMissingFields,
    requiredMissingFields: requiredMissing,
  };
}

export function getPartialEvidenceWarning(draft = {}) {
  const status = buildOoklaEvidenceStatus(draft);
  if (!hasFieldValue(draft, "detailedScreenshot")) {
    return "Detailed screenshot not provided. Extra OOKLA details will be missing.";
  }
  if (status.optionalMissingFields.length) {
    return `Optional OOKLA fields missing: ${status.optionalMissingFields.join(", ")}.`;
  }
  return "";
}

export function resolveOoklaValueSource(draft = {}) {
  const urlUsed = Boolean(draft?.urlAssistUsed);
  const ocrUsed = Boolean(draft?.ocrAssistUsed);
  if (urlUsed && ocrUsed) return "mixed";
  if (urlUsed) return "result_url";
  if (ocrUsed) return "ocr";
  return "manual";
}

export function buildApplyResultMessage(applied = {}, skipped = {}, sourceLabel = "OCR") {
  const appliedCount = Object.keys(applied).length;
  const skippedNotes = Object.keys(skipped).map(
    (key) => `${formatSuggestionLabel(key)}: Manual value kept.`,
  );

  if (appliedCount && skippedNotes.length) {
    return `Applied ${sourceLabel} suggestions to ${appliedCount} field(s). ${skippedNotes.join(" ")}`;
  }
  if (appliedCount) {
    return `Applied ${sourceLabel} suggestions to ${appliedCount} field(s). FE must still confirm before save.`;
  }
  if (skippedNotes.length) return skippedNotes.join(" ");
  return "No empty fields were updated. Existing draft values were kept.";
}

export function buildHybridApplyMessage(applied = {}, skipped = {}, mismatchNotes = []) {
  const parts = [];
  const appliedCount = Object.keys(applied).length;
  if (appliedCount) parts.push(`Auto-filled ${appliedCount} field(s) from screenshot OCR.`);
  parts.push(...Object.keys(skipped).map(
    (key) => `${formatSuggestionLabel(key)}: Manual value kept.`,
  ));
  parts.push(...mismatchNotes);
  return parts.filter(Boolean).join(" ") || "Review screenshot OCR fields before saving.";
}

export function isUrlFetchPartial(urlSuggestions = {}) {
  return Object.keys(urlSuggestions || {}).length > 0 && Object.keys(urlSuggestions || {}).length < 2;
}

export function needsOcrCompletion(draft = {}) {
  return SPEED_FIELD_KEYS.some((key) => !String(draft[key] ?? "").trim());
}

export function buildOoklaOcrDebugPayload(ocrDebug = null, parsed = {}) {
  if (!ocrDebug && !parsed?.ocrDebug && !parsed?.debug) return emptyMainOcrDebug();
  const debug = ocrDebug || parsed.ocrDebug || parsed.debug || {};
  const sorted = Array.isArray(debug.linesSortedByTopLeft)
    ? debug.linesSortedByTopLeft
    : (Array.isArray(debug.sortedLines) ? debug.sortedLines : []);
  return emptyMainOcrDebug({
    rawText: debug.rawText || "",
    lines: Array.isArray(debug.lines) ? debug.lines : [],
    sortedLines: sorted,
    linesSortedByTopLeft: sorted,
    detectedLabels: compactDetectedLabels(debug.detectedLabels || {}),
    detectedZones: debug.detectedZones && typeof debug.detectedZones === "object" ? debug.detectedZones : {},
    acceptedCandidates: Array.isArray(debug.acceptedCandidates) ? debug.acceptedCandidates : [],
    rejectedCandidates: Array.isArray(debug.rejectedCandidates) ? debug.rejectedCandidates : [],
    finalSuggestions: debug.finalSuggestions || buildOcrSuggestionsForDraft(parsed || {}) || {},
    fieldMeta: debug.fieldMeta || parsed?.fieldMeta || {},
    parserWarnings: Array.isArray(debug.parserWarnings)
      ? debug.parserWarnings
      : (Array.isArray(parsed?.parserWarnings) ? parsed.parserWarnings : []),
    errors: Array.isArray(debug.errors) ? debug.errors : (Array.isArray(parsed?.errors) ? parsed.errors : []),
  });
}

/** Convert OCR/apply values into controlled-input-safe strings. */
export function sanitizeOoklaDraftFieldValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  // Reject objects/arrays — never put them into controlled inputs.
  return "";
}

export function sanitizeOoklaSuggestions(suggestions = {}) {
  const out = {};
  Object.entries(suggestions || {}).forEach(([key, value]) => {
    const safe = sanitizeOoklaDraftFieldValue(value);
    if (safe !== "") out[key] = safe;
  });
  return out;
}
