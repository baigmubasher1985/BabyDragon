-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: New table — proposed columns (not from live capture).
-- NOTE: Append-only; no authenticated INSERT/UPDATE/DELETE policies.
-- PAIR: 001_security_audit_log
-- ROLE: VERIFICATION (SELECT-ONLY)

SELECT c.relname, c.relrowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'security_audit_log';
SELECT pol.polname, pol.polcmd FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'security_audit_log';
