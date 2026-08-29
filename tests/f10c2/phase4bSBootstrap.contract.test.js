import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  listPhase4bApplyPlan,
  assertPhase4bPlanFilesExist,
  PHASE4A_NEVER_EXECUTE,
} from '../../scripts/f10c2/phase4bApplyPlan.mjs'
import { listApplyPlan } from '../../scripts/f10c2/applyDisposableMigrations.mjs'
import { validateOperationalBootstrapFiles } from '../../scripts/f10c2/validateOperationalBootstrap.mjs'
import {
  OPERATIONAL_TABLES_IN_DEPENDENCY_ORDER,
  FINAL_EXECUTION_ORDER,
  NEVER_EXECUTE,
  BOOTSTRAP_SLUG,
} from '../../scripts/f10c2/operationalBootstrapContract.mjs'
import {
  evaluatePhase4bSqlSessionGuard,
  buildDisposableSqlSessionPreamble,
  DISPOSABLE_SQL_MARKER_STATEMENT,
  evaluatePhase4bBootstrapCleanupGuard,
} from '../../src/lib/phase4bSqlSessionGuard.js'
import { EXPECTED_DISPOSABLE_PROJECT_NAME, AUTHORIZED_DISPOSABLE_PROJECT_REF, AUTHORIZED_DISPOSABLE_API_HOST } from '../../src/lib/phase4bTargetGuard.js'

const ROOT = process.cwd()

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

const acceptedIdentity = {
  disposableUrl: `https://${AUTHORIZED_DISPOSABLE_API_HOST}`,
  appViteUrl: 'https://prodwxyz.example.invalid',
  confirmed: 'yes',
  explicitDisposableRef: AUTHORIZED_DISPOSABLE_PROJECT_REF,
  projectName: EXPECTED_DISPOSABLE_PROJECT_NAME,
  syntheticDataMode: 'yes',
  productionDataImport: 'disabled',
  disposableDbUrl: `postgresql://postgres.${AUTHORIZED_DISPOSABLE_PROJECT_REF}:secret@aws-0-us-west-2.pooler.supabase.com:5432/postgres`,
  deniedProductionDbHost: 'db.prod-host.example.invalid',
}

