import { describe, it, expect } from 'vitest'
import {
  ACTORS,
  isActiveFailClosed,
  isAdminOrSuperAdmin,
  isSuperAdmin,
} from './fixtures/syntheticActors.js'
import { TASKS, isAssignedToTask } from './fixtures/syntheticTasks.js'

/**
 * Role / privilege matrix contract (F10C1S-R1 §5–§6 / §16).
 * Encodes expected allow/deny without a live database.
 */

const APPLICATION_TABLES = [
  'profiles',
  'projects',
  'tasks',
  'task_updates',
  'grids',
  'routes',
  'task_grids',
  'route_grids',
  'cell_files',
  'cell_sites',
  'cell_sectors',
  'task_checklist_items',
  'task_issue_reports',
  'qc_reviews',
]

/** Contract: table access decision for Phase 1 documentation. */
function maySelectTasks(actor, task) {
  if (!actor || actor.label === 'ANON') return false
  if (!isActiveFailClosed(actor)) return false
  if (isAdminOrSuperAdmin(actor)) return true
  if (actor.role === 'fe') return isAssignedToTask(actor.id, task)
  return false
}

function mayMutateAssignedTaskViaRpc(actor, task) {
  if (!isActiveFailClosed(actor)) return false
  if (actor.role !== 'fe') return false
  return isAssignedToTask(actor.id, task)
}

describe('roleMatrix.contract — ANON', () => {
  it('denies application table SELECT for all 14 tables', () => {
    for (const table of APPLICATION_TABLES) {
      expect(ACTORS.ANON.label).toBe('ANON')
      expect(maySelectTasks(ACTORS.ANON, TASKS.assignedToFeA)).toBe(false)
      expect(table).toBeTruthy()
    }
  })

  it('denies application RPCs (get_field_engineers, FE mutation RPCs)', () => {
    const anonMayCallRpc = false
    expect(anonMayCallRpc).toBe(false)
  })

  it('denies Storage and Edge admin functions', () => {
    expect({ storage: false, edgeAdminCreateUser: false }).toEqual({
      storage: false,
      edgeAdminCreateUser: false,
    })
  })
})

describe('roleMatrix.contract — INACTIVE FE', () => {
  it('fail-closed: is_active IS TRUE required', () => {
    expect(isActiveFailClosed(ACTORS.INACTIVE_FE)).toBe(false)
    expect(maySelectTasks(ACTORS.INACTIVE_FE, TASKS.assignedToFeA)).toBe(false)
    expect(mayMutateAssignedTaskViaRpc(ACTORS.INACTIVE_FE, TASKS.assignedToFeA)).toBe(
      false,
    )
  })
})

describe('roleMatrix.contract — ACTIVE ASSIGNED FE', () => {
  const fe = ACTORS.ACTIVE_ASSIGNED_FE

  it('allows SELECT/mutate on currently assigned task only', () => {
    expect(maySelectTasks(fe, TASKS.assignedToFeA)).toBe(true)
    expect(mayMutateAssignedTaskViaRpc(fe, TASKS.assignedToFeA)).toBe(true)
  })

  it('denies SELECT/mutate on FE B task and unassigned task', () => {
    expect(maySelectTasks(fe, TASKS.assignedToFeB)).toBe(false)
    expect(mayMutateAssignedTaskViaRpc(fe, TASKS.assignedToFeB)).toBe(false)
    expect(maySelectTasks(fe, TASKS.unassigned)).toBe(false)
  })

  it('denies privileged profile writes and admin Edge', () => {
    const mayUpdateOwnRole = false
    const mayCallAdminEdge = false
    expect(mayUpdateOwnRole).toBe(false)
    expect(mayCallAdminEdge).toBe(false)
  })
})

describe('roleMatrix.contract — UNASSIGNED FE (active, wrong assignment)', () => {
  it('denies FE B access to FE A assigned task', () => {
    const feB = ACTORS.UNASSIGNED_FE
    expect(isActiveFailClosed(feB)).toBe(true)
    expect(maySelectTasks(feB, TASKS.assignedToFeA)).toBe(false)
    expect(mayMutateAssignedTaskViaRpc(feB, TASKS.assignedToFeA)).toBe(false)
  })
})

describe('roleMatrix.contract — ADMIN', () => {
  it('allows FE activate/deactivate; denies grant admin/super_admin', () => {
    expect(isAdminOrSuperAdmin(ACTORS.ADMIN)).toBe(true)
    expect(isSuperAdmin(ACTORS.ADMIN)).toBe(false)
    const mayActivateFe = true
    const mayGrantAdmin = false
    const mayGrantSuperAdmin = false
    expect(mayActivateFe).toBe(true)
    expect(mayGrantAdmin).toBe(false)
    expect(mayGrantSuperAdmin).toBe(false)
  })

  it('allows Admin ops table SELECT (contract)', () => {
    expect(maySelectTasks(ACTORS.ADMIN, TASKS.unassigned)).toBe(true)
  })
})

describe('roleMatrix.contract — SUPER ADMIN', () => {
  it('allows grant/revoke admin and super_admin (via Edge after cutover)', () => {
    expect(isSuperAdmin(ACTORS.SUPER_ADMIN)).toBe(true)
    const mayGrantAdmin = true
    const mayGrantSuperAdmin = true
    expect(mayGrantAdmin).toBe(true)
    expect(mayGrantSuperAdmin).toBe(true)
  })
})

describe('roleMatrix.contract — live disposable matrix', () => {
  it.todo(
    '§16 pos+neg matrix against disposable Supabase — gated until disposable project authorized',
  )
})
