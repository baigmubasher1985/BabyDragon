-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 1
-- NO DATABASE TARGET AUTHORIZED
-- PAIR: 110_rls_field_test_artifacts_metrics
-- ROLE: ROLLBACK

BEGIN;
DROP POLICY IF EXISTS "field_test_artifacts_fe_select" ON public.field_test_artifacts;
DROP POLICY IF EXISTS "field_test_artifacts_admin_select" ON public.field_test_artifacts;
DROP POLICY IF EXISTS "field_test_metrics_fe_select" ON public.field_test_metrics;
DROP POLICY IF EXISTS "field_test_metrics_admin_select" ON public.field_test_metrics;
COMMIT;
