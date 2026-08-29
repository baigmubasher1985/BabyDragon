-- F10C2 CR1-E-R1 — SELECT-only verification for 217_cr1e_staging_grant_hardening.
-- PAIR: 217_cr1e_staging_grant_hardening
-- ROLE: VERIFICATION
-- CR1E_DRAFT_ONLY. Never auto-apply.
-- Detects accidental broadening: client table-wipe / MAINTAIN, extra client writes,
-- and postgres public default ACLs that would recreate STG-GRANT-001.

SELECT
  NOT EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants g
    WHERE g.table_schema = 'public'
      AND g.grantee IN ('anon', 'PUBLIC')
      AND g.table_name IN (
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
      )
  ) AS anon_denied_on_stg_grant_001,
  NOT EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants g
    WHERE g.table_schema = 'public'
      AND g.grantee = 'authenticated'
      AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
      AND g.table_name IN (
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
      )
  ) AS authenticated_select_only_on_workflow,
  NOT EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants g
    WHERE g.table_schema = 'public'
      AND g.grantee = 'authenticated'
      AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
      AND g.table_name = 'acceptance_profiles'
  ) AS fe_cannot_write_acceptance_profiles,
  (
    SELECT COUNT(*)::int = 12
    FROM information_schema.role_table_grants g
    WHERE g.table_schema = 'public'
      AND g.grantee = 'authenticated'
      AND g.privilege_type = 'SELECT'
      AND g.table_name IN (
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
      )
  ) AS authenticated_workflow_select_present,
  NOT EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants g
    WHERE g.table_schema = 'public'
      AND g.grantee IN ('anon', 'authenticated', 'PUBLIC')
      AND g.table_name IN (
        'tenants',
        'storage_connections',
        'tenant_storage_policies',
        'artifact_transfer_jobs'
      )
  ) AS tenant_storage_server_only,
  EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants g
    WHERE g.table_schema = 'public'
      AND g.grantee = 'service_role'
      AND g.privilege_type = 'SELECT'
      AND g.table_name = 'acceptance_profiles'
  ) AS service_role_retains_backend,
  NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.acceptance_profiles'::regclass
      AND polcmd = 'w'
  ) AS no_client_update_policy,
  NOT EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants g
    WHERE g.table_schema = 'public'
      AND g.grantee IN ('anon', 'authenticated', 'PUBLIC')
      AND g.privilege_type IN ('TRUNCATE', 'MAINTAIN')
      AND g.table_name IN (
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
      )
  ) AS no_client_table_wipe_or_maintain,
  NOT EXISTS (
    SELECT 1
    FROM pg_default_acl d
    JOIN pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) e
    WHERE n.nspname = 'public'
      AND pg_get_userbyid(d.defaclrole) = 'postgres'
      AND d.defaclobjtype IN ('r', 'S', 'f')
      AND (
        e.grantee = 0
        OR e.grantee = 'anon'::regrole
        OR e.grantee = 'authenticated'::regrole
      )
  ) AS postgres_public_no_client_defaults,
  NOT EXISTS (
    SELECT 1
    FROM pg_default_acl d
    JOIN pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) e
    WHERE n.nspname = 'public'
      AND pg_get_userbyid(d.defaclrole) = 'postgres'
      AND d.defaclobjtype = 'r'
      AND e.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'MAINTAIN')
      AND (
        e.grantee = 0
        OR e.grantee = 'anon'::regrole
        OR e.grantee = 'authenticated'::regrole
      )
  ) AS postgres_public_no_client_table_writes,
  EXISTS (
    SELECT 1
    FROM pg_default_acl d
    JOIN pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) e
    WHERE n.nspname = 'public'
      AND pg_get_userbyid(d.defaclrole) = 'supabase_admin'
      AND d.defaclobjtype IN ('r', 'S', 'f')
      AND (
        e.grantee = 0
        OR e.grantee = 'anon'::regrole
        OR e.grantee = 'authenticated'::regrole
      )
  ) AS supabase_admin_public_client_defaults_remain_expected,
  EXISTS (
    SELECT 1
    FROM pg_default_acl d
    JOIN pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) e
    WHERE n.nspname = 'storage'
      AND pg_get_userbyid(d.defaclrole) = 'postgres'
      AND d.defaclobjtype = 'r'
      AND e.grantee = 'authenticated'::regrole
      AND e.privilege_type = 'SELECT'
  ) AS storage_postgres_defaults_untouched,
  CASE
    WHEN to_regprocedure('public.set_acceptance_profile_active(uuid,boolean)') IS NULL THEN false
    ELSE NOT has_function_privilege('anon', 'public.set_acceptance_profile_active(uuid,boolean)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.set_acceptance_profile_active(uuid,boolean)', 'EXECUTE')
  END AS admin_status_rpc_unchanged,
  CASE
    WHEN to_regprocedure('public.upsert_acceptance_profile(text,uuid,uuid,text,boolean,jsonb)') IS NULL THEN false
    ELSE NOT has_function_privilege('anon', 'public.upsert_acceptance_profile(text,uuid,uuid,text,boolean,jsonb)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.upsert_acceptance_profile(text,uuid,uuid,text,boolean,jsonb)', 'EXECUTE')
  END AS admin_upsert_rpc_unchanged,
  CASE
    WHEN to_regprocedure('public.ingest_field_test_canonical_result(uuid,text,jsonb)') IS NULL THEN false
    ELSE NOT has_function_privilege('anon', 'public.ingest_field_test_canonical_result(uuid,text,jsonb)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.ingest_field_test_canonical_result(uuid,text,jsonb)', 'EXECUTE')
  END AS authenticated_ingest_rpc_unchanged;
