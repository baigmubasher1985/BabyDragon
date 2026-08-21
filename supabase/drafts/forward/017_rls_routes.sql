-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: Replace broad policies on routes in one transaction; never leave USING (true) beside scoped policy.
-- PAIR: 017_rls_routes
-- ROLE: FORWARD

BEGIN;
DROP POLICY IF EXISTS "Admins can manage routes" ON public.routes;
DROP POLICY IF EXISTS "Authenticated users can create routes" ON public.routes;
DROP POLICY IF EXISTS "Authenticated users can delete routes" ON public.routes;
DROP POLICY IF EXISTS "Authenticated users can update routes" ON public.routes;
DROP POLICY IF EXISTS "Authenticated users can view routes" ON public.routes;
CREATE POLICY "routes_admin_all" ON public.routes AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_admin_or_super_admin()) WITH CHECK (public.is_admin_or_super_admin());
CREATE POLICY "routes_fe_select_via_accessible_grid" ON public.routes AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks AS t
      WHERE t.assigned_to = auth.uid()
        AND (
          t.grid_id = routes.grid_id
          OR EXISTS (SELECT 1 FROM public.task_grids AS tg WHERE tg.task_id = t.id AND tg.grid_id = routes.grid_id)
          OR EXISTS (
            SELECT 1 FROM public.route_grids AS rg
            JOIN public.task_grids AS tg ON tg.grid_id = rg.grid_id
            WHERE rg.route_id = routes.id AND tg.task_id = t.id
          )
        )
    )
  );
COMMIT;
