-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 1
-- NO DATABASE TARGET AUTHORIZED
-- PAIR: 111_rls_field_test_qc_reviews
-- ROLE: ROLLBACK

BEGIN;
DROP POLICY IF EXISTS "field_test_qc_reviews_admin_select" ON public.field_test_qc_reviews;
DROP POLICY IF EXISTS "field_test_qc_reviews_fe_select_own_runs" ON public.field_test_qc_reviews;
COMMIT;
