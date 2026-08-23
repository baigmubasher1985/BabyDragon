-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 1
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: FE SELECT assigned runs only. Admin/SA read all. No direct FE INSERT (RPC-only).
-- NOTE: FE immutable after submit — no FE UPDATE/DELETE policies.
-- PAIR: 109_rls_field_test_runs
-- ROLE: FORWARD
-- CLASSIFICATION: (a) draftable / apply-candidate

BEGIN;

ALTER TABLE public.field_test_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "field_test_runs_fe_select_assigned" ON public.field_test_runs;
DROP POLICY IF EXISTS "field_test_runs_admin_select" ON public.field_test_runs;

CREATE POLICY "field_test_runs_fe_select_assigned"
  ON public.field_test_runs
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE p.id = auth.uid()
        AND p.role = 'fe'
        AND p.is_active IS TRUE
    )
    AND public.is_assigned_to_task(task_id)
    AND submitted_by = auth.uid()
  );

CREATE POLICY "field_test_runs_admin_select"
  ON public.field_test_runs
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin_or_super_admin());

-- Intentionally no INSERT/UPDATE/DELETE for authenticated FE/Admin via direct table.
-- Mutations go through SECURITY DEFINER RPCs.

COMMIT;
