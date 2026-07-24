import React, { useEffect, useId, useState } from "react";
import { readQueuedFile, saveOoklaScreenshotFile } from "../../../mobileIndexedDb";
import {
  applyOoklaEvidenceSuggestionsToDraft,
  applySuggestionsToDraft,
  buildHighConfidenceOcrSuggestions,
  buildOcrSuggestionsForDraft,
  buildOoklaOcrDebugPayload,
  canFeConfirmOoklaDraft,
  checkResultIdMismatch,
  checkScreenshotResultIdMismatch,
  buildOoklaEvidenceStatus,
  formatSuggestionLabel,
  getFeConfirmBlockReason,
  getOcrSuggestionMessage,
  getPartialEvidenceWarning,
  hasFeConfirmedSpeedValues,
  OOKLA_DETAILED_SUGGESTION_KEYS,
  OOKLA_MAIN_SUGGESTION_KEYS,
  OOKLA_SUGGESTION_DISPLAY_KEYS,
  parseOoklaOcrText,
  resolveOoklaValueSource,
  sanitizeOoklaDraftFieldValue,
  sanitizeOoklaSuggestions,
  truncateOcrPreview,
} from "../../utils/ooklaOcrAssist";
import {
  buildDetailedOcrSuggestions,
  parseOoklaDetailedOcrText,
} from "../../utils/ooklaDetailedOcrAssist";
import { recognizeOoklaScreenshotText } from "../../utils/ooklaNativeOcr";
import {
  extractOoklaResultId,
  fetchOoklaResultFromUrl,
  OOKLA_URL_IDENTITY_ONLY_MESSAGE,
  openOoklaResultUrl,
} from "../../utils/ooklaResultUrlAssist";
import OoklaCsvImportPanel from "./OoklaCsvImportPanel";

function emptyDraft() {
  return {
    dlMbps: "",
    ulMbps: "",
    pingMs: "",
    jitterMs: "",
    serverName: "",
    serverLocation: "",
    providerName: "",
    resultUrl: "",
    resultId: "",
    testDateTime: "",
    connectionType: "",
    deviceName: "",
    connectionsMode: "",
    packetLossPercent: "",
    ooklaUserLatitude: "",
    ooklaUserLongitude: "",
    notes: "",
    feConfirmed: false,
    mainScreenshot: null,
    mainScreenshotFile: null,
    detailedScreenshot: null,
    detailedScreenshotFile: null,
    // Legacy aliases kept for older saved iterations
    screenshot: null,
    screenshotFile: null,
    ocrAssistUsed: false,
    mainOcrAssistUsed: false,
    detailedOcrAssistUsed: false,
    ocrConfidence: null,
    ocrSource: null,
    ocrExtractedFields: {},
    detailedOcrExtractedFields: {},
    userConfirmedFields: {},
    ocrRawTextPreview: "",
    detailedOcrRawTextPreview: "",
    mainOcrDebug: null,
    detailedOcrDebug: null,
    ocrDebug: null,
    urlFetchStatus: "not_attempted",
    urlExtractedFields: {},
    urlAssistUsed: false,
    fieldSources: {},
  };
}

function draftFromEvidence(evidence) {
  if (!evidence) return emptyDraft();
  const mainScreenshot = evidence.mainScreenshot || evidence.screenshot || null;
  return {
    ...emptyDraft(),
    dlMbps: evidence.dlMbps ?? "",
    ulMbps: evidence.ulMbps ?? "",
    pingMs: evidence.pingMs ?? "",
    jitterMs: evidence.jitterMs ?? "",
    serverName: evidence.serverName || "",
    serverLocation: evidence.serverLocation || "",
    providerName: evidence.providerName || "",
    resultUrl: evidence.resultUrl || "",
    resultId: evidence.resultId || "",
    testDateTime: evidence.testDateTime || "",
    connectionType: evidence.connectionType || "",
    deviceName: evidence.deviceName || "",
    connectionsMode: evidence.connectionsMode || "",
    packetLossPercent: evidence.packetLossPercent ?? "",
    ooklaUserLatitude: evidence.ooklaUserLatitude ?? "",
    ooklaUserLongitude: evidence.ooklaUserLongitude ?? "",
    notes: evidence.notes || "",
    feConfirmed: evidence.confirmation === "fe_confirmed",
    mainScreenshot,
    detailedScreenshot: evidence.detailedScreenshot || null,
    screenshot: mainScreenshot,
    ocrAssistUsed: Boolean(evidence.ocrAssistUsed),
    mainOcrAssistUsed: Boolean(evidence.mainOcrAssistUsed || evidence.ocrAssistUsed),
    detailedOcrAssistUsed: Boolean(evidence.detailedOcrAssistUsed),
    ocrConfidence: evidence.ocrConfidence ?? null,
    ocrSource: evidence.ocrSource || null,
    ocrExtractedFields: evidence.ocrExtractedFields || {},
    detailedOcrExtractedFields: evidence.detailedOcrExtractedFields || {},
    userConfirmedFields: evidence.userConfirmedFields || {},
    ocrRawTextPreview: evidence.ocrRawTextPreview || "",
    detailedOcrRawTextPreview: evidence.detailedOcrRawTextPreview || "",
    mainOcrDebug: evidence.mainOcrDebug || evidence.ocrDebug || null,
    detailedOcrDebug: evidence.detailedOcrDebug || null,
    ocrDebug: evidence.mainOcrDebug || evidence.ocrDebug || null,
    urlFetchStatus: evidence.urlFetchStatus || "not_attempted",
    urlExtractedFields: evidence.urlExtractedFields || {},
    urlAssistUsed: Boolean(evidence.urlAssistUsed),
    fieldSources: evidence.fieldSources || {},
  };
}

function screenshotMetadataFromFile(file, storageKey = null, role = "main") {
  if (!file && !storageKey) return null;
  return {
    role,
    fileName: file?.name || `ookla-${role}-screenshot`,
    mimeType: file?.type || "image/jpeg",
    sizeBytes: Number.isFinite(file?.size) ? file.size : 0,
    capturedAt: new Date().toISOString(),
    storageKey: storageKey || null,
    exportRelativePath: null,
  };
}

function formatSuggestionValue(value) {
  const safe = sanitizeOoklaDraftFieldValue(value);
  return safe === "" ? "Not detected." : safe;
}

const OCR_STATUS_SHORT_LABELS = {
  dlMbps: "DL",
  ulMbps: "UL",
  pingMs: "Ping",
  jitterMs: "Jitter",
  resultId: "Result ID",
  testDateTime: "Date/Time",
  connectionType: "Connection",
  deviceName: "Device",
  serverName: "Server",
  serverLocation: "Location",
  providerName: "Provider",
  connectionsMode: "Connections Mode",
  packetLossPercent: "Packet Loss",
  ooklaUserLatitude: "Lat",
  ooklaUserLongitude: "Lon",
  resultUrl: "Result URL",
};

