-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: FE read-only for assigned map context; Adm write. Do not invent FK columns.
-- PAIR: 019_rls_cell_files_sites_sectors
-- ROLE: VERIFICATION (SELECT-ONLY)

-- SELECT-only
SELECT c.relname, pol.polname, pol.polcmd,
       pg_get_expr(pol.polqual, pol.polrelid) AS using_expr
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('cell_files', 'cell_sites', 'cell_sectors')
ORDER BY c.relname, pol.polname;
