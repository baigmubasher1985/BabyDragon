-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 1
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: OWNER: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION
-- NOTE: Registers artifact row; builds/validates object_key ownership segments.
-- NOTE: object_key verified_user_id segment = auth.uid() (v_uid), never client-supplied.
-- NOTE: Idempotent on (run_id, artifact_type, checksum) and (bucket, object_key).
-- PAIR: 106_rpc_register_field_test_artifact
-- ROLE: FORWARD
-- CLASSIFICATION: (a) draftable / apply-candidate

CREATE OR REPLACE FUNCTION public.register_field_test_artifact(
  p_run_id uuid,
  p_artifact_id uuid,
  p_artifact_type text,
  p_mime_type text,
  p_size_bytes bigint,
  p_checksum text,
  p_safe_extension text,
  p_original_file_name text DEFAULT NULL
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
  v_run public.field_test_runs;
  v_ext text;
  v_key text;
  v_existing public.field_test_artifacts;
  v_row public.field_test_artifacts;
  v_allowed_mime text[] := ARRAY[
    'application/json',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
    'application/octet-stream',
    'image/jpeg',
    'image/png'
  ];
  v_max_bytes bigint := 104857600; -- 100 MiB Phase 1 contract ceiling
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT p.is_active IS TRUE, p.role INTO v_active, v_role
  FROM public.profiles AS p WHERE p.id = v_uid;
  IF v_active IS NOT TRUE OR v_role IS DISTINCT FROM 'fe' THEN
    RAISE EXCEPTION 'forbidden_inactive_or_not_fe';
  END IF;

  SELECT * INTO v_run FROM public.field_test_runs AS r WHERE r.id = p_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'run_not_found'; END IF;
  IF v_run.submitted_by IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'not_run_owner'; END IF;
  IF NOT public.is_assigned_to_task(v_run.task_id) THEN RAISE EXCEPTION 'not_assigned'; END IF;

  IF p_artifact_id IS NULL THEN RAISE EXCEPTION 'artifact_id_required'; END IF;
  IF p_checksum IS NULL OR length(trim(p_checksum)) = 0 THEN RAISE EXCEPTION 'checksum_required'; END IF;
  IF p_size_bytes IS NULL OR p_size_bytes < 0 OR p_size_bytes > v_max_bytes THEN
    RAISE EXCEPTION 'size_out_of_range';
  END IF;
  IF p_mime_type IS NULL OR NOT (p_mime_type = ANY (v_allowed_mime)) THEN
    RAISE EXCEPTION 'mime_not_allowed';
  END IF;

  v_ext := lower(regexp_replace(COALESCE(p_safe_extension, ''), '^\.', ''));
  IF v_ext NOT IN ('json', 'csv', 'xlsx', 'zip', 'jpg', 'jpeg', 'png') THEN
    RAISE EXCEPTION 'unsafe_extension';
  END IF;
  IF v_ext = 'jpeg' THEN v_ext := 'jpg'; END IF;

  v_key := v_run.project_id::text || '/' || v_run.task_id::text || '/' || v_uid::text
    || '/' || v_run.id::text || '/' || p_artifact_id::text || '.' || v_ext;

  SELECT * INTO v_existing
  FROM public.field_test_artifacts AS a
  WHERE a.run_id = p_run_id
    AND a.artifact_type = p_artifact_type
    AND a.checksum = p_checksum;

  IF FOUND THEN
    RETURN v_existing;
  END IF;

  SELECT * INTO v_existing
  FROM public.field_test_artifacts AS a
  WHERE a.bucket = 'result-artifacts' AND a.object_key = v_key;

  IF FOUND THEN
    IF v_existing.checksum IS DISTINCT FROM p_checksum THEN
      RAISE EXCEPTION 'object_key_checksum_conflict';
    END IF;
    RETURN v_existing;
  END IF;

  INSERT INTO public.field_test_artifacts (
    id,
    run_id,
    artifact_type,
    bucket,
    object_key,
    original_file_name,
    mime_type,
    size_bytes,
    checksum,
    upload_status
  ) VALUES (
    p_artifact_id,
    p_run_id,
    p_artifact_type,
    'result-artifacts',
    v_key,
    p_original_file_name,
    p_mime_type,
    p_size_bytes,
    trim(p_checksum),
    'pending'
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;
-- OWNER: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION
