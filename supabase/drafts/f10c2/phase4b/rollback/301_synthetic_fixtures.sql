-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 4B-P
-- NO DATABASE TARGET AUTHORIZED
-- PAIR: 301_synthetic_fixtures
-- ROLE: ROLLBACK
-- NOTE: Deletes synthetic Phase 4B rows only (synth-f10c2 ids/slug). Never run without target guard.

BEGIN;

DELETE FROM public.field_test_qc_reviews
WHERE field_test_run_id = '00000000-0000-4000-a000-f10c20000041';

DELETE FROM public.artifact_transfer_jobs
WHERE tenant_id = '00000000-0000-4000-a000-f10c20000001';

DELETE FROM public.field_test_artifacts
WHERE run_id = '00000000-0000-4000-a000-f10c20000041';

DELETE FROM public.field_test_runs
WHERE id = '00000000-0000-4000-a000-f10c20000041';

DELETE FROM public.tenant_storage_policies
WHERE tenant_id = '00000000-0000-4000-a000-f10c20000001';

DELETE FROM public.storage_connections
WHERE tenant_id = '00000000-0000-4000-a000-f10c20000001';

DELETE FROM public.tenants
WHERE slug = 'synth-f10c2-lab'
  AND id = '00000000-0000-4000-a000-f10c20000001';

COMMIT;
