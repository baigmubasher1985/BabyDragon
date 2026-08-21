-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: OWNER: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION
-- NOTE: FE transitions: pending→in_progress, on_hold→in_progress, in_progress→on_hold, in_progress→completed; completed terminal.
-- NOTE: Reject pending→completed/on_hold, completed→*, foreign tasks, inactive FE.
-- PAIR: 004_rpc_update_assigned_task_status
-- ROLE: VERIFICATION (SELECT-ONLY)

SELECT p.proname, pg_get_function_identity_arguments(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'update_assigned_task_status';
