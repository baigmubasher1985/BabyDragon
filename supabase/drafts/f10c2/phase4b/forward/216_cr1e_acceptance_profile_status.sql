-- F10C2 CR1-E ACCEPTANCE PROFILE STATUS RPC
-- PAIR: 216_cr1e_acceptance_profile_status
-- ROLE: FORWARD
-- CLASSIFICATION: CR1E_APPLY one-shot on authorized disposable only. Additive after 215.
-- NOTE: Does not re-apply 209–215. Does not execute 214. Does not rewrite immutable snapshots.
--       Prefer SECURITY DEFINER RPC over broad client UPDATE on acceptance_profiles.
--
-- Resolver decision (documented, implemented by existing is_active filter + this RPC):
--   Completed runs retain snapshotted profile/version.
--   New runs must not resolve an inactive profile (cr1b_resolve_acceptance_profile already
--     selects is_active IS TRUE only).
--   Deactivating a reusable saved rule also deactivates pointing task-scope assignment rows
--     (same tenant + cloned_from_id or same name). Those rows are not deleted.
--   Open tasks then fall back to the next valid active criterion:
--     task+scenario → task default → project+scenario → project default
--     → tenant+scenario → tenant default.
--   UI copy: "Assigned criterion is inactive; effective criterion is [fallback rule]."
--   Admin is prompted to replace the inactive assignment. Deactivation warns when
--     active assignments exist. RPC is idempotent. Audit who/when via security_audit_log
--     when that table exists. Result is sanitized jsonb; no raw DB errors returned.

BEGIN;

CREATE OR REPLACE FUNCTION public.set_acceptance_profile_active(
  p_profile_id uuid,
  p_is_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_actor_active boolean;
  v_actor_tenant uuid;
  v_row public.acceptance_profiles;
  v_already boolean := false;
  v_assignment_count integer := 0;
  v_child_count integer := 0;
  v_outcome text := 'ok';
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_authenticated');
  END IF;

  SELECT p.role, p.is_active IS TRUE,
         NULLIF(to_jsonb(p)->>'tenant_id', '')::uuid
    INTO v_role, v_actor_active, v_actor_tenant
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF v_actor_active IS NOT TRUE OR v_role NOT IN ('admin', 'super_admin') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden_not_admin');
  END IF;

  IF p_profile_id IS NULL OR p_is_active IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_status_request');
  END IF;

  SELECT * INTO v_row FROM public.acceptance_profiles WHERE id = p_profile_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'profile_not_found');
  END IF;

  IF v_row.tenant_id IS NOT NULL
     AND v_actor_tenant IS NOT NULL
     AND v_row.tenant_id IS DISTINCT FROM v_actor_tenant THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden_cross_tenant');
  END IF;

  IF v_row.tenant_id IS NOT NULL
     AND v_actor_tenant IS NULL
     AND v_role <> 'super_admin' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden_cross_tenant');
  END IF;

  SELECT COUNT(*)::integer INTO v_assignment_count
  FROM public.acceptance_profiles child
  WHERE child.is_active IS TRUE
    AND child.scope_type = 'task'
    AND child.id IS DISTINCT FROM v_row.id
    AND (
      (v_row.scope_type <> 'task' AND child.name IS NOT DISTINCT FROM v_row.name
        AND (v_row.tenant_id IS NULL OR child.tenant_id IS NOT DISTINCT FROM v_row.tenant_id))
      OR EXISTS (
        SELECT 1 FROM public.acceptance_rules r
        WHERE r.profile_id = child.id
          AND r.profile_version = child.version
          AND r.config->>'cloned_from_id' = v_row.id::text
      )
    );

  IF v_row.is_active IS NOT DISTINCT FROM p_is_active THEN
    v_already := true;
    v_outcome := 'idempotent';
  ELSE
    UPDATE public.acceptance_profiles
    SET is_active = p_is_active,
        updated_at = now()
    WHERE id = v_row.id
    RETURNING * INTO v_row;

    IF p_is_active IS FALSE AND v_row.scope_type <> 'task' THEN
      UPDATE public.acceptance_profiles child
      SET is_active = false,
          updated_at = now()
      WHERE child.is_active IS TRUE
        AND child.scope_type = 'task'
        AND child.id IS DISTINCT FROM v_row.id
        AND (
          (child.name IS NOT DISTINCT FROM v_row.name
            AND (v_row.tenant_id IS NULL OR child.tenant_id IS NOT DISTINCT FROM v_row.tenant_id))
          OR EXISTS (
            SELECT 1 FROM public.acceptance_rules r
            WHERE r.profile_id = child.id
              AND r.profile_version = child.version
              AND r.config->>'cloned_from_id' = v_row.id::text
          )
        );
      GET DIAGNOSTICS v_child_count = ROW_COUNT;
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.security_audit_log (
      actor_user_id, action, target_type, target_id, outcome, detail
    ) VALUES (
      v_uid,
      'acceptance_profile_status',
      'acceptance_profiles',
      v_row.id::text,
      v_outcome,
      jsonb_build_object(
        'is_active', p_is_active,
        'unchanged', v_already,
        'active_assignment_count', v_assignment_count,
        'deactivated_assignment_count', v_child_count
      )
    );
  EXCEPTION
    WHEN undefined_table THEN NULL;
    WHEN insufficient_privilege THEN NULL;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'code', v_outcome,
    'profile_id', v_row.id,
    'is_active', v_row.is_active,
    'unchanged', v_already,
    'updated_at', v_row.updated_at,
    'updated_by', v_uid,
    'active_assignment_count', v_assignment_count,
    'deactivated_assignment_count', v_child_count
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'code', 'status_update_failed');
END;
$function$;

COMMENT ON FUNCTION public.set_acceptance_profile_active(uuid, boolean) IS
  'CR1-E. Admin/super_admin SECURITY DEFINER activate/deactivate. No client UPDATE on acceptance_profiles.';

REVOKE ALL ON FUNCTION public.set_acceptance_profile_active(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_acceptance_profile_active(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_acceptance_profile_active(uuid, boolean) TO authenticated;

COMMIT;
