-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 4A
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: Nullable tenant columns only. Do not add NOT NULL to populated tables.
-- NOTE: Relaxes 102 bucket equality so non-result-artifacts containers can be used
-- NOTE: while still banning task-photos and operational-evidence.
-- NOTE: Composite FKs enforce same-tenant run/artifact/connection when tenant_id is set.
-- NOTE: MATCH SIMPLE leaves both-NULL legacy rows valid until controlled backfill.
-- NOTE: CHECK blocks storage_connection_id without tenant_id (closes MATCH SIMPLE hole).
-- PAIR: 204_field_test_artifacts_tenant_columns
-- ROLE: FORWARD
-- CLASSIFICATION: (a) draftable / apply-candidate

BEGIN;

ALTER TABLE public.field_test_runs
  ADD COLUMN IF NOT EXISTS tenant_id uuid NULL REFERENCES public.tenants(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS field_test_runs_tenant_id_idx
  ON public.field_test_runs (tenant_id);

ALTER TABLE public.field_test_runs
  DROP CONSTRAINT IF EXISTS field_test_runs_id_tenant_unique;
ALTER TABLE public.field_test_runs
  ADD CONSTRAINT field_test_runs_id_tenant_unique UNIQUE (id, tenant_id);

ALTER TABLE public.field_test_artifacts
  ADD COLUMN IF NOT EXISTS tenant_id uuid NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS storage_connection_id uuid NULL,
  ADD COLUMN IF NOT EXISTS provider_object_id text NULL,
  ADD COLUMN IF NOT EXISTS sha256 text NULL,
  ADD COLUMN IF NOT EXISTS processing_status text NULL
    CHECK (processing_status IS NULL OR processing_status IN (
      'pending', 'processing', 'ready', 'failed', 'archival'
    )),
  ADD COLUMN IF NOT EXISTS retention_until timestamptz NULL,
  ADD COLUMN IF NOT EXISTS encryption_metadata jsonb NULL,
  ADD COLUMN IF NOT EXISTS uploaded_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS field_test_artifacts_tenant_id_idx
  ON public.field_test_artifacts (tenant_id);
CREATE INDEX IF NOT EXISTS field_test_artifacts_storage_connection_id_idx
  ON public.field_test_artifacts (storage_connection_id);

ALTER TABLE public.field_test_artifacts
  DROP CONSTRAINT IF EXISTS field_test_artifacts_id_tenant_unique;
ALTER TABLE public.field_test_artifacts
  ADD CONSTRAINT field_test_artifacts_id_tenant_unique UNIQUE (id, tenant_id);

ALTER TABLE public.field_test_artifacts
  DROP CONSTRAINT IF EXISTS field_test_artifacts_run_same_tenant;
ALTER TABLE public.field_test_artifacts
  ADD CONSTRAINT field_test_artifacts_run_same_tenant
    FOREIGN KEY (run_id, tenant_id)
    REFERENCES public.field_test_runs (id, tenant_id);

ALTER TABLE public.field_test_artifacts
  DROP CONSTRAINT IF EXISTS field_test_artifacts_connection_same_tenant;
ALTER TABLE public.field_test_artifacts
  ADD CONSTRAINT field_test_artifacts_connection_same_tenant
    FOREIGN KEY (tenant_id, storage_connection_id)
    REFERENCES public.storage_connections (tenant_id, id);

ALTER TABLE public.field_test_artifacts
  DROP CONSTRAINT IF EXISTS field_test_artifacts_connection_requires_tenant;
ALTER TABLE public.field_test_artifacts
  ADD CONSTRAINT field_test_artifacts_connection_requires_tenant CHECK (
    storage_connection_id IS NULL OR tenant_id IS NOT NULL
  );

ALTER TABLE public.field_test_artifacts
  DROP CONSTRAINT IF EXISTS field_test_artifacts_bucket_not_legacy;

ALTER TABLE public.field_test_artifacts
  ADD CONSTRAINT field_test_artifacts_bucket_not_legacy CHECK (
    bucket IS DISTINCT FROM 'task-photos'
    AND bucket IS DISTINCT FROM 'operational-evidence'
  );

COMMENT ON COLUMN public.field_test_artifacts.tenant_id IS
  'Nullable until verified tenant backfill. Do not enforce NOT NULL here.';
COMMENT ON COLUMN public.field_test_artifacts.provider_object_id IS
  'Provider-native object identity. Never a signed or public URL.';
COMMENT ON CONSTRAINT field_test_artifacts_run_same_tenant ON public.field_test_artifacts IS
  'When tenant_id is set, it must equal field_test_runs.tenant_id. Both NULL is legacy-compatible.';
COMMENT ON CONSTRAINT field_test_artifacts_connection_same_tenant ON public.field_test_artifacts IS
  'Non-null storage_connection_id must belong to the same tenant. MATCH SIMPLE allows NULL connection.';

COMMIT;
