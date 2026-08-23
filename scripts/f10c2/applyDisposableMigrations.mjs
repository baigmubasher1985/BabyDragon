/**
 * Apply accepted F10C1I (a) + F10C2 (a) drafts to a proven disposable target only.
 * Fail closed if identity is uncertain. Does not apply blocked documentation-only drafts.
 *
 * Usage: node scripts/f10c2/applyDisposableMigrations.mjs
 * Requires: F10C2_DISPOSABLE_DB_URL in .env.disposable (never VITE_ / never production).
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDisposableEnv, parseEnvFile } from './loadDisposableEnv.mjs'
import { assertDisposableTarget } from '../../src/lib/disposableSupabaseGuard.js'

const __filename = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename), '../..')

const F10C1I_APPLY = [
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

const F10C1I_SKIP = ['009_rls_profiles', '010_rls_tasks', '012_rls_task_checklist_items', '013_rls_task_issue_reports']

const F10C2_APPLY = [
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

const F10C2_SKIP = ['112_result_artifacts_storage_contract']

function forwardPath(kind, slug) {
  if (kind === 'f10c1i') return path.join(ROOT, 'supabase/drafts/forward', `${slug}.sql`)
  return path.join(ROOT, 'supabase/drafts/f10c2/forward', `${slug}.sql`)
}

export function listApplyPlan() {
  return {
    f10c1i: F10C1I_APPLY.map((slug) => ({ slug, file: forwardPath('f10c1i', slug), skip: false })),
    f10c1iSkipped: F10C1I_SKIP,
    f10c2: F10C2_APPLY.map((slug) => ({ slug, file: forwardPath('f10c2', slug), skip: false })),
    f10c2Skipped: F10C2_SKIP,
  }
}

function runPsql(dbUrl, file) {
  const psql = spawnSync('psql', ['--set', 'ON_ERROR_STOP=1', '-v', 'ON_ERROR_STOP=1', '-f', file, dbUrl], {
    encoding: 'utf8',
    windowsHide: true,
  })
  return psql
}

function main() {
  const loaded = loadDisposableEnv(ROOT)
  const appEnv = parseEnvFile(path.join(ROOT, '.env'))
  const env = loaded.env
  const identity = assertDisposableTarget({
    disposableUrl: env.F10C2_DISPOSABLE_SUPABASE_URL,
    appViteUrl: env.VITE_SUPABASE_URL || appEnv.VITE_SUPABASE_URL,
    confirmed: env.F10C2_DISPOSABLE_CONFIRMED,
    deniedProductionRef: env.F10C2_DENIED_PRODUCTION_REF,
    explicitDisposableRef: env.F10C2_DISPOSABLE_PROJECT_REF,
    commandCategory: 'migration-apply',
    changesDisposableProject: true,
  })

  console.log('F10C2 Phase 4 migration apply')
  console.log(`- target project reference: ${identity.projectRefRedacted}`)
  console.log(`- target URL hostname: ${identity.hostname}`)
  console.log('- confirmation disposable: yes')
  console.log('- command category: migration-apply')
  console.log('- changes disposable project: yes')

  const dbUrl = env.F10C2_DISPOSABLE_DB_URL
  if (!dbUrl) {
    console.error('BLOCKED: F10C2_DISPOSABLE_DB_URL missing. No SQL executed.')
    process.exit(2)
  }

  const plan = listApplyPlan()
  const files = [...plan.f10c1i, ...plan.f10c2]
  for (const step of files) {
    if (!fs.existsSync(step.file)) {
      console.error(`BLOCKED: missing draft ${step.slug}`)
      process.exit(2)
    }
  }

  const applied = []
  for (const step of files) {
    console.log(`APPLY ${step.slug}`)
    const result = runPsql(dbUrl, step.file)
    if (result.error && result.error.code === 'ENOENT') {
      console.error('BLOCKED: psql is not installed. No further SQL executed.')
      process.exit(2)
    }
    if (result.status !== 0) {
      console.error(`FAILED at ${step.slug}`)
      const errText = String(result.stderr || result.stdout || '').slice(0, 400)
      console.error(errText.replace(/postgres:\/\/[^ \n]+/gi, 'postgres://[redacted]'))
      console.error(`Applied before failure: ${applied.join(', ') || '(none)'}`)
      process.exit(1)
    }
    applied.push(step.slug)
  }

  console.log(`RESULT: applied ${applied.length} drafts to disposable target ${identity.projectRefRedacted}`)
  console.log(`Skipped blocked: ${[...F10C1I_SKIP, ...F10C2_SKIP].join(', ')}`)
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === __filename
if (invokedDirectly) {
  try {
    main()
  } catch (error) {
    console.error(String(error.message || error))
    process.exit(2)
  }
}

export { F10C1I_APPLY, F10C1I_SKIP, F10C2_APPLY, F10C2_SKIP }
