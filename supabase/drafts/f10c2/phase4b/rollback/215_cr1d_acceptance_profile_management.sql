-- DRAFT / DISPOSABLE CR1-D
-- PAIR: 215_cr1d_acceptance_profile_management
-- ROLE: ROLLBACK
-- Restores 211 unique indexes and drops additive 215 columns.
-- Does not rewrite field_test_runs, snapshots, QC, users, or artifacts.
-- Function bodies are not restored here (would require re-executing 212, which is forbidden).
-- DO NOT EXECUTE unless verification proves a partial 215 schema apply.

BEGIN;

DROP FUNCTION IF EXISTS public.cr1b_resolve_acceptance_profile(uuid, uuid, uuid, text);

DROP INDEX IF EXISTS public.acceptance_profiles_one_active_scope_scenario;
DROP INDEX IF EXISTS public.acceptance_profiles_one_tenant_default_scenario;

CREATE UNIQUE INDEX IF NOT EXISTS acceptance_profiles_one_active_scope
  ON public.acceptance_profiles (scope_type, scope_id)
  WHERE is_active IS TRUE AND scope_type IN ('task', 'project');

CREATE UNIQUE INDEX IF NOT EXISTS acceptance_profiles_one_tenant_default
  ON public.acceptance_profiles (tenant_id)
  WHERE is_active IS TRUE AND is_default IS TRUE AND scope_type = 'tenant';

ALTER TABLE public.acceptance_profiles DROP COLUMN IF EXISTS scenario_family;
ALTER TABLE public.acceptance_profiles DROP COLUMN IF EXISTS description;

COMMIT;
