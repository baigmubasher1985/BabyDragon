-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 1
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: OWNER: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION
-- NOTE: Forces submitted_by=auth.uid(); active FE; assigned task; idempotent on client_run_id.
-- NOTE: Rejects client-supplied submitted_by / forged ownership.
-- PAIR: 105_rpc_submit_field_test_run
-- ROLE: FORWARD
-- CLASSIFICATION: (a) draftable / apply-candidate

CREATE OR REPLACE FUNCTION public.submit_field_test_run(
  p_client_run_id uuid,
  p_task_id uuid,
  p_project_id uuid,
  p_grid_id uuid DEFAULT NULL,
  p_scenario_type text DEFAULT NULL,
  p_scenario_version text DEFAULT NULL,
  p_run_status text DEFAULT 'submitted',
  p_started_at_device timestamptz DEFAULT NULL,
  p_ended_at_device timestamptz DEFAULT NULL,
  p_device_model text DEFAULT NULL,
  p_app_version text DEFAULT NULL,
  p_build_number text DEFAULT NULL,
  p_report_name text DEFAULT NULL,
  p_rf_summary jsonb DEFAULT '{}'::jsonb,
  p_data_summary jsonb DEFAULT '{}'::jsonb,
  p_gps_summary jsonb DEFAULT '{}'::jsonb,
  p_events_summary jsonb DEFAULT '{}'::jsonb
)
RETURNS public.field_test_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_active boolean;
  v_role text;
  v_existing public.field_test_runs;
  v_row public.field_test_runs;
  v_task_project uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT p.is_active IS TRUE, p.role
  INTO v_active, v_role
  FROM public.profiles AS p
  WHERE p.id = v_uid;

  IF v_active IS NOT TRUE OR v_role IS DISTINCT FROM 'fe' THEN
    RAISE EXCEPTION 'forbidden_inactive_or_not_fe';
  END IF;

  IF NOT public.is_assigned_to_task(p_task_id) THEN
    RAISE EXCEPTION 'not_assigned';
  END IF;

  IF p_client_run_id IS NULL THEN
    RAISE EXCEPTION 'client_run_id_required';
  END IF;

  IF p_scenario_type IS NULL OR length(trim(p_scenario_type)) = 0 THEN
    RAISE EXCEPTION 'scenario_type_required';
  END IF;

  SELECT t.project_id INTO v_task_project
  FROM public.tasks AS t
  WHERE t.id = p_task_id;

  IF v_task_project IS NULL OR v_task_project IS DISTINCT FROM p_project_id THEN
    RAISE EXCEPTION 'project_task_mismatch';
  END IF;

  -- Idempotent retry: same client_run_id returns existing row owned by this FE.
  SELECT * INTO v_existing
  FROM public.field_test_runs AS r
  WHERE r.client_run_id = p_client_run_id;

  IF FOUND THEN
    IF v_existing.submitted_by IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'client_run_id_owned_by_other';
    END IF;
    IF v_existing.task_id IS DISTINCT FROM p_task_id THEN
      RAISE EXCEPTION 'client_run_id_task_mismatch';
    END IF;
    -- FE immutable after submit except authorized correction path (future); return existing.
    RETURN v_existing;
  END IF;

  INSERT INTO public.field_test_runs (
    client_run_id,
    task_id,
    project_id,
    grid_id,
    submitted_by,
    scenario_type,
    scenario_version,
    run_status,
    started_at_device,
    ended_at_device,
    started_at_server,
    device_model,
    app_version,
    build_number,
    report_name,
    rf_summary,
    data_summary,
    gps_summary,
    events_summary,
    processing_status
  ) VALUES (
    p_client_run_id,
    p_task_id,
    p_project_id,
    p_grid_id,
    v_uid,
    trim(p_scenario_type),
    p_scenario_version,
    COALESCE(NULLIF(trim(p_run_status), ''), 'submitted'),
    p_started_at_device,
    p_ended_at_device,
    now(),
    p_device_model,
    p_app_version,
    p_build_number,
    p_report_name,
    COALESCE(p_rf_summary, '{}'::jsonb),
    COALESCE(p_data_summary, '{}'::jsonb),
    COALESCE(p_gps_summary, '{}'::jsonb),
    COALESCE(p_events_summary, '{}'::jsonb),
    'pending'
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;
-- OWNER: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION
