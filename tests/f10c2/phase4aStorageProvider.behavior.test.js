import { describe, it, expect, vi } from 'vitest'
import {
  ARTIFACT_STORAGE_METHODS,
  PROVIDER_TYPES,
} from '../../src/storage/artifactStorageTypes.js'
import { assertArtifactStorageProvider } from '../../src/storage/artifactStorageProvider.js'
import { createMockArtifactStorageProvider } from '../../src/storage/providers/mockArtifactStorageProvider.js'
import { createSupabaseArtifactStorageProvider } from '../../src/storage/providers/supabaseArtifactStorageProvider.js'
import { createArtifactStorageProvider } from '../../src/storage/createArtifactStorageProvider.js'
import { normalizeProviderError } from '../../src/storage/normalizeProviderError.js'
import { createSupabaseResultTransport } from '../../src/mobile/rf/submission/supabaseResultTransport.js'
import {
  assertUploadPlanSafe,
  applyUploadPlanToArtifact,
  buildClientUploadRequest,
} from '../../src/mobile/rf/submission/artifactUploadPlan.js'

function createFakeStorageClient({
  uploadError = null,
  signedUrl = 'https://signed.example.invalid/obj?token=redacted',
  list = [],
} = {}) {
  const upload = vi.fn(async () => ({ data: uploadError ? null : { path: 'ok' }, error: uploadError }))
  const createSignedUrl = vi.fn(async () => ({
    data: signedUrl ? { signedUrl } : null,
    error: signedUrl ? null : { message: 'signed_url_failed' },
  }))
  const listFn = vi.fn(async () => ({ data: list, error: null }))
  return {
    storage: {
      from: vi.fn(() => ({
        upload,
        createSignedUrl,
        list: listFn,
      })),
    },
    __upload: upload,
    __createSignedUrl: createSignedUrl,
  }
}

