-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: New table — proposed columns (not from live capture).
-- NOTE: Append-only; no authenticated INSERT/UPDATE/DELETE policies.
-- PAIR: 001_security_audit_log
-- ROLE: ROLLBACK

DROP POLICY IF EXISTS "security_audit_log_sa_select" ON public.security_audit_log;
DROP TABLE IF EXISTS public.security_audit_log;
