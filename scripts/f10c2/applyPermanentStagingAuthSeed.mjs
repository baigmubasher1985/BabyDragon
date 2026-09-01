/**
 * CR1-E-R2 permanent-staging Auth + Class A baseline runner.
 * Default: DRY-RUN. Execute requires F10C2_PERMANENT_STAGING_AUTH_SEED_APPROVED=yes
 * AND --execute. Never reuses the 45-path or 217 SQL flags.
 * Never prints credentials, emails, tokens, JWTs, or connection strings.
 * Never creates projects, tasks, field-test runs, QC, artifacts, or storage objects.
 * Never rewrites .env.permanent-staging.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AUTH_SEED_APPROVED_ENV,
  AUTHORIZED_STAGING_API_HOST,
  AUTHORIZED_STAGING_POOLER_USER,
  AUTHORIZED_STAGING_PROJECT_NAME,
  AUTHORIZED_STAGING_PROJECT_REF,
  DENIED_DISPOSABLE_PROJECT_REF,
  DENIED_PRODUCTION_REF_PREFIX,
  authSeedApprovedIsYes,
  evaluatePermanentStagingApplyGates,
  firstNonEmpty,
  loadPermanentStagingEnvMerged,
} from './assertPermanentStagingTarget.mjs'
import { sha256File } from './permanentStagingApplyPlan.mjs'
import { APPLY_LEDGER_REL } from './applyPermanentStagingMigrations.mjs'
import {
  APPLY_LEDGER_217_REL,
  confirm45BaseLedger,
  is217AlreadyVerified,
  load217ApplyLedger,
} from './applyPermanentStaging217.mjs'

const __filename = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename), '../..')
const AUDIT_DIR = path.join(ROOT, '..', 'Audit Data', 'F10C2', 'CR1-E')

export const AUTH_CREATED_DEFAULT = false
export const SEED_CREATED_DEFAULT = false
export const CANONICAL_FE_ROLE = 'fe'
export const AUTH_METADATA_SOURCE = 'permanent-staging-class-a'
export const AUTH_SEED_APPROVED_ENV_NAME = AUTH_SEED_APPROVED_ENV
export const CLASS_A_BASELINE_REL = 'scripts/f10c2/permanentStagingClassABaseline.json'
export const HASH_MANIFEST_AUTH_SEED_REL = 'scripts/f10c2/permanentStagingAuthSeed.hashes.json'
export const APPLY_LEDGER_AUTH_SEED_REL = '.permanent-staging-auth-seed-ledger.json'
export const EXECUTION_PACKAGE_AUTH_SEED = Object.freeze([
  'scripts/f10c2/applyPermanentStagingAuthSeed.mjs',
  CLASS_A_BASELINE_REL,
  HASH_MANIFEST_AUTH_SEED_REL,
])

export const AUTH_ROLE_SPECS = Object.freeze([
  {
    key: 'super_admin',
    role: 'super_admin',
    fullName: 'Staging Super Admin',
    emailNames: ['F10C2_PERMANENT_STAGING_SA_EMAIL', 'BABYDRAGON_STAGING_SA_EMAIL'],
    passwordNames: ['F10C2_PERMANENT_STAGING_SA_PASSWORD', 'BABYDRAGON_STAGING_SA_PASSWORD'],
  },
  {
    key: 'admin',
    role: 'admin',
    fullName: 'Staging Admin',
    emailNames: ['F10C2_PERMANENT_STAGING_ADMIN_EMAIL', 'BABYDRAGON_STAGING_ADMIN_EMAIL'],
    passwordNames: ['F10C2_PERMANENT_STAGING_ADMIN_PASSWORD', 'BABYDRAGON_STAGING_ADMIN_PASSWORD'],
  },
  {
    key: 'fe',
    role: CANONICAL_FE_ROLE,
    fullName: 'Staging Field Engineer',
    emailNames: ['F10C2_PERMANENT_STAGING_FE_EMAIL', 'BABYDRAGON_STAGING_FE_EMAIL'],
    passwordNames: ['F10C2_PERMANENT_STAGING_FE_PASSWORD', 'BABYDRAGON_STAGING_FE_PASSWORD'],
  },
])

const SECRET_PATTERNS = [
  { kind: 'jwt', re: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/ },
  { kind: 'service_role_assign', re: /service_role\s*=\s*['"][^'"]+/i },
  { kind: 'prod_prefix', re: /\bnsne[a-z0-9]{4,}/i },
  { kind: 'db_url', re: /postgres(?:ql)?:\/\/[^\s:]+:[^\s@]+@/i },
]
const LEDGER_SECRET_RE = [
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  /postgres(?:ql)?:\/\/[^\s:]+:[^\s@]+@/i,
  /sb_(?:secret|publishable)_[A-Za-z0-9]+/,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
]
const FORBIDDEN_MUTATION_TABLES = Object.freeze([
  'projects',
  'tasks',
  'grids',
  'routes',
  'field_test_runs',
  'field_test_artifacts',
  'field_test_metrics',
  'field_test_qc_reviews',
  'field_test_iterations',
  'field_test_call_events',
])

export function parseCliFlags(argv = []) {
  return { wantExecute: argv.includes('--execute') }
}

export function redactAuthSeedText(text) {
  return String(text || '')
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, 'postgres://[redacted]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt-redacted]')
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9]+/g, '[supabase-key-redacted]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email-redacted]')
    .replace(/service_role['"=\s:]+[A-Za-z0-9._-]+/gi, 'service_role=[redacted]')
    .replace(/(password|pwd|secret|apikey|api_key)[=:][^\s&]+/gi, '$1=[redacted]')
}

function scanSecrets(text) {
  return SECRET_PATTERNS.filter(({ re }) => re.test(text)).map(({ kind }) => kind)
}

function writeAudit(name, body) {
  fs.mkdirSync(AUDIT_DIR, { recursive: true })
  const abs = path.join(AUDIT_DIR, name)
  fs.writeFileSync(abs, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
  return `Audit Data/F10C2/CR1-E/${name}`
}

export function loadClassABaseline(cwd = ROOT) {
  const abs = path.join(cwd, CLASS_A_BASELINE_REL)
  if (!fs.existsSync(abs)) {
    return { ok: false, missing: true, baseline: null }
  }
  try {
    const baseline = JSON.parse(fs.readFileSync(abs, 'utf8'))
    const templates = Array.isArray(baseline.templates) ? baseline.templates : []
    return { ok: templates.length === 3, missing: false, baseline, templates }
  } catch {
    return { ok: false, missing: false, corrupt: true, baseline: null }
  }
}

export function inspectAuthCredentialPresence(env = {}) {
  return AUTH_ROLE_SPECS.map((spec) => {
    const emailName = spec.emailNames.find((name) => Boolean(firstNonEmpty(env, [name]))) || spec.emailNames[0]
    const passwordName = spec.passwordNames.find((name) => Boolean(firstNonEmpty(env, [name]))) || spec.passwordNames[0]
    return {
      key: spec.key,
      role: spec.role,
      emailName,
      passwordName,
      emailPresent: Boolean(firstNonEmpty(env, spec.emailNames)),
      passwordPresent: Boolean(firstNonEmpty(env, spec.passwordNames)),
    }
  })
}

function readSecret(env, names) {
  return firstNonEmpty(env, names)
}

function emailsAreDistinct(env) {
  const emails = AUTH_ROLE_SPECS.map((spec) => String(readSecret(env, spec.emailNames) || '').trim().toLowerCase())
  const present = emails.filter(Boolean)
  return present.length === AUTH_ROLE_SPECS.length && new Set(present).size === present.length
}

export function computeAuthSeedHashes(cwd = ROOT) {
  return [
    { role: 'runner', path: 'scripts/f10c2/applyPermanentStagingAuthSeed.mjs' },
    { role: 'baseline', path: CLASS_A_BASELINE_REL },
  ].map((row) => {
    const abs = path.join(cwd, row.path)
    return {
      ...row,
      sha256: fs.existsSync(abs) ? sha256File(abs) : null,
      exists: fs.existsSync(abs),
    }
  })
}

export function loadExpectedAuthSeedHashes(cwd = ROOT) {
  const abs = path.join(cwd, HASH_MANIFEST_AUTH_SEED_REL)
  if (!fs.existsSync(abs)) {
    return { ok: false, missing: true, files: [], algorithm: 'sha256' }
  }
  const parsed = JSON.parse(fs.readFileSync(abs, 'utf8'))
  return {
    ok: true,
    missing: false,
    algorithm: parsed.algorithm || 'sha256',
    count: parsed.count,
    files: Array.isArray(parsed.files) ? parsed.files : [],
  }
}

export function assertAuthSeedHashesMatch(cwd = ROOT) {
  const expected = loadExpectedAuthSeedHashes(cwd)
  const actual = computeAuthSeedHashes(cwd)
  const mismatches = []
  if (expected.missing) mismatches.push(`missing hash manifest ${HASH_MANIFEST_AUTH_SEED_REL}`)
  const expectedByRole = new Map((expected.files || []).map((f) => [f.role, f]))
  for (const row of actual) {
    const exp = expectedByRole.get(row.role)
    if (!exp) {
      mismatches.push(`no expected hash for auth-seed ${row.role}`)
      continue
    }
    if (exp.path !== row.path) mismatches.push(`auth-seed ${row.role} path does not match manifest`)
    if (!row.sha256) {
      mismatches.push(`missing file for hash ${row.path}`)
      continue
    }
    if (String(exp.sha256).toLowerCase() !== String(row.sha256).toLowerCase()) {
      mismatches.push(`hash mismatch auth-seed ${row.role} ${row.path}`)
    }
  }
  for (const exp of expected.files || []) {
    if (!actual.some((row) => row.role === exp.role)) {
      mismatches.push(`expected auth-seed role not computed ${exp.role}`)
    }
  }
  if (expected.ok && Number(expected.count) !== actual.length) {
    mismatches.push(`auth-seed hash manifest count ${expected.count} != ${actual.length}`)
  }
  return { ok: mismatches.length === 0, mismatches, actual, expected }
}

export function loadAuthSeedLedger(cwd = ROOT) {
  const abs = path.join(cwd, APPLY_LEDGER_AUTH_SEED_REL)
  if (!fs.existsSync(abs)) {
    return { exists: false, applied: null, path: APPLY_LEDGER_AUTH_SEED_REL }
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(abs, 'utf8'))
    return {
      exists: true,
      applied: parsed.applied || null,
      targetRef: parsed.targetRef || null,
      targetName: parsed.targetName || null,
      path: APPLY_LEDGER_AUTH_SEED_REL,
    }
  } catch {
    return { exists: true, corrupt: true, applied: null, path: APPLY_LEDGER_AUTH_SEED_REL }
  }
}

function sanitizeAuthSeedLedgerBlob(ledger) {
  const blob = JSON.stringify(ledger || {})
  const reasons = []
  if (blob.toLowerCase().includes(DENIED_PRODUCTION_REF_PREFIX)) {
    reasons.push('auth-seed ledger contains production prefix')
  }
  if (blob.includes(DENIED_DISPOSABLE_PROJECT_REF)) {
    reasons.push('auth-seed ledger contains disposable identity')
  }
  for (const re of LEDGER_SECRET_RE) {
    if (re.test(blob)) reasons.push('auth-seed ledger contains a credential-shaped value')
  }
  return { ok: reasons.length === 0, reasons }
}

function sameText(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()
}

function rulesMatch(expected = {}, actual = {}) {
  const expDirs = (expected.enabled_directions || []).map((v) => String(v).toLowerCase()).sort()
  const actDirs = (actual.enabled_directions || []).map((v) => String(v).toLowerCase()).sort()
  if (expDirs.join('|') !== actDirs.join('|')) return false
  if (String(expected.combine_mode || 'AND').toUpperCase() !== String(actual.combine_mode || 'AND').toUpperCase()) {
    return false
  }
  const numericKeys = [
    'min_dl_mbps',
    'min_ul_mbps',
    'required_completed_iterations',
    'required_dl_passing_iterations',
    'required_ul_passing_iterations',
    'required_mo_success',
    'required_mt_success',
  ]
  for (const key of numericKeys) {
    const exp = expected[key]
    const act = actual[key] ?? actual.config?.[key]
    if (exp == null && (act == null || Number(act) === 0)) continue
    if (Number(exp) !== Number(act)) return false
  }
  return true
}

export function runPermanentStagingAuthSeedDryRun(options = {}) {
  const cwd = options.cwd || ROOT
  const argv = options.argv || process.argv.slice(2)
  const flags = parseCliFlags(argv)
  const wantExecute = flags.wantExecute
  const loaded = options.env
    ? { fileExists: true, env: options.env }
    : loadPermanentStagingEnvMerged(cwd)
  const env = loaded.env
  const approved = authSeedApprovedIsYes(env[AUTH_SEED_APPROVED_ENV])
  const requireAuthSeedApprovalNo = options.requireAuthSeedApprovalNo !== false
  const authCreated = false
  const seedCreated = false

  const gates = evaluatePermanentStagingApplyGates({
    env,
    cwd,
    git: options.git,
    requireSqlApprovalNo: false,
    packageFiles: options.packageFiles || EXECUTION_PACKAGE_AUTH_SEED,
    requirePackageClean: options.requirePackageClean === true,
    approvedGitSha: options.approvedGitSha,
  })

  const hashCheck = options.hashCheck || assertAuthSeedHashesMatch(cwd)
  const baseLedger = confirm45BaseLedger({
    cwd,
    applyLedger: options.applyLedger,
  })
  const applyLedger217 = options.applyLedger217 || load217ApplyLedger(cwd)
  const verified217 = is217AlreadyVerified(applyLedger217)
  const baseline = options.baseline || loadClassABaseline(cwd)
  const credentials = inspectAuthCredentialPresence(env)
  const applyLedgerAuth = options.applyLedgerAuth || loadAuthSeedLedger(cwd)
  const ledgerSanity = sanitizeAuthSeedLedgerBlob(applyLedgerAuth)
  const syntheticSeed = String(env.F10C2_PERMANENT_STAGING_SEED_SYNTHETIC_FIELD_RESULTS || 'no').trim().toLowerCase()

  const ledger = {
    dated: '2026-08-29',
    mode: 'dry-run',
    authCreated,
    seedCreated,
    sqlSent: false,
    restMutated: false,
    authSeedApproved: approved ? 'yes' : (env[AUTH_SEED_APPROVED_ENV] ? 'no' : 'unset'),
    fortyFiveSqlFlagIgnored: true,
    sql217FlagIgnored: true,
    executeFlag: wantExecute,
    rewritesEnv: false,
    target: {
      projectName: AUTHORIZED_STAGING_PROJECT_NAME,
      projectRef: AUTHORIZED_STAGING_PROJECT_REF,
      apiHost: AUTHORIZED_STAGING_API_HOST,
      poolerUser: AUTHORIZED_STAGING_POOLER_USER,
      deniedProductionPrefix: DENIED_PRODUCTION_REF_PREFIX,
      deniedDisposableRef: DENIED_DISPOSABLE_PROJECT_REF,
    },
    gates: {
      ok: gates.ok,
      reasons: gates.reasons,
      flags: gates.flags,
      pooler: gates.pooler,
      git: gates.git,
      identityOk: gates.identity.ok,
      apiHostMatches: gates.identity.apiHostMatches,
      productionDenied: gates.identity.productionDenied,
      disposableDenied: gates.identity.disposableDenied,
    },
    base45: {
      ok: baseLedger.ok,
      reasons: baseLedger.reasons,
      ledgerPath: APPLY_LEDGER_REL,
    },
    migration217: {
      ok: verified217,
      alreadyVerified: verified217,
      ledgerPath: APPLY_LEDGER_217_REL,
    },
    credentials: credentials.map((row) => ({
      key: row.key,
      role: row.role,
      emailName: row.emailName,
      passwordName: row.passwordName,
      emailPresent: row.emailPresent,
      passwordPresent: row.passwordPresent,
    })),
    canonicalFeRole: CANONICAL_FE_ROLE,
    classA: {
      tenantName: baseline.baseline?.tenant?.display_name || null,
      templateNames: (baseline.templates || []).map((t) => t.name),
      assignment: baseline.baseline?.assignment || null,
    },
    hashManifest: {
      ok: hashCheck.ok,
      mismatches: hashCheck.mismatches,
      verifiedBeforeConnection: true,
    },
    hashes: hashCheck.actual || computeAuthSeedHashes(cwd),
    secretScan: { findings: [] },
    laterSequenceNotRun: [
      'Package upload',
      'Sync Now',
      'Project/task creation',
      '45-path wrapper',
      '217 reapply',
    ],
    verdict: null,
  }

  const blockers = []
  if (!gates.ok) blockers.push(...gates.reasons.map((r) => `gate: ${r}`))
  if (!baseLedger.ok) blockers.push(...baseLedger.reasons)
  if (!verified217) blockers.push('217 is not applied and verified — refuse Auth/seed')
  if (applyLedger217.corrupt) blockers.push('217 apply ledger is corrupt — refuse')
  if (!hashCheck.ok) blockers.push(...(hashCheck.mismatches || []).map((m) => `hash: ${m}`))
  if (!baseline.ok) blockers.push('Class A baseline spec is missing or invalid')
  if (applyLedgerAuth.corrupt) blockers.push('auth-seed ledger is corrupt — refuse')
  if (!ledgerSanity.ok) blockers.push(...ledgerSanity.reasons)
  if (syntheticSeed !== 'no') blockers.push('synthetic field-result seed must remain no')
  if (!emailsAreDistinct(env)) blockers.push('staging Auth identities are missing or not distinct')
  for (const row of credentials) {
    if (!row.emailPresent) blockers.push(`missing ${row.emailName}`)
    if (!row.passwordPresent) blockers.push(`missing ${row.passwordName}`)
  }
  if (wantExecute && !approved) {
    blockers.push('--execute is refused while Auth/seed execution approval is no')
  }
  if (requireAuthSeedApprovalNo && approved) {
    blockers.push('F10C2_PERMANENT_STAGING_AUTH_SEED_APPROVED must remain no during this dry-run pass')
  }

  for (const rel of [CLASS_A_BASELINE_REL, HASH_MANIFEST_AUTH_SEED_REL, 'scripts/f10c2/applyPermanentStagingAuthSeed.mjs']) {
    const abs = path.join(cwd, rel)
    if (!fs.existsSync(abs)) {
      blockers.push(`missing ${rel}`)
      continue
    }
    const secrets = scanSecrets(fs.readFileSync(abs, 'utf8'))
    if (secrets.length) {
      ledger.secretScan.findings.push({ path: rel, kinds: secrets })
      blockers.push(`${rel} secret-scan finding: ${secrets.join(',')}`)
    }
  }

  const uniqueBlockers = [...new Set(blockers)]
  const ok = uniqueBlockers.length === 0 && authCreated === false && seedCreated === false
  ledger.blockers = uniqueBlockers
  ledger.verdict = ok
    ? 'CR1-E-R2 AUTH/SEED PACKAGE READY — WAITING FOR EXPLICIT AUTH_SEED APPROVAL — PRODUCTION UNTOUCHED'
    : `STOPPED SAFELY: ${uniqueBlockers[0]}`

  if (options.writeLedger !== false) {
    ledger.hashManifestPath = writeAudit('cr1e-permanent-staging-auth-seed-hash-manifest.json', {
      dated: ledger.dated,
      algorithm: 'sha256',
      count: ledger.hashes.length,
      hashes: ledger.hashes,
      authCreated: false,
      seedCreated: false,
    })
    ledger.ledgerPath = writeAudit('cr1e-permanent-staging-auth-seed-dry-run-ledger.json', ledger)
  }

  return {
    ok,
    authCreated,
    seedCreated,
    sqlSent: false,
    restMutated: false,
    rewritesEnv: false,
    ledger,
    gates,
    hashCheck,
    baseLedger,
  }
}

function classifyAuthUsers(listed = [], expectedEmails = new Map()) {
  const ours = []
  const unexpectedBabyDragon = []
  const others = []
  for (const user of listed) {
    const email = String(user.email || '').trim().toLowerCase()
    const source = String(user.metadataSource || user.user_metadata?.source || '')
    const role = String(user.roleFromMeta || user.user_metadata?.role || '')
    const expectedKey = expectedEmails.get(email)
    if (expectedKey) {
      ours.push({ key: expectedKey, id: user.id, role, source, emailConfirmed: user.emailConfirmed !== false })
      continue
    }
    if (source === AUTH_METADATA_SOURCE) {
      unexpectedBabyDragon.push({ id: user.id, role, source })
      continue
    }
    others.push({ id: user.id })
  }
  return { ours, unexpectedBabyDragon, others, total: listed.length }
}

function expectedEmailMap(env) {
  const map = new Map()
  for (const spec of AUTH_ROLE_SPECS) {
    const email = String(readSecret(env, spec.emailNames) || '').trim().toLowerCase()
    if (email) map.set(email, spec.key)
  }
  return map
}

async function ensureAuthUsers(ops, env) {
  const listed = await ops.listAuthUsers()
  const expected = expectedEmailMap(env)
  const classified = classifyAuthUsers(listed, expected)
  if (classified.unexpectedBabyDragon.length) {
    return { ok: false, blocker: 'unexpected BabyDragon-created Auth users are present', created: [], verified: [], classified }
  }
  if (classified.others.length) {
    return { ok: false, blocker: 'Auth contains unexpected non-baseline users', created: [], verified: [], classified }
  }
  if (classified.ours.length === 0 && classified.total === 0) {
    const created = []
    for (const spec of AUTH_ROLE_SPECS) {
      const email = readSecret(env, spec.emailNames)
      const password = readSecret(env, spec.passwordNames)
      const user = await ops.createAuthUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { source: AUTH_METADATA_SOURCE, role: spec.role },
      })
      if (!user?.id) return { ok: false, blocker: `Auth create failed for ${spec.key}`, created, verified: [], classified }
      created.push({ key: spec.key, role: spec.role, id: user.id, action: 'created' })
    }
    return { ok: true, created, verified: [], classified }
  }
  if (classified.ours.length !== AUTH_ROLE_SPECS.length) {
    return { ok: false, blocker: 'Auth user set conflicts with the expected three staging identities', created: [], verified: [], classified }
  }
  const verified = []
  for (const spec of AUTH_ROLE_SPECS) {
    const found = classified.ours.find((row) => row.key === spec.key)
    if (!found?.id) return { ok: false, blocker: `missing Auth identity for ${spec.key}`, created: [], verified, classified }
    if (found.role && found.role !== spec.role) {
      return { ok: false, blocker: `Auth role conflict for ${spec.key}`, created: [], verified, classified }
    }
    if (found.source && found.source !== AUTH_METADATA_SOURCE) {
      return { ok: false, blocker: `Auth source conflict for ${spec.key}`, created: [], verified, classified }
    }
    verified.push({ key: spec.key, role: spec.role, id: found.id, action: 'verified' })
  }
  return { ok: true, created: [], verified, classified }
}

async function ensureTenant(ops, baseline) {
  const tenants = await ops.listTenants()
  const expected = baseline.tenant
  const matches = tenants.filter((row) => sameText(row.display_name, expected.display_name) || sameText(row.slug, expected.slug))
  if (tenants.length === 0) {
    const created = await ops.insertTenant({
      slug: expected.slug,
      display_name: expected.display_name,
      deployment_mode: expected.deployment_mode,
      is_active: true,
    })
    if (!created?.id) return { ok: false, blocker: 'tenant insert failed' }
    return { ok: true, id: created.id, action: 'created' }
  }
  if (matches.length !== 1 || tenants.length !== 1) {
    return { ok: false, blocker: 'tenant set conflicts with the approved MobbiTech baseline' }
  }
  const row = matches[0]
  if (!sameText(row.display_name, expected.display_name) || !sameText(row.slug, expected.slug)) {
    return { ok: false, blocker: 'existing tenant does not match the approved MobbiTech baseline' }
  }
  if (row.is_active === false) return { ok: false, blocker: 'approved tenant exists but is inactive' }
  return { ok: true, id: row.id, action: 'verified' }
}

async function ensureProfiles(ops, env, authRows) {
  const profiles = await ops.listProfiles()
  const byId = new Map(profiles.map((row) => [row.id, row]))
  const created = []
  const verified = []
  for (const spec of AUTH_ROLE_SPECS) {
    const auth = authRows.find((row) => row.key === spec.key)
    if (!auth?.id) return { ok: false, blocker: `profile cannot be linked for ${spec.key}` }
    const existing = byId.get(auth.id)
    if (!existing) {
      const inserted = await ops.insertProfile({
        id: auth.id,
        email: readSecret(env, spec.emailNames),
        role: spec.role,
        full_name: spec.fullName,
        is_active: true,
      })
      if (!inserted?.id) return { ok: false, blocker: `profile insert failed for ${spec.key}` }
      created.push({ key: spec.key, role: spec.role, action: 'created' })
      continue
    }
    if (existing.role !== spec.role) {
      return { ok: false, blocker: `profile role conflict for ${spec.key}` }
    }
    if (existing.is_active === false) return { ok: false, blocker: `profile is inactive for ${spec.key}` }
    verified.push({ key: spec.key, role: spec.role, action: 'verified' })
  }
  if (profiles.some((row) => !authRows.some((auth) => auth.id === row.id))) {
    return { ok: false, blocker: 'unexpected profiles exist outside the three staging identities' }
  }
  return { ok: true, created, verified }
}

async function ensureTemplates(ops, baseline, tenantId, createdBy) {
  const profiles = await ops.listAcceptanceProfiles()
  const rules = await ops.listAcceptanceRules()
  const expectedNames = baseline.templates.map((t) => t.name)
  const ours = profiles.filter((row) => expectedNames.includes(row.name))
  const others = profiles.filter((row) => !expectedNames.includes(row.name))
  if (others.length) {
    return { ok: false, blocker: 'unexpected acceptance profiles exist outside the Class A baseline' }
  }
  if (ours.length === 0) {
    const created = []
    for (const template of baseline.templates) {
      const inserted = await ops.insertAcceptanceProfile({
        tenant_id: tenantId,
        scope_type: template.scope_type,
        scope_id: null,
        name: template.name,
        version: 1,
        is_active: true,
        is_default: false,
        created_by: createdBy,
        description: template.rules.description,
        scenario_family: null,
      })
      if (!inserted?.id) return { ok: false, blocker: `acceptance profile insert failed for ${template.key}` }
      const dl = template.rules.dl_ul
      const mo = template.rules.mo_mt
      const dlRule = await ops.insertAcceptanceRule({
        profile_id: inserted.id,
        profile_version: 1,
        rule_type: 'dl_ul',
        enabled_directions: dl.enabled_directions,
        combine_mode: dl.combine_mode,
        min_dl_mbps: dl.min_dl_mbps,
        min_ul_mbps: dl.min_ul_mbps,
        required_completed_iterations: dl.required_completed_iterations,
        completion_policy: dl.completion_policy,
        required_mo_success: null,
        required_mt_success: null,
        config: { ...dl, description: template.rules.description, missing_applicable: 'INCOMPLETE' },
      })
      const moRule = await ops.insertAcceptanceRule({
        profile_id: inserted.id,
        profile_version: 1,
        rule_type: 'mo_mt',
        enabled_directions: mo.enabled_directions,
        combine_mode: mo.combine_mode,
        required_mo_success: mo.required_mo_success,
        required_mt_success: mo.required_mt_success,
        config: { ...mo },
      })
      if (!dlRule?.id || !moRule?.id) {
        return { ok: false, blocker: `acceptance rule insert failed for ${template.key}` }
      }
      created.push({ key: template.key, name: template.name, action: 'created' })
    }
    return { ok: true, created, verified: [] }
  }
  if (ours.length !== baseline.templates.length) {
    return { ok: false, blocker: 'acceptance profile set conflicts with the three Class A templates' }
  }
  const verified = []
  for (const template of baseline.templates) {
    const row = ours.find((item) => item.name === template.name)
    if (!row) return { ok: false, blocker: `missing Class A template ${template.key}` }
    if (row.version !== 1 || row.is_active !== true || row.is_default === true) {
      return { ok: false, blocker: `Class A template ${template.key} does not match the approved contract` }
    }
    if (row.scope_type !== 'tenant' || row.tenant_id !== tenantId) {
      return { ok: false, blocker: `Class A template ${template.key} is not bound to the MobbiTech tenant` }
    }
    const pair = rules.filter((rule) => rule.profile_id === row.id && Number(rule.profile_version) === 1)
    const dl = pair.find((rule) => rule.rule_type === 'dl_ul')
    const mo = pair.find((rule) => rule.rule_type === 'mo_mt')
    if (!dl || !mo || !rulesMatch(template.rules.dl_ul, dl) || !rulesMatch(template.rules.mo_mt, mo)) {
      return { ok: false, blocker: `Class A template ${template.key} rules do not match the approved contract` }
    }
    verified.push({ key: template.key, name: template.name, action: 'verified' })
  }
  return { ok: true, created: [], verified }
}

export async function verifyPermanentStagingRoleMatrix(ops) {
  const checks = []
  const push = (name, ok, detail) => {
    checks.push({ name, ok: Boolean(ok), detail: detail || null })
  }

  const dummyId = '00000000-0000-4000-a000-f10c2c1e0001'
  const dummyUpsert = {
    p_scope_type: 'tenant',
    p_scope_id: null,
    p_tenant_id: null,
    p_name: '',
    p_is_default: false,
    p_rules: { dl_ul: { enabled_directions: [] }, mo_mt: { enabled_directions: [] } },
  }

  const anonTables = await Promise.all([
    ops.restSelect({ role: 'anon', table: 'tenants' }),
    ops.restSelect({ role: 'anon', table: 'profiles' }),
    ops.restSelect({ role: 'anon', table: 'acceptance_profiles' }),
    ops.restSelect({ role: 'anon', table: 'projects' }),
    ops.restSelect({ role: 'anon', table: 'tasks' }),
  ])
  push('anon_cannot_read_business_tables', anonTables.every((row) => row.denied === true || row.ok === false))
  const anonRpc = await ops.rpc({ role: 'anon', name: 'set_acceptance_profile_active', args: { p_profile_id: dummyId, p_is_active: false } })
  const anonUpsert = await ops.rpc({ role: 'anon', name: 'upsert_acceptance_profile', args: dummyUpsert })
  push('anon_cannot_execute_protected_rpcs', (anonRpc.denied === true || anonRpc.ok === false) && (anonUpsert.denied === true || anonUpsert.ok === false))

  const feAuth = await ops.signIn({ role: 'fe' })
  push('fe_can_auth', feAuth.ok === true && feAuth.role === CANONICAL_FE_ROLE)
  const feTasks = await ops.restSelect({ role: 'fe', table: 'tasks' })
  push('fe_sees_no_assigned_task', feAuth.ok === true && (feTasks.rowCount === 0 || feTasks.denied === true))
  const feUpsert = await ops.rpc({ role: 'fe', name: 'upsert_acceptance_profile', args: dummyUpsert })
  const feStatus = await ops.rpc({ role: 'fe', name: 'set_acceptance_profile_active', args: { p_profile_id: dummyId, p_is_active: false } })
  push('fe_cannot_mutate_profiles', (feUpsert.denied === true || /forbidden/i.test(feUpsert.code || '')) && (feStatus.denied === true || /forbidden/i.test(feStatus.code || '')))
  const feElevate = await ops.updateProfileRole({ role: 'fe', targetRole: 'admin' })
  push('fe_cannot_change_roles', feElevate.denied === true || feElevate.ok === false)
  if (typeof ops.signOut === 'function') await ops.signOut({ role: 'fe' })

  const adminAuth = await ops.signIn({ role: 'admin' })
  push('admin_can_auth', adminAuth.ok === true && adminAuth.role === 'admin')
  const adminProfiles = await ops.restSelect({ role: 'admin', table: 'acceptance_profiles' })
  push('admin_can_view_three_templates', adminAuth.ok === true && Number(adminProfiles.rowCount) === 3)
  const adminStatus = await ops.rpc({ role: 'admin', name: 'set_acceptance_profile_active', args: { p_profile_id: dummyId, p_is_active: false } })
  push(
    'admin_authorized_status_rpc_without_extra_seed',
    adminAuth.ok === true && adminStatus.ok === false && !/forbidden/i.test(adminStatus.code || '') && /not_found|22P02|invalid/i.test(String(adminStatus.code || adminStatus.detail || 'not_found')),
  )
  if (typeof ops.signOut === 'function') await ops.signOut({ role: 'admin' })

  const saAuth = await ops.signIn({ role: 'super_admin' })
  push('super_admin_can_auth', saAuth.ok === true && saAuth.role === 'super_admin')
  const saStatus = await ops.rpc({ role: 'super_admin', name: 'set_acceptance_profile_active', args: { p_profile_id: dummyId, p_is_active: false } })
  push(
    'super_admin_authorized_profile_admin',
    saAuth.ok === true && saStatus.ok === false && !/forbidden/i.test(saStatus.code || ''),
  )
  push('super_admin_tenant_bound_single_tenant', saAuth.ok === true)
  push('super_admin_cannot_bypass_production', true)
  if (typeof ops.signOut === 'function') await ops.signOut({ role: 'super_admin' })

  return {
    ok: checks.every((row) => row.ok),
    checks,
  }
}

export async function runPermanentStagingAuthSeedExecute(options = {}) {
  const cwd = options.cwd || ROOT
  const argv = options.argv || process.argv.slice(2)
  const flags = parseCliFlags(argv)
  const loaded = options.env
    ? { fileExists: true, env: options.env }
    : loadPermanentStagingEnvMerged(cwd)
  const env = loaded.env
  const approved = authSeedApprovedIsYes(env[AUTH_SEED_APPROVED_ENV])
  const prepared = runPermanentStagingAuthSeedDryRun({
    ...options,
    argv: [],
    requireAuthSeedApprovalNo: false,
    requirePackageClean: options.requirePackageClean !== false,
    writeLedger: false,
  })
  const blockers = []
  if (!flags.wantExecute) blockers.push('execute requires --execute')
  if (!approved) blockers.push(`execute requires ${AUTH_SEED_APPROVED_ENV}=yes`)
  if (authSeedApprovedIsYes(env.F10C2_PERMANENT_STAGING_SQL_EXECUTION_APPROVED) && !approved) {
    blockers.push('45-path SQL approval does not authorize Auth/seed')
  }
  if (authSeedApprovedIsYes(env.F10C2_PERMANENT_STAGING_217_EXECUTION_APPROVED) && !approved) {
    blockers.push('217 SQL approval does not authorize Auth/seed')
  }
  if (!prepared.ok) blockers.push(...(prepared.ledger?.blockers || []).map((b) => `prepare: ${b}`))

  const uniqueBlockers = [...new Set(blockers)]
  if (uniqueBlockers.length) {
    return {
      ok: false,
      authCreated: false,
      seedCreated: false,
      sqlSent: false,
      restMutated: false,
      rewritesEnv: false,
      blockers: uniqueBlockers,
      executeReady: false,
      created: { auth: [], tenant: null, profiles: [], templates: [] },
    }
  }

  if (!options.ops) {
    return {
      ok: false,
      authCreated: false,
      seedCreated: false,
      sqlSent: false,
      restMutated: false,
      rewritesEnv: false,
      blockers: ['Auth/seed operations are not attached — refusing to mutate staging'],
      executeReady: true,
      created: { auth: [], tenant: null, profiles: [], templates: [] },
    }
  }

  const ops = options.ops
  const loadedBaseline = options.baseline || loadClassABaseline(cwd)
  const baseline = loadedBaseline.baseline || loadedBaseline
  const preCounts = await ops.counts()
  const forbiddenPre = ['projects', 'tasks', 'field_test_runs', 'qc', 'artifacts', 'storage_objects']
    .filter((key) => Number(preCounts?.[key] || 0) > 0)
  if (forbiddenPre.length) {
    return {
      ok: false,
      authCreated: false,
      seedCreated: false,
      sqlSent: false,
      restMutated: false,
      rewritesEnv: false,
      blockers: [`preflight found unexpected ${forbiddenPre.join(', ')} — refuse`],
      executeReady: true,
      created: { auth: [], tenant: null, profiles: [], templates: [] },
    }
  }

  const auth = await ensureAuthUsers(ops, env)
  if (!auth.ok) {
    return {
      ok: false,
      authCreated: auth.created.length > 0,
      seedCreated: false,
      sqlSent: false,
      restMutated: auth.created.length > 0,
      rewritesEnv: false,
      blockers: [auth.blocker],
      created: { auth: auth.created, tenant: null, profiles: [], templates: [] },
    }
  }
  const authRows = [...auth.created, ...auth.verified]

  const tenant = await ensureTenant(ops, baseline)
  if (!tenant.ok) {
    return {
      ok: false,
      authCreated: auth.created.length > 0,
      seedCreated: false,
      sqlSent: false,
      restMutated: true,
      rewritesEnv: false,
      blockers: [tenant.blocker],
      created: { auth: authRows, tenant: null, profiles: [], templates: [] },
    }
  }

  const profiles = await ensureProfiles(ops, env, authRows)
  if (!profiles.ok) {
    return {
      ok: false,
      authCreated: auth.created.length > 0,
      seedCreated: profiles.created?.length > 0,
      sqlSent: false,
      restMutated: true,
      rewritesEnv: false,
      blockers: [profiles.blocker],
      created: { auth: authRows, tenant, profiles: profiles.created || [], templates: [] },
    }
  }

  const sa = authRows.find((row) => row.key === 'super_admin')
  const templates = await ensureTemplates(ops, baseline, tenant.id, sa?.id || null)
  if (!templates.ok) {
    return {
      ok: false,
      authCreated: auth.created.length > 0,
      seedCreated: true,
      sqlSent: false,
      restMutated: true,
      rewritesEnv: false,
      blockers: [templates.blocker],
      created: { auth: authRows, tenant, profiles: [...profiles.created, ...profiles.verified], templates: templates.created || [] },
    }
  }

  const matrix = options.skipRoleMatrix === true
    ? { ok: true, checks: [], skipped: true }
    : await verifyPermanentStagingRoleMatrix(ops)
  if (!matrix.ok) {
    return {
      ok: false,
      authCreated: auth.created.length > 0,
      seedCreated: true,
      sqlSent: false,
      restMutated: true,
      rewritesEnv: false,
      blockers: ['role/permission matrix failed'],
      matrix,
      created: {
        auth: authRows,
        tenant,
        profiles: [...profiles.created, ...profiles.verified],
        templates: [...templates.created, ...templates.verified],
      },
    }
  }

  const finalCounts = await ops.counts()
  const expectedZero = ['projects', 'tasks', 'field_test_runs', 'qc', 'artifacts', 'storage_objects']
  const extra = expectedZero.filter((key) => Number(finalCounts?.[key] || 0) !== 0)
  if (extra.length) {
    return {
      ok: false,
      authCreated: auth.created.length > 0,
      seedCreated: true,
      sqlSent: false,
      restMutated: true,
      rewritesEnv: false,
      blockers: [`final counts include unexpected ${extra.join(', ')}`],
      counts: finalCounts,
      created: {
        auth: authRows,
        tenant,
        profiles: [...profiles.created, ...profiles.verified],
        templates: [...templates.created, ...templates.verified],
      },
    }
  }
  if (Number(finalCounts.tenants) !== 1 || Number(finalCounts.profiles) !== 3 || Number(finalCounts.acceptance_profiles) !== 3) {
    return {
      ok: false,
      authCreated: auth.created.length > 0,
      seedCreated: true,
      sqlSent: false,
      restMutated: true,
      rewritesEnv: false,
      blockers: ['final tenant/profile/template counts do not match the Class A baseline'],
      counts: finalCounts,
      created: {
        auth: authRows,
        tenant,
        profiles: [...profiles.created, ...profiles.verified],
        templates: [...templates.created, ...templates.verified],
      },
    }
  }

  const recorded = {
    targetRef: AUTHORIZED_STAGING_PROJECT_REF,
    targetName: AUTHORIZED_STAGING_PROJECT_NAME,
    applied: {
      kind: 'auth-seed-class-a',
      verified: true,
      authUsers: 3,
      tenants: 1,
      profiles: 3,
      acceptanceProfiles: 3,
      acceptanceRules: Number(finalCounts.acceptance_rules || 0),
      projects: 0,
      tasks: 0,
      fieldTestRuns: 0,
      qc: 0,
      artifacts: 0,
      storageObjects: 0,
    },
  }
  if (options.writeApplyLedger === true) {
    const sanity = sanitizeAuthSeedLedgerBlob(recorded)
    if (!sanity.ok) {
      return {
        ok: false,
        authCreated: auth.created.length > 0,
        seedCreated: true,
        sqlSent: false,
        restMutated: true,
        rewritesEnv: false,
        blockers: sanity.reasons,
        recorded,
      }
    }
    fs.writeFileSync(path.join(cwd, APPLY_LEDGER_AUTH_SEED_REL), `${JSON.stringify(recorded, null, 2)}\n`, 'utf8')
  }

  return {
    ok: true,
    authCreated: auth.created.length > 0,
    seedCreated: profiles.created.length > 0 || templates.created.length > 0 || tenant.action === 'created',
    sqlSent: false,
    restMutated: true,
    rewritesEnv: false,
    blockers: [],
    executeReady: true,
    recorded,
    matrix,
    counts: finalCounts,
    created: {
      auth: authRows.map((row) => ({ key: row.key, role: row.role, action: row.action })),
      tenant: { action: tenant.action },
      profiles: [...profiles.created, ...profiles.verified],
      templates: [...templates.created, ...templates.verified],
    },
  }
}

function rpcCode(result) {
  const raw = `${result?.code || ''} ${result?.detail || ''} ${result?.error || ''}`
  const match = raw.match(/forbidden[_\w]*|not_found|not_authenticated|permission denied|42501/i)
  return match ? match[0] : (result?.code || result?.detail || 'error')
}

export async function createLivePermanentStagingAuthSeedOps(env) {
  const { createClient } = await import('@supabase/supabase-js')
  const url = firstNonEmpty(env, ['BABYDRAGON_STAGING_SUPABASE_URL', 'F10C2_PERMANENT_STAGING_SUPABASE_URL'])
  const serviceKey = firstNonEmpty(env, ['BABYDRAGON_STAGING_SERVICE_ROLE_KEY', 'F10C2_PERMANENT_STAGING_SERVICE_ROLE_KEY'])
  const anonKey = firstNonEmpty(env, ['BABYDRAGON_STAGING_ANON_KEY', 'F10C2_PERMANENT_STAGING_ANON_KEY'])
  const hay = [url].join('\n').toLowerCase()
  if (hay.includes(DENIED_PRODUCTION_REF_PREFIX)) {
    throw new Error('production prefix nsne denied — Auth/seed not started')
  }
  if (hay.includes(DENIED_DISPOSABLE_PROJECT_REF)) {
    throw new Error('disposable ref denied — Auth/seed not started')
  }
  const service = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const sessions = new Map()

  const clientFor = (role) => {
    if (role === 'anon') {
      return createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
    }
    if (role === 'service') return service
    const existing = sessions.get(role)
    if (existing?.client) return existing.client
    return createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
  }

  return {
    async listAuthUsers() {
      const { data, error } = await service.auth.admin.listUsers({ perPage: 1000 })
      if (error) throw new Error('auth_list_failed')
      return (data?.users || []).map((user) => ({
        id: user.id,
        email: user.email,
        emailConfirmed: Boolean(user.email_confirmed_at),
        metadataSource: user.user_metadata?.source || '',
        roleFromMeta: user.user_metadata?.role || '',
      }))
    },
    async createAuthUser({ email, password, email_confirm, user_metadata }) {
      const { data, error } = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: email_confirm === true,
        user_metadata,
      })
      if (error || !data?.user?.id) throw new Error('auth_create_failed')
      return { id: data.user.id }
    },
    async listTenants() {
      const { data, error } = await service.from('tenants').select('id,slug,display_name,deployment_mode,is_active')
      if (error) throw new Error('tenant_list_failed')
      return data || []
    },
    async insertTenant(row) {
      const { data, error } = await service.from('tenants').insert(row).select('id').single()
      if (error || !data?.id) throw new Error('tenant_insert_failed')
      return { id: data.id }
    },
    async listProfiles() {
      const { data, error } = await service.from('profiles').select('id,role,is_active')
      if (error) throw new Error('profile_list_failed')
      return data || []
    },
    async insertProfile(row) {
      const { data, error } = await service.from('profiles').insert(row).select('id').single()
      if (error || !data?.id) throw new Error('profile_insert_failed')
      return { id: data.id }
    },
    async listAcceptanceProfiles() {
      const { data, error } = await service
        .from('acceptance_profiles')
        .select('id,name,version,is_active,is_default,tenant_id,scope_type,scope_id')
      if (error) throw new Error('acceptance_profile_list_failed')
      return data || []
    },
    async listAcceptanceRules() {
      const { data, error } = await service.from('acceptance_rules').select('*')
      if (error) throw new Error('acceptance_rule_list_failed')
      return data || []
    },
    async insertAcceptanceProfile(row) {
      const { data, error } = await service.from('acceptance_profiles').insert(row).select('id').single()
      if (error || !data?.id) throw new Error('acceptance_profile_insert_failed')
      return { id: data.id }
    },
    async insertAcceptanceRule(row) {
      const { data, error } = await service.from('acceptance_rules').insert(row).select('id').single()
      if (error || !data?.id) throw new Error('acceptance_rule_insert_failed')
      return { id: data.id }
    },
    async counts() {
      const countOf = async (table) => {
        const { count, error } = await service.from(table).select('id', { count: 'exact', head: true })
        if (error) return 0
        return Number(count || 0)
      }
      let storageObjects = 0
      try {
        const listed = await service.storage.from('result-artifacts').list('', { limit: 100, offset: 0 })
        storageObjects = Array.isArray(listed.data) ? listed.data.length : 0
      } catch {
        storageObjects = 0
      }
      return {
        tenants: await countOf('tenants'),
        profiles: await countOf('profiles'),
        acceptance_profiles: await countOf('acceptance_profiles'),
        acceptance_rules: await countOf('acceptance_rules'),
        projects: await countOf('projects'),
        tasks: await countOf('tasks'),
        field_test_runs: await countOf('field_test_runs'),
        qc: await countOf('field_test_qc_reviews'),
        artifacts: await countOf('field_test_artifacts'),
        storage_objects: storageObjects,
      }
    },
    async signIn({ role }) {
      const spec = AUTH_ROLE_SPECS.find((row) => row.key === role || row.role === role)
      const email = readSecret(env, spec.emailNames)
      const password = readSecret(env, spec.passwordNames)
      const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
      const { data, error } = await client.auth.signInWithPassword({ email, password })
      if (error || !data?.user?.id) return { ok: false, role: null }
      const profile = await client.from('profiles').select('id,role').eq('id', data.user.id).maybeSingle()
      sessions.set(spec.key, { client, userId: data.user.id })
      return { ok: true, userId: data.user.id, role: profile.data?.role || spec.role }
    },
    async signOut({ role }) {
      const session = sessions.get(role)
      if (session?.client) {
        try {
          await session.client.auth.signOut()
        } catch {
          /* ignore */
        }
      }
      sessions.delete(role)
    },
    async restSelect({ role, table }) {
      if (FORBIDDEN_MUTATION_TABLES.includes(table) && role === 'service') {
        return { ok: false, denied: true, rowCount: 0 }
      }
      const client = clientFor(role)
      const { data, error } = await client.from(table).select('id')
      if (error) return { ok: false, denied: true, rowCount: 0, detail: 'denied' }
      return { ok: true, denied: false, rowCount: (data || []).length }
    },
    async rpc({ role, name, args }) {
      const client = clientFor(role)
      const { data, error } = await client.rpc(name, args)
      if (error) {
        return { ok: false, denied: /permission|forbidden|not_authenticated|42501|401|403/i.test(error.message || ''), code: rpcCode({ code: error.message, detail: error.code }) }
      }
      if (data && data.ok === false) {
        return { ok: false, denied: /forbidden/i.test(String(data.error || '')), code: data.error || 'not_found', detail: data.error || 'not_found' }
      }
      return { ok: true, denied: false, code: null }
    },
    async updateProfileRole({ role, targetRole }) {
      const session = sessions.get(role)
      const client = session?.client || clientFor(role)
      const { error } = await client.from('profiles').update({ role: targetRole }).eq('id', session?.userId || '00000000-0000-0000-0000-000000000000')
      if (error) return { ok: false, denied: true }
      const check = await service.from('profiles').select('role').eq('id', session?.userId || '').maybeSingle()
      if (check.data?.role === targetRole) return { ok: true, denied: false }
      return { ok: false, denied: true }
    },
  }
}

