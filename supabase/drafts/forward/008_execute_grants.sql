-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: REVOKE PUBLIC/anon; GRANT authenticated. Baseline ACLs from 01a.
-- PAIR: 008_execute_grants
-- ROLE: FORWARD

REVOKE ALL ON FUNCTION public.is_admin_or_super_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin_or_super_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_admin_or_super_admin() TO authenticated;

REVOKE ALL ON FUNCTION public.get_field_engineers() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_field_engineers() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_field_engineers() TO authenticated;

REVOKE ALL ON FUNCTION public.get_grids_geojson() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_grids_geojson() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_grids_geojson() TO authenticated;

REVOKE ALL ON FUNCTION public.set_qc_reviews_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_qc_reviews_updated_at() FROM anon;

REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_super_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

REVOKE ALL ON FUNCTION public.is_assigned_to_task(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_assigned_to_task(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_assigned_to_task(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.update_assigned_task_status(uuid, text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_assigned_task_status(uuid, text, timestamptz, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_assigned_task_status(uuid, text, timestamptz, timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.update_assigned_checklist_item(uuid, boolean, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_assigned_checklist_item(uuid, boolean, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_assigned_checklist_item(uuid, boolean, timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.insert_assigned_task_issue(uuid, text, text, text, double precision, double precision) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.insert_assigned_task_issue(uuid, text, text, text, double precision, double precision) FROM anon;
GRANT EXECUTE ON FUNCTION public.insert_assigned_task_issue(uuid, text, text, text, double precision, double precision) TO authenticated;

REVOKE ALL ON FUNCTION public.insert_assigned_task_update(uuid, text, text, double precision, double precision) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.insert_assigned_task_update(uuid, text, text, double precision, double precision) FROM anon;
GRANT EXECUTE ON FUNCTION public.insert_assigned_task_update(uuid, text, text, double precision, double precision) TO authenticated;
