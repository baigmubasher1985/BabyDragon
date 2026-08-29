-- DRAFT / CR1-E-R1
-- F10C2 CR1-E STAGING GRANT HARDENING
-- PAIR: 217_cr1e_staging_grant_hardening
-- ROLE: FORWARD
-- CLASSIFICATION: CR1E_DRAFT_ONLY. Do not auto-apply. Not in the 45-path allowlist.
-- NOTE: Remediates STG-GRANT-001 (current tables) and the future default-grant gap.
-- NOTE: Catalog inspect 2026-08-29 (SELECT-only, permanent staging):
--       public table owner = postgres (31 relations)
--       public function owner = postgres (24 functions)
--       public sequences = none
--       public default-ACL grantors = postgres, supabase_admin
--       postgres also has storage default ACLs — DO NOT TOUCH storage/auth/realtime
--       staging session is postgres and is NOT a member of supabase_admin, so
--       ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin cannot be executed here.
--       Future migration objects are created by postgres; those defaults are revoked.
--       supabase_admin public client defaults remain as a documented platform residual.
-- NOTE: Current-table plan (approved): remove anon/PUBLIC from sixteen tables;
--       authenticated SELECT only on twelve RLS workflow tables; no client table
--       access to four RLS-less tenant/storage tables; service_role retains access;
--       mutation via secured RPCs; storage.objects policies untouched.
-- NOTE: Future tables/sequences/functions created by a role this session can act as
--       receive no automatic PUBLIC/anon/authenticated privileges. The creating
--       migration must GRANT explicitly. Do not grant broad authenticated access
--       as a convenience fallback.
-- NOTE: Does not rewrite snapshots, runs, QC, Auth, or seed. No 214. No 207.

BEGIN;

-- STG-GRANT-001 objects created after 000 that inherited default anon privileges.
-- Workflow-read (RLS already enabled): authenticated SELECT only.
-- Tenant/storage (no RLS): no authenticated table privileges.

DO $acl$
DECLARE
  workflow text[] := ARRAY[
    'field_test_runs',
    'field_test_artifacts',
    'field_test_metrics',
    'field_test_qc_reviews',
    'field_test_iterations',
    'field_test_call_events',
    'field_test_run_acceptance_snapshots',
    'field_test_iteration_evaluations',
    'field_test_call_summaries',
    'qc_verdict_overrides',
    'acceptance_profiles',
    'acceptance_rules'
  ];
  server_only text[] := ARRAY[
    'tenants',
    'storage_connections',
    'tenant_storage_policies',
    'artifact_transfer_jobs'
  ];
  r text;
  seq_reg regclass;
BEGIN
  FOREACH r IN ARRAY workflow LOOP
    IF to_regclass(format('public.%I', r)) IS NULL THEN
      RAISE EXCEPTION '217 missing workflow table %', r;
    END IF;
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', r);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', r);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', r);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', r);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', r);
    FOR seq_reg IN
      SELECT s.oid::regclass
      FROM pg_class t
      JOIN pg_depend d ON d.refobjid = t.oid AND d.deptype = 'a'
      JOIN pg_class s ON s.oid = d.objid AND s.relkind = 'S'
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND t.relname = r
    LOOP
      EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC', seq_reg);
      EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM anon', seq_reg);
      EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM authenticated', seq_reg);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO service_role', seq_reg);
    END LOOP;
  END LOOP;

  FOREACH r IN ARRAY server_only LOOP
    IF to_regclass(format('public.%I', r)) IS NULL THEN
      RAISE EXCEPTION '217 missing server-only table %', r;
    END IF;
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', r);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', r);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', r);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', r);
    FOR seq_reg IN
      SELECT s.oid::regclass
      FROM pg_class t
      JOIN pg_depend d ON d.refobjid = t.oid AND d.deptype = 'a'
      JOIN pg_class s ON s.oid = d.objid AND s.relkind = 'S'
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND t.relname = r
    LOOP
      EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC', seq_reg);
      EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM anon', seq_reg);
      EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM authenticated', seq_reg);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO service_role', seq_reg);
    END LOOP;
  END LOOP;
END
$acl$;

-- Future objects created by the inspected migration owner (postgres).
-- Narrowest client default: no automatic PUBLIC / anon / authenticated privileges.
-- service_role and postgres owner defaults are left in place.
-- Schema is public only. Do not alter storage, auth, realtime, or extensions.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM authenticated;

-- Any additional public default-ACL grantor or object owner this session can act as.
-- Today that is postgres. supabase_admin is a public grantor but the staging
-- session is not a member, so it is skipped (documented residual).
DO $def$
DECLARE
  grantor_name text;
BEGIN
  FOR grantor_name IN
    SELECT DISTINCT s.grantor
    FROM (
      SELECT pg_get_userbyid(c.relowner) AS grantor
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'S', 'v', 'm', 'p')
      UNION
      SELECT pg_get_userbyid(p.proowner)
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.prokind = 'f'
      UNION
      SELECT pg_get_userbyid(d.defaclrole)
      FROM pg_default_acl d
      JOIN pg_namespace n ON n.oid = d.defaclnamespace
      WHERE n.nspname = 'public'
    ) s
    WHERE s.grantor IS NOT NULL
      AND s.grantor NOT IN ('anon', 'authenticated', 'service_role', 'authenticator')
      AND (
        s.grantor = current_user
        OR pg_has_role(current_user, s.grantor, 'MEMBER')
      )
  LOOP
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC',
      grantor_name
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM anon',
      grantor_name
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated',
      grantor_name
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC',
      grantor_name
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon',
      grantor_name
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated',
      grantor_name
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC',
      grantor_name
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon',
      grantor_name
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM authenticated',
      grantor_name
    );
  END LOOP;
END
$def$;

-- Contract reminders (not executed as DML):
-- anon denial: no table privilege on STG-GRANT-001 objects
-- authenticated workflow: SELECT only; no INSERT/UPDATE/DELETE on acceptance_profiles
-- FE/Admin/super_admin: profile mutations remain inside 215/216 SECURITY DEFINER RPCs
-- future postgres-created table/sequence/function: no automatic client privileges
-- cross-tenant: existing RLS/RPC tenant checks are unchanged; this slug does not add FKs
-- storage.objects policies: untouched

COMMIT;
