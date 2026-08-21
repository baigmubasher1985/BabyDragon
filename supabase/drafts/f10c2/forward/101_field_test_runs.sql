-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 1
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: Canonical field-test run metadata. Client may supply client_run_id for idempotency only.
-- NOTE: submitted_by is NEVER client-authoritative (forced via RPC from auth.uid()).
-- PAIR: 101_field_test_runs
-- ROLE: FORWARD
-- CLASSIFICATION: (a) draftable / apply-candidate

BEGIN;

CREATE TABLE IF NOT EXISTS public.field_test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_run_id uuid NOT NULL,
  task_id uuid NOT NULL REFERENCES public.tasks(id),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  grid_id uuid NULL,
  submitted_by uuid NOT NULL REFERENCES public.profiles(id),
  scenario_type text NOT NULL,
  scenario_version text NULL,
  run_status text NOT NULL DEFAULT 'submitted'
    CHECK (run_status IN (
      'draft_local',
      'submitting',
      'submitted',
      'processing',
      'ready',
      'failed',
      'partial'
    )),
  started_at_device timestamptz NULL,
  ended_at_device timestamptz NULL,
  started_at_server timestamptz NULL,
  ended_at_server timestamptz NULL,
  device_model text NULL,
  app_version text NULL,
  build_number text NULL,
  report_name text NULL,
  rf_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  gps_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  events_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  processing_status text NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending', 'processing', 'ready', 'failed')),
  latest_qc_status text NULL,
  feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT field_test_runs_client_run_id_unique UNIQUE (client_run_id),
  CONSTRAINT field_test_runs_ended_after_started CHECK (
    ended_at_device IS NULL
    OR started_at_device IS NULL
    OR ended_at_device >= started_at_device
  )
);

CREATE INDEX IF NOT EXISTS field_test_runs_task_id_idx
  ON public.field_test_runs (task_id);
CREATE INDEX IF NOT EXISTS field_test_runs_project_id_idx
  ON public.field_test_runs (project_id);
CREATE INDEX IF NOT EXISTS field_test_runs_submitted_by_idx
  ON public.field_test_runs (submitted_by);
CREATE INDEX IF NOT EXISTS field_test_runs_scenario_type_idx
  ON public.field_test_runs (scenario_type);
CREATE INDEX IF NOT EXISTS field_test_runs_latest_qc_status_idx
  ON public.field_test_runs (latest_qc_status);
CREATE INDEX IF NOT EXISTS field_test_runs_created_at_idx
  ON public.field_test_runs (created_at DESC);

COMMENT ON TABLE public.field_test_runs IS
  'F10C2 draft: unified field-test run metadata. Mutations via SECURITY DEFINER RPC only for FE.';
COMMENT ON COLUMN public.field_test_runs.client_run_id IS
  'Client idempotency UUID generated once per local run; unique globally.';
COMMENT ON COLUMN public.field_test_runs.submitted_by IS
  'Server-authoritative FE identity from auth.uid() via RPC — never trust client payload.';

COMMIT;