function listDetectedOcrLabels(suggestions = {}, keys = []) {
  const safeSuggestions = suggestions && typeof suggestions === "object" ? suggestions : {};
  return (Array.isArray(keys) ? keys : []).filter((key) => {
    const raw = safeSuggestions?.[key];
    return !(raw === null || raw === undefined || String(raw).trim() === "");
  }).map((key) => OCR_STATUS_SHORT_LABELS[key] || formatSuggestionLabel(key));
}

function renderOcrCompactStatus({
  title,
  suggestions = {},
  keys = [],
  keyPrefix,
  fieldMeta = {},
  emptyText = "No values detected yet",
}) {
  const found = listDetectedOcrLabels(suggestions, keys);
  const summary = found.length
    ? `${title}: ${found.join(", ")} found`
    : `${title}: ${emptyText}`;
  return (
    <div className="bd-rf-ookla-ocr-compact-status">
      <p className="bd-rf-ookla-ocr-status-line">{summary}</p>
      {found.length ? (
        <details className="bd-rf-ookla-ocr-details-toggle">
          <summary>Review OCR Details</summary>
          <div className="bd-rf-ookla-suggestions">
            {renderSuggestionsGrid(suggestions, keyPrefix, keys, fieldMeta)}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function safeMetaConfidence(meta) {
  if (!meta || typeof meta !== "object") return "";
  const confidence = meta.confidence;
  if (confidence === null || confidence === undefined) return "";
  return String(confidence);
}

function renderSuggestionsGrid(suggestions = {}, keyPrefix, keys = OOKLA_SUGGESTION_DISPLAY_KEYS, fieldMeta = {}) {
  const safeKeys = Array.isArray(keys) ? keys : [];
  const safeSuggestions = suggestions && typeof suggestions === "object" ? suggestions : {};
  const safeMeta = fieldMeta && typeof fieldMeta === "object" ? fieldMeta : {};
  const detectedKeys = safeKeys.filter((key) => {
    const raw = safeSuggestions?.[key];
    return !(raw === null || raw === undefined || String(raw).trim() === "");
  });
  if (!detectedKeys.length) {
    return (
      <small className="bd-rf-ookla-screenshot-meta">No OCR values detected yet.</small>
    );
  }
  return (
    <div className="bd-rf-ookla-suggestions-grid bd-rf-ookla-suggestions-grid-compact">
      {detectedKeys.map((key) => {
        const meta = safeMeta?.[key];
        const confidence = safeMetaConfidence(meta);
        const raw = safeSuggestions?.[key];
        return (
          <div key={`${keyPrefix}-${key}`} className="bd-rf-ookla-suggestion-item">
            <span>
              {formatSuggestionLabel(key)}
              {confidence ? <em className="bd-rf-ookla-suggestion-confidence"> · {confidence}</em> : null}
            </span>
            <b>{formatSuggestionValue(raw)}</b>
          </div>
        );
      })}
    </div>
  );
}

function resolveIterationSourceLabel(iteration = {}) {
  const source = String(iteration.evidenceSource || iteration.source || "").toLowerCase();
  if (source.includes("csv")) return "CSV";
  if (iteration.mainScreenshot || iteration.detailedScreenshot || iteration.screenshot) return "Screenshot";
  if (iteration.mainOcrAssistUsed || iteration.detailedOcrAssistUsed || iteration.ocrAssistUsed) return "Screenshot";
  return source ? String(iteration.evidenceSource || iteration.source) : "Manual";
}

function resolveIterationStatusLabel(iteration = {}) {
  const confirmation = iteration.confirmation === "fe_confirmed" ? "Confirmed" : "Draft";
  const completeness = iteration.evidenceCompleteness === "complete"
    ? "Complete"
    : (iteration.evidenceCompleteness === "partial" ? "Partial" : null);
  return completeness ? `${confirmation} · ${completeness}` : confirmation;
}

function formatIterationMetric(value) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (Number.isFinite(number)) return String(number);
  const text = String(value).trim();
  return text || "—";
}

async function resolveScreenshotFile(meta, file) {
  if (file) return file;
  if (meta?.storageKey) {
    const record = await readQueuedFile(meta.storageKey);
    return record?.blob || null;
  }
  return null;
}

function formatZoneRange(zone) {
  if (!zone || typeof zone !== "object") return "N/A";
  const topMin = Number.isFinite(zone.topMin) ? Math.round(zone.topMin) : "N/A";
  const topMax = Number.isFinite(zone.topMax) ? Math.round(zone.topMax) : "N/A";
  return `T ${topMin}-${topMax}`;
}

function renderOcrDebug(debug, title) {
  if (!debug || typeof debug !== "object") return null;
  const accepted = Array.isArray(debug.acceptedCandidates) ? debug.acceptedCandidates : [];
  const rejected = Array.isArray(debug.rejectedCandidates) ? debug.rejectedCandidates : [];
  const warnings = Array.isArray(debug.parserWarnings) ? debug.parserWarnings : [];
  const errors = Array.isArray(debug.errors) ? debug.errors : [];
  const fieldMeta = debug.fieldMeta && typeof debug.fieldMeta === "object" ? debug.fieldMeta : {};
  const detectedLabels = debug.detectedLabels && typeof debug.detectedLabels === "object" ? debug.detectedLabels : {};
  const detectedZones = debug.detectedZones && typeof debug.detectedZones === "object" ? debug.detectedZones : {};
  const decisions = Array.isArray(debug.labelValueDecisions) ? debug.labelValueDecisions : [];
  const sortedLines = Array.isArray(debug.linesSortedByTopLeft)
    ? debug.linesSortedByTopLeft
    : (Array.isArray(debug.sortedLines) ? debug.sortedLines : []);

  return (
    <div className="bd-rf-ookla-ocr-debug-body">
      <strong>{title}</strong>
      <small className="bd-rf-ookla-screenshot-meta">
        Accepted: {accepted.length}
        {" · "}
        Rejected: {rejected.length}
        {" · "}
        Warnings: {warnings.length}
      </small>
      {warnings.length ? <pre>{warnings.map((item) => String(item ?? "")).join("\n")}</pre> : null}
      {errors.length ? <pre className="bd-rf-ookla-warning">{errors.map((item) => String(item ?? "")).join("\n")}</pre> : null}
      <strong>Field confidence / reason</strong>
      <pre>
        {Object.entries(fieldMeta).map(([key, meta]) => {
          if (!meta || typeof meta !== "object") return `${key}: N/A`;
          const value = meta.value == null ? "N/A" : String(meta.value);
          const confidence = meta.confidence == null ? "N/A" : String(meta.confidence);
          const reason = meta.reason == null ? "N/A" : String(meta.reason);
          return `${key}: ${value} · ${confidence} · ${reason}`;
        }).join("\n") || "(none)"}
      </pre>
      {Object.keys(detectedLabels).length ? (
        <>
          <strong>Detected labels</strong>
          <pre>
            {Object.entries(detectedLabels).map(([key, label]) => {
              if (!label) return `${key}: N/A`;
              if (typeof label === "string") return `${key}: ${label}`;
              return `${key}: ${label.text || "N/A"}`;
            }).join("\n") || "(none)"}
          </pre>
        </>
      ) : null}
      {decisions.length ? (
        <>
          <strong>Label-value decisions</strong>
          <pre>
            {decisions.map((item) => {
              if (!item || typeof item !== "object") return "N/A";
              const valueText = item.valueText == null ? "(blank)" : `"${item.valueText}"`;
              return `${item.labelKey || "field"}: "${item.labelText || ""}" → ${valueText} [${item.strategy || "N/A"}] — ${item.reason || "N/A"}`;
            }).join("\n") || "(none)"}
          </pre>
        </>
      ) : null}
      {Object.keys(detectedZones).length ? (
        <>
          <strong>Detected zones</strong>
          <pre>
            {Object.entries(detectedZones).map(([key, zone]) => (
              `${key}: ${formatZoneRange(zone)}`
            )).join("\n") || "(none)"}
          </pre>
        </>
      ) : null}
      {sortedLines.length ? (
        <>
          <strong>Sorted OCR lines</strong>
          <pre>
            {sortedLines.map((line, index) => (
              `${index}: ${line?.text ?? "N/A"}`
            )).join("\n")}
          </pre>
        </>
      ) : null}
      <strong>Accepted</strong>
      <pre>
        {accepted.map((item) => {
          if (!item || typeof item !== "object") return "N/A";
          return `${item.fieldName || "field"}: ${item.candidateText ?? "N/A"} · ${item.confidence || "?"} — ${item.reason || "N/A"}`;
        }).join("\n") || "(none)"}
      </pre>
      <strong>Rejected</strong>
      <pre>
        {rejected.map((item) => {
          if (!item || typeof item !== "object") return "N/A";
          return `${item.fieldName || "field"}: ${item.candidateText ?? "N/A"} — ${item.reason || "N/A"}`;
        }).join("\n") || "(none)"}
      </pre>
      <strong>OCR raw text</strong>
      <pre>{debug.rawText || "(none)"}</pre>
    </div>
  );
}

export default function OoklaTestCard({
  savedIterations = [],
  draftResetToken = 0,
  sessionId = "session",
  sessionStartMs = null,
  sessionEndMs = null,
  provisionalSessionEnd = false,
  onSaveEvidence,
  onSaveCsvIterations,
  onCsvImportDebugChange,
  onNewIteration,
  onResetDraft,
  onResetAll,
  disabled = false,
}) {
  const mainGalleryId = useId();
  const mainCameraId = useId();
  const detailedGalleryId = useId();
  const detailedCameraId = useId();
  const [draft, setDraft] = useState(() => emptyDraft());
  const [mainOcrStatus, setMainOcrStatus] = useState("idle");
  const [detailedOcrStatus, setDetailedOcrStatus] = useState("idle");
  const [mainSuggestions, setMainSuggestions] = useState({});
  const [detailedSuggestions, setDetailedSuggestions] = useState({});
  const [ocrMessage, setOcrMessage] = useState("");
  const [urlStatus, setUrlStatus] = useState("idle");
  const [urlSuggestions, setUrlSuggestions] = useState({});
  const [urlMessage, setUrlMessage] = useState("");
  const [saveWarning, setSaveWarning] = useState("");
  const [hybridMessage, setHybridMessage] = useState("");
  const [persistingMain, setPersistingMain] = useState(false);
  const [persistingDetailed, setPersistingDetailed] = useState(false);
  const iterationCount = savedIterations.length;
  const nextIterationNumber = iterationCount + 1;

  useEffect(() => {
    if (draftResetToken > 0) {
      setDraft(emptyDraft());
      setMainOcrStatus("idle");
      setDetailedOcrStatus("idle");
      setMainSuggestions({});
      setDetailedSuggestions({});
      setOcrMessage("");
      setUrlStatus("idle");
      setUrlSuggestions({});
      setUrlMessage("");
      setHybridMessage("");
      setSaveWarning("");
    }
  }, [draftResetToken]);

  const update = (patch) => setDraft((prev) => ({ ...prev, ...patch }));

  function markManualFieldSource(key, value) {
    setDraft((prev) => ({
      ...prev,
      fieldSources: {
        ...(prev.fieldSources || {}),
        [key]: {
          value: String(value ?? prev[key] ?? ""),
          source: "manual",
          confidence: "high",
          reason: "FE-entered manual value",
        },
      },
    }));
  }

  function sanitizeDraftFields(nextDraft = {}) {
    const fieldKeys = [
      "dlMbps", "ulMbps", "pingMs", "jitterMs", "serverName", "serverLocation", "providerName",
      "resultUrl", "resultId", "testDateTime", "connectionType", "deviceName", "connectionsMode",
      "packetLossPercent", "ooklaUserLatitude", "ooklaUserLongitude", "notes",
    ];
    const out = { ...nextDraft };
    fieldKeys.forEach((key) => {
      out[key] = sanitizeOoklaDraftFieldValue(out[key]);
    });
    return out;
  }

  async function runMainScreenshotOcr(workingDraft, { autoApply = true } = {}) {
    try {
      const file = await resolveScreenshotFile(
        workingDraft?.mainScreenshot || workingDraft?.screenshot,
        workingDraft?.mainScreenshotFile || workingDraft?.screenshotFile,
      );
      if (!file) {
        setMainOcrStatus("error");
        setOcrMessage("Main screenshot OCR failed. Please retry or enter values manually. Attach a Main OOKLA result screenshot first.");
        return { ok: false, workingDraft };
      }

      setMainOcrStatus("reading");

      const ocrResult = await recognizeOoklaScreenshotText(file);
      if (!ocrResult?.ok) {
        setMainOcrStatus(ocrResult?.engine === "pending" ? "pending" : "error");
        // Keep prior suggestions/draft — do not clear existing fields on failure.
        setOcrMessage(
          ocrResult?.error
            ? `Main screenshot OCR failed. Please retry or enter values manually. (${ocrResult.error})`
            : "Main screenshot OCR failed. Please retry or enter values manually.",
        );
        return { ok: false, workingDraft };
      }

      const parsed = parseOoklaOcrText(ocrResult.text || "", Array.isArray(ocrResult.lines) ? ocrResult.lines : []);
      if ((parsed?.errors || []).length) {
        setMainOcrStatus("error");
        setOcrMessage("Main screenshot OCR failed. Please retry or enter values manually.");
        update({
          mainOcrDebug: buildOoklaOcrDebugPayload(parsed?.ocrDebug || parsed?.debug, parsed),
          ocrDebug: buildOoklaOcrDebugPayload(parsed?.ocrDebug || parsed?.debug, parsed),
        });
        return { ok: false, workingDraft };
      }

      const allSuggestions = sanitizeOoklaSuggestions(
        parsed?.suggestions || buildOcrSuggestionsForDraft(parsed || {}),
      );
      const highSuggestions = sanitizeOoklaSuggestions(buildHighConfidenceOcrSuggestions(parsed || {}));
      const mainOcrDebug = buildOoklaOcrDebugPayload(parsed?.ocrDebug || parsed?.debug, parsed || {});
      const preview = truncateOcrPreview(ocrResult.text || "");
      setMainSuggestions(allSuggestions);
      setMainOcrStatus(Object.keys(allSuggestions).length ? "suggestions" : "needs_review");

      const warnings = [];
      if (!parsed?.ulMbps && !allSuggestions.ulMbps) warnings.push("UL not confidently read. Please enter manually.");
      const shotMismatch = checkScreenshotResultIdMismatch(
        parsed?.resultId,
        workingDraft?.detailedOcrExtractedFields?.resultId || workingDraft?.resultId,
      );
      const urlMismatch = checkResultIdMismatch(
        parsed?.resultId,
        workingDraft?.resultId || urlSuggestions?.resultId,
      );
      if (shotMismatch) warnings.push(shotMismatch);
      if (urlMismatch) warnings.push(urlMismatch);
      if ((parsed?.ocrDebug?.rejectedCandidates || parsed?.debug?.rejectedCandidates || []).length) {
        warnings.push("Some screenshot values were ignored because they looked like ads, data-used, or responsiveness values.");
      }

      if (!autoApply) {
        update({
          ocrSource: "main_screenshot",
          ocrExtractedFields: allSuggestions,
          ocrRawTextPreview: preview,
          mainOcrDebug,
          ocrDebug: mainOcrDebug,
        });
        setOcrMessage([getOcrSuggestionMessage(parsed || {}, allSuggestions), ...warnings].filter(Boolean).join(" "));
        return { ok: true, workingDraft, suggestions: allSuggestions };
      }

      const applied = applyOoklaEvidenceSuggestionsToDraft({
        draft: workingDraft || {},
        mainSuggestions: highSuggestions,
        detailedSuggestions: workingDraft?.detailedOcrExtractedFields || {},
        urlSuggestions: {
          resultId: urlSuggestions?.resultId || workingDraft?.urlExtractedFields?.resultId,
          providerName: urlSuggestions?.providerName || workingDraft?.urlExtractedFields?.providerName,
        },
        mainFieldMeta: parsed?.fieldMeta || {},
        detailedFieldMeta: workingDraft?.detailedOcrDebug?.fieldMeta || {},
      });

      const nextDraft = sanitizeDraftFields({
        ...(applied?.draft || workingDraft || {}),
        ocrSource: "main_screenshot",
        ocrExtractedFields: allSuggestions,
        ocrRawTextPreview: preview,
        mainOcrDebug,
        ocrDebug: mainOcrDebug,
        mainOcrAssistUsed: true,
        ocrAssistUsed: true,
        screenshot: workingDraft?.mainScreenshot || workingDraft?.screenshot,
      });
      setDraft(nextDraft);
      setOcrMessage([
        getOcrSuggestionMessage(parsed || {}, highSuggestions),
        ...warnings,
        ...(Array.isArray(applied?.mismatchNotes) ? applied.mismatchNotes : []),
      ].filter(Boolean).join(" "));
      setHybridMessage(warnings[0] || "Main screenshot OCR filled high-confidence fields. Review before saving.");
      return { ok: true, workingDraft: nextDraft, suggestions: allSuggestions };
    } catch (error) {
      // Crash-safe: keep draft editable, never navigate away.
      console.error("Main screenshot OCR failed:", error);
      setMainOcrStatus("error");
      setOcrMessage("Main screenshot OCR failed. Please retry or enter values manually.");
      return { ok: false, workingDraft };
    }
  }

  async function runDetailedScreenshotOcr(workingDraft, { autoApply = true } = {}) {
    const file = await resolveScreenshotFile(workingDraft.detailedScreenshot, workingDraft.detailedScreenshotFile);
    if (!file) {
      setDetailedOcrStatus("failed");
      setOcrMessage("Attach a Detailed OOKLA result screenshot before running OCR.");
      return { ok: false, workingDraft };
    }

    setDetailedOcrStatus("reading");
    try {
      const ocrResult = await recognizeOoklaScreenshotText(file);
      if (!ocrResult.ok) {
        setDetailedOcrStatus(ocrResult.engine === "pending" ? "pending" : "failed");
        setDetailedSuggestions({});
        setOcrMessage(ocrResult.error || "Detailed screenshot OCR failed.");
        return { ok: false, workingDraft };
      }

      const parsed = parseOoklaDetailedOcrText(ocrResult.text, ocrResult.lines);
      const allSuggestions = buildDetailedOcrSuggestions(parsed);
      const highSuggestions = buildDetailedOcrSuggestions(parsed, { highConfidenceOnly: true });
      const detailedOcrDebug = parsed.ocrDebug || null;
      const preview = truncateOcrPreview(ocrResult.text);
      setDetailedSuggestions(allSuggestions);
      setDetailedOcrStatus(Object.keys(allSuggestions).length ? "suggestions" : "needs_review");

      const warnings = [...new Set(parsed.parserWarnings || [])];
      const shotMismatch = checkScreenshotResultIdMismatch(
        workingDraft.ocrExtractedFields?.resultId || workingDraft.resultId,
        parsed.resultId,
      );
      const urlMismatch = checkResultIdMismatch(parsed.resultId, workingDraft.resultId || urlSuggestions.resultId);
      if (shotMismatch) warnings.push(shotMismatch);
      if (urlMismatch) warnings.push(urlMismatch);

      if (!autoApply) {
        update({
          detailedOcrExtractedFields: allSuggestions,
          detailedOcrRawTextPreview: preview,
          detailedOcrDebug,
        });
        setOcrMessage(["Detailed screenshot OCR complete.", ...warnings].filter(Boolean).join(" "));
        return { ok: true, workingDraft, suggestions: allSuggestions };
      }

      const applied = applyOoklaEvidenceSuggestionsToDraft({
        draft: workingDraft,
        mainSuggestions: workingDraft.ocrExtractedFields || {},
        detailedSuggestions: highSuggestions,
        urlSuggestions: {
          resultId: urlSuggestions.resultId || workingDraft.urlExtractedFields?.resultId,
          providerName: urlSuggestions.providerName || workingDraft.urlExtractedFields?.providerName,
        },
        mainFieldMeta: workingDraft.mainOcrDebug?.fieldMeta || {},
        detailedFieldMeta: parsed.fieldMeta || {},
      });

      const nextDraft = {
        ...applied.draft,
        detailedOcrExtractedFields: allSuggestions,
        detailedOcrRawTextPreview: preview,
        detailedOcrDebug,
        detailedOcrAssistUsed: true,
        ocrAssistUsed: true,
      };
      setDraft(nextDraft);
      setOcrMessage(["Detailed screenshot OCR filled high-confidence fields.", ...warnings, ...applied.mismatchNotes].filter(Boolean).join(" "));
      setHybridMessage(warnings[0] || "Detailed screenshot OCR applied. BabyDragon GPS remains separate from OOKLA user location.");
      return { ok: true, workingDraft: nextDraft, suggestions: allSuggestions };
    } catch (error) {
      setDetailedOcrStatus("failed");
      setOcrMessage(String(error?.message || error || "Detailed screenshot OCR failed."));
      return { ok: false, workingDraft };
    }
  }

  function handleResultUrlChange(value) {
    const patch = { resultUrl: value };
    const extracted = extractOoklaResultId(value);
    if (extracted && !String(draft.resultId || "").trim()) {
      patch.resultId = extracted;
    }
    update(patch);
  }

  async function handleFetchFromResultUrl() {
    setUrlMessage("");
    setHybridMessage("");
    if (!String(draft.resultUrl || "").trim()) {
      setUrlStatus("failed");
      setUrlMessage("Enter a Result URL before auto-fill.");
      return;
    }

    setUrlStatus("fetching");
    try {
      const extractedId = extractOoklaResultId(draft.resultUrl);
      let workingDraft = { ...draft };
      if (extractedId) workingDraft = { ...workingDraft, resultId: extractedId };

      const result = await fetchOoklaResultFromUrl(draft.resultUrl);
      const suggestions = {
        ...(result.suggestions?.resultId ? { resultId: result.suggestions.resultId } : {}),
        ...(result.suggestions?.providerName ? { providerName: result.suggestions.providerName } : {}),
      };
      const urlApply = applySuggestionsToDraft(workingDraft, suggestions);
      workingDraft = {
        ...urlApply.draft,
        urlExtractedFields: suggestions,
        urlFetchStatus: result.status || "failed",
        urlAssistUsed: Object.keys(urlApply.applied).length > 0,
      };
      setUrlSuggestions(suggestions);
      setUrlStatus(result.status || (result.ok ? "identity" : "failed"));
      setDraft(workingDraft);
      setUrlMessage(result.message || OOKLA_URL_IDENTITY_ONLY_MESSAGE);
      setHybridMessage(
        workingDraft.mainScreenshot
          ? "Result URL stored. Tap Read Main Screenshot for DL/UL/Ping/Jitter."
          : "Result URL stored for evidence/verification. Attach Main OOKLA screenshot for speed fields.",
      );
    } catch (error) {
      setUrlStatus("failed");
      setUrlMessage(String(error?.message || error || "Result URL assist failed safely."));
    }
  }

  async function handlePhotoPicked(event, role = "main") {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (!file) return;

    if (role === "detailed") setPersistingDetailed(true);
    else setPersistingMain(true);
    setOcrMessage("");
    try {
      const stored = await saveOoklaScreenshotFile(file, sessionId, nextIterationNumber, role);
      const meta = screenshotMetadataFromFile(file, stored?.id || null, role);
      if (role === "detailed") {
        update({
          detailedScreenshotFile: file,
          detailedScreenshot: meta,
          detailedOcrAssistUsed: false,
          detailedOcrExtractedFields: {},
          detailedOcrRawTextPreview: "",
          detailedOcrDebug: null,
        });
        setDetailedOcrStatus("idle");
        setDetailedSuggestions({});
        if (!draft.mainScreenshot) {
          setHybridMessage("Detailed screenshot attached. Main screenshot still needed for DL/UL/Ping/Jitter.");
        }
      } else {
        update({
          mainScreenshotFile: file,
          mainScreenshot: meta,
          screenshotFile: file,
          screenshot: meta,
          mainOcrAssistUsed: false,
          ocrAssistUsed: false,
          ocrSource: null,
          ocrExtractedFields: {},
          ocrRawTextPreview: "",
          mainOcrDebug: null,
          ocrDebug: null,
        });
        setMainOcrStatus("idle");
        setMainSuggestions({});
        if (!draft.detailedScreenshot) {
          setHybridMessage("Detailed screenshot not provided. Extra OOKLA details will be missing.");
        }
      }
    } catch (error) {
      setOcrMessage(String(error?.message || error || "Unable to store screenshot locally."));
    } finally {
      setPersistingMain(false);
      setPersistingDetailed(false);
    }
  }

  function handleSave() {
    setSaveWarning("");
    let feConfirmed = draft.feConfirmed;
    const warnings = [];

    const hasDl = draft.dlMbps !== null && draft.dlMbps !== undefined && String(draft.dlMbps).trim() !== "";
    const hasUl = draft.ulMbps !== null && draft.ulMbps !== undefined && String(draft.ulMbps).trim() !== "";
    if (!hasDl || !hasUl) {
      setSaveWarning("Enter or auto-fill DL and UL before saving OOKLA iteration.");
      return;
    }

    if (feConfirmed && !canFeConfirmOoklaDraft(draft)) {
      feConfirmed = false;
      warnings.push(getFeConfirmBlockReason(draft) || "Enter DL/UL, Result ID or URL, and Main screenshot before FE-confirm.");
    }
    if (feConfirmed && !hasFeConfirmedSpeedValues(draft)) {
      feConfirmed = false;
      warnings.push("Enter or apply OOKLA DL/UL before saving as FE-confirmed.");
    }
    if (!draft.ulMbps) warnings.push("UL not confidently read. Please enter manually.");

    const evidenceStatus = buildOoklaEvidenceStatus(draft);
    const valueSource = resolveOoklaValueSource(draft);
    const partialWarning = getPartialEvidenceWarning(draft);
    if (partialWarning) {
      warnings.push("Missing optional fields can be entered manually.");
    }
    if (warnings.length) setSaveWarning(warnings.join(" "));

    onSaveEvidence?.({
      dlMbps: draft.dlMbps,
      ulMbps: draft.ulMbps,
      pingMs: draft.pingMs,
      jitterMs: draft.jitterMs,
      serverName: draft.serverName,
      serverLocation: draft.serverLocation,
      providerName: draft.providerName,
      resultUrl: draft.resultUrl,
      resultId: draft.resultId,
      testDateTime: draft.testDateTime,
      connectionType: draft.connectionType,
      deviceName: draft.deviceName,
      connectionsMode: draft.connectionsMode,
      packetLossPercent: draft.packetLossPercent,
      ooklaUserLatitude: draft.ooklaUserLatitude,
      ooklaUserLongitude: draft.ooklaUserLongitude,
      notes: draft.notes,
      feConfirmed,
      mainScreenshot: draft.mainScreenshot,
      detailedScreenshot: draft.detailedScreenshot,
      screenshot: draft.mainScreenshot,
      ocrAssistUsed: Boolean(draft.ocrAssistUsed || draft.mainOcrAssistUsed || draft.detailedOcrAssistUsed),
      mainOcrAssistUsed: Boolean(draft.mainOcrAssistUsed),
      detailedOcrAssistUsed: Boolean(draft.detailedOcrAssistUsed),
      ocrConfidence: draft.ocrConfidence,
      ocrSource: draft.ocrSource,
      ocrExtractedFields: draft.ocrExtractedFields || {},
      detailedOcrExtractedFields: draft.detailedOcrExtractedFields || {},
      userConfirmedFields: draft.userConfirmedFields || {},
      ocrRawTextPreview: draft.ocrRawTextPreview || "",
      detailedOcrRawTextPreview: draft.detailedOcrRawTextPreview || "",
      mainOcrDebug: draft.mainOcrDebug || null,
      detailedOcrDebug: draft.detailedOcrDebug || null,
      ocrDebug: draft.mainOcrDebug || null,
      urlFetchStatus: draft.urlFetchStatus || "not_attempted",
      urlExtractedFields: draft.urlExtractedFields || {},
      urlAssistUsed: Boolean(draft.urlAssistUsed),
      evidenceSource: "ookla_screenshot",
      evidenceCompleteness: evidenceStatus.evidenceCompleteness,
      requiredEvidenceStatus: evidenceStatus.requiredEvidenceStatus,
      optionalMissingFields: evidenceStatus.optionalMissingFields,
      missingFields: evidenceStatus.missingFields,
      valueSource,
      fieldSources: draft.fieldSources || {},
    });
  }

  function handleResetAll() {
    if (!iterationCount) return;
    const confirmed = window.confirm(`Reset all ${iterationCount} saved OOKLA iteration(s)? This cannot be undone.`);
    if (confirmed) onResetAll?.();
  }

  const mainLabel = draft.mainScreenshotFile?.name || draft.mainScreenshot?.fileName || "No main screenshot selected";
  const detailedLabel = draft.detailedScreenshotFile?.name || draft.detailedScreenshot?.fileName || "No detailed screenshot selected";
  const hasOcrSuggestions = Object.keys(mainSuggestions || {}).length > 0
    || Object.keys(detailedSuggestions || {}).length > 0;
  const hasDlUl = String(draft.dlMbps ?? "").trim() !== "" && String(draft.ulMbps ?? "").trim() !== "";
  const step1DefaultOpen = iterationCount === 0;
  const step2DefaultOpen = hasOcrSuggestions;
  const step3DefaultOpen = hasDlUl;
  const showDeveloperDiagnostics = (() => {
    try {
      if (typeof window === "undefined") return false;
      if (window.localStorage?.getItem("bdOoklaDevDiagnostics") === "1") return true;
      return /(?:\?|&)ooklaDev=1(?:&|$)/.test(String(window.location?.search || ""));
    } catch {
      return false;
    }
  })();

  return (
    <section className="bd-rf-test-card bd-rf-ookla-evidence-card bd-rf-ookla-workflow">
      <header>
        <div>
          <b>OOKLA App</b>
          <span>Capture → Review → Save</span>
        </div>
        <em>EXTERNAL</em>
      </header>

      <p className="bd-rf-ookla-evidence-note">
        Enter OOKLA results as external evidence. BabyDragon records RF/GPS separately.
      </p>

      <details className="bd-rf-ookla-saved-iterations">
        <summary>
          <strong>Saved OOKLA Iterations</strong>
          <small>
            {iterationCount
              ? `${iterationCount} iteration${iterationCount === 1 ? "" : "s"} saved`
              : "No iterations saved yet"}
          </small>
        </summary>
        {iterationCount ? (
          <div className="bd-rf-ookla-iteration-cards">
            {savedIterations.map((iteration) => (
              <article
                key={`ookla-iter-${iteration.iterationNumber}-${iteration.savedAt || iteration.capturedAt}`}
                className="bd-rf-ookla-iteration-card"
              >
                <header>
                  <b>Iteration {iteration.iterationNumber || "?"}</b>
                  <em>{resolveIterationStatusLabel(iteration)}</em>
                </header>
                <div className="bd-rf-ookla-iteration-card-grid">
                  <span><b>DL / UL</b><strong>{formatIterationMetric(iteration.dlMbps)} / {formatIterationMetric(iteration.ulMbps)} Mbps</strong></span>
                  <span><b>Ping / Jitter</b><strong>{formatIterationMetric(iteration.pingMs)} / {formatIterationMetric(iteration.jitterMs)} ms</strong></span>
                  <span><b>Result ID</b><strong>{iteration.resultId || "—"}</strong></span>
                  <span><b>Source</b><strong>{resolveIterationSourceLabel(iteration)}</strong></span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <small className="bd-rf-ookla-screenshot-meta">Save an iteration after capturing OOKLA evidence.</small>
        )}
      </details>

      <details key={`ookla-step1-${step1DefaultOpen ? "open" : "closed"}`} className="bd-rf-ookla-step" defaultOpen={step1DefaultOpen}>
        <summary className="bd-rf-ookla-step-head">
          <b>Step 1</b>
          <span>Capture OOKLA Evidence</span>
        </summary>

        <div className="bd-rf-ookla-step-body">
        <div className="bd-mobile-evidence-picker-v7c bd-rf-ookla-screenshot-picker">
          <div>
            <strong>Main OOKLA result screenshot</strong>
            <span className="bd-rf-ookla-screenshot-meta">{mainLabel}</span>
            {persistingMain ? <small className="bd-rf-ookla-screenshot-meta">Saving main screenshot…</small> : null}
          </div>
          <div className="bd-mobile-evidence-actions-v7c">
            <label className={`bd-mobile-evidence-action-v7c ${disabled ? "is-disabled" : ""}`} htmlFor={mainGalleryId}>Add Picture</label>
            <label className={`bd-mobile-evidence-action-v7c camera ${disabled ? "is-disabled" : ""}`} htmlFor={mainCameraId}>Take Picture</label>
          </div>
          <input id={mainGalleryId} type="file" accept="image/*" disabled={disabled} onChange={(e) => handlePhotoPicked(e, "main")} />
          <input id={mainCameraId} type="file" accept="image/*" capture="environment" disabled={disabled} onChange={(e) => handlePhotoPicked(e, "main")} />
        </div>

        <div className="bd-mobile-evidence-picker-v7c bd-rf-ookla-screenshot-picker">
          <div>
            <strong>Detailed OOKLA result screenshot</strong>
            <span className="bd-rf-ookla-screenshot-meta">{detailedLabel}</span>
            {persistingDetailed ? <small className="bd-rf-ookla-screenshot-meta">Saving detailed screenshot…</small> : null}
          </div>
          <div className="bd-mobile-evidence-actions-v7c">
            <label className={`bd-mobile-evidence-action-v7c ${disabled ? "is-disabled" : ""}`} htmlFor={detailedGalleryId}>Add Picture</label>
            <label className={`bd-mobile-evidence-action-v7c camera ${disabled ? "is-disabled" : ""}`} htmlFor={detailedCameraId}>Take Picture</label>
          </div>
          <input id={detailedGalleryId} type="file" accept="image/*" disabled={disabled} onChange={(e) => handlePhotoPicked(e, "detailed")} />
          <input id={detailedCameraId} type="file" accept="image/*" capture="environment" disabled={disabled} onChange={(e) => handlePhotoPicked(e, "detailed")} />
        </div>

        <div className="bd-rf-ookla-capture-url-panel">
          <div className="bd-rf-ookla-ocr-head">
            <strong>Result URL &amp; Result ID</strong>
          </div>
          <div className="bd-rf-ookla-evidence-grid bd-rf-ookla-capture-url-grid">
            <label className="bd-rf-ookla-span-2">
              <span>Result URL</span>
              <input
                type="text"
                disabled={disabled}
                value={sanitizeOoklaDraftFieldValue(draft.resultUrl)}
                placeholder="https://www.speedtest.net/result/..."
                onChange={(event) => {
                  markManualFieldSource("resultUrl", event.target.value);
                  handleResultUrlChange(event.target.value);
                }}
              />
            </label>
            <label>
              <span>Result ID</span>
              <input
                type="text"
                disabled={disabled}
                value={sanitizeOoklaDraftFieldValue(draft.resultId)}
                placeholder="Result ID"
                onChange={(event) => {
                  markManualFieldSource("resultId", event.target.value);
                  update({ resultId: event.target.value });
                }}
              />
            </label>
          </div>
          <div className="bd-rf-ookla-url-actions bd-rf-ookla-url-actions-compact">
            <button type="button" className="bd-rf-ookla-secondary-btn" disabled={disabled} onClick={() => {
              const extracted = extractOoklaResultId(draft.resultUrl);
              if (!extracted) {
                setUrlMessage("Result ID pattern not recognized in Result URL.");
                return;
              }
              update({ resultId: extracted });
              setUrlMessage(`Result ID extracted: ${extracted}`);
            }}>
              Extract Result ID
            </button>
            <button type="button" className="bd-rf-ookla-secondary-btn" disabled={disabled || !draft.resultUrl} onClick={() => {
              if (!openOoklaResultUrl(draft.resultUrl)) setUrlMessage("Enter a valid Result URL before opening.");
            }}>
              Open Result URL
            </button>
          </div>
          {urlMessage ? <small className="bd-rf-ookla-screenshot-meta">{urlMessage}</small> : null}
        </div>

        <div className="bd-rf-ookla-ocr-panel bd-rf-ookla-ocr-panel-compact">
          <div className="bd-rf-ookla-ocr-head">
            <strong>Main Screenshot OCR</strong>
            <span className="bd-rf-ookla-ocr-status">Status: {mainOcrStatus || "idle"}</span>
          </div>
          <div className="bd-rf-ookla-url-actions">
            <button type="button" className="bd-rf-ookla-secondary-btn" disabled={disabled || mainOcrStatus === "reading" || !draft.mainScreenshot} onClick={() => { void runMainScreenshotOcr(draft); }}>
              {mainOcrStatus === "reading" ? "Reading Main…" : "Read Main Screenshot"}
            </button>
            {mainOcrStatus === "error" ? (
              <small className="bd-rf-ookla-warning">Main screenshot OCR failed. Please retry or enter values manually.</small>
            ) : null}
            <button type="button" className="bd-rf-ookla-secondary-btn" disabled={disabled || !Object.keys(mainSuggestions || {}).length} onClick={() => {
              try {
                const applied = applyOoklaEvidenceSuggestionsToDraft({
                  draft,
                  mainSuggestions: sanitizeOoklaSuggestions(mainSuggestions),
                  detailedSuggestions: draft.detailedOcrExtractedFields || {},
                  urlSuggestions,
                  mainFieldMeta: draft.mainOcrDebug?.fieldMeta || {},
                  detailedFieldMeta: draft.detailedOcrDebug?.fieldMeta || {},
                });
                setDraft(sanitizeDraftFields({
                  ...(applied?.draft || draft),
                  mainOcrAssistUsed: true,
                  ocrAssistUsed: true,
                }));
                setHybridMessage("");
                setOcrMessage("Main OCR applied. Missing optional fields can be entered manually.");
              } catch (error) {
                console.error("Apply Main OCR Suggestions failed:", error);
                setMainOcrStatus("error");
                setOcrMessage("Main screenshot OCR failed. Please retry or enter values manually.");
              }
            }}>
              Apply Main OCR
            </button>
          </div>
          {Object.keys(mainSuggestions).length ? (
            renderOcrCompactStatus({
              title: "Main OCR",
              suggestions: mainSuggestions,
              keys: OOKLA_MAIN_SUGGESTION_KEYS,
              keyPrefix: "main",
              fieldMeta: draft.mainOcrDebug?.fieldMeta,
            })
          ) : null}
        </div>

        <div className="bd-rf-ookla-ocr-panel bd-rf-ookla-ocr-panel-compact">
          <div className="bd-rf-ookla-ocr-head">
            <strong>Detailed Screenshot OCR</strong>
            <span className="bd-rf-ookla-ocr-status">Status: {detailedOcrStatus || "idle"}</span>
          </div>
          <div className="bd-rf-ookla-url-actions">
            <button type="button" className="bd-rf-ookla-secondary-btn" disabled={disabled || detailedOcrStatus === "reading" || !draft.detailedScreenshot} onClick={() => runDetailedScreenshotOcr(draft)}>
              {detailedOcrStatus === "reading" ? "Reading Detailed…" : "Read Detailed Screenshot"}
            </button>
            <button type="button" className="bd-rf-ookla-secondary-btn" disabled={disabled || !Object.keys(detailedSuggestions).length} onClick={() => {
              const applied = applyOoklaEvidenceSuggestionsToDraft({
                draft,
                mainSuggestions: draft.ocrExtractedFields || {},
                detailedSuggestions,
                urlSuggestions,
                mainFieldMeta: draft.mainOcrDebug?.fieldMeta || {},
                detailedFieldMeta: draft.detailedOcrDebug?.fieldMeta || {},
              });
              setDraft({ ...applied.draft, detailedOcrAssistUsed: true, ocrAssistUsed: true });
              setHybridMessage("");
              setOcrMessage("Detailed OCR applied. Missing optional fields can be entered manually.");
            }}>
              Apply Detailed OCR
            </button>
          </div>
          {Object.keys(detailedSuggestions).length ? (
            renderOcrCompactStatus({
              title: "Detailed OCR",
              suggestions: detailedSuggestions,
              keys: OOKLA_DETAILED_SUGGESTION_KEYS,
              keyPrefix: "detailed",
              fieldMeta: draft.detailedOcrDebug?.fieldMeta,
            })
          ) : null}
        </div>

        {(mainOcrStatus === "error" || detailedOcrStatus === "error") && ocrMessage ? (
          <small className="bd-rf-ookla-warning">{ocrMessage}</small>
        ) : null}
        {(hasOcrSuggestions || mainOcrStatus === "ready" || detailedOcrStatus === "ready" || ocrMessage) ? (
          <small className="bd-rf-ookla-screenshot-meta">Missing optional fields can be entered manually.</small>
        ) : null}

        {showDeveloperDiagnostics ? (
          <details className="bd-rf-ookla-developer-diagnostics">
            <summary>Developer Diagnostics</summary>
            <div className="bd-rf-ookla-developer-diagnostics-body">
              <button
                type="button"
                className="bd-rf-ookla-secondary-btn"
                disabled={disabled || urlStatus === "fetching" || !draft.resultUrl}
                onClick={handleFetchFromResultUrl}
              >
                {urlStatus === "fetching" ? "Reading URL…" : "Auto-Fill From URL"}
              </button>
              <small className="bd-rf-ookla-screenshot-meta">Secondary URL auto-fill is developer-only. Prefer Main screenshot OCR.</small>
              {urlStatus !== "idle" ? <small className="bd-rf-ookla-screenshot-meta">URL status: {urlStatus}</small> : null}
              {renderOcrDebug(draft.mainOcrDebug, "Main OCR Debug")}
              {renderOcrDebug(draft.detailedOcrDebug, "Detailed OCR Debug")}
            </div>
          </details>
        ) : null}
        </div>
      </details>

      <details key={`ookla-step2-${step2DefaultOpen ? "open" : "closed"}`} className="bd-rf-ookla-step" defaultOpen={step2DefaultOpen}>
        <summary className="bd-rf-ookla-step-head">
          <b>Step 2</b>
          <span>Review Auto-Filled OOKLA Values</span>
        </summary>
        <div className="bd-rf-ookla-step-body">
        <div className="bd-rf-ookla-evidence-grid">
          {[
            ["dlMbps", "DL Mbps", "number"],
            ["ulMbps", "UL Mbps", "number"],
            ["pingMs", "Ping / Latency ms", "number"],
            ["jitterMs", "Jitter ms", "number"],
            ["serverName", "Server Name", "text", true],
            ["serverLocation", "Server Location", "text", true],
            ["providerName", "Provider Name", "text"],
            ["testDateTime", "Test Date/Time", "text", true],
            ["connectionType", "Connection Type", "text"],
            ["deviceName", "Device Name", "text"],
            ["connectionsMode", "Connections Mode", "text"],
            ["packetLossPercent", "Packet Loss %", "number"],
            ["ooklaUserLatitude", "OOKLA User Latitude", "number"],
            ["ooklaUserLongitude", "OOKLA User Longitude", "number"],
          ].map(([key, label, type, span2]) => (
            <label key={key} className={span2 ? "bd-rf-ookla-span-2" : undefined}>
              <span>{label}</span>
              <input
                type={type === "number" ? "number" : "text"}
                inputMode={type === "number" ? "decimal" : undefined}
                disabled={disabled}
                value={sanitizeOoklaDraftFieldValue(draft[key])}
                placeholder={label}
                onChange={(event) => {
                  markManualFieldSource(key, event.target.value);
                  update({ [key]: event.target.value });
                }}
              />
            </label>
          ))}
          <label className="bd-rf-ookla-span-2">
            <span>Notes</span>
            <textarea
              disabled={disabled}
              value={sanitizeOoklaDraftFieldValue(draft.notes)}
              placeholder="Field notes about this OOKLA result"
              onChange={(event) => update({ notes: event.target.value })}
            />
          </label>
        </div>
        </div>
      </details>

      <details key={`ookla-step3-${step3DefaultOpen ? "open" : "closed"}`} className="bd-rf-ookla-step" defaultOpen={step3DefaultOpen}>
        <summary className="bd-rf-ookla-step-head">
          <b>Step 3</b>
          <span>Confirm and Save</span>
        </summary>
        <div className="bd-rf-ookla-step-body">
        <label className="bd-rf-check-row">
          <input
            type="checkbox"
            disabled={disabled}
            checked={draft.feConfirmed}
            onChange={(event) => update({ feConfirmed: event.target.checked })}
          />
          <span>FE confirmed — values match OOKLA app screenshots/result</span>
        </label>
        <div className="bd-rf-ookla-action-row">
          {saveWarning ? <small className="bd-rf-ookla-warning">{saveWarning}</small> : null}
          <button type="button" className="bd-mobile-primary bd-rf-ookla-save-btn" disabled={disabled} onClick={handleSave}>
            Save Current OOKLA Iteration
          </button>
          <button type="button" className="bd-rf-ookla-secondary-btn" disabled={disabled} onClick={() => { onNewIteration?.(); setDraft(emptyDraft()); }}>
            New Iteration
          </button>
          <button type="button" className="bd-rf-ookla-secondary-btn" disabled={disabled} onClick={() => { onResetDraft?.(); setDraft(emptyDraft()); }}>
            Reset Current Iteration
          </button>
          <button type="button" className="bd-rf-ookla-danger-btn" disabled={disabled || !iterationCount} onClick={handleResetAll}>
            Reset All OOKLA Iterations
          </button>
        </div>
        </div>
      </details>

      <details className="bd-rf-ookla-batch-import">
        <summary>
          <strong>Batch Import from OOKLA CSV</strong>
          <small>Use for 5, 10, or 20 OOKLA iterations. CSV import is for batch OOKLA evidence.</small>
        </summary>
        <OoklaCsvImportPanel
          sessionStartMs={sessionStartMs}
          sessionEndMs={sessionEndMs}
          provisionalEnd={provisionalSessionEnd}
          disabled={disabled}
          onImportDebugChange={onCsvImportDebugChange}
          onAddSelectedRows={async (drafts, debugPayload) => {
            const result = await onSaveCsvIterations?.(drafts, debugPayload);
            return result || null;
          }}
        />
      </details>

      {/* Keeps Step 1–3 / CSV bottoms scrollable above fixed sticky + bottom nav. */}
      <div className="bd-rf-ookla-scroll-clearance" aria-hidden="true" />
    </section>
  );
}
