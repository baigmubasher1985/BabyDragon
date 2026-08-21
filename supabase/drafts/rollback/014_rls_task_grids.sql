-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: Replace broad policies on task_grids in one transaction; never leave USING (true) beside scoped policy.
-- PAIR: 014_rls_task_grids
-- ROLE: ROLLBACK

DROP POLICY IF EXISTS "Allow authenticated delete task_grids" ON public.task_grids;
DROP POLICY IF EXISTS "Allow authenticated insert task_grids" ON public.task_grids;
DROP POLICY IF EXISTS "Allow authenticated select task_grids" ON public.task_grids;
DROP POLICY IF EXISTS "Authenticated users can view task grids" ON public.task_grids;
DROP POLICY IF EXISTS "task_grids_admin_all" ON public.task_grids;
DROP POLICY IF EXISTS "task_grids_fe_select_assigned" ON public.task_grids;
CREATE POLICY "Allow authenticated delete task_grids" ON public.task_grids AS PERMISSIVE FOR DELETE TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert task_grids" ON public.task_grids AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated select task_grids" ON public.task_grids AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can view task grids" ON public.task_grids AS PERMISSIVE FOR SELECT TO authenticated USING (true);
