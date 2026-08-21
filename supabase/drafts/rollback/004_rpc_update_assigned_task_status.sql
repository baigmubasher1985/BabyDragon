-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: OWNER: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION
-- NOTE: FE transitions: pending→in_progress, on_hold→in_progress, in_progress→on_hold, in_progress→completed; completed terminal.
-- NOTE: Reject pending→completed/on_hold, completed→*, foreign tasks, inactive FE.
-- PAIR: 004_rpc_update_assigned_task_status
-- ROLE: ROLLBACK

DROP FUNCTION IF EXISTS public.update_assigned_task_status(uuid, text, timestamptz, timestamptz);
