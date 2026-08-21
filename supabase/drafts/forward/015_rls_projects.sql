-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: Replace broad policies on projects in one transaction; never leave USING (true) beside scoped policy.
-- PAIR: 015_rls_projects
-- ROLE: FORWARD

BEGIN;
DROP POLICY IF EXISTS "Admins can manage projects" ON public.projects;
DROP POLICY IF EXISTS "Authenticated users can view projects" ON public.projects;
CREATE POLICY "projects_admin_all" ON public.projects AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_admin_or_super_admin()) WITH CHECK (public.is_admin_or_super_admin());
CREATE POLICY "projects_fe_select_via_assignment" ON public.projects AS PERMISSIVE FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tasks AS t WHERE t.project_id = projects.id AND t.assigned_to = auth.uid()));
COMMIT;
