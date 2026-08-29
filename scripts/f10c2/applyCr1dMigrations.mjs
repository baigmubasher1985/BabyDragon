/**
 * F10C2 CR1-D — apply migration 215 only on the authorized disposable.
 * Never prints secrets. Never executes 009/010/012/013/112/207/214.
 * Never cleanup. Never reapplies 209–213.
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
  CR1D_APPLY,
  listExistingDisposableCr1dApply,
  listPhase4bApplyPlan,
  PHASE4A_NEVER_EXECUTE,
  F10C1I_SKIP,
  F10C2_SKIP,
  assertNo214InApplyList,
} from './phase4bApplyPlan.mjs'

const __filename = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename), '../..')
const EVIDENCE = path.join(ROOT, '..', 'Audit Data', 'F10C2', 'CR1-D')
const SLUG = '215_cr1d_acceptance_profile_management'
const HTTP_RUN = 'abfa51c3-80d0-4cc7-b984-535c63c67995'
const IPERF_RUN = 'a2951b10-6312-4954-bd05-bb65340a9367'
const NEVER = new Set([
  '009_rls_profiles',
  '010_rls_tasks',
  '012_rls_task_checklist_items',
  '013_rls_task_issue_reports',
  '112_result_artifacts_storage_contract',
  '207_rls_tenant_storage_assumptions',
  '209_disposable_operational_profile_task_rls_remediation',
  '210_cr1b_canonical_ingestion_schema',
  '211_cr1b_acceptance_engine_schema',
  '212_cr1b_rpc_ingest_evaluate_qc',
  '213_cr1b_rls_grants',
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
    commandCategory: 'cr1d-migration-apply',
    changesDisposableProject: true,
  }
}

function verificationPassed(row) {
  if (!row) return false
  return Boolean(
    row.has_description
    && row.has_scenario_family
    && row.has_scope_scenario_index
    && row.has_tenant_scenario_index
    && row.old_scope_index_dropped
    && row.old_tenant_index_dropped
    && row.has_resolver_scenario_overload
    && row.no_207_leak,
  )
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

const IMMUTABLE_SNAPSHOT_SQL = `
  SELECT r.id AS run_id,
         r.scenario_type,
         r.acceptance_verdict,
         s.id AS snapshot_id,
         s.profile_id,
         s.profile_version,
         s.overall_verdict,
         s.dl_verdict,
         s.ul_verdict,
         s.mo_verdict,
         s.mt_verdict,
         (
           SELECT e.actual_dl_mbps
           FROM public.field_test_iteration_evaluations e
           WHERE e.snapshot_id = s.id AND e.iteration_number = 1
           LIMIT 1
         ) AS iter1_dl_mbps
  FROM public.field_test_runs r
  LEFT JOIN public.field_test_run_acceptance_snapshots s ON s.run_id = r.id
  WHERE r.id IN ('${HTTP_RUN}', '${IPERF_RUN}')
  ORDER BY r.id
`

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
    'F10C2 CR1-D SANITIZED TARGET PROOF',
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
    `migration_id: 215`,
  ]
  for (const line of proof) console.log(line)
  writeEvidence('F10C2_CR1D_Sanitized_Target_Proof.txt', proof.join('\n') + '\n')
  if (reasons.length) {
    throw new Error(`target_rejected: ${reasons.join('; ')}`)
  }

  const existing = listExistingDisposableCr1dApply()
  const full = listPhase4bApplyPlan()
  const applySlugs = existing.map((s) => s.slug)
  assertNo214InApplyList(applySlugs, 'applyCr1dMigrations')
  const leaked = applySlugs.filter((s) => NEVER.has(s) || s.startsWith('207_') || s.startsWith('009_') || s.startsWith('010_') || s.startsWith('214_'))
  const unrelated = applySlugs.filter((s) => s !== SLUG)
  console.log('SANITIZED APPLY LIST (existing disposable CR1-D)')
  for (const step of existing) console.log(`  ${step.slug}`)
  writeEvidence(
    'F10C2_CR1D_Apply_List.txt',
    [
      'existing_disposable_cr1d_apply_only:',
      ...applySlugs.map((s) => `  ${s}`),
      `never_execute_in_apply_list: ${leaked.join(', ') || '(none)'}`,
      `unrelated_would_execute: ${unrelated.join(', ') || '(none)'}`,
      `skipped_remain: ${full.skipped.join(', ')}`,
      `never_execute_remain: ${full.neverExecute.join(', ')}`,
      'did_not_include=214,209,210,211,212,213',
    ].join('\n') + '\n',
  )
  if (leaked.length) throw new Error(`apply_list_contains_never_execute: ${leaked.join(',')}`)
  if (unrelated.length) throw new Error(`apply_list_contains_unrelated: ${unrelated.join(',')}`)
  if (applySlugs.join(',') !== CR1D_APPLY.join(',') || applySlugs[0] !== SLUG) {
    throw new Error('apply_list_must_be_only_215')
  }

  const step = existing[0]
  if (!fs.existsSync(step.file)) throw new Error('215_forward_missing')
  const verifyPath = path.join(ROOT, 'supabase/drafts/f10c2/phase4b/verification', `${SLUG}.sql`)
  if (!fs.existsSync(verifyPath)) throw new Error('215_verify_missing')
  const forwardText = fs.readFileSync(step.file, 'utf8')
  if (/\b(DROP\s+TABLE|TRUNCATE|DROP\s+DATABASE)\b/i.test(forwardText)) {
    throw new Error('215_forward_contains_destructive_sql')
  }
  if (/\bnsne/i.test(forwardText) || forwardText.includes(WITHDRAWN_TRANSCRIPTION_REF)) {
    throw new Error('215_forward_contains_denied_ref')
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

    const before = await sql.unsafe(IMMUTABLE_SNAPSHOT_SQL)
    writeEvidence('F10C2_CR1D_Immutable_Snapshots_Before.json', JSON.stringify(before, null, 2))
    console.log(`immutable_runs_before=${before.length}`)

    const preVerify = await sql.unsafe(fs.readFileSync(verifyPath, 'utf8'))
    const alreadyPresent = verificationPassed(preVerify[0])
    let status = 'already_present'
    if (alreadyPresent) {
      console.log('VERIFY 215 (already present; skip re-apply)')
    } else {
      const partial = preVerify[0] && (
        preVerify[0].has_description
        || preVerify[0].has_scenario_family
        || preVerify[0].has_scope_scenario_index
        || preVerify[0].has_tenant_scenario_index
        || preVerify[0].has_resolver_scenario_overload
      )
      if (partial) {
        writeEvidence('F10C2_CR1D_215_Verify_Partial.json', JSON.stringify(preVerify, null, 2))
        throw new Error('215_partial_apply_detected_stop')
      }
      console.log('APPLY 215_cr1d_acceptance_profile_management')
      await sql.unsafe(forwardText)
      status = 'newly_applied'
      console.log('VERIFY 215')
    }

    const verifyRows = alreadyPresent ? preVerify : await sql.unsafe(fs.readFileSync(verifyPath, 'utf8'))
    writeEvidence('F10C2_CR1D_215_Verify.json', JSON.stringify(verifyRows, null, 2).slice(0, 20000))
    if (!verificationPassed(verifyRows[0])) {
      throw new Error('215_verification_failed')
    }

    const after = await sql.unsafe(IMMUTABLE_SNAPSHOT_SQL)
    writeEvidence('F10C2_CR1D_Immutable_Snapshots_After_Apply.json', JSON.stringify(after, null, 2))
    const beforeKey = JSON.stringify(before)
    const afterKey = JSON.stringify(after)
    if (beforeKey !== afterKey) {
      throw new Error('immutable_snapshots_changed_during_215')
    }

    writeEvidence(
      'F10C2_CR1D_Applied_Migrations.txt',
      [
        `migration_id=215`,
        `slug=${SLUG}`,
        `status=${status}`,
        'verified=yes',
        'never_execute=009,010,012,013,112,207,214',
        'did_not_reapply=209,210,211,212,213',
        `project_ref=${AUTHORIZED_DISPOSABLE_PROJECT_REF}`,
        'immutable_snapshots_unchanged=yes',
      ].join('\n') + '\n',
    )
    console.log(`CR1-D 215 ${status} and verified`)
    console.log(`status=${status}`)
  } finally {
    await sql.end({ timeout: 2 })
  }
}

main().catch((error) => {
  const message = redact(error.message || error)
  console.error(`APPLY_CR1D_FAILED: ${message}`)
  writeEvidence('F10C2_CR1D_Apply_Failure.txt', `message=${message}\n`)
  process.exit(1)
})
