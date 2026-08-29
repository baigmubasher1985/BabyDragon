/**
 * CR1-E permanent-staging identity guard + read-only preflight.
 * Never prints secrets. Never applies SQL. Never contacts production or disposable.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnvFile } from './loadDisposableEnv.mjs'
import { parseDisposableDbUri } from '../../src/lib/phase4bTargetGuard.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const ENV_FILE = path.join(ROOT, '.env.permanent-staging')

export const AUTHORIZED_STAGING_PROJECT_NAME = 'babydragon-permanent-staging'
export const AUTHORIZED_STAGING_PROJECT_REF = 'qxtnoxkyyancndgswjnu'
export const AUTHORIZED_STAGING_API_HOST = `${AUTHORIZED_STAGING_PROJECT_REF}.supabase.co`
export const AUTHORIZED_STAGING_POOLER_USER = `postgres.${AUTHORIZED_STAGING_PROJECT_REF}`
export const DENIED_PRODUCTION_REF_PREFIX = 'nsne'
export const DENIED_DISPOSABLE_PROJECT_REF = 'cxyqqgmepiphyejvceum'
export const REQUIRED_GIT_BRANCH = 'step-1j2-f10c1i-security-baseline'
export const REQUIRED_GIT_HEAD = '00fbce27fd38526888129a4bd2dbca6937088836'
export const REQUIRED_CONNECTION_METHOD = 'session-pooler'

const REQUIRED_NAMES = [
  'BABYDRAGON_STAGING_PROJECT_NAME',
  'BABYDRAGON_STAGING_PROJECT_REF',
  'BABYDRAGON_STAGING_SUPABASE_URL',
  'BABYDRAGON_STAGING_ANON_KEY',
  'BABYDRAGON_STAGING_SERVICE_ROLE_KEY',
  'BABYDRAGON_STAGING_DATABASE_URL',
  'BABYDRAGON_STAGING_DB_PASSWORD',
  'BABYDRAGON_STAGING_ADMIN_EMAIL',
  'BABYDRAGON_STAGING_ADMIN_PASSWORD',
  'BABYDRAGON_STAGING_FE_EMAIL',
  'BABYDRAGON_STAGING_FE_PASSWORD',
]

const CONNECT_SECRET_NAMES = [
  'BABYDRAGON_STAGING_ANON_KEY',
  'BABYDRAGON_STAGING_SERVICE_ROLE_KEY',
  'BABYDRAGON_STAGING_DATABASE_URL',
  'BABYDRAGON_STAGING_DB_PASSWORD',
]

const PLACEHOLDER_RE = /^(your_|changeme|todo|xxx|placeholder|example|replace|<.*>|\[.*\])$/i

function trimStr(value) {
  return String(value || '').trim()
}

function hostnameFromUrl(raw) {
  const value = trimStr(raw)
  if (!value) return ''
  try {
    const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`
    return new URL(normalized).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function isNonEmpty(value) {
  const raw = trimStr(value)
  if (!raw) return false
  if (PLACEHOLDER_RE.test(raw)) return false
  return true
}

export function loadPermanentStagingEnv(cwd = ROOT) {
  const filePath = path.join(cwd, '.env.permanent-staging')
  return {
    filePath,
    fileExists: fs.existsSync(filePath),
    env: parseEnvFile(filePath),
  }
}

/** File values win over process.env so local policy flags are not overridden by a parent shell. */
export function loadPermanentStagingEnvMerged(cwd = ROOT) {
  const loaded = loadPermanentStagingEnv(cwd)
  return {
    ...loaded,
    env: { ...process.env, ...loaded.env },
  }
}

export function firstNonEmpty(env, names) {
  for (const name of names) {
    if (isNonEmpty(env[name])) return env[name]
  }
  return ''
}

export function normalizeYesNo(value) {
  return trimStr(value).toLowerCase()
}

export function normalizeConnectionMethod(value) {
  return trimStr(value).toLowerCase().replace(/[_\s]+/g, '-')
}

export function sqlExecutionApprovedIsYes(value) {
  return normalizeYesNo(value) === 'yes'
}

export function readGitCheckpoint(cwd = ROOT) {
  const branch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8' })
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' })
  return {
    branch: trimStr(branch.stdout),
    head: trimStr(head.stdout),
    ok: branch.status === 0 && head.status === 0,
  }
}

export function presenceMatrix(env) {
  const matrix = {}
  for (const name of REQUIRED_NAMES) {
    matrix[name] = isNonEmpty(env[name]) ? 'present' : 'absent'
  }
  return matrix
}

