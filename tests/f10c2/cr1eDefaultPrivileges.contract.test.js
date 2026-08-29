/**
 * CR1-E-R1 — local/static 217 default-privilege contracts.
 * No database connection. No SQL apply. Simulates ACL expectations only.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { CR1E_DRAFT_ONLY } from '../../scripts/f10c2/phase4bApplyPlan.mjs'
import { PERMANENT_STAGING_FORWARD_PATHS } from '../../scripts/f10c2/permanentStagingApplyPlan.mjs'

const ROOT = process.cwd()
const SLUG = '217_cr1e_staging_grant_hardening'
const FORBIDDEN = /\b(DROP\s+DATABASE|TRUNCATE|DROP\s+TABLE)\b/i
const MANAGED_SCHEMAS = /\bIN SCHEMA\s+(storage|auth|realtime|extensions|vault|graphql_public)\b/i

const WORKFLOW = [
  'field_test_runs',
  'field_test_artifacts',
  'field_test_metrics',
  'field_test_qc_reviews',
  'field_test_iterations',
  'field_test_call_events',
  'field_test_run_acceptance_snapshots',
  'field_test_iteration_evaluations',
  'field_test_call_summaries',
  'qc_verdict_overrides',
  'acceptance_profiles',
  'acceptance_rules',
]
const SERVER_ONLY = [
  'tenants',
  'storage_connections',
  'tenant_storage_policies',
  'artifact_transfer_jobs',
]

const CLIENT_ROLES = ['PUBLIC', 'anon', 'authenticated']
const TABLE_WRITE = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'MAINTAIN']
const CAPTURED_TABLE_CLIENT = [
  'DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE',
]
const RECOVERY_TABLE_CLIENT = [
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REFERENCES', 'TRIGGER',
]
const RECOVERY_SEQ_CLIENT = ['USAGE', 'SELECT', 'UPDATE']
const RECOVERY_FUN_CLIENT = ['EXECUTE']

function readPair(role) {
  return fs.readFileSync(
    path.join(ROOT, 'supabase/drafts/f10c2/phase4b', role, `${SLUG}.sql`),
    'utf8',
  )
}

function emptyAcl() {
  return { tables: {}, sequences: {}, functions: {} }
}

function grant(acl, kind, grantee, privs) {
  const bag = acl[kind]
  bag[grantee] = [...new Set([...(bag[grantee] || []), ...privs])].sort()
}

function revoke(acl, kind, grantee, privs) {
  const bag = acl[kind]
  if (!bag[grantee]) return
  const drop = new Set(privs)
  bag[grantee] = bag[grantee].filter((p) => !drop.has(p))
  if (bag[grantee].length === 0) delete bag[grantee]
}

function capturedPostgresPublicDefaults() {
  const acl = emptyAcl()
  for (const role of ['anon', 'authenticated', 'postgres', 'service_role']) {
    grant(acl, 'tables', role, CAPTURED_TABLE_CLIENT)
    grant(acl, 'sequences', role, ['SELECT', 'UPDATE', 'USAGE'])
    grant(acl, 'functions', role, ['EXECUTE'])
  }
  return acl
}

function applyForwardDefaultRevokes(acl) {
  for (const role of CLIENT_ROLES) {
    revoke(acl, 'tables', role, CAPTURED_TABLE_CLIENT)
    revoke(acl, 'sequences', role, ['SELECT', 'UPDATE', 'USAGE'])
    revoke(acl, 'functions', role, ['EXECUTE'])
  }
  return acl
}

function clientPrivs(acl, kind) {
  return CLIENT_ROLES.flatMap((role) => (acl[kind][role] || []).map((p) => `${role}:${p}`))
}

function sqlWithoutComments(sql) {
  return sql.replace(/--[^\n]*/g, '')
}

function parseDefaultStatements(sql) {
  const re = /ALTER DEFAULT PRIVILEGES\s+FOR ROLE\s+(\w+)\s+IN SCHEMA\s+(\w+)\s+(REVOKE|GRANT)\s+(.+?)\s+ON\s+(TABLES|SEQUENCES|FUNCTIONS)\s+(?:FROM|TO)\s+(\w+)/gi
  const out = []
  let m
  while ((m = re.exec(sql))) {
    out.push({
      role: m[1],
      schema: m[2],
      action: m[3].toUpperCase(),
      privs: m[4].trim(),
      kind: m[5].toLowerCase(),
      grantee: m[6],
    })
  }
  return out
}

