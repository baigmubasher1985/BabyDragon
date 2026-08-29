/**
 * CR1-E-R1 217-only hashed runner contracts. No database connection.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, it, expect } from 'vitest'
import {
  AUTHORIZED_STAGING_PROJECT_NAME,
  AUTHORIZED_STAGING_PROJECT_REF,
  DENIED_DISPOSABLE_PROJECT_REF,
  DENIED_PRODUCTION_REF_PREFIX,
  REQUIRED_GIT_BRANCH,
} from '../../scripts/f10c2/assertPermanentStagingTarget.mjs'
import {
  EXPECTED_ALLOWLIST_NUMBERS,
  PERMANENT_STAGING_FORWARD_PATHS,
  assertAllowlistHashesMatch,
} from '../../scripts/f10c2/permanentStagingApplyPlan.mjs'
import {
  APPLY_LEDGER_217_REL,
  EXECUTION_PACKAGE_217,
  HASH_MANIFEST_217_REL,
  MIGRATION_217_FORWARD,
  MIGRATION_217_ROLLBACK,
  MIGRATION_217_VERIFY,
  assert217HashesMatch,
  is217AlreadyVerified,
  parseCliFlags,
  runPermanentStaging217DryRun,
  runPermanentStaging217Execute,
} from '../../scripts/f10c2/applyPermanentStaging217.mjs'

const ROOT = process.cwd()
const FIXTURE_HEAD = 'a'.repeat(40)
const COMPLETE_45 = (() => {
  const hashes = assertAllowlistHashesMatch(ROOT)
  return {
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
})()

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
    F10C2_PERMANENT_STAGING_217_EXECUTION_APPROVED: 'no',
    ...overrides,
  }
}

function dryRun(overrides = {}) {
  return runPermanentStaging217DryRun({
    cwd: ROOT,
    env: fixtureEnv(),
    argv: [],
    writeLedger: false,
    applyLedger: COMPLETE_45,
    applyLedger217: { exists: false, applied: null },
    git: fixtureGit(),
    ...overrides,
  })
}

describe('f10c2 cr1-e-r1 — 217-only hashed runner', () => {
  it('dry run sends no SQL and records the reviewed 217 hashes', () => {
    const result = dryRun()
    expect(result.ok).toBe(true)
    expect(result.sqlSent).toBe(false)
    expect(result.authCreated).toBe(false)
    expect(result.seedCreated).toBe(false)
    expect(result.autoRollback).toBe(false)
    expect(result.autoCleanup).toBe(false)
    expect(result.ledger.hashes).toHaveLength(3)
    expect(result.ledger.hashManifest.ok).toBe(true)
    expect(result.ledger.fortyFiveSqlFlagIgnored).toBe(true)
    expect(PERMANENT_STAGING_FORWARD_PATHS).not.toContain(MIGRATION_217_FORWARD)
    expect(result.ledger.verdict).toContain('WAITING FOR EXPLICIT 217 APPROVAL')
  })

  it('missing dedicated approval refuses execution even if the 45-path flag is yes', async () => {
    const denied = await runPermanentStaging217Execute({
      cwd: ROOT,
      env: fixtureEnv({
        F10C2_PERMANENT_STAGING_217_EXECUTION_APPROVED: 'no',
        F10C2_PERMANENT_STAGING_SQL_EXECUTION_APPROVED: 'yes',
      }),
      argv: ['--execute'],
      writeLedger: false,
      applyLedger: COMPLETE_45,
      applyLedger217: { exists: false, applied: null },
      git: fixtureGit(),
      sqlSender: async () => {
        throw new Error('sql sender must not run')
      },
    })
    expect(denied.sqlSent).toBe(false)
    expect(denied.ok).toBe(false)
    expect(denied.blockers.some((b) => b.includes('217_EXECUTION_APPROVED'))).toBe(true)
    expect(denied.blockers.some((b) => b.includes('45-path SQL approval does not authorize'))).toBe(true)
  })

  it('missing --execute refuses execution when 217 approval is yes', async () => {
    expect(parseCliFlags([]).wantExecute).toBe(false)
    const denied = await runPermanentStaging217Execute({
      cwd: ROOT,
      env: fixtureEnv({ F10C2_PERMANENT_STAGING_217_EXECUTION_APPROVED: 'yes' }),
      argv: [],
      writeLedger: false,
      applyLedger: COMPLETE_45,
      applyLedger217: { exists: false, applied: null },
      git: fixtureGit(),
      sqlSender: async () => {
        throw new Error('sql sender must not run')
      },
    })
    expect(denied.sqlSent).toBe(false)
    expect(denied.blockers.some((b) => b.includes('--execute'))).toBe(true)
  })

  it('wrong project or ref refuses', () => {
    const wrongName = dryRun({
      env: fixtureEnv({ BABYDRAGON_STAGING_PROJECT_NAME: 'not-authorized' }),
    })
    expect(wrongName.ok).toBe(false)
    expect(wrongName.sqlSent).toBe(false)
    expect(wrongName.ledger.blockers.some((b) => b.includes('project name'))).toBe(true)

    const wrongRef = dryRun({
      env: fixtureEnv({ BABYDRAGON_STAGING_PROJECT_REF: 'zzzzzzzzzzzzzzzzzzzz' }),
    })
    expect(wrongRef.ok).toBe(false)
    expect(wrongRef.sqlSent).toBe(false)
  })

  it('production and disposable targets refuse', () => {
    const production = dryRun({
      env: fixtureEnv({
        BABYDRAGON_STAGING_SUPABASE_URL: `https://${DENIED_PRODUCTION_REF_PREFIX}example.supabase.co`,
      }),
    })
    expect(production.ok).toBe(false)
    expect(production.sqlSent).toBe(false)
    expect(production.ledger.blockers.some((b) => b.includes('production prefix'))).toBe(true)

    const disposable = dryRun({
      env: fixtureEnv({
        BABYDRAGON_STAGING_SUPABASE_URL: `https://${DENIED_DISPOSABLE_PROJECT_REF}.supabase.co`,
      }),
    })
    expect(disposable.ok).toBe(false)
    expect(disposable.sqlSent).toBe(false)
    expect(disposable.ledger.blockers.some((b) => b.includes('disposable'))).toBe(true)
  })

  it('incomplete 45-ledger refuses', () => {
    const incomplete = dryRun({
      applyLedger: {
        exists: true,
        targetRef: AUTHORIZED_STAGING_PROJECT_REF,
        targetName: AUTHORIZED_STAGING_PROJECT_NAME,
        applied: COMPLETE_45.applied.slice(0, 10),
      },
    })
    expect(incomplete.ok).toBe(false)
    expect(incomplete.sqlSent).toBe(false)
    expect(incomplete.ledger.blockers.some((b) => b.includes('45-ledger') || b.includes('45-path'))).toBe(true)
    expect(EXPECTED_ALLOWLIST_NUMBERS).toHaveLength(45)
  })

  it('hash mismatch refuses', () => {
    const mismatched = dryRun({
      hashCheck: {
        ok: false,
        mismatches: ['hash mismatch 217 forward'],
        actual: [],
      },
    })
    expect(mismatched.ok).toBe(false)
    expect(mismatched.sqlSent).toBe(false)
    expect(mismatched.ledger.blockers.some((b) => b.includes('hash'))).toBe(true)
    const live = assert217HashesMatch(ROOT)
    expect(live.ok).toBe(true)
    expect(live.actual.map((h) => h.role)).toEqual(['forward', 'verification', 'rollback'])
  })

  it('already-applied 217 refuses reapplication', async () => {
    const applied = {
      exists: true,
      targetRef: AUTHORIZED_STAGING_PROJECT_REF,
      targetName: AUTHORIZED_STAGING_PROJECT_NAME,
      applied: {
        number: '217',
        path: MIGRATION_217_FORWARD,
        sha256: 'd'.repeat(64),
        verified: true,
      },
    }
    expect(is217AlreadyVerified(applied)).toBe(true)
    const dry = dryRun({ applyLedger217: applied })
    expect(dry.ok).toBe(false)
    expect(dry.sqlSent).toBe(false)
    expect(dry.ledger.blockers.some((b) => b.includes('already applied'))).toBe(true)

    const exec = await runPermanentStaging217Execute({
      cwd: ROOT,
      env: fixtureEnv({ F10C2_PERMANENT_STAGING_217_EXECUTION_APPROVED: 'yes' }),
      argv: ['--execute'],
      writeLedger: false,
      applyLedger: COMPLETE_45,
      applyLedger217: applied,
      git: fixtureGit(),
      sqlSender: async () => {
        throw new Error('sql sender must not run')
      },
    })
    expect(exec.sqlSent).toBe(false)
    expect(exec.blockers.some((b) => b.includes('already applied'))).toBe(true)
  })

  it('only 217 forward can execute, then verification must pass', async () => {
    const sent = []
    const ok = await runPermanentStaging217Execute({
      cwd: ROOT,
      env: fixtureEnv({ F10C2_PERMANENT_STAGING_217_EXECUTION_APPROVED: 'yes' }),
      argv: ['--execute'],
      writeLedger: false,
      applyLedger: COMPLETE_45,
      applyLedger217: { exists: false, applied: null },
      git: fixtureGit(),
      sqlSender: async (payload) => {
        sent.push(payload)
      },
    })
    expect(ok.ok).toBe(true)
    expect(ok.sqlSent).toBe(true)
    expect(sent.map((s) => s.role)).toEqual(['forward', 'verification'])
    expect(sent[0].path).toBe(MIGRATION_217_FORWARD)
    expect(sent[1].path).toBe(MIGRATION_217_VERIFY)
    expect(sent.some((s) => s.path === MIGRATION_217_ROLLBACK)).toBe(false)
    expect(sent.every((s) => s.number === '217')).toBe(true)

    const verifyFail = await runPermanentStaging217Execute({
      cwd: ROOT,
      env: fixtureEnv({ F10C2_PERMANENT_STAGING_217_EXECUTION_APPROVED: 'yes' }),
      argv: ['--execute'],
      writeLedger: false,
      applyLedger: COMPLETE_45,
      applyLedger217: { exists: false, applied: null },
      git: fixtureGit(),
      sqlSender: async (payload) => {
        if (payload.role === 'verification') throw new Error('verify failed')
      },
    })
    expect(verifyFail.ok).toBe(false)
    expect(verifyFail.blockers.some((b) => b.includes('verification failed'))).toBe(true)
    expect(verifyFail.autoRollback).toBe(false)
    expect(verifyFail.sent.some((s) => s.role === 'rollback')).toBe(false)
  })

  it('rollback never auto-runs and Auth/seed/upload functions are never invoked', async () => {
    const source = fs.readFileSync(path.join(ROOT, 'scripts/f10c2/applyPermanentStaging217.mjs'), 'utf8')
    expect(source).not.toMatch(/createUser|createAuth|auth\.admin/)
    expect(source).not.toMatch(/seedBaseline|seedSynthetic|uploadPackage|syncNow/)
    expect(source).toContain('AUTO_ROLLBACK = false')
    expect(source).toContain('AUTH_CREATED = false')
    expect(source).toContain('SEED_CREATED = false')
    expect(source).not.toMatch(/from ['"]pg['"]/)
    expect(source).not.toMatch(/spawnSync\(\s*['"]psql['"]/)
    expect(source).toContain(SQL_217_FLAG_NAME())

    const sent = []
    const result = await runPermanentStaging217Execute({
      cwd: ROOT,
      env: fixtureEnv({ F10C2_PERMANENT_STAGING_217_EXECUTION_APPROVED: 'yes' }),
      argv: ['--execute'],
      writeLedger: false,
      applyLedger: COMPLETE_45,
      applyLedger217: { exists: false, applied: null },
      git: fixtureGit(),
      sqlSender: async (payload) => {
        sent.push(payload.role)
        if (payload.role === 'forward') throw new Error('forward failed')
      },
    })
    expect(result.ok).toBe(false)
    expect(result.autoRollback).toBe(false)
    expect(result.autoCleanup).toBe(false)
    expect(result.authCreated).toBe(false)
    expect(result.seedCreated).toBe(false)
    expect(sent).toEqual(['forward'])
    expect(fs.existsSync(path.join(ROOT, APPLY_LEDGER_217_REL))).toBe(false)
    expect(EXECUTION_PACKAGE_217).toContain(HASH_MANIFEST_217_REL)
  })

  it('CLI dry-run exits 0 and prints SQL sent: no', () => {
    const spawned = spawnSync(process.execPath, ['scripts/f10c2/applyPermanentStaging217.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env },
    })
    expect(spawned.status).toBe(0)
    expect(spawned.stdout).toContain('SQL sent: no')
    expect(spawned.stdout).toContain('Auth/seed/upload created: no')
    expect(spawned.stdout).toContain('WAITING FOR EXPLICIT 217 APPROVAL')
    expect(spawned.stdout).not.toMatch(/postgres(?:ql)?:\/\/[^\s:]+:[^\s@]+@/)
    expect(spawned.stdout).not.toMatch(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)
  })
})

function SQL_217_FLAG_NAME() {
  return 'F10C2_PERMANENT_STAGING_217_EXECUTION_APPROVED'
}
