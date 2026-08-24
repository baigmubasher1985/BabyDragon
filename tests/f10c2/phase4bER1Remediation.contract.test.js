import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { requestArtifactUploadPlanContract } from '../../src/storage/requestArtifactUploadPlanContract.js'
import { normalizePostgrestMutation } from '../../src/lib/postgrestMutation.js'
import { listPhase4bApplyPlan, PHASE4A_NEVER_EXECUTE, PHASE4B_R1_APPLY } from '../../scripts/f10c2/phase4bApplyPlan.mjs'

const ROOT = process.cwd()
const tenantA = 'tenant-a'
const tenantB = 'tenant-b'

function run() {
  return { id: 'run-1', submitted_by: 'fe-1', tenant_id: tenantA }
}
function artifact(overrides = {}) {
  return {
    id: 'art-1',
    run_id: 'run-1',
    tenant_id: tenantA,
    artifact_type: 'rf_csv',
    checksum: 'sha256:aaa',
    object_key: 't/run/art-1.csv',
    ...overrides,
  }
}
function args(overrides = {}) {
  return {
    sessionUserId: 'fe-1',
    run: run(),
    artifact: artifact(),
    connections: [{
      id: 'conn-a',
      tenant_id: tenantA,
      provider_type: 'supabase',
      bucket_or_container: 'result-artifacts',
      is_default: true,
      is_active: true,
    }],
    p_checksum: 'sha256:aaa',
    p_idempotency_key: 'bound-key',
    jobs: [],
    ...overrides,
  }
}

describe('f10c2 phase4b-e-r1 remediation', () => {
  it('rejects a newly supplied key when an existing artifact job is already bound', () => {
    const result = requestArtifactUploadPlanContract(args({
      jobs: [{
        id: 'job-old',
        tenant_id: tenantA,
        artifact_id: 'art-1',
        operation: 'request_artifact_upload_plan',
        idempotency_key: 'already-bound',
      }],
      p_idempotency_key: 'new-key',
    }))
    expect(result.ok).toBe(false)
    expect(result.code).toBe('idempotency_key_reuse')
  })

  it('rejects the same key on a different artifact, tenant, or operation', () => {
    const jobs = [{
      id: 'job-1',
      tenant_id: tenantA,
      artifact_id: 'art-1',
      operation: 'request_artifact_upload_plan',
      idempotency_key: 'shared-key',
    }]
    expect(requestArtifactUploadPlanContract(args({
      jobs,
      artifact: artifact({ id: 'art-2', object_key: 't/run/art-2.csv' }),
      p_idempotency_key: 'shared-key',
    })).code).toBe('idempotency_key_reuse')

    expect(requestArtifactUploadPlanContract(args({
      jobs: [{ ...jobs[0], tenant_id: tenantB }],
      p_idempotency_key: 'shared-key',
    })).code).toBe('idempotency_key_reuse')

    expect(requestArtifactUploadPlanContract(args({
      jobs: [{ ...jobs[0], operation: 'other_operation' }],
      p_idempotency_key: 'shared-key',
    })).code).toBe('idempotency_key_reuse')
  })

  it('returns the same job for a concurrent-style unique-violation replay of the same triple', () => {
    const first = requestArtifactUploadPlanContract(args())
    const second = requestArtifactUploadPlanContract(args({ jobs: first.jobs }))
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(second.plan.transfer_job_id).toBe(first.plan.transfer_job_id)
    expect(first.jobs).toHaveLength(1)
  })

  it('uses the DEFINER helper in admin Field Results/QC policies and never executes 207', () => {
    const files = [
      'supabase/drafts/f10c2/forward/109_rls_field_test_runs.sql',
      'supabase/drafts/f10c2/forward/110_rls_field_test_artifacts_metrics.sql',
      'supabase/drafts/f10c2/forward/111_rls_field_test_qc_reviews.sql',
      'supabase/drafts/f10c2/phase4b/forward/208_phase4b_validation_remediation.sql',
      'supabase/drafts/f10c2/phase4a/forward/206_rpc_request_artifact_upload_plan.sql',
    ]
    for (const rel of files) {
      const text = fs.readFileSync(path.join(ROOT, rel), 'utf8')
      if (rel.includes('208') || rel.includes('109') || rel.includes('110') || rel.includes('111')) {
        expect(text).toContain('is_admin_or_super_admin()')
        expect(text).not.toMatch(/CREATE POLICY[\s\S]*009/)
      }
      if (rel.includes('206') || rel.includes('208')) {
        expect(text).toContain('supplied idempotency key is validated before any existing-job return')
      }
      expect(text).not.toMatch(/DROP TABLE|TRUNCATE/)
      expect(text).not.toMatch(/nsne[a-z0-9]{4,}/i)
    }
    const slugs = listPhase4bApplyPlan().stages.map((s) => s.slug)
    expect(slugs).toContain('208_phase4b_validation_remediation')
    expect(slugs).toContain('209_disposable_operational_profile_task_rls_remediation')
    expect(slugs).not.toContain('207_rls_tenant_storage_assumptions')
    expect(PHASE4A_NEVER_EXECUTE).toEqual(['207_rls_tenant_storage_assumptions'])
    expect(PHASE4B_R1_APPLY).toEqual(['208_phase4b_validation_remediation'])
  })

  it('normalizes PostgREST zero-row wrappers without treating them as success or error', () => {
    expect(normalizePostgrestMutation({ data: null, error: null }).empty).toBe(true)
    expect(normalizePostgrestMutation({ data: [], error: null }).count).toBe(0)
    expect(normalizePostgrestMutation({ data: { qc_notes: 'x' }, error: null }).count).toBe(1)
    expect(normalizePostgrestMutation({ data: [{ id: 1 }], error: null, count: 1 }).count).toBe(1)
    expect(normalizePostgrestMutation({ data: null, error: { message: 'denied' } }).empty).toBe(false)
  })
})
