-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: BLOCKED_PENDING_RPC_CLIENT_CUTOVER — FE direct UPDATE removal not authorized until clients call RPC.
-- NOTE: End-state: Admin ALL + FE SELECT assigned; mutations via update_assigned_checklist_item only.
-- NOTE: Do NOT trust WITH CHECK for completed_by/completed_at/updated_at/task_id/label/item_order.
-- PAIR: 012_rls_task_checklist_items
-- ROLE: FORWARD
-- CLASSIFICATION: blocked_documentation_only

SELECT 'rls_checklist_fe_update_removal_blocked_pending_rpc_client_cutover' AS status;

-- =============================================================================
-- QUARANTINED END-STATE TEMPLATE (NOT EXECUTABLE — comments only)
-- =============================================================================
-- BEGIN;
-- DROP POLICY IF EXISTS "Authenticated users can delete checklist items" ON public.task_checklist_items;
-- DROP POLICY IF EXISTS "Authenticated users can insert checklist items" ON public.task_checklist_items;
-- DROP POLICY IF EXISTS "Authenticated users can update checklist items" ON public.task_checklist_items;
-- DROP POLICY IF EXISTS "Authenticated users can view checklist items" ON public.task_checklist_items;
-- CREATE POLICY "task_checklist_admin_all" ON public.task_checklist_items AS PERMISSIVE FOR ALL TO authenticated
--   USING (public.is_admin_or_super_admin()) WITH CHECK (public.is_admin_or_super_admin());
-- CREATE POLICY "task_checklist_fe_select_assigned" ON public.task_checklist_items AS PERMISSIVE FOR SELECT TO authenticated
--   USING (public.is_assigned_to_task(task_id));
-- -- NO FE UPDATE/INSERT/DELETE — RPC-only mutation boundary.
-- COMMIT;
