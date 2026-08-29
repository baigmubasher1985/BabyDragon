/**
 * CR1-E permanent-staging migration wrapper.
 * Default: DRY-RUN. SQL requires F10C2_PERMANENT_STAGING_SQL_EXECUTION_APPROVED=yes
 * AND --execute. Never rewrites SQL files. Applies hash-verified bytes only.
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
  evaluatePermanentStagingApplyGates,
  loadPermanentStagingEnvMerged,
  sqlExecutionApprovedIsYes,
} from './assertPermanentStagingTarget.mjs'
import {
  EXPECTED_ALLOWLIST_NUMBERS,
  HASH_MANIFEST_REL,
  HISTORICAL_DISPOSABLE_BOOTSTRAP_FORWARD,
  NEVER_EXECUTE_NUMBERS,
  NEVER_RUN_214_PATHS,
  PERMANENT_STAGING_FORWARD_PATHS,
  STAGING_BOOTSTRAP_FORWARD,
  assertAllowlistHashesMatch,
  assertPermanentStagingPlanFilesExist,
  listPermanentStagingAllowlist,
  sha256File,
} from './permanentStagingApplyPlan.mjs'

const __filename = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename), '../..')
const AUDIT_DIR = path.join(ROOT, '..', 'Audit Data', 'F10C2', 'CR1-E')
const EXCLUDED_TOKEN_RE = /\b(009|010|012|013|112|207|214)(?:_[A-Za-z0-9]+|\b)/g
const EXCLUSION_REMINDER_RE = /does not execute|never execute|never run|do not execute|skip 214|not execute|excluded|quarantine|never-run/i
const SECRET_PATTERNS = [
  { kind: 'jwt', re: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/ },
  { kind: 'service_role_assign', re: /service_role\s*=\s*['"][^'"]+/i },
  { kind: 'prod_prefix', re: /\bnsne[a-z0-9]{4,}/i },
  { kind: 'db_url', re: /postgres(?:ql)?:\/\/[^\s:]+:[^\s@]+@/i },
]
const INCLUDE_RE = /\\i(?:r)?\s+\S*(?:009|010|012|013|112|207|214)_/i
const DISPOSABLE_SET_LOCAL_RE = /\bSET\s+LOCAL\s+app\.f10c2_disposable_confirmed\b/i
const STAGING_CONFIRMED_SET_RE = /\bSET\s+LOCAL\s+app\.f10c2_staging_confirmed\b/i

export const SQL_SENT = false
export const SQL_REWRITE_FORBIDDEN = true
export const APPLY_LEDGER_REL = '.permanent-staging-apply-ledger.json'

function stripSqlComments(text) {
  return String(text || '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

export function parseCliFlags(argv = []) {
  const wantExecute = argv.includes('--execute')
  const resumeIdx = argv.indexOf('--resume-from')
  const resumeFrom = resumeIdx >= 0 ? String(argv[resumeIdx + 1] || '').trim() : ''
  return { wantExecute, resumeFrom: resumeFrom || null }
}

export function loadApplyLedger(cwd = ROOT) {
  const abs = path.join(cwd, APPLY_LEDGER_REL)
  if (!fs.existsSync(abs)) {
    return { exists: false, applied: [], path: APPLY_LEDGER_REL }
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(abs, 'utf8'))
    const applied = Array.isArray(parsed.applied) ? parsed.applied : []
    return {
      exists: true,
      applied,
      targetRef: parsed.targetRef || null,
      path: APPLY_LEDGER_REL,
    }
  } catch {
    return { exists: true, corrupt: true, applied: [], path: APPLY_LEDGER_REL }
  }
}

export function evaluateResumePolicy({ ledger, resumeFrom, numbers }) {
  const reasons = []
  const applied = Array.isArray(ledger?.applied) ? ledger.applied : []
  if (ledger?.corrupt) reasons.push('apply ledger is corrupt — refuse execute')
  const appliedNumbers = applied.map((row) => String(row.number))
  const laterThan = (n) => {
    const i = numbers.indexOf(n)
    return i >= 0 ? numbers.slice(i + 1) : []
  }

  if (!resumeFrom) {
    if (appliedNumbers.length) {
      reasons.push('partial apply ledger exists — pass --resume-from <next pending number>')
    }
    return {
      ok: reasons.length === 0,
      reasons,
      startNumber: numbers[0] || null,
      requireEmptyProof: true,
    }
  }

  if (!numbers.includes(resumeFrom)) {
    reasons.push(`--resume-from ${resumeFrom} is not in the allowlist`)
    return { ok: false, reasons, startNumber: null, requireEmptyProof: false }
  }

  const startIdx = numbers.indexOf(resumeFrom)
  const previous = numbers.slice(0, startIdx)
  for (const n of previous) {
    const row = applied.find((a) => a.number === n)
    if (!row) reasons.push(`--resume-from ${resumeFrom} requires ${n} in the apply ledger`)
    else if (row.verified !== true) reasons.push(`--resume-from ${resumeFrom} requires ${n} verified in the ledger`)
  }
  if (appliedNumbers.includes(resumeFrom)) {
    reasons.push(`--resume-from ${resumeFrom} already recorded as applied — resume from the next pending number`)
  }
  for (const n of laterThan(resumeFrom)) {
    if (appliedNumbers.includes(n)) {
      reasons.push(`ledger already has later number ${n} — refuse --resume-from ${resumeFrom}`)
    }
  }
  return {
    ok: reasons.length === 0,
    reasons,
    startNumber: resumeFrom,
    requireEmptyProof: startIdx === 0,
  }
}

function scanExcludedReferences(text) {
  const reminders = []
  const executable = []
  const lines = String(text || '').split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const hits = line.match(EXCLUDED_TOKEN_RE) || []
    if (!hits.length) continue
    if (INCLUDE_RE.test(line)) {
      executable.push({ line: i + 1, kind: 'psql_include', tokens: hits })
      continue
    }
    if (EXCLUSION_REMINDER_RE.test(line) || /^\s*--/.test(line)) {
      reminders.push({ line: i + 1, tokens: [...new Set(hits)] })
      continue
    }
    executable.push({ line: i + 1, kind: 'non_comment_excluded_token', tokens: hits })
  }
  return { reminders, executable }
}

function scanSecrets(text) {
  const findings = []
  for (const { kind, re } of SECRET_PATTERNS) {
    if (re.test(text)) findings.push(kind)
  }
  return findings
}

function writeAudit(name, body) {
  fs.mkdirSync(AUDIT_DIR, { recursive: true })
  const abs = path.join(AUDIT_DIR, name)
  fs.writeFileSync(abs, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
  return `Audit Data/F10C2/CR1-E/${name}`
}

export function runPermanentStagingDryRun(options = {}) {
  const cwd = options.cwd || ROOT
  const argv = options.argv || process.argv.slice(2)
  const flags = parseCliFlags(argv)
  const wantExecute = flags.wantExecute
  const loaded = options.env
    ? { fileExists: true, env: options.env }
    : loadPermanentStagingEnvMerged(cwd)
  const env = loaded.env
  const sqlApproved = sqlExecutionApprovedIsYes(env.F10C2_PERMANENT_STAGING_SQL_EXECUTION_APPROVED)
  const sqlSent = false
  const authCreated = false
  const bucketsCreated = false
  const seedCreated = false
  const requireSqlApprovalNo = options.requireSqlApprovalNo !== false

  const gates = evaluatePermanentStagingApplyGates({
    env,
    cwd,
    git: options.git,
    requireSqlApprovalNo,
  })

  const plan = listPermanentStagingAllowlist()
  const files = assertPermanentStagingPlanFilesExist(cwd)
  const hashCheck = assertAllowlistHashesMatch(cwd)
  const applyLedger = loadApplyLedger(cwd)
  const resumePolicy = evaluateResumePolicy({
    ledger: applyLedger,
    resumeFrom: flags.resumeFrom,
    numbers: plan.entries.map((e) => e.number),
  })

  const ledger = {
    dated: '2026-08-29',
    mode: 'dry-run',
    sqlSent,
    sqlExecutionApproved: gates.flags.sqlExecutionApproved,
    executeFlag: wantExecute,
    authUsersCreated: authCreated,
    storageBucketsCreated: bucketsCreated,
    seedCreated,
    autoRollback: false,
    autoCleanup: false,
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
      emptyDbCheck: {
        performed: false,
        deferred: true,
        restOnly: true,
        note: 'Dry-run skips live DB/REST. Execute path must prove empty via REST (BabyDragon tables absent) before the first migration, without applying SQL.',
      },
      identityOk: gates.identity.ok,
      apiHostMatches: gates.identity.apiHostMatches,
      productionDenied: gates.identity.productionDenied,
      disposableDenied: gates.identity.disposableDenied,
    },
    allowlist: {
      count: plan.entries.length,
      expectedCount: EXPECTED_ALLOWLIST_NUMBERS.length,
      numbers: plan.entries.map((e) => e.number),
      paths: [...PERMANENT_STAGING_FORWARD_PATHS],
      neverExecuteNumbers: [...NEVER_EXECUTE_NUMBERS],
      planOk: plan.ok,
      planReasons: plan.reasons,
      filesOk: files.ok,
      missing: files.missing,
      leaked214InExecutable: files.leaked214InExecutable,
      quarantineOk: files.quarantineOk,
      stagingBootstrapPath: STAGING_BOOTSTRAP_FORWARD,
      historicalDisposable000Path: HISTORICAL_DISPOSABLE_BOOTSTRAP_FORWARD,
      adapterReplacesDisposable000: true,
      hashManifestRel: HASH_MANIFEST_REL,
    },
    hashManifest: {
      ok: hashCheck.ok,
      mismatches: hashCheck.mismatches,
      verifiedBeforeConnection: true,
    },
    resume: {
      resumeFrom: flags.resumeFrom,
      ledgerExists: applyLedger.exists,
      ledgerPath: APPLY_LEDGER_REL,
      policyOk: resumePolicy.ok,
      policyReasons: resumePolicy.reasons,
      startNumber: resumePolicy.startNumber,
      requireEmptyProof: resumePolicy.requireEmptyProof,
    },
    hashes: [],
    artifacts: [],
    excludedReferenceScan: { reminders: 0, executableHits: [] },
    secretScan: { findings: [] },
    nextApplyAdapterNotes: [],
    laterSequenceNotRun: [
      'DB migrations (enumerated allowlist)',
      'Verification',
      'Storage buckets and RLS',
      'Clean tenant baseline',
      'Approved acceptance templates (3)',
      'SA/Admin/FE Auth',
      'Profile records and roles',
      'Controlled project/vendor/task seed (no disposable synthetics)',
      'Physical HTTP/iPerf re-upload',
      'Full E2E (pins 6.009 / 34.474 / 53.565 / GPS 44/0)',
    ],
    verdict: null,
  }

  const blockers = []
  if (!gates.ok) blockers.push(...gates.reasons.map((r) => `gate: ${r}`))
  if (!plan.ok) blockers.push(...plan.reasons.map((r) => `allowlist: ${r}`))
  if (files.missing.length) blockers.push(`missing files: ${files.missing.join(', ')}`)
  if (files.leaked214InExecutable.length) {
    blockers.push(`214 leaked into executable paths: ${files.leaked214InExecutable.join(', ')}`)
  }
  if (!files.quarantineOk) blockers.push('214 quarantine files missing under never-run/214')
  if (!hashCheck.ok) blockers.push(...hashCheck.mismatches.map((m) => `hash: ${m}`))
  if (wantExecute && !sqlApproved) blockers.push('--execute is refused while SQL approval is no')
  if (requireSqlApprovalNo && sqlApproved) blockers.push('SQL approval is yes — this dry-run pass requires it to remain no')

  const historicalAbs = path.join(cwd, HISTORICAL_DISPOSABLE_BOOTSTRAP_FORWARD)
  if (!fs.existsSync(historicalAbs)) {
    blockers.push('historical disposable 000 is missing — do not delete it')
  } else {
    const historical = fs.readFileSync(historicalAbs, 'utf8')
    if (!historical.includes("current_setting('app.f10c2_disposable_confirmed'")) {
      blockers.push('historical disposable 000 marker assert missing — do not modify that file')
    }
    if (PERMANENT_STAGING_FORWARD_PATHS.includes(HISTORICAL_DISPOSABLE_BOOTSTRAP_FORWARD)) {
      blockers.push('historical disposable 000 must not be in the staging allowlist')
    }
  }

  const numberSet = new Set()
  for (const entry of plan.entries) {
    if (numberSet.has(entry.number)) blockers.push(`duplicate number ${entry.number}`)
    numberSet.add(entry.number)
    if (NEVER_EXECUTE_NUMBERS.includes(entry.number)) {
      blockers.push(`never-run number in allowlist: ${entry.number}`)
    }
    if (entry.applyAdapterNote) ledger.nextApplyAdapterNotes.push(`${entry.number}: ${entry.applyAdapterNote}`)

    const forwardAbs = path.join(cwd, entry.forwardPath)
    const verifyAbs = path.join(cwd, entry.verificationPath)
    const rollbackAbs = path.join(cwd, entry.rollbackPath)
    const forwardExists = fs.existsSync(forwardAbs)
    const verifyExists = fs.existsSync(verifyAbs)
    const rollbackExists = fs.existsSync(rollbackAbs)
    if (!forwardExists) blockers.push(`missing forward ${entry.forwardPath}`)
    if (!verifyExists) blockers.push(`missing verification ${entry.verificationPath}`)
    if (!rollbackExists) blockers.push(`missing rollback ${entry.rollbackPath}`)

    let digest = null
    let excluded = { reminders: [], executable: [] }
    let secrets = []
    if (forwardExists) {
      digest = sha256File(forwardAbs)
      const text = fs.readFileSync(forwardAbs, 'utf8')
      excluded = scanExcludedReferences(text)
      secrets = scanSecrets(text)
      ledger.excludedReferenceScan.reminders += excluded.reminders.length
      if (excluded.executable.length) {
        ledger.excludedReferenceScan.executableHits.push({
          number: entry.number,
          path: entry.forwardPath,
          hits: excluded.executable,
        })
        blockers.push(`${entry.number} has a non-comment reference to an excluded migration`)
      }
      if (secrets.length) {
        ledger.secretScan.findings.push({ number: entry.number, path: entry.forwardPath, kinds: secrets })
        blockers.push(`${entry.number} secret-scan finding: ${secrets.join(',')}`)
      }
      const bare = stripSqlComments(text)
      if (entry.stagingAdapter || entry.forwardPath === STAGING_BOOTSTRAP_FORWARD) {
        if (DISPOSABLE_SET_LOCAL_RE.test(bare)) {
          blockers.push('staging adapter must not SET LOCAL disposable marker')
        }
        if (STAGING_CONFIRMED_SET_RE.test(bare)) {
          blockers.push('staging adapter must not invent app.f10c2_staging_confirmed')
        }
        if (!bare.includes('app.f10c2_disposable_confirmed')) {
          blockers.push('staging adapter must fail closed if a disposable marker is already yes')
        }
      }
      if (bare.includes('\\i ') || bare.includes('\\ir ')) {
        blockers.push(`${entry.number} must not psql-include other files`)
      }
    }

    ledger.hashes.push({
      number: entry.number,
      slug: entry.slug,
      path: entry.forwardPath,
      sha256: digest,
      exists: forwardExists,
    })
    ledger.artifacts.push({
      number: entry.number,
      slug: entry.slug,
      forwardPath: entry.forwardPath,
      purpose: entry.purpose,
      dependencies: entry.dependencies,
      previouslyValidatedOnDisposable: entry.previouslyValidatedOnDisposable,
      disposableValidationStatus: entry.disposableValidationStatus,
      requiredOnEmptyStagingDb: entry.requiredOnEmptyStagingDb,
      verificationPath: entry.verificationPath,
      rollbackPath: entry.rollbackPath,
      expectedObjects: entry.expectedObjects,
      verificationExists: verifyExists,
      rollbackExists: rollbackExists,
      excludedCommentReminders: excluded.reminders.length,
    })
  }

  const wrapperRel = 'scripts/f10c2/applyPermanentStagingMigrations.mjs'
  const planRel = 'scripts/f10c2/permanentStagingApplyPlan.mjs'
  const assertRel = 'scripts/f10c2/assertPermanentStagingTarget.mjs'
  const hashRel = HASH_MANIFEST_REL
  for (const rel of [wrapperRel, planRel, assertRel, hashRel]) {
    const abs = path.join(cwd, rel)
    if (!fs.existsSync(abs)) {
      blockers.push(`missing script ${rel}`)
      continue
    }
    const secrets = scanSecrets(fs.readFileSync(abs, 'utf8'))
    if (secrets.length) {
      ledger.secretScan.findings.push({ path: rel, kinds: secrets })
      blockers.push(`${rel} secret-scan finding: ${secrets.join(',')}`)
    }
  }

  const quarantineForward = path.join(cwd, NEVER_RUN_214_PATHS.forward)
  const executable214 = path.join(cwd, 'supabase/drafts/f10c2/phase4b/forward/214_cr1b_acceptance_applicability.sql')
  ledger.allowlist.quarantine214Exists = fs.existsSync(quarantineForward)
  ledger.allowlist.executable214Absent = !fs.existsSync(executable214)

  const uniqueBlockers = [...new Set(blockers)]
  const ok = uniqueBlockers.length === 0 && sqlSent === false
  ledger.blockers = uniqueBlockers
  ledger.verdict = ok
    ? 'CR1-E PERMANENT STAGING APPLY PACKAGE READY — EXACT MIGRATION ALLOWLIST VERIFIED — WAITING FOR EXPLICIT SQL EXECUTION APPROVAL — PRODUCTION UNTOUCHED'
    : `STOPPED SAFELY: ${uniqueBlockers[0]}`

  if (options.writeLedger !== false) {
    ledger.hashManifestPath = writeAudit('cr1e-permanent-staging-pre-apply-hash-manifest.json', {
      dated: ledger.dated,
      algorithm: 'sha256',
      count: ledger.hashes.length,
      numbers: ledger.hashes.map((h) => h.number),
      hashes: ledger.hashes,
      neverExecuteNumbers: ledger.allowlist.neverExecuteNumbers,
      sqlSent: false,
      git: ledger.gates.git,
    })
    ledger.ledgerPath = writeAudit('cr1e-permanent-staging-pre-apply-dry-run-ledger.json', ledger)
  }

  return {
    ok,
    sqlSent,
    authCreated,
    bucketsCreated,
    seedCreated,
    ledger,
    gates,
    plan,
    hashCheck,
  }
}

/**
 * Execute path (not used while SQL approval is no).
 * Order: hash verify → target verify → empty REST proof (before first migration) → apply hashed bytes.
 * Never rewrites SQL. Stops on first error. Never auto-rollback / Auth / seed / upload.
 */
