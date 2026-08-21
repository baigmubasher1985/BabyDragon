-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: REVOKE PUBLIC/anon; GRANT authenticated. Baseline ACLs from 01a.
-- PAIR: 008_execute_grants
-- ROLE: ROLLBACK

GRANT EXECUTE ON FUNCTION public.is_admin_or_super_admin() TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_field_engineers() TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_grids_geojson() TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_qc_reviews_updated_at() TO PUBLIC, anon, authenticated, service_role;