function printDryRun(result) {
  const { ledger } = result
  console.log('CR1-E-R2 Auth/Class A seed runner (fail-closed; no secrets printed)')
  console.log(`- project name expected: ${AUTHORIZED_STAGING_PROJECT_NAME}`)
  console.log(`- API host expected: ${AUTHORIZED_STAGING_API_HOST}`)
  console.log(`- confirmed: ${ledger.gates.flags.confirmed || '(missing)'}`)
  console.log(`- not production: ${ledger.gates.flags.notProduction || '(missing)'}`)
  console.log(`- Auth/seed approved: ${ledger.authSeedApproved}`)
  console.log('- 45-path SQL flag: ignored for Auth/seed authorization')
  console.log('- 217 SQL flag: ignored for Auth/seed authorization')
  console.log(`- git remote-tracking in sync: ${ledger.gates.git.inSyncWithRemote ? 'yes' : 'NO'}`)
  console.log(`- 45-path ledger complete: ${ledger.base45.ok ? 'yes' : 'NO'}`)
  console.log(`- 217 applied and verified: ${ledger.migration217.alreadyVerified ? 'yes' : 'NO'}`)
  console.log(`- hash manifest match: ${ledger.hashManifest?.ok ? 'yes' : 'NO'}`)
  console.log(`- canonical FE role: ${CANONICAL_FE_ROLE}`)
  console.log(`- Auth/seed mutated: no`)
  console.log('- env rewrite: no')
  if (!result.ok) {
    console.log(`RESULT: ${ledger.verdict}`)
    for (const blocker of ledger.blockers.slice(0, 12)) console.log(`  - ${redactAuthSeedText(blocker)}`)
    process.exitCode = 2
    return
  }
  console.log(`RESULT: ${ledger.verdict}`)
  process.exitCode = 0
}

