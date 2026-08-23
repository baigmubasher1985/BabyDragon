-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 4A
-- NO DATABASE TARGET AUTHORIZED
-- PAIR: 204_field_test_artifacts_tenant_columns
-- ROLE: VERIFICATION

SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'field_test_artifacts'
  AND column_name IN (
    'tenant_id',
    'storage_connection_id',
    'provider_object_id',
    'sha256',
    'processing_status',
    'retention_until',
    'encryption_metadata',
    'uploaded_at'
  );

SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'field_test_runs'
  AND column_name = 'tenant_id';

SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'public.field_test_artifacts'::regclass
  AND conname IN (
    'field_test_artifacts_bucket_not_legacy',
    'field_test_artifacts_run_same_tenant',
    'field_test_artifacts_connection_same_tenant',
    'field_test_artifacts_connection_requires_tenant',
    'field_test_artifacts_id_tenant_unique'
  );
