/**
 * F10C2 CR1-D — admin acceptance profile management (items 27–35).
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { resolveAcceptanceProfile, PROFILE_RESOLUTION_ORDER } from '../../src/acceptance/profileResolution.js'
import {
  cloneProfile,
  createNewProfileVersion,
  findAmbiguousActiveAssignments,
  isProfileVersionSnapshotted,
  previewAcceptanceCalculator,
  previewAssignmentOverride,
  RF_RULES_SUPPORTED,
} from '../../src/acceptance/profileManagement.js'
import { canMutateAcceptanceProfile } from '../../src/acceptance/permissions.js'
import { createMockAcceptanceProfilesProvider } from '../../src/acceptance/profiles/mockAcceptanceProfilesProvider.js'
import { evaluateFieldTestRun } from '../../src/acceptance/evaluateRun.js'
import { VERDICTS } from '../../src/acceptance/verdicts.js'

const ROOT = process.cwd()
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

const tenant = {
  id: 'p-tenant', scope_type: 'tenant', tenant_id: 't1', is_default: true, is_active: true, version: 1,
  name: 'tenant default', rules: { min_dl_mbps: 10, min_ul_mbps: 5, enabled_directions: ['dl', 'ul'] },
}
const tenantHttp = {
  ...tenant, id: 'p-tenant-http', scenario_family: 'native_http', is_default: true, name: 'tenant http',
  rules: { min_dl_mbps: 40, min_ul_mbps: 5, enabled_directions: ['dl', 'ul'] },
}
const project = {
  id: 'p-proj', scope_type: 'project', scope_id: 'proj-1', is_active: true, version: 1, name: 'project default',
  rules: { min_dl_mbps: 50, min_ul_mbps: 10, enabled_directions: ['dl', 'ul'] },
}
const projectIperf = {
  ...project, id: 'p-proj-iperf', scenario_family: 'iperf3', name: 'project iperf',
  rules: { min_dl_mbps: 60, min_ul_mbps: 10, enabled_directions: ['dl', 'ul'] },
}
const task = {
  id: 'p-task', scope_type: 'task', scope_id: 'task-1', is_active: true, version: 1, name: 'task default',
  rules: { min_dl_mbps: 20, min_ul_mbps: 5, enabled_directions: ['dl', 'ul'] },
}
const taskHttp = {
  ...task, id: 'p-task-http', scenario_family: 'native_http', name: 'task http',
  rules: { min_dl_mbps: 80, min_ul_mbps: 10, enabled_directions: ['dl', 'ul'] },
}

describe('f10c2 cr1-d — acceptance profiles (27-35)', () => {
  const dash = read('src/AdminDashboard.jsx')
  const page = read('src/acceptance/components/AcceptanceCriteriaPage.jsx')

  it('27. Acceptance Criteria is admin-only under Project Management', () => {
    const pm = dash.indexOf('title: "Project Management"')
    const acc = dash.indexOf('{ id: "acceptanceCriteria"')
    const ops = dash.indexOf('title: "Field Operations"')
    expect(acc).toBeGreaterThan(pm)
    expect(acc).toBeLessThan(ops)
    expect(page).toContain('admin and super_admin only')
    expect(canMutateAcceptanceProfile('admin')).toBe(true)
    expect(canMutateAcceptanceProfile('super_admin')).toBe(true)
    expect(canMutateAcceptanceProfile('fe')).toBe(false)
    expect(canMutateAcceptanceProfile('qc')).toBe(false)
  })

  it('28. resolution priority is task+scenario → task → project+scenario → project → tenant+scenario → tenant', () => {
    expect(PROFILE_RESOLUTION_ORDER).toEqual([
      'task+scenario', 'task', 'project+scenario', 'project', 'tenant+scenario', 'tenant',
    ])
    const profiles = [tenant, tenantHttp, project, projectIperf, task, taskHttp]
    expect(resolveAcceptanceProfile({
      taskId: 'task-1', projectId: 'proj-1', tenantId: 't1', scenarioType: 'native_http', profiles,
    }).profile.id).toBe('p-task-http')
    expect(resolveAcceptanceProfile({
      taskId: 'task-1', projectId: 'proj-1', tenantId: 't1', scenarioType: 'ftp', profiles,
    }).profile.id).toBe('p-task')
    expect(resolveAcceptanceProfile({
      taskId: 'other', projectId: 'proj-1', tenantId: 't1', scenarioType: 'iperf3', profiles,
    }).profile.id).toBe('p-proj-iperf')
    expect(resolveAcceptanceProfile({
      taskId: 'other', projectId: 'proj-1', tenantId: 't1', scenarioType: 'ftp', profiles,
    }).profile.id).toBe('p-proj')
    expect(resolveAcceptanceProfile({
      taskId: 'other', projectId: 'other', tenantId: 't1', scenarioType: 'native_http', profiles,
    }).profile.id).toBe('p-tenant-http')
    expect(resolveAcceptanceProfile({
      taskId: 'other', projectId: 'other', tenantId: 't1', scenarioType: 'ftp', profiles,
    }).profile.id).toBe('p-tenant')
  })

  it('29. snapshotted versions cannot be edited; create new version instead', () => {
    const profile = { id: 'p-task-http', version: 2 }
    expect(isProfileVersionSnapshotted(profile, [{ profile_id: 'p-task-http', profile_version: 2 }])).toBe(true)
    expect(isProfileVersionSnapshotted(profile, [{ profile_id: 'p-task-http', profile_version: 1 }])).toBe(false)
    expect(read('src/acceptance/profileManagement.js')).toContain('createNewProfileVersion')
    expect(read('src/acceptance/profileManagement.js')).toContain('cloneProfile')
    expect(page).toContain('Assign')
    expect(page).not.toContain('Create New Version')
    expect(page).not.toContain('onClone')
  })

  it('30. clone and create new version do not mutate the source identity in place until saved', () => {
    const cloned = cloneProfile(taskHttp)
    expect(cloned.ok).toBe(true)
    expect(cloned.profile.id).not.toBe(taskHttp.id)
    expect(cloned.profile.version).toBe(1)
    expect(cloned.profile.cloned_from_id).toBe(taskHttp.id)
    const next = createNewProfileVersion(taskHttp)
    expect(next.profile.version).toBe(2)
    expect(taskHttp.version).toBe(1)
  })

  it('31. ambiguous duplicate active assignments are rejected', () => {
    const dup = findAmbiguousActiveAssignments([taskHttp, { ...taskHttp, id: 'dup' }])
    expect(dup.length).toBe(1)
    const preview = previewAssignmentOverride({
      profiles: [taskHttp],
      taskId: 'task-1',
      scenarioType: 'native_http',
      candidate: { ...taskHttp, id: 'dup' },
    })
    expect(preview.ok).toBe(false)
    expect(preview.ambiguous.length).toBeGreaterThan(0)
  })

  it('32. preview calculator returns PASS/FAIL/INCOMPLETE and does not persist a run', () => {
    const pass = previewAcceptanceCalculator({
      profile: taskHttp,
      scenarioType: 'native_http',
      iterations: [{ iteration_number: 1, status: 'completed', dl_mbps: 90, ul_mbps: 12 }],
    })
    expect(pass.persisted).toBe(false)
    expect(pass.snapshot.overall_verdict).toBe(VERDICTS.PASS)
    const fail = previewAcceptanceCalculator({
      profile: taskHttp,
      scenarioType: 'native_http',
      iterations: [{ iteration_number: 1, status: 'completed', dl_mbps: 10, ul_mbps: 12 }],
    })
    expect(fail.snapshot.overall_verdict).toBe(VERDICTS.FAIL)
    const incomplete = previewAcceptanceCalculator({
      profile: taskHttp,
      scenarioType: 'native_http',
      iterations: [{ iteration_number: 1, status: 'completed', dl_mbps: null, ul_mbps: 12 }],
    })
    expect(incomplete.snapshot.overall_verdict).toBe(VERDICTS.INCOMPLETE)
    expect(read('src/acceptance/profileManagement.js')).toContain('Does not persist a field-test run')
  })

  it('33. changing a live profile does not rewrite an immutable snapshot', () => {
    const first = evaluateFieldTestRun({
      run: { task_id: 'task-1', project_id: 'proj-1', scenario_type: 'native_http' },
      iterations: [{ iteration_number: 1, status: 'completed', dl_mbps: 90, ul_mbps: 12 }],
      profiles: [taskHttp],
    })
    const second = evaluateFieldTestRun({
      run: { task_id: 'task-1', project_id: 'proj-1', scenario_type: 'native_http' },
      iterations: [{ iteration_number: 1, status: 'completed', dl_mbps: 90, ul_mbps: 12 }],
      profiles: [{ ...taskHttp, rules: { ...taskHttp.rules, min_dl_mbps: 999 }, version: 9 }],
      existingSnapshot: first.snapshot,
    })
    expect(second.idempotent).toBe(true)
    expect(second.snapshot.overall_verdict).toBe(VERDICTS.PASS)
    expect(second.snapshot.profile_version).toBe(1)
  })

  it('34. RF rules stay future/disabled and are not fabricated', () => {
    expect(RF_RULES_SUPPORTED).toBe(false)
    expect(read('src/acceptance/profileManagement.js')).toContain('RF_RULES_SUPPORTED')
    const preview = previewAcceptanceCalculator({
      profile: taskHttp,
      scenarioType: 'native_http',
      iterations: [{ iteration_number: 1, status: 'completed', dl_mbps: 90, ul_mbps: 12 }],
    })
    expect(preview.rf_supported).toBe(false)
    expect(preview.rf_verdict).toBe('N/A')
  })

  it('35. mock provider works without SQL; 215 is CR1D_APPLY; 214 is quarantined never-run', () => {
    const provider = createMockAcceptanceProfilesProvider()
    expect(provider.kind).toBe('mock')
    expect(read('scripts/f10c2/phase4bApplyPlan.mjs')).toContain('CR1D_DRAFT_ONLY')
    expect(read('scripts/f10c2/phase4bApplyPlan.mjs')).toContain('CR1_NEVER_RUN')
    expect(read('scripts/f10c2/phase4bApplyPlan.mjs')).toContain('CR1D_APPLY')
    expect(read('scripts/f10c2/phase4bApplyPlan.mjs')).toContain('215_cr1d_acceptance_profile_management')
    const apply = read('scripts/f10c2/phase4bApplyPlan.mjs')
    const cr1bBlock = apply.slice(apply.indexOf('export const CR1B_APPLY'), apply.indexOf('CR1_NEVER_RUN'))
    expect(cr1bBlock).not.toContain('215_')
    expect(cr1bBlock).not.toContain('214_')
    expect(apply.slice(apply.indexOf('export const CR1D_DRAFT_ONLY'), apply.indexOf('export const CR1D_APPLY'))).not.toContain('214_cr1b_acceptance_applicability')
    expect(apply.slice(apply.indexOf('export const CR1D_DRAFT_ONLY'), apply.indexOf('export const CR1D_APPLY'))).not.toContain('215_')
    expect(apply.slice(apply.indexOf('export const CR1_NEVER_RUN'), apply.indexOf('export const CR1D_DRAFT_ONLY'))).toContain('214_cr1b_acceptance_applicability')
    expect(apply.slice(apply.indexOf('export const CR1D_APPLY'))).toContain('215_cr1d_acceptance_profile_management')
    expect(apply.slice(apply.indexOf('export const CR1D_APPLY'), apply.indexOf('export const CR1E_APPLY'))).not.toContain('214_')
    expect(fs.existsSync(path.join(ROOT, 'supabase/drafts/f10c2/phase4b/forward/214_cr1b_acceptance_applicability.sql'))).toBe(false)
    expect(fs.existsSync(path.join(ROOT, 'supabase/drafts/f10c2/never-run/214/README.md'))).toBe(true)
    expect(fs.existsSync(path.join(ROOT, 'supabase/drafts/f10c2/phase4b/forward/215_cr1d_acceptance_profile_management.sql'))).toBe(true)
    expect(fs.existsSync(path.join(ROOT, 'supabase/drafts/f10c2/phase4b/verification/215_cr1d_acceptance_profile_management.sql'))).toBe(true)
    expect(fs.existsSync(path.join(ROOT, 'supabase/drafts/f10c2/phase4b/rollback/215_cr1d_acceptance_profile_management.sql'))).toBe(true)
    const forward = read('supabase/drafts/f10c2/phase4b/forward/215_cr1d_acceptance_profile_management.sql')
    expect(forward).toContain('DO NOT EXECUTE 214')
    expect(forward).toContain('acceptance_profiles_one_active_scope_scenario')
    expect(forward).toContain('acceptance_profiles_one_tenant_default_scenario')
    expect(forward).not.toMatch(/\bnsne/i)
  })
})
