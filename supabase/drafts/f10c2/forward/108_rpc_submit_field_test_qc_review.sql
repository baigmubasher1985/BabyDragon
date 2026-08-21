-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 1
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: OWNER: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION
-- NOTE: Admin / super_admin QC write. FE cannot write QC decisions.
-- NOTE: Updates field_test_runs.latest_qc_status; preserves task-level qc_reviews.
-- PAIR: 108_rpc_submit_field_test_qc_review
-- ROLE: FORWARD
-- CLASSIFICATION: (a) draftable / apply-candidate

CREATE OR REPLACE FUNCTION public.submit_field_test_qc_review(
  p_field_test_run_id uuid,
  p_qc_decision text,
  p_qc_notes text DEFAULT NULL,
  p_missing_evidence text[] DEFAULT NULL,
  p_redrive_needed boolean DEFAULT false,
  p_redrive_reason text DEFAULT NULL,
  p_redrive_task_id uuid DEFAULT NULL
)
RETURNS public.field_test_qc_reviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_active boolean;
  v_role text;
  v_run public.field_test_runs;
  v_row public.field_test_qc_reviews;
  v_redrive boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT p.is_active IS TRUE, p.role INTO v_active, v_role
  FROM public.profiles AS p WHERE p.id = v_uid;

  IF v_active IS NOT TRUE OR v_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'forbidden_not_qc_admin';
  END IF;

  IF p_qc_decision IS NULL OR p_qc_decision NOT IN (
    'QC Passed', 'QC Failed', 'Needs Re-drive',
    'Waiting for Logs', 'Log Naming Issue', 'Missing Evidence'
  ) THEN
    RAISE EXCEPTION 'invalid_qc_decision';
  END IF;

  SELECT * INTO v_run FROM public.field_test_runs AS r WHERE r.id = p_field_test_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'run_not_found'; END IF;

  v_redrive := COALESCE(p_redrive_needed, false)
    OR (p_qc_decision = 'Needs Re-drive');

  INSERT INTO public.field_test_qc_reviews (
    field_test_run_id,
    task_id,
    reviewer_id,
    qc_decision,
    qc_notes,
    missing_evidence,
    redrive_needed,
    redrive_reason,
    redrive_task_id,
    reviewed_at
  ) VALUES (
    p_field_test_run_id,
    v_run.task_id,
    v_uid,
    p_qc_decision,
    p_qc_notes,
    p_missing_evidence,
    v_redrive,
    CASE WHEN v_redrive THEN p_redrive_reason ELSE NULL END,
    CASE WHEN v_redrive THEN p_redrive_task_id ELSE NULL END,
    now()
  )
  ON CONFLICT (field_test_run_id) DO UPDATE SET
    reviewer_id = EXCLUDED.reviewer_id,
    qc_decision = EXCLUDED.qc_decision,
    qc_notes = EXCLUDED.qc_notes,
    missing_evidence = EXCLUDED.missing_evidence,
    redrive_needed = EXCLUDED.redrive_needed,
    redrive_reason = EXCLUDED.redrive_reason,
    redrive_task_id = EXCLUDED.redrive_task_id,
    reviewed_at = now(),
    updated_at = now()
  RETURNING * INTO v_row;

  UPDATE public.field_test_runs AS r
  SET latest_qc_status = p_qc_decision,
      updated_at = now()
  WHERE r.id = p_field_test_run_id;

  RETURN v_row;
END;
$function$;
-- OWNER: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION
