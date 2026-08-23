/**
 * Phase 4B-S bootstrap wrapper. DEFAULT DRY-RUN. Never opens a database
 * in this pass. SET LOCAL is emitted only after the JS target guard and
 * SQL execution approval — and even then --execute remains blocked until 4B-E.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDisposableEnv, parseEnvFile } from './loadDisposableEnv.mjs'
import {
  buildDisposableSqlSessionPreamble,
  DISPOSABLE_SQL_MARKER_STATEMENT,
} from '../../src/lib/phase4bSqlSessionGuard.js'
import { BOOTSTRAP_SLUG } from './operationalBootstrapContract.mjs'

const __filename = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename), '../..')
const wantExecute = process.argv.includes('--execute')

function targetInput(env, appEnv) {
  return {
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
    commandCategory: 'phase4b-operational-bootstrap',
    changesDisposableProject: true,
  }
}

function main() {
  console.log('F10C2 Phase 4B-S disposable operational schema bootstrap')
  console.log(`slug: ${BOOTSTRAP_SLUG}`)
  console.log('207: NEVER EXECUTE (not part of bootstrap)')

  if (!wantExecute) {
    console.log('DRY-RUN: refusing to open a database connection.')
    console.log(`wrapper would set ${DISPOSABLE_SQL_MARKER_STATEMENT} only after JS target guard + SQL approval.`)
    process.exit(0)
  }

  const loaded = loadDisposableEnv(ROOT)
  const appEnv = parseEnvFile(path.join(ROOT, '.env'))
  const preamble = buildDisposableSqlSessionPreamble(targetInput(loaded.env, appEnv))
  console.log(`dual-guard preamble ready: ${preamble.transactionStart} ${preamble.marker}`)
  console.error('BLOCKED: SQL execution is not authorized in Phase 4B-S. Waiting for Phase 4B-E.')
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
