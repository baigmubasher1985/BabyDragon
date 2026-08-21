-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 1
-- NO DATABASE TARGET AUTHORIZED
-- PAIR: 108_rpc_submit_field_test_qc_review
-- ROLE: ROLLBACK

DROP FUNCTION IF EXISTS public.submit_field_test_qc_review(
  uuid, text, text, text[], boolean, text, uuid
);
