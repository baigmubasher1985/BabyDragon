-- DRAFT / UNAPPLIED / DISPOSABLE-ONLY WHEN PHASE 4 GATES PASS
-- F10C2 PHASE 4
-- NO PRODUCTION TARGET AUTHORIZED
-- PAIR: 115_field_test_execute_grants
-- ROLE: ROLLBACK
-- NOTE: Grants restoration is environment-specific; revoke authenticated execute added in forward.

REVOKE ALL ON FUNCTION public.submit_field_test_run(uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz, text, text, text, text, jsonb, jsonb, jsonb, jsonb) FROM authenticated;
REVOKE ALL ON FUNCTION public.register_field_test_artifact(uuid, uuid, text, text, bigint, text, text, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.complete_field_test_artifact_upload(uuid, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.submit_field_test_qc_review(uuid, text, text, text[], boolean, text, uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.finalize_field_test_run(uuid) FROM authenticated;
