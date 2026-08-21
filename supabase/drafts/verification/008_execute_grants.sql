-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: REVOKE PUBLIC/anon; GRANT authenticated. Baseline ACLs from 01a.
-- PAIR: 008_execute_grants
-- ROLE: VERIFICATION (SELECT-ONLY)

SELECT p.proname, COALESCE(p.proacl::text, '') AS acl
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'is_admin_or_super_admin','get_field_engineers','get_grids_geojson','set_qc_reviews_updated_at',
    'is_super_admin','is_assigned_to_task','update_assigned_task_status',
    'update_assigned_checklist_item','insert_assigned_task_issue','insert_assigned_task_update'
  )
ORDER BY p.proname;
