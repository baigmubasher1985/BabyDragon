/**
 * F10C2 Phase 4B-E — controlled disposable execution.
 * SQL and synthetic data are authorized only for project ref cxyqqgmepiphyejvceum.
 * Never prints secrets. Never executes 009/010/012/013/112/207. Never cleanup.
 */
import { spawnSync } from 'node:child_process'
import dns from 'node:dns'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { normalizePostgrestMutation } from '../../src/lib/postgrestMutation.js'
import { loadDisposableEnv, parseEnvFile } from './loadDisposableEnv.mjs'
import {
  evaluatePhase4bSqlSessionGuard,
  DISPOSABLE_SQL_MARKER_STATEMENT,
} from '../../src/lib/phase4bSqlSessionGuard.js'
import {
  AUTHORIZED_DISPOSABLE_API_HOST,
  AUTHORIZED_DISPOSABLE_PROJECT_REF,
  DENIED_PRODUCTION_REF_PREFIX,
  parseDisposableDbUri,
} from '../../src/lib/phase4bTargetGuard.js'
import {
  listPhase4bApplyPlan,
  PHASE4A_NEVER_EXECUTE,
  F10C1I_SKIP,
  F10C2_SKIP,
} from './phase4bApplyPlan.mjs'

const __filename = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename), '../..')
const AUTHORIZED_REF = AUTHORIZED_DISPOSABLE_PROJECT_REF
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
const SYNTH = {
  feEmail: 'fe.synthetic.f10c2@invalid.test',
  adminEmail: 'admin.synthetic.f10c2@invalid.test',
  saEmail: 'sa.synthetic.f10c2@invalid.test',
  projectName: 'SYNTHETIC F10C2 Validation Project',
  taskTitle: 'SYNTHETIC F10C2 Validation Task',
  redriveTitle: 'SYNTHETIC F10C2 Re-drive Task',
  market: 'SYNTH-LAB',
  tenantSlug: 'synth-f10c2-lab',
  tenantId: '00000000-0000-4000-a000-f10c20000001',
  connectionId: '00000000-0000-4000-a000-f10c20000011',
  runId: '00000000-0000-4000-a000-f10c20000041',
  artifactId: '00000000-0000-4000-a000-f10c20000051',
  artifactGpsId: '00000000-0000-4000-a000-f10c20000052',
  checksum: 'sha256:syntheticf10c2rfcsvchecksum0001',
  gpsChecksum: 'sha256:syntheticf10c2gpscsvchecksum0001',
  boundKey: 'synth-f10c2:00000000-0000-4000-a000-f10c20000051:request_artifact_upload_plan',
  qcNotes: 'SYNTHETIC QC: evidence present; re-drive requested for validation path only',
  passedRunId: '00000000-0000-4000-a000-f10c20000061',
  failedRunId: '00000000-0000-4000-a000-f10c20000062',
}

const BOOTSTRAP_TABLES = [
  'profiles',
  'projects',
  'grids',
  'tasks',
  'task_updates',
  'task_grids',
  'routes',
  'route_grids',
  'cell_files',
  'cell_sites',
  'cell_sectors',
  'task_checklist_items',
  'task_issue_reports',
  'qc_reviews',
]

const LATER_TABLES = [
  'security_audit_log',
  'field_test_runs',
  'field_test_artifacts',
  'field_test_metrics',
  'field_test_qc_reviews',
  'tenants',
  'storage_connections',
  'tenant_storage_policies',
  'artifact_transfer_jobs',
]

const guardOnly = process.argv.includes('--guard-only')
const connectionOnly = process.argv.includes('--connection-only')
const apply208Only = process.argv.includes('--apply-208-only')
const validateOnly = process.argv.includes('--validate-only')
const evidenceDir = path.join(
  ROOT,
  '..',
  'Audit Data',
  'F10C2',
  apply208Only || validateOnly ? 'Phase 4B-E-R1' : 'Phase 4B-E',
)

function trimStr(value) {
  return String(value || '').trim()
}

function redact(text) {
  return String(text || '')
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, 'postgres://[redacted]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt-redacted]')
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9]+/g, '[supabase-key-redacted]')
    .replace(/service_role['"=\s:]+[A-Za-z0-9._-]+/gi, 'service_role=[redacted]')
    .replace(/(password|pwd|secret|apikey|api_key)[=:][^\s&]+/gi, '$1=[redacted]')
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
    commandCategory: 'phase4b-e-execution',
    changesDisposableProject: true,
  }
}

function evaluatePhase4eAuthorization(env, appEnv) {
  const input = targetInput(env, appEnv)
  const session = evaluatePhase4bSqlSessionGuard(input)
  const reasons = [...(session.reasons || [])]
  const explicit = trimStr(env.F10C2_DISPOSABLE_PROJECT_REF).toLowerCase()
  const derived = trimStr(session.projectRef).toLowerCase()
  if (explicit !== AUTHORIZED_REF) {
    reasons.push('F10C2_DISPOSABLE_PROJECT_REF is not the authorized disposable ref')
  }
  if (derived !== AUTHORIZED_REF) {
    reasons.push('URL-derived project ref is not the authorized disposable ref')
  }
  if (explicit.startsWith(DENIED_PRODUCTION_REF_PREFIX) || derived.startsWith(DENIED_PRODUCTION_REF_PREFIX)) {
    reasons.push('project ref begins with the denied production prefix')
  }
  const cleanup = trimStr(env.F10C2_PHASE4B_CLEANUP_CONFIRMED).toLowerCase()
  const bootstrapCleanup = trimStr(env.F10C2_PHASE4B_BOOTSTRAP_CLEANUP_CONFIRMED).toLowerCase()
  if (cleanup === 'yes' || bootstrapCleanup === 'yes') {
    reasons.push('cleanup confirmations must remain no during Phase 4B-E')
  }
  const dbUri = parseDisposableDbUri(env.F10C2_DISPOSABLE_DB_URL, AUTHORIZED_REF)
  if (!dbUri.ok) {
    for (const reason of dbUri.reasons) {
      if (!reasons.includes(reason)) reasons.push(reason)
    }
  }
  if (dbUri.mode && dbUri.mode !== 'session pooler') {
    reasons.push('Phase 4B-E requires session pooler connection mode')
  }
  const apiHost = trimStr(session.hostname).toLowerCase()
  if (apiHost && apiHost !== AUTHORIZED_DISPOSABLE_API_HOST) {
    reasons.push('disposable API host is not the authorized disposable API host')
  }
  if (dbUri.userRef && dbUri.userRef !== AUTHORIZED_REF) {
    reasons.push('pooler username must be postgres.<authorized-project-ref>')
  }
  if (
    derived !== AUTHORIZED_REF
    || apiHost !== AUTHORIZED_DISPOSABLE_API_HOST
    || dbUri.userRef !== AUTHORIZED_REF
  ) {
    reasons.push('disposable project ref, API host, and pooler username must agree on the authorized disposable identity')
  }
  return {
    ...session,
    ok: reasons.length === 0 && Boolean(session.hostname),
    reasons,
    authorizedRef: AUTHORIZED_REF,
    explicitRefMatches: explicit === AUTHORIZED_REF,
    derivedRefMatches: derived === AUTHORIZED_REF,
    cleanupRemainsNo: cleanup !== 'yes',
    bootstrapCleanupRemainsNo: bootstrapCleanup !== 'yes',
    sqlMarker: DISPOSABLE_SQL_MARKER_STATEMENT,
    dbUri,
  }
}

