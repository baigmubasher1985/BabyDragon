-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: Replace broad policies on route_grids in one transaction; never leave USING (true) beside scoped policy.
-- PAIR: 018_rls_route_grids
-- ROLE: FORWARD

BEGIN;
DROP POLICY IF EXISTS "Authenticated users can create route grids" ON public.route_grids;
DROP POLICY IF EXISTS "Authenticated users can delete route grids" ON public.route_grids;
DROP POLICY IF EXISTS "Authenticated users can view route grids" ON public.route_grids;
CREATE POLICY "route_grids_admin_all" ON public.route_grids AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_admin_or_super_admin()) WITH CHECK (public.is_admin_or_super_admin());
CREATE POLICY "route_grids_fe_select" ON public.route_grids AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks AS t
      JOIN public.task_grids AS tg ON tg.task_id = t.id
      WHERE t.assigned_to = auth.uid() AND tg.grid_id = route_grids.grid_id
    )
  );
COMMIT;
