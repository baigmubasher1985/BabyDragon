-- DRAFT / DISPOSABLE CR1-B
-- F10C2 CR1-B ACCEPTANCE ENGINE SCHEMA
-- PAIR: 211_cr1b_acceptance_engine_schema
-- ROLE: FORWARD
-- CLASSIFICATION: additive after 210
-- NOTE: Versioned profiles + immutable snapshots. Historical results do not change.

BEGIN;

CREATE TABLE IF NOT EXISTS public.acceptance_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  scope_type text NOT NULL CHECK (scope_type IN ('tenant', 'project', 'task')),
  scope_id uuid NULL,
  name text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  units jsonb NOT NULL DEFAULT '{"throughput":"Mbps"}'::jsonb,
  created_by uuid NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT acceptance_profiles_task_scope CHECK (
    scope_type <> 'task' OR scope_id IS NOT NULL
  ),
  CONSTRAINT acceptance_profiles_project_scope CHECK (
    scope_type <> 'project' OR scope_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS acceptance_profiles_one_active_scope
  ON public.acceptance_profiles (scope_type, scope_id)
  WHERE is_active IS TRUE AND scope_type IN ('task', 'project');

CREATE UNIQUE INDEX IF NOT EXISTS acceptance_profiles_one_tenant_default
  ON public.acceptance_profiles (tenant_id)
  WHERE is_active IS TRUE AND is_default IS TRUE AND scope_type = 'tenant';

CREATE TABLE IF NOT EXISTS public.acceptance_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.acceptance_profiles(id) ON DELETE CASCADE,
  profile_version integer NOT NULL,
  rule_type text NOT NULL CHECK (rule_type IN ('dl_ul', 'mo_mt')),
  enabled_directions text[] NOT NULL DEFAULT ARRAY[]::text[],
  combine_mode text NOT NULL DEFAULT 'AND' CHECK (combine_mode IN ('AND', 'OR')),
  min_dl_mbps double precision NULL,
  min_ul_mbps double precision NULL,
  required_completed_iterations integer NULL,
  completion_policy text NOT NULL DEFAULT 'min_completed',
  required_mo_success integer NULL,
  required_mt_success integer NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT acceptance_rules_profile_type UNIQUE (profile_id, profile_version, rule_type)
);

CREATE TABLE IF NOT EXISTS public.field_test_run_acceptance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.field_test_runs(id) ON DELETE CASCADE,
  profile_id uuid NULL REFERENCES public.acceptance_profiles(id),
  profile_version integer NULL,
  scope_type text NULL,
  resolved_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  units jsonb NOT NULL DEFAULT '{"throughput":"Mbps"}'::jsonb,
  effective_configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  overall_verdict text NOT NULL CHECK (overall_verdict IN ('PASS', 'FAIL', 'INCOMPLETE', 'NOT_EVALUATED')),
  dl_verdict text NOT NULL CHECK (dl_verdict IN ('PASS', 'FAIL', 'INCOMPLETE', 'NOT_EVALUATED', 'N/A')),
  ul_verdict text NOT NULL CHECK (ul_verdict IN ('PASS', 'FAIL', 'INCOMPLETE', 'NOT_EVALUATED', 'N/A')),
  mo_verdict text NOT NULL CHECK (mo_verdict IN ('PASS', 'FAIL', 'INCOMPLETE', 'NOT_EVALUATED', 'N/A')),
  mt_verdict text NOT NULL CHECK (mt_verdict IN ('PASS', 'FAIL', 'INCOMPLETE', 'NOT_EVALUATED', 'N/A')),
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT field_test_run_acceptance_snapshots_run_unique UNIQUE (run_id)
);

CREATE TABLE IF NOT EXISTS public.field_test_iteration_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NULL REFERENCES public.field_test_run_acceptance_snapshots(id) ON DELETE CASCADE,
  iteration_id uuid NULL REFERENCES public.field_test_iterations(id) ON DELETE SET NULL,
  iteration_number integer NOT NULL,
  timestamp timestamptz NULL,
  actual_dl_mbps double precision NULL,
  dl_threshold double precision NULL,
  dl_verdict text NOT NULL,
  actual_ul_mbps double precision NULL,
  ul_threshold double precision NULL,
  ul_verdict text NOT NULL,
  overall_verdict text NOT NULL,
  incomplete_reason text NULL,
  failure_reason text NULL,
  CONSTRAINT field_test_iteration_evaluations_snapshot_iter UNIQUE (snapshot_id, iteration_number)
);

CREATE TABLE IF NOT EXISTS public.field_test_call_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.field_test_runs(id) ON DELETE CASCADE,
  snapshot_id uuid NULL REFERENCES public.field_test_run_acceptance_snapshots(id) ON DELETE SET NULL,
  mo_attempted integer NOT NULL DEFAULT 0,
  mo_successful integer NOT NULL DEFAULT 0,
  mo_failed integer NOT NULL DEFAULT 0,
  mo_incomplete integer NOT NULL DEFAULT 0,
  mt_attempted integer NOT NULL DEFAULT 0,
  mt_successful integer NOT NULL DEFAULT 0,
  mt_failed integer NOT NULL DEFAULT 0,
  mt_incomplete integer NOT NULL DEFAULT 0,
  required_mo integer NULL,
  required_mt integer NULL,
  mo_verdict text NOT NULL DEFAULT 'NOT_EVALUATED',
  mt_verdict text NOT NULL DEFAULT 'NOT_EVALUATED',
  overall_verdict text NOT NULL DEFAULT 'NOT_EVALUATED',
  labeled_synthetic boolean NOT NULL DEFAULT false,
  CONSTRAINT field_test_call_summaries_run_unique UNIQUE (run_id)
);

CREATE TABLE IF NOT EXISTS public.qc_verdict_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.field_test_runs(id) ON DELETE CASCADE,
  snapshot_id uuid NULL REFERENCES public.field_test_run_acceptance_snapshots(id) ON DELETE SET NULL,
  computed_verdict text NOT NULL,
  override_verdict text NOT NULL,
  reason text NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qc_verdict_overrides_run_unique UNIQUE (run_id),
  CONSTRAINT qc_verdict_overrides_reason_present CHECK (length(btrim(reason)) > 0)
);

COMMENT ON TABLE public.field_test_run_acceptance_snapshots IS
  'Immutable acceptance snapshot. Changing profile thresholds later must not rewrite this row.';
COMMENT ON TABLE public.qc_verdict_overrides IS
  'Admin/super_admin override. Preserves computed verdict and override side by side.';

COMMIT;
