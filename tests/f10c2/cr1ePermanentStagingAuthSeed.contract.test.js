/**
 * CR1-E-R2 Auth + Class A seed runner contracts. No live Auth/SQL unless a test injects mocks.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  AUTHORIZED_STAGING_PROJECT_NAME,
  AUTHORIZED_STAGING_PROJECT_REF,
  DENIED_DISPOSABLE_PROJECT_REF,
  DENIED_PRODUCTION_REF_PREFIX,
  REQUIRED_GIT_BRANCH,
} from '../../scripts/f10c2/assertPermanentStagingTarget.mjs'
import {
  EXPECTED_ALLOWLIST_NUMBERS,
  assertAllowlistHashesMatch,
} from '../../scripts/f10c2/permanentStagingApplyPlan.mjs'
import {
  APPLY_LEDGER_AUTH_SEED_REL,
  AUTH_SEED_APPROVED_ENV_NAME,
  CANONICAL_FE_ROLE,
  CLASS_A_BASELINE_REL,
  EXECUTION_PACKAGE_AUTH_SEED,
  HASH_MANIFEST_AUTH_SEED_REL,
  assertAuthSeedHashesMatch,
  inspectAuthCredentialPresence,
  loadClassABaseline,
  parseCliFlags,
  redactAuthSeedText,
  runPermanentStagingAuthSeedDryRun,
  runPermanentStagingAuthSeedExecute,
  verifyPermanentStagingRoleMatrix,
} from '../../scripts/f10c2/applyPermanentStagingAuthSeed.mjs'

const ROOT = process.cwd()
const FIXTURE_HEAD = 'a'.repeat(40)
const COMPLETE_45 = (() => {
  const hashes = assertAllowlistHashesMatch(ROOT)
  return {
    exists: true,
    targetRef: AUTHORIZED_STAGING_PROJECT_REF,
    targetName: AUTHORIZED_STAGING_PROJECT_NAME,
    applied: (hashes.actual || []).map((h) => ({
      number: h.number,
      path: h.path,
      sha256: h.sha256,
      verified: true,
    })),
  }
})()
const VERIFIED_217 = {
  exists: true,
  targetRef: AUTHORIZED_STAGING_PROJECT_REF,
  targetName: AUTHORIZED_STAGING_PROJECT_NAME,
  applied: { number: '217', verified: true },
}

function fixtureGit(overrides = {}) {
  return {
    ok: true,
    branch: REQUIRED_GIT_BRANCH,
    head: FIXTURE_HEAD,
    remoteHead: FIXTURE_HEAD,
    staged: false,
    packageDirty: [],
    packageUntracked: [],
    ...overrides,
  }
}

function fixtureEnv(overrides = {}) {
  return {
    BABYDRAGON_STAGING_PROJECT_NAME: AUTHORIZED_STAGING_PROJECT_NAME,
    BABYDRAGON_STAGING_PROJECT_REF: AUTHORIZED_STAGING_PROJECT_REF,
    BABYDRAGON_STAGING_SUPABASE_URL: `https://${AUTHORIZED_STAGING_PROJECT_REF}.supabase.co`,
    BABYDRAGON_STAGING_DATABASE_URL: `postgresql://postgres.${AUTHORIZED_STAGING_PROJECT_REF}@example.pooler.supabase.com:5432/postgres`,
    F10C2_PERMANENT_STAGING_CONFIRMED: 'yes',
    F10C2_PERMANENT_STAGING_NOT_PRODUCTION: 'yes',
    F10C2_PERMANENT_STAGING_CONNECTION_METHOD: 'session-pooler',
    F10C2_PERMANENT_STAGING_SQL_EXECUTION_APPROVED: 'no',
    F10C2_PERMANENT_STAGING_217_EXECUTION_APPROVED: 'no',
    F10C2_PERMANENT_STAGING_AUTH_SEED_APPROVED: 'no',
    F10C2_PERMANENT_STAGING_SEED_SYNTHETIC_FIELD_RESULTS: 'no',
    F10C2_PERMANENT_STAGING_SA_EMAIL: 'sa@example.test',
    F10C2_PERMANENT_STAGING_SA_PASSWORD: 'fixture-sa-password',
    F10C2_PERMANENT_STAGING_ADMIN_EMAIL: 'admin@example.test',
    F10C2_PERMANENT_STAGING_ADMIN_PASSWORD: 'fixture-admin-password',
    F10C2_PERMANENT_STAGING_FE_EMAIL: 'fe@example.test',
    F10C2_PERMANENT_STAGING_FE_PASSWORD: 'fixture-fe-password',
    ...overrides,
  }
}

function dryRun(overrides = {}) {
  return runPermanentStagingAuthSeedDryRun({
    cwd: ROOT,
    env: fixtureEnv(),
    argv: [],
    writeLedger: false,
    applyLedger: COMPLETE_45,
    applyLedger217: VERIFIED_217,
    applyLedgerAuth: { exists: false, applied: null },
    git: fixtureGit(),
    ...overrides,
  })
}

function emptyState() {
  return {
    authUsers: [],
    tenants: [],
    profiles: [],
    acceptanceProfiles: [],
    acceptanceRules: [],
    counts: {
      tenants: 0,
      profiles: 0,
      acceptance_profiles: 0,
      acceptance_rules: 0,
      projects: 0,
      tasks: 0,
      field_test_runs: 0,
      qc: 0,
      artifacts: 0,
      storage_objects: 0,
    },
  }
}

function createMockOps(state = emptyState(), options = {}) {
  const calls = []
  const track = (name, payload) => {
    calls.push({ name, payload })
  }
  return {
    calls,
    async listAuthUsers() {
      track('listAuthUsers')
      return state.authUsers
    },
    async createAuthUser(payload) {
      track('createAuthUser', { role: payload?.user_metadata?.role })
      const id = `auth-${payload.user_metadata.role}`
      state.authUsers.push({
        id,
        email: payload.email,
        emailConfirmed: true,
        metadataSource: payload.user_metadata.source,
        roleFromMeta: payload.user_metadata.role,
      })
      return { id }
    },
    async listTenants() {
      track('listTenants')
      return state.tenants
    },
    async insertTenant(row) {
      track('insertTenant', { slug: row.slug })
      const created = { id: 'tenant-1', ...row }
      state.tenants.push(created)
      state.counts.tenants = state.tenants.length
      return { id: created.id }
    },
    async listProfiles() {
      track('listProfiles')
      return state.profiles
    },
    async insertProfile(row) {
      track('insertProfile', { role: row.role })
      state.profiles.push({ id: row.id, role: row.role, is_active: true })
      state.counts.profiles = state.profiles.length
      return { id: row.id }
    },
    async listAcceptanceProfiles() {
      track('listAcceptanceProfiles')
      return state.acceptanceProfiles
    },
    async listAcceptanceRules() {
      track('listAcceptanceRules')
      return state.acceptanceRules
    },
    async insertAcceptanceProfile(row) {
      track('insertAcceptanceProfile', { name: row.name })
      const created = { id: `profile-${row.name}`, ...row }
      state.acceptanceProfiles.push(created)
      state.counts.acceptance_profiles = state.acceptanceProfiles.length
      return { id: created.id }
    },
    async insertAcceptanceRule(row) {
      track('insertAcceptanceRule', { rule_type: row.rule_type })
      const created = { id: `rule-${row.profile_id}-${row.rule_type}`, ...row }
      state.acceptanceRules.push(created)
      state.counts.acceptance_rules = state.acceptanceRules.length
      return { id: created.id }
    },
    async counts() {
      track('counts')
      return { ...state.counts }
    },
    async signIn({ role }) {
      track('signIn', { role })
      return { ok: true, userId: `auth-${role}`, role: role === 'fe' ? CANONICAL_FE_ROLE : role }
    },
    async signOut({ role }) {
      track('signOut', { role })
    },
    async restSelect({ role, table }) {
      track('restSelect', { role, table })
      if (role === 'anon') return { ok: false, denied: true, rowCount: 0 }
      if (table === 'tasks') return { ok: true, denied: false, rowCount: 0 }
      if (table === 'acceptance_profiles') return { ok: true, denied: false, rowCount: 3 }
      return { ok: true, denied: false, rowCount: 0 }
    },
    async rpc({ role, name }) {
      track('rpc', { role, name })
      if (role === 'anon' || role === 'fe') {
        return { ok: false, denied: true, code: role === 'fe' ? 'forbidden_not_admin' : 'permission denied' }
      }
      return { ok: false, denied: false, code: 'not_found', detail: 'not_found' }
    },
    async updateProfileRole({ role }) {
      track('updateProfileRole', { role })
      return { ok: false, denied: true }
    },
    ...options,
  }
}

describe('f10c2 cr1-e-r2 — Auth and Class A seed runner', () => {
  it('dry run does not touch Auth or SQL and records reviewed hashes', () => {
    const ops = createMockOps()
    const result = dryRun({ ops })
    expect(result.ok).toBe(true)
    expect(result.authCreated).toBe(false)
    expect(result.seedCreated).toBe(false)
    expect(result.sqlSent).toBe(false)
    expect(result.restMutated).toBe(false)
    expect(result.rewritesEnv).toBe(false)
    expect(ops.calls).toHaveLength(0)
    expect(result.ledger.hashManifest.ok).toBe(true)
    expect(result.ledger.canonicalFeRole).toBe('fe')
    expect(result.ledger.verdict).toContain('WAITING FOR EXPLICIT AUTH_SEED APPROVAL')
  })

  it('missing approval or --execute refuses and does not mutate', async () => {
    const ops = createMockOps()
    expect(parseCliFlags([]).wantExecute).toBe(false)
    const missingFlag = await runPermanentStagingAuthSeedExecute({
      cwd: ROOT,
      env: fixtureEnv({ F10C2_PERMANENT_STAGING_AUTH_SEED_APPROVED: 'no' }),
      argv: ['--execute'],
      writeLedger: false,
      applyLedger: COMPLETE_45,
      applyLedger217: VERIFIED_217,
      git: fixtureGit(),
      ops,
    })
    expect(missingFlag.ok).toBe(false)
    expect(missingFlag.authCreated).toBe(false)
    expect(missingFlag.blockers.some((b) => b.includes('AUTH_SEED_APPROVED'))).toBe(true)
    expect(ops.calls).toHaveLength(0)

    const missingExecute = await runPermanentStagingAuthSeedExecute({
      cwd: ROOT,
      env: fixtureEnv({ F10C2_PERMANENT_STAGING_AUTH_SEED_APPROVED: 'yes' }),
      argv: [],
      writeLedger: false,
      applyLedger: COMPLETE_45,
      applyLedger217: VERIFIED_217,
      git: fixtureGit(),
      ops,
    })
    expect(missingExecute.ok).toBe(false)
    expect(missingExecute.blockers.some((b) => b.includes('--execute'))).toBe(true)
    expect(ops.calls).toHaveLength(0)
  })

  it('45-path or 217 flags do not authorize Auth/seed', async () => {
    const ops = createMockOps()
    const denied = await runPermanentStagingAuthSeedExecute({
      cwd: ROOT,
      env: fixtureEnv({
        F10C2_PERMANENT_STAGING_AUTH_SEED_APPROVED: 'no',
        F10C2_PERMANENT_STAGING_SQL_EXECUTION_APPROVED: 'yes',
        F10C2_PERMANENT_STAGING_217_EXECUTION_APPROVED: 'yes',
      }),
      argv: ['--execute'],
      writeLedger: false,
      applyLedger: COMPLETE_45,
      applyLedger217: VERIFIED_217,
      git: fixtureGit(),
      ops,
    })
    expect(denied.ok).toBe(false)
    expect(denied.authCreated).toBe(false)
    expect(denied.blockers.some((b) => b.includes('45-path SQL approval does not authorize'))).toBe(true)
    expect(denied.blockers.some((b) => b.includes('217 SQL approval does not authorize'))).toBe(true)
    expect(ops.calls).toHaveLength(0)
  })

  it('wrong target, production, and disposable refuse', () => {
    const wrongName = dryRun({
      env: fixtureEnv({ BABYDRAGON_STAGING_PROJECT_NAME: 'not-authorized' }),
    })
    expect(wrongName.ok).toBe(false)
    expect(wrongName.authCreated).toBe(false)
    expect(wrongName.ledger.blockers.some((b) => b.includes('project name'))).toBe(true)

    const production = dryRun({
      env: fixtureEnv({
        BABYDRAGON_STAGING_SUPABASE_URL: `https://${DENIED_PRODUCTION_REF_PREFIX}example.supabase.co`,
      }),
    })
    expect(production.ok).toBe(false)
    expect(production.ledger.blockers.some((b) => b.includes('production prefix'))).toBe(true)

    const disposable = dryRun({
      env: fixtureEnv({
        BABYDRAGON_STAGING_SUPABASE_URL: `https://${DENIED_DISPOSABLE_PROJECT_REF}.supabase.co`,
      }),
    })
    expect(disposable.ok).toBe(false)
    expect(disposable.ledger.blockers.some((b) => b.includes('disposable'))).toBe(true)
  })

  it('incomplete 45 or missing 217 refuse', () => {
    const incomplete45 = dryRun({
      applyLedger: {
        exists: true,
        targetRef: AUTHORIZED_STAGING_PROJECT_REF,
        targetName: AUTHORIZED_STAGING_PROJECT_NAME,
        applied: COMPLETE_45.applied.slice(0, 10),
      },
    })
    expect(incomplete45.ok).toBe(false)
    expect(incomplete45.ledger.blockers.some((b) => b.includes('45-ledger') || b.includes('45-path'))).toBe(true)
    expect(EXPECTED_ALLOWLIST_NUMBERS).toHaveLength(45)

    const missing217 = dryRun({
      applyLedger217: { exists: false, applied: null },
    })
    expect(missing217.ok).toBe(false)
    expect(missing217.ledger.blockers.some((b) => b.includes('217 is not applied'))).toBe(true)
  })

  it('execute without ops refuses and does not mutate', async () => {
    const denied = await runPermanentStagingAuthSeedExecute({
      cwd: ROOT,
      env: fixtureEnv({ F10C2_PERMANENT_STAGING_AUTH_SEED_APPROVED: 'yes' }),
      argv: ['--execute'],
      writeLedger: false,
      applyLedger: COMPLETE_45,
      applyLedger217: VERIFIED_217,
      git: fixtureGit(),
    })
    expect(denied.ok).toBe(false)
    expect(denied.executeReady).toBe(true)
    expect(denied.authCreated).toBe(false)
    expect(denied.blockers.some((b) => b.includes('operations are not attached'))).toBe(true)
  })

  it('creates exactly three Auth users, one tenant, three profiles, and three templates', async () => {
    const state = emptyState()
    const ops = createMockOps(state)
    const result = await runPermanentStagingAuthSeedExecute({
      cwd: ROOT,
      env: fixtureEnv({ F10C2_PERMANENT_STAGING_AUTH_SEED_APPROVED: 'yes' }),
      argv: ['--execute'],
      writeLedger: false,
      applyLedger: COMPLETE_45,
      applyLedger217: VERIFIED_217,
      git: fixtureGit(),
      ops,
    })
    expect(result.ok).toBe(true)
    expect(result.authCreated).toBe(true)
    expect(result.seedCreated).toBe(true)
    expect(result.created.auth.map((row) => row.role)).toEqual(['super_admin', 'admin', 'fe'])
    expect(result.created.templates).toHaveLength(3)
    expect(ops.calls.some((c) => c.name === 'insertTenant')).toBe(true)
    expect(ops.calls.filter((c) => c.name === 'createAuthUser')).toHaveLength(3)
    expect(ops.calls.filter((c) => c.name === 'insertAcceptanceProfile')).toHaveLength(3)
    expect(ops.calls.filter((c) => c.name === 'insertAcceptanceRule')).toHaveLength(6)
    expect(ops.calls.some((c) => c.name === 'insertProject' || c.name === 'insertTask')).toBe(false)
    expect(ops.calls.filter((c) => c.name.startsWith('insert') && /project|task|field_test|qc|artifact/i.test(c.name))).toEqual([])
    expect(state.counts.projects).toBe(0)
    expect(state.counts.tasks).toBe(0)
    expect(JSON.stringify(result.created)).not.toMatch(/@example\.test/)
    expect(JSON.stringify(result.recorded)).not.toMatch(/fixture-/)
  })

  it('is idempotent when the exact expected users and templates already exist', async () => {
    const baseline = loadClassABaseline(ROOT).baseline
    const state = emptyState()
    state.authUsers = [
      { id: 'auth-super_admin', email: 'sa@example.test', emailConfirmed: true, metadataSource: 'permanent-staging-class-a', roleFromMeta: 'super_admin' },
      { id: 'auth-admin', email: 'admin@example.test', emailConfirmed: true, metadataSource: 'permanent-staging-class-a', roleFromMeta: 'admin' },
      { id: 'auth-fe', email: 'fe@example.test', emailConfirmed: true, metadataSource: 'permanent-staging-class-a', roleFromMeta: 'fe' },
    ]
    state.tenants = [{ id: 'tenant-1', slug: 'mobbitech-global', display_name: 'MobbiTech Global LLC', deployment_mode: 'mobbitech_saas', is_active: true }]
    state.profiles = [
      { id: 'auth-super_admin', role: 'super_admin', is_active: true },
      { id: 'auth-admin', role: 'admin', is_active: true },
      { id: 'auth-fe', role: 'fe', is_active: true },
    ]
    state.acceptanceProfiles = baseline.templates.map((template, idx) => ({
      id: `profile-${idx}`,
      name: template.name,
      version: 1,
      is_active: true,
      is_default: false,
      tenant_id: 'tenant-1',
      scope_type: 'tenant',
      scope_id: null,
    }))
    state.acceptanceRules = state.acceptanceProfiles.flatMap((profile, idx) => {
      const template = baseline.templates[idx]
      return [
        { id: `dl-${idx}`, profile_id: profile.id, profile_version: 1, rule_type: 'dl_ul', ...template.rules.dl_ul, config: template.rules.dl_ul },
        { id: `mo-${idx}`, profile_id: profile.id, profile_version: 1, rule_type: 'mo_mt', ...template.rules.mo_mt, config: template.rules.mo_mt },
      ]
    })
    state.counts = {
      tenants: 1,
      profiles: 3,
      acceptance_profiles: 3,
      acceptance_rules: 6,
      projects: 0,
      tasks: 0,
      field_test_runs: 0,
      qc: 0,
      artifacts: 0,
      storage_objects: 0,
    }
    const ops = createMockOps(state)
    const result = await runPermanentStagingAuthSeedExecute({
      cwd: ROOT,
      env: fixtureEnv({ F10C2_PERMANENT_STAGING_AUTH_SEED_APPROVED: 'yes' }),
      argv: ['--execute'],
      writeLedger: false,
      applyLedger: COMPLETE_45,
      applyLedger217: VERIFIED_217,
      git: fixtureGit(),
      ops,
    })
    expect(result.ok).toBe(true)
    expect(result.authCreated).toBe(false)
    expect(ops.calls.some((c) => c.name === 'createAuthUser')).toBe(false)
    expect(ops.calls.some((c) => c.name === 'insertTenant')).toBe(false)
    expect(ops.calls.some((c) => c.name === 'insertAcceptanceProfile')).toBe(false)
  })

  it('stops on conflicting Auth identities or roles', async () => {
    const state = emptyState()
    state.authUsers = [
      { id: 'auth-fe', email: 'fe@example.test', emailConfirmed: true, metadataSource: 'permanent-staging-class-a', roleFromMeta: 'admin' },
    ]
    const ops = createMockOps(state)
    const result = await runPermanentStagingAuthSeedExecute({
      cwd: ROOT,
      env: fixtureEnv({ F10C2_PERMANENT_STAGING_AUTH_SEED_APPROVED: 'yes' }),
      argv: ['--execute'],
      writeLedger: false,
      applyLedger: COMPLETE_45,
      applyLedger217: VERIFIED_217,
      git: fixtureGit(),
      ops,
    })
    expect(result.ok).toBe(false)
    expect(result.blockers[0]).toMatch(/conflict|unexpected|identities/i)
    expect(ops.calls.some((c) => c.name === 'createAuthUser')).toBe(false)
  })

  it('refuses when projects or tasks already exist', async () => {
    const state = emptyState()
    state.counts.projects = 1
    const ops = createMockOps(state)
    const result = await runPermanentStagingAuthSeedExecute({
      cwd: ROOT,
      env: fixtureEnv({ F10C2_PERMANENT_STAGING_AUTH_SEED_APPROVED: 'yes' }),
      argv: ['--execute'],
      writeLedger: false,
      applyLedger: COMPLETE_45,
      applyLedger217: VERIFIED_217,
      git: fixtureGit(),
      ops,
    })
    expect(result.ok).toBe(false)
    expect(result.blockers.some((b) => b.includes('projects'))).toBe(true)
    expect(ops.calls.some((c) => c.name === 'createAuthUser')).toBe(false)
  })

  it('sanitizes credentials and never writes the env file', () => {
    const leaked = 'user@example.test token=eyJabc.def.ghi postgres://u:p@h/db'
    expect(redactAuthSeedText(leaked)).not.toContain('@example.test')
    expect(redactAuthSeedText(leaked)).not.toContain('eyJabc')
    expect(redactAuthSeedText(leaked)).toContain('[email-redacted]')
    const source = fs.readFileSync(path.join(ROOT, 'scripts/f10c2/applyPermanentStagingAuthSeed.mjs'), 'utf8')
    expect(source).not.toMatch(/writeFileSync\([^\n]*\.env\.permanent-staging/)
    expect(source).toContain('rewritesEnv: false')
    expect(source).not.toMatch(/384c3aa30453bd4406c7d8c6d98fc4a4c8c9620e/)
    expect(source).not.toMatch(/REQUIRED_GIT_HEAD/)
    expect(source).not.toContain('field_engineer')
    expect(source).toContain("CANONICAL_FE_ROLE = 'fe'")
    expect(source).toContain(AUTH_SEED_APPROVED_ENV_NAME)
    expect(source).not.toMatch(/from\('projects'\)\.insert|from\("projects"\)\.insert/)
    expect(source).not.toMatch(/from\('tasks'\)\.insert|from\("tasks"\)\.insert/)
    expect(source).not.toMatch(/syncNow\(|clickSyncNow/)
  })

  it('Class A templates match the approved names and rule contract', () => {
    const loaded = loadClassABaseline(ROOT)
    expect(loaded.ok).toBe(true)
    expect(loaded.templates.map((t) => t.name)).toEqual([
      'Standard Data Throughput',
      'Standard Voice Calls',
      'Combined Data and Voice',
    ])
    expect(loaded.baseline.canonicalFeRole).toBe('fe')
    expect(loaded.baseline.tenant.display_name).toBe('MobbiTech Global LLC')
    expect(loaded.baseline.tenant.environment_purpose_column).toBe(false)
    expect(loaded.baseline.assignment.projectOrTaskRequired).toBe(false)
    const data = loaded.templates[0].rules
    expect(data.dl_ul.enabled_directions).toEqual(['dl', 'ul'])
    expect(data.dl_ul.min_dl_mbps).toBe(10)
    expect(data.dl_ul.min_ul_mbps).toBe(1)
    expect(data.dl_ul.required_dl_passing_iterations).toBe(20)
    expect(data.mo_mt.enabled_directions).toEqual([])
    expect(data.missing_applicable).toBe('INCOMPLETE')
    const voice = loaded.templates[1].rules
    expect(voice.dl_ul.enabled_directions).toEqual([])
    expect(voice.mo_mt.required_mo_success).toBe(10)
    expect(voice.mo_mt.required_mt_success).toBe(10)
    const combined = loaded.templates[2].rules
    expect(combined.dl_ul.enabled_directions).toEqual(['dl', 'ul'])
    expect(combined.mo_mt.enabled_directions).toEqual(['MO', 'MT'])
    const live = assertAuthSeedHashesMatch(ROOT)
    expect(live.ok).toBe(true)
    expect(live.actual.map((h) => h.role)).toEqual(['runner', 'baseline'])
    expect(EXECUTION_PACKAGE_AUTH_SEED).toContain(HASH_MANIFEST_AUTH_SEED_REL)
    expect(EXECUTION_PACKAGE_AUTH_SEED).toContain(CLASS_A_BASELINE_REL)
  })

  it('role/permission matrix denies anon and FE mutations and authorizes admin/SA without extra seed', async () => {
    const ops = createMockOps()
    const matrix = await verifyPermanentStagingRoleMatrix(ops)
    expect(matrix.ok).toBe(true)
    const byName = Object.fromEntries(matrix.checks.map((row) => [row.name, row.ok]))
    expect(byName.anon_cannot_read_business_tables).toBe(true)
    expect(byName.anon_cannot_execute_protected_rpcs).toBe(true)
    expect(byName.fe_can_auth).toBe(true)
    expect(byName.fe_cannot_mutate_profiles).toBe(true)
    expect(byName.fe_cannot_change_roles).toBe(true)
    expect(byName.fe_sees_no_assigned_task).toBe(true)
    expect(byName.admin_can_view_three_templates).toBe(true)
    expect(byName.admin_authorized_status_rpc_without_extra_seed).toBe(true)
    expect(byName.super_admin_authorized_profile_admin).toBe(true)
    expect(ops.calls.some((c) => c.name === 'insertAcceptanceProfile')).toBe(false)
  })

  it('credential presence reports env NAMES only', () => {
    const presence = inspectAuthCredentialPresence(fixtureEnv())
    expect(presence.map((row) => row.role)).toEqual(['super_admin', 'admin', 'fe'])
    expect(JSON.stringify(presence)).not.toMatch(/@example\.test/)
    expect(presence[0].emailName).toBe('F10C2_PERMANENT_STAGING_SA_EMAIL')
    expect(fs.existsSync(path.join(ROOT, APPLY_LEDGER_AUTH_SEED_REL))).toBe(false)
  })
})
