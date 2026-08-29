/**
 * CR1-E permanent-staging exact migration allowlist.
 * Explicit path array only — no ranges, no directory discovery.
 * Never includes 009, 010, 012, 013, 112, 207, 214.
 * Does not connect to a database.
 *
 * Slot 000 is the permanent-staging adapter. Historical disposable 000 remains
 * under phase4b/bootstrap and is used only by disposable apply plans.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  listPhase4bApplyPlan,
  CR1D_APPLY,
  CR1E_APPLY,
  CR1_NEVER_RUN,
  CR1_NEVER_RUN_DIR,
  F10C1I_SKIP,
  F10C2_SKIP,
  PHASE4A_NEVER_EXECUTE,
  assertNo214InApplyList,
} from './phase4bApplyPlan.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export const NEVER_EXECUTE_NUMBERS = Object.freeze(['009', '010', '012', '013', '112', '207', '214'])

export const NEVER_EXECUTE_SLUGS = Object.freeze([
  '009_rls_profiles',
  '010_rls_tasks',
  '012_rls_task_checklist_items',
  '013_rls_task_issue_reports',
  '112_result_artifacts_storage_contract',
  '207_rls_tenant_storage_assumptions',
  '214_cr1b_acceptance_applicability',
])

export const STAGING_BOOTSTRAP_SLUG = '000_permanent_staging_operational_schema'
export const STAGING_BOOTSTRAP_FORWARD =
  'supabase/drafts/f10c2/permanent-staging/000_permanent_staging_operational_schema.sql'
export const STAGING_BOOTSTRAP_VERIFY =
  'supabase/drafts/f10c2/permanent-staging/000_permanent_staging_operational_schema.verify.sql'
export const STAGING_BOOTSTRAP_ROLLBACK =
  'supabase/drafts/f10c2/permanent-staging/000_permanent_staging_operational_schema.rollback.sql'
export const HISTORICAL_DISPOSABLE_BOOTSTRAP_SLUG = '000_disposable_operational_schema'
export const HISTORICAL_DISPOSABLE_BOOTSTRAP_FORWARD =
  'supabase/drafts/f10c2/phase4b/bootstrap/000_disposable_operational_schema.sql'
export const HASH_MANIFEST_REL = 'scripts/f10c2/permanentStagingAllowlist.hashes.json'
export const EXPECTED_ALLOWLIST_COUNT = 45

/** Exact forward paths. This is the only executable allowlist. Count stays 45: adapter replaces disposable 000. */
export const PERMANENT_STAGING_FORWARD_PATHS = Object.freeze([
  STAGING_BOOTSTRAP_FORWARD,
  'supabase/drafts/forward/001_security_audit_log.sql',
  'supabase/drafts/forward/002_harden_existing_functions.sql',
  'supabase/drafts/forward/003_security_helpers.sql',
  'supabase/drafts/forward/004_rpc_update_assigned_task_status.sql',
  'supabase/drafts/forward/005_rpc_update_assigned_checklist_item.sql',
  'supabase/drafts/forward/006_rpc_insert_assigned_task_issue.sql',
  'supabase/drafts/forward/007_rpc_insert_assigned_task_update.sql',
  'supabase/drafts/forward/008_execute_grants.sql',
  'supabase/drafts/forward/011_rls_task_updates.sql',
  'supabase/drafts/forward/014_rls_task_grids.sql',
  'supabase/drafts/forward/015_rls_projects.sql',
  'supabase/drafts/forward/016_rls_grids.sql',
  'supabase/drafts/forward/017_rls_routes.sql',
  'supabase/drafts/forward/018_rls_route_grids.sql',
  'supabase/drafts/forward/019_rls_cell_files_sites_sectors.sql',
  'supabase/drafts/forward/020_operational_evidence_schema_contract.sql',
  'supabase/drafts/f10c2/forward/101_field_test_runs.sql',
  'supabase/drafts/f10c2/forward/102_field_test_artifacts.sql',
  'supabase/drafts/f10c2/forward/103_field_test_metrics.sql',
  'supabase/drafts/f10c2/forward/104_field_test_qc_reviews.sql',
  'supabase/drafts/f10c2/forward/105_rpc_submit_field_test_run.sql',
  'supabase/drafts/f10c2/forward/106_rpc_register_field_test_artifact.sql',
  'supabase/drafts/f10c2/forward/107_rpc_complete_field_test_artifact_upload.sql',
  'supabase/drafts/f10c2/forward/108_rpc_submit_field_test_qc_review.sql',
  'supabase/drafts/f10c2/forward/109_rls_field_test_runs.sql',
  'supabase/drafts/f10c2/forward/110_rls_field_test_artifacts_metrics.sql',
  'supabase/drafts/f10c2/forward/111_rls_field_test_qc_reviews.sql',
  'supabase/drafts/f10c2/forward/113_rpc_finalize_field_test_run.sql',
  'supabase/drafts/f10c2/forward/114_result_artifacts_private_bucket.sql',
  'supabase/drafts/f10c2/forward/115_field_test_execute_grants.sql',
  'supabase/drafts/f10c2/phase4a/forward/201_tenants.sql',
  'supabase/drafts/f10c2/phase4a/forward/202_storage_connections.sql',
  'supabase/drafts/f10c2/phase4a/forward/203_tenant_storage_policies.sql',
  'supabase/drafts/f10c2/phase4a/forward/204_field_test_artifacts_tenant_columns.sql',
  'supabase/drafts/f10c2/phase4a/forward/205_artifact_transfer_jobs.sql',
  'supabase/drafts/f10c2/phase4a/forward/206_rpc_request_artifact_upload_plan.sql',
  'supabase/drafts/f10c2/phase4b/forward/208_phase4b_validation_remediation.sql',
  'supabase/drafts/f10c2/phase4b/forward/209_disposable_operational_profile_task_rls_remediation.sql',
  'supabase/drafts/f10c2/phase4b/forward/210_cr1b_canonical_ingestion_schema.sql',
  'supabase/drafts/f10c2/phase4b/forward/211_cr1b_acceptance_engine_schema.sql',
  'supabase/drafts/f10c2/phase4b/forward/212_cr1b_rpc_ingest_evaluate_qc.sql',
  'supabase/drafts/f10c2/phase4b/forward/213_cr1b_rls_grants.sql',
  'supabase/drafts/f10c2/phase4b/forward/215_cr1d_acceptance_profile_management.sql',
  'supabase/drafts/f10c2/phase4b/forward/216_cr1e_acceptance_profile_status.sql',
])

