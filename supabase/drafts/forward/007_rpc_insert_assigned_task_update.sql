-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: OWNER: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION
-- NOTE: Forces user_id=auth.uid(); mirrors user_email from profiles; rejects https?:// as durable photo_url.
-- NOTE: Preserves legacy photo_url column for dual-read. No invented columns.
-- PAIR: 007_rpc_insert_assigned_task_update
-- ROLE: FORWARD

CREATE OR REPLACE FUNCTION public.insert_assigned_task_update(
  p_task_id uuid,
  p_comment text DEFAULT NULL,
  p_photo_url text DEFAULT NULL,
  p_latitude double precision DEFAULT NULL,
  p_longitude double precision DEFAULT NULL
)
RETURNS public.task_updates
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.task_updates;
  v_active boolean;
  v_role text;
  v_email text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT p.is_active IS TRUE, p.role, p.email INTO v_active, v_role, v_email
  FROM public.profiles AS p WHERE p.id = v_uid;
  IF v_active IS NOT TRUE OR v_role IS DISTINCT FROM 'fe' THEN RAISE EXCEPTION 'forbidden_inactive_or_not_fe'; END IF;
  IF NOT public.is_assigned_to_task(p_task_id) THEN RAISE EXCEPTION 'not_assigned'; END IF;
  IF p_photo_url IS NOT NULL AND p_photo_url ~* '^https?://' THEN
    RAISE EXCEPTION 'signed_or_public_url_not_durable';
  END IF;
  INSERT INTO public.task_updates (
    task_id, user_id, user_email, comment, photo_url, latitude, longitude
  ) VALUES (
    p_task_id, v_uid, v_email, p_comment, p_photo_url, p_latitude, p_longitude
  ) RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;
-- OWNER: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION
