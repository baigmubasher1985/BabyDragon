/**
 * Fail-closed disposable target assertion for Phase 4 scripts.
 * Usage: node scripts/f10c2/assertDisposableTarget.mjs
 * Never prints secrets or full URLs.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDisposableEnv, parseEnvFile } from './loadDisposableEnv.mjs'
import {
  assertDisposableTarget,
  evaluateDisposableTarget,
} from '../../src/lib/disposableSupabaseGuard.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function banner(evalResult, category, changes) {
  console.log('F10C2 Phase 4 disposable target preflight')
  console.log(`- target project reference: ${evalResult.projectRefRedacted}`)
  console.log(`- target URL hostname: ${evalResult.hostname || '(unparsed)'}`)
  console.log(`- confirmation disposable: ${evalResult.ok ? 'yes' : 'NO'}`)
  console.log(`- command category: ${category}`)
  console.log(`- changes disposable project: ${changes ? 'yes' : 'no'}`)
  console.log(`- app/production VITE host redacted: ${evalResult.appHostRedacted}`)
}

const category = process.argv[2] || 'identity-check'
const changes = process.argv.includes('--changes')

const loaded = loadDisposableEnv(ROOT)
const appEnv = parseEnvFile(path.join(ROOT, '.env'))
const env = loaded.env

const input = {
  disposableUrl: env.F10C2_DISPOSABLE_SUPABASE_URL,
  appViteUrl: env.VITE_SUPABASE_URL || appEnv.VITE_SUPABASE_URL,
  confirmed: env.F10C2_DISPOSABLE_CONFIRMED,
  deniedProductionRef: env.F10C2_DENIED_PRODUCTION_REF,
  explicitDisposableRef: env.F10C2_DISPOSABLE_PROJECT_REF,
  commandCategory: category,
  changesDisposableProject: changes,
}

const evaluated = evaluateDisposableTarget(input)
banner(evaluated, category, changes)

if (!loaded.fileExists) {
  console.log('BLOCKER: .env.disposable is missing. Copy .env.disposable.example and fill disposable-only values.')
}

try {
  assertDisposableTarget(input)
  console.log('RESULT: disposable target accepted')
} catch (error) {
  console.error(`RESULT: rejected — ${error.message}`)
  process.exitCode = 2
}
