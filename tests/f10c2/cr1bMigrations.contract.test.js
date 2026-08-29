/**
 * F10C2 CR1-B — static migration/contract checks. No database connection.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  CR1B_APPLY,
  listExistingDisposableCr1bApply,
  listPhase4bApplyPlan,
  PHASE4A_NEVER_EXECUTE,
} from '../../scripts/f10c2/phase4bApplyPlan.mjs'

const ROOT = process.cwd()
const FORBIDDEN = /\b(DROP\s+DATABASE|TRUNCATE|DROP\s+TABLE)\b/i

function readForward(slug) {
  return fs.readFileSync(
    path.join(ROOT, 'supabase/drafts/f10c2/phase4b/forward', `${slug}.sql`),
    'utf8',
  )
}

describe('f10c2 cr1b — migration contracts', () => {
  it('registers 210-213 after 209 and never executes 207/009/010/012/013/112', () => {
    expect(CR1B_APPLY).toEqual([
      '210_cr1b_canonical_ingestion_schema',
      '211_cr1b_acceptance_engine_schema',
      '212_cr1b_rpc_ingest_evaluate_qc',
      '213_cr1b_rls_grants',
    ])
    const slugs = listPhase4bApplyPlan().stages.map((s) => s.slug)
    expect(slugs).toContain('209_disposable_operational_profile_task_rls_remediation')
    expect(listExistingDisposableCr1bApply().map((s) => s.slug)).toEqual(CR1B_APPLY)
    for (const denied of ['207_rls_tenant_storage_assumptions', '009_rls_profiles', '010_rls_tasks', '012_rls_task_checklist_items', '013_rls_task_issue_reports', '112_result_artifacts_storage_contract']) {
      expect(CR1B_APPLY).not.toContain(denied)
      expect(listExistingDisposableCr1bApply().some((s) => s.slug === denied)).toBe(false)
    }
    expect(PHASE4A_NEVER_EXECUTE).toEqual(['207_rls_tenant_storage_assumptions'])
    expect(slugs).not.toContain('214_cr1b_acceptance_applicability')
  })

  it('keeps CR1-B forward SQL free of destructive rewrite, production refs, and service-role assignment', () => {
    for (const slug of CR1B_APPLY) {
      const text = readForward(slug)
      expect(FORBIDDEN.test(text)).toBe(false)
      expect(text).not.toMatch(/\bnsne[a-z0-9]{4,}\b/i)
      expect(text).not.toMatch(/cxyqggmepiphyejvceum/)
      expect(text).not.toMatch(/service_role\s*=\s*['"][^'"]+/)
      expect(text).not.toMatch(/GRANT\s+.*\s+TO\s+(PUBLIC|anon)/i)
      expect(fs.existsSync(path.join(ROOT, 'supabase/drafts/f10c2/phase4b/verification', `${slug}.sql`))).toBe(true)
      expect(fs.existsSync(path.join(ROOT, 'supabase/drafts/f10c2/phase4b/rollback', `${slug}.sql`))).toBe(true)
    }
  })

  it('creates preferred acceptance tables and immutable snapshot uniqueness', () => {
    const schema = readForward('211_cr1b_acceptance_engine_schema')
    for (const table of [
      'acceptance_profiles',
      'acceptance_rules',
      'field_test_run_acceptance_snapshots',
      'field_test_iteration_evaluations',
      'field_test_call_summaries',
      'qc_verdict_overrides',
    ]) {
      expect(schema).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`)
    }
    expect(schema).toContain('field_test_run_acceptance_snapshots_run_unique')
    expect(readForward('210_cr1b_canonical_ingestion_schema')).toContain('field_test_iterations')
    expect(readForward('212_cr1b_rpc_ingest_evaluate_qc')).toContain('idempotency_key_reuse')
    expect(readForward('212_cr1b_rpc_ingest_evaluate_qc')).toContain('ambiguous_profile_resolution')
    expect(readForward('213_cr1b_rls_grants')).toContain('ENABLE ROW LEVEL SECURITY')
  })
})