describe('f10c2 phase4b-s — disposable operational bootstrap', () => {
  it('creates the bootstrap SQL trio and README under phase4b/bootstrap', () => {
    for (const rel of [
      'supabase/drafts/f10c2/phase4b/bootstrap/000_disposable_operational_schema.sql',
      'supabase/drafts/f10c2/phase4b/bootstrap/000_disposable_operational_schema.verify.sql',
      'supabase/drafts/f10c2/phase4b/bootstrap/000_disposable_operational_schema.rollback.sql',
      'supabase/drafts/f10c2/phase4b/bootstrap/README.md',
      'supabase/drafts/f10c2/phase4b/F10C2_Phase4B_Final_Execution_Order.md',
      'docs/f10c2/F10C2_Phase4B_Final_Execution_Order.md',
    ]) {
      expect(fs.existsSync(path.join(ROOT, rel))).toBe(true)
    }
  })

  it('passes local static/dependency validation and preserves app columns', () => {
    const result = validateOperationalBootstrapFiles()
    expect(result.findings).toEqual([])
    expect(result.createOrder).toEqual(OPERATIONAL_TABLES_IN_DEPENDENCY_ORDER)
    expect(result.tables).toHaveLength(14)
  })

  it('asserts the SQL marker and does not set it in the forward file', () => {
    const forward = read(
      'supabase/drafts/f10c2/phase4b/bootstrap/000_disposable_operational_schema.sql',
    )
    expect(forward).toContain('DISPOSABLE ONLY')
    expect(forward).toContain("current_setting('app.f10c2_disposable_confirmed'")
    const forwardBare = read(
      'supabase/drafts/f10c2/phase4b/bootstrap/000_disposable_operational_schema.sql',
    ).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
    expect(forwardBare).toMatch(/CREATE TABLE IF NOT EXISTS public\.profiles/)
    expect(forwardBare).toMatch(/CREATE EXTENSION IF NOT EXISTS pgcrypto/)
    expect(forwardBare).not.toMatch(/\bSET\s+LOCAL\s+app\.f10c2_disposable_confirmed\b/i)
    expect(forwardBare).not.toMatch(/\bINSERT\s+INTO\b/i)
    expect(forwardBare).not.toMatch(/\bDROP\s+TABLE\b/i)
    expect(forwardBare).not.toMatch(/\bTRUNCATE\b/i)
    expect(forwardBare).not.toMatch(/\bCASCADE\b/i)
    expect(forwardBare).not.toMatch(/\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i)
  })

  it('rollback requires a separate cleanup marker and lists every bootstrap table', () => {
    const rollback = read(
      'supabase/drafts/f10c2/phase4b/bootstrap/000_disposable_operational_schema.rollback.sql',
    )
    expect(rollback).toContain('app.f10c2_disposable_cleanup_confirmed')
    expect(rollback).toContain('app.f10c2_disposable_confirmed')
    for (const table of [...OPERATIONAL_TABLES_IN_DEPENDENCY_ORDER].reverse()) {
      expect(rollback).toContain(`DROP TABLE IF EXISTS public.${table};`)
    }
    const rollbackBare = rollback.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
    expect(rollbackBare).not.toMatch(/\bCASCADE\b/)
    expect(rollbackBare).not.toMatch(/\bTRUNCATE\b/)
  })

  it('places bootstrap 000 first and keeps 207 never-execute', () => {
    const plan = listPhase4bApplyPlan()
    expect(plan.stages[0].slug).toBe(BOOTSTRAP_SLUG)
    expect(plan.stages).toHaveLength(43)
    expect(plan.neverExecute).toEqual([...PHASE4A_NEVER_EXECUTE, '214_cr1b_acceptance_applicability'])
    expect(assertPhase4bPlanFilesExist().missing).toEqual([])
    expect(assertPhase4bPlanFilesExist().leaked207).toEqual([])
    expect(assertPhase4bPlanFilesExist().leaked214).toEqual([])
    expect(assertPhase4bPlanFilesExist().archiveMissing).toBe(false)
    const slugs = plan.stages.map((s) => s.slug)
    expect(slugs).not.toContain('207_rls_tenant_storage_assumptions')
    expect(NEVER_EXECUTE).toEqual(['207_rls_tenant_storage_assumptions'])
  })

  it('keeps Phase 4 apply plan free of bootstrap 000 and of 201–207', () => {
    const slugs = listApplyPlan().f10c2.map((s) => s.slug)
    expect(slugs).not.toContain(BOOTSTRAP_SLUG)
    for (const n of [201, 202, 203, 204, 205, 206, 207]) {
      expect(slugs.some((s) => s.startsWith(`${n}_`))).toBe(false)
    }
  })

  it('refuses SET LOCAL unless JS target guard and SQL approval both pass', () => {
    const denied = evaluatePhase4bSqlSessionGuard({
      ...acceptedIdentity,
      sqlExecutionApproved: 'no',
    })
    expect(denied.maySetSqlMarker).toBe(false)
    expect(denied.reasons.join(' ')).toMatch(/SQL_EXECUTION_APPROVED/)

    const wrongName = evaluatePhase4bSqlSessionGuard({
      ...acceptedIdentity,
      projectName: 'not-the-disposable-project',
      sqlExecutionApproved: 'yes',
    })
    expect(wrongName.maySetSqlMarker).toBe(false)

    const preamble = buildDisposableSqlSessionPreamble({
      ...acceptedIdentity,
      sqlExecutionApproved: 'yes',
    })
    expect(preamble.marker).toBe(DISPOSABLE_SQL_MARKER_STATEMENT)
    expect(preamble.transactionStart).toBe('BEGIN;')
  })

  it('cleanup marker is independent of the create marker', () => {
    const result = evaluatePhase4bBootstrapCleanupGuard({
      ...acceptedIdentity,
      sqlExecutionApproved: 'yes',
      bootstrapCleanupConfirmed: 'no',
    })
    expect(result.maySetCleanupMarker).toBe(false)
    expect(result.reasons.join(' ')).toMatch(/BOOTSTRAP_CLEANUP_CONFIRMED/)
  })

  it('documents the final 0–11 order and never-execute 207', () => {
    const text = read('docs/f10c2/F10C2_Phase4B_Final_Execution_Order.md')
    expect(FINAL_EXECUTION_ORDER).toHaveLength(12)
    expect(text).toContain('JavaScript disposable target guard')
    expect(text).toContain('Operational schema bootstrap 000')
    expect(text).toContain('001–008')
    expect(text).toContain('101–111')
    expect(text).toContain('201–206')
    expect(text).toContain('NEVER EXECUTE')
    expect(text).toContain('Stop before cleanup')
    expect(text).not.toMatch(/nsne[a-z0-9]{8}/i)
  })

  it('bootstrap and apply wrappers default to dry-run and never spawn psql', () => {
    const bootstrap = read('scripts/f10c2/bootstrapDisposableOperationalSchema.mjs')
    const apply = read('scripts/f10c2/applyPhase4bMigrations.mjs')
    expect(bootstrap).toContain('DRY-RUN')
    expect(bootstrap).toContain('Phase 4B-E')
    expect(bootstrap).not.toMatch(/spawnSync\(\s*['"]psql/)
    expect(apply).toContain('buildDisposableSqlSessionPreamble')
    expect(apply).toContain('Phase 4B-S')
    expect(apply).not.toMatch(/spawnSync\(\s*['"]psql/)
  })
})