export async function runPermanentStagingExecute(options = {}) {
  const cwd = options.cwd || ROOT
  const argv = options.argv || process.argv.slice(2)
  const flags = parseCliFlags(argv)
  const loaded = options.env
    ? { fileExists: true, env: options.env }
    : loadPermanentStagingEnvMerged(cwd)
  const env = loaded.env
  const sqlApproved = sqlExecutionApprovedIsYes(env.F10C2_PERMANENT_STAGING_SQL_EXECUTION_APPROVED)
  const prepared = runPermanentStagingDryRun({
    ...options,
    argv: flags.resumeFrom ? ['--resume-from', flags.resumeFrom] : [],
    requireSqlApprovalNo: false,
    writeLedger: false,
  })
  const blockers = []
  if (!flags.wantExecute) blockers.push('execute requires --execute')
  if (!sqlApproved) blockers.push('execute requires F10C2_PERMANENT_STAGING_SQL_EXECUTION_APPROVED=yes')
  if (!prepared.hashCheck?.ok) blockers.push('hash verification failed before connection — SQL not sent')
  if (!prepared.gates.ok) blockers.push(...prepared.gates.reasons.map((r) => `gate: ${r}`))
  if (!prepared.plan.ok) blockers.push(...prepared.plan.reasons.map((r) => `allowlist: ${r}`))

  const applyLedger = loadApplyLedger(cwd)
  const numbers = prepared.plan.entries.map((e) => e.number)
  const resume = evaluateResumePolicy({
    ledger: applyLedger,
    resumeFrom: flags.resumeFrom,
    numbers,
  })
  if (!resume.ok) blockers.push(...resume.reasons.map((r) => `resume: ${r}`))

  let emptyProof = { performed: false, ok: false, skipped: true, sqlSent: false }
  if (blockers.length === 0 && resume.requireEmptyProof) {
    if (typeof options.emptyDbProof === 'function') {
      emptyProof = await options.emptyDbProof()
    } else {
      emptyProof = {
        performed: false,
        ok: false,
        skipped: true,
        sqlSent: false,
        note: 'empty REST proof required before first migration',
      }
      blockers.push('execute requires empty-database REST proof before first migration (no SQL)')
    }
    if (emptyProof?.presentTables?.length) {
      blockers.push(`BabyDragon tables exist: ${emptyProof.presentTables.join(', ')} — SQL not sent`)
    }
    if (emptyProof && emptyProof.ok !== true) {
      blockers.push('empty-database proof failed — SQL not sent')
    }
  }

  if (blockers.length) {
    return {
      ok: false,
      sqlSent: false,
      authCreated: false,
      bucketsCreated: false,
      seedCreated: false,
      autoRollback: false,
      blockers: [...new Set(blockers)],
      emptyProof,
      resume,
      executeReady: false,
    }
  }

  if (typeof options.sqlSender !== 'function') {
    return {
      ok: false,
      sqlSent: false,
      authCreated: false,
      bucketsCreated: false,
      seedCreated: false,
      autoRollback: false,
      blockers: ['SQL sender is not attached — refusing to apply (no silent SQL, no file rewrite)'],
      emptyProof,
      resume,
      executeReady: true,
    }
  }

  const startIdx = prepared.plan.entries.findIndex((e) => e.number === resume.startNumber)
  const pending = prepared.plan.entries.slice(startIdx < 0 ? 0 : startIdx)
  const appliedNow = []
  for (const entry of pending) {
    const expected = (prepared.hashCheck.actual || prepared.ledger.hashes).find((h) => h.path === entry.forwardPath)
    const abs = path.join(cwd, entry.forwardPath)
    const digest = sha256File(abs)
    if (!expected?.sha256 || digest !== expected.sha256) {
      return {
        ok: false,
        sqlSent: appliedNow.length > 0,
        authCreated: false,
        bucketsCreated: false,
        seedCreated: false,
        autoRollback: false,
        blockers: [`hash mismatch immediately before send for ${entry.number} — stopped; no auto-rollback`],
        emptyProof,
        resume,
        appliedNow,
      }
    }
    const bytes = fs.readFileSync(abs)
    try {
      await options.sqlSender({ number: entry.number, path: entry.forwardPath, bytes, sha256: digest })
    } catch {
      return {
        ok: false,
        sqlSent: appliedNow.length > 0,
        authCreated: false,
        bucketsCreated: false,
        seedCreated: false,
        autoRollback: false,
        blockers: [`apply stopped on ${entry.number} — no auto-rollback`],
        emptyProof,
        resume,
        appliedNow,
      }
    }
    appliedNow.push({ number: entry.number, path: entry.forwardPath, sha256: digest, verified: false })
  }

  return {
    ok: true,
    sqlSent: true,
    authCreated: false,
    bucketsCreated: false,
    seedCreated: false,
    autoRollback: false,
    blockers: [],
    emptyProof,
    resume,
    appliedNow,
  }
}

