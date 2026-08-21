-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: Replace broad policies on route_grids in one transaction; never leave USING (true) beside scoped policy.
-- PAIR: 018_rls_route_grids
-- ROLE: ROLLBACK

DROP POLICY IF EXISTS "Authenticated users can create route grids" ON public.route_grids;
DROP POLICY IF EXISTS "Authenticated users can delete route grids" ON public.route_grids;
DROP POLICY IF EXISTS "Authenticated users can view route grids" ON public.route_grids;
DROP POLICY IF EXISTS "route_grids_admin_all" ON public.route_grids;
DROP POLICY IF EXISTS "route_grids_fe_select" ON public.route_grids;
CREATE POLICY "Authenticated users can create route grids" ON public.route_grids AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can delete route grids" ON public.route_grids AS PERMISSIVE FOR DELETE TO authenticated USING (true);
CREATE POLICY "Authenticated users can view route grids" ON public.route_grids AS PERMISSIVE FOR SELECT TO authenticated USING (true);
