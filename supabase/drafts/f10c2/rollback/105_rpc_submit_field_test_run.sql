-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 1
-- NO DATABASE TARGET AUTHORIZED
-- PAIR: 105_rpc_submit_field_test_run
-- ROLE: ROLLBACK

DROP FUNCTION IF EXISTS public.submit_field_test_run(
  uuid, uuid, uuid, uuid, text, text, text,
  timestamptz, timestamptz, text, text, text, text,
  jsonb, jsonb, jsonb, jsonb
);
