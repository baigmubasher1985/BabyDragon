-- DRAFT / UNAPPLIED / SELECT-ONLY VERIFICATION
-- F10C2 PHASE 4
-- PAIR: 113_rpc_finalize_field_test_run
-- ROLE: VERIFICATION

SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS args,
  p.prosecdef AS security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'finalize_field_test_run';
