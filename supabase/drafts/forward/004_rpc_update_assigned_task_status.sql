-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: OWNER: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION
-- NOTE: FE transitions: pending→in_progress, on_hold→in_progress, in_progress→on_hold, in_progress→completed; completed terminal.
-- NOTE: Server time authoritative. Optional p_started_at/p_completed_at are metadata within clock-skew window only.
-- NOTE: CLOCK_SKEW: reject if client ts > now()+5min (far-future) or < now()-24h; else may use client ts.
-- NOTE: Never rewrite earlier legitimate started_at. completed_at must not precede started_at.
-- PAIR: 004_rpc_update_assigned_task_status
-- ROLE: FORWARD
-- CLASSIFICATION: draftable_apply_candidate (OWNER GATE still blocks apply)

CREATE OR REPLACE FUNCTION public.update_assigned_task_status(
  p_task_id uuid,
  p_status text,
  p_started_at timestamptz DEFAULT NULL,
  p_completed_at timestamptz DEFAULT NULL
)
RETURNS public.tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.tasks;
  v_active boolean;
  v_role text;
  v_now timestamptz := now();
  v_started timestamptz;
  v_completed timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT p.is_active IS TRUE, p.role INTO v_active, v_role FROM public.profiles AS p WHERE p.id = v_uid;
  IF v_active IS NOT TRUE OR v_role IS DISTINCT FROM 'fe' THEN RAISE EXCEPTION 'forbidden_inactive_or_not_fe'; END IF;
  SELECT * INTO v_row FROM public.tasks AS t WHERE t.id = p_task_id FOR UPDATE;
  IF NOT FOUND OR v_row.assigned_to IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'not_assigned'; END IF;
  IF v_row.status = 'completed' THEN RAISE EXCEPTION 'terminal_completed'; END IF;
  IF NOT (
    (v_row.status = 'pending' AND p_status = 'in_progress')
    OR (v_row.status = 'on_hold' AND p_status = 'in_progress')
    OR (v_row.status = 'in_progress' AND p_status = 'on_hold')
    OR (v_row.status = 'in_progress' AND p_status = 'completed')
  ) THEN RAISE EXCEPTION 'invalid_status_transition'; END IF;

  -- started_at: preserve earlier legitimate value; else server now; optional client within skew
  IF v_row.started_at IS NOT NULL THEN
    v_started := v_row.started_at;
  ELSIF p_status = 'in_progress' THEN
    IF p_started_at IS NULL THEN
      v_started := v_now;
    ELSIF p_started_at > v_now + interval '5 minutes' THEN
      RAISE EXCEPTION 'client_started_at_far_future';
    ELSIF p_started_at < v_now - interval '24 hours' THEN
      RAISE EXCEPTION 'client_started_at_too_old';
    ELSE
      v_started := p_started_at;
    END IF;
  ELSE
    v_started := v_row.started_at;
  END IF;

  -- completed_at: server authoritative default; optional client within skew; must not precede started_at
  IF p_status = 'completed' THEN
    IF p_completed_at IS NULL THEN
      v_completed := v_now;
    ELSIF p_completed_at > v_now + interval '5 minutes' THEN
      RAISE EXCEPTION 'client_completed_at_far_future';
    ELSIF p_completed_at < v_now - interval '24 hours' THEN
      RAISE EXCEPTION 'client_completed_at_too_old';
    ELSE
      v_completed := p_completed_at;
    END IF;
    IF v_started IS NOT NULL AND v_completed < v_started THEN
      RAISE EXCEPTION 'completed_before_started';
    END IF;
  ELSE
    v_completed := v_row.completed_at;
  END IF;

  UPDATE public.tasks AS t SET
    status = p_status,
    started_at = CASE
      WHEN p_status = 'in_progress' THEN v_started
      ELSE t.started_at
    END,
    completed_at = CASE
      WHEN p_status = 'completed' THEN v_completed
      ELSE t.completed_at
    END
  WHERE t.id = p_task_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;
-- OWNER: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION
