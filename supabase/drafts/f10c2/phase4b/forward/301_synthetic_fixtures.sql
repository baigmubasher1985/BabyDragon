-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 4B-P SYNTHETIC FIXTURES
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: Template only. Placeholders are intentionally invalid until an operator
-- NOTE: substitutes disposable Auth/user/task ids. This file cannot run as-is.
-- NOTE: Do not copy production UUIDs, emails, customer names, or live coordinates.
-- PAIR: 301_synthetic_fixtures
-- ROLE: FORWARD
-- CLASSIFICATION: synthetic fixture (not a schema migration)

-- Required substitutions (disposable Auth + operational rows created by the operator):
--   __FE_USER_ID__ __ADMIN_USER_ID__ __SA_USER_ID__
--   __PROJECT_ID__ __TASK_ID__ __REDRIVE_TASK_ID__
-- Synthetic labels to use when creating those operational rows:
--   project name: SYNTHETIC F10C2 Validation Project
--   task title: SYNTHETIC F10C2 Validation Task
--   re-drive task title: SYNTHETIC F10C2 Re-drive Task
--   FE email: fe.synthetic.f10c2@invalid.test
--   admin email: admin.synthetic.f10c2@invalid.test
--   super_admin email: sa.synthetic.f10c2@invalid.test
--   market: SYNTH-LAB
--   GPS note: SYNTHETIC non-operational 89.125,179.125

BEGIN;

INSERT INTO public.tenants (
  id, slug, display_name, residency_region, deployment_mode, is_active
) VALUES (
  '00000000-0000-4000-a000-f10c20000001',
  'synth-f10c2-lab',
  'SYNTHETIC F10C2 Lab Tenant',
  'synth-region',
  'mobbitech_saas',
  true
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.storage_connections (
  id, tenant_id, provider_type, display_name, bucket_or_container,
  authentication_mode, secret_reference, is_default, is_active
) VALUES (
  '00000000-0000-4000-a000-f10c20000011',
  '00000000-0000-4000-a000-f10c20000001',
  'supabase',
  'SYNTHETIC Disposable Result Artifacts',
  'result-artifacts',
  'server_secret_reference',
  'k8s:secret/synth-f10c2-result-artifacts',
  true,
  true
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tenant_storage_policies (
  tenant_id, artifact_type, storage_connection_id, upload_mode, processing_location
) VALUES
  ('00000000-0000-4000-a000-f10c20000001', 'rf_csv', '00000000-0000-4000-a000-f10c20000011', 'direct_scoped', 'mobbi_cloud'),
  ('00000000-0000-4000-a000-f10c20000001', 'gps_csv', '00000000-0000-4000-a000-f10c20000011', 'direct_scoped', 'mobbi_cloud'),
  ('00000000-0000-4000-a000-f10c20000001', 'unified_json', '00000000-0000-4000-a000-f10c20000011', 'direct_scoped', 'mobbi_cloud')
ON CONFLICT (tenant_id, artifact_type) DO NOTHING;

INSERT INTO public.field_test_runs (
  id, client_run_id, task_id, project_id, submitted_by, scenario_type,
  run_status, report_name, rf_summary, data_summary, gps_summary,
  tenant_id
) VALUES (
  '00000000-0000-4000-a000-f10c20000041',
  '00000000-0000-4000-a000-f10c20000042',
  '__TASK_ID__'::uuid,
  '__PROJECT_ID__'::uuid,
  '__FE_USER_ID__'::uuid,
  'native_http',
  'ready',
  'SYNTHETIC_F10C2_Unified_Result',
  '{"notes":"SYNTHETIC RF metadata — not a live drive","sample_count":3}'::jsonb,
  '{"field_status":"SYNTHETIC native HTTP pass","notes":"synthetic data-test metadata"}'::jsonb,
  '{"notes":"SYNTHETIC route — coordinates 89.125,179.125 are non-operational"}'::jsonb,
  '00000000-0000-4000-a000-f10c20000001'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.field_test_artifacts (
  id, run_id, artifact_type, bucket, object_key, mime_type, size_bytes, checksum,
  upload_status, original_file_name, tenant_id, storage_connection_id
) VALUES
(
  '00000000-0000-4000-a000-f10c20000051',
  '00000000-0000-4000-a000-f10c20000041',
  'rf_csv',
  'result-artifacts',
  'synth-f10c2-lab/00000000-0000-4000-a000-f10c20000041/00000000-0000-4000-a000-f10c20000051.csv',
  'text/csv',
  128,
  'sha256:syntheticf10c2rfcsvchecksum0001',
  'complete',
  'SYNTHETIC_rf.csv',
  '00000000-0000-4000-a000-f10c20000001',
  '00000000-0000-4000-a000-f10c20000011'
),
(
  '00000000-0000-4000-a000-f10c20000052',
  '00000000-0000-4000-a000-f10c20000041',
  'gps_csv',
  'result-artifacts',
  'synth-f10c2-lab/00000000-0000-4000-a000-f10c20000041/00000000-0000-4000-a000-f10c20000052.csv',
  'text/csv',
  96,
  'sha256:syntheticf10c2gpscsvchecksum0001',
  'complete',
  'SYNTHETIC_gps.csv',
  '00000000-0000-4000-a000-f10c20000001',
  '00000000-0000-4000-a000-f10c20000011'
),
(
  '00000000-0000-4000-a000-f10c20000053',
  '00000000-0000-4000-a000-f10c20000041',
  'unified_json',
  'result-artifacts',
  'synth-f10c2-lab/00000000-0000-4000-a000-f10c20000041/00000000-0000-4000-a000-f10c20000053.json',
  'application/json',
  256,
  'sha256:syntheticf10c2unifiedjsonchecksum01',
  'complete',
  'SYNTHETIC_report.json',
  '00000000-0000-4000-a000-f10c20000001',
  '00000000-0000-4000-a000-f10c20000011'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.artifact_transfer_jobs (
  tenant_id, artifact_id, operation, idempotency_key, source, destination, state
) VALUES (
  '00000000-0000-4000-a000-f10c20000001',
  '00000000-0000-4000-a000-f10c20000051',
  'request_artifact_upload_plan',
  'synth-f10c2:00000000-0000-4000-a000-f10c20000051:request_artifact_upload_plan',
  'mobile_session_upload',
  'result-artifacts',
  'completed'
)
ON CONFLICT (tenant_id, idempotency_key) DO NOTHING;

INSERT INTO public.field_test_qc_reviews (
  field_test_run_id, task_id, reviewer_id, qc_decision, qc_notes,
  redrive_needed, redrive_reason, redrive_task_id
) VALUES (
  '00000000-0000-4000-a000-f10c20000041',
  '__TASK_ID__'::uuid,
  '__ADMIN_USER_ID__'::uuid,
  'Needs Re-drive',
  'SYNTHETIC QC: evidence present; re-drive requested for validation path only',
  true,
  'SYNTHETIC re-drive scenario for Phase 4B',
  '__REDRIVE_TASK_ID__'::uuid
)
ON CONFLICT (field_test_run_id) DO NOTHING;

COMMIT;
