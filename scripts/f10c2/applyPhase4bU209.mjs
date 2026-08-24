/**
 * F10C2 Phase 4B-U-R1 — apply migration 209 only on the authorized disposable.
 * Never prints secrets. Never executes 009/010/012/013/112/207. Never cleanup.
 * Existing 4B-E/4B-U disposable: apply list is ONLY 209.
 */
import { spawnSync } from 'node:child_process'
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
  WITHDRAWN_TRANSCRIPTION_REF,
  parseDisposableDbUri,
} from '../../src/lib/phase4bTargetGuard.js'
import {
  listExistingDisposable209Apply,
  listPhase4bApplyPlan,
  PHASE4A_NEVER_EXECUTE,
  F10C1I_SKIP,
  F10C2_SKIP,
} from './phase4bApplyPlan.mjs'

const __filename = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename), '../..')
const EVIDENCE = path.join(ROOT, '..', 'Audit Data', 'F10C2', 'Phase 4B-U-R1')
const SLUG = '209_disposable_operational_profile_task_rls_remediation'
const NEVER = new Set([
  '009_rls_profiles',
  '010_rls_tasks',
  '012_rls_task_checklist_items',
  '013_rls_task_issue_reports',
  '112_result_artifacts_storage_contract',
  '207_rls_tenant_storage_assumptions',
  ...PHASE4A_NEVER_EXECUTE,
  ...F10C1I_SKIP,
  ...F10C2_SKIP,
])

function redact(text) {
  return String(text || '')
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, 'postgres://[redacted]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt-redacted]')
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9]+/g, '[supabase-key-redacted]')
    .replace(/service_role['"=\s:]+[A-Za-z0-9._-]+/gi, 'service_role=[redacted]')
    .replace(/(password|pwd|secret|apikey|api_key)[=:][^\s&]+/gi, '$1=[redacted]')
}

function trimStr(value) {
  return String(value || '').trim()
}

function writeEvidence(name, body) {
  fs.mkdirSync(EVIDENCE, { recursive: true })
  fs.writeFileSync(path.join(EVIDENCE, name), redact(body), 'utf8')
}

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
    commandCategory: 'phase4b-u-r1-209-apply',
    changesDisposableProject: true,
  }
}

async function ensurePostgresClient() {
  const dest = path.join(os.tmpdir(), 'f10c2-phase4be-pg')
  const entry = path.join(dest, 'node_modules/postgres/src/index.js')
  if (!fs.existsSync(entry)) {
    fs.mkdirSync(dest, { recursive: true })
    const install = spawnSync('npm', ['install', '--prefix', dest, '--no-fund', '--no-audit', 'postgres@3'], {
      encoding: 'utf8',
      windowsHide: true,
      shell: true,
    })
    if (install.status !== 0 || !fs.existsSync(entry)) {
      throw new Error(`postgres_client_install_failed status=${install.status}`)
    }
  }
  return (await import(pathToFileURL(entry).href)).default
}

