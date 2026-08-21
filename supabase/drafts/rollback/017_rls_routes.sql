-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: Replace broad policies on routes in one transaction; never leave USING (true) beside scoped policy.
-- PAIR: 017_rls_routes
-- ROLE: ROLLBACK

DROP POLICY IF EXISTS "Admins can manage routes" ON public.routes;
DROP POLICY IF EXISTS "Authenticated users can create routes" ON public.routes;
DROP POLICY IF EXISTS "Authenticated users can delete routes" ON public.routes;
DROP POLICY IF EXISTS "Authenticated users can update routes" ON public.routes;
DROP POLICY IF EXISTS "Authenticated users can view routes" ON public.routes;
DROP POLICY IF EXISTS "routes_admin_all" ON public.routes;
DROP POLICY IF EXISTS "routes_fe_select_via_accessible_grid" ON public.routes;
CREATE POLICY "Admins can manage routes" ON public.routes AS PERMISSIVE FOR ALL TO public USING (is_admin_or_super_admin());
CREATE POLICY "Authenticated users can create routes" ON public.routes AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can delete routes" ON public.routes AS PERMISSIVE FOR DELETE TO authenticated USING (true);
CREATE POLICY "Authenticated users can update routes" ON public.routes AS PERMISSIVE FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can view routes" ON public.routes AS PERMISSIVE FOR SELECT TO authenticated USING (true);
