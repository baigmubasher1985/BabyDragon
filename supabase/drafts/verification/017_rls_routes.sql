-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: Replace broad policies on routes in one transaction; never leave USING (true) beside scoped policy.
-- PAIR: 017_rls_routes
-- ROLE: VERIFICATION (SELECT-ONLY)

-- SELECT-only
SELECT c.relname, pol.polname, pol.polcmd,
       pg_get_expr(pol.polqual, pol.polrelid) AS using_expr
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('routes')
ORDER BY c.relname, pol.polname;
