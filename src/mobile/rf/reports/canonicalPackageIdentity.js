/**
 * CR1-B-U-R1 — Durable canonical package identity.
 * Identity is session/client-run + scenario, never an export timestamp.
 * Export folders may keep a timestamp as an artifact instance id.
 */

import { resolveScenarioKey } from "./scenarioReportModel.js";

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function cleanFilePart(value, fallback = "bd-rf-session") {
  const text = String(value || fallback).trim() || fallback;
  return text
    .replace(/[^a-z0-9._-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || fallback;
}

export function formatExportStamp(timestamp = Date.now()) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return String(timestamp);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function resolveSessionId(session = {}) {
  return cleanText(session.id)
    || cleanText(session.session_id)
    || cleanText(session.sessionId)
    || null;
}

export function resolveCanonicalScenarioKey(session = {}) {
  return resolveScenarioKey(session);
}

/**
 * Stable identity for one field-test scenario. Repeated Stop/Save and Export
 * of the same session must reuse this key.
 */
export function buildCanonicalPackageIdentity(session = {}, extras = {}) {
  const sessionId = resolveSessionId(session) || cleanText(extras.sessionId);
  const scenarioKey = cleanText(extras.scenarioKey) || resolveCanonicalScenarioKey(session) || "unknown";
  if (!sessionId) {
    return {
      ok: false,
      reason: "missing_session_id",
      sessionId: null,
      scenarioKey,
      canonicalPackageId: null,
      folderId: null,
      identityKey: null,
    };
  }
  const canonicalPackageId = `${sessionId}::${scenarioKey}`;
  const folderId = cleanFilePart(`${sessionId}__${scenarioKey}`, sessionId);
  return {
    ok: true,
    sessionId,
    scenarioKey,
    canonicalPackageId,
    folderId,
    identityKey: `session:${sessionId}|scenario:${scenarioKey}`,
  };
}

export function parseCanonicalPackageId(value) {
  const text = cleanText(value);
  if (!text) return null;
  const split = text.split("::");
  if (split.length === 2 && split[0] && split[1]) {
    return { sessionId: split[0], scenarioKey: split[1], canonicalPackageId: text };
  }
  const folder = text.split("__");
  if (folder.length >= 2 && folder[0].startsWith("bd-rf-")) {
    const sessionId = folder[0];
    const rest = folder.slice(1).join("__").replace(/__export_.*$/, "");
    if (rest) return { sessionId, scenarioKey: rest, canonicalPackageId: `${sessionId}::${rest}` };
  }
  return { sessionId: text, scenarioKey: null, canonicalPackageId: text };
}

export function buildCanonicalFolderId(session = {}, extras = {}) {
  const identity = buildCanonicalPackageIdentity(session, extras);
  return identity.ok ? identity.folderId : null;
}

export function buildExportArtifactFolderId(session = {}, generatedAt = Date.now(), extras = {}) {
  const identity = buildCanonicalPackageIdentity(session, extras);
  if (!identity.ok) return cleanFilePart(`bd-rf-${generatedAt}`);
  return `${identity.folderId}__export_${formatExportStamp(generatedAt)}`;
}

export function isExportArtifactFolderId(folderId) {
  return /__export_\d{8}_\d{6}$/.test(String(folderId || ""));
}

export function scenarioCoreFingerprint(session = {}, scenarioKey = null) {
  const sid = resolveSessionId(session) || "";
  const scenario = scenarioKey || resolveCanonicalScenarioKey(session) || "";
  const started = session.startedAt || session.started_at || session.started_at_iso || "";
  const samples = session.sampleCount ?? session.sample_count ?? "";
  const completed = session.appCompletedIterations ?? session.app_completed_iterations ?? "";
  return `${sid}|${scenario}|${started}|${samples}|${completed}`;
}

export default {
  buildCanonicalPackageIdentity,
  buildCanonicalFolderId,
  buildExportArtifactFolderId,
  parseCanonicalPackageId,
  formatExportStamp,
  isExportArtifactFolderId,
  scenarioCoreFingerprint,
  resolveSessionId,
};
