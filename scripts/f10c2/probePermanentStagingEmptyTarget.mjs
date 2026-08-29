/**
 * CR1-E permanent-staging READ-ONLY empty-target probe (no SQL, no mutations).
 * Never prints secrets, keys, JWTs, emails, URLs-with-keys, or connection strings.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AUTHORIZED_STAGING_API_HOST,
  AUTHORIZED_STAGING_PROJECT_NAME,
  AUTHORIZED_STAGING_PROJECT_REF,
  DENIED_DISPOSABLE_PROJECT_REF,
  DENIED_PRODUCTION_REF_PREFIX,
  evaluatePermanentStagingTarget,
  loadPermanentStagingEnv,
  presenceMatrix,
} from './assertPermanentStagingTarget.mjs'
import { parseDisposableDbUri } from '../../src/lib/phase4bTargetGuard.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const AUDIT_DIR = path.join(ROOT, '..', 'Audit Data', 'F10C2', 'CR1-E')
const PLACEHOLDER_RE = /^(your_|changeme|todo|xxx|placeholder|example|replace|<.*>|\[.*\])$/i

const ALIAS_NAMES = [
  'F10C2_PERMANENT_STAGING_CONFIRMED',
  'F10C2_PERMANENT_STAGING_ENVIRONMENT_NAME',
  'F10C2_PERMANENT_STAGING_PROJECT_NAME',
  'F10C2_PERMANENT_STAGING_PROJECT_REF',
  'F10C2_PERMANENT_STAGING_NOT_PRODUCTION',
  'F10C2_PERMANENT_STAGING_CONNECTION_METHOD',
  'F10C2_PERMANENT_STAGING_SQL_EXECUTION_APPROVED',
  'F10C2_PERMANENT_STAGING_SUPABASE_URL',
  'F10C2_PERMANENT_STAGING_ANON_KEY',
  'F10C2_PERMANENT_STAGING_SERVICE_ROLE_KEY',
  'F10C2_PERMANENT_STAGING_DB_URL',
  'F10C2_PERMANENT_STAGING_SA_EMAIL',
  'F10C2_PERMANENT_STAGING_SA_PASSWORD',
  'F10C2_PERMANENT_STAGING_ADMIN_EMAIL',
  'F10C2_PERMANENT_STAGING_ADMIN_PASSWORD',
  'F10C2_PERMANENT_STAGING_FE_EMAIL',
  'F10C2_PERMANENT_STAGING_FE_PASSWORD',
]

const BABYDRAGON_TABLES = [
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
  'security_audit_log',
  'field_test_runs',
  'field_test_artifacts',
  'field_test_metrics',
  'field_test_qc_reviews',
  'field_test_iterations',
  'field_test_call_events',
  'tenants',
  'storage_connections',
  'tenant_storage_policies',
  'artifact_transfer_jobs',
  'acceptance_profiles',
  'acceptance_rules',
  'acceptance_rule_snapshots',
  'acceptance_evaluations',
  'schema_migrations',
  'supabase_migrations',
]

const BABYDRAGON_RPCS = [
  'set_acceptance_profile_active',
  'ingest_field_test_canonical_result',
  'evaluate_field_test_run_acceptance',
  'submit_field_test_run',
  'is_super_admin',
]

const BABYDRAGON_BUCKETS = ['result-artifacts', 'task-photos', 'operational-evidence']

function trimStr(value) {
  return String(value || '').trim()
}

function isNonEmpty(value) {
  const raw = trimStr(value)
  if (!raw) return false
  if (PLACEHOLDER_RE.test(raw)) return false
  return true
}

function firstNonEmpty(env, names) {
  for (const name of names) {
    if (isNonEmpty(env[name])) return env[name]
  }
  return ''
}

function aliasPresence(env) {
  const matrix = {}
  for (const name of ALIAS_NAMES) {
    matrix[name] = isNonEmpty(env[name]) ? 'present' : 'absent'
  }
  return matrix
}

function identityHaystackHasDenied(values) {
  const hay = values.map((v) => String(v || '').toLowerCase()).join('\n')
  return {
    hasProductionPrefix: hay.includes(DENIED_PRODUCTION_REF_PREFIX),
    hasDisposableRef: hay.includes(DENIED_DISPOSABLE_PROJECT_REF),
  }
}

function sanitizeErrorCode(status, bodyText) {
  let code = ''
  let messageClass = 'none'
  try {
    const parsed = JSON.parse(bodyText)
    code = trimStr(parsed?.code)
    const msg = trimStr(parsed?.message || parsed?.error_description || parsed?.error || parsed?.msg)
    if (/could not find the function/i.test(msg)) {
      messageClass = 'missing_function'
    } else if (/could not find the table|could not find the relation|schema cache/i.test(msg)) {
      messageClass = 'missing_relation'
    } else if (/invalid api key|invalid jwt|jwt expired|malformed/i.test(msg)) {
      messageClass = 'auth_error'
    } else if (/permission|row-level|rls|not authorized|forbidden/i.test(msg)) {
      messageClass = 'permission'
    } else if (msg) {
      messageClass = 'other_sanitized'
    }
  } catch {
    if (/could not find the table/i.test(bodyText)) messageClass = 'missing_relation'
    else if (bodyText) messageClass = 'non_json'
  }
  return { status, code: code || null, messageClass }
}

function classifyTableProbe(status, bodyText) {
  const info = sanitizeErrorCode(status, bodyText)
  if (info.code === 'PGRST205' || info.code === 'PGRST106' || info.messageClass === 'missing_relation' || status === 404) {
    return { classification: 'absent', ...info }
  }
  if (info.code === 'PGRST116') {
    return { classification: 'absent_per_operator_pgrst116', ...info }
  }
  if (info.messageClass === 'auth_error') {
    return { classification: 'auth_failed', ...info }
  }
  if (status === 200 || status === 206 || status === 207) {
    return { classification: 'present', ...info }
  }
  if (status === 401 || status === 403 || info.messageClass === 'permission') {
    return { classification: 'present_permission_denied', ...info }
  }
  return { classification: 'unknown', ...info }
}

export { BABYDRAGON_TABLES, BABYDRAGON_RPCS, classifyTableProbe, classifyRpcProbe }

function classifyRpcProbe(status, bodyText) {
  const info = sanitizeErrorCode(status, bodyText)
  if (info.code === 'PGRST202' || info.messageClass === 'missing_function' || status === 404) {
    return { classification: 'absent', ...info }
  }
  if (info.messageClass === 'auth_error') {
    return { classification: 'auth_failed', ...info }
  }
  if (status === 200 || status === 201) {
    return { classification: 'present', ...info }
  }
  if (status === 400 || status === 401 || status === 403) {
    if (info.messageClass === 'missing_function') return { classification: 'absent', ...info }
    return { classification: 'present_or_callable', ...info }
  }
  return { classification: 'unknown', ...info }
}

function extractOpenApiTableNames(spec) {
  const names = new Set()
  if (!spec || typeof spec !== 'object') return []
  const paths = spec.paths && typeof spec.paths === 'object' ? spec.paths : {}
  for (const p of Object.keys(paths)) {
    const trimmed = p.replace(/^\//, '').split('/')[0]
    if (trimmed && trimmed !== 'rpc') names.add(trimmed)
  }
  const defs = spec.definitions && typeof spec.definitions === 'object' ? spec.definitions : {}
  for (const d of Object.keys(defs)) names.add(d)
  const schemas = spec.components?.schemas && typeof spec.components.schemas === 'object'
    ? spec.components.schemas
    : {}
  for (const d of Object.keys(schemas)) names.add(d)
  return [...names].sort()
}

function extractOpenApiRpcNames(spec) {
  const names = new Set()
  const paths = spec?.paths && typeof spec.paths === 'object' ? spec.paths : {}
  for (const p of Object.keys(paths)) {
    const m = p.match(/^\/rpc\/([^/]+)/)
    if (m) names.add(m[1])
  }
  return [...names].sort()
}

async function requestJson({ url, method = 'GET', headers = {}, body }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal })
    const text = await res.text()
    return { status: res.status, ok: res.ok, text, headers: res.headers }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * REST-only empty-DB proof. Does not send SQL. Fails if BabyDragon tables/RPCs exist.
 */
export async function proveEmptyStagingViaRest({ base, headers, requestImpl } = {}) {
  const request = requestImpl || requestJson
  const presentTables = []
  const presentRpcs = []
  const unknown = []
  const tables = {}
  for (const table of BABYDRAGON_TABLES) {
    const res = await request({
      url: `${base}/rest/v1/${encodeURIComponent(table)}?select=*&limit=1`,
      headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
    })
    const classified = classifyTableProbe(res.status, res.text)
    tables[table] = classified.classification
    if (classified.classification === 'present' || classified.classification === 'present_permission_denied') {
      presentTables.push(table)
    } else if (classified.classification !== 'absent' && classified.classification !== 'absent_per_operator_pgrst116') {
      unknown.push(table)
    }
  }
  const rpcs = {}
  for (const rpc of BABYDRAGON_RPCS) {
    const res = await request({
      url: `${base}/rest/v1/rpc/${encodeURIComponent(rpc)}`,
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: '{}',
    })
    const classified = classifyRpcProbe(res.status, res.text)
    rpcs[rpc] = classified.classification
    if (classified.classification === 'absent') continue
    if (classified.classification === 'auth_failed') unknown.push(`rpc:${rpc}`)
    else presentRpcs.push(rpc)
  }
  const findings = []
  if (presentTables.length) findings.push(`BabyDragon REST tables present: ${presentTables.join(', ')}`)
  if (presentRpcs.length) findings.push(`BabyDragon REST rpcs present: ${presentRpcs.join(', ')}`)
  if (unknown.length) findings.push(`unclassified REST probes: ${unknown.join(', ')}`)
  return {
    performed: true,
    ok: presentTables.length === 0 && presentRpcs.length === 0 && unknown.length === 0,
    presentTables,
    presentRpcs,
    unknown,
    tables,
    rpcs,
    findings,
    sqlSent: false,
  }
}