async function main() {
  const loaded = loadDisposableEnv(ROOT)
  const env = { ...loaded.env, ...parseEnvFile(path.join(ROOT, '.env.disposable')) }
  const appEnv = parseEnvFile(path.join(ROOT, '.env'))
  const session = evaluatePhase4bSqlSessionGuard(targetInput(env, appEnv))
  const reasons = [...(session.reasons || [])]
  const explicit = trimStr(env.F10C2_DISPOSABLE_PROJECT_REF).toLowerCase()
  const derived = trimStr(session.projectRef).toLowerCase()
  const apiHost = trimStr(session.hostname).toLowerCase()
  if (explicit !== AUTHORIZED_DISPOSABLE_PROJECT_REF) {
    reasons.push('F10C2_DISPOSABLE_PROJECT_REF is not the authorized disposable ref')
  }
  if (derived !== AUTHORIZED_DISPOSABLE_PROJECT_REF) {
    reasons.push('URL-derived project ref is not the authorized disposable ref')
  }
  if (apiHost !== AUTHORIZED_DISPOSABLE_API_HOST) {
    reasons.push('disposable API host is not the authorized disposable API host')
  }
  if (explicit.startsWith(DENIED_PRODUCTION_REF_PREFIX) || derived.startsWith(DENIED_PRODUCTION_REF_PREFIX)) {
    reasons.push('production prefix detected')
  }
  if ([explicit, derived, apiHost].some((v) => v.includes(WITHDRAWN_TRANSCRIPTION_REF))) {
    reasons.push('withdrawn transcription ref detected')
  }
  const dbUri = parseDisposableDbUri(env.F10C2_DISPOSABLE_DB_URL, AUTHORIZED_DISPOSABLE_PROJECT_REF)
  if (!dbUri.ok) reasons.push(...dbUri.reasons)
  if (dbUri.mode && dbUri.mode !== 'session pooler') reasons.push('requires session pooler')
  if (trimStr(env.F10C2_PHASE4B_CLEANUP_CONFIRMED).toLowerCase() === 'yes') {
    reasons.push('cleanup must remain no')
  }

  const proof = [
    'F10C2 PHASE 4B-U-R1 SANITIZED TARGET PROOF',
    `project_name: ${session.projectName || env.F10C2_DISPOSABLE_PROJECT_NAME}`,
    `authorized_ref: ${AUTHORIZED_DISPOSABLE_PROJECT_REF}`,
    `api_host: ${apiHost || '(none)'}`,
    `api_host_authorized: ${apiHost === AUTHORIZED_DISPOSABLE_API_HOST}`,
    `identity_signals_agree: ${explicit === derived && derived === AUTHORIZED_DISPOSABLE_PROJECT_REF}`,
    `synthetic_data_mode: ${session.syntheticDataMode}`,
    `production_data_import: ${session.productionDataImportDisabled ? 'disabled' : 'NOT_DISABLED'}`,
    `db_mode: ${dbUri.mode || '(none)'}`,
    `db_port: ${dbUri.port ?? '(none)'}`,
    `production_prefix_absent: ${!explicit.startsWith(DENIED_PRODUCTION_REF_PREFIX)}`,
    `withdrawn_typo_absent: ${!String(explicit).includes(WITHDRAWN_TRANSCRIPTION_REF)}`,
    `sql_execution_approved: ${session.sqlExecutionApproved}`,
    `guard_ok: ${reasons.length === 0}`,
  ]
  for (const line of proof) console.log(line)
  writeEvidence('F10C2_Phase4B_U_R1_Sanitized_Target_Proof.txt', proof.join('\n') + '\n')
  if (reasons.length) {
    throw new Error(`target_rejected: ${reasons.join('; ')}`)
  }

  const existing = listExistingDisposable209Apply()
  const full = listPhase4bApplyPlan()
  const applySlugs = existing.map((s) => s.slug)
  const leaked = applySlugs.filter((s) => NEVER.has(s) || s.startsWith('207_') || s.startsWith('009_') || s.startsWith('010_'))
  const unrelated = applySlugs.filter((s) => s !== SLUG)
  console.log('SANITIZED APPLY LIST (existing 4B-E/4B-U disposable)')
  for (const step of existing) console.log(`  ${step.slug}`)
  console.log(`full_plan_count: ${full.stages.length}`)
  console.log(`skipped: ${full.skipped.join(', ')}`)
  console.log(`never_execute: ${full.neverExecute.join(', ')}`)
  writeEvidence(
    'F10C2_Phase4B_U_R1_Apply_List.txt',
    [
      'existing_disposable_apply_only:',
      ...applySlugs.map((s) => `  ${s}`),
      `unrelated_would_execute: ${unrelated.join(', ') || '(none)'}`,
      `never_execute_in_apply_list: ${leaked.join(', ') || '(none)'}`,
      `skipped_remain: ${full.skipped.join(', ')}`,
      `never_execute_remain: ${full.neverExecute.join(', ')}`,
    ].join('\n') + '\n',
  )
  if (leaked.length) throw new Error(`apply_list_contains_never_execute: ${leaked.join(',')}`)
  if (unrelated.length) throw new Error(`apply_list_contains_unrelated: ${unrelated.join(',')}`)
  if (applySlugs.length !== 1 || applySlugs[0] !== SLUG) {
    throw new Error('apply_list_must_be_only_209')
  }

  const step = existing[0]
  if (!fs.existsSync(step.file)) throw new Error('209_forward_missing')
  const verifyPath = path.join(ROOT, 'supabase/drafts/f10c2/phase4b/verification', `${SLUG}.sql`)
  if (!fs.existsSync(verifyPath)) throw new Error('209_verify_missing')

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
    const ident = await sql.unsafe(`
      SELECT current_database() AS db,
             CASE
               WHEN current_user IN ('postgres', 'postgres.${AUTHORIZED_DISPOSABLE_PROJECT_REF}')
               THEN 'postgres_or_authorized_pooler'
               ELSE 'other'
             END AS user_class
    `)
    console.log(`current_database: ${ident[0].db}`)
    console.log(`current_user_class: ${ident[0].user_class}`)
    if (ident[0].user_class !== 'postgres_or_authorized_pooler') {
      throw new Error('unexpected_db_user_class')
    }

    const already = await sql.unsafe(`
      SELECT COUNT(*)::int AS n
      FROM pg_policy pol
      JOIN pg_class c ON c.oid = pol.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND pol.polname IN (
          'profiles_209_select_own',
          'profiles_209_select_admin',
          'tasks_209_select_assigned',
          'tasks_209_select_admin',
          'tasks_209_insert_admin',
          'tasks_209_update_admin'
        )
    `)
    if (Number(already[0].n || 0) > 0) {
      throw new Error(`migration_209_already_applied policies=${already[0].n}`)
    }

    const leaked207 = await sql.unsafe(`
      SELECT COUNT(*)::int AS n FROM pg_policy
      WHERE polname ILIKE '%207%' OR polname ILIKE '%tenant_storage_assumptions%'
    `)
    if (Number(leaked207[0].n || 0) !== 0) throw new Error('207_leaked')

    console.log('APPLY 209_disposable_operational_profile_task_rls_remediation')
    await sql.unsafe(fs.readFileSync(step.file, 'utf8'))
    console.log('VERIFY 209')
    const verifyRows = await sql.unsafe(fs.readFileSync(verifyPath, 'utf8'))
    writeEvidence(
      'F10C2_Phase4B_U_R1_209_Verify.json',
      JSON.stringify(verifyRows, null, 2).slice(0, 20000),
    )
    const policyCount = await sql.unsafe(`
      SELECT COUNT(*)::int AS n
      FROM pg_policy pol
      JOIN pg_class c ON c.oid = pol.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND pol.polname LIKE '%_209_%'
    `)
    if (Number(policyCount[0].n || 0) !== 6) {
      throw new Error(`expected_6_209_policies got=${policyCount[0].n}`)
    }
    console.log('209 applied and verified. policies=6')
    writeEvidence(
      'F10C2_Phase4B_U_R1_Applied_Migrations.txt',
      ['applied=1', `ok ${SLUG}`, 'verified=yes', 'never_execute=009,010,012,013,112,207'].join('\n') + '\n',
    )
  } finally {
    await sql.end({ timeout: 2 })
  }
}

main().catch((error) => {
  const message = redact(error.message || error)
  console.error(`APPLY_209_FAILED: ${message}`)
  writeEvidence('F10C2_Phase4B_U_R1_Apply_Failure.txt', `message=${message}\n`)
  process.exit(1)
})