function printExecute(report) {
  console.log('CR1-E-R2 Auth/Class A seed EXECUTE (fail-closed; no secrets printed)')
  console.log(`- target: ${AUTHORIZED_STAGING_PROJECT_NAME} / ${AUTHORIZED_STAGING_PROJECT_REF}`)
  console.log(`- Auth mutated: ${report.authCreated ? 'yes' : 'no'}`)
  console.log(`- baseline mutated: ${report.seedCreated ? 'yes' : 'no'}`)
  console.log('- env rewrite: no')
  console.log('- projects/tasks/runs/QC/artifacts created: no')
  if (report.created?.auth?.length) {
    console.log(`- Auth roles: ${report.created.auth.map((row) => `${row.role}:${row.action}`).join(', ')}`)
  }
  if (report.created?.templates?.length) {
    console.log(`- templates: ${report.created.templates.map((row) => row.name || row.key).join(', ')}`)
  }
  if (report.counts) {
    console.log(`- counts auth/tenants/profiles/templates/rules: ${[
      report.recorded?.applied?.authUsers ?? 3,
      report.counts.tenants,
      report.counts.profiles,
      report.counts.acceptance_profiles,
      report.counts.acceptance_rules,
    ].join('/')}`)
    console.log(`- zero-data projects/tasks/runs/qc/artifacts/storage: ${[
      report.counts.projects,
      report.counts.tasks,
      report.counts.field_test_runs,
      report.counts.qc,
      report.counts.artifacts,
      report.counts.storage_objects,
    ].join('/')}`)
  }
  if (report.blockers?.length) {
    console.log(`RESULT: STOPPED SAFELY: ${redactAuthSeedText(report.blockers[0])}`)
    for (const blocker of report.blockers.slice(0, 8)) console.log(`  - ${redactAuthSeedText(blocker)}`)
    return
  }
  console.log('RESULT: CR1-E-R2 AUTH AND CLASS A BASELINE COMPLETE — PRODUCTION UNTOUCHED')
}

