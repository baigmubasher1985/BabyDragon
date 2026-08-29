-- PAIR: 212_cr1b_rpc_ingest_evaluate_qc
-- ROLE: VERIFICATION (SELECT-only)

SELECT p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'ingest_field_test_canonical_result',
    'evaluate_field_test_run_acceptance',
    'upsert_acceptance_profile',
    'override_field_test_acceptance_verdict',
    'cr1b_resolve_acceptance_profile'
  )
ORDER BY 1;

SELECT p.proname, p.prosecdef
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'ingest_field_test_canonical_result',
    'evaluate_field_test_run_acceptance',
    'upsert_acceptance_profile',
    'override_field_test_acceptance_verdict'
  )
ORDER BY 1;
