/**
 * F10C2 Phase 4A — public storage-boundary exports.
 */

export {
  PROVIDER_TYPES,
  DEPLOYMENT_MODES,
  PROCESSING_LOCATIONS,
  UPLOAD_MODES,
  ARTIFACT_STORAGE_METHODS,
  DEFAULT_SIGNED_TTL_SECONDS,
  DEFAULT_MAX_ARTIFACT_BYTES,
  FORBIDDEN_CLIENT_SECRET_KEYS,
} from "./artifactStorageTypes.js";

export {
  assertArtifactStorageProvider,
  createUnauthorizedStubProvider,
} from "./artifactStorageProvider.js";

export { normalizeProviderError } from "./normalizeProviderError.js";
export { createMockArtifactStorageProvider } from "./providers/mockArtifactStorageProvider.js";
export { createSupabaseArtifactStorageProvider } from "./providers/supabaseArtifactStorageProvider.js";
export { createArtifactStorageProvider, STUB_TYPES } from "./createArtifactStorageProvider.js";
export {
  selectStoragePolicy,
  assertTenantScope,
  filterArtifactsForTenant,
} from "./storagePolicyRouter.js";
export {
  assertPolicyConnectionSameTenant,
  assertArtifactRunSameTenant,
  assertArtifactConnectionSameTenant,
  assertTransferJobArtifactSameTenant,
  assertPersistedArtifactType,
  deriveTrustedDestination,
} from "./tenantStorageIntegrity.js";
export { requestArtifactUploadPlanContract } from "./requestArtifactUploadPlanContract.js";
export {
  validateDeploymentConfig,
  loadPublicDeploymentConfig,
} from "./deploymentConfig.js";
