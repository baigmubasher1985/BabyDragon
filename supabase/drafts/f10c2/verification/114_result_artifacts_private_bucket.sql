-- DRAFT / UNAPPLIED / SELECT-ONLY VERIFICATION
-- F10C2 PHASE 4
-- PAIR: 114_result_artifacts_private_bucket
-- ROLE: VERIFICATION

SELECT id, name, public
FROM storage.buckets
WHERE id = 'result-artifacts';

SELECT polname, polcmd
FROM pg_policy
JOIN pg_class c ON c.oid = pg_policy.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'storage'
  AND c.relname = 'objects'
  AND polname LIKE 'result_artifacts_%';
