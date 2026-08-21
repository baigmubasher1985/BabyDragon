/**
 * F10C2 Phase 2 — Local artifact descriptors (paths stripped; no signed URLs).
 * Large binaries stay as file refs — never embedded in localStorage JSON.
 */

import {
  ARTIFACT_TYPES,
  RESULT_ARTIFACTS_BUCKET,
  buildArtifactDescriptor,
  buildResultArtifactObjectKey,
} from "../reports/serverSubmissionManifest.js";
import { getOrCreateArtifactId } from "./clientRunIdStore.js";
import { ARTIFACT_STATES } from "./resultPackageStates.js";

const SAFE_EXTENSIONS = new Set(["json", "csv", "xlsx", "zip", "jpg", "jpeg", "png"]);

const MIME_BY_EXT = Object.freeze({
  json: "application/json",
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
});

const TYPE_BY_NAME_HINT = [
  { re: /unified|field.?test.?report/i, type: ARTIFACT_TYPES.UNIFIED_JSON },
  { re: /_Report\.json$/i, type: ARTIFACT_TYPES.UNIFIED_JSON },
  { re: /RF_GPS|rf.?gps.?trace|_RF_/i, type: ARTIFACT_TYPES.RF_CSV },
  { re: /gps.?trace|GPS_Trace/i, type: ARTIFACT_TYPES.GPS_CSV },
  { re: /event/i, type: ARTIFACT_TYPES.EVENTS_CSV },
  { re: /THP_Iterations|Summary\.csv|scenario/i, type: ARTIFACT_TYPES.SCENARIO_CSV },
  { re: /Plots_Report|excel|xlsx/i, type: ARTIFACT_TYPES.EXCEL_PLOT },
  { re: /ookla/i, type: ARTIFACT_TYPES.OOKLA_EVIDENCE },
  { re: /fcc/i, type: ARTIFACT_TYPES.FCC_EVIDENCE },
  { re: /\.zip$/i, type: ARTIFACT_TYPES.PACKAGE_ZIP },
];

