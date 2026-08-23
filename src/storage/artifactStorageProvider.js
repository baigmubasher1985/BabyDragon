/**
 * F10C2 Phase 4A — ArtifactStorageProvider contract.
 * Implementations live under providers/. Callers must not use SDK-specific types.
 */

import { ARTIFACT_STORAGE_METHODS } from "./artifactStorageTypes.js";
import { normalizeProviderError } from "./normalizeProviderError.js";

export function assertArtifactStorageProvider(provider, label = "provider") {
  if (!provider || typeof provider !== "object") {
    throw new Error(`${label}_required`);
  }
  for (const method of ARTIFACT_STORAGE_METHODS) {
    if (typeof provider[method] !== "function") {
      throw new Error(`${label}_missing_${method}`);
    }
  }
  return provider;
}

export function createUnauthorizedStubProvider(providerType) {
  async function notImplemented() {
    const error = new Error(`provider_not_implemented:${providerType}`);
    error.code = "provider_not_implemented";
    throw error;
  }
  return {
    kind: providerType,
    label: `F10C2 stub ${providerType}`,
    implemented: false,
    createUploadPlan: notImplemented,
    createResumableUploadSession: notImplemented,
    confirmUpload: notImplemented,
    statObject: notImplemented,
    objectExists: notImplemented,
    createAuthorizedReadAccess: notImplemented,
    verifyIntegrity: notImplemented,
    deleteArtifact: notImplemented,
    normalizeProviderError,
    async healthCheck() {
      return {
        ok: false,
        provider_type: providerType,
        implemented: false,
        status: "not_implemented",
      };
    },
  };
}

export default {
  assertArtifactStorageProvider,
  createUnauthorizedStubProvider,
};
