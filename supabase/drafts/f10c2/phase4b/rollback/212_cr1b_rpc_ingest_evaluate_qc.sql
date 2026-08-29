-- PAIR: 212_cr1b_rpc_ingest_evaluate_qc
-- ROLE: ROLLBACK

DROP FUNCTION IF EXISTS public.override_field_test_acceptance_verdict(uuid, text, text);
DROP FUNCTION IF EXISTS public.upsert_acceptance_profile(text, uuid, uuid, text, boolean, jsonb);
DROP FUNCTION IF EXISTS public.ingest_field_test_canonical_result(uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.evaluate_field_test_run_acceptance(uuid);
DROP FUNCTION IF EXISTS public.cr1b_resolve_acceptance_profile(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.cr1b_compare_threshold(double precision, double precision);
DROP FUNCTION IF EXISTS public.cr1b_combine_verdicts(text, text, text);
