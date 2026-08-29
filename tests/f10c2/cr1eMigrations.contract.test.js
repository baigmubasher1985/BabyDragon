/**
 * F10C2 CR1-E — static 216 migration/contract checks. No database connection.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  CR1B_APPLY,
  CR1D_APPLY,
  CR1D_DRAFT_ONLY,
  CR1E_APPLY,
  CR1E_DRAFT_ONLY,
  CR1_NEVER_RUN,
  listExistingDisposableCr1eApply,
  listPhase4bApplyPlan,
} from '../../scripts/f10c2/phase4bApplyPlan.mjs'

const ROOT = process.cwd()
const FORBIDDEN = /\b(DROP\s+DATABASE|TRUNCATE|DROP\s+TABLE)\b/i
const SLUG = '216_cr1e_acceptance_profile_status'

function readForward() {
  return fs.readFileSync(
    path.join(ROOT, 'supabase/drafts/f10c2/phase4b/forward', `${SLUG}.sql`),
    'utf8',
  )
}

describe('f10c2 cr1-e — migration 216 contracts', () => {
  it('registers 216 as CR1E_APPLY one-shot and never auto-applies it', () => {
    expect(CR1E_APPLY).toEqual([SLUG])
    expect(CR1E_DRAFT_ONLY).toEqual([])
    expect(listExistingDisposableCr1eApply().map((s) => s.slug)).toEqual(CR1E_APPLY)
    expect(CR1D_DRAFT_ONLY).toEqual([])
    expect(CR1_NEVER_RUN).toEqual(['214_cr1b_acceptance_applicability'])
    expect(CR1D_APPLY).toEqual(['215_cr1d_acceptance_profile_management'])
    expect(CR1B_APPLY).not.toContain(SLUG)
    expect(CR1D_APPLY).not.toContain(SLUG)
    expect(CR1D_DRAFT_ONLY).not.toContain(SLUG)
    const slugs = listPhase4bApplyPlan().stages.map((s) => s.slug)
    expect(slugs).toHaveLength(43)
    expect(slugs).not.toContain(SLUG)
    expect(slugs).not.toContain('214_cr1b_acceptance_applicability')
    expect(slugs).not.toContain('215_cr1d_acceptance_profile_management')
    expect(slugs.at(-1)).toBe('213_cr1b_rls_grants')
    expect(fs.existsSync(path.join(ROOT, 'supabase/drafts/f10c2/phase4b/forward/214_cr1b_acceptance_applicability.sql'))).toBe(false)
    expect(fs.existsSync(path.join(ROOT, 'supabase/drafts/f10c2/never-run/214/README.md'))).toBe(true)
    expect(CR1_NEVER_RUN).not.toContain(SLUG)
  })

  it('keeps 216 additive: SECURITY DEFINER RPC, no client UPDATE policy, no snapshot rewrite', () => {
    const text = readForward()
    expect(FORBIDDEN.test(text)).toBe(false)
    expect(text).not.toMatch(/\bnsne[a-z0-9]{4,}\b/i)
    expect(text).not.toMatch(/service_role\s*=\s*['"][^'"]+/)
    expect(text).toContain('CR1E_APPLY')
    expect(text).toContain('one-shot on authorized disposable')
    expect(text).toContain('set_acceptance_profile_active')
    expect(text).toContain('SECURITY DEFINER')
    expect(text).toContain("'admin', 'super_admin'")
    expect(text).toContain('forbidden_not_admin')
    expect(text).toContain('forbidden_cross_tenant')
    expect(text).toContain('not_authenticated')
    expect(text).toContain('status_update_failed')
    expect(text).toContain('security_audit_log')
    expect(text).toContain('REVOKE ALL ON FUNCTION public.set_acceptance_profile_active')
    expect(text).toContain('FROM anon')
    expect(text).toContain('GRANT EXECUTE ON FUNCTION public.set_acceptance_profile_active')
    expect(text).toContain('TO authenticated')
    expect(text).not.toMatch(/CREATE POLICY[\s\S]{0,80}FOR UPDATE[\s\S]{0,80}acceptance_profiles/i)
    expect(text).not.toMatch(/UPDATE\s+public\.field_test_run_acceptance_snapshots/i)
    expect(text).not.toMatch(/DELETE\s+FROM\s+public\.acceptance_profiles/i)
    expect(text).not.toMatch(/DELETE\s+FROM\s+public\.field_test_runs/i)
    expect(fs.existsSync(path.join(ROOT, 'supabase/drafts/f10c2/phase4b/verification', `${SLUG}.sql`))).toBe(true)
    const verify = fs.readFileSync(
      path.join(ROOT, 'supabase/drafts/f10c2/phase4b/verification', `${SLUG}.sql`),
      'utf8',
    )
    expect(verify).toContain('to_regprocedure')
    expect(verify).toContain('has_function_privilege')
    expect(fs.existsSync(path.join(ROOT, 'supabase/drafts/f10c2/phase4b/rollback', `${SLUG}.sql`))).toBe(true)
    const rollback = fs.readFileSync(
      path.join(ROOT, 'supabase/drafts/f10c2/phase4b/rollback', `${SLUG}.sql`),
      'utf8',
    )
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.set_acceptance_profile_active')
    expect(rollback).not.toMatch(/UPDATE\s+public\.field_test_run_acceptance_snapshots/i)
  })
})
