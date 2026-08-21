-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 1
-- NO DATABASE TARGET AUTHORIZED
-- PAIR: 104_field_test_qc_reviews
-- ROLE: ROLLBACK
-- NOTE: Does not touch public.qc_reviews (task-level).

BEGIN;
DROP TABLE IF EXISTS public.field_test_qc_reviews CASCADE;
COMMIT;
