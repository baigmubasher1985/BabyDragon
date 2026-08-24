-- PAIR: 209_disposable_operational_profile_task_rls_remediation
-- ROLE: ROLLBACK
-- NOTE: Drops only THIS migration's policy names. Does not disable RLS.
-- NOTE: Does not drop tables, data, or 208 policies. Does not execute 207.
-- NOTE: Production execution is not authorized.

BEGIN;

DROP POLICY IF EXISTS "profiles_209_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_209_select_admin" ON public.profiles;
DROP POLICY IF EXISTS "tasks_209_select_assigned" ON public.tasks;
DROP POLICY IF EXISTS "tasks_209_select_admin" ON public.tasks;
DROP POLICY IF EXISTS "tasks_209_insert_admin" ON public.tasks;
DROP POLICY IF EXISTS "tasks_209_update_admin" ON public.tasks;

COMMIT;
