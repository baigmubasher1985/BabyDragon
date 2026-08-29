-- PAIR: 210_cr1b_canonical_ingestion_schema
-- ROLE: ROLLBACK
-- NOTE: Drops only CR1-B ingestion tables/columns. Does not drop field_test_runs.

BEGIN;

DROP TABLE IF EXISTS public.field_test_call_events;
DROP TABLE IF EXISTS public.field_test_iterations;

DROP INDEX IF EXISTS public.field_test_runs_idempotency_key_unique;
DROP INDEX IF EXISTS public.field_test_runs_package_identity_idx;
DROP INDEX IF EXISTS public.field_test_runs_acceptance_verdict_idx;

ALTER TABLE public.field_test_runs
  DROP COLUMN IF EXISTS package_identity,
  DROP COLUMN IF EXISTS idempotency_key,
  DROP COLUMN IF EXISTS client_package_identity,
  DROP COLUMN IF EXISTS requested_iterations,
  DROP COLUMN IF EXISTS attempted_iterations,
  DROP COLUMN IF EXISTS completed_iterations,
  DROP COLUMN IF EXISTS failed_iterations,
  DROP COLUMN IF EXISTS upload_state,
  DROP COLUMN IF EXISTS upload_started_at,
  DROP COLUMN IF EXISTS upload_completed_at,
  DROP COLUMN IF EXISTS incomplete_reason,
  DROP COLUMN IF EXISTS failure_reason,
  DROP COLUMN IF EXISTS acceptance_verdict;

COMMIT;
