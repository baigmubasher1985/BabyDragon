/**
 * Disposable-only synthetic cleanup. DEFAULT DRY-RUN. No database connection
 * unless --execute AND cleanup confirmation AND target guard pass.
 * Phase 4B-P must not run --execute.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDisposableEnv, parseEnvFile } from './loadDisposableEnv.mjs'
import { assertPhase4bTarget } from '../../src/lib/phase4bTargetGuard.js'

const __filename = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename), '../..')
const wantExecute = process.argv.includes('--execute')

console.log('F10C2 Phase 4B synthetic cleanup')
if (!wantExecute) {
  console.log('DRY-RUN: would require target re-validation, synthetic-only deletes, and F10C2_PHASE4B_CLEANUP_CONFIRMED=yes')
  console.log('No database connection opened.')
  process.exit(0)
}

const loaded = loadDisposableEnv(ROOT)
const appEnv = parseEnvFile(path.join(ROOT, '.env'))
const env = loaded.env
if (String(env.F10C2_PHASE4B_CLEANUP_CONFIRMED || '').trim().toLowerCase() !== 'yes') {
  console.error('BLOCKED: F10C2_PHASE4B_CLEANUP_CONFIRMED is not yes. No SQL executed.')
  process.exit(2)
}
assertPhase4bTarget({
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
  commandCategory: 'phase4b-cleanup',
  changesDisposableProject: true,
})
console.error('BLOCKED: cleanup execution is not authorized in Phase 4B-P.')
process.exit(2)
