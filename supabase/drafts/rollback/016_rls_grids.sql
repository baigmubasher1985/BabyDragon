-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: Replace broad policies on grids in one transaction; never leave USING (true) beside scoped policy.
-- PAIR: 016_rls_grids
-- ROLE: ROLLBACK

DROP POLICY IF EXISTS "Admins can manage grids" ON public.grids;
DROP POLICY IF EXISTS "Authenticated users can view grids" ON public.grids;
DROP POLICY IF EXISTS "grids_admin_all" ON public.grids;
DROP POLICY IF EXISTS "grids_fe_select_via_assignment" ON public.grids;
CREATE POLICY "Admins can manage grids" ON public.grids AS PERMISSIVE FOR ALL TO public USING (is_admin_or_super_admin());
CREATE POLICY "Authenticated users can view grids" ON public.grids AS PERMISSIVE FOR SELECT TO authenticated USING (true);
