-- DRAFT / DISPOSABLE CR1-B
-- PAIR: 213_cr1b_rls_grants
-- ROLE: FORWARD
-- NOTE: RLS on, no public/anon grants, no FE writes. Mutations via SECURITY DEFINER RPC.

BEGIN;

ALTER TABLE public.field_test_iterations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_test_call_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acceptance_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acceptance_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_test_run_acceptance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_test_iteration_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_test_call_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qc_verdict_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "field_test_iterations_fe_select" ON public.field_test_iterations;
DROP POLICY IF EXISTS "field_test_iterations_admin_select" ON public.field_test_iterations;
CREATE POLICY "field_test_iterations_fe_select"
  ON public.field_test_iterations AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.field_test_runs r
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE r.id = field_test_iterations.run_id
        AND p.role = 'fe' AND p.is_active IS TRUE
        AND r.submitted_by = auth.uid()
        AND public.is_assigned_to_task(r.task_id)
    )
  );
CREATE POLICY "field_test_iterations_admin_select"
  ON public.field_test_iterations AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin_or_super_admin());

DROP POLICY IF EXISTS "field_test_call_events_fe_select" ON public.field_test_call_events;
DROP POLICY IF EXISTS "field_test_call_events_admin_select" ON public.field_test_call_events;
CREATE POLICY "field_test_call_events_fe_select"
  ON public.field_test_call_events AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.field_test_runs r
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE r.id = field_test_call_events.run_id
        AND p.role = 'fe' AND p.is_active IS TRUE
        AND r.submitted_by = auth.uid()
        AND public.is_assigned_to_task(r.task_id)
    )
  );
CREATE POLICY "field_test_call_events_admin_select"
  ON public.field_test_call_events AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin_or_super_admin());

DROP POLICY IF EXISTS "acceptance_profiles_auth_select" ON public.acceptance_profiles;
DROP POLICY IF EXISTS "acceptance_profiles_admin_select" ON public.acceptance_profiles;
CREATE POLICY "acceptance_profiles_auth_select"
  ON public.acceptance_profiles AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_active IS TRUE
    )
  );

DROP POLICY IF EXISTS "acceptance_rules_auth_select" ON public.acceptance_rules;
CREATE POLICY "acceptance_rules_auth_select"
  ON public.acceptance_rules AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_active IS TRUE
    )
  );

DROP POLICY IF EXISTS "acceptance_snapshots_fe_select" ON public.field_test_run_acceptance_snapshots;
DROP POLICY IF EXISTS "acceptance_snapshots_admin_select" ON public.field_test_run_acceptance_snapshots;
CREATE POLICY "acceptance_snapshots_fe_select"
  ON public.field_test_run_acceptance_snapshots AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.field_test_runs r
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE r.id = field_test_run_acceptance_snapshots.run_id
        AND p.role = 'fe' AND p.is_active IS TRUE
        AND r.submitted_by = auth.uid()
        AND public.is_assigned_to_task(r.task_id)
    )
  );
CREATE POLICY "acceptance_snapshots_admin_select"
  ON public.field_test_run_acceptance_snapshots AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin_or_super_admin());

DROP POLICY IF EXISTS "iteration_evaluations_fe_select" ON public.field_test_iteration_evaluations;
DROP POLICY IF EXISTS "iteration_evaluations_admin_select" ON public.field_test_iteration_evaluations;
CREATE POLICY "iteration_evaluations_fe_select"
  ON public.field_test_iteration_evaluations AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.field_test_run_acceptance_snapshots s
      JOIN public.field_test_runs r ON r.id = s.run_id
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE s.id = field_test_iteration_evaluations.snapshot_id
        AND p.role = 'fe' AND p.is_active IS TRUE
        AND r.submitted_by = auth.uid()
        AND public.is_assigned_to_task(r.task_id)
    )
  );
CREATE POLICY "iteration_evaluations_admin_select"
  ON public.field_test_iteration_evaluations AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin_or_super_admin());

DROP POLICY IF EXISTS "call_summaries_fe_select" ON public.field_test_call_summaries;
DROP POLICY IF EXISTS "call_summaries_admin_select" ON public.field_test_call_summaries;
CREATE POLICY "call_summaries_fe_select"
  ON public.field_test_call_summaries AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.field_test_runs r
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE r.id = field_test_call_summaries.run_id
        AND p.role = 'fe' AND p.is_active IS TRUE
        AND r.submitted_by = auth.uid()
        AND public.is_assigned_to_task(r.task_id)
    )
  );
CREATE POLICY "call_summaries_admin_select"
  ON public.field_test_call_summaries AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin_or_super_admin());

DROP POLICY IF EXISTS "qc_verdict_overrides_fe_select" ON public.qc_verdict_overrides;
DROP POLICY IF EXISTS "qc_verdict_overrides_admin_select" ON public.qc_verdict_overrides;
CREATE POLICY "qc_verdict_overrides_fe_select"
  ON public.qc_verdict_overrides AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.field_test_runs r
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE r.id = qc_verdict_overrides.run_id
        AND p.role = 'fe' AND p.is_active IS TRUE
        AND r.submitted_by = auth.uid()
        AND public.is_assigned_to_task(r.task_id)
    )
  );
CREATE POLICY "qc_verdict_overrides_admin_select"
  ON public.qc_verdict_overrides AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin_or_super_admin());

COMMIT;

REVOKE ALL ON FUNCTION public.cr1b_combine_verdicts(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cr1b_combine_verdicts(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.cr1b_combine_verdicts(text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.cr1b_compare_threshold(double precision, double precision) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cr1b_compare_threshold(double precision, double precision) FROM anon;
GRANT EXECUTE ON FUNCTION public.cr1b_compare_threshold(double precision, double precision) TO authenticated;

REVOKE ALL ON FUNCTION public.cr1b_resolve_acceptance_profile(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cr1b_resolve_acceptance_profile(uuid, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.cr1b_resolve_acceptance_profile(uuid, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.evaluate_field_test_run_acceptance(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.evaluate_field_test_run_acceptance(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.evaluate_field_test_run_acceptance(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.ingest_field_test_canonical_result(uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ingest_field_test_canonical_result(uuid, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.ingest_field_test_canonical_result(uuid, text, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.upsert_acceptance_profile(text, uuid, uuid, text, boolean, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_acceptance_profile(text, uuid, uuid, text, boolean, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.upsert_acceptance_profile(text, uuid, uuid, text, boolean, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.override_field_test_acceptance_verdict(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.override_field_test_acceptance_verdict(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.override_field_test_acceptance_verdict(uuid, text, text) TO authenticated;
