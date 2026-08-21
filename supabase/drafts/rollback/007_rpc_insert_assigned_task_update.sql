-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: OWNER: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION
-- NOTE: Forces user_id=auth.uid(); mirrors user_email from profiles; rejects https?:// as durable photo_url.
-- NOTE: Preserves legacy photo_url column for dual-read. No invented columns.
-- PAIR: 007_rpc_insert_assigned_task_update
-- ROLE: ROLLBACK

DROP FUNCTION IF EXISTS public.insert_assigned_task_update(uuid, text, text, double precision, double precision);
