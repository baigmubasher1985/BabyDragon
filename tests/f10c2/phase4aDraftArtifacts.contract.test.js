import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const ROOT = process.cwd()
const DRAFTS = path.join(ROOT, 'supabase', 'drafts', 'f10c2', 'phase4a')

const SLUGS = [
  '201_tenants',
  '202_storage_connections',
  '203_tenant_storage_policies',
  '204_field_test_artifacts_tenant_columns',
  '205_artifact_transfer_jobs',
  '206_rpc_request_artifact_upload_plan',
  '207_rls_tenant_storage_assumptions',
]

const REQUIRED_HEADER = [
  '-- DRAFT / UNAPPLIED / DO NOT RUN',
  '-- F10C2 PHASE 4A',
  '-- NO DATABASE TARGET AUTHORIZED',
]

const EXECUTABLE_DDL =
  /\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|GRANT|REVOKE|BEGIN|COMMIT)\b/i

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

function stripSqlComments(text) {
  let out = text
    .split(/\r?\n/)
    .map((l) => {
      const trimmed = l.trim()
      if (trimmed.startsWith('--')) return ''
      const idx = l.indexOf('--')
      return idx >= 0 ? l.slice(0, idx) : l
    })
    .join('\n')
  out = out.replace(/\/\*[\s\S]*?\*\//g, '')
  return out
}

function listSql(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

describe('f10c2 phase4a — draft pairing', () => {
  it('has matching forward/rollback/verification for 201–207 only', () => {
    const fwd = listSql(path.join(DRAFTS, 'forward'))
    const rb = listSql(path.join(DRAFTS, 'rollback'))
    const vf = listSql(path.join(DRAFTS, 'verification'))
    const expected = SLUGS.map((s) => `${s}.sql`)
    expect(fwd).toEqual(expected)
    expect(rb).toEqual(fwd)
    expect(vf).toEqual(fwd)
  })

  it('does not place Phase 4A slugs in the Phase 1/4 forward folder', () => {
    const legacyFwd = listSql(path.join(ROOT, 'supabase', 'drafts', 'f10c2', 'forward'))
    expect(legacyFwd.some((f) => /^20[1-7]_/.test(f))).toBe(false)
  })

  it('every Phase 4A draft starts with the safety header', () => {
    for (const dir of ['forward', 'rollback', 'verification']) {
      for (const slug of SLUGS) {
        const text = read(path.join('supabase', 'drafts', 'f10c2', 'phase4a', dir, `${slug}.sql`))
        expect(text.startsWith(REQUIRED_HEADER[0])).toBe(true)
        for (const line of REQUIRED_HEADER) {
          expect(text).toContain(line)
        }
      }
    }
  })

  it('204 keeps tenant columns nullable and relaxes only the result-artifacts equality', () => {
    const text = read(
      'supabase/drafts/f10c2/phase4a/forward/204_field_test_artifacts_tenant_columns.sql',
    )
    expect(text).toMatch(/ADD COLUMN IF NOT EXISTS tenant_id uuid NULL/)
    expect(text).toContain('task-photos')
    expect(text).toContain('operational-evidence')
    expect(text).toContain('DROP CONSTRAINT IF EXISTS field_test_artifacts_bucket_not_legacy')
    expect(text).not.toMatch(/tenant_id uuid NOT NULL/)
  })

  it('202 stores secret_reference only', () => {
    const text = read('supabase/drafts/f10c2/phase4a/forward/202_storage_connections.sql')
    expect(text).toContain('secret_reference')
    expect(text).toContain('storage_connections_secret_not_plaintext')
    expect(text).not.toMatch(/access_key_id\s+text/)
    expect(text).not.toMatch(/service_role_key\s+text/)
  })

  it('207 remains documentation-only with no executable DDL', () => {
    const text = read(
      'supabase/drafts/f10c2/phase4a/forward/207_rls_tenant_storage_assumptions.sql',
    )
    expect(text).toContain('CLASSIFICATION: (b) blocked documentation-only')
    expect(text).toContain('Phase 4B must validate the Phase 4A-R1 relational model')
    const body = stripSqlComments(text)
    expect(EXECUTABLE_DDL.test(body)).toBe(false)
    expect(body).toMatch(/phase4a_tenant_rls_assumptions_unapplied/)
  })

  it('202–205 enforce same-tenant composite FKs and RESTRICT tenant deletes', () => {
    const conn = read('supabase/drafts/f10c2/phase4a/forward/202_storage_connections.sql')
    expect(conn).toContain('UNIQUE (tenant_id, id)')
    expect(conn).toContain('ON DELETE RESTRICT')
    expect(conn).toContain('DEFENSE-IN-DEPTH only')
    expect(conn).not.toContain('ON DELETE CASCADE')

    const policies = read('supabase/drafts/f10c2/phase4a/forward/203_tenant_storage_policies.sql')
    expect(policies).toContain('tenant_storage_policies_connection_same_tenant')
    expect(policies).toContain('FOREIGN KEY (tenant_id, storage_connection_id)')
    expect(policies).toContain('REFERENCES public.storage_connections (tenant_id, id)')
    expect(policies).toContain('ON DELETE RESTRICT')

    const arts = read(
      'supabase/drafts/f10c2/phase4a/forward/204_field_test_artifacts_tenant_columns.sql',
    )
    expect(arts).toContain('field_test_artifacts_run_same_tenant')
    expect(arts).toContain('FOREIGN KEY (run_id, tenant_id)')
    expect(arts).toContain('field_test_artifacts_connection_same_tenant')
    expect(arts).toContain('FOREIGN KEY (tenant_id, storage_connection_id)')
    expect(arts).toContain('storage_connection_id IS NULL OR tenant_id IS NOT NULL')
    expect(arts).toMatch(/ADD COLUMN IF NOT EXISTS tenant_id uuid NULL/)
    expect(arts).not.toMatch(/tenant_id uuid NOT NULL/)

    const jobs = read('supabase/drafts/f10c2/phase4a/forward/205_artifact_transfer_jobs.sql')
    expect(jobs).toContain('artifact_transfer_jobs_artifact_same_tenant')
    expect(jobs).toContain('FOREIGN KEY (artifact_id, tenant_id)')
    expect(jobs).toContain('UNIQUE (tenant_id, idempotency_key)')
    expect(jobs).toContain('UNIQUE (tenant_id, artifact_id, operation)')
    expect(jobs).toContain('ON DELETE RESTRICT')
  })

  it('206 uses persisted artifact_type, binds idempotency, and derives destination', () => {
    const rpc = read(
      'supabase/drafts/f10c2/phase4a/forward/206_rpc_request_artifact_upload_plan.sql',
    )
    expect(rpc).toContain("p_artifact_type IS DISTINCT FROM v_art.artifact_type")
    expect(rpc).toContain('artifact_type_mismatch')
    expect(rpc).toContain('AND p.artifact_type = v_art.artifact_type')
    expect(rpc).not.toContain('COALESCE(p_artifact_type, v_art.artifact_type)')
    expect(rpc).toContain('idempotency_key_required')
    expect(rpc).toContain('idempotency_key_reuse')
    expect(rpc).toContain('unique_violation')
    expect(rpc).toContain("v_bucket := COALESCE(v_connection.bucket_or_container, 'result-artifacts')")
    expect(rpc).not.toMatch(/'bucket',\s*v_art\.bucket/)
    expect(rpc).toContain('provider_not_implemented')
    expect(rpc).toContain("'public_url', NULL")
    expect(rpc).toContain("'secret_material', NULL")
    expect(rpc).toContain("'expires_at'")
    expect(rpc).toContain("'mode', 'existing_session'")
  })

  it('rollback and verification stay paired and mention new constraints', () => {
    const rb204 = read(
      'supabase/drafts/f10c2/phase4a/rollback/204_field_test_artifacts_tenant_columns.sql',
    )
    expect(rb204).toContain('field_test_artifacts_run_same_tenant')
    expect(rb204).toContain('field_test_artifacts_connection_same_tenant')
    const vf203 = read(
      'supabase/drafts/f10c2/phase4a/verification/203_tenant_storage_policies.sql',
    )
    expect(vf203).toContain('tenant_storage_policies_connection_same_tenant')
    const vf205 = read(
      'supabase/drafts/f10c2/phase4a/verification/205_artifact_transfer_jobs.sql',
    )
    expect(vf205).toContain('artifact_transfer_jobs_artifact_same_tenant')
    expect(vf205).toContain('artifact_transfer_jobs_artifact_operation_unique')
  })
})