function log(line) {
  console.log(line)
}

async function main() {
  const loaded = loadPermanentStagingEnv(ROOT)
  const env = loaded.env
  const matrix = presenceMatrix(env)
  const aliases = aliasPresence(env)

  const projectName = firstNonEmpty(env, ['BABYDRAGON_STAGING_PROJECT_NAME', 'F10C2_PERMANENT_STAGING_PROJECT_NAME'])
  const projectRef = firstNonEmpty(env, ['BABYDRAGON_STAGING_PROJECT_REF', 'F10C2_PERMANENT_STAGING_PROJECT_REF'])
  const apiUrl = firstNonEmpty(env, ['BABYDRAGON_STAGING_SUPABASE_URL', 'F10C2_PERMANENT_STAGING_SUPABASE_URL'])
  const dbUrl = firstNonEmpty(env, ['BABYDRAGON_STAGING_DATABASE_URL', 'F10C2_PERMANENT_STAGING_DB_URL'])
  const anonKey = firstNonEmpty(env, ['BABYDRAGON_STAGING_ANON_KEY', 'F10C2_PERMANENT_STAGING_ANON_KEY'])
  const serviceKey = firstNonEmpty(env, ['BABYDRAGON_STAGING_SERVICE_ROLE_KEY', 'F10C2_PERMANENT_STAGING_SERVICE_ROLE_KEY'])

  const evaluated = evaluatePermanentStagingTarget({
    projectName,
    projectRef,
    apiUrl,
    dbUrl,
  })

  const denied = identityHaystackHasDenied([projectName, projectRef, apiUrl, dbUrl, evaluated.apiHost])

  let dbHostnameContainsAuthorizedRef = false
  let dbPoolerUsernameMatches = false
  let dbMode = null
  let dbUriOk = false
  let dbUriReasons = []
  if (dbUrl) {
    const parsed = parseDisposableDbUri(dbUrl, AUTHORIZED_STAGING_PROJECT_REF)
    dbMode = parsed.mode
    dbUriOk = parsed.ok
    dbUriReasons = parsed.reasons
    const host = trimStr(parsed.hostname).toLowerCase()
    dbHostnameContainsAuthorizedRef = host.includes(AUTHORIZED_STAGING_PROJECT_REF)
    dbPoolerUsernameMatches = parsed.usernameRefMatches === true
  }

  const connectSecretsPresent = Boolean(anonKey) && Boolean(dbUrl)
  const identityOk = evaluated.ok && evaluated.apiHostMatches && !denied.hasProductionPrefix && !denied.hasDisposableRef

  log('CR1-E permanent-staging READ-ONLY probe (no secrets printed, no SQL)')
  log(`- env file exists: ${loaded.fileExists ? 'yes' : 'NO'}`)
  log(`- project name: ${evaluated.projectName || '(missing)'}`)
  log(`- API hostname: ${evaluated.apiHost || '(missing)'}`)
  log(`- API host matches authorized: ${evaluated.apiHostMatches ? 'yes' : 'NO'}`)
  log(`- DATABASE_URL / pooler hostname contains authorized ref: ${dbHostnameContainsAuthorizedRef ? 'yes' : 'no'}`)
  log(`- DATABASE_URL pooler username identity matches authorized ref: ${dbPoolerUsernameMatches ? 'yes' : 'no'}`)
  log(`- DATABASE_URL parse mode: ${dbMode || '(none)'}`)
  log(`- production prefix nsne in identity fields: ${denied.hasProductionPrefix ? 'YES (REJECT)' : 'no'}`)
  log(`- disposable ref in identity fields: ${denied.hasDisposableRef ? 'YES (REJECT)' : 'no'}`)
  log('- BABYDRAGON_STAGING_* presence:')
  for (const [name, state] of Object.entries(matrix)) {
    log(`  - ${name}: ${state}`)
  }
  log('- F10C2_PERMANENT_STAGING_* alias presence:')
  for (const [name, state] of Object.entries(aliases)) {
    log(`  - ${name}: ${state}`)
  }

  const report = {
    dated: '2026-08-29',
    mutations: 'none',
    sqlExecuted: false,
    identity: {
      expectedName: AUTHORIZED_STAGING_PROJECT_NAME,
      expectedRef: AUTHORIZED_STAGING_PROJECT_REF,
      expectedHost: AUTHORIZED_STAGING_API_HOST,
      providedName: evaluated.projectName,
      apiHost: evaluated.apiHost,
      apiHostMatches: evaluated.apiHostMatches,
      dbHostnameContainsAuthorizedRef,
      dbPoolerUsernameMatchesAuthorizedRef: dbPoolerUsernameMatches,
      dbMode,
      dbUriIdentityOk: dbUriOk,
      dbUriReasons: dbUriOk ? [] : dbUriReasons,
      productionPrefixPresentInIdentity: denied.hasProductionPrefix,
      disposableRefPresentInIdentity: denied.hasDisposableRef,
      evaluatedOk: evaluated.ok,
      evaluatedReasons: evaluated.reasons,
    },
    presence: matrix,
    aliasPresence: aliases,
    connectivity: {
      attempted: false,
      restRoot: null,
      authHealth: null,
    },
    emptyTarget: {
      attempted: false,
      tables: {},
      rpcs: {},
      openApiBabyDragonTables: [],
      openApiBabyDragonRpcs: [],
      buckets: null,
      authUserCount: null,
      authUsersProven: false,
      storageObjectsProven: false,
      findings: [],
    },
    verdictHint: null,
  }

  if (!loaded.fileExists) {
    report.verdictHint = 'env file missing'
    writeReports(report)
    process.exitCode = 3
    return
  }
  if (!identityOk) {
    report.verdictHint = 'identity rejected'
    writeReports(report)
    process.exitCode = 2
    return
  }
  if (!connectSecretsPresent) {
    report.verdictHint = 'env incomplete'
    log('- connectivity: NOT attempted (anon key and/or DATABASE_URL absent)')
    writeReports(report)
    process.exitCode = 3
    return
  }
  if (!dbUriOk && dbMode !== 'session pooler' && !dbHostnameContainsAuthorizedRef && !dbPoolerUsernameMatches) {
    report.verdictHint = 'DATABASE_URL identity does not match authorized staging ref'
    writeReports(report)
    process.exitCode = 2
    return
  }
  if (denied.hasProductionPrefix || denied.hasDisposableRef) {
    report.verdictHint = 'denied identity in env'
    writeReports(report)
    process.exitCode = 2
    return
  }

  const base = `https://${AUTHORIZED_STAGING_API_HOST}`
  const restHeadersAnon = {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    Accept: 'application/json',
  }
  const restHeadersService = serviceKey
    ? {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: 'application/json',
      }
    : null

  report.connectivity.attempted = true
  log('- contacting authorized host only (hostname printed above)')

  const restRoot = await requestJson({
    url: `${base}/rest/v1/`,
    headers: {
      ...restHeadersAnon,
      Accept: 'application/openapi+json, application/json',
    },
  })
  let openApiTables = []
  let openApiRpcs = []
  let restRootClass = 'unknown'
  if (restRoot.status === 200) {
    restRootClass = 'openapi_or_rest_alive'
    try {
      const spec = JSON.parse(restRoot.text)
      openApiTables = extractOpenApiTableNames(spec)
      openApiRpcs = extractOpenApiRpcNames(spec)
    } catch {
      restRootClass = 'http_200_non_json_alive'
    }
  } else if (restRoot.status === 401 || restRoot.status === 403) {
    const info = sanitizeErrorCode(restRoot.status, restRoot.text)
    restRootClass = info.messageClass === 'auth_error' ? 'alive_auth_error' : 'alive_http_auth'
  } else if (restRoot.status > 0) {
    restRootClass = `http_${restRoot.status}`
  }
  report.connectivity.restRoot = {
    status: restRoot.status,
    class: restRootClass,
    openApiTableCount: openApiTables.length,
    openApiRpcCount: openApiRpcs.length,
  }
  log(`- REST /rest/v1/ status: ${restRoot.status} (${restRootClass})`)

  let authHealth
  try {
    authHealth = await requestJson({
      url: `${base}/auth/v1/health`,
      headers: { apikey: anonKey },
    })
  } catch {
    authHealth = { status: 0, text: '' }
  }
  report.connectivity.authHealth = {
    status: authHealth.status,
    alive: authHealth.status > 0 && authHealth.status < 500,
  }
  log(`- Auth /auth/v1/health status: ${authHealth.status}`)

  const restAlive = restRoot.status === 200 || restRoot.status === 401 || restRoot.status === 403
  if (!restAlive) {
    report.verdictHint = 'REST connectivity failed'
    writeReports(report)
    process.exitCode = 4
    return
  }

  report.emptyTarget.attempted = true
  const tableHeaders = restHeadersService || restHeadersAnon
  const presentTables = []
  const absentTables = []
  const unknownTables = []

  for (const table of BABYDRAGON_TABLES) {
    const res = await requestJson({
      url: `${base}/rest/v1/${encodeURIComponent(table)}?select=*&limit=1`,
      headers: {
        ...tableHeaders,
        Prefer: 'count=exact',
        Range: '0-0',
      },
    })
    const classified = classifyTableProbe(res.status, res.text)
    report.emptyTarget.tables[table] = {
      status: classified.status,
      code: classified.code,
      classification: classified.classification,
      messageClass: classified.messageClass,
    }
    if (classified.classification === 'absent' || classified.classification === 'absent_per_operator_pgrst116') {
      absentTables.push(table)
    } else if (classified.classification === 'present' || classified.classification === 'present_permission_denied') {
      presentTables.push(table)
    } else {
      unknownTables.push(table)
    }
    log(`- table ${table}: ${classified.classification} (http ${classified.status}${classified.code ? ` ${classified.code}` : ''})`)
  }

  const presentRpcs = []
  const absentRpcs = []
  for (const rpc of BABYDRAGON_RPCS) {
    const res = await requestJson({
      url: `${base}/rest/v1/rpc/${encodeURIComponent(rpc)}`,
      method: 'POST',
      headers: {
        ...tableHeaders,
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
    const classified = classifyRpcProbe(res.status, res.text)
    report.emptyTarget.rpcs[rpc] = {
      status: classified.status,
      code: classified.code,
      classification: classified.classification,
      messageClass: classified.messageClass,
    }
    if (classified.classification === 'absent') absentRpcs.push(rpc)
    else if (classified.classification === 'auth_failed') unknownTables.push(`rpc:${rpc}`)
    else presentRpcs.push(rpc)
    log(`- rpc ${rpc}: ${classified.classification} (http ${classified.status}${classified.code ? ` ${classified.code}` : ''})`)
  }

  const babyDragonFromOpenApi = openApiTables.filter((name) => BABYDRAGON_TABLES.includes(name))
  const babyDragonRpcsFromOpenApi = openApiRpcs.filter((name) => BABYDRAGON_RPCS.includes(name))
  report.emptyTarget.openApiBabyDragonTables = babyDragonFromOpenApi
  report.emptyTarget.openApiBabyDragonRpcs = babyDragonRpcsFromOpenApi
  log(`- OpenAPI BabyDragon table names listed: ${babyDragonFromOpenApi.length ? babyDragonFromOpenApi.join(', ') : '(none)'}`)
  log(`- OpenAPI BabyDragon rpc names listed: ${babyDragonRpcsFromOpenApi.length ? babyDragonRpcsFromOpenApi.join(', ') : '(none)'}`)

  if (restHeadersService) {
    const bucketRes = await requestJson({
      url: `${base}/storage/v1/bucket`,
      headers: restHeadersService,
    })
    let bucketIds = []
    let bucketParse = 'ok'
    try {
      const parsed = JSON.parse(bucketRes.text)
      if (Array.isArray(parsed)) {
        bucketIds = parsed.map((b) => trimStr(b?.id || b?.name)).filter(Boolean)
      } else {
        bucketParse = 'non_array'
      }
    } catch {
      bucketParse = 'non_json'
    }
    const babyDragonBucketsFound = bucketIds.filter((id) => BABYDRAGON_BUCKETS.includes(id))
    report.emptyTarget.buckets = {
      status: bucketRes.status,
      parse: bucketParse,
      count: bucketIds.length,
      ids: bucketIds,
      babyDragonBucketsFound,
    }
    log(`- Storage buckets: http ${bucketRes.status}; count ${bucketIds.length}; names: ${bucketIds.length ? bucketIds.join(', ') : '(none)'}`)
    log(`- BabyDragon buckets found: ${babyDragonBucketsFound.length ? babyDragonBucketsFound.join(', ') : '(none)'}`)

    const usersRes = await requestJson({
      url: `${base}/auth/v1/admin/users?page=1&per_page=1`,
      headers: restHeadersService,
    })
    let userCount = null
    const totalHeader = usersRes.headers.get('x-total-count')
    if (totalHeader && /^\d+$/.test(totalHeader)) {
      userCount = Number(totalHeader)
    } else {
      try {
        const parsed = JSON.parse(usersRes.text)
        if (typeof parsed?.total === 'number') userCount = parsed.total
        else if (Array.isArray(parsed?.users)) userCount = parsed.users.length
      } catch {
        userCount = null
      }
    }
    report.emptyTarget.authUserCount = userCount
    report.emptyTarget.authUsersProven = userCount !== null
    log(`- Auth admin user count (identities not printed): ${userCount === null ? 'not proven' : userCount}`)
  } else {
    report.emptyTarget.buckets = { status: null, parse: 'skipped_no_service_role', count: null, ids: [], babyDragonBucketsFound: [] }
    report.emptyTarget.authUsersProven = false
    log('- Storage / Auth admin: not proven without SQL (service role absent)')
  }
  report.emptyTarget.storageObjectsProven = false

  if (presentTables.length) {
    report.emptyTarget.findings.push(`BabyDragon REST tables present: ${presentTables.join(', ')}`)
  }
  if (presentRpcs.length) {
    report.emptyTarget.findings.push(`BabyDragon REST rpcs present: ${presentRpcs.join(', ')}`)
  }
  if (babyDragonFromOpenApi.length) {
    report.emptyTarget.findings.push(`OpenAPI lists BabyDragon tables: ${babyDragonFromOpenApi.join(', ')}`)
  }
  if (report.emptyTarget.buckets?.babyDragonBucketsFound?.length) {
    report.emptyTarget.findings.push(
      `BabyDragon storage buckets present: ${report.emptyTarget.buckets.babyDragonBucketsFound.join(', ')}`,
    )
  }
  if (unknownTables.length) {
    report.emptyTarget.findings.push(`unclassified REST probes: ${unknownTables.join(', ')}`)
  }

  const appObjectsAbsent =
    presentTables.length === 0
    && presentRpcs.length === 0
    && babyDragonFromOpenApi.length === 0
    && !(report.emptyTarget.buckets?.babyDragonBucketsFound?.length)
    && unknownTables.length === 0

  if (!restAlive) {
    report.verdictHint = 'REST connectivity failed'
  } else if (!appObjectsAbsent) {
    report.verdictHint = report.emptyTarget.findings[0] || 'BabyDragon app objects present'
  } else {
    report.verdictHint = 'empty_target_verified'
  }

  writeReports(report)
  log(`- findings: ${report.emptyTarget.findings.length ? report.emptyTarget.findings.join(' | ') : '(none)'}`)
  log(`- verdictHint: ${report.verdictHint}`)
  process.exitCode = report.verdictHint === 'empty_target_verified' ? 0 : 5
}

function writeReports(report) {
  fs.mkdirSync(AUDIT_DIR, { recursive: true })
  const probeFile = path.join(AUDIT_DIR, 'cr1e-permanent-staging-empty-target-probe.json')
  fs.writeFileSync(probeFile, `${JSON.stringify(report, null, 2)}\n`)
  const guardFile = path.join(AUDIT_DIR, 'cr1e-permanent-staging-preflight-guard.json')
  const guard = {
    fileExists: true,
    envPath: '.env.permanent-staging',
    identity: {
      expectedName: AUTHORIZED_STAGING_PROJECT_NAME,
      expectedRef: AUTHORIZED_STAGING_PROJECT_REF,
      expectedHost: AUTHORIZED_STAGING_API_HOST,
      deniedProductionPrefix: DENIED_PRODUCTION_REF_PREFIX,
      deniedDisposableRef: DENIED_DISPOSABLE_PROJECT_REF,
    },
    presence: report.presence,
    aliasPresence: report.aliasPresence,
    completeness: {
      identityRegistered: report.identity.evaluatedOk,
      envCompleteEnoughToConnect: report.connectivity.attempted,
    },
    evaluated: {
      ok: report.identity.evaluatedOk,
      reasons: report.identity.evaluatedReasons,
      projectName: report.identity.providedName,
      apiHostMatches: report.identity.apiHostMatches,
      apiHost: report.identity.apiHost,
      dbMode: report.identity.dbMode,
      dbHostnameContainsAuthorizedRef: report.identity.dbHostnameContainsAuthorizedRef,
      dbPoolerUsernameMatchesAuthorizedRef: report.identity.dbPoolerUsernameMatchesAuthorizedRef,
      productionDenied: !report.identity.productionPrefixPresentInIdentity,
      disposableDenied: !report.identity.disposableRefPresentInIdentity,
    },
    connectivity: report.connectivity,
    emptyTargetSummary: {
      attempted: report.emptyTarget.attempted,
      findings: report.emptyTarget.findings,
      verdictHint: report.verdictHint,
    },
  }
  fs.writeFileSync(guardFile, `${JSON.stringify(guard, null, 2)}\n`)
  log('- sanitized evidence written under Audit Data/F10C2/CR1-E/')
}

main().catch((err) => {
  console.log(`PROBE FAILED SAFELY: ${err?.name || 'Error'} (message redacted)`)
  process.exitCode = 1
})
