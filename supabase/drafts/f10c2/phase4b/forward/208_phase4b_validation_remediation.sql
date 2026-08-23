-- DRAFT / DISPOSABLE REMEDIATION
-- F10C2 PHASE 4B-E-R1
-- PAIR: 208_phase4b_validation_remediation
-- ROLE: FORWARD
-- CLASSIFICATION: additive disposable repair after 206
-- NOTE: No secrets. No project refs. No production identifiers.
-- NOTE: Does not execute 207. Does not disable RLS. Does not add profiles policies.
-- NOTE: Canonical 206/109/110/111 sources are also updated for fresh installs.

BEGIN;

DO $helper$
DECLARE
  v_owner text;
  v_definer boolean;
  v_config text;
  v_src text;
BEGIN
  SELECT pg_get_userbyid(p.proowner), p.prosecdef,
         COALESCE(array_to_string(p.proconfig, ','), ''),
         pg_get_functiondef(p.oid)
    INTO v_owner, v_definer, v_config, v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'is_admin_or_super_admin'
    AND pg_get_function_identity_arguments(p.oid) = '';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'is_admin_or_super_admin() is required and missing';
  END IF;
  IF v_owner IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'is_admin_or_super_admin owner must be postgres';
  END IF;
  IF v_definer IS NOT TRUE THEN
    RAISE EXCEPTION 'is_admin_or_super_admin must be SECURITY DEFINER';
  END IF;
  IF v_config !~* 'search_path' THEN
    RAISE EXCEPTION 'is_admin_or_super_admin must set a fixed search_path';
  END IF;
  IF v_src !~* 'auth\.uid\(\)'
     OR v_src !~* 'is_active'
     OR v_src !~* 'super_admin' THEN
    RAISE EXCEPTION 'is_admin_or_super_admin predicate is incomplete';
  END IF;
END
$helper$;

REVOKE ALL ON FUNCTION public.is_admin_or_super_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin_or_super_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_admin_or_super_admin() TO authenticated;

DROP POLICY IF EXISTS "field_test_runs_admin_select" ON public.field_test_runs;
CREATE POLICY "field_test_runs_admin_select"
  ON public.field_test_runs
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin_or_super_admin());

DROP POLICY IF EXISTS "field_test_qc_reviews_admin_select" ON public.field_test_qc_reviews;
CREATE POLICY "field_test_qc_reviews_admin_select"
  ON public.field_test_qc_reviews
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin_or_super_admin());

DROP POLICY IF EXISTS "field_test_artifacts_admin_select" ON public.field_test_artifacts;
CREATE POLICY "field_test_artifacts_admin_select"
  ON public.field_test_artifacts
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin_or_super_admin());

DROP POLICY IF EXISTS "field_test_metrics_admin_select" ON public.field_test_metrics;
CREATE POLICY "field_test_metrics_admin_select"
  ON public.field_test_metrics
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin_or_super_admin());

CREATE UNIQUE INDEX IF NOT EXISTS artifact_transfer_jobs_idempotency_key_global
  ON public.artifact_transfer_jobs (idempotency_key);