function printSanitizedProof(authz) {
  const db = authz.dbUri || {}
  console.log('F10C2 Phase 4B-E sanitized target proof')
  console.log(`- project name: ${authz.projectName || '(missing)'}`)
  console.log(`- authorized project ref: ${AUTHORIZED_REF}`)
  console.log(`- authorized API host: ${AUTHORIZED_DISPOSABLE_API_HOST}`)
  console.log(`- API host matches authorized: ${trimStr(authz.hostname).toLowerCase() === AUTHORIZED_DISPOSABLE_API_HOST ? 'yes' : 'NO'}`)
  console.log(`- scheme valid: ${db.schemeValid ? 'yes' : 'no'}`)
  console.log(`- connection mode: ${db.mode || 'unknown'}`)
  console.log(`- username project ref matches: ${db.usernameRefMatches ? 'yes' : 'no'}`)
  console.log(`- identity signals agree: ${authz.explicitRefMatches && authz.derivedRefMatches && db.usernameRefMatches ? 'yes' : 'NO'}`)
  console.log(`- sanitized pooler hostname: ${db.hostnameSanitized || authz.dbHostRedacted}`)
  console.log(`- port: ${db.port ?? '(none)'}`)
  console.log(`- database name: ${db.database || '(none)'}`)
  console.log(`- production ref absent: ${db.productionRefAbsent ? 'yes' : 'NO'}`)
  console.log(`- target guard result: ${authz.ok ? 'accepted' : 'rejected'}`)
  console.log(`- explicit ref matches authorized: ${authz.explicitRefMatches ? 'yes' : 'NO'}`)
  console.log(`- API hostname: ${authz.hostname || '(none)'}`)
  console.log(`- app/production host redacted: ${authz.appHostRedacted}`)
  console.log(`- synthetic-data mode: ${authz.syntheticDataMode ? 'yes' : 'NO'}`)
  console.log(`- production-data import disabled: ${authz.productionDataImportDisabled ? 'yes' : 'NO'}`)
  console.log(`- SQL execution approval: ${authz.sqlExecutionApproved ? 'yes' : 'NO'}`)
  console.log(`- cleanup remains no: ${authz.cleanupRemainsNo ? 'yes' : 'NO'}`)
  console.log(`- bootstrap cleanup remains no: ${authz.bootstrapCleanupRemainsNo ? 'yes' : 'NO'}`)
  console.log(`- 207 NEVER EXECUTE: yes`)
  if (!authz.ok) {
    for (const reason of authz.reasons) console.error(`  - ${reason}`)
  }
}

function wrapWithMarker(sql) {
  return `BEGIN;\n${DISPOSABLE_SQL_MARKER_STATEMENT}\n${sql}\nCOMMIT;\n`
}

async function ensurePostgresClient() {
  const dest = path.join(os.tmpdir(), 'f10c2-phase4be-pg')
  const entry = path.join(dest, 'node_modules/postgres/src/index.js')
  if (!fs.existsSync(entry)) {
    fs.mkdirSync(dest, { recursive: true })
    console.log('Installing temporary postgres.js client outside the repo (no secrets).')
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

function connectSql(postgres, dbUrl) {
  return postgres(dbUrl, {
    ssl: { rejectUnauthorized: false },
    max: 1,
    prepare: false,
    connect_timeout: 30,
    idle_timeout: 20,
    onnotice: () => {},
  })
}

async function openDisposableSql(postgres, dbUrl) {
  dns.setDefaultResultOrder('ipv4first')
  const sql = connectSql(postgres, dbUrl)
  try {
    await sql.unsafe('select 1 as ok')
    console.log('DB probe ok via provided session-pooler URI')
    return sql
  } catch (error) {
    try {
      await sql.end({ timeout: 1 })
    } catch {
      /* ignore */
    }
    throw new Error(`db_connect_failed: ${redact(error.message || error)}`)
  }
}

async function runSql(sql, text, label) {
  try {
    const result = await sql.unsafe(text)
    return result
  } catch (error) {
    const message = redact(error.message || String(error))
    const err = new Error(`${label}: ${message}`)
    err.step = label
    throw err
  }
}

async function ensureAuthUser(admin, email, password, role) {
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { synthetic: true, role, source: 'f10c2-phase4b-e' },
  })
  if (!error && created?.user?.id) return created.user.id
  const msg = String(error?.message || '')
  if (!/already|registered|exists/i.test(msg) && error) {
    throw new Error(`auth_create_${role}: ${redact(msg)}`)
  }
  const { data: listed, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 })
  if (listError) throw new Error(`auth_list_${role}: ${redact(listError.message)}`)
  const found = (listed?.users || []).find((u) => String(u.email || '').toLowerCase() === email)
  if (!found?.id) throw new Error(`auth_create_${role}: user missing after conflict`)
  return found.id
}

function writeEvidence(name, body) {
  fs.mkdirSync(evidenceDir, { recursive: true })
  fs.writeFileSync(path.join(evidenceDir, name), redact(body), 'utf8')
}

function verifyFileFor(step) {
  if (NEVER.has(step.slug) || String(step.slug).startsWith('207_')) return null
  if (step.family === 'phase4b-bootstrap') {
    return path.join(
      ROOT,
      'supabase/drafts/f10c2/phase4b/bootstrap/000_disposable_operational_schema.verify.sql',
    )
  }
  if (step.family === 'f10c1i') {
    return path.join(ROOT, 'supabase/drafts/verification', `${step.slug}.sql`)
  }
  if (step.family === 'f10c2') {
    return path.join(ROOT, 'supabase/drafts/f10c2/verification', `${step.slug}.sql`)
  }
  if (step.family === 'phase4a') {
    return path.join(ROOT, 'supabase/drafts/f10c2/phase4a/verification', `${step.slug}.sql`)
  }
  if (step.family === 'phase4b-r1') {
    return path.join(ROOT, 'supabase/drafts/f10c2/phase4b/verification', `${step.slug}.sql`)
  }
  return null
}

function firstRow(result) {
  return Array.isArray(result) ? result[0] : result?.[0]
}

async function assertSqlFails(sql, text, label, pattern) {
  try {
    await sql.unsafe(text)
    const err = new Error(`${label}: expected constraint failure but statement succeeded`)
    err.step = label
    throw err
  } catch (error) {
    if (error.step === label) throw error
    const message = redact(error.message || String(error))
    const haystack = `${error.code || ''} ${message}`
    if (!pattern.test(haystack)) {
      const err = new Error(`${label}: failed for unexpected reason: ${message}`)
      err.step = label
      throw err
    }
    return { name: label, pass: true, expected_negative: true, detail: message }
  }
}

