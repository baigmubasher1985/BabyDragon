/**
 * F10C2 Phase 4B-U-R1 — live PostgREST validation after 209.
 * Same client path as the app (anon key + password grant). Never prints secrets.
 * Does not re-apply migrations. Does not run executePhase4bE --validate-only
 * (that path recreates Auth users, inserts operational rows, and re-submits QC).
 */
import dns from 'node:dns'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadDisposableEnv, parseEnvFile } from './loadDisposableEnv.mjs'
import { evaluatePhase4bTarget } from '../../src/lib/phase4bTargetGuard.js'
import { AUTHORIZED_DISPOSABLE_PROJECT_REF } from '../../src/lib/phase4bTargetGuard.js'
import { normalizePostgrestMutation } from '../../src/lib/postgrestMutation.js'

const __filename = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename), '../..')
const EVIDENCE = path.join(ROOT, '..', 'Audit Data', 'F10C2', 'Phase 4B-U-R1')
const require = createRequire(path.join(ROOT, 'package.json'))
const { createClient } = require('@supabase/supabase-js')

const TASK_ID = 'cb59c40d-cd14-49aa-8b97-54aa5812bc82'
const TASK_TITLE = 'F10C2-P4BU-E2E'
const FE_EMAIL = 'fe.synthetic.f10c2@invalid.test'
const ADMIN_EMAIL = 'admin.synthetic.f10c2@invalid.test'
const SA_EMAIL = 'sa.synthetic.f10c2@invalid.test'
const E_RUN = '00000000-0000-4000-a000-f10c20000041'
const E_PASSED = '00000000-0000-4000-a000-f10c20000061'
const E_FAILED = '00000000-0000-4000-a000-f10c20000062'

function redact(text) {
  return String(text || '')
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, 'postgres://[redacted]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt-redacted]')
    .replace(/(password|pwd|secret|apikey|api_key)[=:][^\s&]+/gi, '$1=[redacted]')
}

function writeEvidence(name, body) {
  fs.mkdirSync(EVIDENCE, { recursive: true })
  fs.writeFileSync(path.join(EVIDENCE, name), redact(body), 'utf8')
}

