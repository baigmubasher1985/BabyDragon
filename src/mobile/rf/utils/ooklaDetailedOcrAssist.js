/**
 * Detailed OOKLA result screenshot parser (Fix12).
 * Vertical label → value list extraction (not speed-card geometry).
 */

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text || null;
}

function cleanNumber(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(/,/g, "");
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function normalize(rawText = "") {
  return String(rawText || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

function enrichLines(rawText = "", lines = []) {
  const text = normalize(rawText);
  const source = Array.isArray(lines) && lines.length
    ? lines
    : text.split(/\n+/).map((line) => ({ text: line }));
  return source
    .map((line, index) => {
      const lineText = normalize(typeof line === "string" ? line : (line?.text || ""));
      if (!lineText) return null;
      return {
        index,
        text: lineText,
        top: Number.isFinite(line?.top) ? line.top : null,
        left: Number.isFinite(line?.left) ? line.left : null,
        width: Number.isFinite(line?.width) ? line.width : null,
        height: Number.isFinite(line?.height) ? line.height : null,
      };
    })
    .filter(Boolean);
}

/** Sort top→bottom, then left→right. Falls back to original index when geometry missing. */
function sortLinesTopLeft(lines = []) {
  return [...lines].sort((a, b) => {
    const aTop = a.top;
    const bTop = b.top;
    if (aTop !== null && bTop !== null && aTop !== bTop) return aTop - bTop;
    if (aTop !== null && bTop === null) return -1;
    if (aTop === null && bTop !== null) return 1;
    const aLeft = a.left;
    const bLeft = b.left;
    if (aLeft !== null && bLeft !== null && aLeft !== bLeft) return aLeft - bLeft;
    return a.index - b.index;
  }).map((line, sortIndex) => ({ ...line, sortIndex }));
}

function isUiChrome(text = "") {
  return /\b(detailed result|test again|view on map|feedback|share|copy link|done|close|ookla|speedtest by ookla)\b/i.test(text);
}

function isAdLine(text = "") {
  return /\b(ad|advert|sponsored|promo|install now|get the app)\b/i.test(text);
}

function isNetworkMetaLine(text = "") {
  return /\b(ssid|internal\s*ip|external\s*ip|ip address|wifi name)\b/i.test(text);
}

function isKnownLabelOnly(text = "") {
  const t = cleanText(text);
  if (!t) return false;
  return /^(test\s*id|result\s*id|connection\s*type|device|model|connections|connections?\s*mode|user\s*location|lat(?:itude)?|lon(?:gitude)?|packet\s*loss|server|server\s*location|isp|provider|network)$/i.test(t);
}

function isDeviceModelText(text = "") {
  return /\b(kb\d+|pixel\s*\d*|galaxy\s*[a-z0-9]+|iphone\s*\d*|oneplus|sm-[a-z0-9]+|cph\d+|moto\s*[a-z0-9]+)\b/i.test(text);
}

function looksLikeCityLocation(text = "") {
  const t = cleanText(text);
  if (!t) return false;
  if (isKnownLabelOnly(t) || isUiChrome(t) || isAdLine(t) || isNetworkMetaLine(t)) return false;
  if (classifyLabel(t)) return false;
  if (/^-?\d+\.\d+/.test(t)) return false;
  if (/\b(multi|single|mbps|ms|ping|jitter|packet|connection|connections|device|test|result|lat|lon|user)\b/i.test(t)) {
    return false;
  }

  // City, ST (preferred)
  let match = t.match(/^([A-Za-z][A-Za-z .'-]{1,40}),\s*([A-Z]{2})$/);
  if (match) {
    const words = match[1].trim().split(/\s+/);
    return words.length >= 1 && words.length <= 3;
  }
  // City, State/Country
  match = t.match(/^([A-Za-z][A-Za-z .'-]{1,40}),\s*([A-Za-z][A-Za-z .'-]{1,30})$/);
  if (match) {
    const words = match[1].trim().split(/\s+/);
    return words.length >= 1 && words.length <= 3;
  }
  // City ST (no comma)
  match = t.match(/^([A-Za-z][A-Za-z .'-]{1,40})\s+([A-Z]{2})$/);
  if (match) {
    const words = match[1].trim().split(/\s+/);
    return words.length >= 1 && words.length <= 3;
  }
  return false;
}

/** Merge only clear "Los Angeles" + "CA" OCR splits. Never merge random adjacent lines. */
function resolveCityLocationFromLines(sortedLines = [], index = 0) {
  const line = sortedLines[index];
  if (!line) return null;
  if (looksLikeCityLocation(line.text)) {
    return { text: cleanText(line.text), line, endIndex: index };
  }
  const next = sortedLines[index + 1];
  if (!next) return null;
  const cityPart = cleanText(line.text);
  const statePart = cleanText(next.text);
  if (!cityPart || !statePart) return null;
  if (classifyLabel(cityPart) || isKnownLabelOnly(cityPart) || classifyLabel(statePart)) return null;
  if (!/^[A-Za-z][A-Za-z .'-]{1,40}$/.test(cityPart)) return null;
  if (!/^[A-Z]{2}$/.test(statePart)) return null;
  const merged = `${cityPart}, ${statePart}`;
  if (!looksLikeCityLocation(merged)) return null;
  return {
    text: merged,
    line, // keep city line as geometry/name-above anchor
    endIndex: index + 1,
    merged: true,
  };
}

function looksLikeProviderOrServerName(text = "") {
  const t = cleanText(text);
  if (!t) return false;
  if (isKnownLabelOnly(t) || isUiChrome(t) || isAdLine(t) || isNetworkMetaLine(t)) return false;
  if (isDeviceModelText(t)) return false;
  if (/^-?\d+(\.\d+)?%?$/.test(t)) return false;
  if (/^(multi|single)$/i.test(t)) return false;
  if (/\b(download|upload|ping|jitter|mbps|responsiveness|data used)\b/i.test(t)) return false;
  if (t.length < 2 || t.length > 80) return false;
  return /[A-Za-z]/.test(t);
}

function makeField(value, confidence, reason, sourceLine, labelLine = null) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  return {
    value,
    source: "detailed_screenshot_ocr",
    confidence,
    reason,
    sourceLine: sourceLine?.text || null,
    labelLine: labelLine?.text || null,
    boundingBox: sourceLine
      ? {
        left: sourceLine.left ?? null,
        top: sourceLine.top ?? null,
        width: sourceLine.width ?? null,
        height: sourceLine.height ?? null,
      }
      : null,
  };
}

function extractResultId(text) {
  const match = String(text || "").match(/(?:test|result)\s*id\s*[:#]?\s*(\d{8,})/i)
    || String(text || "").match(/\b(\d{10,})\b/);
  return match?.[1] || null;
}

function extractDateTime(text) {
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

function extractLatLon(text) {
  const labelled = String(text || "").match(
    /(?:user\s*location|lat(?:itude)?\s*[:#]?\s*)(-?\d{1,3}\.\d+)\s*[,/\s]+(?:lon(?:gitude)?\s*[:#]?\s*)?(-?\d{1,3}\.\d+)/i,
  );
  if (labelled) {
    return { lat: cleanNumber(labelled[1]), lon: cleanNumber(labelled[2]) };
  }
  const pair = String(text || "").match(/(-?\d{1,3}\.\d+)\s*[,/\s]+(-?\d{1,3}\.\d+)/);
  if (pair && /lat|lon|location|coord/i.test(text)) {
    return { lat: cleanNumber(pair[1]), lon: cleanNumber(pair[2]) };
  }
  return { lat: null, lon: null };
}

const LABEL_DEFS = [
  { key: "testId", match: /^(test\s*id|result\s*id)\b/i },
  // Connection Type must be checked before Connections / Connection.
  { key: "connectionType", match: /^connection\s*type\b/i },
  { key: "device", match: /^(device|model)\b/i },
  // Exact Connections / Connections Mode label (never Connection Type).
  { key: "connections", match: /^connections?(?:\s+mode)?\b/i },
  { key: "userLocation", match: /^user\s*location\b/i },
  { key: "lat", match: /^lat(?:itude)?\b/i },
  { key: "lon", match: /^lon(?:gitude)?\b/i },
  { key: "packetLoss", match: /^packet\s*loss\b/i },
  { key: "server", match: /^server(?:\s*location)?\b/i },
  { key: "provider", match: /^(isp|provider|network)\b/i },
];

function classifyLabel(text = "") {
  const t = cleanText(text);
  if (!t || isUiChrome(t) || isAdLine(t)) return null;
  for (const def of LABEL_DEFS) {
    if (def.match.test(t)) return def.key;
  }
  return null;
}

function isConnectionsModeLabel(text = "") {
  const t = cleanText(text);
  if (!t) return false;
  if (/^connection\s*type\b/i.test(t)) return false;
  return /^connections?(?:\s+mode)?\b/i.test(t);
}

/** Normalize OCR tokens for Connections Mode values. */
function extractConnectionsModeToken(text = "") {
  const t = String(text || "");
  if (/\bm[iu1l]{1,2}lt[il1]\b/i.test(t) || /\bmulti\b/i.test(t)) return "Multi";
  if (/\bsing+l[e3]?\b/i.test(t) || /\bsingle\b/i.test(t)) return "Single";
  return null;
}

function inlineValueAfterLabel(text, labelKey) {
  const patterns = {
    testId: /(?:test|result)\s*id\s*[:#]?\s*(.+)$/i,
    connectionType: /connection\s*type\s*[:#]?\s*(.+)$/i,
    device: /(?:device|model)\s*[:#]?\s*(.+)$/i,
    // Allow "Connections Multi" (no colon) as well as "Connections: Multi".
    connections: /^connections?(?:\s+mode)?\s*[:#]?\s+(.+)$/i,
    userLocation: /user\s*location\s*[:#]?\s*(.+)$/i,
    lat: /lat(?:itude)?\s*[:#]?\s*(.+)$/i,
    lon: /lon(?:gitude)?\s*[:#]?\s*(.+)$/i,
    packetLoss: /packet\s*loss\s*[:#]?\s*(.+)$/i,
    server: /server(?:\s*location)?\s*[:#]?\s*(.+)$/i,
    provider: /(?:isp|provider|network)\s*[:#]?\s*(.+)$/i,
  };
  const pattern = patterns[labelKey];
  if (!pattern) return null;
  const match = String(text || "").match(pattern);
  if (!match?.[1]) return null;
  const value = cleanText(match[1]);
  if (!value) return null;
  // Reject when OCR only captured the label word again.
  if (isKnownLabelOnly(value)) return null;
  if (classifyLabel(value) && value.split(/\s+/).length <= 2 && !/\d/.test(value) && !/^(multi|single)$/i.test(value)) {
    return null;
  }
  return value;
}

function looksLikeLatLonValue(text = "") {
  return /(-?\d{1,3}\.\d+)\s*[,/\s]+(-?\d{1,3}\.\d+)/.test(text)
    || /\blat(?:itude)?\b.+\blon(?:gitude)?\b/i.test(text);
}

function isAcceptableValueLine(line, labelKey) {
  if (!line) return false;
  const t = cleanText(line.text);
  if (!t) return false;
  if (isUiChrome(t) || isAdLine(t) || isNetworkMetaLine(t)) return false;
  if (isKnownLabelOnly(t)) return false;
  const nextLabel = classifyLabel(t);
  // User Location values often begin with "Lat:" / "Lon:" — allow those.
  if (labelKey === "userLocation" && looksLikeLatLonValue(t)) return true;
  if (nextLabel && nextLabel !== labelKey) return false;
  return true;
}

/**
 * Nearest non-label value line below a label (geometry or sequential order).
 */
function findValueBelow(sortedLines, labelLine, labelKey, { maxGapPx = 90, maxSteps = 3 } = {}) {
  const candidates = [];
  for (const line of sortedLines) {
    if (line.sortIndex === labelLine.sortIndex) continue;
    if (labelLine.top !== null && line.top !== null) {
      if (line.top <= labelLine.top) continue;
      if (line.top > labelLine.top + maxGapPx) continue;
    } else {
      const step = line.sortIndex - labelLine.sortIndex;
      if (step < 1 || step > maxSteps) continue;
    }
    if (!isAcceptableValueLine(line, labelKey)) continue;
    candidates.push(line);
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    if (labelLine.top !== null && a.top !== null && b.top !== null) {
      const da = a.top - labelLine.top;
      const db = b.top - labelLine.top;
      if (da !== db) return da - db;
    }
    return a.sortIndex - b.sortIndex;
  });
  return candidates[0];
}

/**
 * Same-row / beside value (OOKLA detailed UI often puts Multi to the right of Connections).
 */
function findValueBeside(sortedLines, labelLine, labelKey, { maxVerticalPx = 28, maxSteps = 4 } = {}) {
  const candidates = [];
  for (const line of sortedLines) {
    if (line.sortIndex === labelLine.sortIndex) continue;
    if (labelLine.top !== null && line.top !== null) {
      const vGap = Math.abs(line.top - labelLine.top);
      const tol = Math.max(maxVerticalPx, (labelLine.height || 0) * 0.9, (line.height || 0) * 0.9);
      if (vGap > tol) continue;
      if (labelLine.left !== null && line.left !== null && line.left <= labelLine.left) continue;
    } else {
      const step = line.sortIndex - labelLine.sortIndex;
      if (step < 1 || step > maxSteps) continue;
    }
    if (!isAcceptableValueLine(line, labelKey) && !extractConnectionsModeToken(line.text)) continue;
    candidates.push(line);
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    if (labelLine.left !== null && a.left !== null && b.left !== null) {
      const da = a.left - labelLine.left;
      const db = b.left - labelLine.left;
      if (da !== db) return da - db;
    }
    return a.sortIndex - b.sortIndex;
  });
  return candidates[0];
}

function findConnectionsModeNearLabel(sortedLines, labelLine) {
  // 1) Same line after label
  const inline = inlineValueAfterLabel(labelLine.text, "connections");
  const inlineMode = extractConnectionsModeToken(inline || labelLine.text);
  if (inlineMode) {
    return { mode: inlineMode, valueLine: labelLine, strategy: "inline_after_label" };
  }

  // 2) Beside (same visual row, to the right)
  const beside = findValueBeside(sortedLines, labelLine, "connections", { maxVerticalPx: 36, maxSteps: 5 });
  const besideMode = extractConnectionsModeToken(beside?.text || "");
  if (besideMode) {
    return { mode: besideMode, valueLine: beside, strategy: "beside_label" };
  }

  // 3) Below with wide gap
  const below = findValueBelow(sortedLines, labelLine, "connections", { maxGapPx: 160, maxSteps: 5 });
  const belowMode = extractConnectionsModeToken(below?.text || "");
  if (belowMode) {
    return { mode: belowMode, valueLine: below, strategy: "next_line_below_label" };
  }

  // 4) Sequential neighbors even when geometry exists (OCR tops can be noisy)
  for (let step = 1; step <= 5; step += 1) {
    const neighbor = sortedLines.find((line) => line.sortIndex === labelLine.sortIndex + step);
    if (!neighbor) continue;
    if (classifyLabel(neighbor.text) && classifyLabel(neighbor.text) !== "connections") continue;
    const mode = extractConnectionsModeToken(neighbor.text);
    if (mode) {
      return { mode, valueLine: neighbor, strategy: "sequential_neighbor" };
    }
  }

  // 5) Any nearby Multi/Single in a vertical band around the label
  if (labelLine.top !== null) {
    const band = sortedLines
      .filter((line) => line.top !== null && Math.abs(line.top - labelLine.top) <= 80)
      .sort((a, b) => {
        const da = Math.abs(a.top - labelLine.top) - Math.abs(b.top - labelLine.top);
        if (da !== 0) return da;
        return (a.left ?? 0) - (b.left ?? 0);
      });
    for (const line of band) {
      if (line.sortIndex === labelLine.sortIndex) continue;
      const mode = extractConnectionsModeToken(line.text);
      if (mode) return { mode, valueLine: line, strategy: "vertical_band" };
    }
  }

  return null;
}

function resolveLabelValue(sortedLines, labelLine, labelKey, decisions) {
  const inline = inlineValueAfterLabel(labelLine.text, labelKey);
  if (inline) {
    decisions.push({
      labelKey,
      labelText: labelLine.text,
      valueText: inline,
      strategy: "inline_after_label",
      reason: "Value on same line after label",
    });
    return { value: inline, valueLine: labelLine, strategy: "inline_after_label" };
  }

  // Label-only line — never use the label text itself as the value.
  if (isKnownLabelOnly(labelLine.text) || classifyLabel(labelLine.text) === labelKey) {
    const below = findValueBelow(sortedLines, labelLine, labelKey);
    if (below) {
      decisions.push({
        labelKey,
        labelText: labelLine.text,
        valueText: below.text,
        strategy: "next_line_below_label",
        reason: "Value line below label (not the label itself)",
        valueBoundingBox: {
          left: below.left, top: below.top, width: below.width, height: below.height,
        },
      });
      return { value: cleanText(below.text), valueLine: below, strategy: "next_line_below_label" };
    }
    decisions.push({
      labelKey,
      labelText: labelLine.text,
      valueText: null,
      strategy: "label_only_no_value",
      reason: "Label found but no valid value line below — left blank (not using label text)",
    });
    return null;
  }

  decisions.push({
    labelKey,
    labelText: labelLine.text,
    valueText: null,
    strategy: "unresolved",
    reason: "Could not resolve label value confidently",
  });
  return null;
}

function detectLabels(sortedLines = []) {
  const detected = {};
  for (const line of sortedLines) {
    const key = classifyLabel(line.text);
    if (!key) continue;
    if (!detected[key]) {
      detected[key] = {
        text: line.text,
        sortIndex: line.sortIndex,
        left: line.left,
        top: line.top,
        width: line.width,
        height: line.height,
      };
    }
  }
  return detected;
}

/**
 * Parse Detailed OOKLA result screenshot OCR (label → value list).
 */
export function parseOoklaDetailedOcrText(rawText = "", lines = []) {
  const acceptedCandidates = [];
  const rejectedCandidates = [];
  const parserWarnings = [];
  const labelValueDecisions = [];
  const enriched = enrichLines(rawText, lines);
  const sortedLines = sortLinesTopLeft(enriched);
  const text = normalize(rawText) || sortedLines.map((line) => line.text).join("\n");

  const accept = (fieldName, field) => {
    if (!field) return;
    acceptedCandidates.push({
      fieldName,
      candidateText: String(field.value),
      reason: field.reason,
      confidence: field.confidence,
      sourceLine: field.sourceLine,
      labelLine: field.labelLine || null,
      boundingBox: field.boundingBox,
    });
  };
  const reject = (fieldName, candidateText, reason, sourceLine = null) => {
    rejectedCandidates.push({
      fieldName,
      candidateText: String(candidateText ?? ""),
      reason,
      sourceLine: sourceLine?.text || null,
      boundingBox: sourceLine
        ? { left: sourceLine.left, top: sourceLine.top, width: sourceLine.width, height: sourceLine.height }
        : null,
    });
  };

  const empty = () => ({
    testDateTime: null,
    resultId: null,
    connectionType: null,
    deviceName: null,
    serverName: null,
    serverLocation: null,
    providerName: null,
    connectionsMode: null,
    packetLossPercent: null,
    ooklaUserLatitude: null,
    ooklaUserLongitude: null,
    fieldsFound: [],
    fieldConfidence: {},
    fieldMeta: {},
    parserWarnings: ["Detailed OCR text empty"],
    ocrDebug: {
      rawText: "",
      lines: [],
      linesSortedByTopLeft: [],
      detectedLabels: {},
      labelValueDecisions: [],
      acceptedCandidates: [],
      rejectedCandidates: [],
      finalSuggestions: {},
      fieldMeta: {},
      parserWarnings: ["Detailed OCR text empty"],
    },
  });

  if (!text.trim()) return empty();

  for (const line of sortedLines) {
    if (isUiChrome(line.text) || isAdLine(line.text)) {
      reject("ui", line.text, "UI chrome / ad ignored", line);
    }
  }

  const detectedLabels = detectLabels(sortedLines);
  let testDateTime = null;
  let resultId = null;
  let connectionType = null;
  let deviceName = null;
  let serverName = null;
  let serverLocation = null;
  let providerName = null;
  let connectionsMode = null;
  let packetLossPercent = null;
  let ooklaUserLatitude = null;
  let ooklaUserLongitude = null;

  // Date/time (often at top, not a labeled pair)
  for (const line of sortedLines) {
    const dt = extractDateTime(line.text);
    if (!dt) continue;
    testDateTime = makeField(dt, "high", "Detailed screenshot date/time", line);
    accept("testDateTime", testDateTime);
    break;
  }

  // Result / Test ID — prefer full numeric ID (8+ digits)
  for (const line of sortedLines) {
    const labelKey = classifyLabel(line.text);
    if (labelKey !== "testId" && !/(?:test|result)\s*id/i.test(line.text)) continue;
    const resolved = resolveLabelValue(sortedLines, line, "testId", labelValueDecisions);
    const id = extractResultId(resolved?.value || line.text) || extractResultId(resolved?.valueLine?.text || "");
    if (id) {
      resultId = makeField(id, "high", "Detailed screenshot Result ID (full digits)", resolved?.valueLine || line, line);
      accept("resultId", resultId);
      break;
    }
    reject("resultId", line.text, "Test/Result ID label without full numeric ID", line);
  }
  if (!resultId) {
    const id = extractResultId(text);
    if (id) {
      resultId = makeField(id, "medium", "Detailed screenshot Result ID (text scan)", null);
      accept("resultId", resultId);
    }
  }

  // Connection Type → value below (never the label)
  for (const line of sortedLines) {
    if (classifyLabel(line.text) !== "connectionType") continue;
    const resolved = resolveLabelValue(sortedLines, line, "connectionType", labelValueDecisions);
    if (!resolved?.value) {
      reject("connectionType", line.text, "Connection Type label without value line — not using label text", line);
      break;
    }
    if (/^connection\s*type$/i.test(resolved.value)) {
      reject("connectionType", resolved.value, "Rejected label text used as value", resolved.valueLine);
      break;
    }
    connectionType = makeField(resolved.value, "high", "Value below Connection Type label", resolved.valueLine, line);
    accept("connectionType", connectionType);

    // Provider often appears as the Connection Type value (ISP / carrier name).
    if (
      looksLikeProviderOrServerName(resolved.value)
      && !/^(wifi|wi-fi|5g|lte|nr|cellular|mobile|ethernet)$/i.test(resolved.value)
    ) {
      providerName = makeField(resolved.value, "medium", "Provider inferred from Connection Type value", resolved.valueLine, line);
      accept("providerName", providerName);
    }
    break;
  }

  // Explicit Provider / ISP label
  if (!providerName) {
    for (const line of sortedLines) {
      if (classifyLabel(line.text) !== "provider") continue;
      const resolved = resolveLabelValue(sortedLines, line, "provider", labelValueDecisions);
      if (!resolved?.value || isDeviceModelText(resolved.value)) {
        reject("providerName", resolved?.value || line.text, "Provider label without usable value", line);
        break;
      }
      providerName = makeField(resolved.value, "high", "Value below Provider/ISP label", resolved.valueLine, line);
      accept("providerName", providerName);
      break;
    }
  }

  // Device → value below (never the word Device)
  for (const line of sortedLines) {
    if (classifyLabel(line.text) !== "device") continue;
    const resolved = resolveLabelValue(sortedLines, line, "device", labelValueDecisions);
    if (!resolved?.value) {
      reject("deviceName", line.text, "Device label without value line — not using label text", line);
      break;
    }
    if (/^(device|model)$/i.test(resolved.value)) {
      reject("deviceName", resolved.value, "Rejected label text used as value", resolved.valueLine);
      break;
    }
    deviceName = makeField(resolved.value, "high", "Value below Device label", resolved.valueLine, line);
    accept("deviceName", deviceName);
    break;
  }

  // Connections → Multi / Single (beside, below, or sequential). Never confuse with Connection Type.
  for (const line of sortedLines) {
    if (!isConnectionsModeLabel(line.text) && classifyLabel(line.text) !== "connections") continue;
    if (/^connection\s*type\b/i.test(line.text)) continue;

    const found = findConnectionsModeNearLabel(sortedLines, line);
    if (!found?.mode) {
      reject("connectionsMode", line.text, "Connections label without Multi/Single value", line);
      continue;
    }
    // Reject carrier/provider names accidentally used as mode.
    if (providerName && String(providerName.value).toLowerCase() === found.mode.toLowerCase()) continue;
    if (connectionType && String(connectionType.value).toLowerCase() === found.mode.toLowerCase()) continue;

    labelValueDecisions.push({
      labelKey: "connections",
      labelText: line.text,
      valueText: found.valueLine?.text || found.mode,
      strategy: found.strategy,
      reason: "Connections Mode resolved near Connections label",
    });
    connectionsMode = makeField(
      found.mode,
      "high",
      `Connections Mode via ${found.strategy}`,
      found.valueLine || line,
      line,
    );
    accept("connectionsMode", connectionsMode);
    break;
  }

  // Last-resort Connections Mode: scan raw text near a Connections label token.
  if (!connectionsMode) {
    for (let i = 0; i < sortedLines.length; i += 1) {
      const line = sortedLines[i];
      if (!/\bconnections?\b/i.test(line.text) || /\bconnection\s*type\b/i.test(line.text)) continue;
      const windowText = [line.text, sortedLines[i + 1]?.text, sortedLines[i + 2]?.text]
        .filter(Boolean)
        .join(" ");
      const mode = extractConnectionsModeToken(windowText);
      if (!mode) continue;
      connectionsMode = makeField(mode, "medium", "Connections Mode from nearby text window", line, line);
      accept("connectionsMode", connectionsMode);
      labelValueDecisions.push({
        labelKey: "connections",
        labelText: line.text,
        valueText: mode,
        strategy: "text_window_scan",
        reason: "Connections Mode recovered from nearby OCR text window",
      });
      break;
    }
  }

  // Packet Loss %
  for (const line of sortedLines) {
    if (classifyLabel(line.text) !== "packetLoss" && !/\bpacket\s*loss\b/i.test(line.text)) continue;
    const resolved = resolveLabelValue(sortedLines, line, "packetLoss", labelValueDecisions);
    const haystack = `${resolved?.value || ""} ${line.text}`;
    const match = haystack.match(/(\d+(?:\.\d+)?)\s*%/);
    if (match?.[1]) {
      packetLossPercent = makeField(cleanNumber(match[1]), "high", "Packet Loss percent near label", resolved?.valueLine || line, line);
      accept("packetLossPercent", packetLossPercent);
    } else {
      reject("packetLossPercent", haystack, "Packet Loss label without percent value", line);
    }
    break;
  }

  // User Location / Lat / Lon
  for (const line of sortedLines) {
    const key = classifyLabel(line.text);
    if (key !== "userLocation" && key !== "lat" && !/\buser\s*location\b/i.test(line.text)) continue;

    const onLabel = extractLatLon(line.text);
    if (onLabel.lat !== null && onLabel.lon !== null) {
      ooklaUserLatitude = makeField(onLabel.lat, "high", "Lat/Lon on User Location line", line);
      ooklaUserLongitude = makeField(onLabel.lon, "high", "Lat/Lon on User Location line", line);
      accept("ooklaUserLatitude", ooklaUserLatitude);
      accept("ooklaUserLongitude", ooklaUserLongitude);
      labelValueDecisions.push({
        labelKey: "userLocation",
        labelText: line.text,
        valueText: `${onLabel.lat}, ${onLabel.lon}`,
        strategy: "inline_lat_lon",
        reason: "Lat/Lon on label line",
      });
      break;
    }

    const below = findValueBelow(sortedLines, line, "userLocation", { maxGapPx: 100, maxSteps: 3 });
    if (below) {
      const pair = extractLatLon(below.text);
      const nums = pair.lat !== null
        ? [pair.lat, pair.lon]
        : [...below.text.matchAll(/(-?\d{1,3}\.\d+)/g)].map((m) => cleanNumber(m[1]));
      if (nums.length >= 2 && nums[0] !== null && nums[1] !== null) {
        ooklaUserLatitude = makeField(nums[0], "high", "Lat under User Location label", below, line);
        ooklaUserLongitude = makeField(nums[1], "high", "Lon under User Location label", below, line);
        accept("ooklaUserLatitude", ooklaUserLatitude);
        accept("ooklaUserLongitude", ooklaUserLongitude);
        labelValueDecisions.push({
          labelKey: "userLocation",
          labelText: line.text,
          valueText: below.text,
          strategy: "next_line_below_label",
          reason: "Lat/Lon line below User Location",
        });
        break;
      }
    }

    // Separate Lat / Lon labels
    const latLine = sortedLines.find((l) => classifyLabel(l.text) === "lat");
    const lonLine = sortedLines.find((l) => classifyLabel(l.text) === "lon");
    if (latLine || lonLine) {
      const latResolved = latLine ? resolveLabelValue(sortedLines, latLine, "lat", labelValueDecisions) : null;
      const lonResolved = lonLine ? resolveLabelValue(sortedLines, lonLine, "lon", labelValueDecisions) : null;
      const lat = cleanNumber(String(latResolved?.value || "").replace(/[^\d.-]/g, ""));
      const lon = cleanNumber(String(lonResolved?.value || "").replace(/[^\d.-]/g, ""));
      if (lat !== null && lon !== null) {
        ooklaUserLatitude = makeField(lat, "high", "Value below Lat label", latResolved?.valueLine || latLine, latLine);
        ooklaUserLongitude = makeField(lon, "high", "Value below Lon label", lonResolved?.valueLine || lonLine, lonLine);
        accept("ooklaUserLatitude", ooklaUserLatitude);
        accept("ooklaUserLongitude", ooklaUserLongitude);
      } else {
        parserWarnings.push("User Location / Lat/Lon labels seen but values not confidently parsed");
      }
    } else {
      parserWarnings.push("User Location label seen but lat/lon not confidently parsed");
    }
    break;
  }

  // Explicit Server label
  for (const line of sortedLines) {
    if (classifyLabel(line.text) !== "server") continue;
    const resolved = resolveLabelValue(sortedLines, line, "server", labelValueDecisions);
    if (!resolved?.value || isDeviceModelText(resolved.value) || /^connection\s*type$/i.test(resolved.value)) {
      reject("serverName", resolved?.value || line.text, "Server label without usable value", line);
      break;
    }
    if (looksLikeCityLocation(resolved.value)) {
      serverLocation = makeField(resolved.value, "high", "Server location from Server label value", resolved.valueLine, line);
      accept("serverLocation", serverLocation);
    } else {
      serverName = makeField(resolved.value, "high", "Value below Server label", resolved.valueLine, line);
      accept("serverName", serverName);
      const locBelow = findValueBelow(sortedLines, resolved.valueLine, "server");
      if (locBelow && looksLikeCityLocation(locBelow.text)) {
        serverLocation = makeField(cleanText(locBelow.text), "high", "City/location under server name", locBelow, line);
        accept("serverLocation", serverLocation);
      }
    }
    break;
  }

  // Stacked server card: find city/state first, then name immediately above (not the label itself).
  if (!serverName || !serverLocation) {
    const candidates = [];
    for (let i = 0; i < sortedLines.length; i += 1) {
      const loc = resolveCityLocationFromLines(sortedLines, i);
      if (!loc) continue;
      if (classifyLabel(loc.line.text) === "userLocation") continue;

      let nameLine = null;
      const isUsableServerNameLine = (above) => {
        if (!above) return false;
        if (classifyLabel(above.text) || isKnownLabelOnly(above.text)) return false;
        if (looksLikeCityLocation(above.text)) return false;
        if (!looksLikeProviderOrServerName(above.text)) return false;
        if (deviceName && String(deviceName.value).toLowerCase() === cleanText(above.text).toLowerCase()) return false;
        if (extractConnectionsModeToken(above.text)) return false;
        return true;
      };

      // Prefer sequential line above location
      for (let step = 1; step <= 3; step += 1) {
        const above = sortedLines.find((line) => line.sortIndex === loc.line.sortIndex - step)
          || sortedLines[i - step];
        if (!isUsableServerNameLine(above)) continue;
        nameLine = above;
        break;
      }

      // Geometry: nearest name-like line above location in vertical band
      if (!nameLine && loc.line.top !== null) {
        const aboveGeo = sortedLines
          .filter((line) => (
            line.top !== null
            && line.top < loc.line.top
            && loc.line.top - line.top <= 120
            && isUsableServerNameLine(line)
          ))
          .sort((a, b) => (loc.line.top - a.top) - (loc.line.top - b.top));
        nameLine = aboveGeo[0] || null;
      }

      if (!nameLine && !loc.text) continue;

      const nameText = cleanText(nameLine?.text || "");
      const equalsConnectionType = connectionType
        && nameText
        && nameText.toLowerCase() === String(connectionType.value).toLowerCase();
      const equalsProvider = providerName
        && nameText
        && nameText.toLowerCase() === String(providerName.value).toLowerCase();

      const cityWordCount = String(loc.text || "").split(",")[0].trim().split(/\s+/).filter(Boolean).length;
      // Prefer a distinct server name and clean "City, ST" locations.
      const score = (nameLine ? 10 : 0)
        + (equalsConnectionType ? -4 : 0)
        + (equalsProvider ? -2 : 0)
        + (looksLikeCityLocation(loc.text) ? 8 : 0)
        + (cityWordCount <= 2 ? 6 : cityWordCount === 3 ? 1 : -8)
        + (/,\s*[A-Z]{2}$/.test(loc.text || "") ? 4 : 0);

      candidates.push({
        nameLine,
        nameText,
        locText: loc.text,
        locLine: loc.line,
        score,
        equalsConnectionType,
        equalsProvider,
      });
      i = Math.max(i, loc.endIndex);
    }

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0] || null;
    if (best) {
      if (!serverLocation && best.locText) {
        serverLocation = makeField(best.locText, "high", "City/state under server/provider block", best.locLine);
        accept("serverLocation", serverLocation);
      }
      if (!serverName && best.nameText) {
        // If name equals Connection Type only, still accept when it is the only stacked name above city.
        serverName = makeField(
          best.nameText,
          best.equalsConnectionType ? "medium" : "high",
          "Server name above city/state location",
          best.nameLine,
        );
        accept("serverName", serverName);
        labelValueDecisions.push({
          labelKey: "serverPair",
          labelText: best.nameText,
          valueText: best.locText,
          strategy: "location_then_name_above",
          reason: "Stacked server name + city/state under detailed result card",
        });
      }
      if (!providerName && best.nameText && best.equalsConnectionType) {
        providerName = makeField(best.nameText, "medium", "Provider from server/provider block", best.nameLine);
        accept("providerName", providerName);
      }
    }
  }

  // Fallback: if location found but name still blank, keep location only (conservative).

  // Never use device as server/provider
  if (serverName && deviceName && String(serverName.value).toLowerCase() === String(deviceName.value).toLowerCase()) {
    reject("serverName", serverName.value, "Device name rejected as server", null);
    serverName = null;
  }
  if (providerName && deviceName && String(providerName.value).toLowerCase() === String(deviceName.value).toLowerCase()) {
    reject("providerName", providerName.value, "Device name rejected as provider", null);
    providerName = null;
  }

  const optionalDetailedKeys = [
    "connectionType",
    "deviceName",
    "serverName",
    "serverLocation",
    "providerName",
    "connectionsMode",
    "packetLossPercent",
    "ooklaUserLatitude",
    "ooklaUserLongitude",
    "testDateTime",
  ];
  const fieldObjects = {
    testDateTime,
    resultId,
    connectionType,
    deviceName,
    serverName,
    serverLocation,
    providerName,
    connectionsMode,
    packetLossPercent,
    ooklaUserLatitude,
    ooklaUserLongitude,
  };
  const missingOptional = optionalDetailedKeys.filter((key) => !fieldObjects[key]);
  if (missingOptional.length) {
    parserWarnings.push(
      "Detailed screenshot does not show all optional fields. Add another detailed screenshot or enter missing fields manually.",
    );
  }

  const fields = Object.fromEntries(
    Object.entries(fieldObjects).map(([key, field]) => [key, field?.value ?? null]),
  );
  const fieldConfidence = Object.fromEntries(
    Object.entries(fieldObjects).filter(([, field]) => field).map(([key, field]) => [key, field.confidence]),
  );
  const fieldMeta = Object.fromEntries(
    Object.entries(fieldObjects).filter(([, field]) => field),
  );
  const fieldsFound = Object.keys(fieldMeta);
  const finalSuggestions = {};
  Object.entries(fields).forEach(([key, value]) => {
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      finalSuggestions[key] = String(value);
    }
  });

  return {
    ...fields,
    fieldsFound,
    fieldConfidence,
    fieldMeta,
    parserWarnings,
    ocrDebug: {
      rawText: text,
      lines: enriched,
      linesSortedByTopLeft: sortedLines.map((line) => ({
        text: line.text,
        left: line.left,
        top: line.top,
        width: line.width,
        height: line.height,
        sortIndex: line.sortIndex,
        index: line.index,
      })),
      detectedLabels,
      labelValueDecisions,
      acceptedCandidates,
      rejectedCandidates,
      finalSuggestions,
      fieldMeta,
      parserWarnings,
    },
  };
}

export function buildDetailedOcrSuggestions(parsed = {}, { highConfidenceOnly = false } = {}) {
  const suggestions = {};
  const meta = parsed.fieldMeta || {};
  Object.keys(meta).forEach((key) => {
    const field = meta[key];
    if (!field) return;
    if (highConfidenceOnly && field.confidence !== "high") return;
    suggestions[key] = String(field.value);
  });
  return suggestions;
}
