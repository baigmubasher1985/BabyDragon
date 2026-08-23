import { describe, it, expect } from 'vitest'
import { PROVIDER_TYPES } from '../../src/storage/artifactStorageTypes.js'
import { selectStoragePolicy } from '../../src/storage/storagePolicyRouter.js'
import {
  assertPolicyConnectionSameTenant,
  assertArtifactRunSameTenant,
  assertArtifactConnectionSameTenant,
  assertTransferJobArtifactSameTenant,
  assertPersistedArtifactType,
  deriveTrustedDestination,
} from '../../src/storage/tenantStorageIntegrity.js'
import { requestArtifactUploadPlanContract } from '../../src/storage/requestArtifactUploadPlanContract.js'
import { createArtifactStorageProvider } from '../../src/storage/createArtifactStorageProvider.js'
import { createMockArtifactStorageProvider } from '../../src/storage/providers/mockArtifactStorageProvider.js'
import { assertUploadPlanSafe } from '../../src/mobile/rf/submission/artifactUploadPlan.js'

const tenantA = 'tenant-a'
const tenantB = 'tenant-b'

function baseRun(overrides = {}) {
  return {
    id: 'run-1',
    submitted_by: 'fe-1',
    tenant_id: tenantA,
    ...overrides,
  }
}

function baseArtifact(overrides = {}) {
  return {
    id: 'art-1',
    run_id: 'run-1',
    tenant_id: tenantA,
    artifact_type: 'rf_csv',
    checksum: 'sha256:aaa',
    object_key: 't-a/run-1/art-1.csv',
    provider_object_id: 'art-1',
    ...overrides,
  }
}

function supabaseConn(tenantId = tenantA, id = 'conn-a') {
  return {
    id,
    tenant_id: tenantId,
    provider_type: PROVIDER_TYPES.SUPABASE,
    bucket_or_container: 'result-artifacts',
    is_default: true,
    is_active: true,
  }
}