export function evaluatePermanentStagingTarget(input = {}) {
  const reasons = []
  const projectName = trimStr(input.projectName)
  const projectRef = trimStr(input.projectRef).toLowerCase()
  const apiUrl = trimStr(input.apiUrl)
  const apiHost = hostnameFromUrl(apiUrl)
  const dbUrl = trimStr(input.dbUrl)
  const haystack = [projectName, projectRef, apiUrl, apiHost, dbUrl]
    .join('\n')
    .toLowerCase()

  if (projectName !== AUTHORIZED_STAGING_PROJECT_NAME) {
    reasons.push('project name is not babydragon-permanent-staging')
  }
  if (projectRef !== AUTHORIZED_STAGING_PROJECT_REF) {
    reasons.push('project ref is not the authorized staging ref')
  }
  if (!apiHost) {
    reasons.push('staging URL hostname could not be parsed')
  } else if (apiHost !== AUTHORIZED_STAGING_API_HOST) {
    reasons.push('URL host is not the authorized staging API host')
  }
  if (haystack.includes(DENIED_PRODUCTION_REF_PREFIX)) {
    reasons.push('production prefix nsne is denied')
  }
  if (haystack.includes(DENIED_DISPOSABLE_PROJECT_REF)) {
    reasons.push('disposable ref is denied for this target')
  }

  let dbUri = null
  if (dbUrl) {
    if (PLACEHOLDER_RE.test(dbUrl) || dbUrl.includes('<') || dbUrl.includes('YOUR_')) {
      reasons.push('DATABASE_URL is an unresolved placeholder')
    }
    dbUri = parseDisposableDbUri(dbUrl, AUTHORIZED_STAGING_PROJECT_REF)
    reasons.push(...dbUri.reasons)
    const userRef = trimStr(dbUri.userRef).toLowerCase()
    const dbHost = trimStr(dbUri.hostname).toLowerCase()
    if (userRef === DENIED_DISPOSABLE_PROJECT_REF || dbHost.includes(DENIED_DISPOSABLE_PROJECT_REF)) {
      reasons.push('database identity matches denied disposable ref')
    }
    if (userRef.startsWith(DENIED_PRODUCTION_REF_PREFIX) || dbHost.startsWith(DENIED_PRODUCTION_REF_PREFIX)) {
      reasons.push('database identity matches denied production prefix')
    }
    if (userRef && userRef !== AUTHORIZED_STAGING_PROJECT_REF && dbUri.mode === 'session pooler') {
      reasons.push('pooler username project identity is not the authorized staging ref')
    }
    if (dbUri.mode === 'session pooler' && dbUri.usernameRefMatches !== true) {
      reasons.push('session pooler identity is not postgres.<authorized-staging-ref>')
    }
    if (dbHost.includes('.supabase.co') && dbUri.mode === 'direct' && !dbHost.includes(AUTHORIZED_STAGING_PROJECT_REF)) {
      reasons.push('direct database host is not the authorized staging ref')
    }
  }

  return {
    ok: reasons.length === 0 && Boolean(apiHost),
    reasons,
    projectName: projectName || null,
    projectRefPresent: Boolean(projectRef),
    apiHostMatches: apiHost === AUTHORIZED_STAGING_API_HOST,
    apiHost: apiHost || null,
    dbMode: dbUri?.mode || null,
    dbHostSanitized: dbUri?.hostnameSanitized || '(none)',
    poolerUserMatches: dbUri?.usernameRefMatches === true,
    productionDenied: !haystack.includes(DENIED_PRODUCTION_REF_PREFIX),
    disposableDenied: !haystack.includes(DENIED_DISPOSABLE_PROJECT_REF),
  }
}

/**
 * Fail-closed apply/dry-run gates. Never prints secrets.
 * Gate 11 (empty DB) is documented for the next apply pass — dry-run skips live SQL.
 */
