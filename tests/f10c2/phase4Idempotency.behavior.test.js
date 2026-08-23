import { describe, it, expect } from 'vitest'
import { createMockResultTransport } from '../../src/mobile/rf/submission/mockResultTransport.js'
import { processResultPackagePayload } from '../../src/mobile/rf/submission/resultUploadOrchestrator.js'
import { PACKAGE_STATES } from '../../src/mobile/rf/submission/resultPackageStates.js'

const CLIENT_RUN = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'

function basePayload() {
  return {
    record_version: 1,
    client_run_id: CLIENT_RUN,
    owner_user_id: 'fe-user-1',
    package_state: PACKAGE_STATES.QUEUED,
    field_test_run_id: null,
    attempts: 0,
    manifest: {
      client_run_id: CLIENT_RUN,
      task_id: 'task-1',
      project_id: 'proj-1',
      scenario_type: 'ftp',
      device: {},
    },
    local_artifacts: [
      {
        artifact_id: 'art-ftp-1',
        artifact_type: 'scenario_csv',
        mime_type: 'text/csv',
        size_bytes: 8,
        checksum: 'sha256:ftp',
        safe_extension: 'csv',
        original_file_name: 'ftp.csv',
        upload_status: 'pending',
      },
    ],
  }
}

describe('f10c2 phase4 — idempotent retry (mock transport remains deterministic)', () => {
  it('second process of the same client_run_id does not create a second run', async () => {
    const transport = createMockResultTransport()
    const first = await processResultPackagePayload(basePayload(), {
      transport,
      currentUser: { id: 'fe-user-1' },
      sessionValid: true,
    })
    expect(first.payload.package_state).toBe(PACKAGE_STATES.UPLOADED)
    const second = await processResultPackagePayload(
      { ...basePayload(), field_test_run_id: first.payload.field_test_run_id },
      {
        transport,
        currentUser: { id: 'fe-user-1' },
        sessionValid: true,
      },
    )
    expect(second.payload.field_test_run_id).toBe(first.payload.field_test_run_id)
    expect(transport.__state.runsByClientRunId.size).toBe(1)
    expect(transport.__state.artifactsById.size).toBe(1)
  })

  it('offline retry_wait keeps the queue item until uploaded', async () => {
    const transport = createMockResultTransport({ defaultFailureMode: 'retryable_network' })
    const result = await processResultPackagePayload(basePayload(), {
      transport,
      currentUser: { id: 'fe-user-1' },
      sessionValid: true,
    })
    expect(result.keep).toBe(true)
    expect(result.payload.package_state).toBe(PACKAGE_STATES.RETRY_WAIT)
    expect(result.done).toBe(false)
  })
})