export const EXPECTED_ALLOWLIST_NUMBERS = Object.freeze([
  '000', '001', '002', '003', '004', '005', '006', '007', '008',
  '011', '014', '015', '016', '017', '018', '019', '020',
  '101', '102', '103', '104', '105', '106', '107', '108', '109', '110', '111',
  '113', '114', '115',
  '201', '202', '203', '204', '205', '206', '208', '209',
  '210', '211', '212', '213', '215', '216',
])

const META = {
  '000': {
    purpose: 'Permanent-staging operational schema bootstrap (profiles, projects, grids, tasks, and related). Same DDL as historical disposable 000 with disposable GUC assert/SET omitted. Empty-staging prerequisite.',
    dependencies: [],
    expectedObjects: [
      'extension pgcrypto',
      'tables profiles, projects, grids, tasks, task_updates, task_grids, routes, route_grids, cell_files, cell_sites, cell_sectors, task_checklist_items, task_issue_reports, qc_reviews',
    ],
    applyAdapterNote: null,
    stagingAdapter: true,
    previouslyValidatedOnDisposable: false,
    disposableValidationStatus:
      'staging-only adapter; schema DDL copied from historical 000 (validated on disposable); this file was not applied on disposable and must not set a disposable marker',
    verificationPath: STAGING_BOOTSTRAP_VERIFY,
    rollbackPath: STAGING_BOOTSTRAP_ROLLBACK,
  },
  '001': {
    purpose: 'Append-only security_audit_log table plus RLS.',
    dependencies: ['000'],
    expectedObjects: ['table security_audit_log', 'RLS on security_audit_log'],
    verificationPath: 'supabase/drafts/verification/001_security_audit_log.sql',
    rollbackPath: 'supabase/drafts/rollback/001_security_audit_log.sql',
  },
  '002': {
    purpose: 'Harden existing helper functions (fail-closed, empty search_path).',
    dependencies: ['000', '001'],
    expectedObjects: ['hardened existing SECURITY DEFINER helpers'],
    verificationPath: 'supabase/drafts/verification/002_harden_existing_functions.sql',
    rollbackPath: 'supabase/drafts/rollback/002_harden_existing_functions.sql',
  },
  '003': {
    purpose: 'Security helpers is_super_admin and is_assigned_to_task.',
    dependencies: ['002'],
    expectedObjects: ['function is_super_admin', 'function is_assigned_to_task'],
    verificationPath: 'supabase/drafts/verification/003_security_helpers.sql',
    rollbackPath: 'supabase/drafts/rollback/003_security_helpers.sql',
  },
  '004': {
    purpose: 'Narrow assigned-task status RPC with event-time skew guard.',
    dependencies: ['003'],
    expectedObjects: ['function update_assigned_task_status'],
    verificationPath: 'supabase/drafts/verification/004_rpc_update_assigned_task_status.sql',
    rollbackPath: 'supabase/drafts/rollback/004_rpc_update_assigned_task_status.sql',
  },
  '005': {
    purpose: 'Assigned checklist-item RPC with event-time skew guard.',
    dependencies: ['003'],
    expectedObjects: ['function update_assigned_checklist_item'],
    verificationPath: 'supabase/drafts/verification/005_rpc_update_assigned_checklist_item.sql',
    rollbackPath: 'supabase/drafts/rollback/005_rpc_update_assigned_checklist_item.sql',
  },
  '006': {
    purpose: 'Assigned task-issue insert RPC; forces reported_by and status=open.',
    dependencies: ['003'],
    expectedObjects: ['function insert_assigned_task_issue'],
    verificationPath: 'supabase/drafts/verification/006_rpc_insert_assigned_task_issue.sql',
    rollbackPath: 'supabase/drafts/rollback/006_rpc_insert_assigned_task_issue.sql',
  },
  '007': {
    purpose: 'Assigned task-update insert RPC; forces user_id; rejects URL durable refs.',
    dependencies: ['003'],
    expectedObjects: ['function insert_assigned_task_update'],
    verificationPath: 'supabase/drafts/verification/007_rpc_insert_assigned_task_update.sql',
    rollbackPath: 'supabase/drafts/rollback/007_rpc_insert_assigned_task_update.sql',
  },
  '008': {
    purpose: 'REVOKE PUBLIC/anon and GRANT authenticated on assignment RPCs.',
    dependencies: ['002', '003', '004', '005', '006', '007'],
    expectedObjects: ['EXECUTE grants on assignment RPCs (authenticated only)'],
    verificationPath: 'supabase/drafts/verification/008_execute_grants.sql',
    rollbackPath: 'supabase/drafts/rollback/008_execute_grants.sql',
  },
  '011': {
    purpose: 'RLS on task_updates: FE SELECT + Admin SELECT; no FE INSERT (RPC-only).',
    dependencies: ['007'],
    expectedObjects: ['RLS policies on task_updates'],
    verificationPath: 'supabase/drafts/verification/011_rls_task_updates.sql',
    rollbackPath: 'supabase/drafts/rollback/011_rls_task_updates.sql',
  },
  '014': {
    purpose: 'RLS on task_grids: admin write; FE SELECT assigned.',
    dependencies: ['000', '011'],
    expectedObjects: ['RLS policies on task_grids'],
    verificationPath: 'supabase/drafts/verification/014_rls_task_grids.sql',
    rollbackPath: 'supabase/drafts/rollback/014_rls_task_grids.sql',
  },
  '015': {
    purpose: 'RLS on projects: FE via assignment.',
    dependencies: ['000', '014'],
    expectedObjects: ['RLS policies on projects'],
    verificationPath: 'supabase/drafts/verification/015_rls_projects.sql',
    rollbackPath: 'supabase/drafts/rollback/015_rls_projects.sql',
  },
  '016': {
    purpose: 'RLS on grids with dual grid linkage.',
    dependencies: ['004', '014'],
    expectedObjects: ['RLS policies on grids'],
    verificationPath: 'supabase/drafts/verification/016_rls_grids.sql',
    rollbackPath: 'supabase/drafts/rollback/016_rls_grids.sql',
  },
  '017': {
    purpose: 'RLS on routes: FE read-only via grids.',
    dependencies: ['016'],
    expectedObjects: ['RLS policies on routes'],
    verificationPath: 'supabase/drafts/verification/017_rls_routes.sql',
    rollbackPath: 'supabase/drafts/rollback/017_rls_routes.sql',
  },
  '018': {
    purpose: 'RLS on route_grids: FE read-only.',
    dependencies: ['017'],
    expectedObjects: ['RLS policies on route_grids'],
    verificationPath: 'supabase/drafts/verification/018_rls_route_grids.sql',
    rollbackPath: 'supabase/drafts/rollback/018_rls_route_grids.sql',
  },
  '019': {
    purpose: 'RLS on cell_files / cell_sites / cell_sectors: FE read-only maps.',
    dependencies: ['016'],
    expectedObjects: ['RLS policies on cell_files, cell_sites, cell_sectors'],
    verificationPath: 'supabase/drafts/verification/019_rls_cell_files_sites_sectors.sql',
    rollbackPath: 'supabase/drafts/rollback/019_rls_cell_files_sites_sectors.sql',
  },
  '020': {
    purpose: 'Operational evidence schema contract (qc_reviews apply-candidate; storage write remains blocked).',
    dependencies: ['002'],
    expectedObjects: ['qc_reviews schema contract objects (no bucket DDL)'],
    verificationPath: 'supabase/drafts/verification/020_operational_evidence_schema_contract.sql',
    rollbackPath: 'supabase/drafts/rollback/020_operational_evidence_schema_contract.sql',
  },
  '101': {
    purpose: 'field_test_runs table, indexes, client_run_id uniqueness.',
    dependencies: ['000', '020'],
    expectedObjects: ['table field_test_runs', 'unique client_run_id'],
    verificationPath: 'supabase/drafts/f10c2/verification/101_field_test_runs.sql',
    rollbackPath: 'supabase/drafts/f10c2/rollback/101_field_test_runs.sql',
  },
  '102': {
    purpose: 'field_test_artifacts table; bucket + object_key; checksum uniqueness.',
    dependencies: ['101'],
    expectedObjects: ['table field_test_artifacts'],
    verificationPath: 'supabase/drafts/f10c2/verification/102_field_test_artifacts.sql',
    rollbackPath: 'supabase/drafts/f10c2/rollback/102_field_test_artifacts.sql',
  },
  '103': {
    purpose: 'Optional normalized field_test_metrics rows.',
    dependencies: ['101'],
    expectedObjects: ['table field_test_metrics'],
    verificationPath: 'supabase/drafts/f10c2/verification/103_field_test_metrics.sql',
    rollbackPath: 'supabase/drafts/f10c2/rollback/103_field_test_metrics.sql',
  },
  '104': {
    purpose: 'Run-level field_test_qc_reviews; optional redrive_task_id link.',
    dependencies: ['101'],
    expectedObjects: ['table field_test_qc_reviews'],
    verificationPath: 'supabase/drafts/f10c2/verification/104_field_test_qc_reviews.sql',
    rollbackPath: 'supabase/drafts/f10c2/rollback/104_field_test_qc_reviews.sql',
  },
  '105': {
    purpose: 'Idempotent submit_field_test_run RPC; submitted_by=auth.uid().',
    dependencies: ['101'],
    expectedObjects: ['function submit_field_test_run'],
    verificationPath: 'supabase/drafts/f10c2/verification/105_rpc_submit_field_test_run.sql',
    rollbackPath: 'supabase/drafts/f10c2/rollback/105_rpc_submit_field_test_run.sql',
  },
  '106': {
    purpose: 'Register field-test artifact metadata with path ownership.',
    dependencies: ['102', '105'],
    expectedObjects: ['function register_field_test_artifact'],
    verificationPath: 'supabase/drafts/f10c2/verification/106_rpc_register_field_test_artifact.sql',
    rollbackPath: 'supabase/drafts/f10c2/rollback/106_rpc_register_field_test_artifact.sql',
  },
  '107': {
    purpose: 'Mark artifact upload complete; checksum match.',
    dependencies: ['106'],
    expectedObjects: ['function complete_field_test_artifact_upload'],
    verificationPath: 'supabase/drafts/f10c2/verification/107_rpc_complete_field_test_artifact_upload.sql',
    rollbackPath: 'supabase/drafts/f10c2/rollback/107_rpc_complete_field_test_artifact_upload.sql',
  },
  '108': {
    purpose: 'Admin/SA/QC write QC decision RPC.',
    dependencies: ['104'],
    expectedObjects: ['function submit_field_test_qc_review'],
    verificationPath: 'supabase/drafts/f10c2/verification/108_rpc_submit_field_test_qc_review.sql',
    rollbackPath: 'supabase/drafts/f10c2/rollback/108_rpc_submit_field_test_qc_review.sql',
  },
  '109': {
    purpose: 'RLS on field_test_runs: FE SELECT assigned; Admin/SA/QC read; no direct FE INSERT.',
    dependencies: ['101', '105'],
    expectedObjects: ['RLS policies on field_test_runs'],
    verificationPath: 'supabase/drafts/f10c2/verification/109_rls_field_test_runs.sql',
    rollbackPath: 'supabase/drafts/f10c2/rollback/109_rls_field_test_runs.sql',
  },
  '110': {
    purpose: 'RLS on field_test_artifacts and field_test_metrics (same ownership model).',
    dependencies: ['102', '103', '109'],
    expectedObjects: ['RLS policies on field_test_artifacts', 'RLS policies on field_test_metrics'],
    verificationPath: 'supabase/drafts/f10c2/verification/110_rls_field_test_artifacts_metrics.sql',
    rollbackPath: 'supabase/drafts/f10c2/rollback/110_rls_field_test_artifacts_metrics.sql',
  },
  '111': {
    purpose: 'RLS on field_test_qc_reviews: Admin/SA/QC mutate; FE read own assigned runs.',
    dependencies: ['104', '108'],
    expectedObjects: ['RLS policies on field_test_qc_reviews'],
    verificationPath: 'supabase/drafts/f10c2/verification/111_rls_field_test_qc_reviews.sql',
    rollbackPath: 'supabase/drafts/f10c2/rollback/111_rls_field_test_qc_reviews.sql',
  },
  '113': {
    purpose: 'FE finalize_field_test_run when artifacts are complete.',
    dependencies: ['105', '107'],
    expectedObjects: ['function finalize_field_test_run'],
    verificationPath: 'supabase/drafts/f10c2/verification/113_rpc_finalize_field_test_run.sql',
    rollbackPath: 'supabase/drafts/f10c2/rollback/113_rpc_finalize_field_test_run.sql',
  },
  '114': {
    purpose: 'Private result-artifacts bucket plus storage.objects policies.',
    dependencies: ['102'],
    expectedObjects: ['storage bucket result-artifacts', 'storage.objects policies'],
    verificationPath: 'supabase/drafts/f10c2/verification/114_result_artifacts_private_bucket.sql',
    rollbackPath: 'supabase/drafts/f10c2/rollback/114_result_artifacts_private_bucket.sql',
  },
  '115': {
    purpose: 'REVOKE anon/PUBLIC and GRANT authenticated on field-test result RPCs.',
    dependencies: ['105', '106', '107', '108', '113'],
    expectedObjects: ['EXECUTE grants on field-test RPCs (authenticated only)'],
    verificationPath: 'supabase/drafts/f10c2/verification/115_field_test_execute_grants.sql',
    rollbackPath: 'supabase/drafts/f10c2/rollback/115_field_test_execute_grants.sql',
  },
  '201': {
    purpose: 'Tenant residency boundary table.',
    dependencies: ['115'],
    expectedObjects: ['table tenants'],
    verificationPath: 'supabase/drafts/f10c2/phase4a/verification/201_tenants.sql',
    rollbackPath: 'supabase/drafts/f10c2/phase4a/rollback/201_tenants.sql',
  },
  '202': {
    purpose: 'Storage connector metadata; secret_reference only (no plaintext credentials).',
    dependencies: ['201'],
    expectedObjects: ['table storage_connections'],
    verificationPath: 'supabase/drafts/f10c2/phase4a/verification/202_storage_connections.sql',
    rollbackPath: 'supabase/drafts/f10c2/phase4a/rollback/202_storage_connections.sql',
  },
  '203': {
    purpose: 'Tenant artifact-type routing policies.',
    dependencies: ['202'],
    expectedObjects: ['table tenant_storage_policies'],
    verificationPath: 'supabase/drafts/f10c2/phase4a/verification/203_tenant_storage_policies.sql',
    rollbackPath: 'supabase/drafts/f10c2/phase4a/rollback/203_tenant_storage_policies.sql',
  },
  '204': {
    purpose: 'Nullable tenant columns on field-test artifacts; relaxes 102 bucket-only assumption.',
    dependencies: ['102', '201'],
    expectedObjects: ['nullable tenant columns on field_test_artifacts / related'],
    verificationPath: 'supabase/drafts/f10c2/phase4a/verification/204_field_test_artifacts_tenant_columns.sql',
    rollbackPath: 'supabase/drafts/f10c2/phase4a/rollback/204_field_test_artifacts_tenant_columns.sql',
  },
  '205': {
    purpose: 'Artifact transfer / resume jobs.',
    dependencies: ['204'],
    expectedObjects: ['table artifact_transfer_jobs'],
    verificationPath: 'supabase/drafts/f10c2/phase4a/verification/205_artifact_transfer_jobs.sql',
    rollbackPath: 'supabase/drafts/f10c2/phase4a/rollback/205_artifact_transfer_jobs.sql',
  },
  '206': {
    purpose: 'request_artifact_upload_plan RPC (owner-gate SECURITY DEFINER).',
    dependencies: ['205'],
    expectedObjects: ['function request_artifact_upload_plan'],
    verificationPath: 'supabase/drafts/f10c2/phase4a/verification/206_rpc_request_artifact_upload_plan.sql',
    rollbackPath: 'supabase/drafts/f10c2/phase4a/rollback/206_rpc_request_artifact_upload_plan.sql',
  },
  '208': {
    purpose: 'Phase 4B validation remediation after 206 (helper/policy repairs; never 207).',
    dependencies: ['206'],
    expectedObjects: ['repaired helpers/policies after 206 (is_admin_or_super_admin checks; 109/110/111/206 alignment)'],
    verificationPath: 'supabase/drafts/f10c2/phase4b/verification/208_phase4b_validation_remediation.sql',
    rollbackPath: 'supabase/drafts/f10c2/phase4b/rollback/208_phase4b_validation_remediation.sql',
  },
  '209': {
    purpose: 'Operational profile/task RLS remediation (SELECT/insert/update; no 009/010 apply).',
    dependencies: ['208'],
    expectedObjects: ['RLS policies on profiles', 'RLS policies on tasks'],
    verificationPath: 'supabase/drafts/f10c2/phase4b/verification/209_disposable_operational_profile_task_rls_remediation.sql',
    rollbackPath: 'supabase/drafts/f10c2/phase4b/rollback/209_disposable_operational_profile_task_rls_remediation.sql',
  },
  '210': {
    purpose: 'CR1-B canonical ingestion columns plus iteration and call-event tables.',
    dependencies: ['209'],
    expectedObjects: [
      'field_test_runs package/idempotency/acceptance columns',
      'table field_test_iterations',
      'table field_test_call_events',
    ],
    verificationPath: 'supabase/drafts/f10c2/phase4b/verification/210_cr1b_canonical_ingestion_schema.sql',
    rollbackPath: 'supabase/drafts/f10c2/phase4b/rollback/210_cr1b_canonical_ingestion_schema.sql',
  },
  '211': {
    purpose: 'CR1-B acceptance engine schema (versioned profiles, rules, immutable snapshots, evaluations).',
    dependencies: ['210', '201'],
    expectedObjects: [
      'table acceptance_profiles',
      'table acceptance_rules',
      'table acceptance_rule_snapshots / evaluations (engine tables)',
    ],
    verificationPath: 'supabase/drafts/f10c2/phase4b/verification/211_cr1b_acceptance_engine_schema.sql',
    rollbackPath: 'supabase/drafts/f10c2/phase4b/rollback/211_cr1b_acceptance_engine_schema.sql',
  },
  '212': {
    purpose: 'CR1-B ingest / evaluate / profile / QC SECURITY DEFINER RPCs.',
    dependencies: ['211'],
    expectedObjects: [
      'function cr1b_combine_verdicts',
      'function ingest_field_test_canonical_result',
      'function evaluate_field_test_run_acceptance',
      'profile upsert / QC override RPCs',
    ],
    verificationPath: 'supabase/drafts/f10c2/phase4b/verification/212_cr1b_rpc_ingest_evaluate_qc.sql',
    rollbackPath: 'supabase/drafts/f10c2/phase4b/rollback/212_cr1b_rpc_ingest_evaluate_qc.sql',
  },
  '213': {
    purpose: 'CR1-B RLS and grants: SELECT for authenticated; mutations via SECURITY DEFINER RPC.',
    dependencies: ['212'],
    expectedObjects: ['RLS on acceptance + iteration/call tables', 'authenticated EXECUTE grants (no anon)'],
    verificationPath: 'supabase/drafts/f10c2/phase4b/verification/213_cr1b_rls_grants.sql',
    rollbackPath: 'supabase/drafts/f10c2/phase4b/rollback/213_cr1b_rls_grants.sql',
  },
  '215': {
    purpose: 'CR1-D acceptance profile management (scenario-aware upsert/list/assign). Skip 214 permanently.',
    dependencies: ['213'],
    expectedObjects: [
      'acceptance_profiles.description / scenario_family',
      'profile management RPCs (upsert/list/assign)',
    ],
    verificationPath: 'supabase/drafts/f10c2/phase4b/verification/215_cr1d_acceptance_profile_management.sql',
    rollbackPath: 'supabase/drafts/f10c2/phase4b/rollback/215_cr1d_acceptance_profile_management.sql',
  },
  '216': {
    purpose: 'CR1-E set_acceptance_profile_active SECURITY DEFINER RPC (no client UPDATE policy).',
    dependencies: ['215'],
    expectedObjects: ['function set_acceptance_profile_active', 'authenticated EXECUTE; anon REVOKE'],
    verificationPath: 'supabase/drafts/f10c2/phase4b/verification/216_cr1e_acceptance_profile_status.sql',
    rollbackPath: 'supabase/drafts/f10c2/phase4b/rollback/216_cr1e_acceptance_profile_status.sql',
  },
}