export function evaluatePermanentStagingApplyGates(input = {}) {
  const reasons = []
  const env = input.env || {}
  const projectName = firstNonEmpty(env, ['BABYDRAGON_STAGING_PROJECT_NAME', 'F10C2_PERMANENT_STAGING_PROJECT_NAME'])
  const projectRef = firstNonEmpty(env, ['BABYDRAGON_STAGING_PROJECT_REF', 'F10C2_PERMANENT_STAGING_PROJECT_REF'])
  const apiUrl = firstNonEmpty(env, ['BABYDRAGON_STAGING_SUPABASE_URL', 'F10C2_PERMANENT_STAGING_SUPABASE_URL'])
  const dbUrl = firstNonEmpty(env, ['BABYDRAGON_STAGING_DATABASE_URL', 'F10C2_PERMANENT_STAGING_DB_URL'])
  const confirmed = normalizeYesNo(firstNonEmpty(env, ['F10C2_PERMANENT_STAGING_CONFIRMED']))
  const notProduction = normalizeYesNo(firstNonEmpty(env, ['F10C2_PERMANENT_STAGING_NOT_PRODUCTION']))
  const connectionMethod = normalizeConnectionMethod(firstNonEmpty(env, ['F10C2_PERMANENT_STAGING_CONNECTION_METHOD']))
  const sqlApprovedRaw = firstNonEmpty(env, ['F10C2_PERMANENT_STAGING_SQL_EXECUTION_APPROVED'])
  const sqlApproved = sqlExecutionApprovedIsYes(sqlApprovedRaw)

  const identity = evaluatePermanentStagingTarget({
    projectName,
    projectRef,
    apiUrl,
    dbUrl,
  })
  reasons.push(...identity.reasons)

  const pooler = dbUrl ? parseDisposableDbUri(dbUrl, AUTHORIZED_STAGING_PROJECT_REF) : null
  const poolerUserMatches = pooler?.usernameRefMatches === true
  const sessionPooler = pooler?.mode === 'session pooler'
  if (!dbUrl) {
    reasons.push('session pooler identity cannot be proven — DATABASE_URL name is absent')
  } else if (!sessionPooler) {
    reasons.push('connection URI is not session-pooler')
  } else if (!poolerUserMatches) {
    reasons.push('session pooler identity is not postgres.qxtnoxkyyancndgswjnu')
  }

  if (confirmed !== 'yes') {
    reasons.push('F10C2_PERMANENT_STAGING_CONFIRMED must be yes')
  }
  if (notProduction !== 'yes') {
    reasons.push('F10C2_PERMANENT_STAGING_NOT_PRODUCTION must be yes')
  }
  if (connectionMethod !== REQUIRED_CONNECTION_METHOD) {
    reasons.push('F10C2_PERMANENT_STAGING_CONNECTION_METHOD must be session-pooler')
  }

  const dryRunRequiresSqlDenied = input.requireSqlApprovalNo !== false
  if (dryRunRequiresSqlDenied && sqlApproved) {
    reasons.push('F10C2_PERMANENT_STAGING_SQL_EXECUTION_APPROVED must remain no during this dry-run pass')
  }

  const git = input.git && input.git.ok
    ? input.git
    : readGitCheckpoint(input.cwd || ROOT)
  const gitOk = git.branch === REQUIRED_GIT_BRANCH && git.head === REQUIRED_GIT_HEAD
  if (!gitOk) {
    reasons.push('working branch or HEAD does not match required checkpoint')
  }

  const uniqueReasons = [...new Set(reasons)]
  return {
    ok: uniqueReasons.length === 0,
    reasons: uniqueReasons,
    identity,
    flags: {
      confirmed,
      notProduction,
      connectionMethod: connectionMethod || '(missing)',
      sqlExecutionApproved: sqlApproved ? 'yes' : (sqlApprovedRaw ? 'no' : 'unset'),
    },
    pooler: {
      mode: pooler?.mode || null,
      userMatches: poolerUserMatches,
      expectedUser: AUTHORIZED_STAGING_POOLER_USER,
    },
    git: {
      branch: git.branch || null,
      head: git.head || null,
      requiredBranch: REQUIRED_GIT_BRANCH,
      requiredHead: REQUIRED_GIT_HEAD,
      ok: gitOk,
    },
    emptyDbCheck: {
      performed: false,
      deferred: !sqlApproved,
      note: 'Empty-DB proof is a documented gate for the NEXT apply pass. This dry-run is filesystem + env-guard only and does not send SQL.',
    },
  }
}

function classifyEnvComplete(matrix) {
  const missingSecrets = CONNECT_SECRET_NAMES.filter((name) => matrix[name] === 'absent')
  const identityOk = [
    'BABYDRAGON_STAGING_PROJECT_NAME',
    'BABYDRAGON_STAGING_PROJECT_REF',
    'BABYDRAGON_STAGING_SUPABASE_URL',
  ].every((name) => matrix[name] === 'present')
  return {
    identityRegistered: identityOk,
    envCompleteEnoughToConnect: missingSecrets.length === 0,
    missingSecrets,
  }
}

