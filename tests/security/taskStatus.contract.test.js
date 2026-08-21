import { describe, it, expect } from 'vitest'
import { ACTORS, isActiveFailClosed } from './fixtures/syntheticActors.js'
import {
  TASKS,
  TASK_STATUS_RPC_ALLOWED_COLUMNS,
  TASK_STATUS_RPC_FORBIDDEN_COLUMNS,
  isAssignedToTask,
  isApprovedStatusTransition,
} from './fixtures/syntheticTasks.js'

/**
 * update_assigned_task_status contract (Phase 2 corrected transitions).
 * Signature: (p_task_id, p_status, p_started_at?, p_completed_at?)
 */

const RPC_NAME = 'update_assigned_task_status'
const RPC_PARAMS = ['p_task_id', 'p_status', 'p_started_at', 'p_completed_at']

function evaluateStatusRpc({ actor, authUid, task, fromStatus, status, columnWrites }) {
  if (!isActiveFailClosed(actor)) {
    return { allowed: false, reason: 'inactive_or_unknown' }
  }
  if (actor.role !== 'fe') {
    return { allowed: false, reason: 'not_fe' }
  }
  if (!authUid || authUid !== actor.id) {
    return { allowed: false, reason: 'auth_uid_mismatch' }
  }
  if (!isAssignedToTask(authUid, task)) {
    return { allowed: false, reason: 'not_assigned' }
  }
  const current = fromStatus ?? task.status
  if (current === 'completed') {
    return { allowed: false, reason: 'terminal_completed' }
  }
  if (!isApprovedStatusTransition(current, status)) {
    return { allowed: false, reason: 'status_not_approved' }
  }
  const forbidden = Object.keys(columnWrites || {}).filter((c) =>
    TASK_STATUS_RPC_FORBIDDEN_COLUMNS.includes(c),
  )
  if (forbidden.length) {
    return { allowed: false, reason: 'forbidden_columns', forbidden }
  }
  const extra = Object.keys(columnWrites || {}).filter(
    (c) => !TASK_STATUS_RPC_ALLOWED_COLUMNS.includes(c),
  )
  if (extra.length) {
    return { allowed: false, reason: 'extra_columns', extra }
  }
  return { allowed: true, reason: 'ok' }
}

describe('taskStatus.contract — RPC signature', () => {
  it('documents RPC name and parameters', () => {
    expect(RPC_NAME).toBe('update_assigned_task_status')
    expect(RPC_PARAMS).toEqual([
      'p_task_id',
      'p_status',
      'p_started_at',
      'p_completed_at',
    ])
  })

  it('allows only status, started_at, completed_at columns', () => {
    expect(TASK_STATUS_RPC_ALLOWED_COLUMNS).toEqual([
      'status',
      'started_at',
      'completed_at',
    ])
    expect(TASK_STATUS_RPC_FORBIDDEN_COLUMNS).toContain('assigned_to')
    expect(TASK_STATUS_RPC_FORBIDDEN_COLUMNS).toContain('project_id')
    expect(TASK_STATUS_RPC_FORBIDDEN_COLUMNS).toContain('grid_id')
  })
})

describe('taskStatus.contract — transition matrix', () => {
  const fe = ACTORS.ACTIVE_ASSIGNED_FE

  it('allows pending→in_progress, on_hold→in_progress, in_progress→on_hold, in_progress→completed', () => {
    for (const [from, to] of [
      ['pending', 'in_progress'],
      ['on_hold', 'in_progress'],
      ['in_progress', 'on_hold'],
      ['in_progress', 'completed'],
    ]) {
      expect(
        evaluateStatusRpc({
          actor: fe,
          authUid: fe.id,
          task: TASKS.assignedToFeA,
          fromStatus: from,
          status: to,
          columnWrites: { status: to },
        }).allowed,
      ).toBe(true)
    }
  })

  it('rejects pending→completed, pending→on_hold, and any exit from completed', () => {
    expect(
      evaluateStatusRpc({
        actor: fe,
        authUid: fe.id,
        task: TASKS.assignedToFeA,
        fromStatus: 'pending',
        status: 'completed',
        columnWrites: { status: 'completed' },
      }).reason,
    ).toBe('status_not_approved')
    expect(
      evaluateStatusRpc({
        actor: fe,
        authUid: fe.id,
        task: TASKS.assignedToFeA,
        fromStatus: 'pending',
        status: 'on_hold',
        columnWrites: { status: 'on_hold' },
      }).reason,
    ).toBe('status_not_approved')
    expect(
      evaluateStatusRpc({
        actor: fe,
        authUid: fe.id,
        task: TASKS.assignedToFeA,
        fromStatus: 'completed',
        status: 'in_progress',
        columnWrites: { status: 'in_progress' },
      }).reason,
    ).toBe('terminal_completed')
  })
})

describe('taskStatus.contract — allow / deny', () => {
  const fe = ACTORS.ACTIVE_ASSIGNED_FE

  it('allows assigned active FE to set approved status', () => {
    const result = evaluateStatusRpc({
      actor: fe,
      authUid: fe.id,
      task: TASKS.assignedToFeA,
      fromStatus: 'pending',
      status: 'in_progress',
      columnWrites: { status: 'in_progress', started_at: '2026-08-20T00:00:00Z' },
    })
    expect(result.allowed).toBe(true)
  })

  it('denies when client forges a different user id than auth.uid()', () => {
    const result = evaluateStatusRpc({
      actor: fe,
      authUid: ACTORS.UNASSIGNED_FE.id,
      task: TASKS.assignedToFeA,
      fromStatus: 'pending',
      status: 'in_progress',
      columnWrites: { status: 'in_progress' },
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('auth_uid_mismatch')
  })

  it('denies unassigned FE and inactive FE', () => {
    expect(
      evaluateStatusRpc({
        actor: ACTORS.UNASSIGNED_FE,
        authUid: ACTORS.UNASSIGNED_FE.id,
        task: TASKS.assignedToFeA,
        fromStatus: 'in_progress',
        status: 'completed',
        columnWrites: { status: 'completed' },
      }).allowed,
    ).toBe(false)

    expect(
      evaluateStatusRpc({
        actor: ACTORS.INACTIVE_FE,
        authUid: ACTORS.INACTIVE_FE.id,
        task: TASKS.assignedToFeA,
        fromStatus: 'pending',
        status: 'in_progress',
        columnWrites: { status: 'in_progress' },
      }).reason,
    ).toBe('inactive_or_unknown')
  })

  it('denies writes to assigned_to / project_id / grid_id', () => {
    const result = evaluateStatusRpc({
      actor: fe,
      authUid: fe.id,
      task: TASKS.assignedToFeA,
      fromStatus: 'pending',
      status: 'in_progress',
      columnWrites: { status: 'in_progress', assigned_to: ACTORS.UNASSIGNED_FE.id },
    })
    expect(result.allowed).toBe(false)
    expect(result.forbidden).toContain('assigned_to')
  })

  it('denies anon', () => {
    expect(
      evaluateStatusRpc({
        actor: ACTORS.ANON,
        authUid: null,
        task: TASKS.assignedToFeA,
        fromStatus: 'pending',
        status: 'in_progress',
        columnWrites: { status: 'in_progress' },
      }).allowed,
    ).toBe(false)
  })
})

describe('taskStatus.contract — disposable live RPC', () => {
  it.todo(
    'Execute update_assigned_task_status against disposable DB — gated until disposable authorized',
  )
})
