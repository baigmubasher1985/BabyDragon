/**
 * F10C2 Phase 4A — Supabase reference ArtifactStorageProvider.
 * Session JWT only. No service-role. No getPublicUrl.
 */

import { RESULT_ARTIFACTS_BUCKET } from "../../mobile/rf/reports/serverSubmissionManifest.js";
import {
  DEFAULT_SIGNED_TTL_SECONDS,
  PROVIDER_TYPES,
} from "../artifactStorageTypes.js";
import { normalizeProviderError } from "../normalizeProviderError.js";

function err(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function isAlreadyExists(error) {
  const text = `${error?.message || ""} ${error?.statusCode || ""}`.toLowerCase();
  return text.includes("already exists") || text.includes("duplicate") || String(error?.statusCode) === "409";
}

export function createSupabaseArtifactStorageProvider(options = {}) {
  const supabase = options.supabase;
  if (!supabase) throw err("invalid_manifest", "supabase_client_required");
  const bucket = options.bucket || RESULT_ARTIFACTS_BUCKET;
  const ttl = Number(options.signedUrlTtlSeconds) || DEFAULT_SIGNED_TTL_SECONDS;

  return {
    kind: PROVIDER_TYPES.SUPABASE,
    label: "F10C2 Supabase Artifact Storage",
    implemented: true,
    bucket,

    async createUploadPlan({ objectKey, mimeType, sizeBytes, checksum, artifactId } = {}) {
      if (!objectKey) throw err("invalid_manifest", "object_key_required");
      if (/^https?:\/\//i.test(objectKey)) {
        throw err("invalid_manifest", "signed_or_public_url_not_durable");
      }
      return {
        provider_type: PROVIDER_TYPES.SUPABASE,
        method: "session_scoped_put",
        object_key: objectKey,
        bucket,
        provider_object_id: artifactId || objectKey,
        mime_type: mimeType || "application/octet-stream",
        max_size_bytes: sizeBytes ?? null,
        checksum: checksum || null,
        expires_in_seconds: ttl,
        authorization: { mode: "existing_session" },
        public_url: null,
        resumable: false,
      };
    },

    async createResumableUploadSession() {
      return { supported: false, reason: "supabase_resumable_not_configured" };
    },

    async confirmUpload({ objectKey, checksum, body, mimeType } = {}) {
      if (!objectKey) throw err("invalid_manifest", "object_key_required");
      const { error } = await supabase.storage.from(bucket).upload(objectKey, body ?? "", {
        contentType: mimeType || "application/octet-stream",
        upsert: false,
      });
      if (error && isAlreadyExists(error)) {
        return { ok: true, reason: "idempotent_success", object_key: objectKey, checksum };
      }
      if (error) {
        const mapped = normalizeProviderError(error);
        throw Object.assign(new Error(mapped.sanitized), { code: mapped.code });
      }
      return { ok: true, reason: "uploaded", object_key: objectKey, checksum };
    },

    async statObject({ objectKey } = {}) {
      if (!objectKey) return { ok: true, exists: false, object: null };
      const prefix = objectKey.includes("/") ? objectKey.slice(0, objectKey.lastIndexOf("/")) : "";
      const name = objectKey.split("/").pop();
      const { data, error } = await supabase.storage.from(bucket).list(prefix, { search: name, limit: 20 });
      if (error) {
        const mapped = normalizeProviderError(error);
        throw Object.assign(new Error(mapped.sanitized), { code: mapped.code });
      }
      const found = (data || []).find((item) => item.name === name);
      return { ok: true, exists: Boolean(found), object: found || null };
    },

    async objectExists(args) {
      const stat = await this.statObject(args);
      return stat.exists === true;
    },

    async createAuthorizedReadAccess({ objectKey, filename, mimeType, sizeBytes } = {}) {
      if (!objectKey) throw err("invalid_manifest", "object_key_required");
      if (/^https?:\/\//i.test(objectKey)) {
        throw err("invalid_manifest", "signed_or_public_url_not_durable");
      }
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(objectKey, ttl);
      if (error || !data?.signedUrl) {
        const mapped = normalizeProviderError(error || { message: "signed_url_failed" });
        throw Object.assign(new Error(mapped.sanitized), { code: mapped.code });
      }
      return {
        mode: "signed_url",
        filename: filename || objectKey.split("/").pop(),
        mime_type: mimeType || null,
        size_bytes: sizeBytes ?? null,
        expires_in_seconds: ttl,
        public_url: null,
        signed_url: data.signedUrl,
        notice: "PROTECTED ACCESS — short-lived signed URL (not stored as durable ref).",
      };
    },

    async verifyIntegrity({ expectedChecksum, actualChecksum } = {}) {
      if (expectedChecksum && actualChecksum && expectedChecksum !== actualChecksum) {
        return { ok: false, code: "checksum_mismatch" };
      }
      return { ok: true, code: "verified" };
    },

    async deleteArtifact({ authorized = false } = {}) {
      if (!authorized) throw err("retention_forbidden", "Authorized retention cleanup required");
      return { ok: false, code: "not_implemented_in_phase4a" };
    },

    normalizeProviderError,

    async healthCheck() {
      return {
        ok: true,
        provider_type: PROVIDER_TYPES.SUPABASE,
        implemented: true,
        status: "configured",
        bucket,
      };
    },
  };
}

export default { createSupabaseArtifactStorageProvider };
