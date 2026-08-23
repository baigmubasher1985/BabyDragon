-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 4A
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: Connector metadata only. Credentials live behind secret_reference.
-- NOTE: UNIQUE (tenant_id, id) is the composite FK target for same-tenant policies/artifacts.
-- NOTE: ON DELETE RESTRICT — tenant rows with connections cannot be accidentally deleted.
-- NOTE: storage_connections_secret_not_plaintext is DEFENSE-IN-DEPTH only.
-- NOTE: Plaintext-secret prevention is enforced by server-side secret-management workflow,
-- NOTE: restricted write path, no browser/APK access, code review, and secret scanning.
-- PAIR: 202_storage_connections
-- ROLE: FORWARD
-- CLASSIFICATION: (a) draftable / apply-candidate

BEGIN;

CREATE TABLE IF NOT EXISTS public.storage_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  provider_type text NOT NULL
    CHECK (provider_type IN (
      'supabase',
      's3_compatible',
      'minio',
      'azure_blob',
      'https_upload',
      'sftp',
      'onedrive',
      'sharepoint',
      'google_drive',
      'local_filesystem'
    )),
  display_name text NOT NULL,
  endpoint_reference text NULL,
  bucket_or_container text NULL,
  base_path text NULL,
  region text NULL,
  authentication_mode text NOT NULL DEFAULT 'server_secret_reference',
  secret_reference text NULL,
  data_residency_region text NULL,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT storage_connections_tenant_id_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT storage_connections_secret_not_plaintext CHECK (
    secret_reference IS NULL
    OR (
      secret_reference !~* 'eyJ'
      AND secret_reference !~* 'service_role'
      AND secret_reference !~* 'secret_access_key'
      AND secret_reference !~* 'BEGIN '
    )
  ),
  CONSTRAINT storage_connections_bucket_not_legacy CHECK (
    bucket_or_container IS NULL
    OR (
      bucket_or_container IS DISTINCT FROM 'task-photos'
      AND bucket_or_container IS DISTINCT FROM 'operational-evidence'
    )
  )
);

CREATE INDEX IF NOT EXISTS storage_connections_tenant_id_idx
  ON public.storage_connections (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS storage_connections_one_default_per_tenant
  ON public.storage_connections (tenant_id)
  WHERE is_default = true AND is_active = true;

COMMENT ON COLUMN public.storage_connections.secret_reference IS
  'Opaque vault/K8s Secret name only. Never a credential value. Regex CHECK is not a security control.';
COMMENT ON CONSTRAINT storage_connections_secret_not_plaintext ON public.storage_connections IS
  'Defense-in-depth only. Real prevention: secret-management workflow, restricted writes, no client access, review, scanning.';
COMMENT ON CONSTRAINT storage_connections_tenant_id_id_unique ON public.storage_connections IS
  'Composite unique key so child tables can FK (tenant_id, storage_connection_id) to this pair.';

COMMIT;