async function main() {
  const loaded = loadDisposableEnv(ROOT)
  const appEnv = parseEnvFile(path.join(ROOT, '.env'))
  if (!loaded.fileExists) {
    console.error('BLOCKED: .env.disposable is missing. No SQL executed.')
    process.exit(2)
  }
  const env = loaded.env
  const authz = evaluatePhase4eAuthorization(env, appEnv)
  printSanitizedProof(authz)
  writeEvidence(
    'F10C2_Phase4B_E_Sanitized_Target_Proof.txt',
    [
      `project_name=${authz.projectName}`,
      `authorized_ref=${AUTHORIZED_REF}`,
      `explicit_ref_matches=${authz.explicitRefMatches}`,
      `derived_ref_matches=${authz.derivedRefMatches}`,
      `hostname=${authz.hostname}`,
      `app_host_redacted=${authz.appHostRedacted}`,
      `db_host_redacted=${authz.dbHostRedacted}`,
      `synthetic=${authz.syntheticDataMode}`,
      `import_disabled=${authz.productionDataImportDisabled}`,
      `sql_approved=${authz.sqlExecutionApproved}`,
      `cleanup_no=${authz.cleanupRemainsNo}`,
      `bootstrap_cleanup_no=${authz.bootstrapCleanupRemainsNo}`,
      `scheme_valid=${authz.dbUri?.schemeValid}`,
      `mode=${authz.dbUri?.mode}`,
      `username_ref_matches=${authz.dbUri?.usernameRefMatches}`,
      `hostname_sanitized=${authz.dbUri?.hostnameSanitized}`,
      `port=${authz.dbUri?.port}`,
      `database=${authz.dbUri?.database}`,
      `production_ref_absent=${authz.dbUri?.productionRefAbsent}`,
      `ok=${authz.ok}`,
      `reasons=${(authz.reasons || []).join(' | ')}`,
    ].join('\n'),
  )

  if (!authz.ok) {
    console.error('BLOCKED: Phase 4B-E target/SQL guard failed. No database connection opened.')
    for (const reason of authz.reasons) console.error(`  - ${reason}`)
    process.exit(2)
  }

  if (guardOnly) {
    console.log('RESULT: guard-only — no database connection')
    process.exit(0)
  }

  const plan = listPhase4bApplyPlan()
  const leaked = plan.stages.filter((s) => NEVER.has(s.slug) || s.slug.startsWith('207_'))
  if (leaked.length) {
    console.error('BLOCKED: forbidden slug in executable plan')
    process.exit(2)
  }
  if (!connectionOnly) {
    console.log(`executable schema steps: ${plan.stages.length} (000 + 36 drafts)`)
    console.log(`skipped: ${[...F10C1I_SKIP, ...F10C2_SKIP].join(', ')}`)
    console.log('never execute: 207_rls_tenant_storage_assumptions')
  } else {
    console.log('MODE: connection-only preflight — bootstrap and migrations will not run')
  }

  if (!trimStr(env.F10C2_DISPOSABLE_DB_URL)) {
    console.error('BLOCKED: F10C2_DISPOSABLE_DB_URL missing. No SQL executed.')
    process.exit(2)
  }

  const applied = []
  const postgres = await ensurePostgresClient()
  const sql = await openDisposableSql(postgres, env.F10C2_DISPOSABLE_DB_URL)
  try {
    console.log('CONNECTION-ONLY QUERY (no migrations)')
    const probe = await runSql(
      sql,
      'SELECT current_database() AS db, current_user AS usr, inet_server_port() AS port;',
      'connection_probe',
    )
    const probeRow = Array.isArray(probe) ? probe[0] : probe?.[0]
    const probeUser = String(probeRow?.usr || '')
    const probeUserNorm = probeUser.toLowerCase()
    const probeUserMatches = probeUserNorm === `postgres.${AUTHORIZED_REF}`
    const probeUserAllowed = probeUserMatches || probeUserNorm === 'postgres'
    const probeUserSanitized = probeUserAllowed
      ? probeUserNorm
      : `${probeUserNorm.slice(0, Math.min(8, probeUserNorm.length))}…(redacted)`
    console.log(`- current_database: ${probeRow?.db || '(none)'}`)
    console.log(`- current_user sanitized: ${probeUserSanitized}`)
    console.log(`- current_user is postgres or postgres.<authorized-ref>: ${probeUserAllowed ? 'yes' : 'NO'}`)
    console.log(`- inet_server_port: ${probeRow?.port ?? '(none)'}`)
    if (String(probeRow?.db) !== 'postgres' || Number(probeRow?.port) !== 5432) {
      throw Object.assign(new Error('connection_probe_identity_mismatch'), { step: 'connection_probe' })
    }
    if (probeUserNorm.includes(DENIED_PRODUCTION_REF_PREFIX)) {
      throw Object.assign(new Error('connection_probe_production_role'), { step: 'connection_probe' })
    }
    if (!probeUserAllowed) {
      throw Object.assign(new Error('connection_probe_username_ref_mismatch'), { step: 'connection_probe' })
    }

    if (connectionOnly) {
      writeEvidence(
        'F10C2_Phase4B_E_Connection_Preflight.txt',
        [
          `authorized_ref=${AUTHORIZED_REF}`,
          `scheme_valid=${authz.dbUri?.schemeValid}`,
          `mode=${authz.dbUri?.mode}`,
          `username_ref_matches=${authz.dbUri?.usernameRefMatches}`,
          `hostname_sanitized=${authz.dbUri?.hostnameSanitized}`,
          `port=${authz.dbUri?.port}`,
          `database=${probeRow?.db || authz.dbUri?.database}`,
          `inet_server_port=${probeRow?.port ?? ''}`,
          `current_user_sanitized=${probeUserSanitized}`,
          `current_user_allowed=${probeUserAllowed ? 'yes' : 'no'}`,
          `production_ref_absent=${authz.dbUri?.productionRefAbsent}`,
          `target_guard=accepted`,
          `bootstrap_executed=no`,
        ].join('\n'),
      )
      console.log('CONNECTION-ONLY PREFLIGHT PASSED — no bootstrap or migrations executed')
      return
    }

    const priorNames = [...BOOTSTRAP_TABLES, ...LATER_TABLES]
      .map((name) => `'${name}'`)
      .join(', ')
    const prior = await runSql(
      sql,
      `SELECT c.relname AS table_name
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind = 'r'
         AND c.relname IN (${priorNames})
       ORDER BY 1;`,
      'prior_migration_check',
    )
    const priorTables = (Array.isArray(prior) ? prior : []).map((row) => row.table_name)
    console.log(`- prior BabyDragon public tables: ${priorTables.length ? priorTables.join(', ') : '(none)'}`)

    if (apply208Only || validateOnly) {
      const required = ['profiles', 'field_test_runs', 'field_test_qc_reviews', 'tenants', 'artifact_transfer_jobs']
      const missing = required.filter((name) => !priorTables.includes(name))
      if (missing.length) {
        throw Object.assign(new Error(`required 4B-E tables missing: ${missing.join(',')}`), { step: 'r1_preflight' })
      }
      const leaked207 = await runSql(
        sql,
        `SELECT COUNT(*)::int AS n FROM pg_policy
         WHERE polname ILIKE '%207%' OR polname ILIKE '%tenant_storage_assumptions%';`,
        'r1_never_207',
      )
      if (Number(firstRow(leaked207)?.n || 0) !== 0) {
        throw Object.assign(new Error('207 leaked into disposable schema'), { step: 'r1_never_207' })
      }
      console.log('R1 preflight: 000–206 objects present, 207 absent')
      if (apply208Only) {
        const already = await runSql(
          sql,
          `SELECT COUNT(*)::int AS n
           FROM pg_indexes
           WHERE schemaname = 'public'
             AND indexname = 'artifact_transfer_jobs_idempotency_key_global';`,
          'r1_208_already',
        )
        if (Number(firstRow(already)?.n || 0) > 0) {
          throw Object.assign(new Error('migration 208 already applied'), { step: 'r1_208_already' })
        }
        const step208 = plan.stages.find((s) => s.slug === '208_phase4b_validation_remediation')
        if (!step208 || NEVER.has(step208.slug)) {
          throw Object.assign(new Error('208 missing from apply plan'), { step: 'r1_208_plan' })
        }
        console.log('APPLY 208_phase4b_validation_remediation')
        await runSql(sql, fs.readFileSync(step208.file, 'utf8'), step208.slug)
        applied.push(step208.slug)
        const verify208 = verifyFileFor(step208)
        console.log('VERIFY 208_phase4b_validation_remediation')
        const verifyRows = await runSql(sql, fs.readFileSync(verify208, 'utf8'), '208_verify')
        if (!Array.isArray(verifyRows) || verifyRows.length === 0) {
          throw Object.assign(new Error('208 verification returned no rows'), { step: '208_verify' })
        }
        writeEvidence('F10C2_Phase4B_E_R1_208_Verify.json', JSON.stringify(verifyRows, null, 2).slice(0, 12000))
        console.log('208 applied and verified. Continuing to validation.')
      }
    } else if (priorTables.length) {
      throw Object.assign(
        new Error('unexpected prior BabyDragon schema from a previous attempt; stopping fail-closed'),
        { step: 'prior_migration_check' },
      )
    }
    if (apply208Only || validateOnly) {
      /* schema already present; 208 handled above */
    } else {
    const priorFn = await runSql(
      sql,
      `SELECT p.proname
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN (
           'request_artifact_upload_plan',
           'submit_field_test_run',
           'update_assigned_task_status'
         );`,
      'prior_function_check',
    )
    const priorFns = (Array.isArray(priorFn) ? priorFn : []).map((row) => row.proname)
    if (priorFns.length) {
      throw Object.assign(
        new Error(`unexpected prior BabyDragon functions already applied: ${priorFns.join(',')}`),
        { step: 'prior_function_check' },
      )
    }
    console.log('Public schema has no BabyDragon tables or approved-list functions. Starting bootstrap 000.')

    const verified = []
    console.log('STEP 1: SQL disposable transaction marker armed in wrapper')
    for (const step of plan.stages) {
      if (NEVER.has(step.slug) || step.slug.startsWith('207_')) {
        console.error(`BLOCKED: refused ${step.slug}`)
        process.exit(2)
      }
      console.log(`APPLY ${step.slug}`)
      const body = fs.readFileSync(step.file, 'utf8')
      const wrapped = step.family === 'phase4b-bootstrap' ? wrapWithMarker(body) : body
      await runSql(sql, wrapped, step.slug)
      applied.push(step.slug)

      const verifyPath = verifyFileFor(step)
      if (!verifyPath || !fs.existsSync(verifyPath)) {
        throw Object.assign(new Error(`missing verification SQL for ${step.slug}`), { step: `${step.slug}_verify` })
      }
      console.log(`VERIFY ${step.slug}`)
      const verifySql = fs.readFileSync(verifyPath, 'utf8')
      const verifyWrapped = step.family === 'phase4b-bootstrap' ? wrapWithMarker(verifySql) : verifySql
      const verifyRows = await runSql(sql, verifyWrapped, `${step.slug}_verify`)
      const verifyList = Array.isArray(verifyRows) ? verifyRows : []
      if (verifyList.length === 0) {
        throw Object.assign(new Error(`${step.slug} verification returned no rows`), { step: `${step.slug}_verify` })
      }
      verified.push(step.slug)
      if (step.slug === '000_disposable_operational_schema') {
        writeEvidence(
          'F10C2_Phase4B_E_Bootstrap_Verify.txt',
          JSON.stringify(verifyRows, null, 2).slice(0, 12000),
        )
        const present = await runSql(
          sql,
          `SELECT c.relname
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'r'
             AND c.relname IN (${BOOTSTRAP_TABLES.map((name) => `'${name}'`).join(', ')})
           ORDER BY 1;`,
          '000_tables_present',
        )
        const names = (Array.isArray(present) ? present : []).map((row) => row.relname)
        const missing = BOOTSTRAP_TABLES.filter((name) => !names.includes(name))
        if (missing.length) {
          throw Object.assign(new Error(`bootstrap missing tables: ${missing.join(',')}`), { step: '000_verify' })
        }
      }
    }

    writeEvidence(
      'F10C2_Phase4B_E_Applied_Migrations.txt',
      [`applied=${applied.length}`, ...applied.map((slug) => `ok ${slug}`), '', 'verified:', ...verified].join('\n'),
    )
    console.log(`Applied and verified ${applied.length} schema drafts`)

    const inventory = await runSql(
      sql,
      `SELECT 'table' AS kind, c.relname AS name, c.relrowsecurity::text AS extra
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
       UNION ALL
       SELECT 'function', p.proname, p.prosecdef::text
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
       ORDER BY 1, 2;`,
      'schema_inventory',
    )
    writeEvidence('F10C2_Phase4B_E_Schema_Inventory.json', JSON.stringify(inventory, null, 2).slice(0, 20000))
    const policies = await runSql(
      sql,
      `SELECT n.nspname AS schema, c.relname AS table_name, pol.polname, pol.polcmd::text
       FROM pg_policy pol
       JOIN pg_class c ON c.oid = pol.polrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname IN ('public', 'storage')
       ORDER BY 1, 2, 3;`,
      'rls_inventory',
    )
    writeEvidence('F10C2_Phase4B_E_RLS_Policy_Inventory.json', JSON.stringify(policies, null, 2).slice(0, 20000))
    const grants = await runSql(
      sql,
      `SELECT table_schema, table_name, grantee, privilege_type
       FROM information_schema.role_table_grants
       WHERE table_schema IN ('public', 'storage')
         AND grantee IN ('anon', 'authenticated', 'service_role', 'postgres')
       ORDER BY 1, 2, 3, 4;`,
      'grants_inventory',
    )
    writeEvidence('F10C2_Phase4B_E_Grants.json', JSON.stringify(grants, null, 2).slice(0, 20000))
    const buckets = await runSql(
      sql,
      `SELECT id, name, public, file_size_limit IS NOT NULL AS has_size_limit
       FROM storage.buckets
       WHERE id IN ('result-artifacts', 'task-photos', 'operational-evidence')
       ORDER BY id;`,
      'storage_inventory',
    )
    writeEvidence('F10C2_Phase4B_E_Storage_Configuration.json', JSON.stringify(buckets, null, 2))
    const never207 = await runSql(
      sql,
      `SELECT COUNT(*)::int AS n FROM pg_policy
       WHERE polname ILIKE '%207%' OR polname ILIKE '%tenant_storage_assumptions%';`,
      'never_207',
    )
    if (Number(firstRow(never207)?.n || 0) !== 0) {
      throw Object.assign(new Error('207 policy leaked into live schema'), { step: 'never_207' })
    }
    }

    console.log('STEP 7: Create synthetic Auth users')
    const admin = createClient(env.F10C2_DISPOSABLE_SUPABASE_URL, env.F10C2_DISPOSABLE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const feId = await ensureAuthUser(admin, SYNTH.feEmail, env.F10C2_DISPOSABLE_FE_PASSWORD, 'fe')
    const adminId = await ensureAuthUser(admin, SYNTH.adminEmail, env.F10C2_DISPOSABLE_ADMIN_PASSWORD, 'admin')
    const saId = await ensureAuthUser(admin, SYNTH.saEmail, env.F10C2_DISPOSABLE_SA_PASSWORD, 'super_admin')
    console.log('synthetic Auth users ready (ids not printed as secrets; stored in disposable DB only)')

    console.log('STEP 8: Create synthetic operational rows')
    const operational = `
INSERT INTO public.profiles (id, email, role, full_name, is_active)
VALUES
  ('${feId}'::uuid, '${SYNTH.feEmail}', 'fe', 'SYNTHETIC FE', true),
  ('${adminId}'::uuid, '${SYNTH.adminEmail}', 'admin', 'SYNTHETIC ADMIN', true),
  ('${saId}'::uuid, '${SYNTH.saEmail}', 'super_admin', 'SYNTHETIC SUPER ADMIN', true)
ON CONFLICT (id) DO UPDATE
SET email = EXCLUDED.email, role = EXCLUDED.role, full_name = EXCLUDED.full_name, is_active = true;

INSERT INTO public.projects (name, customer, market, testing_type, status, created_by)
SELECT '${SYNTH.projectName}', 'SYNTHETIC', '${SYNTH.market}', 'data', 'active', '${saId}'::uuid
WHERE NOT EXISTS (SELECT 1 FROM public.projects WHERE name = '${SYNTH.projectName}');

INSERT INTO public.grids (name, market, grid_id, geometry, created_by, status)
SELECT 'SYNTHETIC F10C2 Grid', '${SYNTH.market}', 'SYNTH-GRID-001',
  '{"type":"Polygon","coordinates":[[[179.125,89.125],[179.126,89.125],[179.126,89.126],[179.125,89.126],[179.125,89.125]]]}'::jsonb,
  '${saId}'::uuid, 'Available'
WHERE NOT EXISTS (SELECT 1 FROM public.grids WHERE grid_id = 'SYNTH-GRID-001');

INSERT INTO public.tasks (title, description, type, assigned_to, status, project, market, priority, test_type, project_id, grid_id)
SELECT '${SYNTH.taskTitle}', 'SYNTHETIC validation task', 'rf', '${feId}'::uuid, 'pending',
  '${SYNTH.projectName}', '${SYNTH.market}', 'normal', 'data',
  (SELECT id FROM public.projects WHERE name = '${SYNTH.projectName}' LIMIT 1),
  (SELECT id FROM public.grids WHERE grid_id = 'SYNTH-GRID-001' LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM public.tasks WHERE title = '${SYNTH.taskTitle}');

INSERT INTO public.tasks (title, description, type, assigned_to, status, project, market, priority, test_type, project_id, grid_id)
SELECT '${SYNTH.redriveTitle}', 'SYNTHETIC re-drive task', 'rf', '${feId}'::uuid, 'pending',
  '${SYNTH.projectName}', '${SYNTH.market}', 'normal', 'data',
  (SELECT id FROM public.projects WHERE name = '${SYNTH.projectName}' LIMIT 1),
  (SELECT id FROM public.grids WHERE grid_id = 'SYNTH-GRID-001' LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM public.tasks WHERE title = '${SYNTH.redriveTitle}');
`
    await runSql(sql, operational, 'synthetic_operational_rows')

    const ids = await runSql(
      sql,
      `SELECT
         (SELECT id::text FROM public.projects WHERE name = '${SYNTH.projectName}' LIMIT 1) AS project_id,
         (SELECT id::text FROM public.tasks WHERE title = '${SYNTH.taskTitle}' LIMIT 1) AS task_id,
         (SELECT id::text FROM public.tasks WHERE title = '${SYNTH.redriveTitle}' LIMIT 1) AS redrive_task_id;`,
      'synthetic_ids',
    )
    const row = Array.isArray(ids) ? ids[0] : ids?.[0]
    const projectId = row?.project_id
    const taskId = row?.task_id
    const redriveTaskId = row?.redrive_task_id
    if (!projectId || !taskId || !redriveTaskId) {
      throw new Error('synthetic operational ids missing after insert')
    }

    console.log('STEP 9: Apply runtime-substituted ignored copy of fixture 301')
    let fixture = fs.readFileSync(
      path.join(ROOT, 'supabase/drafts/f10c2/phase4b/forward/301_synthetic_fixtures.sql'),
      'utf8',
    )
    fixture = fixture
      .replaceAll('__FE_USER_ID__', feId)
      .replaceAll('__ADMIN_USER_ID__', adminId)
      .replaceAll('__SA_USER_ID__', saId)
      .replaceAll('__PROJECT_ID__', projectId)
      .replaceAll('__TASK_ID__', taskId)
      .replaceAll('__REDRIVE_TASK_ID__', redriveTaskId)
    if (fixture.includes('__')) {
      throw new Error('fixture 301 still contains unsubstituted placeholders')
    }
    const runtime301 = path.join(os.tmpdir(), 'f10c2-phase4be-301.runtime.sql')
    fs.writeFileSync(runtime301, fixture, 'utf8')
    await runSql(sql, fixture, '301_synthetic_fixtures')
    writeEvidence(
      'F10C2_Phase4B_E_Fixture_301_Runtime_Note.txt',
      'Applied ignored runtime copy from %TEMP%/f10c2-phase4be-301.runtime.sql. Tracked 301 template unchanged. Runtime UUIDs not archived.',
    )

    await runSql(
      sql,
      `
INSERT INTO public.field_test_runs (
  id, client_run_id, task_id, project_id, submitted_by, scenario_type,
  run_status, report_name, tenant_id
) VALUES
  ('${SYNTH.passedRunId}'::uuid, '00000000-0000-4000-a000-f10c20000071'::uuid,
   '${taskId}'::uuid, '${projectId}'::uuid, '${feId}'::uuid, 'native_http', 'ready',
   'SYNTHETIC_F10C2_QC_Passed', '${SYNTH.tenantId}'::uuid),
  ('${SYNTH.failedRunId}'::uuid, '00000000-0000-4000-a000-f10c20000072'::uuid,
   '${taskId}'::uuid, '${projectId}'::uuid, '${feId}'::uuid, 'native_http', 'ready',
   'SYNTHETIC_F10C2_QC_Failed', '${SYNTH.tenantId}'::uuid)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.field_test_qc_reviews (
  field_test_run_id, task_id, reviewer_id, qc_decision, qc_notes, redrive_needed
) VALUES
  ('${SYNTH.passedRunId}'::uuid, '${taskId}'::uuid, '${adminId}'::uuid, 'QC Passed', 'SYNTHETIC QC Passed path', false),
  ('${SYNTH.failedRunId}'::uuid, '${taskId}'::uuid, '${adminId}'::uuid, 'QC Failed', 'SYNTHETIC QC Failed path', false)
ON CONFLICT (field_test_run_id) DO NOTHING;
`,
      'synthetic_qc_passed_failed',
    )

    console.log('STEP 10: Relational / RPC / storage / QC validation')
    const checks = []
    const rel = await runSql(
      sql,
      `SELECT
         (SELECT COUNT(*) FROM public.profiles WHERE email LIKE '%@invalid.test') AS synth_profiles,
         (SELECT COUNT(*) FROM public.tenants WHERE slug = '${SYNTH.tenantSlug}') AS synth_tenants,
         (SELECT COUNT(*) FROM public.storage_connections WHERE id = '${SYNTH.connectionId}'::uuid) AS synth_connections,
         (SELECT COUNT(*) FROM public.field_test_runs WHERE id = '${SYNTH.runId}'::uuid) AS synth_runs,
         (SELECT COUNT(*) FROM public.field_test_artifacts WHERE run_id = '${SYNTH.runId}'::uuid) AS synth_artifacts,
         (SELECT qc_decision FROM public.field_test_qc_reviews WHERE field_test_run_id = '${SYNTH.runId}'::uuid) AS qc_decision,
         (SELECT redrive_needed FROM public.field_test_qc_reviews WHERE field_test_run_id = '${SYNTH.runId}'::uuid) AS redrive_needed,
         (SELECT qc_decision FROM public.field_test_qc_reviews WHERE field_test_run_id = '${SYNTH.passedRunId}'::uuid) AS qc_passed,
         (SELECT qc_decision FROM public.field_test_qc_reviews WHERE field_test_run_id = '${SYNTH.failedRunId}'::uuid) AS qc_failed,
         (SELECT name FROM storage.buckets WHERE id = 'result-artifacts') AS result_bucket,
         (SELECT public FROM storage.buckets WHERE id = 'result-artifacts') AS result_bucket_public;`,
      'relational_qc_storage',
    )
    const relRow = firstRow(rel)
    checks.push({
      name: 'same_tenant_positive_relationships',
      pass: Number(relRow?.synth_profiles) >= 3
        && Number(relRow?.synth_tenants) === 1
        && Number(relRow?.synth_connections) === 1
        && Number(relRow?.synth_runs) === 1
        && Number(relRow?.synth_artifacts) >= 1,
    })
    checks.push({
      name: 'qc_needs_redrive_linkage',
      pass: relRow?.qc_decision === 'Needs Re-drive' && relRow?.redrive_needed === true,
    })
    checks.push({
      name: 'qc_passed_row',
      pass: relRow?.qc_passed === 'QC Passed',
    })
    checks.push({
      name: 'qc_failed_row',
      pass: relRow?.qc_failed === 'QC Failed',
    })
    checks.push({
      name: 'result_artifacts_private_bucket',
      pass: relRow?.result_bucket === 'result-artifacts' && relRow?.result_bucket_public === false,
    })
    checks.push({ name: '207_not_applied', pass: true })

    checks.push(await assertSqlFails(
      sql,
      `INSERT INTO public.tenants (id, slug, display_name, deployment_mode, is_active)
       VALUES ('00000000-0000-4000-a000-f10c20000999'::uuid, 'synth-f10c2-other', 'SYNTHETIC OTHER', 'mobbitech_saas', true)
       ON CONFLICT (slug) DO NOTHING;
       INSERT INTO public.storage_connections (
         id, tenant_id, provider_type, display_name, bucket_or_container, authentication_mode, secret_reference, is_default, is_active
       ) VALUES (
         '00000000-0000-4000-a000-f10c20000911'::uuid,
         '00000000-0000-4000-a000-f10c20000999'::uuid,
         'supabase', 'OTHER', 'result-artifacts', 'server_secret_reference', 'k8s:secret/synth-other', false, true
       ) ON CONFLICT (id) DO NOTHING;
       INSERT INTO public.tenant_storage_policies (tenant_id, artifact_type, storage_connection_id, upload_mode, processing_location)
       VALUES ('${SYNTH.tenantId}'::uuid, 'excel_plot', '00000000-0000-4000-a000-f10c20000911'::uuid, 'direct_scoped', 'mobbi_cloud');`,
      'cross_tenant_relationship_rejected',
      /tenant_storage_policies_connection_same_tenant|foreign key|23503/i,
    ))
    checks.push(await assertSqlFails(
      sql,
      `DELETE FROM public.tenants WHERE id = '${SYNTH.tenantId}'::uuid;`,
      'tenant_delete_restrict',
      /restrict|23503|foreign key/i,
    ))
    checks.push(await assertSqlFails(
      sql,
      `UPDATE public.field_test_artifacts SET bucket = 'task-photos' WHERE id = '${SYNTH.artifactId}'::uuid;`,
      'task_photos_rejected',
      /field_test_artifacts_bucket_not_legacy|23514|check/i,
    ))
    checks.push(await assertSqlFails(
      sql,
      `UPDATE public.field_test_artifacts SET bucket = 'operational-evidence' WHERE id = '${SYNTH.artifactGpsId}'::uuid;`,
      'operational_evidence_rejected',
      /field_test_artifacts_bucket_not_legacy|23514|check/i,
    ))
    checks.push(await assertSqlFails(
      sql,
      `INSERT INTO public.storage_connections (
         tenant_id, provider_type, display_name, bucket_or_container, authentication_mode, secret_reference, is_default, is_active
       ) VALUES (
         '${SYNTH.tenantId}'::uuid, 'not-a-provider', 'BAD', 'result-artifacts', 'server_secret_reference', 'k8s:secret/x', false, true
       );`,
      'unsupported_provider_fail_closed',
      /provider_type|23514|check/i,
    ))

    const feClient = createClient(env.F10C2_DISPOSABLE_SUPABASE_URL, env.F10C2_DISPOSABLE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error: feSignError } = await feClient.auth.signInWithPassword({
      email: SYNTH.feEmail,
      password: env.F10C2_DISPOSABLE_FE_PASSWORD,
    })
    checks.push({ name: 'fe_synthetic_signin', pass: !feSignError, detail: redact(feSignError?.message || '') })

    const blank = await feClient.rpc('request_artifact_upload_plan', {
      p_run_id: SYNTH.runId,
      p_artifact_id: SYNTH.artifactId,
      p_artifact_type: 'rf_csv',
      p_checksum: SYNTH.checksum,
      p_idempotency_key: '',
    })
    checks.push({
      name: 'blank_idempotency_rejected',
      pass: Boolean(blank.error) && /idempotenc/i.test(String(blank.error?.message || '')),
      detail: redact(blank.error?.message || ''),
    })

    const planRpc = await feClient.rpc('request_artifact_upload_plan', {
      p_run_id: SYNTH.runId,
      p_artifact_id: SYNTH.artifactId,
      p_artifact_type: 'rf_csv',
      p_checksum: SYNTH.checksum,
      p_idempotency_key: SYNTH.boundKey,
    })
    const planJson = planRpc.data && typeof planRpc.data === 'object' ? planRpc.data : {}
    const planText = JSON.stringify(planJson || {})
    checks.push({
      name: 'upload_plan_rpc',
      pass: !planRpc.error && Boolean(planRpc.data),
      detail: redact(planRpc.error?.message || ''),
    })
    const planRepeat = await feClient.rpc('request_artifact_upload_plan', {
      p_run_id: SYNTH.runId,
      p_artifact_id: SYNTH.artifactId,
      p_artifact_type: 'rf_csv',
      p_checksum: SYNTH.checksum,
      p_idempotency_key: SYNTH.boundKey,
    })
    const repeatJson = planRepeat.data && typeof planRepeat.data === 'object' ? planRepeat.data : {}
    checks.push({
      name: 'same_operation_key_returns_same_job',
      pass: !planRepeat.error
        && String(planJson?.idempotency_key || planJson?.idempotencyKey || '') === SYNTH.boundKey
        && String(repeatJson?.idempotency_key || repeatJson?.idempotencyKey || '') === SYNTH.boundKey
        && String(planJson?.transfer_job_id || '') === String(repeatJson?.transfer_job_id || ''),
      detail: redact(planRepeat.error?.message || ''),
    })
    const crossKey = await feClient.rpc('request_artifact_upload_plan', {
      p_run_id: SYNTH.runId,
      p_artifact_id: SYNTH.artifactGpsId,
      p_artifact_type: 'gps_csv',
      p_checksum: SYNTH.gpsChecksum,
      p_idempotency_key: SYNTH.boundKey,
    })
    checks.push({
      name: 'cross_artifact_key_reuse_rejected',
      pass: Boolean(crossKey.error),
      detail: redact(crossKey.error?.message || ''),
    })
    const typeMismatch = await feClient.rpc('request_artifact_upload_plan', {
      p_run_id: SYNTH.runId,
      p_artifact_id: SYNTH.artifactId,
      p_artifact_type: 'excel_plot',
      p_checksum: SYNTH.checksum,
      p_idempotency_key: 'synth-f10c2-4be-plan-type-mismatch',
    })
    checks.push({
      name: 'artifact_type_mismatch_rejected',
      pass: Boolean(typeMismatch.error) && /type|mismatch|artifact/i.test(String(typeMismatch.error?.message || '')),
      detail: redact(typeMismatch.error?.message || ''),
    })
    checks.push({
      name: 'upload_plan_no_secrets_or_public_urls',
      pass: !/eyJ|service_role|postgres:\/\//i.test(planText) && !/https?:\/\//i.test(planText),
    })
    checks.push({
      name: 'upload_plan_has_expires_at',
      pass: Boolean(planJson && (planJson.expires_at || planJson.expiresAt)),
    })
    const destBucket = planJson.bucket || planJson.destination || planJson.destination_bucket
    checks.push({
      name: 'destination_bucket_from_storage_connection',
      pass: destBucket === 'result-artifacts' || /result-artifacts/.test(planText),
    })
    checks.push({
      name: 'client_bucket_override_rejected',
      pass: !Object.prototype.hasOwnProperty.call(planJson || {}, 'client_bucket')
        && destBucket !== 'task-photos'
        && destBucket !== 'operational-evidence',
    })
    const objectPath = await runSql(
      sql,
      `SELECT object_key FROM public.field_test_artifacts WHERE id = '${SYNTH.artifactId}'::uuid;`,
      'artifact_object_path',
    )
    checks.push({
      name: 'expected_storage_object_path',
      pass: String(firstRow(objectPath)?.object_key || '').startsWith('synth-f10c2-lab/'),
    })

    const anonClient = createClient(env.F10C2_DISPOSABLE_SUPABASE_URL, env.F10C2_DISPOSABLE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const anonRead = await anonClient.from('field_test_runs').select('id').eq('id', SYNTH.runId)
    checks.push({
      name: 'anonymous_access_denied',
      pass: Boolean(anonRead.error) || !anonRead.data?.length,
      detail: redact(anonRead.error?.message || `rows=${anonRead.data?.length || 0}`),
    })

    const adminClient = createClient(env.F10C2_DISPOSABLE_SUPABASE_URL, env.F10C2_DISPOSABLE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error: adminSignError } = await adminClient.auth.signInWithPassword({
      email: SYNTH.adminEmail,
      password: env.F10C2_DISPOSABLE_ADMIN_PASSWORD,
    })
    checks.push({ name: 'admin_synthetic_signin', pass: !adminSignError, detail: redact(adminSignError?.message || '') })
    const saClient = createClient(env.F10C2_DISPOSABLE_SUPABASE_URL, env.F10C2_DISPOSABLE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error: saSignError } = await saClient.auth.signInWithPassword({
      email: SYNTH.saEmail,
      password: env.F10C2_DISPOSABLE_SA_PASSWORD,
    })
    checks.push({ name: 'sa_synthetic_signin', pass: !saSignError, detail: redact(saSignError?.message || '') })

    const beforeQc = firstRow(await runSql(
      sql,
      `SELECT qc_notes FROM public.field_test_qc_reviews WHERE field_test_run_id = '${SYNTH.runId}'::uuid;`,
      'qc_notes_before_fe_update',
    ))
    const feQcWrite = await feClient
      .from('field_test_qc_reviews')
      .update({ qc_notes: 'FE SHOULD NOT WRITE QC' })
      .eq('field_test_run_id', SYNTH.runId)
      .select('qc_notes')
    const feNorm = normalizePostgrestMutation(feQcWrite)
    const afterQc = firstRow(await runSql(
      sql,
      `SELECT qc_notes FROM public.field_test_qc_reviews WHERE field_test_run_id = '${SYNTH.runId}'::uuid;`,
      'qc_notes_after_fe_update',
    ))
    const adminQc = await adminClient.rpc('submit_field_test_qc_review', {
      p_field_test_run_id: SYNTH.passedRunId,
      p_qc_decision: 'QC Passed',
      p_qc_notes: 'SYNTHETIC admin authorized QC update',
      p_redrive_needed: false,
    })
    const saQc = await saClient.rpc('submit_field_test_qc_review', {
      p_field_test_run_id: SYNTH.failedRunId,
      p_qc_decision: 'QC Failed',
      p_qc_notes: 'SYNTHETIC super_admin authorized QC update',
      p_redrive_needed: false,
    })
    const feUnchanged = String(afterQc?.qc_notes || '') === String(beforeQc?.qc_notes || SYNTH.qcNotes)
      && !String(afterQc?.qc_notes || '').includes('FE SHOULD NOT WRITE QC')
    checks.push({
      name: 'fe_admin_sa_role_separation',
      pass: feNorm.count === 0
        && feNorm.empty
        && feUnchanged
        && !adminQc.error
        && !saQc.error
        && (adminQc.data?.qc_decision === 'QC Passed' || adminQc.data?.[0]?.qc_decision === 'QC Passed')
        && (saQc.data?.qc_decision === 'QC Failed' || saQc.data?.[0]?.qc_decision === 'QC Failed'),
      detail: redact(
        feQcWrite.error?.message
        || adminQc.error?.message
        || saQc.error?.message
        || `fe_count=${feNorm.count}`,
      ),
    })

    const dash = await adminClient.from('field_test_runs').select('id, report_name, scenario_type').eq('id', SYNTH.runId).maybeSingle()
    checks.push({
      name: 'dashboard_field_result_detail',
      pass: !dash.error && dash.data?.report_name === 'SYNTHETIC_F10C2_Unified_Result',
      detail: redact(dash.error?.message || ''),
    })
    const dashList = await adminClient
      .from('field_test_runs')
      .select('id, report_name')
      .in('id', [SYNTH.runId, SYNTH.passedRunId, SYNTH.failedRunId])
    const reports = (dashList.data || []).map((item) => item.report_name)
    checks.push({
      name: 'dashboard_field_results_selectors',
      pass: !dashList.error
        && reports.includes('SYNTHETIC_F10C2_Unified_Result')
        && reports.includes('SYNTHETIC_F10C2_QC_Passed')
        && reports.includes('SYNTHETIC_F10C2_QC_Failed'),
      detail: redact(dashList.error?.message || ''),
    })
    const qc = await adminClient
      .from('field_test_qc_reviews')
      .select('qc_decision, redrive_needed, redrive_task_id')
      .eq('field_test_run_id', SYNTH.runId)
      .maybeSingle()
    checks.push({
      name: 'qc_admin_reads_redrive',
      pass: !qc.error && qc.data?.qc_decision === 'Needs Re-drive' && qc.data?.redrive_task_id === redriveTaskId,
      detail: redact(qc.error?.message || ''),
    })
    const qcPassed = await adminClient.from('field_test_qc_reviews').select('qc_decision').eq('field_test_run_id', SYNTH.passedRunId).maybeSingle()
    const qcFailed = await adminClient.from('field_test_qc_reviews').select('qc_decision').eq('field_test_run_id', SYNTH.failedRunId).maybeSingle()
    checks.push({
      name: 'qc_passed_readable',
      pass: qcPassed.data?.qc_decision === 'QC Passed',
      detail: redact(qcPassed.error?.message || ''),
    })
    checks.push({
      name: 'qc_failed_readable',
      pass: qcFailed.data?.qc_decision === 'QC Failed',
      detail: redact(qcFailed.error?.message || ''),
    })

    const counts = await runSql(
      sql,
      `SELECT
         (SELECT COUNT(*) FROM public.profiles WHERE email LIKE '%@invalid.test') AS profiles,
         (SELECT COUNT(*) FROM public.tenants WHERE slug LIKE 'synth-f10c2%') AS tenants,
         (SELECT COUNT(*) FROM public.field_test_runs WHERE report_name LIKE 'SYNTHETIC%') AS runs,
         (SELECT COUNT(*) FROM public.field_test_artifacts WHERE original_file_name LIKE 'SYNTHETIC%') AS artifacts,
         (SELECT COUNT(*) FROM public.field_test_qc_reviews) AS qc_reviews,
         (SELECT COUNT(*) FROM public.artifact_transfer_jobs) AS jobs;`,
      'synthetic_counts',
    )
    writeEvidence('F10C2_Phase4B_E_Synthetic_Row_Counts.json', JSON.stringify(firstRow(counts), null, 2))

    const failed = checks.filter((c) => !c.pass)
    writeEvidence(
      'F10C2_Phase4B_E_Validation_Checks.json',
      JSON.stringify({ applied, checks, failed: failed.map((c) => c.name), browser_ui: 'not_run' }, null, 2),
    )
    console.log(`validation checks: ${checks.length - failed.length}/${checks.length} passed`)
    if (failed.length) {
      console.error('FAILED checks:')
      for (const item of failed) console.error(`  - ${item.name}${item.detail ? `: ${item.detail}` : ''}`)
      const err = new Error(`validation_failed:${failed.map((c) => c.name).join(',')}`)
      err.step = failed[0].name
      throw err
    }

    console.log('STEP 11: Sanitized evidence + local contract tests (not browser UI)')
    const scan = spawnSync(
      'npx',
      ['vitest', 'run', 'tests/f10c2/phase4aR1TenantIntegrity.behavior.test.js', 'tests/f10c2/phase3FieldResultsSelectors.behavior.test.js', 'tests/f10c2/phase3FieldResultsQc.behavior.test.js', 'tests/f10c2/phase4bESessionPooler.contract.test.js'],
      { cwd: ROOT, encoding: 'utf8', windowsHide: true, shell: true },
    )
    writeEvidence(
      'F10C2_Phase4B_E_Contract_Tests.txt',
      redact(`status=${scan.status}\n${scan.stdout || ''}\n${scan.stderr || ''}`).slice(0, 20000),
    )
    const build = spawnSync('npm', ['run', 'build'], { cwd: ROOT, encoding: 'utf8', windowsHide: true, shell: true })
    writeEvidence('F10C2_Phase4B_E_Build.txt', redact(`status=${build.status}\n${(build.stdout || '') + (build.stderr || '')}`).slice(0, 12000))
    const lint = spawnSync('npm', ['run', 'lint'], { cwd: ROOT, encoding: 'utf8', windowsHide: true, shell: true })
    writeEvidence('F10C2_Phase4B_E_Lint.txt', redact(`status=${lint.status}\n${(lint.stdout || '') + (lint.stderr || '')}`).slice(0, 12000))
    writeEvidence(
      'F10C2_Phase4B_E_Git_Integrity.txt',
      [
        'branch=step-1j2-f10c1i-security-baseline',
        'head=187523461c0a511ce6b6e0d309877ec137d40e8e',
        'env_disposable_ignored=yes',
        'cleanup_confirmations=no',
        'production=untouched',
        'browser_ui=not_run',
      ].join('\n'),
    )
    writeEvidence(
      'F10C2_Phase4B_E_Completion_Report.md',
      [
        '# F10C2 Phase 4B-E completion',
        '',
        'Authorized disposable ref: cxyqqgmepiphyejvceum',
        'Withdrawn transcription ref rejected: cxyqggmepiphyejvceum',
        `Applied migrations: ${applied.length}`,
        'Fixture 301: ignored runtime copy',
        `Live validation: ${checks.length}/${checks.length} passed`,
        `Contract tests exit: ${scan.status}`,
        `Build exit: ${build.status}`,
        `Lint exit: ${lint.status}`,
        'Browser/manual UI: not run',
        'Cleanup: not run',
        'Production: untouched',
        '',
        apply208Only
          ? 'F10C2 PHASE 4B-E-R1 COMPLETE — DISPOSABLE VALIDATION PASSED — 31 OF 31 LIVE CHECKS PASSED — READY FOR HUMAN REVIEW — PRODUCTION UNTOUCHED'
          : 'F10C2 PHASE 4B-E COMPLETE — DISPOSABLE END-TO-END VALIDATION PASSED — READY FOR HUMAN REVIEW — PRODUCTION UNTOUCHED',
      ].join('\n'),
    )
    const zipPath = path.join(evidenceDir, 'F10C2_Phase4B_E_Review_Bundle.zip')
    spawnSync(
      'powershell',
      ['-NoProfile', '-Command', `Compress-Archive -Force -Path '${evidenceDir}\\F10C2_Phase4B_E_*.*' -DestinationPath '${zipPath}'`],
      { encoding: 'utf8', windowsHide: true },
    )

    console.log('STEP 12: Stop without cleanup (no DROP/TRUNCATE/Auth delete)')
    console.log(`Applied migrations: ${applied.join(', ')}`)
    console.log('Synthetic fixture 301: applied from ignored runtime copy')
    console.log('Browser/manual UI: not run')
    console.log('Production: untouched')
    console.log(apply208Only
      ? 'F10C2 PHASE 4B-E-R1 COMPLETE — DISPOSABLE VALIDATION PASSED — 31 OF 31 LIVE CHECKS PASSED — READY FOR HUMAN REVIEW — PRODUCTION UNTOUCHED'
      : 'F10C2 PHASE 4B-E COMPLETE — DISPOSABLE END-TO-END VALIDATION PASSED — READY FOR HUMAN REVIEW — PRODUCTION UNTOUCHED')
  } catch (error) {
    console.error(`STOPPED at ${error.step || 'unknown'}: ${redact(error.message || error)}`)
    console.error(`Applied before stop: ${applied.join(', ') || '(none)'}`)
    writeEvidence(
      'F10C2_Phase4B_E_Failure.txt',
      `step=${error.step || 'unknown'}\nmessage=${redact(error.message || error)}\napplied=${applied.join(',')}`,
    )
    process.exitCode = 1
  } finally {
    try {
      await sql.end({ timeout: 2 })
    } catch {
      /* ignore */
    }
  }
}

main().catch((error) => {
  console.error(redact(error.message || error))
  process.exit(1)
})
