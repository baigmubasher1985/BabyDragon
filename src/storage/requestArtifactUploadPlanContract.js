/**
 * F10C2 Phase 4A-R1 — local model of request_artifact_upload_plan.
 * Mirrors the unapplied SQL draft for tests. Does not connect to a database.
 */

import { PROVIDER_TYPES } from "./artifactStorageTypes.js";
import { DEFAULT_SIGNED_TTL_SECONDS } from "./artifactStorageTypes.js";
import {
  assertArtifactConnectionSameTenant,
  assertArtifactRunSameTenant,
  assertPersistedArtifactType,
  assertPolicyConnectionSameTenant,
  assertTransferJobArtifactSameTenant,
  deriveTrustedDestination,
} from "./tenantStorageIntegrity.js";

function fail(code) {
  return { ok: false, code };
}

function normalizeKey(value) {
  if (value == null) return "";
  return String(value).trim();
}

export function requestArtifactUploadPlanContract({
  sessionUserId = null,
  role = "fe",
  isActive = true,
  run = null,
  artifact = null,
  policies = [],
  connections = [],
  jobs = [],
  p_artifact_type = null,
  p_checksum = null,
  p_idempotency_key = null,
  now = () => Date.now(),
} = {}) {
  if (!sessionUserId) return fail("not_authenticated");
  const idempotencyKey = normalizeKey(p_idempotency_key);
  if (!idempotencyKey) return fail("idempotency_key_required");
  if (!isActive) return fail("forbidden_inactive");
  if (!run) return fail("not_found");
  if (run.submitted_by !== sessionUserId && !["admin", "super_admin", "qc"].includes(role)) {
    return fail("owner_mismatch");
  }
  if (!artifact || artifact.run_id !== run.id) return fail("artifact_not_found");
  if (artifact.checksum !== p_checksum) return fail("checksum_mismatch");

  const typeCheck = assertPersistedArtifactType({
    requestedType: p_artifact_type,
    persistedType: artifact.artifact_type,
  });
  if (!typeCheck.ok) return fail(typeCheck.code);

  const runTenant = assertArtifactRunSameTenant({ artifact, run });
  if (!runTenant.ok) return fail(runTenant.code);

  const tenantId = artifact.tenant_id || run.tenant_id || null;
  let policy = null;
  let connection = null;
  if (tenantId) {
    policy = (policies || []).find(
      (p) => p.tenant_id === tenantId && p.artifact_type === artifact.artifact_type,
    ) || null;
    if (policy?.storage_connection_id) {
      connection = (connections || []).find((c) => c.id === policy.storage_connection_id) || null;
      const sameTenant = assertPolicyConnectionSameTenant({ policy, connection });
      if (!sameTenant.ok) return fail(sameTenant.code);
      if (!connection || connection.is_active === false || connection.tenant_id !== tenantId) {
        return fail("storage_connection_cross_tenant");
      }
    } else {
      connection = (connections || []).find(
        (c) => c.tenant_id === tenantId && c.is_default && c.is_active !== false,
      ) || null;
    }
  }

  const connTenant = assertArtifactConnectionSameTenant({
    artifact: {
      ...artifact,
      storage_connection_id: artifact.storage_connection_id || connection?.id || null,
      tenant_id: artifact.tenant_id || tenantId,
    },
    connection,
  });
  if (artifact.storage_connection_id && !connTenant.ok) return fail(connTenant.code);

  const providerType = connection?.provider_type || PROVIDER_TYPES.SUPABASE;
  if (providerType !== PROVIDER_TYPES.SUPABASE) {
    return fail("provider_not_implemented");
  }

  const destination = deriveTrustedDestination({ connection });
  if (!destination.ok) return fail(destination.code);

  let job = null;
  const store = Array.isArray(jobs) ? jobs : [];
  if (artifact.tenant_id) {
    const byKey = store.find((j) => j.idempotency_key === idempotencyKey);
    if (byKey) {
      if (
        byKey.tenant_id !== artifact.tenant_id
        || byKey.artifact_id !== artifact.id
        || byKey.operation !== "request_artifact_upload_plan"
      ) {
        return fail("idempotency_key_reuse");
      }
      const bound = assertTransferJobArtifactSameTenant({ job: byKey, artifact });
      if (!bound.ok) return fail(bound.code);
      job = byKey;
    } else {
      const byArtifact = store.find(
        (j) =>
          j.tenant_id === artifact.tenant_id
          && j.artifact_id === artifact.id
          && j.operation === "request_artifact_upload_plan",
      );
      if (byArtifact) {
        if (byArtifact.idempotency_key !== idempotencyKey) {
          return fail("idempotency_key_reuse");
        }
        job = byArtifact;
      } else {
        job = {
          id: `job-${artifact.id}`,
          tenant_id: artifact.tenant_id,
          artifact_id: artifact.id,
          operation: "request_artifact_upload_plan",
          idempotency_key: idempotencyKey,
          source: "mobile_session_upload",
          destination: destination.bucket,
          state: "planning",
        };
        store.push(job);
      }
    }
  }

  const ttl = DEFAULT_SIGNED_TTL_SECONDS;
  const issuedAt = now();
  return {
    ok: true,
    jobs: store,
    plan: {
      ok: true,
      provider_type: providerType,
      method: "session_scoped_put",
      object_key: artifact.object_key,
      bucket: destination.bucket,
      provider_object_id: artifact.provider_object_id || artifact.id,
      artifact_id: artifact.id,
      artifact_type: artifact.artifact_type,
      tenant_id: artifact.tenant_id || null,
      expires_in_seconds: ttl,
      expires_at: new Date(issuedAt + ttl * 1000).toISOString(),
      authorization: { mode: "existing_session" },
      public_url: null,
      idempotency_key: idempotencyKey,
      transfer_job_id: job?.id || null,
      secret_material: null,
    },
  };
}

export default { requestArtifactUploadPlanContract };