function client(env) {
  return createClient(env.F10C2_DISPOSABLE_SUPABASE_URL, env.F10C2_DISPOSABLE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function signIn(env, email, password) {
  const c = client(env)
  const { data, error } = await c.auth.signInWithPassword({ email, password })
  return { c, userId: data?.user?.id || null, error: error ? redact(error.message) : null }
}

function denied(result) {
  if (result.error) return true
  const rows = Array.isArray(result.data) ? result.data : result.data ? [result.data] : []
  return rows.length === 0
}

async function main() {
  const loaded = loadDisposableEnv(ROOT)
  const env = { ...loaded.env, ...parseEnvFile(path.join(ROOT, '.env.disposable')) }
  const appEnv = parseEnvFile(path.join(ROOT, '.env'))
  const target = evaluatePhase4bTarget({
    disposableUrl: env.F10C2_DISPOSABLE_SUPABASE_URL,
    appViteUrl: appEnv.VITE_SUPABASE_URL,
    confirmed: env.F10C2_DISPOSABLE_CONFIRMED,
    deniedProductionRef: env.F10C2_DENIED_PRODUCTION_REF,
    explicitDisposableRef: env.F10C2_DISPOSABLE_PROJECT_REF,
    projectName: env.F10C2_DISPOSABLE_PROJECT_NAME,
    syntheticDataMode: env.F10C2_SYNTHETIC_DATA_MODE,
    productionDataImport: env.F10C2_PRODUCTION_DATA_IMPORT,
    disposableDbUrl: env.F10C2_DISPOSABLE_DB_URL,
    deniedProductionDbHost: env.F10C2_DENIED_PRODUCTION_DB_HOST,
  })
  if (!target.ok) throw new Error(`target_rejected: ${target.reasons.join('; ')}`)

  const checks = []
  const push = (name, pass, detail = '') => {
    checks.push({ name, pass, detail: redact(detail) })
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${redact(detail)}` : ''}`)
  }

  const anon = client(env)
  const anonProfiles = await anon.from('profiles').select('id,email,role').limit(5)
  const anonTasks = await anon.from('tasks').select('id,title').limit(5)
  push('anon_profiles_denied', denied(anonProfiles), anonProfiles.error?.message || `rows=${anonProfiles.data?.length || 0}`)
  push('anon_tasks_denied', denied(anonTasks), anonTasks.error?.message || `rows=${anonTasks.data?.length || 0}`)

  const fe = await signIn(env, FE_EMAIL, env.F10C2_DISPOSABLE_FE_PASSWORD)
  push('fe_signin', !fe.error && Boolean(fe.userId), fe.error || '')
  const admin = await signIn(env, ADMIN_EMAIL, env.F10C2_DISPOSABLE_ADMIN_PASSWORD)
  push('admin_signin', !admin.error && Boolean(admin.userId), admin.error || '')
  const sa = await signIn(env, SA_EMAIL, env.F10C2_DISPOSABLE_SA_PASSWORD)
  push('sa_signin', !sa.error && Boolean(sa.userId), sa.error || '')

  const feOwn = await fe.c.from('profiles').select('id,email,role').eq('id', fe.userId).maybeSingle()
  push(
    'fe_own_profile',
    !feOwn.error && feOwn.data?.role === 'fe' && feOwn.data?.email === FE_EMAIL,
    feOwn.error?.message || feOwn.data?.role || '',
  )
  const feOthers = await fe.c.from('profiles').select('id,email,role').neq('id', fe.userId)
  push('fe_other_profiles_denied', denied(feOthers), feOthers.error?.message || `rows=${feOthers.data?.length || 0}`)

  const fePromote = await fe.c.from('profiles').update({ role: 'admin' }).eq('id', fe.userId).select('role')
  const fePromoteNorm = normalizePostgrestMutation(fePromote)
  const feOwnAfter = await fe.c.from('profiles').select('role').eq('id', fe.userId).maybeSingle()
  push(
    'fe_self_promote_blocked',
    fePromoteNorm.empty && feOwnAfter.data?.role === 'fe',
    fePromote.error?.message || `count=${fePromoteNorm.count} role=${feOwnAfter.data?.role}`,
  )

  const feTasks = await fe.c.from('tasks').select('id,title,assigned_to,status')
  const feTaskRows = Array.isArray(feTasks.data) ? feTasks.data : []
  const assigned = feTaskRows.filter((t) => t.id === TASK_ID)
  const foreign = feTaskRows.filter((t) => t.id !== TASK_ID && t.assigned_to && t.assigned_to !== fe.userId)
  push(
    'fe_assigned_task_visible',
    !feTasks.error && assigned.length === 1 && assigned[0].title === TASK_TITLE,
    feTasks.error?.message || `count=${feTaskRows.length} titles=${feTaskRows.map((t) => t.title).join('|')}`,
  )
  push('fe_foreign_task_hidden', foreign.length === 0, `foreign=${foreign.length}`)

  const feReassign = await fe.c.from('tasks').update({ assigned_to: admin.userId }).eq('id', TASK_ID).select('assigned_to')
  const feReassignNorm = normalizePostgrestMutation(feReassign)
  push(
    'fe_reassign_blocked',
    feReassignNorm.empty,
    feReassign.error?.message || `count=${feReassignNorm.count}`,
  )

  const feDirectStatus = await fe.c.from('tasks').update({ status: 'in_progress' }).eq('id', TASK_ID).select('status')
  const feDirectStatusNorm = normalizePostgrestMutation(feDirectStatus)
  push(
    'fe_direct_status_update_blocked',
    feDirectStatusNorm.empty,
    feDirectStatus.error?.message || `count=${feDirectStatusNorm.count}`,
  )

  const adminProfiles = await admin.c.from('profiles').select('id,email,role')
  const adminEmails = (adminProfiles.data || []).map((p) => p.email)
  push(
    'admin_profiles_select',
    !adminProfiles.error && adminEmails.includes(FE_EMAIL) && adminEmails.includes(ADMIN_EMAIL),
    adminProfiles.error?.message || `count=${adminProfiles.data?.length || 0}`,
  )
  const adminTasks = await admin.c.from('tasks').select('id,title').eq('id', TASK_ID).maybeSingle()
  push(
    'admin_assigned_task_select',
    !adminTasks.error && adminTasks.data?.title === TASK_TITLE,
    adminTasks.error?.message || '',
  )
  const saTasks = await sa.c.from('tasks').select('id,title').eq('id', TASK_ID).maybeSingle()
  push(
    'sa_assigned_task_select',
    !saTasks.error && saTasks.data?.title === TASK_TITLE,
    saTasks.error?.message || '',
  )

  const feQcRpc = await fe.c.rpc('submit_field_test_qc_review', {
    p_field_test_run_id: E_FAILED,
    p_qc_decision: 'QC Passed',
    p_qc_notes: 'FE SHOULD NOT APPROVE',
    p_redrive_needed: false,
  })
  push(
    'fe_qc_rpc_forbidden',
    Boolean(feQcRpc.error),
    feQcRpc.error?.message || 'unexpected_success',
  )
  const anonQc = await anon.rpc('submit_field_test_qc_review', {
    p_field_test_run_id: E_FAILED,
    p_qc_decision: 'QC Passed',
    p_qc_notes: 'ANON SHOULD NOT APPROVE',
    p_redrive_needed: false,
  })
  push('anon_qc_rpc_denied', Boolean(anonQc.error), anonQc.error?.message || 'unexpected_success')

  const adminRuns = await admin.c.from('field_test_runs').select('id, report_name').in('id', [E_RUN, E_PASSED, E_FAILED])
  const reportNames = (adminRuns.data || []).map((r) => r.report_name)
  push(
    'admin_4be_runs_still_visible',
    !adminRuns.error
      && reportNames.includes('SYNTHETIC_F10C2_Unified_Result')
      && reportNames.includes('SYNTHETIC_F10C2_QC_Passed')
      && reportNames.includes('SYNTHETIC_F10C2_QC_Failed'),
    adminRuns.error?.message || reportNames.join('|'),
  )
  const adminQcRead = await admin.c.from('field_test_qc_reviews').select('qc_decision, field_test_run_id')
    .in('field_test_run_id', [E_RUN, E_PASSED, E_FAILED])
  const decisions = (adminQcRead.data || []).map((r) => r.qc_decision)
  push(
    'admin_4be_qc_still_readable',
    !adminQcRead.error
      && decisions.includes('QC Passed')
      && (decisions.includes('QC Failed') || decisions.includes('Waiting for Logs'))
      && decisions.includes('Needs Re-drive'),
    adminQcRead.error?.message || decisions.join('|'),
  )

  const pgEntry = path.join(os.tmpdir(), 'f10c2-phase4be-pg', 'node_modules/postgres/src/index.js')
  dns.setDefaultResultOrder('ipv4first')
  const postgres = (await import(pathToFileURL(pgEntry).href)).default
  const sql = postgres(env.F10C2_DISPOSABLE_DB_URL, {
    ssl: { rejectUnauthorized: false },
    max: 1,
    prepare: false,
    connect_timeout: 30,
    onnotice: () => {},
  })
  try {
    const assignedSql = await sql.unsafe(`
      SELECT t.title, t.status, p.email
      FROM public.tasks t
      JOIN public.profiles p ON p.id = t.assigned_to
      WHERE t.id = '${TASK_ID}'::uuid
    `)
    push(
      'sql_assignment_intact',
      assignedSql[0]?.title === TASK_TITLE && assignedSql[0]?.email === FE_EMAIL,
      `${assignedSql[0]?.title || 'missing'}|${assignedSql[0]?.status || ''}`,
    )
    const promoteSql = await sql.unsafe(`
      SELECT role FROM public.profiles WHERE email = '${FE_EMAIL}'
    `)
    push('sql_fe_role_unchanged', promoteSql[0]?.role === 'fe', promoteSql[0]?.role || '')
  } finally {
    await sql.end({ timeout: 2 })
  }

  const failed = checks.filter((c) => !c.pass)
  writeEvidence(
    'F10C2_Phase4B_U_R1_Live_PostgREST.json',
    JSON.stringify({
      note: 'executePhase4bE --validate-only skipped: it recreates Auth users, inserts operational rows, and re-submits QC',
      checks,
      failed: failed.map((c) => c.name),
    }, null, 2),
  )
  console.log(`live checks: ${checks.length - failed.length}/${checks.length} passed`)
  if (failed.length) {
    throw new Error(`live_validation_failed:${failed.map((c) => c.name).join(',')}`)
  }
}

main().catch((error) => {
  console.error(`LIVE_VALIDATE_FAILED: ${redact(error.message || error)}`)
  process.exit(1)
})
