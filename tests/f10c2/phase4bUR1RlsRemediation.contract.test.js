import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  listPhase4bApplyPlan,
  listExistingDisposable209Apply,
  PHASE4A_NEVER_EXECUTE,
  PHASE4B_R1_APPLY,
  PHASE4B_U_R1_APPLY,
  F10C1I_SKIP,
  F10C2_SKIP,
} from '../../scripts/f10c2/phase4bApplyPlan.mjs'
import { ACTORS, isAdminOrSuperAdmin, SYNTHETIC_UUIDS } from '../security/fixtures/syntheticActors.js'
import { TASKS } from '../security/fixtures/syntheticTasks.js'

const ROOT = process.cwd()
const SLUG = '209_disposable_operational_profile_task_rls_remediation'
const POLICY_NAMES = [
  'profiles_209_select_own',
  'profiles_209_select_admin',
  'tasks_209_select_assigned',
  'tasks_209_select_admin',
  'tasks_209_insert_admin',
  'tasks_209_update_admin',
]

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

function executableBody(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

/**
 * Local 209 policy evaluator. Mirrors intended USING/WITH CHECK.
 * Does not connect to a database. Role is never taken from a client payload.
 */
function evaluate209({ actor, table, action, row }) {
  if (!actor?.id) return { allowed: false, reason: 'anon_denied' }
  if (actor.role === 'fe' && actor.is_active !== true) {
    // helper is fail-closed for admin path; own-row SELECT still uses auth.uid()
  }
  const admin = isAdminOrSuperAdmin(actor)
  if (table === 'profiles') {
    if (action === 'select') {
      if (row.id === actor.id) return { allowed: true, reason: 'own_profile' }
      if (admin) return { allowed: true, reason: 'admin_select' }
      return { allowed: false, reason: 'other_profile_denied' }
    }
    return { allowed: false, reason: 'profile_mutation_omitted' }
  }
  if (table === 'tasks') {
    if (action === 'select') {
      if (row.assigned_to === actor.id) return { allowed: true, reason: 'assigned_select' }
      if (admin) return { allowed: true, reason: 'admin_select' }
      return { allowed: false, reason: 'unassigned_task_denied' }
    }
    if (action === 'insert' || action === 'update') {
      if (admin) return { allowed: true, reason: 'admin_write' }
      return { allowed: false, reason: 'fe_direct_write_omitted_use_rpc' }
    }
    return { allowed: false, reason: 'delete_omitted' }
  }
  return { allowed: false, reason: 'unknown' }
}

describe('f10c2 phase4b-u-r1 209 RLS remediation', () => {
  it('adds 209 after 208 on the disposable plan and keeps 207/009/010 never-execute', () => {
    const plan = listPhase4bApplyPlan()
    const slugs = plan.stages.map((s) => s.slug)
    expect(slugs).toContain(SLUG)
    expect(slugs.indexOf(SLUG)).toBeGreaterThan(slugs.indexOf('208_phase4b_validation_remediation'))
    expect(slugs.at(-1)).toBe('213_cr1b_rls_grants')
    expect(PHASE4B_R1_APPLY).toEqual(['208_phase4b_validation_remediation'])
    expect(PHASE4B_U_R1_APPLY).toEqual([SLUG])
    expect(listExistingDisposable209Apply().map((s) => s.slug)).toEqual([SLUG])
    expect(listExistingDisposable209Apply()).toHaveLength(1)
    expect(slugs).not.toContain('207_rls_tenant_storage_assumptions')
    expect(slugs).not.toContain('009_rls_profiles')
    expect(slugs).not.toContain('010_rls_tasks')
    expect(slugs).not.toContain('012_rls_task_checklist_items')
    expect(slugs).not.toContain('013_rls_task_issue_reports')
    expect(slugs).not.toContain('112_result_artifacts_storage_contract')
    expect(F10C1I_SKIP).toEqual(expect.arrayContaining(['009_rls_profiles', '010_rls_tasks']))
    expect(F10C2_SKIP).toEqual(['112_result_artifacts_storage_contract'])
    expect(PHASE4A_NEVER_EXECUTE).toEqual(['207_rls_tenant_storage_assumptions'])
    expect(plan.neverExecute).toEqual(['207_rls_tenant_storage_assumptions', '214_cr1b_acceptance_applicability'])
  })

  it('keeps 209 additive, named-policy-only, RLS-enabling, and production-unauthorized', () => {
    const forward = read(`supabase/drafts/f10c2/phase4b/forward/${SLUG}.sql`)
    const verify = read(`supabase/drafts/f10c2/phase4b/verification/${SLUG}.sql`)
    const rollback = read(`supabase/drafts/f10c2/phase4b/rollback/${SLUG}.sql`)
    const exec = executableBody(forward)
    for (const name of POLICY_NAMES) {
      expect(forward).toContain(`DROP POLICY IF EXISTS "${name}"`)
      expect(forward).toContain(`CREATE POLICY "${name}"`)
      expect(verify).toContain(name)
      expect(rollback).toContain(`DROP POLICY IF EXISTS "${name}"`)
    }
    expect(forward).toMatch(/Production execution is NOT authorized/i)
    expect(forward).toContain('single-disposable-tenant')
    expect(forward).toContain('ENABLE ROW LEVEL SECURITY')
    expect(forward).toContain('is_admin_or_super_admin()')
    expect(forward).toContain('id = auth.uid()')
    expect(forward).toContain('assigned_to = auth.uid()')
    expect(forward).toContain('update_assigned_task_status')
    expect(exec).not.toMatch(/\bDROP\s+TABLE\b/i)
    expect(exec).not.toMatch(/\bTRUNCATE\b/i)
    expect(exec).not.toMatch(/\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i)
    expect(exec).not.toMatch(/GRANT\s+ALL/i)
    expect(exec).not.toMatch(/TO\s+anon/i)
    expect(exec).not.toMatch(/TO\s+public\b/i)
    expect(exec).not.toMatch(/auth\.role\(\)\s*=\s*'authenticated'/i)
    expect(forward).not.toMatch(/nsne[a-z0-9]{4,}/i)
    expect(forward).not.toMatch(/cxyqqgmepiphyejvceum/)
    expect(forward).not.toMatch(/service_role\s*=/)
    expect(exec).not.toMatch(/FROM\s+public\.profiles/)
    const rollbackExec = executableBody(rollback)
    expect(rollbackExec).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i)
    expect(rollbackExec).not.toMatch(/\bDROP\s+TABLE\b/i)
  })

  it('does not create profile UPDATE/DELETE or FE task UPDATE/DELETE policies', () => {
    const forward = read(`supabase/drafts/f10c2/phase4b/forward/${SLUG}.sql`)
    const blocks = [...forward.matchAll(/CREATE POLICY "([^"]+)"\s+ON public\.\w+\s+AS PERMISSIVE FOR (\w+)/g)]
      .map((m) => ({ name: m[1], cmd: m[2] }))
    const profilePols = blocks.filter((b) => b.name.startsWith('profiles_209_'))
    const taskPols = blocks.filter((b) => b.name.startsWith('tasks_209_'))
    expect(profilePols.length).toBe(2)
    expect(profilePols.every((b) => b.cmd === 'SELECT')).toBe(true)
    expect(taskPols.some((b) => b.name === 'tasks_209_update_admin' && b.cmd === 'UPDATE')).toBe(true)
    expect(taskPols.some((b) => b.cmd === 'DELETE')).toBe(false)
    expect(forward).toContain('FE direct UPDATE is omitted')
    expect(forward).not.toMatch(/CREATE POLICY "tasks_209_update_fe"/)
  })

  it('FE can select own profile and assigned task; not other FE, admin profile, or unassigned task', () => {
    const fe = ACTORS.ACTIVE_ASSIGNED_FE
    const other = ACTORS.UNASSIGNED_FE
    const admin = ACTORS.ADMIN
    expect(evaluate209({
      actor: fe, table: 'profiles', action: 'select', row: { id: fe.id },
    }).allowed).toBe(true)
    expect(evaluate209({
      actor: fe, table: 'profiles', action: 'select', row: { id: other.id },
    }).allowed).toBe(false)
    expect(evaluate209({
      actor: fe, table: 'profiles', action: 'select', row: { id: admin.id },
    }).allowed).toBe(false)
    expect(evaluate209({
      actor: fe, table: 'tasks', action: 'select', row: TASKS.assignedToFeA,
    }).allowed).toBe(true)
    expect(evaluate209({
      actor: fe, table: 'tasks', action: 'select', row: TASKS.assignedToFeB,
    }).allowed).toBe(false)
    expect(evaluate209({
      actor: fe, table: 'tasks', action: 'select', row: TASKS.unassigned,
    }).allowed).toBe(false)
  })

  it('admin and super_admin can select profiles and all tasks; anon is denied', () => {
    const admin = ACTORS.ADMIN
    const sa = ACTORS.SUPER_ADMIN
    const anon = ACTORS.ANON
    expect(evaluate209({
      actor: admin, table: 'profiles', action: 'select', row: { id: ACTORS.ACTIVE_ASSIGNED_FE.id },
    }).allowed).toBe(true)
    expect(evaluate209({
      actor: sa, table: 'tasks', action: 'select', row: TASKS.assignedToFeB,
    }).allowed).toBe(true)
    expect(evaluate209({
      actor: anon, table: 'profiles', action: 'select', row: { id: SYNTHETIC_UUIDS.feA },
    }).allowed).toBe(false)
    expect(evaluate209({
      actor: anon, table: 'tasks', action: 'select', row: TASKS.assignedToFeA,
    }).allowed).toBe(false)
  })

  it('blocks FE self-promote, reassignment, privileged profile fields, and FE task INSERT/DELETE', () => {
    const fe = ACTORS.ACTIVE_ASSIGNED_FE
    expect(evaluate209({
      actor: fe, table: 'profiles', action: 'update',
      row: { id: fe.id, role: 'fe' },
      nextRow: { id: fe.id, role: 'admin' },
    }).allowed).toBe(false)
    expect(evaluate209({
      actor: fe, table: 'tasks', action: 'update',
      row: TASKS.assignedToFeA,
      nextRow: { ...TASKS.assignedToFeA, assigned_to: SYNTHETIC_UUIDS.feB },
    }).allowed).toBe(false)
    expect(evaluate209({
      actor: fe, table: 'tasks', action: 'insert', row: TASKS.assignedToFeA,
    }).allowed).toBe(false)
    expect(evaluate209({
      actor: fe, table: 'tasks', action: 'delete', row: TASKS.assignedToFeA,
    }).allowed).toBe(false)
    expect(evaluate209({
      actor: ACTORS.ADMIN, table: 'tasks', action: 'insert', row: TASKS.assignedToFeA,
    }).allowed).toBe(true)
    expect(evaluate209({
      actor: ACTORS.ADMIN, table: 'tasks', action: 'delete', row: TASKS.assignedToFeA,
    }).allowed).toBe(false)
  })

  it('documents application contracts: own-profile loader, assigned My Tasks, RPC status path', () => {
    const app = read('src/App.jsx')
    const mobile = read('src/mobile/MobileApp.jsx')
    const fieldResults = read('src/fieldResults/repository/supabaseFieldResultsProvider.js')
    expect(app).toContain('supabase.from("profiles").select("role").eq("id", userId).single()')
    expect(mobile).toContain('supabase.from("tasks").select("*")')
    expect(mobile).toContain('isAssignedToCurrentUser(task, user)')
    expect(mobile).toContain('My Tasks')
    expect(mobile).toContain('supabase.rpc("update_assigned_task_status"')
    expect(mobile).not.toContain('supabase.from("tasks").update({ status: nextStatus })')
    expect(read('supabase/drafts/f10c2/phase4b/forward/' + SLUG + '.sql'))
      .toContain('update_assigned_task_status')
    expect(fieldResults).toContain('from("tasks")')
    expect(fieldResults).toContain('from("profiles")')
  })

  it('does not copy 009/010 executable policy SQL and keeps those drafts documentation-only', () => {
    const p009 = read('supabase/drafts/forward/009_rls_profiles.sql')
    const p010 = read('supabase/drafts/forward/010_rls_tasks.sql')
    const p209 = read(`supabase/drafts/f10c2/phase4b/forward/${SLUG}.sql`)
    expect(p009).toContain('CLASSIFICATION: blocked_documentation_only')
    expect(p010).toContain('CLASSIFICATION: blocked_documentation_only')
    expect(executableBody(p009)).not.toMatch(/CREATE POLICY/)
    expect(executableBody(p010)).not.toMatch(/CREATE POLICY/)
    expect(p209).not.toContain('009_rls_profiles')
    expect(p209).not.toContain('Admin full access')
    expect(p209).not.toContain('FE can update their assigned tasks')
  })
})
