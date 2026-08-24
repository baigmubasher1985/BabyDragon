-- PAIR: 209_disposable_operational_profile_task_rls_remediation
-- ROLE: VERIFICATION (SELECT-only)
-- NOTE: Production execution is not authorized. Disposable only.

SELECT c.relname, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('profiles', 'tasks')
ORDER BY 1;

SELECT c.relname AS table_name, pol.polname, pol.polcmd::text AS cmd,
       pg_get_expr(pol.polqual, pol.polrelid) AS using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) AS check_expr
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND pol.polname IN (
    'profiles_209_select_own',
    'profiles_209_select_admin',
    'tasks_209_select_assigned',
    'tasks_209_select_admin',
    'tasks_209_insert_admin',
    'tasks_209_update_admin'
  )
ORDER BY 1, 2;

SELECT COUNT(*)::int AS profiles_209_policy_count
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'profiles'
  AND pol.polname LIKE 'profiles_209_%';

SELECT COUNT(*)::int AS tasks_209_policy_count
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'tasks'
  AND pol.polname LIKE 'tasks_209_%';

SELECT COUNT(*)::int AS leaked_207
FROM pg_policy
WHERE polname ILIKE '%207%' OR polname ILIKE '%tenant_storage_assumptions%';

SELECT has_function_privilege('anon', 'public.is_admin_or_super_admin()', 'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', 'public.is_admin_or_super_admin()', 'EXECUTE') AS authenticated_execute;
