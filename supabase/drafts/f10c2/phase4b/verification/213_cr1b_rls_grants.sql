-- PAIR: 213_cr1b_rls_grants
-- ROLE: VERIFICATION (SELECT-only)

SELECT c.relname, c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'field_test_iterations',
    'field_test_call_events',
    'acceptance_profiles',
    'acceptance_rules',
    'field_test_run_acceptance_snapshots',
    'field_test_iteration_evaluations',
    'field_test_call_summaries',
    'qc_verdict_overrides'
  )
ORDER BY 1;

SELECT c.relname, pol.polname, pol.polcmd::text AS cmd
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'field_test_iterations',
    'qc_verdict_overrides',
    'acceptance_profiles'
  )
ORDER BY 1, 2;

SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'ingest_field_test_canonical_result',
    'upsert_acceptance_profile',
    'override_field_test_acceptance_verdict'
  )
ORDER BY 1;
