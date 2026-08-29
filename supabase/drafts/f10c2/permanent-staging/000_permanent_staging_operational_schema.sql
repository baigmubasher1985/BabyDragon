-- =============================================================================
-- PERMANENT STAGING ONLY — DO NOT RUN AGAINST PRODUCTION OR DISPOSABLE
-- F10C2 CR1-E — staging operational schema bootstrap (allowlist slot 000)
-- Replaces disposable 000 in the STAGING allowlist only.
-- Historical file remains: supabase/drafts/f10c2/phase4b/bootstrap/000_disposable_operational_schema.sql
-- Do not modify that historical file. Disposable apply plans still use it.
--
-- WHY THIS FILE EXISTS
-- Historical 000 does not SET a disposable marker. It ASSERTS one:
--   DO $guard$ ... current_setting('app.f10c2_disposable_confirmed', true)
--     IS DISTINCT FROM 'yes' THEN RAISE EXCEPTION ...
-- Object: PostgreSQL custom GUC app.f10c2_disposable_confirmed
-- Expected value: 'yes' (transaction-local SET LOCAL issued only by the
-- disposable JS wrapper; not a config-table row).
-- Inappropriate on staging: it requires a disposable-project session marker
-- and would brand staging as disposable evidence.
-- This adapter copies schema DDL (tables, indexes, fail-closed RLS/grants)
-- and OMITS the assert-yes / SET LOCAL / any environment identity GUC.
-- App schema does not read a staging GUC — none is invented.
--
-- Schema vs config vs execution:
--   Schema: same 14 operational tables + pgcrypto + indexes + fail-closed RLS.
--   Config: no disposable GUC, no staging_confirmed GUC, no identity row.
--   Execution: wrapper applies these bytes hash-verified; it must not rewrite
--   SQL or inject SET LOCAL app.f10c2_disposable_confirmed.
--
-- Fail-closed: abort if the disposable GUC is already yes, or if public.profiles
-- is already labeled DISPOSABLE ONLY (another environment's identity).
-- Idempotent: CREATE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / ENABLE RLS /
-- GRANT/REVOKE.
-- Forbidden: dropping relations, truncating, CASCADE, disabling RLS, GRANT ALL
-- to anon/public, permissive true policies, business-row INSERTs, migration 207,
-- SET LOCAL disposable marker, contacting production (nsne) or disposable.
-- =============================================================================

DO $guard$
DECLARE
  profiles_comment text;
BEGIN
  IF current_setting('app.f10c2_disposable_confirmed', true) IS NOT DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION
      'PERMANENT STAGING: refusing because app.f10c2_disposable_confirmed is yes. This adapter must not run in a disposable-marked session.';
  END IF;

  SELECT d.description
    INTO profiles_comment
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = 0
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname = 'profiles';

  IF profiles_comment IS NOT NULL AND profiles_comment ILIKE '%DISPOSABLE ONLY%' THEN
    RAISE EXCEPTION
      'PERMANENT STAGING: public.profiles is labeled DISPOSABLE ONLY. Refusing to overwrite another environment identity.';
  END IF;
END
$guard$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. profiles  (auth.users)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id),
  email text NOT NULL,
  role text NOT NULL,
  created_at timestamptz DEFAULT now(),
  full_name text,
  is_active boolean DEFAULT true,
  CONSTRAINT profiles_role_check CHECK (role IN ('super_admin', 'admin', 'fe'))
);

COMMENT ON TABLE public.profiles IS
  'Permanent-staging operational bootstrap. Identity rows are created later as staging Auth/profile pairs — never copied from production or disposable.';

-- ---------------------------------------------------------------------------
-- 2. projects  (profiles)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  customer text,
  market text,
  testing_type text,
  start_date date,
  status text DEFAULT 'active',
  created_by uuid REFERENCES public.profiles (id),
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.projects IS
  'Permanent-staging operational bootstrap. No production or disposable project names or customer rows.';

-- ---------------------------------------------------------------------------
-- 3. grids  (auth.users)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.grids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  market text,
  grid_id text,
  geometry jsonb,
  created_by uuid REFERENCES auth.users (id),
  created_at timestamptz DEFAULT now(),
  status text DEFAULT 'Available'
);

COMMENT ON TABLE public.grids IS
  'Permanent-staging operational bootstrap. Geometry is schema-only until authorized staging fixtures.';

-- ---------------------------------------------------------------------------
-- 4. tasks  (profiles, projects, grids)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text,
  description text,
  type text,
  assigned_to uuid REFERENCES public.profiles (id),
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  started_at timestamp,
  completed_at timestamp,
  project text,
  market text,
  target_type text,
  target_name text,
  priority text DEFAULT 'normal',
  due_date timestamptz,
  notes text,
  test_type text,
  project_id uuid REFERENCES public.projects (id),
  grid_id uuid REFERENCES public.grids (id)
);

