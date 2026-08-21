-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: OWNER: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION
-- NOTE: Forces user_id=auth.uid(); mirrors user_email from profiles; rejects https?:// as durable photo_url.
-- NOTE: Preserves legacy photo_url column for dual-read. No invented columns.
-- PAIR: 007_rpc_insert_assigned_task_update
-- ROLE: VERIFICATION (SELECT-ONLY)

SELECT p.proname, pg_get_function_identity_arguments(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'insert_assigned_task_update';
