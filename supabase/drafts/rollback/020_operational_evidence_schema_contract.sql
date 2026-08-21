-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: Rollback reverses qc_reviews apply-candidate only (transactional).
-- NOTE: Storage portion was blocked/no-op forward → no storage rollback action.
-- NOTE: Restored expressions from 02a capture; verify exactness on disposable before claiming exact.
-- PAIR: 020_operational_evidence_schema_contract
-- ROLE: ROLLBACK
-- CLASSIFICATION: mixed — qc_reviews rollback; storage no-op

BEGIN;
DROP POLICY IF EXISTS "Admins can delete QC reviews" ON public.qc_reviews;
DROP POLICY IF EXISTS "Admins can insert QC reviews" ON public.qc_reviews;
DROP POLICY IF EXISTS "Admins can update QC reviews" ON public.qc_reviews;
DROP POLICY IF EXISTS "Admins can view QC reviews" ON public.qc_reviews;
DROP POLICY IF EXISTS "qc_reviews_admin_all" ON public.qc_reviews;
CREATE POLICY "Admins can delete QC reviews" ON public.qc_reviews AS PERMISSIVE FOR DELETE TO public USING ((EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))))));
CREATE POLICY "Admins can insert QC reviews" ON public.qc_reviews AS PERMISSIVE FOR INSERT TO public WITH CHECK ((EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))))));
CREATE POLICY "Admins can update QC reviews" ON public.qc_reviews AS PERMISSIVE FOR UPDATE TO public USING ((EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::text, 'super_admin'::text])))))) WITH CHECK ((EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))))));
CREATE POLICY "Admins can view QC reviews" ON public.qc_reviews AS PERMISSIVE FOR SELECT TO public USING ((EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::text, 'super_admin'::text]))))));
COMMIT;

SELECT 'operational_evidence_storage_rollback_noop_forward_was_blocked' AS status;