COMMENT ON TABLE public.tasks IS
  'Permanent-staging operational bootstrap. Column names/types match accepted app + F10C1I RPC contracts.';

-- ---------------------------------------------------------------------------
-- 5. task_updates  (tasks, profiles)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid REFERENCES public.tasks (id),
  user_id uuid REFERENCES public.profiles (id),
  comment text,
  photo_url text,
  created_at timestamptz DEFAULT now(),
  latitude double precision,
  longitude double precision,
  user_email text
);

COMMENT ON TABLE public.task_updates IS
  'Permanent-staging operational bootstrap. photo_url is a legacy dual-read column; no production objects.';

-- ---------------------------------------------------------------------------
-- 6. task_grids  (tasks, grids)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_grids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks (id),
  grid_id uuid NOT NULL REFERENCES public.grids (id),
  created_at timestamptz DEFAULT now(),
  CONSTRAINT task_grids_task_id_grid_id_key UNIQUE (task_id, grid_id)
);

COMMENT ON TABLE public.task_grids IS
  'Permanent-staging operational bootstrap. Junction uniqueness required by assigned-grid reads.';

-- ---------------------------------------------------------------------------
-- 7. routes  (grids, auth.users)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  grid_id uuid REFERENCES public.grids (id),
  geometry jsonb,
  route_type text,
  created_by uuid REFERENCES auth.users (id),
  created_at timestamptz DEFAULT now(),
  market text,
  status text DEFAULT 'Draft',
  route_name text,
  route_mode text,
  route_geojson jsonb,
  route_length_m numeric,
  route_source text,
  generated_at timestamptz
);

COMMENT ON TABLE public.routes IS
  'Permanent-staging operational bootstrap. Preserves RouteManagement payload columns.';

-- ---------------------------------------------------------------------------
-- 8. route_grids  (routes, grids)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.route_grids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES public.routes (id),
  grid_id uuid NOT NULL REFERENCES public.grids (id),
  created_at timestamptz DEFAULT now(),
  CONSTRAINT route_grids_route_id_grid_id_key UNIQUE (route_id, grid_id)
);

COMMENT ON TABLE public.route_grids IS
  'Permanent-staging operational bootstrap. Junction uniqueness only.';

-- ---------------------------------------------------------------------------
-- 9. cell_files  (auth.users)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cell_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  market text,
  technology text,
  record_count integer DEFAULT 0,
  uploaded_by uuid REFERENCES auth.users (id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.cell_files IS
  'Permanent-staging operational bootstrap. No production cell-file rows.';

-- ---------------------------------------------------------------------------
-- 10. cell_sites  (cell_files)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cell_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_name text,
  cell_name text,
  latitude double precision,
  longitude double precision,
  azimuth integer,
  technology text,
  pci integer,
  earfcn integer,
  market text,
  created_at timestamptz DEFAULT now(),
  cell_file_id uuid REFERENCES public.cell_files (id),
  lat double precision,
  lon double precision
);

COMMENT ON TABLE public.cell_sites IS
  'Permanent-staging operational bootstrap. Dual lat/lon and latitude/longitude columns preserved for app contract.';

-- ---------------------------------------------------------------------------
-- 11. cell_sectors  (cell_files, cell_sites)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cell_sectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cell_file_id uuid REFERENCES public.cell_files (id),
  site_id uuid REFERENCES public.cell_sites (id),
  market text,
  system text,
  technology text,
  site_name text,
  cell_name text,
  cid text,
  lat double precision NOT NULL,
  lon double precision NOT NULL,
  azimuth double precision,
  antenna_bw double precision,
  lac text,
  mcc text,
  mnc text,
  earfcn text,
  pci text,
  raw_row jsonb,
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.cell_sectors IS
  'Permanent-staging operational bootstrap. Parser insert columns preserved; no production coordinates.';