export function stripAbsolutePath(input) {
  if (input == null) return null;
  let name = String(input).replace(/\\/g, "/");
  // Drop drive / URI prefixes
  name = name.replace(/^[a-zA-Z]:\//, "");
  name = name.replace(/^file:\/\//i, "");
  const parts = name.split("/");
  return parts[parts.length - 1] || null;
}

export function rejectUnsafePath(input) {
  const raw = String(input || "");
  if (!raw) return { ok: false, reason: "empty_path" };
  if (raw.includes("..") || raw.includes("\0")) {
    return { ok: false, reason: "path_traversal" };
  }
  if (/^https?:\/\//i.test(raw)) {
    return { ok: false, reason: "signed_or_public_url_forbidden" };
  }
  return { ok: true };
}

export function safeExtensionFromName(fileName) {
  const base = stripAbsolutePath(fileName) || "";
  const m = /\.([a-zA-Z0-9]+)$/.exec(base);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  if (!SAFE_EXTENSIONS.has(ext)) return null;
  return ext === "jpeg" ? "jpg" : ext;
}

export function mimeForExtension(ext, fallback = null) {
  const normalized = String(ext || "").toLowerCase().replace(/^\./, "");
  return MIME_BY_EXT[normalized] || fallback || null;
}

export function inferArtifactType(fileName, explicitType = null) {
  if (explicitType && Object.values(ARTIFACT_TYPES).includes(explicitType)) {
    return explicitType;
  }
  const name = stripAbsolutePath(fileName) || "";
  for (const rule of TYPE_BY_NAME_HINT) {
    if (rule.re.test(name)) return rule.type;
  }
  return ARTIFACT_TYPES.OTHER;
}

/**
 * Build a local-only artifact record (file ref, not bytes).
 */
export function buildLocalArtifactRecord({
  clientRunId,
  fileName,
  artifactType = null,
  mimeType = null,
  sizeBytes = 0,
  checksum = null,
  localFileRef = null,
  localUri = null,
  missingLocal = false,
  optional = false,
} = {}) {
  const pathCheck = rejectUnsafePath(fileName || localUri || "artifact.bin");
  if (!pathCheck.ok && !missingLocal) {
    throw new Error(pathCheck.reason);
  }

  const originalFileName = stripAbsolutePath(fileName) || stripAbsolutePath(localUri) || "artifact.bin";
  const ext = safeExtensionFromName(originalFileName);
  if (!missingLocal && !ext) {
    throw new Error("unsafe_extension");
  }

  const type = inferArtifactType(originalFileName, artifactType);
  const mime = mimeType || mimeForExtension(ext, "application/octet-stream");
  const { artifact_id } = getOrCreateArtifactId({
    clientRunId,
    artifactType: type,
    logicalName: originalFileName,
  });

  return {
    artifact_id,
    artifact_type: type,
    original_file_name: originalFileName,
    mime_type: mime,
    size_bytes: typeof sizeBytes === "number" ? sizeBytes : 0,
    checksum: checksum || null,
    safe_extension: ext,
    // Local-only refs — never placed in server manifest as absolute paths.
    local_file_ref: localFileRef || null,
    local_uri_basename: stripAbsolutePath(localUri),
    missing_local: Boolean(missingLocal),
    optional: Boolean(optional),
    upload_status: missingLocal ? ARTIFACT_STATES.MISSING_LOCAL : ARTIFACT_STATES.PENDING,
    // Server fields filled later — no bucket in object_key string alone.
    bucket: RESULT_ARTIFACTS_BUCKET,
    object_key: null,
  };
}

/**
 * Convert local artifact record → Phase 1 server descriptor (no absolute paths).
 */
export function toServerArtifactDescriptor(localArtifact, {
  projectId,
  taskId,
  verifiedUserId,
  fieldTestRunId,
} = {}) {
  if (!localArtifact?.artifact_id) throw new Error("artifact_id_required");
  if (localArtifact.missing_local && !localArtifact.optional) {
    throw new Error("missing_required_local_artifact");
  }
  if (!localArtifact.checksum) throw new Error("checksum_required");

  let objectKey = localArtifact.object_key || null;
  if (!objectKey && projectId && taskId && verifiedUserId && fieldTestRunId && localArtifact.safe_extension) {
    objectKey = buildResultArtifactObjectKey({
      projectId,
      taskId,
      verifiedUserId,
      fieldTestRunId,
      artifactId: localArtifact.artifact_id,
      safeExtension: localArtifact.safe_extension,
    });
  }

  return buildArtifactDescriptor({
    artifactId: localArtifact.artifact_id,
    artifactType: localArtifact.artifact_type,
    originalFileName: localArtifact.original_file_name,
    mimeType: localArtifact.mime_type,
    sizeBytes: localArtifact.size_bytes,
    checksum: localArtifact.checksum,
    safeExtension: localArtifact.safe_extension,
    uploadStatus: localArtifact.upload_status || "pending",
    objectKey,
    bucket: RESULT_ARTIFACTS_BUCKET,
  });
}

/**
 * Deterministic checksum helper (sha256 hex). Prefer Web Crypto; pure fallback otherwise.
 * Avoids importing node:crypto so the browser bundle stays clean.
 */
export async function computeChecksumHex(content) {
  const text = typeof content === "string" ? content : String(content ?? "");
  const data = new TextEncoder().encode(text);

  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest("SHA-256", data);
    return `sha256:${bufferToHex(digest)}`;
  }

  // Deterministic non-crypto fallback for constrained test environments only.
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `sha256:fallback-${(h >>> 0).toString(16).padStart(8, "0")}-${text.length}`;
}

function bufferToHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function buildLocalArtifactsFromReportFiles({
  clientRunId,
  files = [],
} = {}) {
  return (Array.isArray(files) ? files : []).map((file) => {
    const fileName = file.fileName || file.name || "artifact.bin";
    const missing = Boolean(file.missingLocal || file.missing_local);
    return buildLocalArtifactRecord({
      clientRunId,
      fileName,
      artifactType: file.artifactType || file.artifact_type || null,
      mimeType: file.mimeType || file.mime_type || null,
      sizeBytes: file.sizeBytes ?? file.size ?? (file.content ? String(file.content).length : 0),
      checksum: file.checksum || null,
      localFileRef: file.localFileRef || file.id || null,
      localUri: file.path || file.uri || null,
      missingLocal: missing,
      optional: Boolean(file.optional),
    });
  });
}

export default {
  stripAbsolutePath,
  rejectUnsafePath,
  safeExtensionFromName,
  mimeForExtension,
  inferArtifactType,
  buildLocalArtifactRecord,
  toServerArtifactDescriptor,
  computeChecksumHex,
  buildLocalArtifactsFromReportFiles,
};
