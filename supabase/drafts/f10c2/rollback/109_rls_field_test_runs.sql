-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 1
-- NO DATABASE TARGET AUTHORIZED
-- PAIR: 109_rls_field_test_runs
-- ROLE: ROLLBACK

BEGIN;
DROP POLICY IF EXISTS "field_test_runs_fe_select_assigned" ON public.field_test_runs;
DROP POLICY IF EXISTS "field_test_runs_admin_select" ON public.field_test_runs;
COMMIT;
