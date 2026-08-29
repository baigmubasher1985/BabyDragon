-- ============================================================================
-- MANUAL EMERGENCY RECOVERY — NOT A BIT-IDENTICAL INVERSE
-- PAIR: 217_cr1e_staging_grant_hardening
-- ROLE: MANUAL EMERGENCY RECOVERY
-- ============================================================================
-- WARNING: This reopens direct client writes on the sixteen STG-GRANT-001
-- tables (anon + authenticated INSERT/UPDATE/DELETE). It is not a safe undo.
-- Prefer a forward-fix over reopening unsafe grants — especially on production.
-- NEVER RUN AUTOMATICALLY. Never add to an apply list, wrapper, or cron.
-- Do not execute unless a later written authorization names this file.
--
-- Captured pre-217 permanent-staging client table grants (information_schema):
--   anon / authenticated: SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER,
--   plus table-wipe (TRUNCATE). This recovery does NOT restore table-wipe or
--   MAINTAIN. Restored table grants are therefore narrower than the captured
--   state, never broader.
--
-- Captured pre-217 postgres public default ACL (pg_default_acl):
--   tables: anon/authenticated ALL including table-wipe and MAINTAIN
--   sequences: USAGE, SELECT, UPDATE
--   functions: EXECUTE
-- Recovery restores those client defaults FOR ROLE postgres IN SCHEMA public
-- except table-wipe and MAINTAIN. It does not restore PUBLIC grants that were
-- absent. It does not touch supabase_admin defaults (217 could not change them).
-- It does not touch storage, auth, realtime, or extension defaults.
-- ============================================================================

BEGIN;

DO $acl$
DECLARE
  objects text[] := ARRAY[
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
    'acceptance_rules',
    'tenants',
    'storage_connections',
    'tenant_storage_policies',
    'artifact_transfer_jobs'
  ];
  r text;
BEGIN
  FOREACH r IN ARRAY objects LOOP
    IF to_regclass(format('public.%I', r)) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.%I TO anon',
      r
    );
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLE public.%I TO authenticated',
      r
    );
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role',
      r
    );
  END LOOP;
END
$acl$;

-- Restore captured postgres public client defaults, minus table-wipe / MAINTAIN.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO authenticated;

COMMIT;
