import { describe, it, expect } from 'vitest'
import { ACTORS, isActiveFailClosed } from './fixtures/syntheticActors.js'
import { TASKS, isAssignedToTask } from './fixtures/syntheticTasks.js'

/**
 * update_assigned_checklist_item contract (Phase 2).
 * Client params: p_item_id, p_is_done, optional p_event_at only.
 * Server derives task scope, completed_by=auth.uid(), timestamps.
 */

const RPC_PARAMS = Object.freeze(['p_item_id', 'p_is_done', 'p_event_at'])
const CLIENT_FORBIDDEN = Object.freeze([
  'task_id',
  'label',
  'item_order',
  'completed_by',
  'completed_at',
  'updated_at',
])

function evaluateChecklistRpc({ actor, authUid, task, clientParams }) {
  if (!isActiveFailClosed(actor) || actor.role !== 'fe') {
    return { allowed: false, reason: 'actor' }
  }
  if (authUid !== actor.id) return { allowed: false, reason: 'auth_uid' }
  if (!isAssignedToTask(authUid, task)) return { allowed: false, reason: 'assignment' }

  const forbidden = Object.keys(clientParams || {}).filter((k) =>
    CLIENT_FORBIDDEN.includes(k),
  )
  if (forbidden.length) return { allowed: false, reason: 'forbidden', forbidden }

  const allowedKeys = Object.keys(clientParams || {}).filter((k) => RPC_PARAMS.includes(k))
  if (allowedKeys.length !== Object.keys(clientParams || {}).length) {
    return { allowed: false, reason: 'unknown_param' }
  }

  // Server-forced identity fields
  const serverRow = {
    is_done: clientParams.p_is_done,
    completed_by: clientParams.p_is_done ? authUid : null,
    completed_at: clientParams.p_is_done
      ? clientParams.p_event_at ?? 'server_now'
      : null,
    updated_at: clientParams.p_event_at ?? 'server_now',
  }
  return { allowed: true, serverRow }
}

describe('checklist.contract', () => {
  const fe = ACTORS.ACTIVE_ASSIGNED_FE

  it('documents RPC params only (no client completed_by)', () => {
    expect(RPC_PARAMS).toEqual(['p_item_id', 'p_is_done', 'p_event_at'])
    expect(CLIENT_FORBIDDEN).toContain('completed_by')
    expect(CLIENT_FORBIDDEN).toContain('task_id')
    expect(CLIENT_FORBIDDEN).toContain('label')
    expect(CLIENT_FORBIDDEN).toContain('item_order')
  })

  it('allows assigned FE toggle; server forces completed_by', () => {
    const result = evaluateChecklistRpc({
      actor: fe,
      authUid: fe.id,
      task: TASKS.assignedToFeA,
      clientParams: {
        p_item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        p_is_done: true,
        p_event_at: '2026-08-20T12:00:00Z',
      },
    })
    expect(result.allowed).toBe(true)
    expect(result.serverRow.completed_by).toBe(fe.id)
  })

  it('denies client-supplied completed_by / label / task_id', () => {
    const result = evaluateChecklistRpc({
      actor: fe,
      authUid: fe.id,
      task: TASKS.assignedToFeA,
      clientParams: {
        p_item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        p_is_done: true,
        completed_by: ACTORS.UNASSIGNED_FE.id,
        label: 'hijack',
        task_id: TASKS.assignedToFeB.id,
      },
    })
    expect(result.allowed).toBe(false)
    expect(result.forbidden).toEqual(
      expect.arrayContaining(['completed_by', 'label', 'task_id']),
    )
  })

  it('denies unassigned FE and inactive FE', () => {
    expect(
      evaluateChecklistRpc({
        actor: ACTORS.UNASSIGNED_FE,
        authUid: ACTORS.UNASSIGNED_FE.id,
        task: TASKS.assignedToFeA,
        clientParams: { p_item_id: 'x', p_is_done: true },
      }).allowed,
    ).toBe(false)
    expect(
      evaluateChecklistRpc({
        actor: ACTORS.INACTIVE_FE,
        authUid: ACTORS.INACTIVE_FE.id,
        task: TASKS.assignedToFeA,
        clientParams: { p_item_id: 'x', p_is_done: true },
      }).allowed,
    ).toBe(false)
  })

  it.todo('Live disposable checklist RPC — gated until disposable authorized')
})
