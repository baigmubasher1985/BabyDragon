-- DRAFT / UNAPPLIED / DISPOSABLE-ONLY WHEN PHASE 4 GATES PASS
-- F10C2 PHASE 4
-- NO PRODUCTION TARGET AUTHORIZED
-- NOTE: Creates private result-artifacts bucket. Does not touch task-photos or operational-evidence.
-- NOTE: 112 remains documentation-only. This Phase 4 draft is the authorized bucket DDL.
-- PAIR: 114_result_artifacts_private_bucket
-- ROLE: FORWARD
-- CLASSIFICATION: (a) draftable / apply-candidate

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'result-artifacts',
  'result-artifacts',
  false,
  104857600,
  ARRAY[
    'application/json',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
    'application/octet-stream',
    'image/jpeg',
    'image/png'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "result_artifacts_fe_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "result_artifacts_fe_select_own" ON storage.objects;
DROP POLICY IF EXISTS "result_artifacts_admin_select" ON storage.objects;

CREATE POLICY "result_artifacts_fe_insert_own"
  ON storage.objects
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'result-artifacts'
    AND EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE p.id = auth.uid()
        AND p.role = 'fe'
        AND p.is_active IS TRUE
    )
    AND (storage.foldername(name))[3] = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM public.field_test_runs AS r
      WHERE r.id = ((storage.foldername(name))[4])::uuid
        AND r.submitted_by = auth.uid()
        AND public.is_assigned_to_task(r.task_id)
    )
  );

CREATE POLICY "result_artifacts_fe_select_own"
  ON storage.objects
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    bucket_id = 'result-artifacts'
    AND EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE p.id = auth.uid()
        AND p.role = 'fe'
        AND p.is_active IS TRUE
    )
    AND (storage.foldername(name))[3] = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM public.field_test_runs AS r
      WHERE r.id = ((storage.foldername(name))[4])::uuid
        AND r.submitted_by = auth.uid()
        AND public.is_assigned_to_task(r.task_id)
    )
  );

CREATE POLICY "result_artifacts_admin_select"
  ON storage.objects
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    bucket_id = 'result-artifacts'
    AND EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['admin'::text, 'super_admin'::text])
        AND p.is_active IS TRUE
    )
  );

-- Intentionally no UPDATE/DELETE (no overwrite, no anonymous access, no public bucket).

COMMIT;
