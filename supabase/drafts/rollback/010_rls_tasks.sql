-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: BLOCKED_PENDING_RPC_CLIENT_CUTOVER — forward is documentation-only / no-op.
-- NOTE: Blocked/no-op forward → no-op rollback (no production policy rewrite).
-- PAIR: 010_rls_tasks
-- ROLE: ROLLBACK
-- CLASSIFICATION: blocked_documentation_only

SELECT 'rls_tasks_rollback_noop_forward_was_blocked' AS status;

-- If a disposable ever applied the quarantined end-state template, restore from
-- supabase/tests/fixtures/captured_rls_policies_02a.json (tasks) — NOT claimed
-- exact here without disposable verification. Template kept commented:
-- DROP POLICY IF EXISTS "tasks_admin_all" ON public.tasks;
-- DROP POLICY IF EXISTS "tasks_fe_select_assigned" ON public.tasks;
-- CREATE POLICY "Admin full access" ...
-- CREATE POLICY "FE can update their assigned tasks" ...
-- CREATE POLICY "FE can view their tasks" ...
