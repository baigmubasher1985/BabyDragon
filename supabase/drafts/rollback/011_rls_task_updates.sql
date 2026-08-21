-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: Reverse of 011; restore captured 02a policy names/roles (see fixtures/captured_rls_policies_02a.json).
-- NOTE: Restoration expressions match read-only capture; "exact" only after disposable verification.
-- PAIR: 011_rls_task_updates
-- ROLE: ROLLBACK
-- CLASSIFICATION: draftable_apply_candidate

BEGIN;
DROP POLICY IF EXISTS "Admin can view all task updates" ON public.task_updates;
DROP POLICY IF EXISTS "FE can insert own task updates" ON public.task_updates;
DROP POLICY IF EXISTS "FE can view own task updates" ON public.task_updates;
DROP POLICY IF EXISTS "task_updates_admin_select" ON public.task_updates;
DROP POLICY IF EXISTS "task_updates_fe_select_assigned_task" ON public.task_updates;
CREATE POLICY "Admin can view all task updates" ON public.task_updates AS PERMISSIVE FOR SELECT TO authenticated USING (is_admin_or_super_admin());
CREATE POLICY "FE can insert own task updates" ON public.task_updates AS PERMISSIVE FOR INSERT TO public WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "FE can view own task updates" ON public.task_updates AS PERMISSIVE FOR SELECT TO public USING ((user_id = auth.uid()));
COMMIT;
