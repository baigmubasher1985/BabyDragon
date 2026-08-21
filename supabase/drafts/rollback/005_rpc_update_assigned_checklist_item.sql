-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: OWNER: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION
-- NOTE: Params: p_item_id, p_is_done, optional p_event_at. Server derives completed_by/timestamps/task scope.
-- PAIR: 005_rpc_update_assigned_checklist_item
-- ROLE: ROLLBACK

DROP FUNCTION IF EXISTS public.update_assigned_checklist_item(uuid, boolean, timestamptz);
