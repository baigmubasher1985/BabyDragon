-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: Replace broad policies on projects in one transaction; never leave USING (true) beside scoped policy.
-- PAIR: 015_rls_projects
-- ROLE: ROLLBACK

DROP POLICY IF EXISTS "Admins can manage projects" ON public.projects;
DROP POLICY IF EXISTS "Authenticated users can view projects" ON public.projects;
DROP POLICY IF EXISTS "projects_admin_all" ON public.projects;
DROP POLICY IF EXISTS "projects_fe_select_via_assignment" ON public.projects;
CREATE POLICY "Admins can manage projects" ON public.projects AS PERMISSIVE FOR ALL TO authenticated USING (is_admin_or_super_admin());
CREATE POLICY "Authenticated users can view projects" ON public.projects AS PERMISSIVE FOR SELECT TO authenticated USING (true);
