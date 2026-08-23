-- DRAFT / UNAPPLIED / SELECT-ONLY VERIFICATION
-- F10C2 PHASE 4
-- PAIR: 115_field_test_execute_grants
-- ROLE: VERIFICATION

SELECT
  p.proname,
  pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'submit_field_test_run',
    'register_field_test_artifact',
    'complete_field_test_artifact_upload',
    'submit_field_test_qc_review',
    'finalize_field_test_run'
  );
