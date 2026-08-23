/**
 * F10C2 Phase 4A — route an artifact type to a tenant storage policy/connection.
 * Missing policy falls back to tenant default connection. Never leaks credentials.
 * Cross-tenant policy → connection references fail closed.
 */

import { assertPolicyConnectionSameTenant } from "./tenantStorageIntegrity.js";

export function selectStoragePolicy({
  artifactType,
  tenantId = null,
  policies = [],
  connections = [],
  defaultConnectionId = null,
} = {}) {
  const type = String(artifactType || "").trim();
  const scopedPolicies = (policies || []).filter((p) => {
    if (!p || p.artifact_type !== type) return false;
    if (tenantId && p.tenant_id && p.tenant_id !== tenantId) return false;
    return true;
  });
  const policy = scopedPolicies[0] || null;
  const connectionId = policy?.storage_connection_id || defaultConnectionId;
  const connection = (connections || []).find((c) => c.id === connectionId && c.is_active !== false) || null;

  if (policy && policy.storage_connection_id && !connection) {
    return {
      ok: false,
      code: "storage_connection_inactive",
      policy,
      connection: null,
    };
  }

  const sameTenant = assertPolicyConnectionSameTenant({ policy, connection });
  if (policy?.storage_connection_id && !sameTenant.ok) {
    return {
      ok: false,
      code: sameTenant.code,
      policy,
      connection: null,
    };
  }

  if (tenantId && connection?.tenant_id && connection.tenant_id !== tenantId) {
    return {
      ok: false,
      code: "storage_connection_cross_tenant",
      policy,
      connection: null,
    };
  }

  return {
    ok: true,
    policy: policy || {
      artifact_type: type || null,
      tenant_id: tenantId,
      upload_mode: "direct_scoped",
      processing_location: "mobbi_cloud",
      allow_cloud_metadata: true,
      allow_cloud_preview: false,
      allow_temporary_cache: false,
      storage_connection_id: connectionId,
    },
    connection,
  };
}

export function assertTenantScope({ actorTenantId, recordTenantId }) {
  if (!actorTenantId || !recordTenantId) {
    return { ok: false, code: "tenant_required" };
  }
  if (actorTenantId !== recordTenantId) {
    return { ok: false, code: "tenant_mismatch" };
  }
  return { ok: true };
}

export function filterArtifactsForTenant(artifacts, tenantId) {
  return (artifacts || []).filter((a) => !a.tenant_id || a.tenant_id === tenantId);
}

export default {
  selectStoragePolicy,
  assertTenantScope,
  filterArtifactsForTenant,
};
