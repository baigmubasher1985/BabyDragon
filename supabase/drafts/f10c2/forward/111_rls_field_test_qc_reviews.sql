-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 1
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: Admin/SA SELECT QC reviews. FE may SELECT reviews for own assigned runs (read-only).
-- NOTE: No direct table INSERT/UPDATE — RPC submit_field_test_qc_review only.
-- PAIR: 111_rls_field_test_qc_reviews
-- ROLE: FORWARD
-- CLASSIFICATION: (a) draftable / apply-candidate

BEGIN;

ALTER TABLE public.field_test_qc_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "field_test_qc_reviews_admin_select" ON public.field_test_qc_reviews;
DROP POLICY IF EXISTS "field_test_qc_reviews_fe_select_own_runs" ON public.field_test_qc_reviews;

CREATE POLICY "field_test_qc_reviews_admin_select"
  ON public.field_test_qc_reviews
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin_or_super_admin());

CREATE POLICY "field_test_qc_reviews_fe_select_own_runs"
  ON public.field_test_qc_reviews
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.field_test_runs AS r
      JOIN public.profiles AS p ON p.id = auth.uid()
      WHERE r.id = field_test_qc_reviews.field_test_run_id
        AND p.role = 'fe'
        AND p.is_active IS TRUE
        AND r.submitted_by = auth.uid()
        AND public.is_assigned_to_task(r.task_id)
    )
  );

COMMIT;
