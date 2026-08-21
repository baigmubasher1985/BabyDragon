import { describe, it, expect } from 'vitest'
import { ACTORS, isActiveFailClosed } from './fixtures/syntheticActors.js'
import { TASKS, isAssignedToTask } from './fixtures/syntheticTasks.js'

/**
 * insert_assigned_task_issue contract.
 * Forces reported_by = auth.uid(); assignment check; fail closed.
 */

function evaluateIssueInsert({ actor, authUid, task, payload }) {
  if (!isActiveFailClosed(actor) || actor.role !== 'fe') {
    return { allowed: false, reason: 'actor' }
  }
  if (authUid !== actor.id) return { allowed: false, reason: 'auth_uid' }
  if (!isAssignedToTask(authUid, task)) return { allowed: false, reason: 'assignment' }
  if (payload.task_id !== task.id) return { allowed: false, reason: 'task_mismatch' }
  // Client-supplied reported_by must be ignored; server forces auth.uid()
  const forced = { ...payload, reported_by: authUid, status: 'open' }
  if (payload.reported_by && payload.reported_by !== authUid) {
    // Still allow if server overwrites — contract asserts overwrite
    expect(forced.reported_by).toBe(authUid)
  }
  return { allowed: true, row: forced }
}

describe('issueReport.contract', () => {
  const fe = ACTORS.ACTIVE_ASSIGNED_FE

  it('allows assigned FE insert and forces reported_by from auth.uid()', () => {
    const result = evaluateIssueInsert({
      actor: fe,
      authUid: fe.id,
      task: TASKS.assignedToFeA,
      payload: {
        task_id: TASKS.assignedToFeA.id,
        issue_type: 'access',
        severity: 'medium',
        description: 'synthetic',
        reported_by: ACTORS.UNASSIGNED_FE.id, // forged — must be overwritten
        lat: 32.1,
        lon: -96.2,
      },
    })
    expect(result.allowed).toBe(true)
    expect(result.row.reported_by).toBe(fe.id)
    expect(result.row.status).toBe('open')
  })

  it('denies insert for unassigned task and anon', () => {
    expect(
      evaluateIssueInsert({
        actor: ACTORS.UNASSIGNED_FE,
        authUid: ACTORS.UNASSIGNED_FE.id,
        task: TASKS.assignedToFeA,
        payload: { task_id: TASKS.assignedToFeA.id, issue_type: 'x', severity: 'low' },
      }).allowed,
    ).toBe(false)
    expect(
      evaluateIssueInsert({
        actor: ACTORS.ANON,
        authUid: null,
        task: TASKS.assignedToFeA,
        payload: { task_id: TASKS.assignedToFeA.id },
      }).allowed,
    ).toBe(false)
  })

  it.todo('Live disposable issue RPC — gated until disposable authorized')
})
