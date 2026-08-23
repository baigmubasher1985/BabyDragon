-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 4B-P
-- NO DATABASE TARGET AUTHORIZED
-- ROLE: PREFLIGHT (SELECT-only when later authorized)
-- NOTE: Does not create operational tables. F10C1I 001–020 assume they already exist.

SELECT
  c.relname AS relation
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'profiles',
    'tasks',
    'projects',
    'grids',
    'task_grids',
    'task_updates',
    'task_checklist_items',
    'task_issue_reports',
    'routes',
    'route_grids',
    'qc_reviews'
  )
ORDER BY 1;
