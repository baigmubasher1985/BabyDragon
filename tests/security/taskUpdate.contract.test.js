import { describe, it, expect } from 'vitest'
import { ACTORS, isActiveFailClosed } from './fixtures/syntheticActors.js'
import { TASKS, isAssignedToTask } from './fixtures/syntheticTasks.js'

/**
 * insert_assigned_task_update contract.
 * Forces user_id = auth.uid(); assignment check; store object key not signed URL.
 */

function evaluateTaskUpdateInsert({ actor, authUid, task, payload }) {
  if (!isActiveFailClosed(actor) || actor.role !== 'fe') {
    return { allowed: false, reason: 'actor' }
  }
  if (authUid !== actor.id) return { allowed: false, reason: 'auth_uid' }
  if (!isAssignedToTask(authUid, task)) return { allowed: false, reason: 'assignment' }
  if (payload.task_id !== task.id) return { allowed: false, reason: 'task_mismatch' }

  // Durable photo ref must be bucket+object_key, not a signed/long-lived URL
  if (payload.photo_url && /^https?:\/\//i.test(payload.photo_url)) {
    return { allowed: false, reason: 'signed_or_public_url_not_durable' }
  }

  const row = {
    task_id: task.id,
    user_id: authUid, // server-forced
    comment: payload.comment ?? null,
    photo_object_key: payload.photo_object_key ?? null,
    latitude: payload.latitude ?? null,
    longitude: payload.longitude ?? null,
  }
  return { allowed: true, row }
}

describe('taskUpdate.contract', () => {
  const fe = ACTORS.ACTIVE_ASSIGNED_FE

  it('allows assigned FE insert and forces user_id from auth.uid()', () => {
    const result = evaluateTaskUpdateInsert({
      actor: fe,
      authUid: fe.id,
      task: TASKS.assignedToFeA,
      payload: {
        task_id: TASKS.assignedToFeA.id,
        user_id: ACTORS.UNASSIGNED_FE.id, // forged — ignored
        comment: 'synthetic note',
        photo_object_key:
          '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/55555555-5555-4555-8555-555555555555.jpg',
      },
    })
    expect(result.allowed).toBe(true)
    expect(result.row.user_id).toBe(fe.id)
    expect(result.row.photo_object_key.startsWith('operational-evidence/')).toBe(
      false,
    )
  })

  it('rejects durable storage of signed/public URL as photo identity', () => {
    const result = evaluateTaskUpdateInsert({
      actor: fe,
      authUid: fe.id,
      task: TASKS.assignedToFeA,
      payload: {
        task_id: TASKS.assignedToFeA.id,
        comment: 'x',
        photo_url: 'https://example.invalid/signed?token=not-a-real-secret',
      },
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('signed_or_public_url_not_durable')
  })

  it('denies unassigned FE insert', () => {
    expect(
      evaluateTaskUpdateInsert({
        actor: ACTORS.UNASSIGNED_FE,
        authUid: ACTORS.UNASSIGNED_FE.id,
        task: TASKS.assignedToFeA,
        payload: { task_id: TASKS.assignedToFeA.id, comment: 'nope' },
      }).allowed,
    ).toBe(false)
  })

  it.todo('Live disposable task_updates RPC — gated until disposable authorized')
})
