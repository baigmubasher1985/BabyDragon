/**
 * F10C2 Phase 4A-R1 — fail-closed tenant storage integrity checks.
 * Mirrors unapplied composite FK rules. Not a substitute for the drafts.
 */

const BANNED_BUCKETS = Object.freeze(["task-photos", "operational-evidence"]);

export function assertPolicyConnectionSameTenant({ policy, connection } = {}) {
  if (!policy?.storage_connection_id) {
    return { ok: true, code: "fallback_default" };
  }
  if (!connection || connection.id !== policy.storage_connection_id) {
    return { ok: false, code: "storage_connection_inactive" };
  }
  if (policy.tenant_id && connection.tenant_id && policy.tenant_id !== connection.tenant_id) {
    return { ok: false, code: "storage_connection_cross_tenant" };
  }
  return { ok: true };
}

export function assertArtifactRunSameTenant({ artifact, run } = {}) {
  if (!artifact || !run) {
    return { ok: false, code: "tenant_required" };
  }
  if (!artifact.tenant_id && !run.tenant_id) {
    return { ok: true, code: "legacy_nullable_tenant" };
  }
  if (!artifact.tenant_id || !run.tenant_id) {
    return { ok: true, code: "legacy_partial_backfill" };
  }
  if (artifact.tenant_id !== run.tenant_id) {
    return { ok: false, code: "tenant_mismatch" };
  }
  return { ok: true };
}

export function assertArtifactConnectionSameTenant({ artifact, connection } = {}) {
  if (!artifact?.storage_connection_id) {
    return { ok: true, code: "connection_unassigned" };
  }
  if (!artifact.tenant_id) {
    return { ok: false, code: "connection_requires_tenant" };
  }
  if (!connection || connection.id !== artifact.storage_connection_id) {
    return { ok: false, code: "storage_connection_inactive" };
  }
  if (connection.tenant_id !== artifact.tenant_id) {
    return { ok: false, code: "storage_connection_cross_tenant" };
  }
  return { ok: true };
}

export function assertTransferJobArtifactSameTenant({ job, artifact } = {}) {
  if (!job || !artifact) {
    return { ok: false, code: "tenant_required" };
  }
  if (!artifact.tenant_id) {
    return { ok: false, code: "legacy_transfer_job_forbidden" };
  }
  if (job.tenant_id !== artifact.tenant_id || job.artifact_id !== artifact.id) {
    return { ok: false, code: "tenant_mismatch" };
  }
  return { ok: true };
}

export function assertPersistedArtifactType({ requestedType, persistedType } = {}) {
  if (requestedType == null || String(requestedType).trim() === "") {
    return { ok: true, selected: persistedType };
  }
  if (requestedType !== persistedType) {
    return { ok: false, code: "artifact_type_mismatch", selected: persistedType };
  }
  return { ok: true, selected: persistedType };
}

export function deriveTrustedDestination({ connection, fallbackBucket = "result-artifacts" } = {}) {
  const bucket = connection?.bucket_or_container || fallbackBucket;
  if (BANNED_BUCKETS.includes(bucket) || /^https?:\/\//i.test(String(bucket))) {
    return { ok: false, code: "banned_bucket" };
  }
  return { ok: true, bucket };
}

export { BANNED_BUCKETS };

export default {
  assertPolicyConnectionSameTenant,
  assertArtifactRunSameTenant,
  assertArtifactConnectionSameTenant,
  assertTransferJobArtifactSameTenant,
  assertPersistedArtifactType,
  deriveTrustedDestination,
  BANNED_BUCKETS,
};
