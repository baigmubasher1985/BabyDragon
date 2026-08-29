-- PAIR: 213_cr1b_rls_grants
-- ROLE: ROLLBACK
-- NOTE: Drops CR1-B policies only. Does not disable RLS.

BEGIN;

DROP POLICY IF EXISTS "field_test_iterations_fe_select" ON public.field_test_iterations;
DROP POLICY IF EXISTS "field_test_iterations_admin_select" ON public.field_test_iterations;
DROP POLICY IF EXISTS "field_test_call_events_fe_select" ON public.field_test_call_events;
DROP POLICY IF EXISTS "field_test_call_events_admin_select" ON public.field_test_call_events;
DROP POLICY IF EXISTS "acceptance_profiles_auth_select" ON public.acceptance_profiles;
DROP POLICY IF EXISTS "acceptance_rules_auth_select" ON public.acceptance_rules;
DROP POLICY IF EXISTS "acceptance_snapshots_fe_select" ON public.field_test_run_acceptance_snapshots;
DROP POLICY IF EXISTS "acceptance_snapshots_admin_select" ON public.field_test_run_acceptance_snapshots;
DROP POLICY IF EXISTS "iteration_evaluations_fe_select" ON public.field_test_iteration_evaluations;
DROP POLICY IF EXISTS "iteration_evaluations_admin_select" ON public.field_test_iteration_evaluations;
DROP POLICY IF EXISTS "call_summaries_fe_select" ON public.field_test_call_summaries;
DROP POLICY IF EXISTS "call_summaries_admin_select" ON public.field_test_call_summaries;
DROP POLICY IF EXISTS "qc_verdict_overrides_fe_select" ON public.qc_verdict_overrides;
DROP POLICY IF EXISTS "qc_verdict_overrides_admin_select" ON public.qc_verdict_overrides;

COMMIT;
