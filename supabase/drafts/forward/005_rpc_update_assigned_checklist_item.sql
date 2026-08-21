-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: OWNER: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION
-- NOTE: Params: p_item_id, p_is_done, optional p_event_at. Server derives completed_by/timestamps/task scope.
-- NOTE: Server time authoritative. p_event_at optional within ±skew (future 5min / past 24h); reject far-future.
-- NOTE: Clear (p_is_done=false): completed_at/completed_by NULL; updated_at = server now() (clear ignores client event for stamp).
-- NOTE: Clients must not supply completed_by/completed_at/updated_at/task_id/label/item_order.
-- PAIR: 005_rpc_update_assigned_checklist_item
-- ROLE: FORWARD
-- CLASSIFICATION: draftable_apply_candidate (OWNER GATE still blocks apply)

CREATE OR REPLACE FUNCTION public.update_assigned_checklist_item(
  p_item_id uuid,
  p_is_done boolean,
  p_event_at timestamptz DEFAULT NULL
)
RETURNS public.task_checklist_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_item public.task_checklist_items;
  v_active boolean;
  v_role text;
  v_now timestamptz := now();
  v_ts timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT p.is_active IS TRUE, p.role INTO v_active, v_role FROM public.profiles AS p WHERE p.id = v_uid;
  IF v_active IS NOT TRUE OR v_role IS DISTINCT FROM 'fe' THEN RAISE EXCEPTION 'forbidden_inactive_or_not_fe'; END IF;
  SELECT * INTO v_item FROM public.task_checklist_items AS i WHERE i.id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'item_not_found'; END IF;
  IF NOT public.is_assigned_to_task(v_item.task_id) THEN RAISE EXCEPTION 'not_assigned'; END IF;

  IF p_is_done THEN
    IF p_event_at IS NULL THEN
      v_ts := v_now;
    ELSIF p_event_at > v_now + interval '5 minutes' THEN
      RAISE EXCEPTION 'client_event_at_far_future';
    ELSIF p_event_at < v_now - interval '24 hours' THEN
      RAISE EXCEPTION 'client_event_at_too_old';
    ELSE
      v_ts := p_event_at;
    END IF;
  ELSE
    -- Clear: drop completion identity; stamp clear with server time (authoritative)
    v_ts := v_now;
  END IF;

  UPDATE public.task_checklist_items AS i SET
    is_done = p_is_done,
    completed_at = CASE WHEN p_is_done THEN v_ts ELSE NULL END,
    completed_by = CASE WHEN p_is_done THEN v_uid ELSE NULL END,
    updated_at = v_ts
  WHERE i.id = p_item_id
  RETURNING * INTO v_item;
  RETURN v_item;
END;
$function$;
-- OWNER: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION
