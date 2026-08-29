/**
 * CR1-E-R1 217-only hashed runner.
 * Default: DRY-RUN. Execute requires F10C2_PERMANENT_STAGING_217_EXECUTION_APPROVED=yes
 * AND --execute. Never reuses F10C2_PERMANENT_STAGING_SQL_EXECUTION_APPROVED.
 * Applies hash-verified 217 forward only, then 217 verification.
 * Never auto-rollback. Never auto-cleanup. Never Auth/seed/upload.
 * Never prints credentials, connection strings, JWTs, or env values.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AUTHORIZED_STAGING_API_HOST,
  AUTHORIZED_STAGING_POOLER_USER,
  AUTHORIZED_STAGING_PROJECT_NAME,
  AUTHORIZED_STAGING_PROJECT_REF,
  DENIED_DISPOSABLE_PROJECT_REF,
  DENIED_PRODUCTION_REF_PREFIX,
  SQL_217_EXECUTION_APPROVED_ENV,
  evaluatePermanentStagingApplyGates,
  loadPermanentStagingEnvMerged,
  sql217ExecutionApprovedIsYes,
} from './assertPermanentStagingTarget.mjs'
import {
  EXPECTED_ALLOWLIST_NUMBERS,
  HASH_MANIFEST_REL,
  PERMANENT_STAGING_FORWARD_PATHS,
  sha256File,
  assertAllowlistHashesMatch,
} from './permanentStagingApplyPlan.mjs'
import {
  APPLY_LEDGER_REL,
  FORTY_FIVE_EXECUTION_PACKAGE_FILES,
  loadApplyLedger,
  validateApplyLedgerSnapshot,
} from './applyPermanentStagingMigrations.mjs'

const __filename = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename), '../..')
const AUDIT_DIR = path.join(ROOT, '..', 'Audit Data', 'F10C2', 'CR1-E')

export const SQL_SENT = false
export const SQL_REWRITE_FORBIDDEN = true
export const AUTO_ROLLBACK = false
export const AUTO_CLEANUP = false
export const AUTH_CREATED = false
export const SEED_CREATED = false
export const MIGRATION_217_NUMBER = '217'
export const MIGRATION_217_SLUG = '217_cr1e_staging_grant_hardening'
export const MIGRATION_217_FORWARD =
  'supabase/drafts/f10c2/phase4b/forward/217_cr1e_staging_grant_hardening.sql'
export const MIGRATION_217_VERIFY =
  'supabase/drafts/f10c2/phase4b/verification/217_cr1e_staging_grant_hardening.sql'
export const MIGRATION_217_ROLLBACK =
  'supabase/drafts/f10c2/phase4b/rollback/217_cr1e_staging_grant_hardening.sql'
export const HASH_MANIFEST_217_REL = 'scripts/f10c2/permanentStaging217.hashes.json'
export const APPLY_LEDGER_217_REL = '.permanent-staging-217-apply-ledger.json'
export const EXECUTION_PACKAGE_217 = Object.freeze([
  MIGRATION_217_FORWARD,
  MIGRATION_217_VERIFY,
  MIGRATION_217_ROLLBACK,
  HASH_MANIFEST_217_REL,
  'scripts/f10c2/applyPermanentStaging217.mjs',
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
]

export function parseCliFlags(argv = []) {
  return { wantExecute: argv.includes('--execute') }
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

export function load217ApplyLedger(cwd = ROOT) {
  const abs = path.join(cwd, APPLY_LEDGER_217_REL)
  if (!fs.existsSync(abs)) {
    return { exists: false, applied: null, path: APPLY_LEDGER_217_REL }
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(abs, 'utf8'))
    return {
      exists: true,
      applied: parsed.applied || null,
      targetRef: parsed.targetRef || null,
      targetName: parsed.targetName || null,
      path: APPLY_LEDGER_217_REL,
    }
  } catch {
    return { exists: true, corrupt: true, applied: null, path: APPLY_LEDGER_217_REL }
  }
}

export function is217AlreadyVerified(ledger) {
  const row = ledger?.applied
  return Boolean(row && String(row.number) === MIGRATION_217_NUMBER && row.verified === true)
}

export function compute217Hashes(cwd = ROOT) {
  return [
    { role: 'forward', path: MIGRATION_217_FORWARD },
    { role: 'verification', path: MIGRATION_217_VERIFY },
    { role: 'rollback', path: MIGRATION_217_ROLLBACK },
  ].map((row) => {
    const abs = path.join(cwd, row.path)
    return {
      ...row,
      number: MIGRATION_217_NUMBER,
      slug: MIGRATION_217_SLUG,
      sha256: fs.existsSync(abs) ? sha256File(abs) : null,
      exists: fs.existsSync(abs),
    }
  })
}

export function loadExpected217Hashes(cwd = ROOT) {
  const abs = path.join(cwd, HASH_MANIFEST_217_REL)
  if (!fs.existsSync(abs)) {
    return { ok: false, missing: true, files: [], algorithm: 'sha256' }
  }
  const parsed = JSON.parse(fs.readFileSync(abs, 'utf8'))
  return {
    ok: true,
    missing: false,
    algorithm: parsed.algorithm || 'sha256',
    count: parsed.count,
    notIn45PathAllowlist: parsed.notIn45PathAllowlist === true,
    files: Array.isArray(parsed.files) ? parsed.files : [],
  }
}

export function assert217HashesMatch(cwd = ROOT) {
  const expected = loadExpected217Hashes(cwd)
  const actual = compute217Hashes(cwd)
  const mismatches = []
  if (expected.missing) mismatches.push(`missing hash manifest ${HASH_MANIFEST_217_REL}`)
  if (expected.ok && expected.notIn45PathAllowlist !== true) {
    mismatches.push('217 hash manifest must record notIn45PathAllowlist=true')
  }
  if (PERMANENT_STAGING_FORWARD_PATHS.includes(MIGRATION_217_FORWARD)) {
    mismatches.push('217 forward must not be in the 45-path allowlist')
  }
  const expectedByRole = new Map((expected.files || []).map((f) => [f.role, f]))
  for (const row of actual) {
    const exp = expectedByRole.get(row.role)
    if (!exp) {
      mismatches.push(`no expected hash for 217 ${row.role}`)
      continue
    }
    if (exp.path !== row.path) mismatches.push(`217 ${row.role} path does not match manifest`)
    if (!row.sha256) {
      mismatches.push(`missing file for hash ${row.path}`)
      continue
    }
    if (String(exp.sha256).toLowerCase() !== String(row.sha256).toLowerCase()) {
      mismatches.push(`hash mismatch 217 ${row.role} ${row.path}`)
    }
  }
  for (const exp of expected.files || []) {
    if (!actual.some((row) => row.role === exp.role)) {
      mismatches.push(`expected 217 role not computed ${exp.role}`)
    }
  }
  if (expected.ok && Number(expected.count) !== actual.length) {
    mismatches.push(`217 hash manifest count ${expected.count} != ${actual.length}`)
  }
  return {
    ok: mismatches.length === 0,
    mismatches,
    actual,
    expected,
  }
}

export function confirm45BaseLedger(options = {}) {
  const cwd = options.cwd || ROOT
  const numbers = options.numbers || [...EXPECTED_ALLOWLIST_NUMBERS]
  const hashes = options.hashCheck || assertAllowlistHashesMatch(cwd)
  const hashesByPath = Object.fromEntries((hashes.actual || []).map((h) => [h.path, h.sha256]))
  const ledger = options.applyLedger || loadApplyLedger(cwd)
  const validated = validateApplyLedgerSnapshot(ledger, { numbers, hashesByPath })
  const reasons = []
  if (!hashes.ok) reasons.push(...(hashes.mismatches || []).map((m) => `45-hash: ${m}`))
  if (!validated.ok) reasons.push(...validated.reasons.map((r) => `45-ledger: ${r}`))
  if (validated.state !== 'complete') reasons.push('45-path ledger is not complete and verified')
  return {
    ok: reasons.length === 0 && validated.ok && hashes.ok,
    reasons: [...new Set(reasons)],
    validated,
    hashesOk: hashes.ok,
  }
}

function sanitize217LedgerBlob(ledger) {
  const blob = JSON.stringify(ledger || {})
  const reasons = []
  if (blob.toLowerCase().includes(DENIED_PRODUCTION_REF_PREFIX)) {
    reasons.push('217 ledger contains production prefix')
  }
  if (blob.includes(DENIED_DISPOSABLE_PROJECT_REF)) {
    reasons.push('217 ledger contains disposable identity')
  }
  for (const re of LEDGER_SECRET_RE) {
    if (re.test(blob)) reasons.push('217 ledger contains a credential-shaped value')
  }
  return { ok: reasons.length === 0, reasons }
}

export function runPermanentStaging217DryRun(options = {}) {
  const cwd = options.cwd || ROOT
  const argv = options.argv || process.argv.slice(2)
  const flags = parseCliFlags(argv)
  const wantExecute = flags.wantExecute
  const loaded = options.env
    ? { fileExists: true, env: options.env }
    : loadPermanentStagingEnvMerged(cwd)
  const env = loaded.env
  const approved217 = sql217ExecutionApprovedIsYes(env[SQL_217_EXECUTION_APPROVED_ENV])
  const sqlSent = false
  const require217ApprovalNo = options.require217ApprovalNo !== false

  const gates = evaluatePermanentStagingApplyGates({
    env,
    cwd,
    git: options.git,
    requireSqlApprovalNo: false,
    packageFiles: options.packageFiles || EXECUTION_PACKAGE_217,
    requirePackageClean: options.requirePackageClean === true,
    approvedGitSha: options.approvedGitSha,
  })

  const hashCheck = options.hashCheck || assert217HashesMatch(cwd)
  const baseLedger = confirm45BaseLedger({
    cwd,
    applyLedger: options.applyLedger,
  })
  const applyLedger217 = options.applyLedger217 || load217ApplyLedger(cwd)
  const alreadyApplied = is217AlreadyVerified(applyLedger217)
  const ledgerSanity = sanitize217LedgerBlob(applyLedger217)

  const ledger = {
    dated: '2026-08-29',
    mode: 'dry-run',
    sqlSent,
    sql217ExecutionApproved: approved217 ? 'yes' : (env[SQL_217_EXECUTION_APPROVED_ENV] ? 'no' : 'unset'),
    fortyFiveSqlFlagIgnored: true,
    executeFlag: wantExecute,
    authUsersCreated: AUTH_CREATED,
    seedCreated: SEED_CREATED,
    autoRollback: AUTO_ROLLBACK,
    autoCleanup: AUTO_CLEANUP,
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
      hashManifestRel: HASH_MANIFEST_REL,
      packageFiles: [...FORTY_FIVE_EXECUTION_PACKAGE_FILES],
    },
    migration217: {
      number: MIGRATION_217_NUMBER,
      slug: MIGRATION_217_SLUG,
      forwardPath: MIGRATION_217_FORWARD,
      verificationPath: MIGRATION_217_VERIFY,
      rollbackPath: MIGRATION_217_ROLLBACK,
      hashManifestRel: HASH_MANIFEST_217_REL,
      alreadyApplied,
      ledgerPath: APPLY_LEDGER_217_REL,
    },
    hashManifest: {
      ok: hashCheck.ok,
      mismatches: hashCheck.mismatches,
      verifiedBeforeConnection: true,
    },
    hashes: hashCheck.actual || compute217Hashes(cwd),
    secretScan: { findings: [] },
    laterSequenceNotRun: [
      'Auth users',
      'Baseline seed',
      'Package upload',
      'Sync Now',
      '217 recovery / rollback',
    ],
    verdict: null,
  }

  const blockers = []
  if (!gates.ok) blockers.push(...gates.reasons.map((r) => `gate: ${r}`))
  if (!baseLedger.ok) blockers.push(...baseLedger.reasons)
  if (!hashCheck.ok) blockers.push(...(hashCheck.mismatches || []).map((m) => `hash: ${m}`))
  if (alreadyApplied) blockers.push('217 already applied and verified — refuse reapplication')
  if (applyLedger217.corrupt) blockers.push('217 apply ledger is corrupt — refuse')
  if (!ledgerSanity.ok) blockers.push(...ledgerSanity.reasons)
  if (wantExecute && !approved217) {
    blockers.push('--execute is refused while 217 execution approval is no')
  }
  if (require217ApprovalNo && approved217) {
    blockers.push('F10C2_PERMANENT_STAGING_217_EXECUTION_APPROVED must remain no during this dry-run pass')
  }
  if (PERMANENT_STAGING_FORWARD_PATHS.includes(MIGRATION_217_FORWARD)) {
    blockers.push('217 forward leaked into the 45-path allowlist')
  }

  for (const rel of [MIGRATION_217_FORWARD, MIGRATION_217_VERIFY, MIGRATION_217_ROLLBACK, HASH_MANIFEST_217_REL]) {
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
  const ok = uniqueBlockers.length === 0 && sqlSent === false
  ledger.blockers = uniqueBlockers
  ledger.verdict = ok
    ? 'CR1-E-R1 217-ONLY EXECUTION PACKAGE READY — HASHED SINGLE-MIGRATION RUNNER VERIFIED — WAITING FOR EXPLICIT 217 APPROVAL — PRODUCTION UNTOUCHED'
    : `STOPPED SAFELY: ${uniqueBlockers[0]}`

  if (options.writeLedger !== false) {
    ledger.hashManifestPath = writeAudit('cr1e-permanent-staging-217-hash-manifest.json', {
      dated: ledger.dated,
      algorithm: 'sha256',
      count: ledger.hashes.length,
      hashes: ledger.hashes,
      sqlSent: false,
      git: ledger.gates.git,
    })
    ledger.ledgerPath = writeAudit('cr1e-permanent-staging-217-dry-run-ledger.json', ledger)
  }

  return {
    ok,
    sqlSent,
    authCreated: AUTH_CREATED,
    seedCreated: SEED_CREATED,
    autoRollback: AUTO_ROLLBACK,
    autoCleanup: AUTO_CLEANUP,
    ledger,
    gates,
    hashCheck,
    baseLedger,
  }
}

/**
 * Execute path (not used while 217 approval is no).
 * Order: 45 ledger + 217 hashes + target + git → send 217 forward only → verify 217.
 * Stop on first failure. Never auto-rollback / Auth / seed / upload / cleanup.
 */
export async function runPermanentStaging217Execute(options = {}) {
  const cwd = options.cwd || ROOT
  const argv = options.argv || process.argv.slice(2)
  const flags = parseCliFlags(argv)
  const loaded = options.env
    ? { fileExists: true, env: options.env }
    : loadPermanentStagingEnvMerged(cwd)
  const env = loaded.env
  const approved217 = sql217ExecutionApprovedIsYes(env[SQL_217_EXECUTION_APPROVED_ENV])
  const prepared = runPermanentStaging217DryRun({
    ...options,
    argv: [],
    require217ApprovalNo: false,
    requirePackageClean: options.requirePackageClean !== false,
    writeLedger: false,
  })
  const sent = []
  const blockers = []
  if (!flags.wantExecute) blockers.push('execute requires --execute')
  if (!approved217) {
    blockers.push(`execute requires ${SQL_217_EXECUTION_APPROVED_ENV}=yes`)
  }
  if (sql217ExecutionApprovedIsYes(env.F10C2_PERMANENT_STAGING_SQL_EXECUTION_APPROVED) && !approved217) {
    blockers.push('45-path SQL approval does not authorize 217')
  }
  if (!prepared.hashCheck?.ok) blockers.push('217 hash verification failed before connection — SQL not sent')
  if (!prepared.baseLedger?.ok) blockers.push(...(prepared.baseLedger?.reasons || []).map((r) => `45: ${r}`))
  if (!prepared.gates.ok) blockers.push(...prepared.gates.reasons.map((r) => `gate: ${r}`))
  if (is217AlreadyVerified(options.applyLedger217 || load217ApplyLedger(cwd))) {
    blockers.push('217 already applied and verified — refuse reapplication')
  }

  const uniqueBlockers = [...new Set(blockers)]
  if (uniqueBlockers.length) {
    return {
      ok: false,
      sqlSent: false,
      authCreated: AUTH_CREATED,
      seedCreated: SEED_CREATED,
      autoRollback: AUTO_ROLLBACK,
      autoCleanup: AUTO_CLEANUP,
      blockers: uniqueBlockers,
      sent,
      executeReady: false,
    }
  }

  if (typeof options.sqlSender !== 'function') {
    return {
      ok: false,
      sqlSent: false,
      authCreated: AUTH_CREATED,
      seedCreated: SEED_CREATED,
      autoRollback: AUTO_ROLLBACK,
      autoCleanup: AUTO_CLEANUP,
      blockers: ['SQL sender is not attached — refusing to apply 217 (no silent SQL, no file rewrite)'],
      sent,
      executeReady: true,
    }
  }

  const forwardAbs = path.join(cwd, MIGRATION_217_FORWARD)
  const verifyAbs = path.join(cwd, MIGRATION_217_VERIFY)
  const expectedForward = (prepared.hashCheck.actual || []).find((h) => h.role === 'forward')
  const expectedVerify = (prepared.hashCheck.actual || []).find((h) => h.role === 'verification')
  const forwardDigest = sha256File(forwardAbs)
  const verifyDigest = sha256File(verifyAbs)
  if (!expectedForward?.sha256 || forwardDigest !== expectedForward.sha256) {
    return {
      ok: false,
      sqlSent: false,
      authCreated: AUTH_CREATED,
      seedCreated: SEED_CREATED,
      autoRollback: AUTO_ROLLBACK,
      autoCleanup: AUTO_CLEANUP,
      blockers: ['hash mismatch immediately before 217 forward — stopped; no auto-rollback'],
      sent,
    }
  }
  if (!expectedVerify?.sha256 || verifyDigest !== expectedVerify.sha256) {
    return {
      ok: false,
      sqlSent: false,
      authCreated: AUTH_CREATED,
      seedCreated: SEED_CREATED,
      autoRollback: AUTO_ROLLBACK,
      autoCleanup: AUTO_CLEANUP,
      blockers: ['hash mismatch immediately before 217 verification — stopped; no auto-rollback'],
      sent,
    }
  }

  try {
    await options.sqlSender({
      number: MIGRATION_217_NUMBER,
      role: 'forward',
      path: MIGRATION_217_FORWARD,
      bytes: fs.readFileSync(forwardAbs),
      sha256: forwardDigest,
    })
    sent.push({ role: 'forward', path: MIGRATION_217_FORWARD, sha256: forwardDigest })
  } catch {
    return {
      ok: false,
      sqlSent: sent.length > 0,
      authCreated: AUTH_CREATED,
      seedCreated: SEED_CREATED,
      autoRollback: AUTO_ROLLBACK,
      autoCleanup: AUTO_CLEANUP,
      blockers: ['apply stopped on 217 forward — no auto-rollback'],
      sent,
    }
  }

  if (typeof options.verifySender !== 'function' && typeof options.sqlSender !== 'function') {
    return {
      ok: false,
      sqlSent: true,
      authCreated: AUTH_CREATED,
      seedCreated: SEED_CREATED,
      autoRollback: AUTO_ROLLBACK,
      autoCleanup: AUTO_CLEANUP,
      blockers: ['217 verification sender is missing — stopped; no auto-rollback'],
      sent,
    }
  }

  const verifyFn = options.verifySender || options.sqlSender
  try {
    await verifyFn({
      number: MIGRATION_217_NUMBER,
      role: 'verification',
      path: MIGRATION_217_VERIFY,
      bytes: fs.readFileSync(verifyAbs),
      sha256: verifyDigest,
    })
    sent.push({ role: 'verification', path: MIGRATION_217_VERIFY, sha256: verifyDigest })
  } catch {
    return {
      ok: false,
      sqlSent: true,
      authCreated: AUTH_CREATED,
      seedCreated: SEED_CREATED,
      autoRollback: AUTO_ROLLBACK,
      autoCleanup: AUTO_CLEANUP,
      blockers: ['217 verification failed — stopped; no auto-rollback'],
      sent,
    }
  }

  const recorded = {
    targetRef: AUTHORIZED_STAGING_PROJECT_REF,
    targetName: AUTHORIZED_STAGING_PROJECT_NAME,
    applied: {
      number: MIGRATION_217_NUMBER,
      slug: MIGRATION_217_SLUG,
      path: MIGRATION_217_FORWARD,
      sha256: forwardDigest,
      verificationSha256: verifyDigest,
      verified: true,
    },
  }
  if (options.writeApplyLedger === true) {
    fs.writeFileSync(
      path.join(cwd, APPLY_LEDGER_217_REL),
      `${JSON.stringify(recorded, null, 2)}\n`,
      'utf8',
    )
  }

  return {
    ok: true,
    sqlSent: true,
    authCreated: AUTH_CREATED,
    seedCreated: SEED_CREATED,
    autoRollback: AUTO_ROLLBACK,
    autoCleanup: AUTO_CLEANUP,
    blockers: [],
    sent,
    recorded,
    executeReady: true,
  }
}

function printDryRun(result) {
  const { ledger } = result
  console.log('CR1-E-R1 217-only runner (fail-closed; no secrets printed)')
  console.log(`- project name expected: ${AUTHORIZED_STAGING_PROJECT_NAME}`)
  console.log(`- API host expected: ${AUTHORIZED_STAGING_API_HOST}`)
  console.log(`- pooler user expected: ${AUTHORIZED_STAGING_POOLER_USER}`)
  console.log(`- confirmed: ${ledger.gates.flags.confirmed || '(missing)'}`)
  console.log(`- not production: ${ledger.gates.flags.notProduction || '(missing)'}`)
  console.log(`- connection method: ${ledger.gates.flags.connectionMethod}`)
  console.log(`- 217 execution approved: ${ledger.sql217ExecutionApproved}`)
  console.log('- 45-path SQL flag: ignored for 217 authorization')
  console.log(`- git branch match: ${ledger.gates.git.ok ? 'yes' : 'NO'}`)
  console.log(`- git remote-tracking in sync: ${ledger.gates.git.inSyncWithRemote ? 'yes' : 'NO'}`)
  console.log(`- 45-path ledger complete: ${ledger.base45.ok ? 'yes' : 'NO'}`)
  console.log(`- 217 hash manifest match: ${ledger.hashManifest?.ok ? 'yes' : 'NO'}`)
  console.log(`- 217 already applied: ${ledger.migration217.alreadyApplied ? 'yes' : 'no'}`)
  console.log(`- SQL sent: ${ledger.sqlSent ? 'YES' : 'no'}`)
  console.log('- Auth/seed/upload created: no')
  console.log('- auto-rollback: no')
  console.log('- auto-cleanup: no')
  console.log('- SQL rewrite: no')
  if (ledger.hashManifestPath) console.log(`- hash manifest: ${ledger.hashManifestPath}`)
  if (ledger.ledgerPath) console.log(`- dry-run ledger: ${ledger.ledgerPath}`)
  if (!result.ok) {
    console.log(`RESULT: ${ledger.verdict}`)
    for (const blocker of ledger.blockers.slice(0, 12)) console.log(`  - ${blocker}`)
    process.exitCode = 2
    return
  }
  console.log(`RESULT: ${ledger.verdict}`)
  process.exitCode = 0
}

async function main() {
  const argv = process.argv.slice(2)
  const flags = parseCliFlags(argv)
  if (flags.wantExecute) {
    const report = await runPermanentStaging217Execute({ cwd: ROOT, argv })
    console.log('CR1-E-R1 217-only EXECUTE (fail-closed; no secrets printed)')
    console.log(`- SQL sent: ${report.sqlSent ? 'YES' : 'no'}`)
    console.log(`- Auth/seed/upload: no`)
    console.log(`- auto-rollback: no`)
    if (report.blockers?.length) {
      console.log(`RESULT: STOPPED SAFELY: ${report.blockers[0]}`)
      for (const blocker of report.blockers.slice(0, 8)) console.log(`  - ${blocker}`)
    } else {
      console.log(`RESULT: ${report.ok ? '217 applied and verified' : 'STOPPED SAFELY'}`)
    }
    process.exitCode = report.ok ? 0 : 2
    return
  }
  printDryRun(runPermanentStaging217DryRun({ cwd: ROOT, argv }))
}

if (process.argv[1] && path.normalize(process.argv[1]) === path.normalize(__filename)) {
  main().catch(() => {
    console.error('STOPPED SAFELY: 217 runner failed before SQL (message redacted)')
    process.exitCode = 2
  })
}
