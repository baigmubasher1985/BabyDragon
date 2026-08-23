/**
 * F10C2 Phase 4A — client-side upload-plan contract.
 * APK never carries connector secrets. Server/policy returns a short-lived plan.
 */

import { DEFAULT_SIGNED_TTL_SECONDS } from "../../../storage/artifactStorageTypes.js";

const FORBIDDEN_PLAN_KEYS = [
  "service_role",
  "access_key",
  "secret_access_key",
  "client_secret",
  "sftp_password",
  "database_url",
];

export function assertUploadPlanSafe(plan = {}) {
  const blob = JSON.stringify(plan || {}).toLowerCase();
  for (const key of FORBIDDEN_PLAN_KEYS) {
    if (blob.includes(key)) {
      return { ok: false, code: "upload_plan_contains_secret" };
    }
  }
  if (plan.public_url) {
    return { ok: false, code: "public_url_forbidden" };
  }
  if (!plan.object_key || /^https?:\/\//i.test(plan.object_key)) {
    return { ok: false, code: "invalid_object_key" };
  }
  const ttl = Number(plan.expires_in_seconds || 0);
  if (ttl <= 0 || ttl > 900) {
    return { ok: false, code: "upload_plan_ttl_invalid" };
  }
  return { ok: true };
}

export function buildClientUploadRequest({
  clientRunId,
  manifest,
  artifact,
  tenantSlug = null,
} = {}) {
  if (!clientRunId || !manifest || !artifact?.artifact_id) {
    throw new Error("upload_request_incomplete");
  }
  return {
    client_run_id: clientRunId,
    idempotency_key: `${clientRunId}:${artifact.artifact_id}`,
    tenant_slug: tenantSlug,
    artifact_type: artifact.artifact_type,
    mime_type: artifact.mime_type,
    size_bytes: artifact.size_bytes,
    checksum: artifact.checksum,
    original_file_name: artifact.original_file_name,
  };
}

export function applyUploadPlanToArtifact(artifact, plan) {
  const safety = assertUploadPlanSafe(plan);
  if (!safety.ok) {
    const error = new Error(safety.code);
    error.code = safety.code;
    throw error;
  }
  return {
    ...artifact,
    object_key: plan.object_key,
    upload_plan: {
      provider_type: plan.provider_type,
      method: plan.method,
      expires_in_seconds: plan.expires_in_seconds || DEFAULT_SIGNED_TTL_SECONDS,
      authorization_mode: plan.authorization?.mode || null,
    },
  };
}

export default {
  assertUploadPlanSafe,
  buildClientUploadRequest,
  applyUploadPlanToArtifact,
};
