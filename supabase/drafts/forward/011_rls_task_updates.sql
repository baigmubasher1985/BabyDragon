-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: FE SELECT assigned + Admin SELECT. FE INSERT removed — RPC insert_assigned_task_update only.
-- NOTE: Do NOT trust WITH CHECK on client-supplied user_id/email; mutation boundary is SECURITY DEFINER RPC.
-- PAIR: 011_rls_task_updates
-- ROLE: FORWARD
-- CLASSIFICATION: draftable_apply_candidate

BEGIN;
DROP POLICY IF EXISTS "Admin can view all task updates" ON public.task_updates;
DROP POLICY IF EXISTS "FE can insert own task updates" ON public.task_updates;
DROP POLICY IF EXISTS "FE can view own task updates" ON public.task_updates;
CREATE POLICY "task_updates_admin_select" ON public.task_updates AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin_or_super_admin());
CREATE POLICY "task_updates_fe_select_assigned_task" ON public.task_updates AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_assigned_to_task(task_id));
-- Intentionally NO FE INSERT policy: clients must call insert_assigned_task_update().
COMMIT;