describe('f10c2 phase4a-r1 — tenant storage integrity', () => {
  it('rejects a policy that references another tenant’s connection', () => {
    const policy = {
      tenant_id: tenantA,
      artifact_type: 'rf_csv',
      storage_connection_id: 'conn-b',
    }
    const connection = supabaseConn(tenantB, 'conn-b')
    expect(assertPolicyConnectionSameTenant({ policy, connection }).code)
      .toBe('storage_connection_cross_tenant')

    const selected = selectStoragePolicy({
      artifactType: 'rf_csv',
      tenantId: tenantA,
      policies: [policy],
      connections: [supabaseConn(tenantA, 'conn-a'), connection],
    })
    expect(selected.ok).toBe(false)
    expect(selected.code).toBe('storage_connection_cross_tenant')
  })

  it('allows NULL storage_connection_id as fallback to the tenant default', () => {
    const selected = selectStoragePolicy({
      artifactType: 'gps_csv',
      tenantId: tenantA,
      policies: [{ tenant_id: tenantA, artifact_type: 'gps_csv', storage_connection_id: null }],
      connections: [supabaseConn()],
      defaultConnectionId: 'conn-a',
    })
    expect(selected.ok).toBe(true)
    expect(selected.connection.id).toBe('conn-a')
  })

  it('rejects artifact tenant_id that differs from its run', () => {
    expect(assertArtifactRunSameTenant({
      artifact: baseArtifact({ tenant_id: tenantB }),
      run: baseRun({ tenant_id: tenantA }),
    }).code).toBe('tenant_mismatch')
  })

  it('accepts legacy rows where both artifact and run tenant_id are null', () => {
    const result = assertArtifactRunSameTenant({
      artifact: baseArtifact({ tenant_id: null }),
      run: baseRun({ tenant_id: null }),
    })
    expect(result.ok).toBe(true)
    expect(result.code).toBe('legacy_nullable_tenant')
  })

  it('rejects an artifact connection owned by another tenant', () => {
    expect(assertArtifactConnectionSameTenant({
      artifact: baseArtifact({ storage_connection_id: 'conn-b' }),
      connection: supabaseConn(tenantB, 'conn-b'),
    }).code).toBe('storage_connection_cross_tenant')
  })

  it('rejects a connection assignment when artifact tenant_id is still null', () => {
    expect(assertArtifactConnectionSameTenant({
      artifact: baseArtifact({ tenant_id: null, storage_connection_id: 'conn-a' }),
      connection: supabaseConn(),
    }).code).toBe('connection_requires_tenant')
  })

  it('rejects a transfer job whose tenant differs from the artifact tenant', () => {
    expect(assertTransferJobArtifactSameTenant({
      job: { tenant_id: tenantB, artifact_id: 'art-1' },
      artifact: baseArtifact(),
    }).code).toBe('tenant_mismatch')
  })

  it('rejects caller-controlled artifact_type that does not match the persisted type', () => {
    expect(assertPersistedArtifactType({
      requestedType: 'excel_plot',
      persistedType: 'rf_csv',
    }).code).toBe('artifact_type_mismatch')

    const result = requestArtifactUploadPlanContract({
      sessionUserId: 'fe-1',
      run: baseRun(),
      artifact: baseArtifact(),
      connections: [supabaseConn()],
      p_artifact_type: 'excel_plot',
      p_checksum: 'sha256:aaa',
      p_idempotency_key: 'run-1:art-1:request_artifact_upload_plan',
    })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('artifact_type_mismatch')
  })

  it('selects policy using persisted artifact_type even if caller omits type', () => {
    const result = requestArtifactUploadPlanContract({
      sessionUserId: 'fe-1',
      run: baseRun(),
      artifact: baseArtifact(),
      policies: [
        {
          tenant_id: tenantA,
          artifact_type: 'rf_csv',
          storage_connection_id: 'conn-a',
        },
        {
          tenant_id: tenantA,
          artifact_type: 'excel_plot',
          storage_connection_id: 'conn-other',
        },
      ],
      connections: [supabaseConn()],
      p_artifact_type: null,
      p_checksum: 'sha256:aaa',
      p_idempotency_key: 'run-1:art-1:request_artifact_upload_plan',
    })
    expect(result.ok).toBe(true)
    expect(result.plan.artifact_type).toBe('rf_csv')
    expect(result.plan.bucket).toBe('result-artifacts')
  })

  it('rejects a blank idempotency key', () => {
    const blank = requestArtifactUploadPlanContract({
      sessionUserId: 'fe-1',
      run: baseRun(),
      artifact: baseArtifact(),
      connections: [supabaseConn()],
      p_checksum: 'sha256:aaa',
      p_idempotency_key: '   ',
    })
    expect(blank.code).toBe('idempotency_key_required')
  })

  it('rejects a new key when an existing artifact job is already bound', () => {
    const result = requestArtifactUploadPlanContract({
      sessionUserId: 'fe-1',
      run: baseRun(),
      artifact: baseArtifact(),
      connections: [supabaseConn()],
      jobs: [{
        id: 'job-bound',
        tenant_id: tenantA,
        artifact_id: 'art-1',
        operation: 'request_artifact_upload_plan',
        idempotency_key: 'already-bound',
      }],
      p_checksum: 'sha256:aaa',
      p_idempotency_key: 'different-key',
    })
    expect(result.code).toBe('idempotency_key_reuse')
  })

  it('rejects reusing an idempotency key for a different artifact', () => {
    const jobs = [{
      id: 'job-art-1',
      tenant_id: tenantA,
      artifact_id: 'art-1',
      operation: 'request_artifact_upload_plan',
      idempotency_key: 'shared-key',
    }]
    const result = requestArtifactUploadPlanContract({
      sessionUserId: 'fe-1',
      run: baseRun(),
      artifact: baseArtifact({ id: 'art-2', object_key: 't-a/run-1/art-2.csv' }),
      connections: [supabaseConn()],
      jobs,
      p_checksum: 'sha256:aaa',
      p_idempotency_key: 'shared-key',
    })
    expect(result.code).toBe('idempotency_key_reuse')
  })

  it('returns the same transfer job for a repeated request', () => {
    const jobs = []
    const args = {
      sessionUserId: 'fe-1',
      run: baseRun(),
      artifact: baseArtifact(),
      connections: [supabaseConn()],
      jobs,
      p_checksum: 'sha256:aaa',
      p_idempotency_key: 'run-1:art-1:request_artifact_upload_plan',
    }
    const first = requestArtifactUploadPlanContract(args)
    const second = requestArtifactUploadPlanContract({ ...args, jobs: first.jobs })
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(second.plan.transfer_job_id).toBe(first.plan.transfer_job_id)
    expect(second.plan.object_key).toBe(first.plan.object_key)
    expect(second.plan.bucket).toBe(first.plan.bucket)
    expect(first.jobs).toHaveLength(1)
  })

  it('derives destination from the trusted connection and ignores a client bucket', () => {
    const derived = deriveTrustedDestination({
      connection: { bucket_or_container: 'result-artifacts' },
    })
    expect(derived.ok).toBe(true)
    expect(derived.bucket).toBe('result-artifacts')
    expect(deriveTrustedDestination({
      connection: { bucket_or_container: 'task-photos' },
    }).code).toBe('banned_bucket')

    const result = requestArtifactUploadPlanContract({
      sessionUserId: 'fe-1',
      run: baseRun(),
      artifact: baseArtifact({ bucket: 'task-photos' }),
      connections: [supabaseConn()],
      p_checksum: 'sha256:aaa',
      p_idempotency_key: 'run-1:art-1:request_artifact_upload_plan',
    })
    expect(result.ok).toBe(true)
    expect(result.plan.bucket).toBe('result-artifacts')
    expect(result.plan.bucket).not.toBe('task-photos')
  })

  it('returns no secrets or public URLs and enough fields for session upload', () => {
    const result = requestArtifactUploadPlanContract({
      sessionUserId: 'fe-1',
      run: baseRun(),
      artifact: baseArtifact(),
      connections: [supabaseConn()],
      p_checksum: 'sha256:aaa',
      p_idempotency_key: 'run-1:art-1:request_artifact_upload_plan',
    })
    expect(result.plan.public_url).toBeNull()
    expect(result.plan.secret_material).toBeNull()
    expect(result.plan.authorization.mode).toBe('existing_session')
    expect(result.plan.method).toBe('session_scoped_put')
    expect(result.plan.expires_in_seconds).toBeGreaterThan(0)
    expect(result.plan.expires_at).toBeTruthy()
    expect(assertUploadPlanSafe(result.plan).ok).toBe(true)
    expect(JSON.stringify(result.plan)).not.toMatch(/service_role|secret_access_key|eyJ/)
  })

  it('fails closed for unimplemented providers', () => {
    const result = requestArtifactUploadPlanContract({
      sessionUserId: 'fe-1',
      run: baseRun(),
      artifact: baseArtifact(),
      policies: [{
        tenant_id: tenantA,
        artifact_type: 'rf_csv',
        storage_connection_id: 'conn-s3',
      }],
      connections: [{
        id: 'conn-s3',
        tenant_id: tenantA,
        provider_type: PROVIDER_TYPES.S3_COMPATIBLE,
        bucket_or_container: 'customer-bucket',
        is_active: true,
      }],
      p_checksum: 'sha256:aaa',
      p_idempotency_key: 'run-1:art-1:request_artifact_upload_plan',
    })
    expect(result.code).toBe('provider_not_implemented')
    const stub = createArtifactStorageProvider({ kind: PROVIDER_TYPES.AZURE_BLOB })
    expect(stub.implemented).toBe(false)
  })

  it('keeps mock provider regression green', async () => {
    const provider = createMockArtifactStorageProvider()
    const plan = await provider.createUploadPlan({
      objectKey: 'tenant/run/art-1.json',
      artifactId: 'art-1',
    })
    expect(plan.public_url).toBeNull()
    expect(assertUploadPlanSafe(plan).ok).toBe(true)
  })
})
