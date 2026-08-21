-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 1
-- NO DATABASE TARGET AUTHORIZED
-- PAIR: 106_rpc_register_field_test_artifact
-- ROLE: ROLLBACK

DROP FUNCTION IF EXISTS public.register_field_test_artifact(
  uuid, uuid, text, text, bigint, text, text, text
);
