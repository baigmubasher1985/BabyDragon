-- =============================================================================
-- PERMANENT STAGING — rollback / cleanup listing
-- F10C2 CR1-E — 000_permanent_staging_operational_schema.rollback.sql
--
-- Recovery only. The apply wrapper never auto-runs this file.
-- Requires a separate cleanup GUC (not an environment identity marker):
--   SET LOCAL app.f10c2_permanent_staging_cleanup_confirmed = 'yes';
-- Aborts if app.f10c2_disposable_confirmed is yes (wrong environment).
-- Does NOT invent or require app.f10c2_staging_confirmed.
--
-- Exact objects this file would remove (no CASCADE):
--   TABLE public.qc_reviews
--   TABLE public.task_issue_reports
--   TABLE public.task_checklist_items
--   TABLE public.cell_sectors
--   TABLE public.cell_sites
--   TABLE public.cell_files
--   TABLE public.route_grids
--   TABLE public.routes
--   TABLE public.task_grids
--   TABLE public.task_updates
--   TABLE public.tasks
--   TABLE public.grids
--   TABLE public.projects
--   TABLE public.profiles
-- Indexes and table-level grants/RLS flags are removed with those tables.
-- Does NOT drop extension pgcrypto.
-- Does NOT drop auth.users or any Auth identities.
-- Does NOT drop F10C1I / F10C2 / Phase 4A objects (101+, 201+). If those
-- exist, dropping these relations will fail while dependents remain — that
-- is intentional.
-- Forbidden: truncates, cascading deletes, dropping the database,
-- production identifiers, disposable cleanup GUC as a substitute.
-- =============================================================================

DO $guard$
BEGIN
  IF current_setting('app.f10c2_disposable_confirmed', true) IS NOT DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION
      'PERMANENT STAGING: rollback refused because app.f10c2_disposable_confirmed is yes';
  END IF;
  IF current_setting('app.f10c2_permanent_staging_cleanup_confirmed', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION
      'PERMANENT STAGING: rollback requires a separate app.f10c2_permanent_staging_cleanup_confirmed=yes marker';
  END IF;
END
$guard$;

DROP TABLE IF EXISTS public.qc_reviews;
DROP TABLE IF EXISTS public.task_issue_reports;
DROP TABLE IF EXISTS public.task_checklist_items;
DROP TABLE IF EXISTS public.cell_sectors;
DROP TABLE IF EXISTS public.cell_sites;
DROP TABLE IF EXISTS public.cell_files;
DROP TABLE IF EXISTS public.route_grids;
DROP TABLE IF EXISTS public.routes;
DROP TABLE IF EXISTS public.task_grids;
DROP TABLE IF EXISTS public.task_updates;
DROP TABLE IF EXISTS public.tasks;
DROP TABLE IF EXISTS public.grids;
DROP TABLE IF EXISTS public.projects;
DROP TABLE IF EXISTS public.profiles;
