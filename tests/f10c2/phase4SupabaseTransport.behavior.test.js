import { describe, it, expect, vi } from 'vitest'
import { createSupabaseResultTransport } from '../../src/mobile/rf/submission/supabaseResultTransport.js'
import { processResultPackagePayload } from '../../src/mobile/rf/submission/resultUploadOrchestrator.js'
import { PACKAGE_STATES } from '../../src/mobile/rf/submission/resultPackageStates.js'
import { getResultTransportKind } from '../../src/mobile/rf/submission/resultTransportFactory.js'

const RUN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const ART_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
const CLIENT_RUN = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'

function createFakeSupabase({
  sessionUserId = 'fe-user-1',
  rpcImpl,
  uploadImpl,
} = {}) {
  const rpc = rpcImpl || vi.fn(async (name, args) => {
    if (name === 'submit_field_test_run') {
      return { data: { id: RUN_ID, client_run_id: args.p_client_run_id, run_status: 'submitted' }, error: null }
    }
    if (name === 'register_field_test_artifact') {
      return {
        data: {
          id: args.p_artifact_id,
          run_id: args.p_run_id,
          object_key: `proj/task/${sessionUserId}/${RUN_ID}/${args.p_artifact_id}.json`,
          bucket: 'result-artifacts',
          checksum: args.p_checksum,
          upload_status: 'pending',
        },
        error: null,
      }
    }
    if (name === 'complete_field_test_artifact_upload') {
      return { data: { id: args.p_artifact_id, upload_status: 'complete' }, error: null }
    }
    if (name === 'finalize_field_test_run') {
      return { data: { id: RUN_ID, run_status: 'ready' }, error: null }
    }
    return { data: null, error: { message: `unexpected rpc ${name}` } }
  })

  const upload = uploadImpl || vi.fn(async () => ({ data: { path: 'ok' }, error: null }))
  const fromSelect = {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
  }

  return {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: sessionUserId ? { user: { id: sessionUserId } } : null },
        error: null,
      })),
    },
    rpc,
    from: vi.fn(() => fromSelect),
    storage: {
      from: vi.fn(() => ({ upload })),
    },
    __upload: upload,
    __rpc: rpc,
  }
}

describe('f10c2 phase4 — supabase result transport', () => {
  it('defaults to mock transport kind when runtime flag is off', () => {
    expect(getResultTransportKind()).toBe('mock_f10c2_phase2')
  })

  it('requires an authenticated session', async () => {
    const supabase = createFakeSupabase({ sessionUserId: null })
    const transport = createSupabaseResultTransport({ supabase, readArtifactBody: async () => 'x' })
    await expect(
      transport.registerResult({
        client_run_id: CLIENT_RUN,
        task_id: 'task-1',
        project_id: 'proj-1',
        scenario_type: 'rf_data',
      }),
    ).rejects.toMatchObject({ code: 'auth_expired_retryable' })
  })

  it('registers, uploads, confirms, and finalizes with injected bytes', async () => {
    const supabase = createFakeSupabase()
    const transport = createSupabaseResultTransport({
      supabase,
      readArtifactBody: async () => new TextEncoder().encode('{"ok":true}'),
    })
    const registered = await transport.registerResult({
      client_run_id: CLIENT_RUN,
      task_id: 'task-1',
      project_id: 'proj-1',
      scenario_type: 'native_http',
      rf_summary: {},
      data_summary: {},
      gps_summary: {},
      events_summary: {},
      device: { model: 'synth' },
    })
    expect(registered.field_test_run_id).toBe(RUN_ID)

    const ticket = await transport.requestArtifactUpload({
      fieldTestRunId: RUN_ID,
      artifact: {
        artifact_id: ART_ID,
        artifact_type: 'unified_json',
        mime_type: 'application/json',
        size_bytes: 11,
        checksum: 'sha256:abc',
        safe_extension: 'json',
        original_file_name: 'report.json',
      },
    })
    expect(ticket.object_key).toContain(ART_ID)

    const uploaded = await transport.uploadArtifact({
      artifactId: ART_ID,
      objectKey: ticket.object_key,
      mimeType: 'application/json',
      body: '{"ok":true}',
    })
    expect(uploaded.ok).toBe(true)
    expect(supabase.__upload).toHaveBeenCalledTimes(1)
    expect(supabase.__upload.mock.calls[0][2]).toMatchObject({ upsert: false })

    const confirmed = await transport.confirmArtifact({ artifactId: ART_ID, checksum: 'sha256:abc' })
    expect(confirmed.artifact.upload_status).toBe('complete')

    const finalized = await transport.finalizeResult({ fieldTestRunId: RUN_ID })
    expect(finalized.run.finalized).toBe(true)
    expect(finalized.run.status).toBe('uploaded')
  })

  it('treats storage already-exists as idempotent success', async () => {
    const supabase = createFakeSupabase({
      uploadImpl: vi.fn(async () => ({ data: null, error: { message: 'The resource already exists', statusCode: '409' } })),
    })
    const transport = createSupabaseResultTransport({ supabase })
    const res = await transport.uploadArtifact({
      artifactId: ART_ID,
      objectKey: 'proj/task/fe/run/art.json',
      body: 'same-bytes',
    })
    expect(res.reason).toBe('idempotent_success')
  })

  it('orchestrator reaches uploaded with supabase transport and local artifact body', async () => {
    const supabase = createFakeSupabase()
    const transport = createSupabaseResultTransport({
      supabase,
      readArtifactBody: async () => 'body',
    })
    const payload = {
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
        scenario_type: 'rf_data',
        device: {},
      },
      local_artifacts: [
        {
          artifact_id: ART_ID,
          artifact_type: 'unified_json',
          mime_type: 'application/json',
          size_bytes: 4,
          checksum: 'sha256:abc',
          safe_extension: 'json',
          original_file_name: 'report.json',
          upload_status: 'pending',
          body: 'body',
        },
      ],
    }
    const result = await processResultPackagePayload(payload, {
      transport,
      currentUser: { id: 'fe-user-1' },
      sessionValid: true,
    })
    expect(result.payload.package_state).toBe(PACKAGE_STATES.UPLOADED)
    expect(result.reason).toBe('uploaded')
  })
})
