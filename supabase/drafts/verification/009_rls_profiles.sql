-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: BLOCKED: privileged profile UPDATE cutover until Edge + Admin client cutover validated.
-- NOTE: Do not remove Admin UPDATE or self UPDATE of role/is_active/email until paired cutover.
-- PAIR: 009_rls_profiles
-- ROLE: VERIFICATION (SELECT-ONLY)

-- SELECT-only
SELECT c.relname, pol.polname, pol.polcmd,
       pg_get_expr(pol.polqual, pol.polrelid) AS using_expr
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('profiles')
ORDER BY c.relname, pol.polname;
