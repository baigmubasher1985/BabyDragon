-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 4A
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: Per-artifact-type routing. Missing policy falls back to tenant default connection.
-- NOTE: Composite FK (tenant_id, storage_connection_id) → storage_connections(tenant_id, id)
-- NOTE: MATCH SIMPLE: NULL storage_connection_id is valid fallback-to-default.
-- NOTE: Non-null storage_connection_id cannot reference another tenant's connection.
-- PAIR: 203_tenant_storage_policies
-- ROLE: FORWARD
-- CLASSIFICATION: (a) draftable / apply-candidate

BEGIN;

CREATE TABLE IF NOT EXISTS public.tenant_storage_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  artifact_type text NOT NULL,
  storage_connection_id uuid NULL,
  upload_mode text NOT NULL DEFAULT 'direct_scoped'
    CHECK (upload_mode IN ('direct_scoped', 'server_proxy', 'resumable')),
  processing_location text NOT NULL DEFAULT 'mobbi_cloud'
    CHECK (processing_location IN ('mobbi_cloud', 'customer_worker', 'no_processing')),
  allow_cloud_metadata boolean NOT NULL DEFAULT true,
  allow_cloud_preview boolean NOT NULL DEFAULT false,
  allow_temporary_cache boolean NOT NULL DEFAULT false,
  retention_days integer NULL CHECK (retention_days IS NULL OR retention_days > 0),
  encryption_required boolean NOT NULL DEFAULT false,
  customer_managed_key_reference text NULL,
  max_file_size bigint NULL CHECK (max_file_size IS NULL OR max_file_size > 0),
  allowed_mime_types text[] NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_storage_policies_type_unique UNIQUE (tenant_id, artifact_type),
  CONSTRAINT tenant_storage_policies_connection_same_tenant
    FOREIGN KEY (tenant_id, storage_connection_id)
    REFERENCES public.storage_connections (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS tenant_storage_policies_tenant_id_idx
  ON public.tenant_storage_policies (tenant_id);

COMMENT ON TABLE public.tenant_storage_policies IS
  'F10C2 Phase 4A-R1: tenant artifact-type policy. Composite FK blocks cross-tenant connection references.';
COMMENT ON CONSTRAINT tenant_storage_policies_connection_same_tenant ON public.tenant_storage_policies IS
  'MATCH SIMPLE: NULL storage_connection_id = fallback to tenant default. Non-null must be same tenant.';

COMMIT;
