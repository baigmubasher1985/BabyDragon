-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 4A
-- NO DATABASE TARGET AUTHORIZED
-- PAIR: 203_tenant_storage_policies
-- ROLE: VERIFICATION

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'tenant_storage_policies'
  AND column_name IN (
    'tenant_id',
    'artifact_type',
    'storage_connection_id',
    'upload_mode',
    'processing_location',
    'allow_cloud_metadata',
    'allow_cloud_preview'
  );

SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'public.tenant_storage_policies'::regclass
  AND conname = 'tenant_storage_policies_connection_same_tenant';
