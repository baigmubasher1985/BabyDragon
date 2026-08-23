/**
 * Phase 4B migration apply. DEFAULT IS DRY-RUN. Does not connect unless
 * F10C2_PHASE4B_SQL_EXECUTION_APPROVED=yes AND --execute is passed AND a
 * later Phase 4B-E approval exists. This 4B-S pass must not execute SQL.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDisposableEnv, parseEnvFile } from './loadDisposableEnv.mjs'
import { buildDisposableSqlSessionPreamble } from '../../src/lib/phase4bSqlSessionGuard.js'
import { listPhase4bApplyPlan, PHASE4A_NEVER_EXECUTE } from './phase4bApplyPlan.mjs'

const __filename = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename), '../..')
const wantExecute = process.argv.includes('--execute')

function main() {
  const plan = listPhase4bApplyPlan()
  if (plan.stages.some((s) => PHASE4A_NEVER_EXECUTE.includes(s.slug) || s.slug.startsWith('207_'))) {
    console.error('BLOCKED: 207 must never be executable')
    process.exit(2)
  }

  console.log('F10C2 Phase 4B apply (4B-S default: dry-run)')
  console.log(`executable steps: ${plan.stages.length}`)
  console.log(`first step: ${plan.stages[0]?.slug || '(none)'}`)
  console.log(`never execute: ${plan.neverExecute.join(', ')}`)

  if (!wantExecute) {
    console.log('DRY-RUN: refusing to open a database connection. Pass --execute only after Phase 4B-E SQL approval.')
    process.exit(0)
  }

  const loaded = loadDisposableEnv(ROOT)
  const appEnv = parseEnvFile(path.join(ROOT, '.env'))
  const env = loaded.env
  const preamble = buildDisposableSqlSessionPreamble({
    disposableUrl: env.F10C2_DISPOSABLE_SUPABASE_URL,
    appViteUrl: env.VITE_SUPABASE_URL || appEnv.VITE_SUPABASE_URL,
    confirmed: env.F10C2_DISPOSABLE_CONFIRMED,
    deniedProductionRef: env.F10C2_DENIED_PRODUCTION_REF,
    explicitDisposableRef: env.F10C2_DISPOSABLE_PROJECT_REF,
    projectName: env.F10C2_DISPOSABLE_PROJECT_NAME,
    syntheticDataMode: env.F10C2_SYNTHETIC_DATA_MODE,
    productionDataImport: env.F10C2_PRODUCTION_DATA_IMPORT,
    disposableDbUrl: env.F10C2_DISPOSABLE_DB_URL,
    deniedProductionDbHost: env.F10C2_DENIED_PRODUCTION_DB_HOST,
    sqlExecutionApproved: env.F10C2_PHASE4B_SQL_EXECUTION_APPROVED,
    commandCategory: 'phase4b-migration-apply',
    changesDisposableProject: true,
  })

  console.log(`dual-guard preamble: ${preamble.transactionStart} ${preamble.marker}`)
  console.error('BLOCKED: SQL execution is not authorized in Phase 4B-S. Waiting for one controlled Phase 4B-E approval.')
  process.exit(2)
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
