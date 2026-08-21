-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 1
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: Artifact metadata only. Durable ref = bucket + object_key. NEVER signed URL.
-- PAIR: 102_field_test_artifacts
-- ROLE: FORWARD
-- CLASSIFICATION: (a) draftable / apply-candidate

BEGIN;

CREATE TABLE IF NOT EXISTS public.field_test_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.field_test_runs(id) ON DELETE CASCADE,
  artifact_type text NOT NULL
    CHECK (artifact_type IN (
      'unified_json',
      'rf_csv',
      'gps_csv',
      'events_csv',
      'scenario_csv',
      'excel_plot',
      'ookla_evidence',
      'fcc_evidence',
      'package_zip',
      'other'
    )),
  bucket text NOT NULL DEFAULT 'result-artifacts',
  object_key text NOT NULL,
  original_file_name text NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  checksum text NOT NULL,
  upload_status text NOT NULL DEFAULT 'pending'
    CHECK (upload_status IN ('pending', 'uploading', 'complete', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT field_test_artifacts_object_key_unique UNIQUE (bucket, object_key),
  CONSTRAINT field_test_artifacts_checksum_identity UNIQUE (run_id, artifact_type, checksum),
  CONSTRAINT field_test_artifacts_no_http_object_key CHECK (object_key !~* '^https?://'),
  CONSTRAINT field_test_artifacts_bucket_not_legacy CHECK (
    bucket = 'result-artifacts'
    AND bucket IS DISTINCT FROM 'task-photos'
    AND bucket IS DISTINCT FROM 'operational-evidence'
  )
);

CREATE INDEX IF NOT EXISTS field_test_artifacts_run_id_idx
  ON public.field_test_artifacts (run_id);
CREATE INDEX IF NOT EXISTS field_test_artifacts_upload_status_idx
  ON public.field_test_artifacts (upload_status);

COMMENT ON TABLE public.field_test_artifacts IS
  'F10C2 draft: private result artifact refs. bucket and object_key are separate durable fields.';
COMMENT ON COLUMN public.field_test_artifacts.object_key IS
  '{project_id}/{task_id}/{verified_user_id}/{field_test_run_id}/{artifact_id}.{safe_ext}';

COMMIT;
