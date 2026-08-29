-- PAIR: 211_cr1b_acceptance_engine_schema
-- ROLE: ROLLBACK

BEGIN;

DROP TABLE IF EXISTS public.qc_verdict_overrides;
DROP TABLE IF EXISTS public.field_test_call_summaries;
DROP TABLE IF EXISTS public.field_test_iteration_evaluations;
DROP TABLE IF EXISTS public.field_test_run_acceptance_snapshots;
DROP TABLE IF EXISTS public.acceptance_rules;
DROP TABLE IF EXISTS public.acceptance_profiles;

COMMIT;
