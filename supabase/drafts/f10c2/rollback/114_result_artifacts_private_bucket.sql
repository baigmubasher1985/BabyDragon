-- DRAFT / UNAPPLIED / DISPOSABLE-ONLY WHEN PHASE 4 GATES PASS
-- F10C2 PHASE 4
-- NO PRODUCTION TARGET AUTHORIZED
-- PAIR: 114_result_artifacts_private_bucket
-- ROLE: ROLLBACK
-- NOTE: Drops Phase 4 storage policies and the result-artifacts bucket row.
-- NOTE: Does not delete objects in task-photos or operational-evidence.

BEGIN;

DROP POLICY IF EXISTS "result_artifacts_fe_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "result_artifacts_fe_select_own" ON storage.objects;
DROP POLICY IF EXISTS "result_artifacts_admin_select" ON storage.objects;

DELETE FROM storage.buckets WHERE id = 'result-artifacts';

COMMIT;
