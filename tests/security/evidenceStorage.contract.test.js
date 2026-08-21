import { describe, it, expect } from 'vitest'
import { ACTORS, isActiveFailClosed } from './fixtures/syntheticActors.js'
import { TASKS, isAssignedToTask } from './fixtures/syntheticTasks.js'
import {
  OPS_BUCKET,
  FUTURE_RESULTS_BUCKET,
  LEGACY_OPS_BUCKET,
  MAX_OPS_BYTES,
  ALLOWED_OPS_MIME,
  SAMPLE_ARTIFACT,
  buildOperationalEvidenceKey,
  durableDbRef,
  acceptsOpsUpload,
} from './fixtures/syntheticEvidence.js'

/**
 * Operational evidence Storage contract.
 * Results packages must use a distinct future bucket (F10C2) — not created here.
 */

describe('evidenceStorage.contract — MIME and size', () => {
  it('accepts jpeg/png at or under 15 MB', () => {
    expect(acceptsOpsUpload({ mime: 'image/jpeg', sizeBytes: MAX_OPS_BYTES })).toBe(
      true,
    )
    expect(acceptsOpsUpload({ mime: 'image/png', sizeBytes: 1 })).toBe(true)
    expect(ALLOWED_OPS_MIME).toEqual(['image/jpeg', 'image/png'])
  })

  it('rejects >15 MB and disallowed MIME', () => {
    expect(
      acceptsOpsUpload({ mime: 'image/jpeg', sizeBytes: MAX_OPS_BYTES + 1 }),
    ).toBe(false)
    expect(acceptsOpsUpload({ mime: 'image/webp', sizeBytes: 100 })).toBe(false)
    expect(acceptsOpsUpload({ mime: 'application/pdf', sizeBytes: 100 })).toBe(false)
  })
})

describe('evidenceStorage.contract — object key', () => {
  it('builds object_key without bucket prefix or user-supplied filename', () => {
    const key = buildOperationalEvidenceKey({
      projectId: SAMPLE_ARTIFACT.project_id,
      taskId: SAMPLE_ARTIFACT.task_id,
      verifiedUserId: SAMPLE_ARTIFACT.verified_user_id,
      artifactId: SAMPLE_ARTIFACT.artifact_id,
      safeExtension: 'png',
    })
    expect(key).toBe(
      `${SAMPLE_ARTIFACT.project_id}/${SAMPLE_ARTIFACT.task_id}/${SAMPLE_ARTIFACT.verified_user_id}/${SAMPLE_ARTIFACT.artifact_id}.png`,
    )
    expect(key.startsWith(`${OPS_BUCKET}/`)).toBe(false)
    expect(key.includes('IMG_1234')).toBe(false)
    expect(key.split('/').length).toBe(4)
  })

  it('rejects unsafe extension', () => {
    expect(() =>
      buildOperationalEvidenceKey({
        projectId: SAMPLE_ARTIFACT.project_id,
        taskId: SAMPLE_ARTIFACT.task_id,
        verifiedUserId: SAMPLE_ARTIFACT.verified_user_id,
        artifactId: SAMPLE_ARTIFACT.artifact_id,
        safeExtension: 'exe',
      }),
    ).toThrow('unsafe_extension')
  })

  it('durable DB ref is bucket + object_key, not signed URL', () => {
    const key = buildOperationalEvidenceKey({
      projectId: SAMPLE_ARTIFACT.project_id,
      taskId: SAMPLE_ARTIFACT.task_id,
      verifiedUserId: SAMPLE_ARTIFACT.verified_user_id,
      artifactId: SAMPLE_ARTIFACT.artifact_id,
      safeExtension: 'jpg',
    })
    const ref = durableDbRef(OPS_BUCKET, key)
    expect(ref).toEqual({ bucket: OPS_BUCKET, object_key: key })
    expect(JSON.stringify(ref)).not.toMatch(/https?:\/\//i)
  })
})

describe('evidenceStorage.contract — assignment and buckets', () => {
  it('upload allowed only for active assigned FE to own verified_user_id segment', () => {
    const fe = ACTORS.ACTIVE_ASSIGNED_FE
    const ok =
      isActiveFailClosed(fe) &&
      isAssignedToTask(fe.id, TASKS.assignedToFeA) &&
      SAMPLE_ARTIFACT.verified_user_id === fe.id
    expect(ok).toBe(true)

    const feB = ACTORS.UNASSIGNED_FE
    const forgedPathOk =
      isAssignedToTask(feB.id, TASKS.assignedToFeA) &&
      SAMPLE_ARTIFACT.verified_user_id === feB.id
    expect(forgedPathOk).toBe(false)
  })

  it('never stores RF/result packages in task-photos or operational-evidence', () => {
    expect(LEGACY_OPS_BUCKET).toBe('task-photos')
    expect(OPS_BUCKET).toBe('operational-evidence')
    expect(FUTURE_RESULTS_BUCKET).toBe('result-artifacts')
    expect(FUTURE_RESULTS_BUCKET).not.toBe(OPS_BUCKET)
    expect(FUTURE_RESULTS_BUCKET).not.toBe(LEGACY_OPS_BUCKET)
  })

  it.todo(
    'Disposable Storage upload MIME/size/path/idempotency — gated until disposable bucket authorized',
  )
})
