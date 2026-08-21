-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: BLOCKED: removal of direct FE UPDATE until RPC client cutover validated.
-- NOTE: After cutover: FE SELECT assigned; Admin ALL; FE mutations via update_assigned_task_status only.
-- PAIR: 010_rls_tasks
-- ROLE: VERIFICATION (SELECT-ONLY)

-- SELECT-only
SELECT c.relname, pol.polname, pol.polcmd,
       pg_get_expr(pol.polqual, pol.polrelid) AS using_expr
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('tasks')
ORDER BY c.relname, pol.polname;
