-- DRAFT / UNAPPLIED / DISPOSABLE-ONLY WHEN PHASE 4 GATES PASS
-- F10C2 PHASE 4
-- NO PRODUCTION TARGET AUTHORIZED
-- NOTE: REVOKE PUBLIC/anon EXECUTE on F10C2 result RPCs; GRANT authenticated.
-- PAIR: 115_field_test_execute_grants
-- ROLE: FORWARD
-- CLASSIFICATION: (a) draftable / apply-candidate

REVOKE ALL ON FUNCTION public.submit_field_test_run(uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz, text, text, text, text, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_field_test_run(uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz, text, text, text, text, jsonb, jsonb, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_field_test_run(uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz, text, text, text, text, jsonb, jsonb, jsonb, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.register_field_test_artifact(uuid, uuid, text, text, bigint, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_field_test_artifact(uuid, uuid, text, text, bigint, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.register_field_test_artifact(uuid, uuid, text, text, bigint, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.complete_field_test_artifact_upload(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_field_test_artifact_upload(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_field_test_artifact_upload(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.submit_field_test_qc_review(uuid, text, text, text[], boolean, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_field_test_qc_review(uuid, text, text, text[], boolean, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_field_test_qc_review(uuid, text, text, text[], boolean, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.finalize_field_test_run(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_field_test_run(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.finalize_field_test_run(uuid) TO authenticated;
