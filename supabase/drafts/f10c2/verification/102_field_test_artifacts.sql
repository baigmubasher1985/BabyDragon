-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 1
-- NO DATABASE TARGET AUTHORIZED
-- PAIR: 102_field_test_artifacts
-- ROLE: VERIFICATION

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'field_test_artifacts'
  AND column_name IN ('bucket', 'object_key', 'checksum', 'upload_status')
ORDER BY column_name;

SELECT conname
FROM pg_constraint
WHERE conrelid = 'public.field_test_artifacts'::regclass
  AND conname IN (
    'field_test_artifacts_object_key_unique',
    'field_test_artifacts_checksum_identity',
    'field_test_artifacts_no_http_object_key',
    'field_test_artifacts_bucket_not_legacy'
  );
