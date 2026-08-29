/**
 * F10C2 CR1-B — apply migrations 210-213 only on the authorized disposable.
 * Never prints secrets. Never executes 009/010/012/013/112/207/214. Never cleanup. Never reapplies 209.
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
  CR1B_APPLY,
  listExistingDisposableCr1bApply,
  listPhase4bApplyPlan,
  PHASE4A_NEVER_EXECUTE,
  F10C1I_SKIP,
  F10C2_SKIP,
  assertNo214InApplyList,
} from './phase4bApplyPlan.mjs'

const __filename = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename), '../..')
const EVIDENCE = path.join(ROOT, '..', 'Audit Data', 'F10C2', 'CR1-B')
const NEVER = new Set([
  '009_rls_profiles',
  '010_rls_tasks',
  '012_rls_task_checklist_items',
  '013_rls_task_issue_reports',
  '112_result_artifacts_storage_contract',
  '207_rls_tenant_storage_assumptions',
  '209_disposable_operational_profile_task_rls_remediation',
  '214_cr1b_acceptance_applicability',
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
    commandCategory: 'cr1b-migration-apply',
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
    'F10C2 CR1-B SANITIZED TARGET PROOF',
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
  writeEvidence('F10C2_CR1B_Sanitized_Target_Proof.txt', proof.join('\n') + '\n')
  if (reasons.length) {
    throw new Error(`target_rejected: ${reasons.join('; ')}`)
  }

  const existing = listExistingDisposableCr1bApply()
  const full = listPhase4bApplyPlan()
  const applySlugs = existing.map((s) => s.slug)
  assertNo214InApplyList(applySlugs, 'applyCr1bMigrations')
  const leaked = applySlugs.filter((s) => NEVER.has(s) || s.startsWith('207_') || s.startsWith('009_') || s.startsWith('010_') || s.startsWith('214_'))
  console.log('SANITIZED APPLY LIST (existing disposable CR1-B)')
  for (const step of existing) console.log(`  ${step.slug}`)
  writeEvidence(
    'F10C2_CR1B_Apply_List.txt',
    [
      'existing_disposable_cr1b_apply_only:',
      ...applySlugs.map((s) => `  ${s}`),
      `never_execute_in_apply_list: ${leaked.join(', ') || '(none)'}`,
      `skipped_remain: ${full.skipped.join(', ')}`,
      `never_execute_remain: ${full.neverExecute.join(', ')}`,
    ].join('\n') + '\n',
  )
  if (leaked.length) throw new Error(`apply_list_contains_never_execute: ${leaked.join(',')}`)
  if (applySlugs.join(',') !== CR1B_APPLY.join(',')) {
    throw new Error('apply_list_must_be_only_210_213')
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
  const applied = []
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

    const leaked207 = await sql.unsafe(`
      SELECT COUNT(*)::int AS n FROM pg_policy
      WHERE polname ILIKE '%207%' OR polname ILIKE '%tenant_storage_assumptions%'
    `)
    if (Number(leaked207[0].n || 0) !== 0) throw new Error('207_leaked')

    for (const step of existing) {
      if (!fs.existsSync(step.file)) throw new Error(`${step.slug}_forward_missing`)
      const verifyPath = path.join(ROOT, 'supabase/drafts/f10c2/phase4b/verification', `${step.slug}.sql`)
      if (!fs.existsSync(verifyPath)) throw new Error(`${step.slug}_verify_missing`)
      console.log(`APPLY ${step.slug}`)
      await sql.unsafe(fs.readFileSync(step.file, 'utf8'))
      console.log(`VERIFY ${step.slug}`)
      const verifyRows = await sql.unsafe(fs.readFileSync(verifyPath, 'utf8'))
      writeEvidence(`F10C2_CR1B_${step.slug}_Verify.json`, JSON.stringify(verifyRows, null, 2).slice(0, 20000))
      applied.push(step.slug)
    }

    writeEvidence(
      'F10C2_CR1B_Applied_Migrations.txt',
      ['applied=' + applied.length, ...applied.map((s) => `ok ${s}`), 'verified=yes', 'never_execute=009,010,012,013,112,207,214', 'did_not_reapply=209'].join('\n') + '\n',
    )
    console.log(`CR1-B applied and verified. count=${applied.length}`)
  } finally {
    await sql.end({ timeout: 2 })
  }
}

main().catch((error) => {
  const message = redact(error.message || error)
  console.error(`APPLY_CR1B_FAILED: ${message}`)
  writeEvidence('F10C2_CR1B_Apply_Failure.txt', `message=${message}\n`)
  process.exit(1)
})