export const NEVER_RUN_214_PATHS = Object.freeze({
  quarantineDir: CR1_NEVER_RUN_DIR,
  forward: `${CR1_NEVER_RUN_DIR}/214_cr1b_acceptance_applicability.forward.sql`,
  verification: `${CR1_NEVER_RUN_DIR}/214_cr1b_acceptance_applicability.verification.sql`,
  rollback: `${CR1_NEVER_RUN_DIR}/214_cr1b_acceptance_applicability.rollback.sql`,
  readme: `${CR1_NEVER_RUN_DIR}/README.md`,
})

export function numberFromPath(relPath) {
  const base = path.posix.basename(relPath.replace(/\\/g, '/'))
  const match = base.match(/^(\d{3})_/)
  return match ? match[1] : ''
}

export function sha256File(absPath) {
  const buf = fs.readFileSync(absPath)
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function slugFromPath(relPath) {
  const base = path.posix.basename(relPath.replace(/\\/g, '/'))
  return base.replace(/\.sql$/i, '')
}

function looksLikeRangeOrGlob(relPath) {
  return /[*?]|…|\.\.\.|[–—]/.test(relPath)
}

export function listPermanentStagingAllowlist() {
  const reasons = []
  if (PERMANENT_STAGING_FORWARD_PATHS.some(looksLikeRangeOrGlob)) {
    reasons.push('allowlist contains a range or glob — refuse directory-wide discovery')
  }

  const numbers = PERMANENT_STAGING_FORWARD_PATHS.map(numberFromPath)
  const seen = new Set()
  for (const n of numbers) {
    if (!n) reasons.push('allowlist entry missing a three-digit number')
    if (seen.has(n)) reasons.push(`duplicate number ${n}`)
    seen.add(n)
    if (NEVER_EXECUTE_NUMBERS.includes(n)) reasons.push(`never-run number leaked into allowlist: ${n}`)
  }

  const expected = [...EXPECTED_ALLOWLIST_NUMBERS]
  if (numbers.join(',') !== expected.join(',')) {
    reasons.push('allowlist numbers are not the exact expected sequence')
  }

  const entries = PERMANENT_STAGING_FORWARD_PATHS.map((forwardPath, index) => {
    const number = numberFromPath(forwardPath)
    const slug = slugFromPath(forwardPath)
    const meta = META[number]
    if (!meta) reasons.push(`missing metadata for ${number}`)
    return {
      index: index + 1,
      number,
      slug,
      forwardPath,
      purpose: meta?.purpose || '',
      dependencies: meta?.dependencies || [],
      previouslyValidatedOnDisposable: meta?.previouslyValidatedOnDisposable !== false && !meta?.stagingAdapter,
      disposableValidationStatus: meta?.disposableValidationStatus
        || 'validated on disposable evidence project; required on empty staging',
      requiredOnEmptyStagingDb: true,
      verificationPath: meta?.verificationPath || '',
      rollbackPath: meta?.rollbackPath || '',
      expectedObjects: meta?.expectedObjects || [],
      applyAdapterNote: meta?.applyAdapterNote || null,
      stagingAdapter: Boolean(meta?.stagingAdapter),
    }
  })

  const numberSet = new Set(numbers)
  for (const entry of entries) {
    for (const dep of entry.dependencies) {
      if (!numberSet.has(dep)) {
        reasons.push(`${entry.number} depends on ${dep} which is not in the allowlist`)
      }
      if (NEVER_EXECUTE_NUMBERS.includes(dep)) {
        reasons.push(`${entry.number} depends on never-run ${dep}`)
      }
    }
  }

  assertNo214InApplyList(entries.map((e) => e.slug), 'permanentStagingAllowlist')

  const phase4b = listPhase4bApplyPlan()
  const composed = [
    ...phase4b.stages.map((s) => s.slug),
    ...CR1D_APPLY,
    ...CR1E_APPLY,
  ]
  const allowlistSlugs = entries.map((e) => e.slug)
  if (allowlistSlugs[0] !== STAGING_BOOTSTRAP_SLUG) {
    reasons.push('staging allowlist slot 000 is not the permanent-staging adapter')
  }
  if (allowlistSlugs.includes(HISTORICAL_DISPOSABLE_BOOTSTRAP_SLUG)) {
    reasons.push('historical disposable 000 leaked into the staging allowlist')
  }
  if (PERMANENT_STAGING_FORWARD_PATHS.includes(HISTORICAL_DISPOSABLE_BOOTSTRAP_FORWARD)) {
    reasons.push('historical disposable 000 path is in the staging allowlist')
  }
  if (composed[0] !== HISTORICAL_DISPOSABLE_BOOTSTRAP_SLUG) {
    reasons.push('phase4b disposable plan bootstrap slug unexpectedly changed')
  }
  if (composed.slice(1).join(',') !== allowlistSlugs.slice(1).join(',')) {
    reasons.push('staging allowlist tail does not match listPhase4bApplyPlan() plus 215 plus 216 after adapter slot 000')
  }
  if (entries.length !== EXPECTED_ALLOWLIST_COUNT) {
    reasons.push(`staging allowlist count is ${entries.length}, expected ${EXPECTED_ALLOWLIST_COUNT} (adapter replaces 000; not an extra 46th file)`)
  }
  if (allowlistSlugs.some((s) => F10C1I_SKIP.includes(s) || F10C2_SKIP.includes(s) || PHASE4A_NEVER_EXECUTE.includes(s) || CR1_NEVER_RUN.includes(s))) {
    reasons.push('skipped or never-execute slug leaked into permanent-staging allowlist')
  }

  return {
    ok: reasons.length === 0,
    reasons,
    entries,
    skipped: [...F10C1I_SKIP, ...F10C2_SKIP],
    neverExecute: [...PHASE4A_NEVER_EXECUTE, ...CR1_NEVER_RUN],
    neverExecuteNumbers: [...NEVER_EXECUTE_NUMBERS],
  }
}

export function assertPermanentStagingPlanFilesExist(cwd = ROOT) {
  const plan = listPermanentStagingAllowlist()
  const missing = []
  const present = []
  for (const entry of plan.entries) {
    for (const rel of [entry.forwardPath, entry.verificationPath, entry.rollbackPath]) {
      const abs = path.join(cwd, rel)
      if (fs.existsSync(abs)) present.push(rel)
      else missing.push(rel)
    }
  }
  const leaked214Forward = plan.entries.filter((e) => e.number === '214' || e.slug.startsWith('214_'))
  const quarantineOk = [
    NEVER_RUN_214_PATHS.forward,
    NEVER_RUN_214_PATHS.verification,
    NEVER_RUN_214_PATHS.rollback,
    NEVER_RUN_214_PATHS.readme,
  ].every((rel) => fs.existsSync(path.join(cwd, rel)))
  const leaked214InExecutable = [
    'supabase/drafts/f10c2/phase4b/forward/214_cr1b_acceptance_applicability.sql',
    'supabase/drafts/f10c2/phase4b/verification/214_cr1b_acceptance_applicability.sql',
    'supabase/drafts/f10c2/phase4b/rollback/214_cr1b_acceptance_applicability.sql',
  ].filter((rel) => fs.existsSync(path.join(cwd, rel)))

  return {
    ok: plan.ok && missing.length === 0 && leaked214Forward.length === 0 && quarantineOk && leaked214InExecutable.length === 0,
    planOk: plan.ok,
    planReasons: plan.reasons,
    missing,
    presentCount: present.length,
    leaked214Forward,
    leaked214InExecutable,
    quarantineOk,
    count: plan.entries.length,
  }
}

export function computeAllowlistHashes(cwd = ROOT) {
  return PERMANENT_STAGING_FORWARD_PATHS.map((forwardPath) => {
    const abs = path.join(cwd, forwardPath)
    return {
      number: numberFromPath(forwardPath),
      slug: slugFromPath(forwardPath),
      path: forwardPath,
      sha256: fs.existsSync(abs) ? sha256File(abs) : null,
      exists: fs.existsSync(abs),
    }
  })
}

export function loadExpectedAllowlistHashes(cwd = ROOT) {
  const abs = path.join(cwd, HASH_MANIFEST_REL)
  if (!fs.existsSync(abs)) {
    return { ok: false, missing: true, files: [], algorithm: 'sha256' }
  }
  const parsed = JSON.parse(fs.readFileSync(abs, 'utf8'))
  return {
    ok: true,
    missing: false,
    algorithm: parsed.algorithm || 'sha256',
    count: parsed.count,
    adapterReplacesDisposable000: parsed.adapterReplacesDisposable000 === true,
    files: Array.isArray(parsed.files) ? parsed.files : [],
  }
}

export function assertAllowlistHashesMatch(cwd = ROOT) {
  const expected = loadExpectedAllowlistHashes(cwd)
  const actual = computeAllowlistHashes(cwd)
  const mismatches = []
  if (expected.missing) {
    mismatches.push(`missing hash manifest ${HASH_MANIFEST_REL}`)
  }
  if (expected.ok && expected.adapterReplacesDisposable000 !== true) {
    mismatches.push('hash manifest must record adapterReplacesDisposable000=true')
  }
  const expectedByPath = new Map((expected.files || []).map((f) => [f.path, f]))
  for (const row of actual) {
    const exp = expectedByPath.get(row.path)
    if (!exp) {
      mismatches.push(`no expected hash for ${row.path}`)
      continue
    }
    if (!row.sha256) {
      mismatches.push(`missing file for hash ${row.path}`)
      continue
    }
    if (String(exp.sha256).toLowerCase() !== String(row.sha256).toLowerCase()) {
      mismatches.push(`hash mismatch ${row.number} ${row.path}`)
    }
  }
  for (const exp of expected.files || []) {
    if (!actual.some((row) => row.path === exp.path)) {
      mismatches.push(`expected hash path not in allowlist ${exp.path}`)
    }
  }
  if (expected.ok && Number(expected.count) !== actual.length) {
    mismatches.push(`hash manifest count ${expected.count} != allowlist ${actual.length}`)
  }
  return {
    ok: mismatches.length === 0,
    mismatches,
    actual,
    expected,
  }
}

export { ROOT, META }
