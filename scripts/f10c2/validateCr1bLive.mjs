/**
 * F10C2 CR1-B — live disposable verification + RLS matrix. Never prints secrets.
 */
import dns from 'node:dns'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadDisposableEnv, parseEnvFile } from './loadDisposableEnv.mjs'
import { evaluatePhase4bSqlSessionGuard } from '../../src/lib/phase4bSqlSessionGuard.js'
import {
  AUTHORIZED_DISPOSABLE_API_HOST,
  AUTHORIZED_DISPOSABLE_PROJECT_REF,
  DENIED_PRODUCTION_REF_PREFIX,
} from '../../src/lib/phase4bTargetGuard.js'
import { CR1B_APPLY } from './phase4bApplyPlan.mjs'

const __filename = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename), '../..')
const EVIDENCE = path.join(ROOT, '..', 'Audit Data', 'F10C2', 'CR1-B')

function redact(text) {
  return String(text || '')
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, 'postgres://[redacted]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt-redacted]')
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9]+/g, '[supabase-key-redacted]')
    .replace(/(password|pwd|secret|apikey|api_key)[=:][^\s&]+/gi, '$1=[redacted]')
}

function writeEvidence(name, body) {
  fs.mkdirSync(EVIDENCE, { recursive: true })
  fs.writeFileSync(path.join(EVIDENCE, name), redact(body), 'utf8')
}

async function ensurePostgresClient() {
  const dest = path.join(os.tmpdir(), 'f10c2-phase4be-pg')
  const entry = path.join(dest, 'node_modules/postgres/src/index.js')
  if (!fs.existsSync(entry)) {
    throw new Error('postgres_client_missing')
  }
  return (await import(pathToFileURL(entry).href)).default
}

async function main() {
  const loaded = loadDisposableEnv(ROOT)
  const env = { ...loaded.env, ...parseEnvFile(path.join(ROOT, '.env.disposable')) }
  const appEnv = parseEnvFile(path.join(ROOT, '.env'))
  const session = evaluatePhase4bSqlSessionGuard({
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
    commandCategory: 'cr1b-live-validate',
    changesDisposableProject: false,
  })
  if (!session.ok) throw new Error(`target_rejected: ${session.reasons.join('; ')}`)
  if (String(session.projectRef || '').toLowerCase() !== AUTHORIZED_DISPOSABLE_PROJECT_REF) {
    throw new Error('unauthorized_ref')
  }
  if (String(session.hostname || '').toLowerCase() !== AUTHORIZED_DISPOSABLE_API_HOST) {
    throw new Error('unauthorized_host')
  }
  if (String(session.projectRef || '').toLowerCase().startsWith(DENIED_PRODUCTION_REF_PREFIX)) {
    throw new Error('production_prefix')
  }

  dns.setDefaultResultOrder('ipv4first')
  const postgres = await ensurePostgresClient()
  const sql = postgres(env.F10C2_DISPOSABLE_DB_URL, {
    ssl: { rejectUnauthorized: false },
    max: 1,
    prepare: false,
    connect_timeout: 30,
    idle_timeout: 20,
    onnotice: () => {},
  })
  try {
    const rls = await sql.unsafe(`
      SELECT c.relname, c.relrowsecurity AS rls_enabled, COUNT(pol.oid)::int AS policy_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_policy pol ON pol.polrelid = c.oid
      WHERE n.nspname = 'public'
        AND c.relname IN (
          'field_test_iterations',
          'field_test_call_events',
          'acceptance_profiles',
          'acceptance_rules',
          'field_test_run_acceptance_snapshots',
          'field_test_iteration_evaluations',
          'field_test_call_summaries',
          'qc_verdict_overrides'
        )
      GROUP BY c.relname, c.relrowsecurity
      ORDER BY 1
    `)
    const grants = await sql.unsafe(`
      SELECT p.proname,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN (
          'ingest_field_test_canonical_result',
          'upsert_acceptance_profile',
          'override_field_test_acceptance_verdict',
          'evaluate_field_test_run_acceptance'
        )
      ORDER BY 1
    `)
    const leaked207 = await sql.unsafe(`
      SELECT COUNT(*)::int AS n FROM pg_policy
      WHERE polname ILIKE '%207%' OR polname ILIKE '%tenant_storage_assumptions%'
    `)
    if (Number(leaked207[0].n || 0) !== 0) throw new Error('207_leaked')
    if (grants.some((g) => g.anon_execute === true)) throw new Error('anon_execute_present')
    if (rls.some((row) => row.rls_enabled !== true)) throw new Error('rls_not_enabled')

    writeEvidence('F10C2_CR1B_RLS_Matrix.json', JSON.stringify({ rls, grants }, null, 2))
    writeEvidence(
      'F10C2_CR1B_Live_Verification.txt',
      [
        `tables=${rls.length}`,
        `rpcs=${grants.length}`,
        `anon_execute=false`,
        `rls_enabled=true`,
        `207_leaked=false`,
        `cr1b_slugs=${CR1B_APPLY.join(',')}`,
      ].join('\n') + '\n',
    )
    console.log('CR1-B live RLS matrix verified')
  } finally {
    await sql.end({ timeout: 2 })
  }
}

main().catch((error) => {
  console.error(`VALIDATE_CR1B_FAILED: ${redact(error.message || error)}`)
  process.exit(1)
})