CREATE OR REPLACE FUNCTION public.request_artifact_upload_plan(
  p_run_id uuid,
  p_artifact_id uuid,
  p_artifact_type text,
  p_checksum text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_active boolean;
  v_run public.field_test_runs;
  v_art public.field_test_artifacts;
  v_connection public.storage_connections;
  v_policy public.tenant_storage_policies;
  v_job public.artifact_transfer_jobs;
  v_ttl integer := 120;
  v_bucket text;
  v_provider text;
  v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = '22023';
  END IF;

  SELECT p.role, p.is_active
    INTO v_role, v_active
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'forbidden_inactive' USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_run
  FROM public.field_test_runs r
  WHERE r.id = p_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_run.submitted_by IS DISTINCT FROM v_uid
     AND COALESCE(v_role, '') NOT IN ('admin', 'super_admin', 'qc') THEN
    RAISE EXCEPTION 'owner_mismatch' USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_art
  FROM public.field_test_artifacts a
  WHERE a.id = p_artifact_id AND a.run_id = p_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'artifact_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_art.checksum IS DISTINCT FROM p_checksum THEN
    RAISE EXCEPTION 'checksum_mismatch' USING ERRCODE = '22000';
  END IF;

  IF p_artifact_type IS NOT NULL
     AND btrim(p_artifact_type) <> ''
     AND p_artifact_type IS DISTINCT FROM v_art.artifact_type THEN
    RAISE EXCEPTION 'artifact_type_mismatch' USING ERRCODE = '22023';
  END IF;

  IF v_art.tenant_id IS NOT NULL
     AND v_run.tenant_id IS NOT NULL
     AND v_art.tenant_id IS DISTINCT FROM v_run.tenant_id THEN
    RAISE EXCEPTION 'tenant_mismatch' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(v_run.tenant_id, v_art.tenant_id) IS NOT NULL THEN
    SELECT *
      INTO v_policy
    FROM public.tenant_storage_policies p
    WHERE p.tenant_id = COALESCE(v_run.tenant_id, v_art.tenant_id)
      AND p.artifact_type = v_art.artifact_type
    LIMIT 1;

    IF v_policy.storage_connection_id IS NOT NULL THEN
      SELECT *
        INTO v_connection
      FROM public.storage_connections c
      WHERE c.id = v_policy.storage_connection_id
        AND c.tenant_id = COALESCE(v_run.tenant_id, v_art.tenant_id)
        AND c.is_active IS TRUE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'storage_connection_cross_tenant' USING ERRCODE = '42501';
      END IF;
    ELSE
      SELECT *
        INTO v_connection
      FROM public.storage_connections c
      WHERE c.tenant_id = COALESCE(v_run.tenant_id, v_art.tenant_id)
        AND c.is_default IS TRUE
        AND c.is_active IS TRUE
      LIMIT 1;
    END IF;
  END IF;

  v_provider := COALESCE(v_connection.provider_type, 'supabase');
  IF v_provider IS DISTINCT FROM 'supabase' THEN
    RAISE EXCEPTION 'provider_not_implemented' USING ERRCODE = '0A000';
  END IF;

  v_bucket := COALESCE(v_connection.bucket_or_container, 'result-artifacts');
  IF v_bucket IN ('task-photos', 'operational-evidence') THEN
    RAISE EXCEPTION 'banned_bucket' USING ERRCODE = '22023';
  END IF;

  -- F10C2 208: supplied idempotency key is validated before any existing-job return.
  -- Key is permanently bound to tenant_id + artifact_id + operation.
  IF COALESCE(v_run.tenant_id, v_art.tenant_id) IS NOT NULL
     AND v_art.tenant_id IS NOT NULL THEN
    SELECT *
      INTO v_job
    FROM public.artifact_transfer_jobs j
    WHERE j.idempotency_key = btrim(p_idempotency_key)
    LIMIT 1;

    IF FOUND THEN
      IF v_job.tenant_id IS DISTINCT FROM v_art.tenant_id
         OR v_job.artifact_id IS DISTINCT FROM p_artifact_id
         OR v_job.operation IS DISTINCT FROM 'request_artifact_upload_plan' THEN
        RAISE EXCEPTION 'idempotency_key_reuse' USING ERRCODE = '23505';
      END IF;
    ELSE
      SELECT *
        INTO v_job
      FROM public.artifact_transfer_jobs j
      WHERE j.tenant_id = v_art.tenant_id
        AND j.artifact_id = p_artifact_id
        AND j.operation = 'request_artifact_upload_plan';

      IF FOUND THEN
        IF v_job.idempotency_key IS DISTINCT FROM btrim(p_idempotency_key) THEN
          RAISE EXCEPTION 'idempotency_key_reuse' USING ERRCODE = '23505';
        END IF;
      ELSE
        BEGIN
          INSERT INTO public.artifact_transfer_jobs (
            tenant_id,
            artifact_id,
            operation,
            idempotency_key,
            source,
            destination,
            state
          ) VALUES (
            v_art.tenant_id,
            p_artifact_id,
            'request_artifact_upload_plan',
            btrim(p_idempotency_key),
            'mobile_session_upload',
            v_bucket,
            'planning'
          )
          RETURNING * INTO v_job;
        EXCEPTION WHEN unique_violation THEN
          SELECT *
            INTO v_job
          FROM public.artifact_transfer_jobs j
          WHERE j.idempotency_key = btrim(p_idempotency_key)
             OR (
               j.tenant_id = v_art.tenant_id
               AND j.artifact_id = p_artifact_id
               AND j.operation = 'request_artifact_upload_plan'
             )
          LIMIT 1;
          IF NOT FOUND
             OR v_job.tenant_id IS DISTINCT FROM v_art.tenant_id
             OR v_job.artifact_id IS DISTINCT FROM p_artifact_id
             OR v_job.operation IS DISTINCT FROM 'request_artifact_upload_plan'
             OR v_job.idempotency_key IS DISTINCT FROM btrim(p_idempotency_key) THEN
            RAISE EXCEPTION 'idempotency_key_reuse' USING ERRCODE = '23505';
          END IF;
        END;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'provider_type', v_provider,
    'method', 'session_scoped_put',
    'object_key', v_art.object_key,
    'bucket', v_bucket,
    'provider_object_id', COALESCE(v_art.provider_object_id, v_art.id::text),
    'artifact_id', v_art.id,
    'artifact_type', v_art.artifact_type,
    'tenant_id', v_art.tenant_id,
    'expires_in_seconds', v_ttl,
    'expires_at', (v_now + make_interval(secs => v_ttl)),
    'authorization', jsonb_build_object('mode', 'existing_session'),
    'public_url', NULL,
    'idempotency_key', btrim(p_idempotency_key),
    'transfer_job_id', v_job.id,
    'secret_material', NULL
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.request_artifact_upload_plan(uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_artifact_upload_plan(uuid, uuid, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_artifact_upload_plan(uuid, uuid, text, text, text) TO authenticated;

COMMIT;
