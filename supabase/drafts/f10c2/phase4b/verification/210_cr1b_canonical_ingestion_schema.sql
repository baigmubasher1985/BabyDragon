-- PAIR: 210_cr1b_canonical_ingestion_schema
-- ROLE: VERIFICATION (SELECT-only)

SELECT c.relname, c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('field_test_runs', 'field_test_iterations', 'field_test_call_events')
ORDER BY 1;

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'field_test_runs'
  AND column_name IN (
    'package_identity',
    'idempotency_key',
    'requested_iterations',
    'attempted_iterations',
    'completed_iterations',
    'failed_iterations',
    'upload_state',
    'acceptance_verdict'
  )
ORDER BY 1;

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname = 'field_test_runs_idempotency_key_unique';
