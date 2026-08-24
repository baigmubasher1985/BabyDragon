-- DRAFT / DISPOSABLE REMEDIATION
-- F10C2 PHASE 4B-U-R1
-- PAIR: 209_disposable_operational_profile_task_rls_remediation
-- ROLE: FORWARD
-- CLASSIFICATION: additive disposable operational RLS after 208
-- NOTE: No secrets. No project refs. No production identifiers. No data copy.
-- NOTE: Production execution is NOT authorized. Do not apply this file to any
--       production project. Disposable rollout does not approve production.
-- NOTE: Does not execute 009, 010, 012, 013, 112, or 207.
-- NOTE: DROP POLICY IF EXISTS is limited to THIS migration's policy names.
-- NOTE: ENABLE ROW LEVEL SECURITY only. Never disable RLS. Never drop relations.
-- NOTE: profiles and tasks have no tenant_id. This is a single-disposable-tenant
--       limitation. Production rollout remains blocked until a tenant-aware
--       policy design is approved.

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

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- Profiles SELECT: own row by auth.uid(). Do not query profiles from this
-- policy (no recursive profiles policy). Role is never taken from the client.
DROP POLICY IF EXISTS "profiles_209_select_own" ON public.profiles;
CREATE POLICY "profiles_209_select_own"
  ON public.profiles
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (id = auth.uid());

-- Profiles SELECT: admin/super_admin via DEFINER helper (helper reads profiles
-- internally; this policy expression does not).
DROP POLICY IF EXISTS "profiles_209_select_admin" ON public.profiles;
CREATE POLICY "profiles_209_select_admin"
  ON public.profiles
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin_or_super_admin());

-- Profile UPDATE/DELETE omitted. 4B-U does not require self-UPDATE of name
-- or personal fields. FE must not change role, email, is_active, id,
-- created_at, or assignment ownership. Admin User Management mutations are
-- out of this remediation scope.

-- Tasks SELECT: assigned field engineer only.
DROP POLICY IF EXISTS "tasks_209_select_assigned" ON public.tasks;
CREATE POLICY "tasks_209_select_assigned"
  ON public.tasks
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (assigned_to = auth.uid());

-- Tasks SELECT: admin/super_admin via helper.
DROP POLICY IF EXISTS "tasks_209_select_admin" ON public.tasks;
CREATE POLICY "tasks_209_select_admin"
  ON public.tasks
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_admin_or_super_admin());

-- Tasks INSERT: admin/super_admin only (intended assignment workflow).
DROP POLICY IF EXISTS "tasks_209_insert_admin" ON public.tasks;
CREATE POLICY "tasks_209_insert_admin"
  ON public.tasks
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_or_super_admin());

-- Tasks UPDATE: admin/super_admin only. FE direct UPDATE is omitted.
-- FE status/start/completion must use public.update_assigned_task_status
-- (already deployed). That RPC cannot change assigned_to, project_id,
-- grid_id, or other privileged identity fields.
DROP POLICY IF EXISTS "tasks_209_update_admin" ON public.tasks;
CREATE POLICY "tasks_209_update_admin"
  ON public.tasks
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (public.is_admin_or_super_admin())
  WITH CHECK (public.is_admin_or_super_admin());

-- Tasks DELETE omitted. No accepted operational contract requires FE or
-- admin delete in this disposable remediation.

COMMIT;
