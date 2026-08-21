-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 1
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: OWNER: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION
-- NOTE: Marks artifact upload complete only when checksum matches registered row.
-- PAIR: 107_rpc_complete_field_test_artifact_upload
-- ROLE: FORWARD
-- CLASSIFICATION: (a) draftable / apply-candidate

CREATE OR REPLACE FUNCTION public.complete_field_test_artifact_upload(
  p_artifact_id uuid,
  p_checksum text
)
RETURNS public.field_test_artifacts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_active boolean;
  v_role text;
  v_art public.field_test_artifacts;
  v_run public.field_test_runs;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT p.is_active IS TRUE, p.role INTO v_active, v_role
  FROM public.profiles AS p WHERE p.id = v_uid;
  IF v_active IS NOT TRUE OR v_role IS DISTINCT FROM 'fe' THEN
    RAISE EXCEPTION 'forbidden_inactive_or_not_fe';
  END IF;

  SELECT * INTO v_art FROM public.field_test_artifacts AS a WHERE a.id = p_artifact_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'artifact_not_found'; END IF;

  SELECT * INTO v_run FROM public.field_test_runs AS r WHERE r.id = v_art.run_id;
  IF v_run.submitted_by IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'not_run_owner'; END IF;
  IF NOT public.is_assigned_to_task(v_run.task_id) THEN RAISE EXCEPTION 'not_assigned'; END IF;

  IF p_checksum IS NULL OR v_art.checksum IS DISTINCT FROM trim(p_checksum) THEN
    RAISE EXCEPTION 'checksum_mismatch';
  END IF;

  IF v_art.upload_status = 'complete' THEN
    RETURN v_art;
  END IF;

  UPDATE public.field_test_artifacts AS a
  SET upload_status = 'complete', updated_at = now()
  WHERE a.id = p_artifact_id
  RETURNING * INTO v_art;

  RETURN v_art;
END;
$function$;
-- OWNER: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION
