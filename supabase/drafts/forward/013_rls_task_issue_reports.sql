-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: BLOCKED_PENDING_RPC_CLIENT_CUTOVER — FE direct INSERT removal not authorized until clients call RPC.
-- NOTE: End-state: Admin ALL + FE SELECT assigned; inserts via insert_assigned_task_issue only.
-- NOTE: Do NOT trust WITH CHECK for client reported_by/status/ownership — RPC forces reported_by + status=open.
-- PAIR: 013_rls_task_issue_reports
-- ROLE: FORWARD
-- CLASSIFICATION: blocked_documentation_only

SELECT 'rls_issues_fe_insert_removal_blocked_pending_rpc_client_cutover' AS status;

-- =============================================================================
-- QUARANTINED END-STATE TEMPLATE (NOT EXECUTABLE — comments only)
-- =============================================================================
-- BEGIN;
-- DROP POLICY IF EXISTS "Authenticated users can delete issue reports" ON public.task_issue_reports;
-- DROP POLICY IF EXISTS "Authenticated users can insert issue reports" ON public.task_issue_reports;
-- DROP POLICY IF EXISTS "Authenticated users can update issue reports" ON public.task_issue_reports;
-- DROP POLICY IF EXISTS "Authenticated users can view issue reports" ON public.task_issue_reports;
-- CREATE POLICY "task_issues_admin_all" ON public.task_issue_reports AS PERMISSIVE FOR ALL TO authenticated
--   USING (public.is_admin_or_super_admin()) WITH CHECK (public.is_admin_or_super_admin());
-- CREATE POLICY "task_issues_fe_select_assigned" ON public.task_issue_reports AS PERMISSIVE FOR SELECT TO authenticated
--   USING (public.is_assigned_to_task(task_id));
-- -- NO FE INSERT/UPDATE/DELETE — RPC-only mutation boundary.
-- COMMIT;
