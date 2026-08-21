-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: Replace broad policies on grids in one transaction; never leave USING (true) beside scoped policy.
-- PAIR: 016_rls_grids
-- ROLE: FORWARD

BEGIN;
DROP POLICY IF EXISTS "Admins can manage grids" ON public.grids;
DROP POLICY IF EXISTS "Authenticated users can view grids" ON public.grids;
CREATE POLICY "grids_admin_all" ON public.grids AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_admin_or_super_admin()) WITH CHECK (public.is_admin_or_super_admin());
CREATE POLICY "grids_fe_select_via_assignment" ON public.grids AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks AS t
      WHERE t.assigned_to = auth.uid()
        AND (
          t.grid_id = grids.id
          OR EXISTS (SELECT 1 FROM public.task_grids AS tg WHERE tg.task_id = t.id AND tg.grid_id = grids.id)
        )
    )
  );
COMMIT;
