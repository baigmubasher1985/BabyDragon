-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: BLOCKED_PENDING_RPC_CLIENT_CUTOVER — documentation-only; NOT in sequential apply path.
-- NOTE: After authorized cutover: FE SELECT assigned; Admin ALL; FE mutations via update_assigned_task_status only.
-- PAIR: 010_rls_tasks
-- ROLE: FORWARD
-- CLASSIFICATION: blocked_documentation_only

-- Harmless status marker only (no DDL/DML).
SELECT 'rls_tasks_fe_update_removal_blocked_pending_rpc_client_cutover' AS status;

-- =============================================================================
-- QUARANTINED END-STATE TEMPLATE (NOT EXECUTABLE — comments only)
-- Apply only after disposable proof that clients call update_assigned_task_status
-- and no longer depend on direct FE UPDATE. Not part of sequential apply path.
-- =============================================================================
-- BEGIN;
-- DROP POLICY IF EXISTS "Admin full access" ON public.tasks;
-- DROP POLICY IF EXISTS "FE can update their assigned tasks" ON public.tasks;
-- DROP POLICY IF EXISTS "FE can view their tasks" ON public.tasks;
-- CREATE POLICY "tasks_admin_all" ON public.tasks AS PERMISSIVE FOR ALL TO authenticated
--   USING (public.is_admin_or_super_admin()) WITH CHECK (public.is_admin_or_super_admin());
-- CREATE POLICY "tasks_fe_select_assigned" ON public.tasks AS PERMISSIVE FOR SELECT TO authenticated
--   USING (assigned_to = auth.uid());
-- -- FE direct UPDATE omitted after cutover (RPC path only).
-- COMMIT;
