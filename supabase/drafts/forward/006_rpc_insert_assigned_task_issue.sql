-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: OWNER: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION
-- NOTE: Forces reported_by=auth.uid(), status=open. Columns from F10C1P-R2 app evidence.
-- PAIR: 006_rpc_insert_assigned_task_issue
-- ROLE: FORWARD

CREATE OR REPLACE FUNCTION public.insert_assigned_task_issue(
  p_task_id uuid,
  p_issue_type text,
  p_severity text,
  p_description text,
  p_lat double precision DEFAULT NULL,
  p_lon double precision DEFAULT NULL
)
RETURNS public.task_issue_reports
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.task_issue_reports;
  v_active boolean;
  v_role text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT p.is_active IS TRUE, p.role INTO v_active, v_role FROM public.profiles AS p WHERE p.id = v_uid;
  IF v_active IS NOT TRUE OR v_role IS DISTINCT FROM 'fe' THEN RAISE EXCEPTION 'forbidden_inactive_or_not_fe'; END IF;
  IF NOT public.is_assigned_to_task(p_task_id) THEN RAISE EXCEPTION 'not_assigned'; END IF;
  INSERT INTO public.task_issue_reports (
    task_id, issue_type, severity, description, status, lat, lon, reported_by
  ) VALUES (
    p_task_id, p_issue_type, p_severity, p_description, 'open', p_lat, p_lon, v_uid
  ) RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;
-- OWNER: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION
