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

/**
 * Additive after 208. Fresh disposable: … 208 then 209.
 * Existing 4B-E/4B-U disposable: apply ONLY 209.
 * 207 remains NEVER EXECUTE. 009/010/012/013/112 remain excluded.
 */
export const PHASE4B_U_R1_APPLY = ['209_disposable_operational_profile_task_rls_remediation']

/**
 * Additive after 209. Existing disposable: apply ONLY 210–213.
 * 207 remains NEVER EXECUTE. 009/010/012/013/112 remain excluded.
 */
export const CR1B_APPLY = [
  '210_cr1b_canonical_ingestion_schema',
  '211_cr1b_acceptance_engine_schema',
  '212_cr1b_rpc_ingest_evaluate_qc',
  '213_cr1b_rls_grants',
]

/**
 * SQL 214 is quarantined. Never draft-in-forward. Never execute.
 * Archive: supabase/drafts/f10c2/never-run/214/
 * Canonical order: 210 → 211 → 212 → 213 → skip 214 → 215 → 216
 */
export const CR1_NEVER_RUN = ['214_cr1b_acceptance_applicability']
export const CR1_NEVER_RUN_DIR = 'supabase/drafts/f10c2/never-run/214'

/**
 * Empty on purpose. 214 is not a draft-in-forward slug; it is CR1_NEVER_RUN.
 * Kept so scanners still see the export name.
 */
export const CR1D_DRAFT_ONLY = []

/**
 * Authorized CR1-D one-shot on disposable only. Existing disposable: apply ONLY 215.
 * Do not add 214. Do not reapply 209–213. 207 remains NEVER EXECUTE.
 */
export const CR1D_APPLY = [
  '215_cr1d_acceptance_profile_management',
]

/**
 * Authorized CR1-E one-shot on disposable only. Existing disposable: apply ONLY 216.
 * Do not add 214. Do not reapply 209–215. 207 remains NEVER EXECUTE.
 * Do not add to listPhase4bApplyPlan(), CR1B_APPLY, or CR1D_APPLY.
 */
export const CR1E_APPLY = [
  '216_cr1e_acceptance_profile_status',
]

/**
 * CR1-E-R1 grant hardening is draft-only. Do not add 217 to CR1E_APPLY,
 * listPhase4bApplyPlan(), or the permanent-staging 45-path allowlist until
 * the owner authorizes a later SQL pass. 216 stays CR1E_APPLY one-shot.
 * 214 is CR1_NEVER_RUN, not draft-in-forward.
 */
export const CR1E_DRAFT_ONLY = [
  '217_cr1e_staging_grant_hardening',
]

/** Fresh-chain CR1 SQL after 209: 210 → 211 → 212 → 213 → skip 214 → 215 → 216 */
export const CR1_CANONICAL_APPLY_AFTER_209 = [
  ...CR1B_APPLY,
  ...CR1D_APPLY,
  ...CR1E_APPLY,
]

export function assertNo214InApplyList(slugs, context = 'apply') {
  const leaked = (slugs || []).filter((s) => String(s).startsWith('214_') || String(s) === '214')
  if (leaked.length) {
    throw new Error(`SQL 214 leaked into ${context} list: ${leaked.join(',')}`)
  }
  return true
}

export function find214InExecutableMigrationPaths() {
  const dirs = [
    'supabase/drafts/f10c2/phase4b/forward',
    'supabase/drafts/f10c2/phase4b/verification',
    'supabase/drafts/f10c2/phase4b/rollback',
  ]
  const hits = []
  for (const dir of dirs) {
    const abs = path.join(ROOT, dir)
    if (!fs.existsSync(abs)) continue
    for (const name of fs.readdirSync(abs)) {
      if (name.startsWith('214_') || name.startsWith('214.')) {
        hits.push(`${dir}/${name}`)
      }
    }
  }
  return hits
}

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
    ...PHASE4B_U_R1_APPLY.map((slug) => ({
      stage: 'profile-task-rls-remediation',
      family: 'phase4b-u-r1',
      slug,
      file: phase4bR1Path(slug),
    })),
    ...CR1B_APPLY.map((slug) => ({
      stage: 'cr1b-acceptance',
      family: 'cr1b',
      slug,
      file: phase4bR1Path(slug),
    })),
  ]
  const slugs = stages.map((s) => s.slug)
  assertNo214InApplyList(slugs, 'listPhase4bApplyPlan')
  return {
    stages,
    skipped: [...F10C1I_SKIP, ...F10C2_SKIP],
    neverExecute: [...PHASE4A_NEVER_EXECUTE, ...CR1_NEVER_RUN],
  }
}

export function listExistingDisposable209Apply() {
  return PHASE4B_U_R1_APPLY.map((slug) => ({
    stage: 'profile-task-rls-remediation',
    family: 'phase4b-u-r1',
    slug,
    file: phase4bR1Path(slug),
  }))
}

export function listExistingDisposableCr1bApply() {
  assertNo214InApplyList(CR1B_APPLY, 'CR1B_APPLY')
  return CR1B_APPLY.map((slug) => ({
    stage: 'cr1b-acceptance',
    family: 'cr1b',
    slug,
    file: phase4bR1Path(slug),
  }))
}

export function listExistingDisposableCr1dApply() {
  assertNo214InApplyList(CR1D_APPLY, 'CR1D_APPLY')
  return CR1D_APPLY.map((slug) => ({
    stage: 'cr1d-profile-management',
    family: 'cr1d',
    slug,
    file: phase4bR1Path(slug),
  }))
}

export function listExistingDisposableCr1eApply() {
  assertNo214InApplyList(CR1E_APPLY, 'CR1E_APPLY')
  return CR1E_APPLY.map((slug) => ({
    stage: 'cr1e-profile-status',
    family: 'cr1e',
    slug,
    file: phase4bR1Path(slug),
  }))
}

export function assertPhase4bPlanFilesExist() {
  const plan = listPhase4bApplyPlan()
  const missing = plan.stages.filter((s) => !fs.existsSync(s.file)).map((s) => s.slug)
  const leaked207 = plan.stages.filter((s) => s.slug.startsWith('207_'))
  const leaked214 = [
    ...plan.stages.filter((s) => s.slug.startsWith('214_')),
    ...find214InExecutableMigrationPaths(),
  ]
  assertNo214InApplyList(plan.stages.map((s) => s.slug), 'assertPhase4bPlanFilesExist')
  assertNo214InApplyList(CR1B_APPLY, 'CR1B_APPLY')
  assertNo214InApplyList(CR1D_APPLY, 'CR1D_APPLY')
  assertNo214InApplyList(CR1E_APPLY, 'CR1E_APPLY')
  assertNo214InApplyList(CR1D_DRAFT_ONLY, 'CR1D_DRAFT_ONLY')
  const archiveMissing = !fs.existsSync(path.join(ROOT, CR1_NEVER_RUN_DIR, 'README.md'))
  return { missing, leaked207, leaked214, archiveMissing, count: plan.stages.length }
}

export { ROOT }