function main() {
  const loaded = loadPermanentStagingEnv(ROOT)
  const env = loaded.env
  const matrix = presenceMatrix(env)
  const completeness = classifyEnvComplete(matrix)
  const evaluated = evaluatePermanentStagingTarget({
    projectName: firstNonEmpty(env, ['BABYDRAGON_STAGING_PROJECT_NAME', 'F10C2_PERMANENT_STAGING_PROJECT_NAME']),
    projectRef: firstNonEmpty(env, ['BABYDRAGON_STAGING_PROJECT_REF', 'F10C2_PERMANENT_STAGING_PROJECT_REF']),
    apiUrl: firstNonEmpty(env, ['BABYDRAGON_STAGING_SUPABASE_URL', 'F10C2_PERMANENT_STAGING_SUPABASE_URL']),
    dbUrl: firstNonEmpty(env, ['BABYDRAGON_STAGING_DATABASE_URL', 'F10C2_PERMANENT_STAGING_DB_URL']),
  })

  const report = {
    fileExists: loaded.fileExists,
    envPath: '.env.permanent-staging',
    identity: {
      expectedName: AUTHORIZED_STAGING_PROJECT_NAME,
      expectedRef: AUTHORIZED_STAGING_PROJECT_REF,
      expectedHost: AUTHORIZED_STAGING_API_HOST,
      deniedProductionPrefix: DENIED_PRODUCTION_REF_PREFIX,
      deniedDisposableRef: DENIED_DISPOSABLE_PROJECT_REF,
    },
    presence: matrix,
    completeness,
    evaluated: {
      ok: evaluated.ok,
      reasons: evaluated.reasons,
      projectName: evaluated.projectName,
      apiHostMatches: evaluated.apiHostMatches,
      apiHost: evaluated.apiHost,
      dbMode: evaluated.dbMode,
      dbHostSanitized: evaluated.dbHostSanitized,
      productionDenied: evaluated.productionDenied,
      disposableDenied: evaluated.disposableDenied,
    },
    connectivity: {
      attempted: false,
      result: completeness.envCompleteEnoughToConnect
        ? 'ready-for-read-only-probe'
        : 'blocked — env incomplete — operator must fill .env.permanent-staging locally',
    },
    aliasMapping: {
      preferred: 'BABYDRAGON_STAGING_*',
      compatible: 'F10C2_PERMANENT_STAGING_* (URL/ANON/SERVICE_ROLE/DB_URL/emails)',
      note: 'Existing apply scripts still read disposable F10C2_DISPOSABLE_* via phase4bTargetGuard. Do not point those at this staging project.',
    },
  }

  console.log('CR1-E permanent-staging target guard (no secrets printed)')
  console.log(`- env file exists: ${report.fileExists ? 'yes' : 'NO'}`)
  console.log(`- expected project name: ${AUTHORIZED_STAGING_PROJECT_NAME}`)
  console.log(`- provided project name: ${evaluated.projectName || '(missing)'}`)
  console.log(`- expected API host: ${AUTHORIZED_STAGING_API_HOST}`)
  console.log(`- API host matches: ${evaluated.apiHostMatches ? 'yes' : 'NO'}`)
  console.log(`- production prefix denied: ${evaluated.productionDenied ? 'yes' : 'NO'}`)
  console.log(`- disposable ref denied: ${evaluated.disposableDenied ? 'yes' : 'NO'}`)
  console.log('- presence matrix:')
  for (const [name, state] of Object.entries(matrix)) {
    console.log(`  - ${name}: ${state}`)
  }
  console.log(`- identity registered: ${completeness.identityRegistered ? 'yes' : 'NO'}`)
  console.log(`- env complete enough to connect: ${completeness.envCompleteEnoughToConnect ? 'yes' : 'NO'}`)
  if (!completeness.envCompleteEnoughToConnect) {
    console.log(`- missing secret names: ${completeness.missingSecrets.join(', ')}`)
    console.log('- connectivity: NOT attempted')
  }
  if (!evaluated.ok) {
    console.log('RESULT: identity rejected')
    for (const reason of evaluated.reasons) console.log(`  - ${reason}`)
    process.exitCode = 2
  } else if (!completeness.envCompleteEnoughToConnect) {
    console.log('RESULT: identity registered — env incomplete — operator must fill .env.permanent-staging locally')
    process.exitCode = 3
  } else {
    console.log('RESULT: identity accepted — secrets present — connectivity probe not started by this command')
  }

  const outDir = path.join(ROOT, '..', 'Audit Data', 'F10C2', 'CR1-E')
  fs.mkdirSync(outDir, { recursive: true })
  const outFile = path.join(outDir, 'cr1e-permanent-staging-preflight-guard.json')
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`- sanitized guard report written (path withheld from stdout if it contains secrets: no)`)
  console.log(`- report: Audit Data/F10C2/CR1-E/cr1e-permanent-staging-preflight-guard.json`)
}

if (process.argv[1] && path.normalize(process.argv[1]) === path.normalize(fileURLToPath(import.meta.url))) {
  main()
}
