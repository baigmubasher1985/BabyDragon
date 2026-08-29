-- DRAFT / DISPOSABLE CR1-B
-- F10C2 CR1-B RPCs: ingest, evaluate, profile upsert, QC override
-- PAIR: 212_cr1b_rpc_ingest_evaluate_qc
-- ROLE: FORWARD
-- NOTE: SECURITY DEFINER, search_path empty. No service-role. No anon execute here (see 213).

CREATE OR REPLACE FUNCTION public.cr1b_combine_verdicts(p_a text, p_b text, p_mode text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
  v_mode text := CASE WHEN upper(COALESCE(p_mode, 'AND')) = 'OR' THEN 'OR' ELSE 'AND' END;
BEGIN
  IF p_a IS NULL OR p_a = 'N/A' THEN RETURN COALESCE(NULLIF(p_b, 'N/A'), 'NOT_EVALUATED'); END IF;
  IF p_b IS NULL OR p_b = 'N/A' THEN RETURN p_a; END IF;
  IF p_a = 'INCOMPLETE' OR p_b = 'INCOMPLETE' THEN RETURN 'INCOMPLETE'; END IF;
  IF v_mode = 'OR' THEN
    IF p_a = 'PASS' OR p_b = 'PASS' THEN RETURN 'PASS'; END IF;
    IF p_a = 'FAIL' AND p_b = 'FAIL' THEN RETURN 'FAIL'; END IF;
    IF p_a = 'FAIL' OR p_b = 'FAIL' THEN RETURN 'FAIL'; END IF;
    RETURN 'NOT_EVALUATED';
  END IF;
  IF p_a = 'NOT_EVALUATED' OR p_b = 'NOT_EVALUATED' THEN RETURN 'NOT_EVALUATED'; END IF;
  IF p_a = 'FAIL' OR p_b = 'FAIL' THEN RETURN 'FAIL'; END IF;
  IF p_a = 'PASS' AND p_b = 'PASS' THEN RETURN 'PASS'; END IF;
  RETURN 'NOT_EVALUATED';
END;
$function$;

CREATE OR REPLACE FUNCTION public.cr1b_compare_threshold(p_actual double precision, p_min double precision)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
BEGIN
  IF p_min IS NULL THEN RETURN 'NOT_EVALUATED'; END IF;
  IF p_actual IS NULL THEN RETURN 'INCOMPLETE'; END IF;
  IF p_actual >= p_min THEN RETURN 'PASS'; END IF;
  RETURN 'FAIL';
END;
$function$;

CREATE OR REPLACE FUNCTION public.cr1b_resolve_acceptance_profile(
  p_task_id uuid,
  p_project_id uuid,
  p_tenant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_n integer;
  v_row public.acceptance_profiles;
BEGIN
  SELECT COUNT(*)::integer INTO v_n
  FROM public.acceptance_profiles p
  WHERE p.is_active IS TRUE AND p.scope_type = 'task' AND p.scope_id = p_task_id;
  IF v_n > 1 THEN
    RAISE EXCEPTION 'ambiguous_profile_resolution' USING ERRCODE = '22023';
  END IF;
  IF v_n = 1 THEN
    SELECT * INTO v_row FROM public.acceptance_profiles p
    WHERE p.is_active IS TRUE AND p.scope_type = 'task' AND p.scope_id = p_task_id;
    RETURN jsonb_build_object('id', v_row.id, 'version', v_row.version, 'scope', 'task', 'name', v_row.name, 'units', v_row.units);
  END IF;

  SELECT COUNT(*)::integer INTO v_n
  FROM public.acceptance_profiles p
  WHERE p.is_active IS TRUE AND p.scope_type = 'project' AND p.scope_id = p_project_id;
  IF v_n > 1 THEN
    RAISE EXCEPTION 'ambiguous_profile_resolution' USING ERRCODE = '22023';
  END IF;
  IF v_n = 1 THEN
    SELECT * INTO v_row FROM public.acceptance_profiles p
    WHERE p.is_active IS TRUE AND p.scope_type = 'project' AND p.scope_id = p_project_id;
    RETURN jsonb_build_object('id', v_row.id, 'version', v_row.version, 'scope', 'project', 'name', v_row.name, 'units', v_row.units);
  END IF;

  SELECT COUNT(*)::integer INTO v_n
  FROM public.acceptance_profiles p
  WHERE p.is_active IS TRUE AND p.is_default IS TRUE AND p.scope_type = 'tenant'
    AND (p_tenant_id IS NULL OR p.tenant_id IS NULL OR p.tenant_id = p_tenant_id);
  IF v_n > 1 THEN
    RAISE EXCEPTION 'ambiguous_profile_resolution' USING ERRCODE = '22023';
  END IF;
  IF v_n = 1 THEN
    SELECT * INTO v_row FROM public.acceptance_profiles p
    WHERE p.is_active IS TRUE AND p.is_default IS TRUE AND p.scope_type = 'tenant'
      AND (p_tenant_id IS NULL OR p.tenant_id IS NULL OR p.tenant_id = p_tenant_id);
    RETURN jsonb_build_object('id', v_row.id, 'version', v_row.version, 'scope', 'tenant', 'name', v_row.name, 'units', v_row.units);
  END IF;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.evaluate_field_test_run_acceptance(p_run_id uuid)
RETURNS public.field_test_run_acceptance_snapshots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_run public.field_test_runs;
  v_existing public.field_test_run_acceptance_snapshots;
  v_profile jsonb;
  v_dl_rule public.acceptance_rules;
  v_mo_rule public.acceptance_rules;
  v_snap public.field_test_run_acceptance_snapshots;
  v_iter public.field_test_iterations;
  v_dl text;
  v_ul text;
  v_overall text := NULL;
  v_dl_run text := NULL;
  v_ul_run text := NULL;
  v_mo text := 'NOT_EVALUATED';
  v_mt text := 'NOT_EVALUATED';
  v_req int := 0;
  v_att int := 0;
  v_comp int := 0;
  v_fail int := 0;
  v_eval int := 0;
  v_dl_pass int := 0;
  v_dl_fail int := 0;
  v_ul_pass int := 0;
  v_ul_fail int := 0;
  v_over_pass int := 0;
  v_over_fail int := 0;
  v_mo_att int := 0;
  v_mo_ok int := 0;
  v_mo_fail int := 0;
  v_mo_inc int := 0;
  v_mt_att int := 0;
  v_mt_ok int := 0;
  v_mt_fail int := 0;
  v_mt_inc int := 0;
  v_dir_ok boolean;
  v_ul_ok boolean;
  v_iter_overall text;
  v_reason text;
  v_rules jsonb;
  v_eval_rows jsonb := '[]'::jsonb;
  v_item jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_run FROM public.field_test_runs r WHERE r.id = p_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'run_not_found' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO v_existing
  FROM public.field_test_run_acceptance_snapshots s
  WHERE s.run_id = p_run_id;
  IF FOUND THEN
    RETURN v_existing;
  END IF;

  DELETE FROM public.field_test_iteration_evaluations e
  USING public.field_test_iterations i
  WHERE e.iteration_id = i.id
    AND i.run_id = p_run_id
    AND e.snapshot_id IS NULL;

  v_profile := public.cr1b_resolve_acceptance_profile(v_run.task_id, v_run.project_id, v_run.tenant_id);

  IF v_profile IS NULL THEN
    INSERT INTO public.field_test_run_acceptance_snapshots (
      run_id, profile_id, profile_version, scope_type, resolved_rules, units,
      effective_configuration, overall_verdict, dl_verdict, ul_verdict, mo_verdict, mt_verdict, counts
    ) VALUES (
      p_run_id, NULL, NULL, NULL, '{}'::jsonb, '{"throughput":"Mbps"}'::jsonb,
      jsonb_build_object('reason', 'no_profile'),
      'NOT_EVALUATED', 'NOT_EVALUATED', 'NOT_EVALUATED', 'NOT_EVALUATED', 'NOT_EVALUATED',
      jsonb_build_object(
        'requested', v_run.requested_iterations,
        'attempted', v_run.attempted_iterations,
        'completed', v_run.completed_iterations,
        'execution_failed', v_run.failed_iterations,
        'evaluable', 0
      )
    )
    RETURNING * INTO v_snap;
    UPDATE public.field_test_runs SET acceptance_verdict = 'NOT_EVALUATED', updated_at = now() WHERE id = p_run_id;
    RETURN v_snap;
  END IF;

  SELECT * INTO v_dl_rule FROM public.acceptance_rules
  WHERE profile_id = (v_profile->>'id')::uuid
    AND profile_version = (v_profile->>'version')::integer
    AND rule_type = 'dl_ul';
  SELECT * INTO v_mo_rule FROM public.acceptance_rules
  WHERE profile_id = (v_profile->>'id')::uuid
    AND profile_version = (v_profile->>'version')::integer
    AND rule_type = 'mo_mt';

  v_req := COALESCE(v_run.requested_iterations, 0);
  v_att := COALESCE(v_run.attempted_iterations, 0);
  v_comp := COALESCE(v_run.completed_iterations, 0);
  v_fail := COALESCE(v_run.failed_iterations, 0);

  FOR v_iter IN
    SELECT * FROM public.field_test_iterations i WHERE i.run_id = p_run_id ORDER BY i.iteration_number
  LOOP
    v_dir_ok := v_dl_rule.id IS NOT NULL AND (v_dl_rule.enabled_directions IS NULL OR 'dl' = ANY (v_dl_rule.enabled_directions) OR cardinality(v_dl_rule.enabled_directions) = 0);
    v_ul_ok := v_dl_rule.id IS NOT NULL AND (v_dl_rule.enabled_directions IS NULL OR 'ul' = ANY (v_dl_rule.enabled_directions) OR cardinality(v_dl_rule.enabled_directions) = 0);
    IF v_dl_rule.enabled_directions IS NOT NULL AND cardinality(v_dl_rule.enabled_directions) > 0 THEN
      v_dir_ok := 'dl' = ANY (v_dl_rule.enabled_directions);
      v_ul_ok := 'ul' = ANY (v_dl_rule.enabled_directions);
    END IF;

    IF v_iter.scenario_kind ILIKE '%ookla%' OR v_iter.scenario_kind ILIKE '%fcc%' THEN
      v_dl := 'NOT_EVALUATED';
      v_ul := 'NOT_EVALUATED';
      v_iter_overall := 'NOT_EVALUATED';
      v_reason := 'unsupported_scenario';
    ELSIF v_iter.execution_failed OR v_iter.status = 'failed' THEN
      v_dl := CASE WHEN v_dir_ok THEN 'INCOMPLETE' ELSE 'N/A' END;
      v_ul := CASE WHEN v_ul_ok THEN 'INCOMPLETE' ELSE 'N/A' END;
      v_iter_overall := 'INCOMPLETE';
      v_reason := COALESCE(v_iter.failure_reason, 'execution_failure');
    ELSE
      v_dl := CASE WHEN NOT v_dir_ok THEN 'N/A' ELSE public.cr1b_compare_threshold(v_iter.dl_mbps, v_dl_rule.min_dl_mbps) END;
      v_ul := CASE WHEN NOT v_ul_ok THEN 'N/A' ELSE public.cr1b_compare_threshold(v_iter.ul_mbps, v_dl_rule.min_ul_mbps) END;
      v_iter_overall := public.cr1b_combine_verdicts(v_dl, v_ul, COALESCE(v_dl_rule.combine_mode, 'AND'));
      v_reason := CASE WHEN v_iter_overall = 'INCOMPLETE' THEN COALESCE(v_iter.incomplete_reason, 'missing_measurement') ELSE NULL END;
    END IF;

    IF v_iter_overall <> 'NOT_EVALUATED' AND v_iter_overall <> 'N/A' THEN
      v_eval := v_eval + 1;
    END IF;
    IF v_dl = 'PASS' THEN v_dl_pass := v_dl_pass + 1; END IF;
    IF v_dl = 'FAIL' THEN v_dl_fail := v_dl_fail + 1; END IF;
    IF v_ul = 'PASS' THEN v_ul_pass := v_ul_pass + 1; END IF;
    IF v_ul = 'FAIL' THEN v_ul_fail := v_ul_fail + 1; END IF;
    IF v_iter_overall = 'PASS' THEN v_over_pass := v_over_pass + 1; END IF;
    IF v_iter_overall = 'FAIL' THEN v_over_fail := v_over_fail + 1; END IF;
    v_dl_run := public.cr1b_combine_verdicts(v_dl_run, v_dl, 'AND');
    v_ul_run := public.cr1b_combine_verdicts(v_ul_run, v_ul, 'AND');
    v_overall := public.cr1b_combine_verdicts(v_overall, v_iter_overall, COALESCE(v_dl_rule.combine_mode, 'AND'));

    v_eval_rows := v_eval_rows || jsonb_build_array(jsonb_build_object(
      'iteration_id', v_iter.id,
      'iteration_number', v_iter.iteration_number,
      'timestamp', COALESCE(v_iter.started_at, v_iter.ended_at),
      'actual_dl_mbps', v_iter.dl_mbps,
      'dl_threshold', CASE WHEN v_dir_ok THEN v_dl_rule.min_dl_mbps ELSE NULL END,
      'dl_verdict', v_dl,
      'actual_ul_mbps', v_iter.ul_mbps,
      'ul_threshold', CASE WHEN v_ul_ok THEN v_dl_rule.min_ul_mbps ELSE NULL END,
      'ul_verdict', v_ul,
      'overall_verdict', v_iter_overall,
      'incomplete_reason', CASE WHEN v_iter_overall = 'INCOMPLETE' THEN v_reason ELSE NULL END,
      'failure_reason', CASE WHEN v_iter_overall = 'FAIL' THEN COALESCE(v_iter.failure_reason, 'below_threshold') ELSE NULL END
    ));
  END LOOP;

  IF v_dl_rule.id IS NOT NULL AND v_dl_rule.required_completed_iterations IS NOT NULL
     AND v_comp < v_dl_rule.required_completed_iterations THEN
    v_overall := 'INCOMPLETE';
  END IF;
  IF NOT COALESCE(v_dir_ok, false) THEN v_dl_run := 'N/A'; END IF;
  IF NOT COALESCE(v_ul_ok, false) THEN v_ul_run := 'N/A'; END IF;

  SELECT
    COUNT(*) FILTER (WHERE e.direction = 'MO'),
    COUNT(*) FILTER (WHERE e.direction = 'MO' AND lower(e.event_type) IN ('success', 'successful', 'connected', 'completed')),
    COUNT(*) FILTER (WHERE e.direction = 'MO' AND lower(e.event_type) IN ('fail', 'failed', 'failure', 'dropped')),
    COUNT(*) FILTER (WHERE e.direction = 'MO' AND lower(e.event_type) IN ('incomplete', 'timeout', 'no_answer', 'busy')),
    COUNT(*) FILTER (WHERE e.direction = 'MT'),
    COUNT(*) FILTER (WHERE e.direction = 'MT' AND lower(e.event_type) IN ('success', 'successful', 'connected', 'completed')),
    COUNT(*) FILTER (WHERE e.direction = 'MT' AND lower(e.event_type) IN ('fail', 'failed', 'failure', 'dropped')),
    COUNT(*) FILTER (WHERE e.direction = 'MT' AND lower(e.event_type) IN ('incomplete', 'timeout', 'no_answer', 'busy'))
  INTO v_mo_att, v_mo_ok, v_mo_fail, v_mo_inc, v_mt_att, v_mt_ok, v_mt_fail, v_mt_inc
  FROM public.field_test_call_events e
  WHERE e.run_id = p_run_id;

  IF v_mo_rule.id IS NOT NULL THEN
    IF v_mo_rule.enabled_directions IS NULL OR cardinality(v_mo_rule.enabled_directions) = 0 OR 'MO' = ANY (v_mo_rule.enabled_directions) THEN
      IF COALESCE(v_mo_rule.required_mo_success, 0) <= 0 THEN v_mo := 'NOT_EVALUATED';
      ELSIF v_mo_ok >= v_mo_rule.required_mo_success THEN v_mo := 'PASS'; ELSE v_mo := 'FAIL'; END IF;
    ELSE
      v_mo := 'N/A';
    END IF;
    IF v_mo_rule.enabled_directions IS NULL OR cardinality(v_mo_rule.enabled_directions) = 0 OR 'MT' = ANY (v_mo_rule.enabled_directions) THEN
      IF COALESCE(v_mo_rule.required_mt_success, 0) <= 0 THEN v_mt := 'NOT_EVALUATED';
      ELSIF v_mt_ok >= v_mo_rule.required_mt_success THEN v_mt := 'PASS'; ELSE v_mt := 'FAIL'; END IF;
    ELSE
      v_mt := 'N/A';
    END IF;
    v_overall := public.cr1b_combine_verdicts(v_overall, public.cr1b_combine_verdicts(v_mo, v_mt, COALESCE(v_mo_rule.combine_mode, 'AND')), 'AND');
  END IF;

  v_rules := jsonb_build_object(
    'dl_ul', to_jsonb(v_dl_rule),
    'mo_mt', to_jsonb(v_mo_rule)
  );

  INSERT INTO public.field_test_run_acceptance_snapshots (
    run_id, profile_id, profile_version, scope_type, resolved_rules, units,
    effective_configuration, overall_verdict, dl_verdict, ul_verdict, mo_verdict, mt_verdict, counts
  ) VALUES (
    p_run_id,
    (v_profile->>'id')::uuid,
    (v_profile->>'version')::integer,
    v_profile->>'scope',
    COALESCE(v_rules, '{}'::jsonb),
    COALESCE(v_profile->'units', '{"throughput":"Mbps"}'::jsonb),
    v_profile,
    COALESCE(v_overall, 'NOT_EVALUATED'),
    COALESCE(v_dl_run, 'NOT_EVALUATED'),
    COALESCE(v_ul_run, 'NOT_EVALUATED'),
    COALESCE(v_mo, 'NOT_EVALUATED'),
    COALESCE(v_mt, 'NOT_EVALUATED'),
    jsonb_build_object(
      'requested', v_req,
      'attempted', v_att,
      'completed', v_comp,
      'execution_failed', v_fail,
      'evaluable', v_eval,
      'dl_pass', v_dl_pass,
      'dl_fail', v_dl_fail,
      'ul_pass', v_ul_pass,
      'ul_fail', v_ul_fail,
      'overall_pass', v_over_pass,
      'overall_fail', v_over_fail
    )
  )
  RETURNING * INTO v_snap;

  INSERT INTO public.field_test_iteration_evaluations (
    snapshot_id, iteration_id, iteration_number, timestamp,
    actual_dl_mbps, dl_threshold, dl_verdict,
    actual_ul_mbps, ul_threshold, ul_verdict,
    overall_verdict, incomplete_reason, failure_reason
  )
  SELECT
    v_snap.id,
    NULLIF(e->>'iteration_id', '')::uuid,
    (e->>'iteration_number')::integer,
    NULLIF(e->>'timestamp', '')::timestamptz,
    NULLIF(e->>'actual_dl_mbps', '')::double precision,
    NULLIF(e->>'dl_threshold', '')::double precision,
    e->>'dl_verdict',
    NULLIF(e->>'actual_ul_mbps', '')::double precision,
    NULLIF(e->>'ul_threshold', '')::double precision,
    e->>'ul_verdict',
    e->>'overall_verdict',
    e->>'incomplete_reason',
    e->>'failure_reason'
  FROM jsonb_array_elements(v_eval_rows) AS e;

  INSERT INTO public.field_test_call_summaries (
    run_id, snapshot_id,
    mo_attempted, mo_successful, mo_failed, mo_incomplete,
    mt_attempted, mt_successful, mt_failed, mt_incomplete,
    required_mo, required_mt, mo_verdict, mt_verdict, overall_verdict, labeled_synthetic
  ) VALUES (
    p_run_id, v_snap.id,
    v_mo_att, v_mo_ok, v_mo_fail, v_mo_inc,
    v_mt_att, v_mt_ok, v_mt_fail, v_mt_inc,
    v_mo_rule.required_mo_success, v_mo_rule.required_mt_success,
    v_mo, v_mt, public.cr1b_combine_verdicts(v_mo, v_mt, COALESCE(v_mo_rule.combine_mode, 'AND')),
    EXISTS (SELECT 1 FROM public.field_test_call_events e WHERE e.run_id = p_run_id AND e.labeled_synthetic)
  )
  ON CONFLICT (run_id) DO NOTHING;

  UPDATE public.field_test_runs
  SET acceptance_verdict = v_snap.overall_verdict, updated_at = now()
  WHERE id = p_run_id;

  RETURN v_snap;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ingest_field_test_canonical_result(
  p_run_id uuid,
  p_idempotency_key text,
  p_payload jsonb
)
RETURNS public.field_test_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_active boolean;
  v_run public.field_test_runs;
  v_existing public.field_test_runs;
  v_key text := btrim(COALESCE(p_idempotency_key, ''));
  v_pkg text;
  v_item jsonb;
  v_kind text;
  v_status text;
  v_failed boolean;
  v_dl double precision;
  v_ul double precision;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF v_key = '' THEN RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = '22023'; END IF;

  SELECT p.role, p.is_active IS TRUE INTO v_role, v_active
  FROM public.profiles p WHERE p.id = v_uid;
  IF v_active IS NOT TRUE THEN RAISE EXCEPTION 'forbidden_inactive' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_run FROM public.field_test_runs r WHERE r.id = p_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'run_not_found' USING ERRCODE = 'P0002'; END IF;

  IF v_run.submitted_by IS DISTINCT FROM v_uid
     AND COALESCE(v_role, '') NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'not_run_owner' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing FROM public.field_test_runs r WHERE r.idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing.id IS DISTINCT FROM p_run_id
       OR v_existing.client_run_id IS DISTINCT FROM v_run.client_run_id THEN
      RAISE EXCEPTION 'idempotency_key_reuse' USING ERRCODE = '23505';
    END IF;
    PERFORM public.evaluate_field_test_run_acceptance(p_run_id);
    SELECT * INTO v_run FROM public.field_test_runs r WHERE r.id = p_run_id;
    RETURN v_run;
  END IF;

  IF v_run.idempotency_key IS NOT NULL AND v_run.idempotency_key IS DISTINCT FROM v_key THEN
    RAISE EXCEPTION 'idempotency_key_reuse' USING ERRCODE = '23505';
  END IF;

  v_pkg := COALESCE(p_payload->>'package_identity', v_run.package_identity, v_run.client_run_id::text);

  UPDATE public.field_test_runs r
  SET
    idempotency_key = v_key,
    package_identity = v_pkg,
    client_package_identity = COALESCE(p_payload->'client_package_identity', r.client_package_identity),
    requested_iterations = COALESCE((p_payload->>'requested_iterations')::integer, r.requested_iterations),
    attempted_iterations = COALESCE((p_payload->>'attempted_iterations')::integer, r.attempted_iterations),
    completed_iterations = COALESCE((p_payload->>'completed_iterations')::integer, r.completed_iterations),
    failed_iterations = COALESCE((p_payload->>'failed_iterations')::integer, r.failed_iterations),
    upload_state = COALESCE(p_payload->>'upload_state', r.upload_state, 'uploaded'),
    upload_completed_at = COALESCE(r.upload_completed_at, now()),
    incomplete_reason = COALESCE(p_payload->>'incomplete_reason', r.incomplete_reason),
    failure_reason = COALESCE(p_payload->>'failure_reason', r.failure_reason),
    updated_at = now()
  WHERE r.id = p_run_id
  RETURNING * INTO v_run;

  FOR v_item IN SELECT jsonb_array_elements(COALESCE(p_payload->'iterations', '[]'::jsonb))
  LOOP
    v_kind := COALESCE(v_item->>'scenario_kind', v_run.scenario_type, 'unknown');
    v_status := lower(COALESCE(v_item->>'status', 'incomplete'));
    IF v_status NOT IN ('completed', 'failed', 'incomplete', 'not_attempted') THEN
      v_status := 'incomplete';
    END IF;
    v_failed := COALESCE((v_item->>'execution_failed')::boolean, v_status = 'failed');
    v_dl := NULLIF(v_item->>'dl_mbps', '')::double precision;
    v_ul := NULLIF(v_item->>'ul_mbps', '')::double precision;
    INSERT INTO public.field_test_iterations (
      run_id, iteration_number, scenario_kind, started_at, ended_at, status, execution_failed,
      dl_mbps, ul_mbps, http_latency_ms, failure_reason, incomplete_reason, raw_measurement
    ) VALUES (
      p_run_id,
      COALESCE((v_item->>'iteration_number')::integer, 0),
      v_kind,
      NULLIF(v_item->>'started_at', '')::timestamptz,
      NULLIF(v_item->>'ended_at', '')::timestamptz,
      v_status,
      v_failed,
      v_dl,
      v_ul,
      NULLIF(v_item->>'http_latency_ms', '')::double precision,
      v_item->>'failure_reason',
      v_item->>'incomplete_reason',
      COALESCE(v_item->'raw_measurement', '{}'::jsonb)
    )
    ON CONFLICT (run_id, iteration_number, scenario_kind) DO NOTHING;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM public.field_test_call_events e WHERE e.run_id = p_run_id) THEN
    FOR v_item IN SELECT jsonb_array_elements(COALESCE(p_payload->'call_events', '[]'::jsonb))
    LOOP
      INSERT INTO public.field_test_call_events (
        run_id, direction, event_type, occurred_at, labeled_synthetic, payload
      ) VALUES (
        p_run_id,
        upper(v_item->>'direction'),
        COALESCE(v_item->>'event_type', 'attempt'),
        NULLIF(v_item->>'occurred_at', '')::timestamptz,
        COALESCE((v_item->>'synthetic')::boolean, (p_payload->>'synthetic_call_events')::boolean, false),
        COALESCE(v_item->'payload', '{}'::jsonb)
      );
    END LOOP;
  END IF;

  PERFORM public.evaluate_field_test_run_acceptance(p_run_id);
  SELECT * INTO v_run FROM public.field_test_runs r WHERE r.id = p_run_id;
  RETURN v_run;
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_acceptance_profile(
  p_scope_type text,
  p_scope_id uuid,
  p_tenant_id uuid,
  p_name text,
  p_is_default boolean,
  p_rules jsonb
)
RETURNS public.acceptance_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_active boolean;
  v_row public.acceptance_profiles;
  v_dl jsonb := COALESCE(p_rules->'dl_ul', p_rules);
  v_mo jsonb := COALESCE(p_rules->'mo_mt', '{}'::jsonb);
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  SELECT p.role, p.is_active IS TRUE INTO v_role, v_active FROM public.profiles p WHERE p.id = v_uid;
  IF v_active IS NOT TRUE OR v_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'forbidden_not_admin' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row
  FROM public.acceptance_profiles p
  WHERE p.scope_type = p_scope_type
    AND p.is_active IS TRUE
    AND (
      (p_scope_type IN ('task', 'project') AND p.scope_id = p_scope_id)
      OR (p_scope_type = 'tenant' AND COALESCE(p.is_default, false) = COALESCE(p_is_default, false)
          AND (p.tenant_id IS NOT DISTINCT FROM p_tenant_id))
    )
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.acceptance_profiles
    SET name = COALESCE(NULLIF(btrim(p_name), ''), name),
        version = version + 1,
        is_default = COALESCE(p_is_default, is_default),
        updated_at = now()
    WHERE id = v_row.id
    RETURNING * INTO v_row;
  ELSE
    INSERT INTO public.acceptance_profiles (
      tenant_id, scope_type, scope_id, name, version, is_active, is_default, created_by
    ) VALUES (
      p_tenant_id, p_scope_type, p_scope_id, COALESCE(NULLIF(btrim(p_name), ''), 'CR1-B profile'),
      1, true, COALESCE(p_is_default, false), v_uid
    )
    RETURNING * INTO v_row;
  END IF;

  INSERT INTO public.acceptance_rules (
    profile_id, profile_version, rule_type, enabled_directions, combine_mode,
    min_dl_mbps, min_ul_mbps, required_completed_iterations, completion_policy,
    required_mo_success, required_mt_success, config
  ) VALUES (
    v_row.id, v_row.version, 'dl_ul',
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_dl->'enabled_directions', '["dl","ul"]'::jsonb))), ARRAY['dl','ul']::text[]),
    COALESCE(upper(v_dl->>'combine_mode'), 'AND'),
    NULLIF(v_dl->>'min_dl_mbps', '')::double precision,
    NULLIF(v_dl->>'min_ul_mbps', '')::double precision,
    NULLIF(v_dl->>'required_completed_iterations', '')::integer,
    COALESCE(v_dl->>'completion_policy', 'min_completed'),
    NULL, NULL, v_dl
  )
  ON CONFLICT (profile_id, profile_version, rule_type) DO UPDATE SET config = EXCLUDED.config;

  INSERT INTO public.acceptance_rules (
    profile_id, profile_version, rule_type, enabled_directions, combine_mode,
    required_mo_success, required_mt_success, config
  ) VALUES (
    v_row.id, v_row.version, 'mo_mt',
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_mo->'enabled_directions', '["MO","MT"]'::jsonb))), ARRAY['MO','MT']::text[]),
    COALESCE(upper(v_mo->>'combine_mode'), 'AND'),
    COALESCE(NULLIF(v_mo->>'required_mo_success', '')::integer, 0),
    COALESCE(NULLIF(v_mo->>'required_mt_success', '')::integer, 0),
    v_mo
  )
  ON CONFLICT (profile_id, profile_version, rule_type) DO UPDATE SET config = EXCLUDED.config;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.override_field_test_acceptance_verdict(
  p_run_id uuid,
  p_override_verdict text,
  p_reason text
)
RETURNS public.qc_verdict_overrides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_active boolean;
  v_snap public.field_test_run_acceptance_snapshots;
  v_row public.qc_verdict_overrides;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  SELECT p.role, p.is_active IS TRUE INTO v_role, v_active FROM public.profiles p WHERE p.id = v_uid;
  IF v_active IS NOT TRUE OR v_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'forbidden_not_admin' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'override_reason_required' USING ERRCODE = '22023';
  END IF;
  IF p_override_verdict NOT IN ('PASS', 'FAIL', 'INCOMPLETE', 'NOT_EVALUATED') THEN
    RAISE EXCEPTION 'invalid_override_verdict' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_snap FROM public.field_test_run_acceptance_snapshots s WHERE s.run_id = p_run_id;
  IF NOT FOUND THEN
    v_snap := public.evaluate_field_test_run_acceptance(p_run_id);
  END IF;

  INSERT INTO public.qc_verdict_overrides (
    run_id, snapshot_id, computed_verdict, override_verdict, reason, actor_id
  ) VALUES (
    p_run_id, v_snap.id, v_snap.overall_verdict, p_override_verdict, btrim(p_reason), v_uid
  )
  ON CONFLICT (run_id) DO UPDATE SET
    snapshot_id = EXCLUDED.snapshot_id,
    computed_verdict = EXCLUDED.computed_verdict,
    override_verdict = EXCLUDED.override_verdict,
    reason = EXCLUDED.reason,
    actor_id = EXCLUDED.actor_id,
    created_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;
