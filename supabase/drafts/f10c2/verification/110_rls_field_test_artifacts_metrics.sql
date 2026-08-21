-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 1
-- NO DATABASE TARGET AUTHORIZED
-- PAIR: 110_rls_field_test_artifacts_metrics
-- ROLE: VERIFICATION

SELECT c.relname, pol.polname
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('field_test_artifacts', 'field_test_metrics')
ORDER BY c.relname, pol.polname;
