/**
 * F10C2 CR1-E — profile-status RPC auth, resolver fallback, UI provider (no live SQL).
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  resolveAcceptanceProfile,
  inactiveAssignmentMessage,
} from '../../src/acceptance/profileResolution.js'
import { evaluateFieldTestRun } from '../../src/acceptance/evaluateRun.js'
import { canMutateAcceptanceProfile } from '../../src/acceptance/permissions.js'
import { createMockAcceptanceProfilesProvider } from '../../src/acceptance/profiles/mockAcceptanceProfilesProvider.js'
import { createSupabaseAcceptanceProfilesProvider } from '../../src/acceptance/profiles/supabaseAcceptanceProfilesProvider.js'
import {
  currentCriteriaName,
  deactivateAssignmentWarning,
  previewDeactivateImpact,
  REPLACE_INACTIVE_ASSIGNMENT_COPY,
  sanitizeProfileStatusError,
} from '../../src/acceptance/simpleRuleUx.js'
import { VERDICTS } from '../../src/acceptance/verdicts.js'

const ROOT = process.cwd()
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

const tenant = {
  id: 'p-tenant', scope_type: 'tenant', tenant_id: 't1', is_default: true, is_active: true, version: 1,
  name: 'Standard Data', rules: { min_dl_mbps: 10, min_ul_mbps: 1, enabled_directions: ['dl', 'ul'] },
}
const project = {
  id: 'p-proj', scope_type: 'project', scope_id: 'proj-1', tenant_id: 't1', is_active: true, version: 1,
  name: 'Project Data', rules: { min_dl_mbps: 50, min_ul_mbps: 10, enabled_directions: ['dl', 'ul'] },
}
const taskInactive = {
  id: 'p-task-e2e', scope_type: 'task', scope_id: 'task-open-1', tenant_id: 't1',
  is_active: false, version: 1, name: 'Temporary E2E Data', cloned_from_id: 'lib-e2e',
  rules: { min_dl_mbps: 20, min_ul_mbps: 5, enabled_directions: ['dl', 'ul'] },
}

function fakeSupabase({ rpcImpl, fromImpl } = {}) {
  const calls = { rpc: [], from: [] }
  return {
    calls,
    rpc: async (name, args) => {
      calls.rpc.push({ name, args })
      if (rpcImpl) return rpcImpl(name, args)
      return { data: { ok: true, profile_id: args.p_profile_id, is_active: args.p_is_active, unchanged: false }, error: null }
    },
    from(table) {
      calls.from.push(table)
      if (fromImpl) return fromImpl(table)
      return {
        select: () => ({
          order: async () => ({ data: [], error: null }),
          in: async () => ({ data: [], error: null }),
          eq: () => ({
            eq: () => ({ limit: async () => ({ data: [], error: null }) }),
            limit: async () => ({ data: [], error: null }),
          }),
        }),
        update: () => ({ eq: async () => ({ error: { message: 'should_not_client_update' } }) }),
      }
    },
  }
}

describe('f10c2 cr1-e — profile status RPC, resolver fallback, provider', () => {
  const forward = read('supabase/drafts/f10c2/phase4b/forward/216_cr1e_acceptance_profile_status.sql')
  const page = read('src/acceptance/components/AcceptanceCriteriaPage.jsx')
  const providerSrc = read('src/acceptance/profiles/supabaseAcceptanceProfilesProvider.js')

  it('denies FE and anonymous; allows admin and super_admin', () => {
    expect(canMutateAcceptanceProfile('admin')).toBe(true)
    expect(canMutateAcceptanceProfile('super_admin')).toBe(true)
    expect(canMutateAcceptanceProfile('fe')).toBe(false)
    expect(canMutateAcceptanceProfile('anonymous')).toBe(false)
    expect(canMutateAcceptanceProfile('')).toBe(false)
    expect(forward).toContain("v_role NOT IN ('admin', 'super_admin')")
    expect(forward).toContain("'forbidden_not_admin'")
    expect(forward).toContain("'not_authenticated'")
  })

  it('denies cross-tenant mutation in the draft RPC', () => {
    expect(forward).toContain('forbidden_cross_tenant')
    expect(forward).toContain('v_row.tenant_id IS DISTINCT FROM v_actor_tenant')
    expect(sanitizeProfileStatusError('forbidden_cross_tenant')).toBe('That rule belongs to another organization.')
    expect(sanitizeProfileStatusError('permission denied for table acceptance_profiles')).toBe(
      'Rule status could not be changed. Try again.',
    )
    expect(sanitizeProfileStatusError('anon key leaked in error')).toBe(
      'Rule status could not be changed. Try again.',
    )
  })

  it('keeps completed-run snapshots when the live profile is later deactivated', () => {
    const first = evaluateFieldTestRun({
      run: { task_id: 'task-open-1', project_id: 'proj-1', tenant_id: 't1', scenario_type: 'iperf3' },
      iterations: [{ iteration_number: 1, status: 'completed', dl_mbps: 90, ul_mbps: 12 }],
      profiles: [{ ...taskInactive, is_active: true }, project, tenant],
    })
    expect(first.snapshot.overall_verdict).toBe(VERDICTS.PASS)
    expect(first.snapshot.profile_id).toBe('p-task-e2e')
    const second = evaluateFieldTestRun({
      run: { task_id: 'task-open-1', project_id: 'proj-1', tenant_id: 't1', scenario_type: 'iperf3' },
      iterations: [{ iteration_number: 1, status: 'completed', dl_mbps: 1, ul_mbps: 1 }],
      profiles: [taskInactive, project, tenant],
      existingSnapshot: first.snapshot,
    })
    expect(second.idempotent).toBe(true)
    expect(second.snapshot.profile_id).toBe('p-task-e2e')
    expect(second.snapshot.overall_verdict).toBe(VERDICTS.PASS)
  })

  it('falls back to the next active criterion and does not resolve the inactive assignment for new runs', () => {
    const resolved = resolveAcceptanceProfile({
      taskId: 'task-open-1',
      projectId: 'proj-1',
      tenantId: 't1',
      scenarioType: 'iperf3',
      profiles: [taskInactive, project, tenant],
    })
    expect(resolved.profile.id).toBe('p-proj')
    expect(resolved.inactiveAssigned.id).toBe('p-task-e2e')
    expect(resolved.message).toBe(inactiveAssignmentMessage(resolved.profile))
    expect(resolved.message).toBe('Assigned criterion is inactive; effective criterion is Project Data.')
    const current = currentCriteriaName(
      { id: 'task-open-1', project_id: 'proj-1', tenant_id: 't1', testing_type: 'iperf3' },
      [taskInactive, project, tenant],
      { id: 'proj-1', tenant_id: 't1' },
    )
    expect(current.inactiveAssigned).toBe(true)
    expect(current.assignedName).toBe('Temporary E2E Data')
    expect(current.warning).toBe('Assigned criterion is inactive; effective criterion is Project Data.')
    expect(current.replacePromptCopy).toBe(REPLACE_INACTIVE_ASSIGNMENT_COPY)
    expect(page).toContain('Assigned criterion:')
    expect(page).toContain('Effective criterion:')
    expect(page).toContain('current.assignedName')
    const fresh = evaluateFieldTestRun({
      run: { task_id: 'task-open-1', project_id: 'proj-1', tenant_id: 't1', scenario_type: 'iperf3' },
      iterations: [{ iteration_number: 1, status: 'completed', dl_mbps: 90, ul_mbps: 12 }],
      profiles: [taskInactive, project, tenant],
    })
    expect(fresh.snapshot.profile_id).toBe('p-proj')
  })

  it('warns before deactivation when active assignments exist', () => {
    const library = { id: 'lib-e2e', name: 'Temporary E2E Data', scope_type: 'project', is_active: true }
    const assigned = {
      id: 'asg-1', scope_type: 'task', scope_id: 'task-open-1', name: 'Temporary E2E Data',
      cloned_from_id: 'lib-e2e', is_active: true,
    }
    const impact = previewDeactivateImpact(library, [library, assigned])
    expect(impact.requiresConfirm).toBe(true)
    expect(impact.assignedCount).toBe(1)
    expect(impact.warning).toMatch(/assigned to 1 open task/)
    expect(deactivateAssignmentWarning(2)).toMatch(/2 open task/)
    expect(page).toContain('previewDeactivateImpact')
    expect(page).toContain('REPLACE_INACTIVE_ASSIGNMENT_COPY')
  })

  it('wires the live provider to set_acceptance_profile_active and never client-UPDATEs status', async () => {
    expect(providerSrc).toContain('set_acceptance_profile_active')
    const setActiveFn = providerSrc.slice(providerSrc.indexOf('async setActive'), providerSrc.indexOf('async assignToTasks'))
    expect(setActiveFn).toContain('rpc("set_acceptance_profile_active"')
    expect(setActiveFn).not.toMatch(/from\("acceptance_profiles"\)/)
    const client = fakeSupabase()
    const live = createSupabaseAcceptanceProfilesProvider({ supabase: client })
    const denied = await live.setActive('profile-1', false, { role: 'fe' })
    expect(denied.ok).toBe(false)
    expect(denied.code).toBe('forbidden_role')
    expect(client.calls.rpc).toHaveLength(0)
    const anon = await live.setActive('profile-1', false, { role: 'anonymous' })
    expect(anon.ok).toBe(false)
    const ok = await live.setActive('profile-1', false, { role: 'admin' })
    expect(ok.ok).toBe(true)
    expect(client.calls.rpc[0].name).toBe('set_acceptance_profile_active')
    expect(client.calls.rpc[0].args.p_profile_id).toBe('profile-1')
    expect(client.calls.rpc[0].args.p_is_active).toBe(false)
    const cross = fakeSupabase({
      rpcImpl: async () => ({ data: { ok: false, code: 'forbidden_cross_tenant' }, error: null }),
    })
    const liveCross = createSupabaseAcceptanceProfilesProvider({ supabase: cross })
    const crossRes = await liveCross.setActive('other-tenant-profile', false, { role: 'admin' })
    expect(crossRes.ok).toBe(false)
    expect(crossRes.code).toBe('forbidden_cross_tenant')
    expect(crossRes.message).toBe('That rule belongs to another organization.')
  })

  it('is idempotent in mock setActive and deactivates pointing task assignments', async () => {
    const mock = createMockAcceptanceProfilesProvider()
    const listed = await mock.listProfiles()
    const library = listed.profiles.find((p) => p.scope_type !== 'task' && p.is_active !== false)
    expect(library).toBeTruthy()
    const first = await mock.setActive(library.id, false, { role: 'admin' })
    expect(first.ok).toBe(true)
    const second = await mock.setActive(library.id, false, { role: 'admin' })
    expect(second.ok).toBe(true)
    expect(second.unchanged).toBe(true)
    const fe = await mock.setActive(library.id, true, { role: 'fe' })
    expect(fe.ok).toBe(false)
    expect(fe.code).toBe('forbidden_role')
  })
})
