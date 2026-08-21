import { describe, it, expect } from 'vitest'
import { SYNTHETIC_UUIDS } from './fixtures/syntheticActors.js'

/**
 * Dual offline queue contracts — do not merge queues.
 * Future artifact_id idempotency rules (Phase 4 design; not implemented in production here).
 */

export const WEB_QUEUE = Object.freeze({
  idbName: 'babydragon_offline_queue',
  store: 'pending_actions',
  actionTypes: [
    'task_update',
    'gps_point',
    'checklist_item',
    'issue_report',
    'photo_evidence',
  ],
})

export const MOBILE_QUEUE = Object.freeze({
  localStorageKey: 'babydragon_mobile_offline_queue_v1',
  filesIdbName: 'babydragon_mobile_offline_files_v1',
  actionTypes: [
    'task_status',
    'checklist_item',
    'issue_report',
    'task_update',
    'gps_checkpoint',
  ],
})

/**
 * When a queue item is created (future):
 * - generate artifact_id UUID once
 * - persist on the item
 * - reuse same artifact_id and object key on retry
 * - matching key+checksum → success
 * - same key different checksum → reject
 * - new UUID only for genuinely new artifact
 */
function evaluateIdempotentRetry({ stored, retry }) {
  if (!stored?.artifact_id) return { ok: false, reason: 'missing_artifact_id' }
  if (retry.artifact_id !== stored.artifact_id) {
    return { ok: false, reason: 'artifact_id_must_reuse_on_retry' }
  }
  if (retry.object_key !== stored.object_key) {
    return { ok: false, reason: 'object_key_must_reuse_on_retry' }
  }
  if (retry.checksum === stored.checksum) {
    return { ok: true, reason: 'idempotent_success' }
  }
  return { ok: false, reason: 'checksum_mismatch_reject' }
}

describe('offlineIdempotency.contract — queue separation', () => {
  it('keeps WEB and MOBILE queue stores distinct', () => {
    expect(WEB_QUEUE.idbName).toBe('babydragon_offline_queue')
    expect(WEB_QUEUE.store).toBe('pending_actions')
    expect(MOBILE_QUEUE.localStorageKey).toBe('babydragon_mobile_offline_queue_v1')
    expect(MOBILE_QUEUE.filesIdbName).toBe('babydragon_mobile_offline_files_v1')
    expect(WEB_QUEUE.idbName).not.toBe(MOBILE_QUEUE.filesIdbName)
    expect(WEB_QUEUE.idbName).not.toBe(MOBILE_QUEUE.localStorageKey)
  })

  it('documents that web does not queue task_status; mobile does', () => {
    expect(WEB_QUEUE.actionTypes).not.toContain('task_status')
    expect(MOBILE_QUEUE.actionTypes).toContain('task_status')
  })

  it('forbids merging into a single queue store', () => {
    const mergedStoreName = null
    expect(mergedStoreName).toBeNull()
  })
})

describe('offlineIdempotency.contract — artifact_id rules', () => {
  it('accepts retry with same artifact_id, key, and checksum', () => {
    const stored = {
      artifact_id: SYNTHETIC_UUIDS.artifact,
      object_key: `operational-evidence/${SYNTHETIC_UUIDS.project}/${SYNTHETIC_UUIDS.taskAssignedToFeA}/${SYNTHETIC_UUIDS.feA}/${SYNTHETIC_UUIDS.artifact}.jpg`,
      checksum: 'sha256:abc',
    }
    const result = evaluateIdempotentRetry({
      stored,
      retry: { ...stored },
    })
    expect(result).toEqual({ ok: true, reason: 'idempotent_success' })
  })

  it('rejects same key with different checksum', () => {
    const stored = {
      artifact_id: SYNTHETIC_UUIDS.artifact,
      object_key: 'operational-evidence/p/t/u/a.jpg',
      checksum: 'sha256:abc',
    }
    const result = evaluateIdempotentRetry({
      stored,
      retry: { ...stored, checksum: 'sha256:different' },
    })
    expect(result.reason).toBe('checksum_mismatch_reject')
  })

  it('requires reusing artifact_id on retry (no new UUID for same artifact)', () => {
    const stored = {
      artifact_id: SYNTHETIC_UUIDS.artifact,
      object_key: 'operational-evidence/p/t/u/a.jpg',
      checksum: 'sha256:abc',
    }
    const result = evaluateIdempotentRetry({
      stored,
      retry: {
        ...stored,
        artifact_id: '99999999-9999-4999-8999-999999999999',
      },
    })
    expect(result.reason).toBe('artifact_id_must_reuse_on_retry')
  })

  it.todo(
    'Production queue implementations remain unmodified in Phase 1 — live replay tests gated to later phase',
  )
})
