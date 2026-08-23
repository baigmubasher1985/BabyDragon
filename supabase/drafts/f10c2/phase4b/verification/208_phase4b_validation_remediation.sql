-- PAIR: 208_phase4b_validation_remediation
-- ROLE: VERIFICATION (SELECT-only)

SELECT p.proname, p.prosecdef, pg_get_userbyid(p.proowner) AS owner,
       COALESCE(array_to_string(p.proconfig, ','), '') AS settings
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'is_admin_or_super_admin';

SELECT has_function_privilege('anon', 'public.is_admin_or_super_admin()', 'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', 'public.is_admin_or_super_admin()', 'EXECUTE') AS authenticated_execute;

SELECT c.relname, pol.polname, pg_get_expr(pol.polqual, pol.polrelid) AS using_expr
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND pol.polname IN (
    'field_test_runs_admin_select',
    'field_test_qc_reviews_admin_select',
    'field_test_artifacts_admin_select',
    'field_test_metrics_admin_select'
  )
ORDER BY 1, 2;

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname = 'artifact_transfer_jobs_idempotency_key_global';

SELECT p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'request_artifact_upload_plan'
  AND pg_get_functiondef(p.oid) LIKE '%supplied idempotency key is validated before any existing-job return%';

SELECT COUNT(*)::int AS leaked_207
FROM pg_policy
WHERE polname ILIKE '%207%' OR polname ILIKE '%tenant_storage_assumptions%';
