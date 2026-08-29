-- DRAFT / DISPOSABLE CR1-D
-- PAIR: 215_cr1d_acceptance_profile_management
-- ROLE: VERIFICATION
-- CR1D_APPLY one-shot. DO NOT EXECUTE 214.

SELECT
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'acceptance_profiles'
      AND column_name = 'description'
  ) AS has_description,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'acceptance_profiles'
      AND column_name = 'scenario_family'
  ) AS has_scenario_family,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'acceptance_profiles_one_active_scope_scenario'
  ) AS has_scope_scenario_index,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'acceptance_profiles_one_tenant_default_scenario'
  ) AS has_tenant_scenario_index,
  NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'acceptance_profiles_one_active_scope'
  ) AS old_scope_index_dropped,
  NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'acceptance_profiles_one_tenant_default'
  ) AS old_tenant_index_dropped,
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'cr1b_resolve_acceptance_profile'
      AND p.pronargs = 4
  ) AS has_resolver_scenario_overload,
  NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname ILIKE '%207%' OR polname ILIKE '%tenant_storage_assumptions%'
  ) AS no_207_leak;
