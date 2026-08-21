-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: Does NOT create operational-evidence or result-artifacts buckets.
-- NOTE: Does NOT mutate task-photos objects.
-- NOTE: object_key MUST NOT include bucket prefix: {project_id}/{task_id}/{verified_user_id}/{artifact_id}.{ext}
-- NOTE: qc_reviews: fail-closed is_active IS TRUE via is_admin_or_super_admin().
-- NOTE: BLOCKED: inventing new task_updates columns — preserve legacy photo_url dual-read.
-- PAIR: 020_operational_evidence_schema_contract
-- ROLE: VERIFICATION (SELECT-ONLY)

-- SELECT-only
SELECT c.relname, pol.polname, pol.polcmd,
       pg_get_expr(pol.polqual, pol.polrelid) AS using_expr
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('qc_reviews')
ORDER BY c.relname, pol.polname;

-- Confirm no unexpected Storage buckets named in this draft (run only when authorized):
-- SELECT id, name, public FROM storage.buckets;
-- Expected live baseline from 06_storage_buckets_exact.csv: task-photos only.
