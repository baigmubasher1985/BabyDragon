import { fetchOoklaResultViaNative } from "./ooklaNativeUrlFetch";

const IGNORED_PATH_SEGMENTS = new Set([
  "a",
  "s",
  "result",
  "my-result",
  "results",
  "speedtest",
  "www",
  "net",
  "com",
  "ookla",
]);

export const OOKLA_URL_IDENTITY_ONLY_MESSAGE =
  "Result URL stored for evidence/verification. Result ID and Provider filled when available. Use a clear OOKLA screenshot to auto-fill speed fields.";

export const OOKLA_URL_FAILED_MESSAGE =
  "Could not read Speedtest result page. Result URL and Result ID stored when available. Use a clear OOKLA screenshot for DL/UL/Ping/Jitter.";

export const OOKLA_URL_FALLBACK_NOTE =
  "Use clear OOKLA screenshot to auto-fill result fields. Result URL is stored for evidence/verification.";

// Kept for callers that still import older names — all identity-first messaging.
export const OOKLA_URL_PARTIAL_MESSAGE = OOKLA_URL_IDENTITY_ONLY_MESSAGE;
export const OOKLA_URL_HYBRID_PARTIAL_MESSAGE = OOKLA_URL_IDENTITY_ONLY_MESSAGE;
export const OOKLA_URL_STATIC_PARTIAL_MESSAGE = OOKLA_URL_IDENTITY_ONLY_MESSAGE;
export const OOKLA_URL_SUCCESS_MESSAGE = OOKLA_URL_IDENTITY_ONLY_MESSAGE;

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text || null;
}

function isIgnoredPathSegment(segment = "") {
  const token = String(segment || "").trim().toLowerCase();
  if (!token) return true;
  if (IGNORED_PATH_SEGMENTS.has(token)) return true;
  if (/^(result|my-result|speedtest)/i.test(token)) return true;
  return false;
}

function isValidResultIdToken(token = "") {
  const value = String(token || "").trim();
  return /^\d{6,}$/.test(value);
}

export function extractOoklaResultIdFromUrl(resultUrl = "") {
  const url = String(resultUrl || "").trim().replace(/\/+$/, "");
  if (!url) return null;

  const regexPatterns = [
    /speedtest\.net\/my-result\/a\/(\d{6,})/i,
    /speedtest\.net\/result\/a\/(\d{6,})/i,
    /speedtest\.net\/my-result\/(\d{6,})/i,
    /speedtest\.net\/result\/(\d{6,})/i,
    /speedtest\.net\/result\/s\/(\d{6,})/i,
    /ookla\.com\/my-result\/a\/(\d{6,})/i,
    /ookla\.com\/result\/a\/(\d{6,})/i,
    /ookla\.com\/(?:my-)?result\/(\d{6,})/i,
  ];

  for (const pattern of regexPatterns) {
    const match = url.match(pattern);
    if (match?.[1] && isValidResultIdToken(match[1])) return match[1];
  }

  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const part = parts[index];
      if (isValidResultIdToken(part)) return part;
    }
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const part = parts[index];
      if (!isIgnoredPathSegment(part) && /^\d+$/.test(part) && part.length >= 6) return part;
    }
  } catch {
    return null;
  }

  return null;
}

export const extractOoklaResultId = extractOoklaResultIdFromUrl;

export function openOoklaResultUrl(resultUrl = "") {
  const url = String(resultUrl || "").trim();
  if (!url) return false;
  try {
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
  } catch {
    return false;
  }
}

function stripHtmlToText(html = "") {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractJsonString(source, patterns = []) {
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) {
      const value = cleanText(match[1]);
      if (value) return value;
    }
  }
  return null;
}

function extractResultIdFromPage(html = "", text = "") {
  const fromJson = extractJsonString(`${html}\n${text}`, [
    /"result(?:Id)?"\s*:\s*"?(\d{6,})"?/i,
    /"id"\s*:\s*"?(\d{6,})"?/i,
  ]);
  if (fromJson) return fromJson;

  const fromText = text.match(/result\s*id[\s:]*(\d{6,})/i);
  if (fromText?.[1]) return fromText[1];
  return null;
}

