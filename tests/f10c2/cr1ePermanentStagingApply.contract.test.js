/**
 * CR1-E permanent-staging apply-package contracts. No database connection.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, it, expect } from 'vitest'
import {
  EXPECTED_ALLOWLIST_NUMBERS,
  HASH_MANIFEST_REL,
  HISTORICAL_DISPOSABLE_BOOTSTRAP_FORWARD,
  NEVER_EXECUTE_NUMBERS,
  NEVER_EXECUTE_SLUGS,
  PERMANENT_STAGING_FORWARD_PATHS,
  STAGING_BOOTSTRAP_FORWARD,
  assertAllowlistHashesMatch,
  listPermanentStagingAllowlist,
  assertPermanentStagingPlanFilesExist,
} from '../../scripts/f10c2/permanentStagingApplyPlan.mjs'
import {
  APPLY_LEDGER_REL,
  evaluateResumePolicy,
  isCompleteVerifiedAllowlist,
  loadApplyLedger,
  parseCliFlags,
  runPermanentStagingDryRun,
  runPermanentStagingExecute,
  validateApplyLedgerSnapshot,
} from '../../scripts/f10c2/applyPermanentStagingMigrations.mjs'
import {
  AUTHORIZED_STAGING_PROJECT_NAME,
  AUTHORIZED_STAGING_PROJECT_REF,
  REQUIRED_GIT_BRANCH,
  evaluatePermanentStagingGitGate,
} from '../../scripts/f10c2/assertPermanentStagingTarget.mjs'

const ROOT = process.cwd()
const EXCLUDED = ['009', '010', '012', '013', '112', '207', '214']
const PRE_APPLY_LEDGER = { exists: false, applied: [] }
const FIXTURE_HEAD = 'a'.repeat(40)

function fixtureGit(overrides = {}) {
  return {
    ok: true,
    branch: REQUIRED_GIT_BRANCH,
    head: FIXTURE_HEAD,
    remoteHead: FIXTURE_HEAD,
    staged: false,
    packageDirty: [],
    packageUntracked: [],
    ...overrides,
  }
}

function fixtureEnv(overrides = {}) {
  return {
    BABYDRAGON_STAGING_PROJECT_NAME: AUTHORIZED_STAGING_PROJECT_NAME,
    BABYDRAGON_STAGING_PROJECT_REF: AUTHORIZED_STAGING_PROJECT_REF,
    BABYDRAGON_STAGING_SUPABASE_URL: `https://${AUTHORIZED_STAGING_PROJECT_REF}.supabase.co`,
    BABYDRAGON_STAGING_DATABASE_URL: `postgresql://postgres.${AUTHORIZED_STAGING_PROJECT_REF}@example.pooler.supabase.com:5432/postgres`,
    F10C2_PERMANENT_STAGING_CONFIRMED: 'yes',
    F10C2_PERMANENT_STAGING_NOT_PRODUCTION: 'yes',
    F10C2_PERMANENT_STAGING_CONNECTION_METHOD: 'session-pooler',
    F10C2_PERMANENT_STAGING_SQL_EXECUTION_APPROVED: 'no',
    ...overrides,
  }
}

describe('f10c2 cr1-e — permanent staging apply allowlist', () => {
  it('is an explicit enumerated path list with no ranges, duplicates, or never-run numbers', () => {
    const plan = listPermanentStagingAllowlist()
    expect(plan.ok).toBe(true)
    expect(plan.reasons).toEqual([])
    expect(PERMANENT_STAGING_FORWARD_PATHS[0]).toBe(STAGING_BOOTSTRAP_FORWARD)
    expect(PERMANENT_STAGING_FORWARD_PATHS).not.toContain(HISTORICAL_DISPOSABLE_BOOTSTRAP_FORWARD)
    expect(PERMANENT_STAGING_FORWARD_PATHS).toHaveLength(45)
    expect(plan.entries).toHaveLength(45)
    expect(plan.entries.map((e) => e.number)).toEqual([...EXPECTED_ALLOWLIST_NUMBERS])
    expect(PERMANENT_STAGING_FORWARD_PATHS.some((p) => /[*?]|…|\.\.\.|[–—]/.test(p))).toBe(false)
    expect(new Set(PERMANENT_STAGING_FORWARD_PATHS).size).toBe(PERMANENT_STAGING_FORWARD_PATHS.length)
    for (const n of EXCLUDED) {
      expect(EXPECTED_ALLOWLIST_NUMBERS).not.toContain(n)
      expect(NEVER_EXECUTE_NUMBERS).toContain(n)
    }
    for (const slug of NEVER_EXECUTE_SLUGS) {
      expect(plan.entries.map((e) => e.slug)).not.toContain(slug)
    }
    const files = assertPermanentStagingPlanFilesExist(ROOT)
    expect(files.missing).toEqual([])
    expect(files.leaked214InExecutable).toEqual([])
    expect(files.quarantineOk).toBe(true)
    expect(fs.existsSync(path.join(ROOT, 'supabase/drafts/f10c2/never-run/214/214_cr1b_acceptance_applicability.forward.sql'))).toBe(true)
    expect(fs.existsSync(path.join(ROOT, 'supabase/drafts/f10c2/phase4b/forward/214_cr1b_acceptance_applicability.sql'))).toBe(false)
  })

  it('names every migration path individually and keeps dependencies inside the allowlist', () => {
    const plan = listPermanentStagingAllowlist()
    const numbers = new Set(plan.entries.map((e) => e.number))
    for (const entry of plan.entries) {
      expect(entry.forwardPath).toMatch(/\.sql$/)
      expect(entry.verificationPath).toBeTruthy()
      expect(entry.rollbackPath).toBeTruthy()
      expect(entry.purpose.length).toBeGreaterThan(8)
      expect(entry.requiredOnEmptyStagingDb).toBe(true)
      if (entry.number === '000') {
        expect(entry.previouslyValidatedOnDisposable).toBe(false)
        expect(entry.stagingAdapter).toBe(true)
        expect(entry.forwardPath).toBe(STAGING_BOOTSTRAP_FORWARD)
      } else {
        expect(entry.previouslyValidatedOnDisposable).toBe(true)
        expect(entry.stagingAdapter).toBe(false)
      }
      for (const dep of entry.dependencies) {
        expect(numbers.has(dep)).toBe(true)
        expect(EXCLUDED).not.toContain(dep)
      }
    }
    expect(plan.entries.at(-3).number).toBe('213')
    expect(plan.entries.at(-2).number).toBe('215')
    expect(plan.entries.at(-1).number).toBe('216')
    expect(plan.entries.find((e) => e.number === '214')).toBeUndefined()
  })

  it('dry-run mode records hashes, sends no SQL, and refuses --execute while approval is no', () => {
    const result = runPermanentStagingDryRun({
      cwd: ROOT,
      env: fixtureEnv(),
      argv: [],
      writeLedger: false,
      git: fixtureGit(),
    })
    expect(result.ok).toBe(true)
    expect(result.sqlSent).toBe(false)
    expect(result.authCreated).toBe(false)
    expect(result.bucketsCreated).toBe(false)
    expect(result.seedCreated).toBe(false)
    expect(result.ledger.hashes).toHaveLength(45)
    expect(result.ledger.hashes.every((h) => typeof h.sha256 === 'string' && h.sha256.length === 64)).toBe(true)
    expect(result.ledger.excludedReferenceScan.executableHits).toEqual([])
    expect(result.ledger.secretScan.findings).toEqual([])
    expect(result.ledger.hashManifest.ok).toBe(true)
    expect(result.ledger.nextApplyAdapterNotes).toEqual([])
    expect(result.ledger.allowlist.adapterReplacesDisposable000).toBe(true)
    expect(result.ledger.verdict).toContain('WAITING FOR EXPLICIT SQL EXECUTION APPROVAL')

    const executeDenied = runPermanentStagingDryRun({
      cwd: ROOT,
      env: fixtureEnv(),
      argv: ['--execute'],
      writeLedger: false,
      git: fixtureGit(),
    })
    expect(executeDenied.sqlSent).toBe(false)
    expect(executeDenied.ok).toBe(false)
    expect(executeDenied.ledger.blockers.some((b) => b.includes('--execute'))).toBe(true)

    const source = fs.readFileSync(path.join(ROOT, 'scripts/f10c2/applyPermanentStagingMigrations.mjs'), 'utf8')
    expect(source).not.toMatch(/from ['"]pg['"]/)
    expect(source).not.toMatch(/spawnSync\(\s*['"]psql['"]/)
    expect(source).toContain('sqlSent')
    expect(source).toContain("mode: 'dry-run'")
    expect(source).toContain('SQL_REWRITE_FORBIDDEN')
    expect(source).toContain('--resume-from')
  })

  it('replaces disposable 000 with a staging adapter that omits the disposable marker', () => {
    const adapter = fs.readFileSync(path.join(ROOT, STAGING_BOOTSTRAP_FORWARD), 'utf8')
    const historical = fs.readFileSync(path.join(ROOT, HISTORICAL_DISPOSABLE_BOOTSTRAP_FORWARD), 'utf8')
    const adapterBare = adapter.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
    expect(historical).toContain("current_setting('app.f10c2_disposable_confirmed'")
    expect(historical).toContain('DISPOSABLE ONLY')
    expect(adapterBare).not.toMatch(/\bSET\s+LOCAL\s+app\.f10c2_disposable_confirmed\b/i)
    expect(adapterBare).not.toMatch(/\bSET\s+LOCAL\s+app\.f10c2_staging_confirmed\b/i)
    expect(adapterBare).toContain("current_setting('app.f10c2_disposable_confirmed'")
    expect(adapterBare).toMatch(/IS NOT DISTINCT FROM 'yes'/)
    expect(adapterBare).toMatch(/CREATE TABLE IF NOT EXISTS public\.profiles/)
    expect(adapterBare).toMatch(/CREATE EXTENSION IF NOT EXISTS pgcrypto/)
    expect(adapter).toContain('DISPOSABLE ONLY')
    expect(fs.existsSync(path.join(ROOT, HASH_MANIFEST_REL))).toBe(true)
    const hashes = assertAllowlistHashesMatch(ROOT)
    expect(hashes.ok).toBe(true)
    expect(hashes.mismatches).toEqual([])
    expect(hashes.actual[0].path).toBe(STAGING_BOOTSTRAP_FORWARD)
  })

  it('resume policy refuses later-already-applied and requires verified predecessors', () => {
    expect(parseCliFlags(['--resume-from', '001']).resumeFrom).toBe('001')
    const numbers = [...EXPECTED_ALLOWLIST_NUMBERS]
    const laterApplied = evaluateResumePolicy({
      ledger: { applied: [{ number: '000', verified: true }, { number: '002', verified: true }] },
      resumeFrom: '001',
      numbers,
    })
    expect(laterApplied.ok).toBe(false)
    const unverifiedPrev = evaluateResumePolicy({
      ledger: { applied: [{ number: '000', verified: false }] },
      resumeFrom: '001',
      numbers,
    })
    expect(unverifiedPrev.ok).toBe(false)
    const fresh = evaluateResumePolicy({ ledger: { applied: [] }, resumeFrom: null, numbers })
    expect(fresh.ok).toBe(true)
    expect(fresh.requireEmptyProof).toBe(true)
    expect(fresh.complete).toBe(false)
    const partialNoFlag = evaluateResumePolicy({
      ledger: { applied: [{ number: '000', verified: true }] },
      resumeFrom: null,
      numbers,
    })
    expect(partialNoFlag.ok).toBe(false)
    expect(partialNoFlag.reasons.some((r) => r.includes('partial apply ledger'))).toBe(true)
    const completeRows = numbers.map((n) => ({ number: n, path: `${n}.sql`, sha256: 'a'.repeat(64), verified: true }))
    const complete = evaluateResumePolicy({
      ledger: { exists: true, applied: completeRows },
      resumeFrom: null,
      numbers,
    })
    expect(isCompleteVerifiedAllowlist({ applied: completeRows }, numbers)).toBe(true)
    expect(complete.ok).toBe(false)
    expect(complete.requireEmptyProof).toBe(false)
    expect(complete.complete).toBe(true)
    expect(complete.reasons.some((r) => r.includes('all 45 verified'))).toBe(true)
  })

  it('execute path refuses SQL without approval, empty proof, or a sender', async () => {
    const denied = await runPermanentStagingExecute({
      cwd: ROOT,
      env: fixtureEnv(),
      argv: ['--execute'],
      writeLedger: false,
      applyLedger: PRE_APPLY_LEDGER,
      git: fixtureGit(),
    })
    expect(denied.sqlSent).toBe(false)
    expect(denied.ok).toBe(false)
    expect(denied.blockers.some((b) => b.includes('SQL_EXECUTION_APPROVED'))).toBe(true)

    const tablesPresent = await runPermanentStagingExecute({
      cwd: ROOT,
      env: fixtureEnv({ F10C2_PERMANENT_STAGING_SQL_EXECUTION_APPROVED: 'yes' }),
      argv: ['--execute'],
      writeLedger: false,
      applyLedger: PRE_APPLY_LEDGER,
      git: fixtureGit(),
      emptyDbProof: async () => ({ ok: false, performed: true, presentTables: ['profiles'] }),
      sqlSender: async () => {
        throw new Error('sql sender must not run')
      },
    })
    expect(tablesPresent.sqlSent).toBe(false)
    expect(tablesPresent.ok).toBe(false)
    expect(tablesPresent.blockers.some((b) => b.includes('profiles'))).toBe(true)

    const noSender = await runPermanentStagingExecute({
      cwd: ROOT,
      env: fixtureEnv({ F10C2_PERMANENT_STAGING_SQL_EXECUTION_APPROVED: 'yes' }),
      argv: ['--execute'],
      writeLedger: false,
      applyLedger: PRE_APPLY_LEDGER,
      git: fixtureGit(),
      emptyDbProof: async () => ({ ok: true, performed: true, presentTables: [] }),
    })
    expect(noSender.sqlSent).toBe(false)
    expect(noSender.executeReady).toBe(true)
    expect(noSender.blockers.some((b) => b.includes('SQL sender'))).toBe(true)
  })

  it('wrapper CLI dry-run exits 0 and prints SQL sent: no', () => {
    const spawned = spawnSync(process.execPath, ['scripts/f10c2/applyPermanentStagingMigrations.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env },
    })
    expect(spawned.status).toBe(0)
    expect(spawned.stdout).toContain('SQL sent: no')
    expect(spawned.stdout).toContain('Auth/buckets/seed created: no')
    expect(spawned.stdout).toContain('WAITING FOR EXPLICIT SQL EXECUTION APPROVAL')
    expect(spawned.stdout).not.toMatch(/postgres(?:ql)?:\/\/[^\s:]+:[^\s@]+@/)
    expect(spawned.stdout).not.toMatch(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)
  })

  it('uses a SHA-free git-gate: branch, remote-tracking, staged, and package files', () => {
    const assertSrc = fs.readFileSync(path.join(ROOT, 'scripts/f10c2/assertPermanentStagingTarget.mjs'), 'utf8')
    const wrapperSrc = fs.readFileSync(path.join(ROOT, 'scripts/f10c2/applyPermanentStagingMigrations.mjs'), 'utf8')
    expect(assertSrc).not.toMatch(/REQUIRED_GIT_HEAD/)
    expect(assertSrc).not.toMatch(/cd0f623e/)
    expect(assertSrc).not.toMatch(/00fbce27/)
    expect(wrapperSrc).not.toMatch(/REQUIRED_GIT_HEAD/)
    expect(wrapperSrc).not.toMatch(/cd0f623e/)
    expect(wrapperSrc).not.toMatch(/00fbce27/)

    const diverged = evaluatePermanentStagingGitGate({
      git: fixtureGit({ remoteHead: 'b'.repeat(40) }),
    })
    expect(diverged.ok).toBe(false)
    expect(diverged.reasons.some((r) => r.includes('remote-tracking'))).toBe(true)

    const staged = evaluatePermanentStagingGitGate({ git: fixtureGit({ staged: true }) })
    expect(staged.ok).toBe(false)
    expect(staged.reasons.some((r) => r.includes('staged'))).toBe(true)

    const dirtyPackage = evaluatePermanentStagingGitGate({
      git: fixtureGit({ packageDirty: ['scripts/f10c2/permanentStagingAllowlist.hashes.json'] }),
      requirePackageClean: true,
    })
    expect(dirtyPackage.ok).toBe(false)
    expect(dirtyPackage.reasons.some((r) => r.includes('dirty'))).toBe(true)

    const unrelatedOk = evaluatePermanentStagingGitGate({
      git: fixtureGit(),
      requirePackageClean: true,
    })
    expect(unrelatedOk.ok).toBe(true)

    const shaMismatch = evaluatePermanentStagingGitGate({
      git: fixtureGit(),
      approvedGitSha: 'c'.repeat(40),
    })
    expect(shaMismatch.ok).toBe(false)
    expect(shaMismatch.reasons.some((r) => r.includes('APPROVED_GIT_SHA'))).toBe(true)

    const shaMatch = evaluatePermanentStagingGitGate({
      git: fixtureGit(),
      approvedGitSha: FIXTURE_HEAD,
    })
    expect(shaMatch.ok).toBe(true)

    const stale = runPermanentStagingDryRun({
      cwd: ROOT,
      env: fixtureEnv(),
      argv: [],
      writeLedger: false,
      applyLedger: PRE_APPLY_LEDGER,
      git: fixtureGit({ remoteHead: 'b'.repeat(40) }),
    })
    expect(stale.ok).toBe(false)
    expect(stale.sqlSent).toBe(false)
    expect(stale.ledger.blockers.some((b) => b.includes('remote-tracking'))).toBe(true)
    expect(stale.ledger.gates.git.requiredHead).toBeUndefined()
  })

  it('accepts both pre-apply (ledger absent) and post-apply (45 verified) ledger states without deleting the gitignored file', () => {
    const numbers = [...EXPECTED_ALLOWLIST_NUMBERS]
    const hashes = assertAllowlistHashesMatch(ROOT)
    expect(hashes.ok).toBe(true)
    const hashesByPath = Object.fromEntries((hashes.actual || []).map((h) => [h.path, h.sha256]))
    const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')
    expect(gitignore).toMatch(/^\.permanent-staging-apply-ledger\.json\s*$/m)

    const pre = evaluateResumePolicy({ ledger: PRE_APPLY_LEDGER, resumeFrom: null, numbers })
    expect(pre.ok).toBe(true)
    expect(pre.requireEmptyProof).toBe(true)
    expect(validateApplyLedgerSnapshot(PRE_APPLY_LEDGER).ok).toBe(false)
    expect(validateApplyLedgerSnapshot(PRE_APPLY_LEDGER).state).toBe('absent')

    const syntheticComplete = {
      exists: true,
      targetRef: AUTHORIZED_STAGING_PROJECT_REF,
      targetName: AUTHORIZED_STAGING_PROJECT_NAME,
      applied: (hashes.actual || []).map((h) => ({
        number: h.number,
        path: h.path,
        sha256: h.sha256,
        verified: true,
      })),
    }
    const post = evaluateResumePolicy({ ledger: syntheticComplete, resumeFrom: null, numbers })
    expect(post.ok).toBe(false)
    expect(post.complete).toBe(true)
    expect(post.requireEmptyProof).toBe(false)
    const validated = validateApplyLedgerSnapshot(syntheticComplete, { numbers, hashesByPath })
    expect(validated.ok).toBe(true)
    expect(validated.state).toBe('complete')
    expect(validated.appliedCount).toBe(45)
    expect(validated.verifiedCount).toBe(45)

    const local = loadApplyLedger(ROOT)
    if (local.exists) {
      const live = validateApplyLedgerSnapshot(local, { numbers, hashesByPath })
      expect(live.ok).toBe(true)
      expect(live.state).toBe('complete')
      expect(local.targetRef).toBe(AUTHORIZED_STAGING_PROJECT_REF)
      expect(local.targetName).toBe(AUTHORIZED_STAGING_PROJECT_NAME)
      expect(fs.existsSync(path.join(ROOT, APPLY_LEDGER_REL))).toBe(true)
    }
  })
})
