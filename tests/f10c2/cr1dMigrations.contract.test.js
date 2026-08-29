/**
 * F10C2 CR1-D — static 215 migration/contract checks. No database connection.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  CR1B_APPLY,
  CR1D_APPLY,
  CR1D_DRAFT_ONLY,
  CR1_NEVER_RUN,
  CR1_NEVER_RUN_DIR,
  CR1_CANONICAL_APPLY_AFTER_209,
  listExistingDisposableCr1dApply,
  listPhase4bApplyPlan,
  assertNo214InApplyList,
} from '../../scripts/f10c2/phase4bApplyPlan.mjs'

const ROOT = process.cwd()
const FORBIDDEN = /\b(DROP\s+DATABASE|TRUNCATE|DROP\s+TABLE)\b/i

function readForward(slug) {
  return fs.readFileSync(
    path.join(ROOT, 'supabase/drafts/f10c2/phase4b/forward', `${slug}.sql`),
    'utf8',
  )
}

describe('f10c2 cr1d — migration 215 contracts', () => {
  it('registers 215 as CR1D_APPLY only and quarantines 214 as never-run', () => {
    expect(CR1D_APPLY).toEqual(['215_cr1d_acceptance_profile_management'])
    expect(CR1D_DRAFT_ONLY).toEqual([])
    expect(CR1_NEVER_RUN).toEqual(['214_cr1b_acceptance_applicability'])
    expect(listExistingDisposableCr1dApply().map((s) => s.slug)).toEqual(CR1D_APPLY)
    expect(CR1B_APPLY).not.toContain('215_cr1d_acceptance_profile_management')
    expect(CR1B_APPLY).not.toContain('214_cr1b_acceptance_applicability')
    expect(CR1D_APPLY).not.toContain('214_cr1b_acceptance_applicability')
    const slugs = listPhase4bApplyPlan().stages.map((s) => s.slug)
    expect(slugs).toHaveLength(43)
    expect(slugs).not.toContain('215_cr1d_acceptance_profile_management')
    expect(slugs).not.toContain('214_cr1b_acceptance_applicability')
    expect(slugs.at(-1)).toBe('213_cr1b_rls_grants')
    expect(CR1_CANONICAL_APPLY_AFTER_209).toEqual([
      '210_cr1b_canonical_ingestion_schema',
      '211_cr1b_acceptance_engine_schema',
      '212_cr1b_rpc_ingest_evaluate_qc',
      '213_cr1b_rls_grants',
      '215_cr1d_acceptance_profile_management',
      '216_cr1e_acceptance_profile_status',
    ])
    expect(fs.existsSync(path.join(ROOT, 'supabase/drafts/f10c2/phase4b/forward/214_cr1b_acceptance_applicability.sql'))).toBe(false)
    expect(fs.existsSync(path.join(ROOT, 'supabase/drafts/f10c2/phase4b/verification/214_cr1b_acceptance_applicability.sql'))).toBe(false)
    expect(fs.existsSync(path.join(ROOT, 'supabase/drafts/f10c2/phase4b/rollback/214_cr1b_acceptance_applicability.sql'))).toBe(false)
    expect(fs.existsSync(path.join(ROOT, CR1_NEVER_RUN_DIR, 'README.md'))).toBe(true)
    expect(fs.existsSync(path.join(ROOT, CR1_NEVER_RUN_DIR, '214_cr1b_acceptance_applicability.forward.sql'))).toBe(true)
    expect(fs.existsSync(path.join(ROOT, CR1_NEVER_RUN_DIR, '214_cr1b_acceptance_applicability.verification.sql'))).toBe(true)
    expect(fs.existsSync(path.join(ROOT, CR1_NEVER_RUN_DIR, '214_cr1b_acceptance_applicability.rollback.sql'))).toBe(true)
    expect(() => assertNo214InApplyList(CR1B_APPLY, 'CR1B_APPLY')).not.toThrow()
    expect(() => assertNo214InApplyList(['214_cr1b_acceptance_applicability'], 'test')).toThrow(/SQL 214 leaked/)
  })

  it('keeps 215 additive: unique scenario indexes, no snapshot rewrite, no denied refs', () => {
    const text = readForward('215_cr1d_acceptance_profile_management')
    expect(FORBIDDEN.test(text)).toBe(false)
    expect(text).not.toMatch(/\bnsne[a-z0-9]{4,}\b/i)
    expect(text).not.toMatch(/cxyqggmepiphyejvceum/)
    expect(text).not.toMatch(/service_role\s*=\s*['"][^'"]+/)
    expect(text).toContain('ADD COLUMN IF NOT EXISTS description')
    expect(text).toContain('ADD COLUMN IF NOT EXISTS scenario_family')
    expect(text).toContain('acceptance_profiles_one_active_scope_scenario')
    expect(text).toContain('acceptance_profiles_one_tenant_default_scenario')
    expect(text).toContain('COALESCE(scenario_family, \'\')')
    expect(text).not.toMatch(/UPDATE\s+public\.field_test_run_acceptance_snapshots/i)
    expect(text).not.toMatch(/DELETE\s+FROM\s+public\.field_test_runs/i)
    expect(fs.existsSync(path.join(ROOT, 'supabase/drafts/f10c2/phase4b/verification/215_cr1d_acceptance_profile_management.sql'))).toBe(true)
    expect(fs.existsSync(path.join(ROOT, 'supabase/drafts/f10c2/phase4b/rollback/215_cr1d_acceptance_profile_management.sql'))).toBe(true)
  })
})
