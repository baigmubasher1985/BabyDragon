-- DRAFT / DISPOSABLE CR1-B
-- F10C2 CR1-B CANONICAL INGESTION SCHEMA
-- PAIR: 210_cr1b_canonical_ingestion_schema
-- ROLE: FORWARD
-- CLASSIFICATION: additive after 209
-- NOTE: No database drops, table drops, or truncates. No public/anon grants. No production refs.
-- NOTE: Missing measurements remain NULL. Never coerce to zero.

BEGIN;

ALTER TABLE public.field_test_runs
  ADD COLUMN IF NOT EXISTS package_identity text NULL,
  ADD COLUMN IF NOT EXISTS idempotency_key text NULL,
  ADD COLUMN IF NOT EXISTS client_package_identity jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS requested_iterations integer NULL,
  ADD COLUMN IF NOT EXISTS attempted_iterations integer NULL,
  ADD COLUMN IF NOT EXISTS completed_iterations integer NULL,
  ADD COLUMN IF NOT EXISTS failed_iterations integer NULL,
  ADD COLUMN IF NOT EXISTS upload_state text NULL,
  ADD COLUMN IF NOT EXISTS upload_started_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS upload_completed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS incomplete_reason text NULL,
  ADD COLUMN IF NOT EXISTS failure_reason text NULL,
  ADD COLUMN IF NOT EXISTS acceptance_verdict text NULL
    CHECK (acceptance_verdict IS NULL OR acceptance_verdict IN (
      'PASS', 'FAIL', 'INCOMPLETE', 'NOT_EVALUATED'
    ));

CREATE UNIQUE INDEX IF NOT EXISTS field_test_runs_idempotency_key_unique
  ON public.field_test_runs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS field_test_runs_package_identity_idx
  ON public.field_test_runs (package_identity);

CREATE INDEX IF NOT EXISTS field_test_runs_acceptance_verdict_idx
  ON public.field_test_runs (acceptance_verdict);

CREATE TABLE IF NOT EXISTS public.field_test_iterations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.field_test_runs(id) ON DELETE CASCADE,
  iteration_number integer NOT NULL,
  scenario_kind text NULL,
  started_at timestamptz NULL,
  ended_at timestamptz NULL,
  status text NOT NULL DEFAULT 'incomplete'
    CHECK (status IN ('completed', 'failed', 'incomplete', 'not_attempted')),
  execution_failed boolean NOT NULL DEFAULT false,
  dl_mbps double precision NULL,
  ul_mbps double precision NULL,
  http_latency_ms double precision NULL,
  failure_reason text NULL,
  incomplete_reason text NULL,
  raw_measurement jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT field_test_iterations_run_number_kind UNIQUE (run_id, iteration_number, scenario_kind)
);

CREATE INDEX IF NOT EXISTS field_test_iterations_run_id_idx
  ON public.field_test_iterations (run_id);

COMMENT ON COLUMN public.field_test_iterations.dl_mbps IS
  'Persisted DL Mbps. NULL means missing/failed measurement — never store coerced zero.';
COMMENT ON COLUMN public.field_test_iterations.ul_mbps IS
  'Persisted UL Mbps. NULL means missing/failed measurement — never store coerced zero.';

CREATE TABLE IF NOT EXISTS public.field_test_call_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.field_test_runs(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('MO', 'MT')),
  event_type text NOT NULL,
  occurred_at timestamptz NULL,
  labeled_synthetic boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS field_test_call_events_run_id_idx
  ON public.field_test_call_events (run_id);

COMMENT ON TABLE public.field_test_call_events IS
  'Immutable persisted MO/MT call events. Counts must not use editable FE summary fields.';

COMMIT;
