/**
 * F10C2 Phase 4B — ordered disposable apply plan (local inventory only).
 * Does not connect to a database. Migration 207 is never executable.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BOOTSTRAP_SLUG } from './operationalBootstrapContract.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export const BOOTSTRAP_APPLY = [BOOTSTRAP_SLUG]

export const F10C1I_APPLY = [
  '001_security_audit_log',
  '002_harden_existing_functions',
  '003_security_helpers',
  '004_rpc_update_assigned_task_status',
  '005_rpc_update_assigned_checklist_item',
  '006_rpc_insert_assigned_task_issue',
  '007_rpc_insert_assigned_task_update',
  '008_execute_grants',
  '011_rls_task_updates',
  '014_rls_task_grids',
  '015_rls_projects',
  '016_rls_grids',
  '017_rls_routes',
  '018_rls_route_grids',
  '019_rls_cell_files_sites_sectors',
  '020_operational_evidence_schema_contract',
]

export const F10C1I_SKIP = [
  '009_rls_profiles',
  '010_rls_tasks',
  '012_rls_task_checklist_items',
  '013_rls_task_issue_reports',
]

export const F10C2_APPLY = [
  '101_field_test_runs',
  '102_field_test_artifacts',
  '103_field_test_metrics',
  '104_field_test_qc_reviews',
  '105_rpc_submit_field_test_run',
  '106_rpc_register_field_test_artifact',
  '107_rpc_complete_field_test_artifact_upload',
  '108_rpc_submit_field_test_qc_review',
  '109_rls_field_test_runs',
  '110_rls_field_test_artifacts_metrics',
  '111_rls_field_test_qc_reviews',
  '113_rpc_finalize_field_test_run',
  '114_result_artifacts_private_bucket',
  '115_field_test_execute_grants',
]

export const F10C2_SKIP = ['112_result_artifacts_storage_contract']

export const PHASE4A_APPLY = [
  '201_tenants',
  '202_storage_connections',
  '203_tenant_storage_policies',
  '204_field_test_artifacts_tenant_columns',
  '205_artifact_transfer_jobs',
  '206_rpc_request_artifact_upload_plan',
]

export const PHASE4A_NEVER_EXECUTE = ['207_rls_tenant_storage_assumptions']

/** Additive after 206. Fresh install: 000 … 206, then 208. Existing 4B-E disposable: 208 only. */
export const PHASE4B_R1_APPLY = ['208_phase4b_validation_remediation']

function f10c1iPath(slug) {
  return path.join(ROOT, 'supabase/drafts/forward', `${slug}.sql`)
}
function f10c2Path(slug) {
  return path.join(ROOT, 'supabase/drafts/f10c2/forward', `${slug}.sql`)
}
function phase4aPath(slug) {
  return path.join(ROOT, 'supabase/drafts/f10c2/phase4a/forward', `${slug}.sql`)
}
function bootstrapPath(slug) {
  return path.join(ROOT, 'supabase/drafts/f10c2/phase4b/bootstrap', `${slug}.sql`)
}
function phase4bR1Path(slug) {
  return path.join(ROOT, 'supabase/drafts/f10c2/phase4b/forward', `${slug}.sql`)
}

export function listPhase4bApplyPlan() {
  const stages = [
    ...BOOTSTRAP_APPLY.map((slug) => ({
      stage: 'operational-bootstrap',
      family: 'phase4b-bootstrap',
      slug,
      file: bootstrapPath(slug),
    })),
    ...F10C1I_APPLY.map((slug) => ({
      stage: 'security-baseline',
      family: 'f10c1i',
      slug,
      file: f10c1iPath(slug),
    })),
    ...F10C2_APPLY.map((slug) => ({
      stage: 'unified-result-schema',
      family: 'f10c2',
      slug,
      file: f10c2Path(slug),
    })),
    ...PHASE4A_APPLY.map((slug) => ({
      stage: 'tenant-storage-model',
      family: 'phase4a',
      slug,
      file: phase4aPath(slug),
    })),
    ...PHASE4B_R1_APPLY.map((slug) => ({
      stage: 'validation-remediation',
      family: 'phase4b-r1',
      slug,
      file: phase4bR1Path(slug),
    })),
  ]
  return {
    stages,
    skipped: [...F10C1I_SKIP, ...F10C2_SKIP],
    neverExecute: [...PHASE4A_NEVER_EXECUTE],
  }
}

export function assertPhase4bPlanFilesExist() {
  const plan = listPhase4bApplyPlan()
  const missing = plan.stages.filter((s) => !fs.existsSync(s.file)).map((s) => s.slug)
  const leaked207 = plan.stages.filter((s) => s.slug.startsWith('207_'))
  return { missing, leaked207, count: plan.stages.length }
}

export { ROOT }
