/**
 * Live disposable RLS/storage/scenario validation runner.
 * Fail closed when disposable identity is missing. Never targets VITE_/production.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDisposableEnv, parseEnvFile } from './loadDisposableEnv.mjs'
import { evaluateDisposableTarget } from '../../src/lib/disposableSupabaseGuard.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const loaded = loadDisposableEnv(ROOT)
const appEnv = parseEnvFile(path.join(ROOT, '.env'))
const env = loaded.env
const identity = evaluateDisposableTarget({
  disposableUrl: env.F10C2_DISPOSABLE_SUPABASE_URL,
  appViteUrl: env.VITE_SUPABASE_URL || appEnv.VITE_SUPABASE_URL,
  confirmed: env.F10C2_DISPOSABLE_CONFIRMED,
  deniedProductionRef: env.F10C2_DENIED_PRODUCTION_REF,
  explicitDisposableRef: env.F10C2_DISPOSABLE_PROJECT_REF,
  commandCategory: 'live-validation',
  changesDisposableProject: true,
})

console.log('F10C2 Phase 4 live validation')
console.log(`- target project reference: ${identity.projectRefRedacted}`)
console.log(`- target URL hostname: ${identity.hostname || '(none)'}`)
console.log(`- confirmation disposable: ${identity.ok ? 'yes' : 'NO'}`)
console.log('- command category: live-validation')
console.log('- changes disposable project: yes (synthetic rows/objects if authorized)')

if (!identity.ok) {
  console.log('BLOCKED: disposable project access required. Reasons:')
  for (const reason of identity.reasons) console.log(`  - ${reason}`)
  console.log('Human must provide a newly created disposable project in .env.disposable.')
  console.log('Do not substitute the app VITE_SUPABASE_URL / production project.')
  process.exitCode = 2
} else {
  console.log('Identity accepted, but this runner does not auto-create users or mutate without psql/auth credentials.')
  console.log('Use applyDisposableMigrations.mjs first, then a separately reviewed live matrix.')
  process.exitCode = 0
}
