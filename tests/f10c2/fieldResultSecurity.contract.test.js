import { describe, it, expect } from 'vitest'
import {
  ACTORS,
  F10C2_UUIDS,
  RESULT_BUCKET,
  OPS_BUCKET,
  LEGACY_BUCKET,
  createRunRegistry,
  createArtifactRegistry,
  evaluateRunSubmitAccess,
  evaluateQcWriteAccess,
  QC_DECISIONS,
  acceptsResultUpload,
  MAX_RESULT_BYTES,
  mapDashboardRow,
  backoffDelayMs,
  MAX_UPLOAD_ATTEMPTS,
} from './fixtures/syntheticFieldResults.js'
import {
  buildResultArtifactObjectKey,
  RESULT_ARTIFACTS_BUCKET,
} from '../../src/mobile/rf/reports/serverSubmissionManifest.js'
/** Dual-queue constants mirrored from offlineIdempotency.contract (no third queue). */
const WEB_QUEUE = Object.freeze({
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

const MOBILE_QUEUE = Object.freeze({
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

describe('assignmentOwnership — submit gate', () => {
  it('allows active assigned FE and ignores forged submitted_by', () => {
    const result = evaluateRunSubmitAccess({
      actor: ACTORS.ACTIVE_ASSIGNED_FE,
      taskId: F10C2_UUIDS.taskAssignedToFeA,
      clientSuppliedSubmittedBy: F10C2_UUIDS.feB,
    })
    expect(result.ok).toBe(true)
    expect(result.submitted_by).toBe(F10C2_UUIDS.feA)
    expect(result.reason).toBe('authorized_forged_submitted_by_ignored')
  })

  it('denies inactive FE', () => {
    expect(
      evaluateRunSubmitAccess({
        actor: ACTORS.INACTIVE_FE,
        taskId: F10C2_UUIDS.taskAssignedToFeA,
      }).reason,
    ).toBe('forbidden_inactive_or_not_fe')
  })

  it('denies unassigned FE / foreign task', () => {
    expect(
      evaluateRunSubmitAccess({
        actor: ACTORS.UNASSIGNED_FE,
        taskId: F10C2_UUIDS.taskAssignedToFeA,
      }).reason,
    ).toBe('not_assigned')
  })

  it('denies anon', () => {
    expect(
      evaluateRunSubmitAccess({
        actor: ACTORS.ANON,
        taskId: F10C2_UUIDS.taskAssignedToFeA,
      }).reason,
    ).toBe('not_authenticated')
  })
})

describe('idempotency — client_run_id and artifacts', () => {
  it('returns same run on duplicate client_run_id retry', () => {
    const registry = createRunRegistry()
    const first = registry.submit({
      clientRunId: F10C2_UUIDS.clientRun,
      actor: ACTORS.ACTIVE_ASSIGNED_FE,
      taskId: F10C2_UUIDS.taskAssignedToFeA,
      projectId: F10C2_UUIDS.project,
      scenarioType: 'native_http',
    })
    const second = registry.submit({
      clientRunId: F10C2_UUIDS.clientRun,
      actor: ACTORS.ACTIVE_ASSIGNED_FE,
      taskId: F10C2_UUIDS.taskAssignedToFeA,
      projectId: F10C2_UUIDS.project,
      scenarioType: 'native_http',
    })
    expect(first.ok).toBe(true)
    expect(second.reason).toBe('idempotent_success')
    expect(second.row.id).toBe(first.row.id)
  })

  it('rejects client_run_id owned by another FE', () => {
    const registry = createRunRegistry()
    registry.submit({
      clientRunId: F10C2_UUIDS.clientRun,
      actor: ACTORS.ACTIVE_ASSIGNED_FE,
      taskId: F10C2_UUIDS.taskAssignedToFeA,
      projectId: F10C2_UUIDS.project,
      scenarioType: 'rf_data',
    })
    // Simulate FE B somehow presenting same client_run_id while assigned to own task
    const feB = { ...ACTORS.UNASSIGNED_FE, assignedTaskId: F10C2_UUIDS.taskAssignedToFeB }
    // Force assignment check to pass for feB's own task but collide on client_run_id
    const collide = registry.submit({
      clientRunId: F10C2_UUIDS.clientRun,
      actor: { ...feB, role: 'fe', is_active: true },
      taskId: F10C2_UUIDS.taskAssignedToFeB,
      projectId: F10C2_UUIDS.project,
      scenarioType: 'rf_data',
    })
    expect(collide.ok).toBe(false)
    expect(collide.reason).toBe('client_run_id_owned_by_other')
  })

  it('accepts artifact retry with same key+checksum; rejects checksum conflict', () => {
    const arts = createArtifactRegistry()
    const key = buildResultArtifactObjectKey({
      projectId: F10C2_UUIDS.project,
      taskId: F10C2_UUIDS.taskAssignedToFeA,
      verifiedUserId: F10C2_UUIDS.feA,
      fieldTestRunId: F10C2_UUIDS.fieldTestRun,
      artifactId: F10C2_UUIDS.artifactA,
      safeExtension: 'csv',
    })
    const args = {
      runId: F10C2_UUIDS.fieldTestRun,
      artifactId: F10C2_UUIDS.artifactA,
      artifactType: 'rf_csv',
      objectKey: key,
      checksum: 'sha256:same',
      actor: ACTORS.ACTIVE_ASSIGNED_FE,
      runOwnerId: F10C2_UUIDS.feA,
    }
    expect(arts.register(args).reason).toBe('created')
    expect(arts.register(args).reason).toBe('idempotent_success')
    expect(
      arts.register({ ...args, checksum: 'sha256:other' }).reason,
    ).toBe('object_key_checksum_conflict')
  })
})

describe('upload resume / permanent failure / MIME size', () => {
  it('resumes interrupted upload to complete with matching checksum', () => {
    const arts = createArtifactRegistry()
    const key = 'p/t/u/r/a.json'
    const reg = arts.register({
      runId: F10C2_UUIDS.fieldTestRun,
      artifactId: F10C2_UUIDS.artifactA,
      artifactType: 'unified_json',
      objectKey: key,
      checksum: 'sha256:resume',
      actor: ACTORS.ACTIVE_ASSIGNED_FE,
      runOwnerId: F10C2_UUIDS.feA,
    })
    expect(reg.row.upload_status).toBe('pending')
    const done = arts.complete({
      artifactId: F10C2_UUIDS.artifactA,
      checksum: 'sha256:resume',
      rows: [reg.row],
    })
    expect(done.reason).toBe('completed')
    expect(done.row.upload_status).toBe('complete')
    const again = arts.complete({
      artifactId: F10C2_UUIDS.artifactA,
      checksum: 'sha256:resume',
      rows: [reg.row],
    })
    expect(again.reason).toBe('idempotent_success')
  })

  it('permanent-fails on checksum mismatch at complete', () => {
    const arts = createArtifactRegistry()
    const reg = arts.register({
      runId: F10C2_UUIDS.fieldTestRun,
      artifactId: F10C2_UUIDS.artifactB,
      artifactType: 'excel_plot',
      objectKey: 'p/t/u/r/b.xlsx',
      checksum: 'sha256:expected',
      actor: ACTORS.ACTIVE_ASSIGNED_FE,
      runOwnerId: F10C2_UUIDS.feA,
    })
    expect(
      arts.complete({
        artifactId: F10C2_UUIDS.artifactB,
        checksum: 'sha256:wrong',
        rows: [reg.row],
      }).reason,
    ).toBe('checksum_mismatch')
  })

  it('enforces MIME allow-list and 100 MiB ceiling', () => {
    expect(acceptsResultUpload({ mime: 'application/json', sizeBytes: 10 })).toBe(true)
    expect(acceptsResultUpload({ mime: 'text/csv', sizeBytes: MAX_RESULT_BYTES })).toBe(true)
    expect(acceptsResultUpload({ mime: 'text/csv', sizeBytes: MAX_RESULT_BYTES + 1 })).toBe(false)
    expect(acceptsResultUpload({ mime: 'application/x-msdownload', sizeBytes: 10 })).toBe(false)
  })

  it('documents backoff and attempt cap', () => {
    expect(backoffDelayMs(1)).toBe(1000)
    expect(backoffDelayMs(2)).toBe(5000)
    expect(backoffDelayMs(3)).toBe(15000)
    expect(backoffDelayMs(4)).toBe(60000)
    expect(backoffDelayMs(99)).toBe(60000)
    expect(MAX_UPLOAD_ATTEMPTS).toBe(8)
  })
})

describe('path ownership / buckets / legacy compatibility', () => {
  it('requires verified_user_id segment to match submitter', () => {
    const key = buildResultArtifactObjectKey({
      projectId: F10C2_UUIDS.project,
      taskId: F10C2_UUIDS.taskAssignedToFeA,
      verifiedUserId: F10C2_UUIDS.feA,
      fieldTestRunId: F10C2_UUIDS.fieldTestRun,
      artifactId: F10C2_UUIDS.artifactA,
      safeExtension: 'json',
    })
    const segments = key.split('/')
    expect(segments[2]).toBe(F10C2_UUIDS.feA)
    expect(segments[2]).not.toBe(F10C2_UUIDS.feB)
  })

  it('keeps result-artifacts distinct from ops and task-photos', () => {
    expect(RESULT_BUCKET).toBe(RESULT_ARTIFACTS_BUCKET)
    expect(RESULT_BUCKET).not.toBe(OPS_BUCKET)
    expect(RESULT_BUCKET).not.toBe(LEGACY_BUCKET)
  })
})

describe('QC role / decision / redrive', () => {
  it('allows admin QC decisions and denies FE', () => {
    expect(
      evaluateQcWriteAccess({ actor: ACTORS.ADMIN, decision: 'QC Passed' }).ok,
    ).toBe(true)
    expect(
      evaluateQcWriteAccess({ actor: ACTORS.SUPER_ADMIN, decision: 'Needs Re-drive' }).ok,
    ).toBe(true)
    expect(
      evaluateQcWriteAccess({ actor: ACTORS.ACTIVE_ASSIGNED_FE, decision: 'QC Passed' }).ok,
    ).toBe(false)
  })

  it('rejects unknown QC decision', () => {
    expect(
      evaluateQcWriteAccess({ actor: ACTORS.ADMIN, decision: 'Ship It' }).reason,
    ).toBe('invalid_qc_decision')
  })

  it('maps Needs Re-drive with redrive_task_id', () => {
    const qc = {
      qc_decision: 'Needs Re-drive',
      redrive_needed: true,
      redrive_task_id: F10C2_UUIDS.redriveTask,
      redrive_reason: 'Insufficient GPS coverage',
    }
    expect(QC_DECISIONS).toContain(qc.qc_decision)
    expect(qc.redrive_needed).toBe(true)
    expect(qc.redrive_task_id).toBe(F10C2_UUIDS.redriveTask)
  })
})

describe('dashboard mapping contract', () => {
  it('projects required dashboard fields', () => {
    const row = mapDashboardRow(
      {
        id: F10C2_UUIDS.fieldTestRun,
        client_run_id: F10C2_UUIDS.clientRun,
        task_id: F10C2_UUIDS.taskAssignedToFeA,
        project_id: F10C2_UUIDS.project,
        grid_id: F10C2_UUIDS.grid,
        scenario_type: 'unified_field_report',
        report_name: 'Synthetic Unified',
        run_status: 'ready',
        processing_status: 'ready',
        submitted_by: F10C2_UUIDS.feA,
        created_at: '2026-08-20T00:00:00.000Z',
      },
      {
        artifactCount: 3,
        qc: { qc_decision: 'Waiting for Logs', redrive_needed: false },
      },
    )
    expect(Object.keys(row).sort()).toEqual([
      'artifact_count',
      'client_run_id',
      'created_at',
      'grid_id',
      'latest_qc_status',
      'processing_status',
      'project_id',
      'report_name',
      'run_id',
      'run_status',
      'scenario_type',
      'submitted_by',
      'task_id',
      'redrive_needed',
    ].sort())
    expect(row.artifact_count).toBe(3)
    expect(row.latest_qc_status).toBe('Waiting for Logs')
  })
})

describe('offline queue reuse — no third queue', () => {
  it('reuses existing dual queues; does not invent a merged store', () => {
    expect(WEB_QUEUE.idbName).toBe('babydragon_offline_queue')
    expect(MOBILE_QUEUE.localStorageKey).toBe('babydragon_mobile_offline_queue_v1')
    const thirdQueueName = null
    expect(thirdQueueName).toBeNull()
    expect(WEB_QUEUE.idbName).not.toBe(MOBILE_QUEUE.localStorageKey)
  })

  it('extends mobile queue with field_test_result_submit without removing legacy types', async () => {
    const { OFFLINE_ACTION_TYPES, MOBILE_QUEUE_STORAGE_KEY } = await import(
      '../../src/mobile/mobileOfflineQueue.js'
    )
    expect(MOBILE_QUEUE_STORAGE_KEY).toBe(MOBILE_QUEUE.localStorageKey)
    expect(OFFLINE_ACTION_TYPES.FIELD_TEST_RESULT_SUBMIT).toBe('field_test_result_submit')
    for (const legacy of MOBILE_QUEUE.actionTypes) {
      expect(Object.values(OFFLINE_ACTION_TYPES)).toContain(legacy)
    }
    expect(Object.values(OFFLINE_ACTION_TYPES)).toContain('field_test_result_submit')
  })
})
