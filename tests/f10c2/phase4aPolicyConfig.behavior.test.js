import { describe, it, expect } from 'vitest'
import {
  DEPLOYMENT_MODES,
  PROCESSING_LOCATIONS,
  PROVIDER_TYPES,
} from '../../src/storage/artifactStorageTypes.js'
import {
  selectStoragePolicy,
  assertTenantScope,
  filterArtifactsForTenant,
} from '../../src/storage/storagePolicyRouter.js'
import { validateDeploymentConfig } from '../../src/storage/deploymentConfig.js'
import {
  mayTransferRawEvidence,
  buildCustomerWorkerJob,
  resolveProcessingLocation,
} from '../../src/processing/customerWorkerContract.js'
import { mapFieldTestRunRow } from '../../src/fieldResults/repository/mapFieldTestRunRow.js'

describe('f10c2 phase4a — policy, tenant scope, and config', () => {
  it('routes artifact types to the matching tenant connection', () => {
    const selected = selectStoragePolicy({
      artifactType: 'rf_csv',
      defaultConnectionId: 'conn-default',
      policies: [
        { artifact_type: 'rf_csv', storage_connection_id: 'conn-minio', processing_location: 'customer_worker' },
      ],
      connections: [
        { id: 'conn-default', provider_type: 'supabase', is_active: true },
        { id: 'conn-minio', provider_type: 'minio', is_active: true },
      ],
    })
    expect(selected.ok).toBe(true)
    expect(selected.connection.id).toBe('conn-minio')
    expect(selected.policy.processing_location).toBe('customer_worker')
  })

  it('falls back to the tenant default connection when no type policy exists', () => {
    const selected = selectStoragePolicy({
      artifactType: 'gps_csv',
      defaultConnectionId: 'conn-default',
      policies: [],
      connections: [{ id: 'conn-default', provider_type: 'supabase', is_active: true }],
    })
    expect(selected.ok).toBe(true)
    expect(selected.connection.id).toBe('conn-default')
  })

  it('fails closed when the selected connection is inactive', () => {
    const selected = selectStoragePolicy({
      artifactType: 'excel_plot',
      policies: [{ artifact_type: 'excel_plot', storage_connection_id: 'conn-dead' }],
      connections: [{ id: 'conn-dead', is_active: false }],
    })
    expect(selected.ok).toBe(false)
    expect(selected.code).toBe('storage_connection_inactive')
  })

  it('keeps tenant artifact selection isolated', () => {
    expect(assertTenantScope({ actorTenantId: 't1', recordTenantId: 't2' }).code).toBe('tenant_mismatch')
    expect(assertTenantScope({ actorTenantId: 't1', recordTenantId: 't1' }).ok).toBe(true)
    const visible = filterArtifactsForTenant(
      [
        { artifact_id: 'a', tenant_id: 't1' },
        { artifact_id: 'b', tenant_id: 't2' },
        { artifact_id: 'legacy', tenant_id: null },
      ],
      't1',
    )
    expect(visible.map((a) => a.artifact_id)).toEqual(['a', 'legacy'])
  })

  it('customer-worker jobs never transfer raw evidence', () => {
    expect(resolveProcessingLocation({ processing_location: PROCESSING_LOCATIONS.CUSTOMER_WORKER }).ok).toBe(true)
    expect(mayTransferRawEvidence({
      deploymentMode: DEPLOYMENT_MODES.HYBRID_CUSTOMER_STORAGE,
      processingLocation: PROCESSING_LOCATIONS.CUSTOMER_WORKER,
      allowCloudPreview: true,
    })).toBe(false)
    expect(mayTransferRawEvidence({
      deploymentMode: DEPLOYMENT_MODES.FULLY_PRIVATE,
      processingLocation: PROCESSING_LOCATIONS.MOBBI_CLOUD,
      allowCloudPreview: true,
    })).toBe(false)
    const job = buildCustomerWorkerJob({
      tenantId: 't1',
      artifactId: 'art-1',
      objectKey: 'acme/run/art-1.csv',
      checksum: 'sha256:x',
    })
    expect(job.ok).toBe(true)
    expect(job.job.transfer_raw_evidence).toBe(false)
  })

  it('validates public deployment config and rejects client secrets', () => {
    const ok = validateDeploymentConfig({
      deploymentMode: DEPLOYMENT_MODES.MOBBITECH_SAAS,
      defaultProvider: PROVIDER_TYPES.MOCK,
      enabledProviders: [PROVIDER_TYPES.MOCK, PROVIDER_TYPES.SUPABASE],
      processingLocation: PROCESSING_LOCATIONS.MOBBI_CLOUD,
      apiBaseUrl: 'https://api.example.invalid',
    })
    expect(ok.ok).toBe(true)

    const badMode = validateDeploymentConfig({ deploymentMode: 'unknown-cloud' })
    expect(badMode.ok).toBe(false)

    const secret = validateDeploymentConfig({
      deploymentMode: DEPLOYMENT_MODES.MOBBITECH_SAAS,
      SUPABASE_SERVICE_ROLE_KEY: 'sk-should-never-be-here',
    })
    expect(secret.ok).toBe(false)
    expect(secret.errors.some((e) => e.code === 'client_secret_forbidden')).toBe(true)
  })

  it('missing evidence stays missing and is never coerced to zero', () => {
    const mapped = mapFieldTestRunRow({
      run: {
        id: 'run-1',
        client_run_id: 'client-1',
        tenant_id: 't1',
        scenario_type: 'native_http',
        run_status: 'partial',
        rf_summary: { notes: 'rf present, averages unavailable' },
        data_summary: {},
      },
      artifacts: [
        {
          id: 'art-missing',
          artifact_type: 'rf_csv',
          upload_status: 'pending',
          object_key: 't1/run-1/art-missing.csv',
          tenant_id: 't1',
        },
      ],
    })
    expect(mapped.tenant_id).toBe('t1')
    expect(mapped.rf_summary.serving_rsrp_avg).toBeUndefined()
    expect(mapped.attempt_counts.completed).toBeNull()
    expect(mapped.artifacts[0].missing).toBe(true)
    expect(mapped.artifacts[0].available).toBe(false)
    expect(mapped.artifacts[0].size_bytes ?? null).not.toBe(0)
  })
})
