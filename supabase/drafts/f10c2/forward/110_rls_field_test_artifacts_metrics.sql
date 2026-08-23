-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 1
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: Artifacts + metrics inherit run ownership. No direct FE writes.
-- PAIR: 110_rls_field_test_artifacts_metrics
-- ROLE: FORWARD
-- CLASSIFICATION: (a) draftable / apply-candidate

BEGIN;

ALTER TABLE public.field_test_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_test_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "field_test_artifacts_fe_select" ON public.field_test_artifacts;
DROP POLICY IF EXISTS "field_test_artifacts_admin_select" ON public.field_test_artifacts;
DROP POLICY IF EXISTS "field_test_metrics_fe_select" ON public.field_test_metrics;
DROP POLICY IF EXISTS "field_test_metrics_admin_select" ON public.field_test_metrics;

CREATE POLICY "field_test_artifacts_fe_select"
  ON public.field_test_artifacts
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.field_test_runs AS r
      JOIN public.profiles AS p ON p.id = auth.uid()
      WHERE r.id = field_test_artifacts.run_id
        AND p.role = 'fe'
        AND p.is_active IS TRUE
        AND r.submitted_by = auth.uid()
        AND public.is_assigned_to_task(r.task_id)
    )
  );

CREATE POLICY "field_test_artifacts_admin_select"
  ON public.field_test_artifacts
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin_or_super_admin());

CREATE POLICY "field_test_metrics_fe_select"
  ON public.field_test_metrics
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.field_test_runs AS r
      JOIN public.profiles AS p ON p.id = auth.uid()
      WHERE r.id = field_test_metrics.run_id
        AND p.role = 'fe'
        AND p.is_active IS TRUE
        AND r.submitted_by = auth.uid()
        AND public.is_assigned_to_task(r.task_id)
    )
  );

CREATE POLICY "field_test_metrics_admin_select"
  ON public.field_test_metrics
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin_or_super_admin());

COMMIT;
