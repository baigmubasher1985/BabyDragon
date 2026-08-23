/**
 * F10C2 Phase 4A — customer-worker processing-location contract.
 * Full worker implementation is scheduled for Phase 4D. This module is the boundary.
 */

import { PROCESSING_LOCATIONS } from "../storage/artifactStorageTypes.js";

export const CUSTOMER_WORKER_CAPABILITIES = Object.freeze([
  "retrieve_customer_artifacts",
  "validate_checksums",
  "parse_supported_logs",
  "generate_normalized_summaries",
  "submit_approved_metadata_only",
  "refuse_raw_evidence_export",
]);

export function resolveProcessingLocation(policy = {}) {
  const location = policy.processing_location || PROCESSING_LOCATIONS.MOBBI_CLOUD;
  if (!Object.values(PROCESSING_LOCATIONS).includes(location)) {
    return { ok: false, code: "processing_location_invalid", location: null };
  }
  return { ok: true, location };
}

export function mayTransferRawEvidence({ deploymentMode, processingLocation, allowCloudPreview } = {}) {
  if (processingLocation === PROCESSING_LOCATIONS.NO_PROCESSING) return false;
  if (processingLocation === PROCESSING_LOCATIONS.CUSTOMER_WORKER) return false;
  if (deploymentMode === "fully_private") return false;
  if (deploymentMode === "customer_hosted_data_plane") return false;
  return allowCloudPreview === true && processingLocation === PROCESSING_LOCATIONS.MOBBI_CLOUD;
}

export function buildCustomerWorkerJob({
  tenantId,
  artifactId,
  artifactType,
  objectKey,
  checksum,
  approvedMetadataKeys = ["scenario_type", "sample_count", "field_status"],
} = {}) {
  if (!tenantId || !artifactId) {
    return { ok: false, code: "worker_job_identity_required" };
  }
  return {
    ok: true,
    job: {
      tenant_id: tenantId,
      artifact_id: artifactId,
      artifact_type: artifactType || null,
      object_key: objectKey || null,
      checksum: checksum || null,
      processing_location: PROCESSING_LOCATIONS.CUSTOMER_WORKER,
      transfer_raw_evidence: false,
      approved_metadata_keys: [...approvedMetadataKeys],
      capabilities: CUSTOMER_WORKER_CAPABILITIES,
    },
  };
}

export default {
  CUSTOMER_WORKER_CAPABILITIES,
  resolveProcessingLocation,
  mayTransferRawEvidence,
  buildCustomerWorkerJob,
};
