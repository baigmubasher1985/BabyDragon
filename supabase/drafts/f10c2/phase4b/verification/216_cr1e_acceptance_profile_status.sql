-- F10C2 CR1-E — SELECT-only verification for 216_cr1e_acceptance_profile_status.
-- PAIR: 216_cr1e_acceptance_profile_status
-- ROLE: VERIFICATION
-- CR1E_APPLY one-shot. Never auto-apply via listPhase4bApplyPlan.

SELECT
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'set_acceptance_profile_active'
      AND p.pronargs = 2
      AND p.prosecdef IS TRUE
  ) AS has_security_definer_status_rpc,
  NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.acceptance_profiles'::regclass
      AND polcmd = 'w'
  ) AS no_client_update_policy,
  CASE
    WHEN to_regprocedure('public.set_acceptance_profile_active(uuid,boolean)') IS NULL THEN false
    ELSE NOT has_function_privilege('anon', 'public.set_acceptance_profile_active(uuid,boolean)', 'EXECUTE')
  END AS anon_cannot_execute,
  CASE
    WHEN to_regprocedure('public.set_acceptance_profile_active(uuid,boolean)') IS NULL THEN false
    ELSE has_function_privilege('authenticated', 'public.set_acceptance_profile_active(uuid,boolean)', 'EXECUTE')
  END AS authenticated_can_execute,
  NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname ILIKE '%207%' OR polname ILIKE '%tenant_storage_assumptions%'
  ) AS no_207_leak;
