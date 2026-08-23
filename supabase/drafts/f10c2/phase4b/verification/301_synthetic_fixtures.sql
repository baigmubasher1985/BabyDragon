-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 4B-P
-- NO DATABASE TARGET AUTHORIZED
-- PAIR: 301_synthetic_fixtures
-- ROLE: VERIFICATION
-- NOTE: SELECT-only. Run only after target guard on the disposable project.

SELECT slug, is_active
FROM public.tenants
WHERE slug = 'synth-f10c2-lab';

SELECT provider_type, bucket_or_container, is_default
FROM public.storage_connections
WHERE id = '00000000-0000-4000-a000-f10c20000011';

SELECT report_name, scenario_type, tenant_id
FROM public.field_test_runs
WHERE id = '00000000-0000-4000-a000-f10c20000041';

SELECT artifact_type, bucket, upload_status
FROM public.field_test_artifacts
WHERE run_id = '00000000-0000-4000-a000-f10c20000041'
ORDER BY artifact_type;

SELECT qc_decision, redrive_needed
FROM public.field_test_qc_reviews
WHERE field_test_run_id = '00000000-0000-4000-a000-f10c20000041';