describe('f10c2 phase4a — ArtifactStorageProvider interface', () => {
  it('requires every contract method', () => {
    const mock = createMockArtifactStorageProvider()
    expect(() => assertArtifactStorageProvider(mock)).not.toThrow()
    for (const method of ARTIFACT_STORAGE_METHODS) {
      expect(typeof mock[method]).toBe('function')
    }
  })

  it('mock plan, confirm, idempotent retry, and authorized delete', async () => {
    const provider = createMockArtifactStorageProvider()
    const plan = await provider.createUploadPlan({
      objectKey: 'tenant/run/art-1.json',
      artifactId: 'art-1',
      checksum: 'sha256:abc',
      sizeBytes: 12,
    })
    expect(plan.public_url).toBeNull()
    expect(plan.expires_in_seconds).toBeGreaterThan(0)
    expect(assertUploadPlanSafe(plan).ok).toBe(true)

    const first = await provider.confirmUpload({
      objectKey: 'tenant/run/art-1.json',
      checksum: 'sha256:abc',
      sizeBytes: 12,
    })
    const second = await provider.confirmUpload({
      objectKey: 'tenant/run/art-1.json',
      checksum: 'sha256:abc',
      sizeBytes: 12,
    })
    expect(first.reason).toBe('confirmed')
    expect(second.reason).toBe('idempotent_success')
    expect(await provider.objectExists({ objectKey: 'tenant/run/art-1.json' })).toBe(true)

    await expect(provider.deleteArtifact({ objectKey: 'tenant/run/art-1.json' }))
      .rejects.toMatchObject({ code: 'retention_forbidden' })
    await expect(provider.deleteArtifact({
      objectKey: 'tenant/run/art-1.json',
      authorized: true,
    })).resolves.toMatchObject({ ok: true })
  })

  it('rejects signed URLs as durable object keys', async () => {
    const provider = createMockArtifactStorageProvider()
    await expect(
      provider.createUploadPlan({ objectKey: 'https://signed.example.invalid/x' }),
    ).rejects.toMatchObject({ code: 'invalid_manifest' })
  })

  it('supabase provider uses session upload and createSignedUrl, never getPublicUrl', async () => {
    const supabase = createFakeStorageClient({
      list: [{ name: 'art-1.json' }],
    })
    const provider = createSupabaseArtifactStorageProvider({ supabase })
    const plan = await provider.createUploadPlan({
      objectKey: 'proj/task/fe/run/art-1.json',
      artifactId: 'art-1',
    })
    expect(plan.provider_type).toBe(PROVIDER_TYPES.SUPABASE)
    expect(plan.authorization.mode).toBe('existing_session')

    const confirmed = await provider.confirmUpload({
      objectKey: 'proj/task/fe/run/art-1.json',
      body: '{"ok":true}',
      mimeType: 'application/json',
    })
    expect(confirmed.ok).toBe(true)
    expect(supabase.__upload.mock.calls[0][2]).toMatchObject({ upsert: false })

    const exists = await provider.objectExists({ objectKey: 'proj/task/fe/run/art-1.json' })
    expect(exists).toBe(true)

    const access = await provider.createAuthorizedReadAccess({
      objectKey: 'proj/task/fe/run/art-1.json',
      filename: 'report.json',
    })
    expect(access.mode).toBe('signed_url')
    expect(access.public_url).toBeNull()
    expect(access.signed_url).toBeTruthy()
    expect(supabase.storage.from).toBeDefined()
    expect(JSON.stringify(provider)).not.toMatch(/getPublicUrl/)
  })

  it('treats already-exists upload as idempotent success', async () => {
    const supabase = createFakeStorageClient({
      uploadError: { message: 'The resource already exists', statusCode: '409' },
    })
    const provider = createSupabaseArtifactStorageProvider({ supabase })
    const result = await provider.confirmUpload({
      objectKey: 'proj/task/fe/run/art-1.json',
      checksum: 'sha256:abc',
    })
    expect(result.reason).toBe('idempotent_success')
  })

  it('resumes a partial mock upload via resumable session then idempotent confirm', async () => {
    const provider = createMockArtifactStorageProvider()
    const objectKey = 'tenant/run/partial.json'
    const session = await provider.createResumableUploadSession({
      objectKey,
      artifactId: 'art-partial',
    })
    expect(session.supported).toBe(true)
    expect(session.session_id).toMatch(/mock-resume-/)

    const first = await provider.confirmUpload({
      objectKey,
      checksum: 'sha256:partial',
      sizeBytes: 40,
    })
    expect(first.reason).toBe('confirmed')

    const resumed = await provider.confirmUpload({
      objectKey,
      checksum: 'sha256:partial',
      sizeBytes: 40,
    })
    expect(resumed.reason).toBe('idempotent_success')
    expect(await provider.objectExists({ objectKey })).toBe(true)
  })

  it('factory returns fail-closed stubs for unimplemented connectors', async () => {
    const stub = createArtifactStorageProvider({ kind: PROVIDER_TYPES.S3_COMPATIBLE })
    expect(stub.implemented).toBe(false)
    const health = await stub.healthCheck()
    expect(health.status).toBe('not_implemented')
    await expect(stub.createUploadPlan({ objectKey: 'x' }))
      .rejects.toMatchObject({ code: 'provider_not_implemented' })
  })

  it('normalizes provider errors without leaking tokens or URLs', () => {
    const mapped = normalizeProviderError({
      message: 'Authorization: Bearer eyJabc.def.ghi failed https://secret.example/path',
    })
    expect(mapped.sanitized).not.toMatch(/eyJ/)
    expect(mapped.sanitized).not.toMatch(/https:\/\//)
    expect(mapped.kind).toBe('retryable')

    const terminal = normalizeProviderError({ code: 'checksum_mismatch', message: 'checksum' })
    expect(terminal.kind).toBe('terminal')
    expect(terminal.code).toBe('checksum_mismatch')
  })

  it('client upload request never embeds server secrets', () => {
    const req = buildClientUploadRequest({
      clientRunId: 'client-1',
      manifest: { client_run_id: 'client-1' },
      artifact: {
        artifact_id: 'art-1',
        artifact_type: 'unified_json',
        mime_type: 'application/json',
        size_bytes: 4,
        checksum: 'sha256:x',
      },
      tenantSlug: 'acme',
    })
    expect(req.idempotency_key).toBe('client-1:art-1')
    const blob = JSON.stringify(req)
    expect(blob).not.toMatch(/service_role|secret_access_key|client_secret/)
  })

  it('rejects an upload plan that carries secret material', () => {
    expect(assertUploadPlanSafe({
      object_key: 'ok',
      expires_in_seconds: 60,
      service_role: 'should-never-appear',
    }).ok).toBe(false)
    expect(() => applyUploadPlanToArtifact({ artifact_id: 'a' }, {
      object_key: 'https://x',
      expires_in_seconds: 60,
    })).toThrow(/invalid_object_key/)
  })

  it('supabase result transport returns a provider-neutral upload_plan', async () => {
    const supabase = {
      auth: {
        getSession: vi.fn(async () => ({
          data: { session: { user: { id: 'fe-1' } } },
          error: null,
        })),
      },
      rpc: vi.fn(async () => ({
        data: {
          id: 'art-1',
          object_key: 'proj/task/fe-1/run/art-1.json',
          bucket: 'result-artifacts',
        },
        error: null,
      })),
      storage: { from: vi.fn(() => ({ upload: vi.fn() })) },
    }
    const transport = createSupabaseResultTransport({ supabase })
    const ticket = await transport.requestArtifactUpload({
      fieldTestRunId: 'run-1',
      artifact: {
        artifact_id: 'art-1',
        artifact_type: 'unified_json',
        mime_type: 'application/json',
        size_bytes: 8,
        checksum: 'sha256:x',
      },
    })
    expect(ticket.upload_plan.object_key).toBe('proj/task/fe-1/run/art-1.json')
    expect(ticket.upload_plan.public_url).toBeNull()
    expect(assertUploadPlanSafe(ticket.upload_plan).ok).toBe(true)
  })
})
