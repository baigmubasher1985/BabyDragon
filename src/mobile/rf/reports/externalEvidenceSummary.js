export function getNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return null;
}

export function resolveOoklaIterations(session = {}) {
  const fromSession = Array.isArray(session.appOoklaEvidenceIterations) ? session.appOoklaEvidenceIterations : [];
  if (fromSession.length) return fromSession;
  if (session.appOoklaEvidence?.source || session.appOoklaEvidence?.iterationNumber) {
    return [session.appOoklaEvidence];
  }
  return [];
}

function metricValues(iterations, field) {
  return (iterations || [])
    .map((item) => getNumber(item?.[field]))
    .filter((value) => value !== null);
}

function metricSummary(values, digits = 2) {
  if (!values.length) {
    return { count: 0, avg: null, min: null, max: null };
  }
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  const round = (value) => (digits === null || Number.isInteger(value) ? value : Number(value.toFixed(digits)));
  return {
    count: values.length,
    avg: round(avg),
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
  };
}

export function resolveOoklaEvidenceMode(iterations = []) {
  const list = Array.isArray(iterations) ? iterations : [];
  if (!list.length) return null;
  let hasScreenshot = false;
  let hasCsv = false;
  list.forEach((item) => {
    const source = String(item?.evidenceSource || item?.source || "").toLowerCase();
    if (source.includes("csv") || item?.csvImportMeta) hasCsv = true;
    else hasScreenshot = true;
    if (item?.mainScreenshot || item?.detailedScreenshot || item?.screenshot || item?.mainOcrAssistUsed || item?.detailedOcrAssistUsed) {
      hasScreenshot = true;
    }
  });
  if (hasScreenshot && hasCsv) return "mixed";
  if (hasCsv) return "csv_batch";
  return "screenshot_single";
}

export function buildOoklaIterationSummary(iterations = [], csvImportDebug = null) {
  const dl = metricSummary(metricValues(iterations, "dlMbps"), 2);
  const ul = metricSummary(metricValues(iterations, "ulMbps"), 2);
  const ping = metricSummary(metricValues(iterations, "pingMs"), 1);
  const jitter = metricSummary(metricValues(iterations, "jitterMs"), 1);
  const completenessCounts = { complete: 0, partial: 0, other: 0 };
  (iterations || []).forEach((item) => {
    const key = String(item?.evidenceCompleteness || "partial");
    if (key === "complete") completenessCounts.complete += 1;
    else if (key === "partial") completenessCounts.partial += 1;
    else completenessCounts.other += 1;
  });
  return {
    count: iterations.length,
    ooklaEvidenceMode: resolveOoklaEvidenceMode(iterations),
    ooklaIterationsSaved: iterations.length,
    csvRowsImported: csvImportDebug?.csvRowsImported ?? csvImportDebug?.stats?.imported ?? null,
    csvRowsInsideWindow: csvImportDebug?.csvRowsInsideWindow ?? csvImportDebug?.stats?.insideWindow ?? null,
    csvRowsSelected: csvImportDebug?.csvRowsSelected ?? csvImportDebug?.stats?.selected ?? null,
    avgDlMbps: dl.avg,
    avgUlMbps: ul.avg,
    avgPingMs: ping.avg,
    avgJitterMs: jitter.avg,
    minDlMbps: dl.min,
    maxDlMbps: dl.max,
    minUlMbps: ul.min,
    maxUlMbps: ul.max,
    minPingMs: ping.min,
    maxPingMs: ping.max,
    minJitterMs: jitter.min,
    maxJitterMs: jitter.max,
    evidenceCompletenessSummary: completenessCounts,
  };
}

export function isExternalAppSession(session = {}) {
  if (session.appTestType === "ookla_app" || session.appTestType === "fcc_app") return true;
  if (session.appExternalEvidenceProvider === "ookla_app" || session.appExternalEvidenceProvider === "fcc_app") return true;
  return false;
}
