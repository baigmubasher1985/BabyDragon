-- =============================================================================
-- DISPOSABLE ONLY — verification (SELECT-only)
-- F10C2 PHASE 4B-S — 000_disposable_operational_schema.verify.sql
-- DRAFT / UNAPPLIED / DO NOT RUN IN PHASE 4B-S
-- Requires the same dual guard as the bootstrap (JS target guard + SET LOCAL).
-- Creates nothing. Inserts nothing. Drops nothing.
-- =============================================================================

DO $guard$
BEGIN
  IF current_setting('app.f10c2_disposable_confirmed', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION
      'DISPOSABLE ONLY: verification requires app.f10c2_disposable_confirmed=yes';
  END IF;
END
$guard$;

SELECT c.relname AS relation,
       c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'profiles',
    'projects',
    'grids',
    'tasks',
    'task_updates',
    'task_grids',
    'routes',
    'route_grids',
    'cell_files',
    'cell_sites',
    'cell_sectors',
    'task_checklist_items',
    'task_issue_reports',
    'qc_reviews'
  )
ORDER BY 1;

SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'profiles',
    'projects',
    'grids',
    'tasks',
    'task_updates',
    'task_grids',
    'routes',
    'route_grids',
    'cell_files',
    'cell_sites',
    'cell_sectors',
    'task_checklist_items',
    'task_issue_reports',
    'qc_reviews'
  )
ORDER BY table_name, ordinal_position;

SELECT
  (SELECT COUNT(*) = 0 FROM public.profiles) AS profiles_empty,
  (SELECT COUNT(*) = 0 FROM public.projects) AS projects_empty,
  (SELECT COUNT(*) = 0 FROM public.grids) AS grids_empty,
  (SELECT COUNT(*) = 0 FROM public.tasks) AS tasks_empty,
  (SELECT COUNT(*) = 0 FROM public.qc_reviews) AS qc_reviews_empty;