describe('f10c2 cr1-e-r1 — 217 future default privileges', () => {
  const forward = readPair('forward')
  const verify = readPair('verification')
  const recovery = readPair('rollback')

  it('stays CR1E_DRAFT_ONLY and out of the 45-path allowlist', () => {
    expect(CR1E_DRAFT_ONLY).toEqual([SLUG])
    expect(PERMANENT_STAGING_FORWARD_PATHS.some((p) => p.includes('217_'))).toBe(false)
    expect(FORBIDDEN.test(forward)).toBe(false)
    expect(forward).not.toMatch(/\bnsne[a-z0-9]{4,}\b/i)
  })

  it('revokes future public/anon/authenticated defaults for the inspected postgres owner', () => {
    expect(forward).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public')
    expect(forward).toMatch(/REVOKE ALL ON TABLES FROM PUBLIC/)
    expect(forward).toMatch(/REVOKE ALL ON TABLES FROM anon/)
    expect(forward).toMatch(/REVOKE ALL ON TABLES FROM authenticated/)
    expect(forward).toMatch(/REVOKE ALL ON SEQUENCES FROM PUBLIC/)
    expect(forward).toMatch(/REVOKE ALL ON SEQUENCES FROM anon/)
    expect(forward).toMatch(/REVOKE ALL ON SEQUENCES FROM authenticated/)
    expect(forward).toMatch(/REVOKE ALL ON FUNCTIONS FROM PUBLIC/)
    expect(forward).toMatch(/REVOKE ALL ON FUNCTIONS FROM anon/)
    expect(forward).toMatch(/REVOKE ALL ON FUNCTIONS FROM authenticated/)
    expect(forward).not.toMatch(/GRANT SELECT ON TABLES TO authenticated/)
    expect(forward).not.toMatch(/GRANT ALL ON TABLES TO authenticated/)
    expect(forward).not.toMatch(MANAGED_SCHEMAS)
    expect(forward).toContain('supabase_admin')
    expect(forward).toContain('NOT a member of supabase_admin')
    expect(forward).toContain('pg_has_role(current_user, s.grantor, \'MEMBER\')')
  })

  it('does not invent a convenience authenticated table default', () => {
    const defaults = parseDefaultStatements(forward)
    expect(defaults.length).toBeGreaterThanOrEqual(9)
    expect(defaults.every((s) => s.role === 'postgres')).toBe(true)
    expect(defaults.every((s) => s.schema === 'public')).toBe(true)
    expect(defaults.every((s) => s.action === 'REVOKE')).toBe(true)
    expect(defaults.filter((s) => s.grantee === 'authenticated').length).toBe(3)
    expect(defaults.some((s) => s.action === 'GRANT' && s.grantee === 'authenticated')).toBe(false)
  })

  it('simulates a future postgres-owned table/sequence/function with no automatic client privileges', () => {
    const after = applyForwardDefaultRevokes(capturedPostgresPublicDefaults())
    expect(clientPrivs(after, 'tables')).toEqual([])
    expect(clientPrivs(after, 'sequences')).toEqual([])
    expect(clientPrivs(after, 'functions')).toEqual([])
    expect(after.tables.service_role).toEqual(CAPTURED_TABLE_CLIENT.slice().sort())
    expect(after.tables.postgres).toEqual(CAPTURED_TABLE_CLIENT.slice().sort())
    expect(after.functions.service_role).toEqual(['EXECUTE'])
    const futureTable = { name: 'cr1e_r1_future_probe', owner: 'postgres', grants: after.tables }
    const futureFn = { name: 'cr1e_r1_future_rpc', owner: 'postgres', grants: after.functions }
    expect(futureTable.owner).toBe('postgres')
    expect(CLIENT_ROLES.some((role) => (futureTable.grants[role] || []).length > 0)).toBe(false)
    expect(CLIENT_ROLES.some((role) => (futureFn.grants[role] || []).includes('EXECUTE'))).toBe(false)
    expect((futureTable.grants.authenticated || []).some((p) => TABLE_WRITE.includes(p))).toBe(false)
  })

  it('keeps the approved current-table plan and does not grant client table-wipe', () => {
    for (const name of [...WORKFLOW, ...SERVER_ONLY]) {
      expect(forward).toContain(`'${name}'`)
    }
    expect(forward).toContain('GRANT SELECT ON TABLE')
    expect(forward).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE')
    expect(forward).not.toMatch(/GRANT[^;]+TRUNCATE/i)
    expect(forward).not.toMatch(/GRANT ALL ON TABLE/)
  })

  it('verification detects current-table, future-default, and accidental-broadening failures', () => {
    expect(verify).toContain('anon_denied_on_stg_grant_001')
    expect(verify).toContain('authenticated_select_only_on_workflow')
    expect(verify).toContain('fe_cannot_write_acceptance_profiles')
    expect(verify).toContain('tenant_storage_server_only')
    expect(verify).toContain('postgres_public_no_client_defaults')
    expect(verify).toContain('postgres_public_no_client_table_writes')
    expect(verify).toContain('no_client_table_wipe_or_maintain')
    expect(verify).toContain('supabase_admin_public_client_defaults_remain_expected')
    expect(verify).toContain('storage_postgres_defaults_untouched')
    expect(verify).toContain("privilege_type IN ('TRUNCATE', 'MAINTAIN')")
    expect(verify).toMatch(/pg_get_userbyid\(d\.defaclrole\) = 'postgres'/)
    expect(verify.trimStart().startsWith('--')).toBe(true)
    expect(verify).toMatch(/^\s*SELECT\b/m)
    const verifyBody = sqlWithoutComments(verify)
    expect(verifyBody).not.toMatch(/\bALTER DEFAULT PRIVILEGES\b/)
    expect(verifyBody).not.toMatch(/\bREVOKE\s+/)
    expect(verifyBody).not.toMatch(/\bGRANT\s+(SELECT|ALL|EXECUTE|USAGE)/)
  })

  it('documents recovery as a manual emergency reopen, not a bit-identical inverse', () => {
    expect(recovery).toContain('MANUAL EMERGENCY RECOVERY')
    expect(recovery).toContain('NOT A BIT-IDENTICAL INVERSE')
    expect(recovery).toContain('reopens direct client writes')
    expect(recovery).toContain('NEVER RUN AUTOMATICALLY')
    expect(recovery).toContain('Prefer a forward-fix')
    expect(recovery).not.toContain('GRANT ALL ON TABLE')
    const recoveryBody = sqlWithoutComments(recovery)
    expect(recoveryBody).not.toMatch(/GRANT[^;]+TRUNCATE/i)
    expect(recoveryBody).not.toMatch(/GRANT[^;]+MAINTAIN/i)
    expect(recovery).not.toMatch(MANAGED_SCHEMAS)
    expect(recovery).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public')
    const defaults = parseDefaultStatements(recovery)
    expect(defaults.every((s) => s.role === 'postgres' && s.schema === 'public')).toBe(true)
    expect(defaults.every((s) => s.action === 'GRANT')).toBe(true)
    const tableGrants = defaults.filter((s) => s.kind === 'tables')
    expect(tableGrants).toHaveLength(2)
    for (const stmt of tableGrants) {
      expect(stmt.privs).toBe(RECOVERY_TABLE_CLIENT.join(', '))
      expect(['anon', 'authenticated']).toContain(stmt.grantee)
      expect(stmt.privs).not.toMatch(/TRUNCATE|MAINTAIN|ALL/)
    }
    const seqGrants = defaults.filter((s) => s.kind === 'sequences')
    expect(seqGrants.every((s) => s.privs === RECOVERY_SEQ_CLIENT.join(', '))).toBe(true)
    const fnGrants = defaults.filter((s) => s.kind === 'functions')
    expect(fnGrants.every((s) => s.privs === RECOVERY_FUN_CLIENT.join('')) || fnGrants.every((s) => s.privs === 'EXECUTE')).toBe(true)
    const recovered = new Set(RECOVERY_TABLE_CLIENT)
    const captured = new Set(CAPTURED_TABLE_CLIENT)
    for (const p of recovered) expect(captured.has(p) || p === 'SELECT').toBe(true)
    expect(recovered.has('TRUNCATE')).toBe(false)
    expect(recovered.has('MAINTAIN')).toBe(false)
    expect(recovered.size).toBeLessThan(captured.size)
  })
})