function main() {
  const result = runPermanentStagingDryRun({ cwd: ROOT, argv: process.argv.slice(2) })
  const { ledger } = result
  console.log('CR1-E permanent-staging wrapper (fail-closed; no secrets printed)')
  console.log(`- project name expected: ${AUTHORIZED_STAGING_PROJECT_NAME}`)
  console.log(`- API host expected: ${AUTHORIZED_STAGING_API_HOST}`)
  console.log(`- pooler user expected: ${AUTHORIZED_STAGING_POOLER_USER}`)
  console.log(`- confirmed: ${ledger.gates.flags.confirmed || '(missing)'}`)
  console.log(`- not production: ${ledger.gates.flags.notProduction || '(missing)'}`)
  console.log(`- connection method: ${ledger.gates.flags.connectionMethod}`)
  console.log(`- SQL execution approved: ${ledger.gates.flags.sqlExecutionApproved}`)
  console.log(`- git branch match: ${ledger.gates.git.ok ? 'yes' : 'NO'}`)
  console.log(`- allowlist count: ${ledger.allowlist.count}`)
  console.log(`- allowlist numbers: ${ledger.allowlist.numbers.join(', ')}`)
  console.log(`- never-run excluded: ${ledger.allowlist.neverExecuteNumbers.join(', ')}`)
  console.log(`- every allowlisted file exists: ${ledger.allowlist.missing.length === 0 ? 'yes' : 'NO'}`)
  console.log(`- hashes recorded: ${ledger.hashes.filter((h) => h.sha256).length}`)
  console.log(`- hash manifest match: ${ledger.hashManifest?.ok ? 'yes' : 'NO'}`)
  console.log(`- staging adapter: ${ledger.allowlist.stagingBootstrapPath}`)
  console.log(`- 214 quarantine only: ${ledger.allowlist.quarantine214Exists && ledger.allowlist.executable214Absent ? 'yes' : 'NO'}`)
  console.log(`- excluded executable refs: ${ledger.excludedReferenceScan.executableHits.length}`)
  console.log(`- secret findings: ${ledger.secretScan.findings.length}`)
  console.log(`- SQL sent: ${ledger.sqlSent ? 'YES' : 'no'}`)
  console.log(`- Auth/buckets/seed created: no`)
  console.log(`- empty-DB live check: skipped (REST-only gate on execute, before first migration)`)
  console.log(`- auto-rollback: no`)
  console.log(`- auto-cleanup: no`)
  console.log(`- SQL rewrite: no`)
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

if (process.argv[1] && path.normalize(process.argv[1]) === path.normalize(__filename)) {
  try {
    main()
  } catch (error) {
    console.error('STOPPED SAFELY: wrapper failed before SQL (message redacted)')
    process.exitCode = 2
  }
}
