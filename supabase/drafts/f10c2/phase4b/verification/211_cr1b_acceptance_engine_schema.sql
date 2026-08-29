-- PAIR: 211_cr1b_acceptance_engine_schema
-- ROLE: VERIFICATION (SELECT-only)

SELECT c.relname, c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'acceptance_profiles',
    'acceptance_rules',
    'field_test_run_acceptance_snapshots',
    'field_test_iteration_evaluations',
    'field_test_call_summaries',
    'qc_verdict_overrides'
  )
ORDER BY 1;

SELECT conname
FROM pg_constraint
WHERE conrelid = 'public.field_test_run_acceptance_snapshots'::regclass
  AND conname = 'field_test_run_acceptance_snapshots_run_unique';
