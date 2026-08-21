-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: qc_reviews fail-closed via is_admin_or_super_admin() — draftable apply-candidate portion.
-- NOTE: STORAGE WRITE PATH: BLOCKED_PENDING_SCHEMA_AND_DISPOSABLE_VALIDATION — no bucket DDL; no column invention.
-- NOTE: Live task_updates has photo_url only — object_key text in photo_url alone does NOT complete durable contract.
-- NOTE: Durable needs BOTH bucket=operational-evidence AND object_key=project/task/user/artifact.ext (separate fields).
-- PAIR: 020_operational_evidence_schema_contract
-- ROLE: FORWARD
-- CLASSIFICATION: mixed — qc_reviews apply-candidate; storage blocked_documentation_only

-- ---------------------------------------------------------------------------
-- (a) draftable / apply-candidate: qc_reviews policy replacement
-- ---------------------------------------------------------------------------
BEGIN;
DROP POLICY IF EXISTS "Admins can delete QC reviews" ON public.qc_reviews;
DROP POLICY IF EXISTS "Admins can insert QC reviews" ON public.qc_reviews;
DROP POLICY IF EXISTS "Admins can update QC reviews" ON public.qc_reviews;
DROP POLICY IF EXISTS "Admins can view QC reviews" ON public.qc_reviews;
CREATE POLICY "qc_reviews_admin_all" ON public.qc_reviews AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_admin_or_super_admin()) WITH CHECK (public.is_admin_or_super_admin());
COMMIT;

-- ---------------------------------------------------------------------------
-- (b) BLOCKED_PENDING_SCHEMA_AND_DISPOSABLE_VALIDATION — documentation only
-- Operational evidence write remains blocked. No CREATE/ALTER on storage or
-- task_updates. No result-artifacts. No F10C2 RF persistence.
-- ---------------------------------------------------------------------------
SELECT 'operational_evidence_write_blocked_pending_schema_and_disposable_validation' AS status;

-- STORAGE CONTRACT (comments only — no bucket DDL):
-- bucket name: operational-evidence (create only in disposable when separately authorized)
-- object_key: {project_id}/{task_id}/{verified_user_id}/{artifact_id}.{safe_extension}
-- NO bucket prefix inside object_key
-- MIME: image/jpeg, image/png; max 15 MB; no overwrite by default
-- Durable DB ref REQUIRES both: bucket AND object_key columns (or equivalent pair)
-- Live captured schema: task_updates.photo_url only — storing object_key text in photo_url
--   does NOT satisfy the durable pair contract; dual-read of legacy public URLs preserved
-- FUTURE SCHEMA DECISION REQUIRED (do not invent/apply here):
--   Add explicit bucket + object_key (and checksum) columns on the operational evidence
--   persistence surface, OR a dedicated evidence table — choice deferred to disposable design.
-- Legacy: keep task-photos dual-read; do not touch existing objects
-- Results: future distinct result-artifacts bucket (F10C2) — NOT created here
