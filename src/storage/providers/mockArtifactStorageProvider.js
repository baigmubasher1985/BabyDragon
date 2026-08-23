/**
 * F10C2 Phase 4A — deterministic mock ArtifactStorageProvider.
 * No network. No public URLs. Used by tests and default local mode.
 */

import { DEFAULT_SIGNED_TTL_SECONDS, PROVIDER_TYPES } from "../artifactStorageTypes.js";
import { normalizeProviderError } from "../normalizeProviderError.js";

export function createMockArtifactStorageProvider(options = {}) {
  const objects = options.objects instanceof Map ? options.objects : new Map();
  const now = typeof options.now === "function" ? options.now : () => Date.now();

  function keyOf({ bucket, objectKey }) {
    return `${bucket || "mock"}::${objectKey}`;
  }

  return {
    kind: PROVIDER_TYPES.MOCK,
    label: "F10C2 Mock Artifact Storage",
    implemented: true,

    async createUploadPlan({ objectKey, mimeType, sizeBytes, checksum, artifactId } = {}) {
      if (!objectKey) {
        const error = new Error("object_key_required");
        error.code = "invalid_manifest";
        throw error;
      }
      if (/^https?:\/\//i.test(objectKey)) {
        const error = new Error("signed_or_public_url_not_durable");
        error.code = "invalid_manifest";
        throw error;
      }
      return {
        provider_type: PROVIDER_TYPES.MOCK,
        method: "mock_local_put",
        object_key: objectKey,
        provider_object_id: artifactId || objectKey,
        mime_type: mimeType || "application/octet-stream",
        max_size_bytes: sizeBytes ?? null,
        checksum: checksum || null,
        expires_in_seconds: DEFAULT_SIGNED_TTL_SECONDS,
        authorization: { mode: "mock_ticket", ticket: `mock-plan-${artifactId || "art"}` },
        public_url: null,
        resumable: false,
      };
    },

    async createResumableUploadSession({ objectKey, artifactId } = {}) {
      return {
        supported: true,
        session_id: `mock-resume-${artifactId || objectKey}`,
        object_key: objectKey,
        expires_in_seconds: DEFAULT_SIGNED_TTL_SECONDS,
      };
    },

    async confirmUpload({ objectKey, checksum, sizeBytes, bucket } = {}) {
      const key = keyOf({ bucket, objectKey });
      const existing = objects.get(key);
      if (existing && existing.checksum && checksum && existing.checksum !== checksum) {
        const error = new Error("checksum_mismatch");
        error.code = "checksum_mismatch";
        throw error;
      }
      const row = {
        object_key: objectKey,
        bucket: bucket || "mock",
        checksum: checksum || existing?.checksum || null,
        size_bytes: sizeBytes ?? existing?.size_bytes ?? 0,
        confirmed_at: new Date(now()).toISOString(),
      };
      objects.set(key, row);
      return { ok: true, reason: existing ? "idempotent_success" : "confirmed", object: row };
    },

    async statObject({ objectKey, bucket } = {}) {
      const row = objects.get(keyOf({ bucket, objectKey }));
      if (!row) return { ok: true, exists: false, object: null };
      return { ok: true, exists: true, object: row };
    },

    async objectExists(args) {
      const stat = await this.statObject(args);
      return stat.exists === true;
    },

    async createAuthorizedReadAccess({ objectKey, filename, mimeType, sizeBytes } = {}) {
      if (!objectKey) {
        const error = new Error("object_key_required");
        error.code = "invalid_manifest";
        throw error;
      }
      return {
        mode: "mock_local",
        filename: filename || objectKey.split("/").pop(),
        mime_type: mimeType || null,
        size_bytes: sizeBytes ?? null,
        expires_in_seconds: DEFAULT_SIGNED_TTL_SECONDS,
        public_url: null,
        signed_url: null,
        notice: "MOCK DEVELOPMENT ACCESS — not a real Storage signed URL.",
      };
    },

    async verifyIntegrity({ objectKey, checksum, bucket } = {}) {
      const row = objects.get(keyOf({ bucket, objectKey }));
      if (!row) return { ok: false, code: "not_found" };
      if (checksum && row.checksum && row.checksum !== checksum) {
        return { ok: false, code: "checksum_mismatch" };
      }
      return { ok: true, code: "verified" };
    },

    async deleteArtifact({ objectKey, bucket, authorized = false } = {}) {
      if (!authorized) {
        const error = new Error("retention_forbidden");
        error.code = "retention_forbidden";
        throw error;
      }
      objects.delete(keyOf({ bucket, objectKey }));
      return { ok: true };
    },

    normalizeProviderError,

    async healthCheck() {
      return { ok: true, provider_type: PROVIDER_TYPES.MOCK, implemented: true, status: "healthy" };
    },

    __objects: objects,
  };
}

export default { createMockArtifactStorageProvider };
