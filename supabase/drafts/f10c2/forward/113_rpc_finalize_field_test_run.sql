-- DRAFT / UNAPPLIED / DISPOSABLE-ONLY WHEN PHASE 4 GATES PASS
-- F10C2 PHASE 4
-- NO PRODUCTION TARGET AUTHORIZED
-- NOTE: OWNER: disposable postgres (documented Phase 4 disposable owner decision)
-- NOTE: Marks a run ready when all registered artifacts are complete; partial otherwise.
-- NOTE: Idempotent. FE owner only. Does not rewrite submitted_by.
-- PAIR: 113_rpc_finalize_field_test_run
-- ROLE: FORWARD
-- CLASSIFICATION: (a) draftable / apply-candidate

CREATE OR REPLACE FUNCTION public.finalize_field_test_run(
  p_run_id uuid
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
  v_run public.field_test_runs;
  v_total integer;
  v_complete integer;
  v_next text;
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

  SELECT COUNT(*)::integer, COUNT(*) FILTER (WHERE a.upload_status = 'complete')::integer
  INTO v_total, v_complete
  FROM public.field_test_artifacts AS a
  WHERE a.run_id = p_run_id;

  IF v_total > 0 AND v_complete < v_total THEN
    v_next := 'partial';
  ELSE
    v_next := 'ready';
  END IF;

  UPDATE public.field_test_runs AS r
  SET run_status = v_next,
      processing_status = CASE WHEN v_next = 'ready' THEN 'ready' ELSE 'pending' END,
      ended_at_server = COALESCE(r.ended_at_server, now()),
      updated_at = now()
  WHERE r.id = p_run_id
  RETURNING * INTO v_run;

  RETURN v_run;
END;
$function$;
-- OWNER: disposable postgres
