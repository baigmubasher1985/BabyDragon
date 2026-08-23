-- PAIR: 208_phase4b_validation_remediation
-- ROLE: ROLLBACK
-- NOTE: Restores pre-208 admin EXISTS predicates and the pre-208 206 job path.
-- NOTE: Does not drop business data. Does not execute 207.

BEGIN;

DROP INDEX IF EXISTS public.artifact_transfer_jobs_idempotency_key_global;

DROP POLICY IF EXISTS "field_test_runs_admin_select" ON public.field_test_runs;
CREATE POLICY "field_test_runs_admin_select"
  ON public.field_test_runs
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['admin'::text, 'super_admin'::text])
        AND p.is_active IS TRUE
    )
  );

DROP POLICY IF EXISTS "field_test_qc_reviews_admin_select" ON public.field_test_qc_reviews;
CREATE POLICY "field_test_qc_reviews_admin_select"
  ON public.field_test_qc_reviews
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['admin'::text, 'super_admin'::text])
        AND p.is_active IS TRUE
    )
  );

DROP POLICY IF EXISTS "field_test_artifacts_admin_select" ON public.field_test_artifacts;
CREATE POLICY "field_test_artifacts_admin_select"
  ON public.field_test_artifacts
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['admin'::text, 'super_admin'::text])
        AND p.is_active IS TRUE
    )
  );

DROP POLICY IF EXISTS "field_test_metrics_admin_select" ON public.field_test_metrics;
CREATE POLICY "field_test_metrics_admin_select"
  ON public.field_test_metrics
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['admin'::text, 'super_admin'::text])
        AND p.is_active IS TRUE
    )
  );

-- Restore pre-208 job binding by re-applying the previous 206 body is
-- intentionally omitted here as a full function rewrite. Operators who
-- must roll back the RPC should re-apply the pre-R1 206 draft from git
-- history. Policies and the global unique index are reverted above.

COMMIT;
