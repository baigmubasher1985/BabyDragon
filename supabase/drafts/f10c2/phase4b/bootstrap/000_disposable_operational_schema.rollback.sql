-- =============================================================================
-- DISPOSABLE ONLY — rollback / cleanup listing
-- F10C2 PHASE 4B-S — 000_disposable_operational_schema.rollback.sql
-- DRAFT / UNAPPLIED / DO NOT RUN IN PHASE 4B-S
--
-- Requires BOTH:
--   SET LOCAL app.f10c2_disposable_confirmed = 'yes';
--   SET LOCAL app.f10c2_disposable_cleanup_confirmed = 'yes';
-- Cleanup marker is separate from the create marker. Do not run this file
-- unless a later authorized disposable cleanup pass is explicitly approved.
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
-- Forbidden here: truncates, cascading deletes, dropping the database,
-- production identifiers.
-- =============================================================================

DO $guard$
BEGIN
  IF current_setting('app.f10c2_disposable_confirmed', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION
      'DISPOSABLE ONLY: rollback requires app.f10c2_disposable_confirmed=yes';
  END IF;
  IF current_setting('app.f10c2_disposable_cleanup_confirmed', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION
      'DISPOSABLE ONLY: rollback requires a separate app.f10c2_disposable_cleanup_confirmed=yes marker';
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
