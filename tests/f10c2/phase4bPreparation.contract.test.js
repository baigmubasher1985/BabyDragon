import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  listPhase4bApplyPlan,
  assertPhase4bPlanFilesExist,
  F10C1I_SKIP,
  F10C2_SKIP,
  PHASE4A_APPLY,
  PHASE4A_NEVER_EXECUTE,
  PHASE4B_R1_APPLY,
  PHASE4B_U_R1_APPLY,
} from '../../scripts/f10c2/phase4bApplyPlan.mjs'
import { listApplyPlan } from '../../scripts/f10c2/applyDisposableMigrations.mjs'
import {
  evaluatePhase4bTarget,
  EXPECTED_DISPOSABLE_PROJECT_NAME,
  AUTHORIZED_DISPOSABLE_PROJECT_REF,
  AUTHORIZED_DISPOSABLE_API_HOST,
} from '../../src/lib/phase4bTargetGuard.js'

const ROOT = process.cwd()

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

describe('f10c2 phase4b-p — preparation package', () => {
  it('lists 39 executable drafts starting with bootstrap 000, ending with 209, and never includes 207, 009, 010, 012, 013, or 112', () => {
    const plan = listPhase4bApplyPlan()
    const slugs = plan.stages.map((s) => s.slug)
    expect(plan.stages).toHaveLength(39)
    expect(slugs[0]).toBe('000_disposable_operational_schema')
    expect(plan.stages[0].stage).toBe('operational-bootstrap')
    expect(slugs).not.toContain('207_rls_tenant_storage_assumptions')
    expect(slugs).not.toContain('009_rls_profiles')
    expect(slugs).not.toContain('010_rls_tasks')
    expect(slugs).not.toContain('012_rls_task_checklist_items')
    expect(slugs).not.toContain('013_rls_task_issue_reports')
    expect(slugs).not.toContain('112_result_artifacts_storage_contract')
    expect(PHASE4A_APPLY).toEqual([
      '201_tenants',
      '202_storage_connections',
      '203_tenant_storage_policies',
      '204_field_test_artifacts_tenant_columns',
      '205_artifact_transfer_jobs',
      '206_rpc_request_artifact_upload_plan',
    ])
    expect(PHASE4A_NEVER_EXECUTE).toEqual(['207_rls_tenant_storage_assumptions'])
    expect(PHASE4B_R1_APPLY).toEqual(['208_phase4b_validation_remediation'])
    expect(PHASE4B_U_R1_APPLY).toEqual(['209_disposable_operational_profile_task_rls_remediation'])
    expect(slugs.at(-2)).toBe('208_phase4b_validation_remediation')
    expect(slugs.at(-1)).toBe('209_disposable_operational_profile_task_rls_remediation')
    expect(F10C1I_SKIP.join(',')).toContain('009_rls_profiles')
    expect(F10C2_SKIP).toEqual(['112_result_artifacts_storage_contract'])
    const files = assertPhase4bPlanFilesExist()
    expect(files.missing).toEqual([])
    expect(files.leaked207).toEqual([])
  })

  it('keeps the Phase 4 apply plan free of 201–207', () => {
    const slugs = listApplyPlan().f10c2.map((s) => s.slug)
    for (const n of [201, 202, 203, 204, 205, 206, 207]) {
      expect(slugs.some((s) => s.startsWith(`${n}_`))).toBe(false)
    }
  })

  it('rejects missing name, synthetic mode, or production import', () => {
    const result = evaluatePhase4bTarget({
      disposableUrl: 'https://dispabcd.example.invalid',
      appViteUrl: 'https://prodwxyz.example.invalid',
      confirmed: 'yes',
      explicitDisposableRef: 'dispabcd',
      projectName: 'wrong-name',
      syntheticDataMode: 'no',
      productionDataImport: 'enabled',
    })
    expect(result.ok).toBe(false)
    expect(result.reasons.join(' ')).toContain(EXPECTED_DISPOSABLE_PROJECT_NAME)
    expect(result.reasons.join(' ')).toMatch(/SYNTHETIC_DATA_MODE/)
    expect(result.reasons.join(' ')).toMatch(/PRODUCTION_DATA_IMPORT/)
  })

  it('rejects the denied production ref prefix', () => {
    const result = evaluatePhase4bTarget({
      disposableUrl: 'https://nsnezzzz.supabase.invalid',
      appViteUrl: 'https://otherhost.example.invalid',
      confirmed: 'yes',
      projectName: EXPECTED_DISPOSABLE_PROJECT_NAME,
      syntheticDataMode: 'yes',
      productionDataImport: 'disabled',
    })
    expect(result.ok).toBe(false)
    expect(result.reasons.join(' ')).toMatch(/denied production prefix/)
  })

  it('rejects a disposable DB host that matches the denied production DB host', () => {
    const result = evaluatePhase4bTarget({
      disposableUrl: 'https://dispabcd.example.invalid',
      appViteUrl: 'https://prodwxyz.example.invalid',
      confirmed: 'yes',
      explicitDisposableRef: 'dispabcd',
      projectName: EXPECTED_DISPOSABLE_PROJECT_NAME,
      syntheticDataMode: 'yes',
      productionDataImport: 'disabled',
      disposableDbUrl: 'postgresql://postgres@db.prod-host.example.invalid:5432/postgres',
      deniedProductionDbHost: 'db.prod-host.example.invalid',
    })
    expect(result.ok).toBe(false)
    expect(result.reasons.join(' ')).toMatch(/database host matches denied production/)
  })

  it('accepts a fully gated synthetic disposable identity', () => {
    const result = evaluatePhase4bTarget({
      disposableUrl: `https://${AUTHORIZED_DISPOSABLE_API_HOST}`,
      appViteUrl: 'https://prodwxyz.example.invalid',
      confirmed: 'yes',
      explicitDisposableRef: AUTHORIZED_DISPOSABLE_PROJECT_REF,
      projectName: EXPECTED_DISPOSABLE_PROJECT_NAME,
      syntheticDataMode: 'yes',
      productionDataImport: 'disabled',
      disposableDbUrl: `postgresql://postgres.${AUTHORIZED_DISPOSABLE_PROJECT_REF}:secret@aws-0-us-west-2.pooler.supabase.com:5432/postgres`,
      deniedProductionDbHost: 'db.prod-host.example.invalid',
    })
    expect(result.ok).toBe(true)
  })

  it('example env has no real secrets and no VITE_ service-role', () => {
    const text = read('.env.disposable.example')
    expect(text).toContain('F10C2_DISPOSABLE_PROJECT_NAME=babydragon-f10c2-disposable')
    expect(text).toContain('F10C2_SYNTHETIC_DATA_MODE=no')
    expect(text).toContain('F10C2_PRODUCTION_DATA_IMPORT=disabled')
    expect(text).toContain('F10C2_PHASE4B_SQL_EXECUTION_APPROVED=no')
    expect(text).toContain('F10C2_PHASE4B_BOOTSTRAP_CLEANUP_CONFIRMED=no')
    expect(text).not.toMatch(/VITE_.*SERVICE_ROLE/)
    expect(text).not.toMatch(/eyJ/)
    expect(read('.gitignore')).toContain('.env.disposable')
  })

  it('apply/cleanup scripts default to dry-run and refuse 207', () => {
    const apply = read('scripts/f10c2/applyPhase4bMigrations.mjs')
    expect(apply).toContain('DRY-RUN')
    expect(apply).toContain('207')
    expect(apply).not.toMatch(/spawnSync\(\s*['"]psql/)
    const cleanup = read('scripts/f10c2/cleanupPhase4bSynthetic.mjs')
    expect(cleanup).toContain('DRY-RUN')
    expect(cleanup).toContain('F10C2_PHASE4B_CLEANUP_CONFIRMED')
  })

  it('synthetic fixtures stay placeholder-bound and unmistakably synthetic', () => {
    const text = read('supabase/drafts/f10c2/phase4b/forward/301_synthetic_fixtures.sql')
    expect(text).toContain('__FE_USER_ID__')
    expect(text).toContain('__TASK_ID__')
    expect(text).toContain('SYNTHETIC F10C2 Lab Tenant')
    expect(text).toContain('synth-f10c2-lab')
    expect(text).toContain('89.125,179.125')
    expect(text).not.toMatch(/Josephine/)
    expect(text).not.toMatch(/nsne/)
    expect(PHASE4A_NEVER_EXECUTE.every((s) => !text.includes(s))).toBe(true)
  })

  it('207 remains documentation-only and outside the Phase 4B executable list', () => {
    const text = read(
      'supabase/drafts/f10c2/phase4a/forward/207_rls_tenant_storage_assumptions.sql',
    )
    expect(text).toContain('CLASSIFICATION: (b) blocked documentation-only')
    expect(listPhase4bApplyPlan().neverExecute).toContain('207_rls_tenant_storage_assumptions')
  })
})