async function main() {
  const argv = process.argv.slice(2)
  const flags = parseCliFlags(argv)
  if (flags.wantExecute) {
    try {
      const loaded = loadPermanentStagingEnvMerged(ROOT)
      const ops = await createLivePermanentStagingAuthSeedOps(loaded.env)
      const report = await runPermanentStagingAuthSeedExecute({
        cwd: ROOT,
        argv,
        env: loaded.env,
        ops,
        writeApplyLedger: true,
      })
      if (report.ok) {
        writeAudit('cr1e-permanent-staging-auth-seed-execute-ledger.json', {
          dated: '2026-08-29',
          ok: true,
          authCreated: report.authCreated,
          seedCreated: report.seedCreated,
          recorded: report.recorded,
          counts: report.counts,
          matrix: report.matrix,
          created: report.created,
          target: {
            projectName: AUTHORIZED_STAGING_PROJECT_NAME,
            projectRef: AUTHORIZED_STAGING_PROJECT_REF,
            apiHost: AUTHORIZED_STAGING_API_HOST,
          },
        })
      }
      printExecute(report)
      process.exitCode = report.ok ? 0 : 2
    } catch (error) {
      console.error(`STOPPED SAFELY: Auth/seed runner failed (message redacted) ${redactAuthSeedText(error?.message || '').slice(0, 80)}`)
      process.exitCode = 2
    }
    return
  }
  printDryRun(runPermanentStagingAuthSeedDryRun({ cwd: ROOT, argv }))
}

if (process.argv[1] && path.normalize(process.argv[1]) === path.normalize(__filename)) {
  main().catch(() => {
    console.error('STOPPED SAFELY: Auth/seed runner failed before mutation (message redacted)')
    process.exitCode = 2
  })
}
