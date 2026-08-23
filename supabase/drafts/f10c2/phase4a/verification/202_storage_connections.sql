-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 4A
-- NO DATABASE TARGET AUTHORIZED
-- PAIR: 202_storage_connections
-- ROLE: VERIFICATION

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'storage_connections'
  AND column_name IN (
    'tenant_id',
    'provider_type',
    'secret_reference',
    'bucket_or_container',
    'is_default',
    'is_active'
  );

SELECT conname
FROM pg_constraint
WHERE conrelid = 'public.storage_connections'::regclass
  AND conname IN (
    'storage_connections_secret_not_plaintext',
    'storage_connections_tenant_id_id_unique',
    'storage_connections_bucket_not_legacy'
  );

SELECT pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'public.storage_connections'::regclass
  AND conname = 'storage_connections_tenant_id_id_unique';