/** Identity-only page parse. Speed KPIs are intentionally ignored. */
export function parseOoklaResultPageText(htmlOrText = "", resultId = null) {
  const html = String(htmlOrText || "");
  const text = stripHtmlToText(html);

  const providerName = extractJsonString(html, [
    /"ispName"\s*:\s*"([^"]+)"/i,
    /"providerName"\s*:\s*"([^"]+)"/i,
    /"provider"\s*:\s*"([^"]+)"/i,
  ]) || (() => {
    const match = text.match(/(?:provider|isp)[\s\S]{0,30}?([A-Za-z0-9][A-Za-z0-9 .,&'()/-]{2,80})/i);
    const candidate = cleanText(match?.[1]);
    if (candidate && !/download|upload|ping|jitter|mbps|server|connections/i.test(candidate)) {
      return candidate;
    }
    return null;
  })();

  const fields = {
    dlMbps: null,
    ulMbps: null,
    pingMs: null,
    jitterMs: null,
    serverName: null,
    providerName,
    resultId: resultId || extractResultIdFromPage(html, text) || null,
  };

  const fieldsFound = Object.entries(fields)
    .filter(([, value]) => value !== null && value !== "")
    .map(([key]) => key);

  return { ...fields, fieldsFound };
}

/** URL assist may only suggest Result ID and Provider. */
export function buildUrlSuggestionsForDraft(parsed = {}) {
  const suggestions = {};
  if (parsed.resultId) suggestions.resultId = String(parsed.resultId);
  if (parsed.providerName) suggestions.providerName = String(parsed.providerName);
  return suggestions;
}

export function urlMissingSpeedFields() {
  // URL never supplies speed KPIs in Fix10.
  return true;
}

export function getUrlFetchMessage(suggestions = {}, status = "failed") {
  const hasIdentity = Boolean(suggestions.resultId || suggestions.providerName);
  if (status === "blocked" || status === "failed") {
    if (hasIdentity) return OOKLA_URL_IDENTITY_ONLY_MESSAGE;
    return OOKLA_URL_FAILED_MESSAGE;
  }
  if (hasIdentity) return OOKLA_URL_IDENTITY_ONLY_MESSAGE;
  return OOKLA_URL_FAILED_MESSAGE;
}

export async function fetchOoklaResultFromUrl(resultUrl = "") {
  const url = String(resultUrl || "").trim();
  const resultId = extractOoklaResultIdFromUrl(url);
  const baseSuggestions = resultId ? { resultId } : {};

  if (!url) {
    return {
      ok: false,
      status: "not_attempted",
      suggestions: {},
      parsed: { fieldsFound: [] },
      message: "Enter a Result URL before fetching.",
      error: "missing_url",
      engine: "none",
      source: "identity",
    };
  }

  // Identity-only: Result ID from URL path + Provider from static page when present.
  // Do not parse or invent DL/UL/Ping/Jitter from HTML or share images.
  const fetchResult = await fetchOoklaResultViaNative(url);
  if (!fetchResult.ok || !fetchResult.text) {
    const status = fetchResult.engine === "webview" && /failed to fetch|cors|blocked|abort/i.test(fetchResult.error || "")
      ? "blocked"
      : "failed";
    return {
      ok: Boolean(resultId),
      status,
      suggestions: baseSuggestions,
      parsed: { fieldsFound: resultId ? ["resultId"] : [] },
      message: getUrlFetchMessage(baseSuggestions, status),
      error: fetchResult.error || "fetch_failed",
      engine: fetchResult.engine || "none",
      source: "identity",
    };
  }

  const parsed = parseOoklaResultPageText(fetchResult.text, resultId);
  const suggestions = buildUrlSuggestionsForDraft(parsed);
  const status = Object.keys(suggestions).length ? "identity" : "failed";

  return {
    ok: Object.keys(suggestions).length > 0,
    status,
    suggestions,
    parsed: {
      ...parsed,
      dlMbps: null,
      ulMbps: null,
      pingMs: null,
      jitterMs: null,
      serverName: null,
      fieldsFound: Object.keys(suggestions),
    },
    message: getUrlFetchMessage(suggestions, status === "failed" ? "failed" : "success"),
    error: null,
    engine: fetchResult.engine || "native",
    statusCode: fetchResult.statusCode,
    finalUrl: fetchResult.finalUrl,
    source: "identity",
  };
}
