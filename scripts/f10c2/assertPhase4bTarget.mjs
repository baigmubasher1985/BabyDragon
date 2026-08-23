/**
 * Phase 4B target assertion. Local env parse only. No Supabase/Postgres connection.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDisposableEnv, parseEnvFile } from './loadDisposableEnv.mjs'
import { evaluatePhase4bTarget } from '../../src/lib/phase4bTargetGuard.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const loaded = loadDisposableEnv(ROOT)
const appEnv = parseEnvFile(path.join(ROOT, '.env'))
const env = loaded.env

const evaluated = evaluatePhase4bTarget({
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
  commandCategory: 'phase4b-identity-check',
  changesDisposableProject: false,
})

console.log('F10C2 Phase 4B-P target guard (no database connection)')
console.log(`- expected project name: ${evaluated.expectedProjectName}`)
console.log(`- provided project name: ${evaluated.projectName || '(missing)'}`)
console.log(`- target project reference: ${evaluated.projectRefRedacted}`)
console.log(`- target URL hostname: ${evaluated.hostname || '(unparsed)'}`)
console.log(`- db host redacted: ${evaluated.dbHostRedacted}`)
console.log(`- synthetic-data mode: ${evaluated.syntheticDataMode ? 'yes' : 'NO'}`)
console.log(`- production data import disabled: ${evaluated.productionDataImportDisabled ? 'yes' : 'NO'}`)
console.log(`- confirmation disposable: ${evaluated.ok ? 'yes' : 'NO'}`)
console.log(`- .env.disposable present: ${loaded.fileExists ? 'yes' : 'NO'}`)

if (!evaluated.ok) {
  console.error('RESULT: rejected')
  for (const reason of evaluated.reasons) console.error(`  - ${reason}`)
  process.exitCode = 2
} else {
  console.log('RESULT: Phase 4B disposable target accepted (identity only; SQL not authorized)')
}