-- ---------------------------------------------------------------------------
-- 12. task_checklist_items  (tasks, auth.users)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks (id),
  label text NOT NULL,
  item_order integer DEFAULT 0,
  is_done boolean DEFAULT false,
  completed_at timestamptz,
  completed_by uuid REFERENCES auth.users (id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.task_checklist_items IS
  'Permanent-staging operational bootstrap. Matches update_assigned_checklist_item RPC columns.';

-- ---------------------------------------------------------------------------
-- 13. task_issue_reports  (tasks, auth.users)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_issue_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks (id),
  issue_type text NOT NULL,
  severity text DEFAULT 'normal',
  description text,
  status text DEFAULT 'open',
  lat double precision,
  lon double precision,
  reported_by uuid REFERENCES auth.users (id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.task_issue_reports IS
  'Permanent-staging operational bootstrap. Matches insert_assigned_task_issue RPC columns.';

-- ---------------------------------------------------------------------------
-- 14. qc_reviews  (tasks, grids, profiles)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.qc_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks (id),
  grid_id uuid REFERENCES public.grids (id),
  reviewer_id uuid REFERENCES public.profiles (id),
  log_received boolean NOT NULL DEFAULT false,
  log_naming_correct boolean NOT NULL DEFAULT false,
  required_evidence_received boolean NOT NULL DEFAULT false,
  checklist_reviewed boolean NOT NULL DEFAULT false,
  issues_reviewed boolean NOT NULL DEFAULT false,
  notes_photos_reviewed boolean NOT NULL DEFAULT false,
  qc_decision text NOT NULL DEFAULT 'Waiting for Logs',
  qc_notes text,
  redrive_needed boolean NOT NULL DEFAULT false,
  redrive_reason text,
  redrive_task_id uuid REFERENCES public.tasks (id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qc_reviews_qc_decision_check CHECK (
    qc_decision IN (
      'QC Passed',
      'QC Failed',
      'Needs Re-drive',
      'Waiting for Logs',
      'Log Naming Issue',
      'Missing Evidence'
    )
  )
);

COMMENT ON TABLE public.qc_reviews IS
  'Permanent-staging operational bootstrap. Task-level QC surface (distinct from field_test_qc_reviews).';

-- ---------------------------------------------------------------------------
-- Essential deterministic indexes (FK / uniqueness consumed by later drafts)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS profiles_role_idx ON public.profiles (role);
CREATE INDEX IF NOT EXISTS projects_created_by_idx ON public.projects (created_by);
CREATE INDEX IF NOT EXISTS grids_market_idx ON public.grids (market);
CREATE INDEX IF NOT EXISTS grids_grid_id_idx ON public.grids (grid_id);
CREATE INDEX IF NOT EXISTS tasks_assigned_to_idx ON public.tasks (assigned_to);
CREATE INDEX IF NOT EXISTS tasks_project_id_idx ON public.tasks (project_id);
CREATE INDEX IF NOT EXISTS tasks_grid_id_idx ON public.tasks (grid_id);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON public.tasks (status);
CREATE INDEX IF NOT EXISTS task_updates_task_id_idx ON public.task_updates (task_id);
CREATE INDEX IF NOT EXISTS task_updates_user_id_idx ON public.task_updates (user_id);
CREATE INDEX IF NOT EXISTS routes_grid_id_idx ON public.routes (grid_id);
CREATE INDEX IF NOT EXISTS cell_files_uploaded_by_idx ON public.cell_files (uploaded_by);
CREATE INDEX IF NOT EXISTS cell_sites_cell_file_id_idx ON public.cell_sites (cell_file_id);
CREATE INDEX IF NOT EXISTS cell_sectors_cell_file_id_idx ON public.cell_sectors (cell_file_id);
CREATE INDEX IF NOT EXISTS cell_sectors_site_id_idx ON public.cell_sectors (site_id);
CREATE INDEX IF NOT EXISTS cell_sectors_market_idx ON public.cell_sectors (market);
CREATE INDEX IF NOT EXISTS task_checklist_items_task_id_idx ON public.task_checklist_items (task_id);
CREATE INDEX IF NOT EXISTS task_issue_reports_task_id_idx ON public.task_issue_reports (task_id);
CREATE INDEX IF NOT EXISTS qc_reviews_task_id_idx ON public.qc_reviews (task_id);
CREATE INDEX IF NOT EXISTS qc_reviews_grid_id_idx ON public.qc_reviews (grid_id);
CREATE INDEX IF NOT EXISTS qc_reviews_reviewer_id_idx ON public.qc_reviews (reviewer_id);

-- Fail-closed RLS: enable with NO policies and NO GRANT ALL to anon/public.
-- F10C1I 011/014-020 add scoped policies later. Skipped 009/010/012/013 remain
-- fail-closed except SECURITY DEFINER RPCs and service_role.
DO $acl$
DECLARE
  r text;
  tables text[] := ARRAY[
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
  ];
BEGIN
  IF current_setting('app.f10c2_disposable_confirmed', true) IS NOT DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION
      'PERMANENT STAGING: refusing ACL/RLS changes because app.f10c2_disposable_confirmed is yes';
  END IF;

  FOREACH r IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', r);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', r);
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated',
      r
    );
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role',
      r
    );
  END LOOP;
END
$acl$;

-- End of permanent-staging operational bootstrap 000. No rows. No 207. No production data.
-- No disposable marker set. No staging identity GUC invented.
