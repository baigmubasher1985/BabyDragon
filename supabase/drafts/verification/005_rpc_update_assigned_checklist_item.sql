-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: OWNER: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION
-- NOTE: Params: p_item_id, p_is_done, optional p_event_at. Server derives completed_by/timestamps/task scope.
-- PAIR: 005_rpc_update_assigned_checklist_item
-- ROLE: VERIFICATION (SELECT-ONLY)

SELECT p.proname, pg_get_function_identity_arguments(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'update_assigned_checklist_item';
