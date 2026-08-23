/**
 * F10C2 Phase 4A — provider-neutral storage types.
 * Canonical workflow must not import S3 / Graph / Drive / Supabase SDK types.
 */

export const PROVIDER_TYPES = Object.freeze({
  MOCK: "mock",
  SUPABASE: "supabase",
  S3_COMPATIBLE: "s3_compatible",
  MINIO: "minio",
  AZURE_BLOB: "azure_blob",
  HTTPS_UPLOAD: "https_upload",
  SFTP: "sftp",
  ONEDRIVE: "onedrive",
  SHAREPOINT: "sharepoint",
  GOOGLE_DRIVE: "google_drive",
  LOCAL_FILESYSTEM: "local_filesystem",
});

export const DEPLOYMENT_MODES = Object.freeze({
  MOBBITECH_SAAS: "mobbitech_saas",
  HYBRID_CUSTOMER_STORAGE: "hybrid_customer_storage",
  CUSTOMER_HOSTED_DATA_PLANE: "customer_hosted_data_plane",
  FULLY_PRIVATE: "fully_private",
});

export const PROCESSING_LOCATIONS = Object.freeze({
  MOBBI_CLOUD: "mobbi_cloud",
  CUSTOMER_WORKER: "customer_worker",
  NO_PROCESSING: "no_processing",
});

export const UPLOAD_MODES = Object.freeze({
  DIRECT_SCOPED: "direct_scoped",
  SERVER_PROXY: "server_proxy",
  RESUMABLE: "resumable",
});

export const ARTIFACT_STORAGE_METHODS = Object.freeze([
  "createUploadPlan",
  "createResumableUploadSession",
  "confirmUpload",
  "statObject",
  "objectExists",
  "createAuthorizedReadAccess",
  "verifyIntegrity",
  "deleteArtifact",
  "normalizeProviderError",
  "healthCheck",
]);

export const DEFAULT_SIGNED_TTL_SECONDS = 120;
export const DEFAULT_MAX_ARTIFACT_BYTES = 104857600;

export const FORBIDDEN_CLIENT_SECRET_KEYS = Object.freeze([
  "service_role",
  "SERVICE_ROLE",
  "aws_secret_access_key",
  "AWS_SECRET_ACCESS_KEY",
  "azure_storage_key",
  "AZURE_STORAGE_KEY",
  "graph_client_secret",
  "GOOGLE_CLIENT_SECRET",
  "sftp_password",
  "SFTP_PASSWORD",
  "DATABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
]);

export default {
  PROVIDER_TYPES,
  DEPLOYMENT_MODES,
  PROCESSING_LOCATIONS,
  UPLOAD_MODES,
  ARTIFACT_STORAGE_METHODS,
  DEFAULT_SIGNED_TTL_SECONDS,
  DEFAULT_MAX_ARTIFACT_BYTES,
  FORBIDDEN_CLIENT_SECRET_KEYS,
};
