/**
 * F10C2 Phase 4A — select a storage provider implementation.
 * Unimplemented connectors return fail-closed stubs.
 */

import { PROVIDER_TYPES } from "./artifactStorageTypes.js";
import { assertArtifactStorageProvider, createUnauthorizedStubProvider } from "./artifactStorageProvider.js";
import { createMockArtifactStorageProvider } from "./providers/mockArtifactStorageProvider.js";
import { createSupabaseArtifactStorageProvider } from "./providers/supabaseArtifactStorageProvider.js";

const STUB_TYPES = [
  PROVIDER_TYPES.S3_COMPATIBLE,
  PROVIDER_TYPES.MINIO,
  PROVIDER_TYPES.AZURE_BLOB,
  PROVIDER_TYPES.HTTPS_UPLOAD,
  PROVIDER_TYPES.SFTP,
  PROVIDER_TYPES.ONEDRIVE,
  PROVIDER_TYPES.SHAREPOINT,
  PROVIDER_TYPES.GOOGLE_DRIVE,
  PROVIDER_TYPES.LOCAL_FILESYSTEM,
];

export function createArtifactStorageProvider(options = {}) {
  const kind = options.kind || PROVIDER_TYPES.MOCK;
  if (kind === PROVIDER_TYPES.MOCK) {
    return assertArtifactStorageProvider(createMockArtifactStorageProvider(options), "mock");
  }
  if (kind === PROVIDER_TYPES.SUPABASE) {
    return assertArtifactStorageProvider(createSupabaseArtifactStorageProvider(options), "supabase");
  }
  if (STUB_TYPES.includes(kind)) {
    return assertArtifactStorageProvider(createUnauthorizedStubProvider(kind), kind);
  }
  throw new Error(`unknown_storage_provider:${kind}`);
}

export { STUB_TYPES };

export default { createArtifactStorageProvider };
