-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: OWNER: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION
-- NOTE: Forces reported_by=auth.uid(), status=open. Columns from F10C1P-R2 app evidence.
-- PAIR: 006_rpc_insert_assigned_task_issue
-- ROLE: ROLLBACK

DROP FUNCTION IF EXISTS public.insert_assigned_task_issue(uuid, text, text, text, double precision, double precision);
