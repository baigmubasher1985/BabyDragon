-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 4A
-- NO DATABASE TARGET AUTHORIZED
-- PAIR: 204_field_test_artifacts_tenant_columns
-- ROLE: ROLLBACK
-- NOTE: Restores the Phase 1 102 bucket-equality check.

BEGIN;

ALTER TABLE public.field_test_artifacts
  DROP CONSTRAINT IF EXISTS field_test_artifacts_bucket_not_legacy,
  DROP CONSTRAINT IF EXISTS field_test_artifacts_connection_requires_tenant,
  DROP CONSTRAINT IF EXISTS field_test_artifacts_connection_same_tenant,
  DROP CONSTRAINT IF EXISTS field_test_artifacts_run_same_tenant,
  DROP CONSTRAINT IF EXISTS field_test_artifacts_id_tenant_unique;

DROP INDEX IF EXISTS public.field_test_artifacts_storage_connection_id_idx;
DROP INDEX IF EXISTS public.field_test_artifacts_tenant_id_idx;
DROP INDEX IF EXISTS public.field_test_runs_tenant_id_idx;

ALTER TABLE public.field_test_runs
  DROP CONSTRAINT IF EXISTS field_test_runs_id_tenant_unique;

ALTER TABLE public.field_test_artifacts
  ADD CONSTRAINT field_test_artifacts_bucket_not_legacy CHECK (
    bucket = 'result-artifacts'
    AND bucket IS DISTINCT FROM 'task-photos'
    AND bucket IS DISTINCT FROM 'operational-evidence'
  );

ALTER TABLE public.field_test_artifacts
  DROP COLUMN IF EXISTS uploaded_at,
  DROP COLUMN IF EXISTS encryption_metadata,
  DROP COLUMN IF EXISTS retention_until,
  DROP COLUMN IF EXISTS processing_status,
  DROP COLUMN IF EXISTS sha256,
  DROP COLUMN IF EXISTS provider_object_id,
  DROP COLUMN IF EXISTS storage_connection_id,
  DROP COLUMN IF EXISTS tenant_id;

ALTER TABLE public.field_test_runs
  DROP COLUMN IF EXISTS tenant_id;

COMMIT;
