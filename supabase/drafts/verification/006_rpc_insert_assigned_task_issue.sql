-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: OWNER: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION
-- NOTE: Forces reported_by=auth.uid(), status=open. Columns from F10C1P-R2 app evidence.
-- PAIR: 006_rpc_insert_assigned_task_issue
-- ROLE: VERIFICATION (SELECT-ONLY)

SELECT p.proname, pg_get_function_identity_arguments(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'insert_assigned_task_issue';
