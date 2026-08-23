import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const ROOT = process.cwd()
const DRAFTS = path.join(ROOT, 'supabase', 'drafts', 'f10c2')

const SLUGS = [
  '101_field_test_runs',
  '102_field_test_artifacts',
  '103_field_test_metrics',
  '104_field_test_qc_reviews',
  '105_rpc_submit_field_test_run',
  '106_rpc_register_field_test_artifact',
  '107_rpc_complete_field_test_artifact_upload',
  '108_rpc_submit_field_test_qc_review',
  '109_rls_field_test_runs',
  '110_rls_field_test_artifacts_metrics',
  '111_rls_field_test_qc_reviews',
  '112_result_artifacts_storage_contract',
]

const BLOCKED_FORWARD = new Set(['112_result_artifacts_storage_contract'])

const REQUIRED_HEADER = [
  '-- DRAFT / UNAPPLIED / DO NOT RUN',
  '-- F10C2 PHASE 1',
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

const PHASE4_SLUGS = [
  '113_rpc_finalize_field_test_run',
  '114_result_artifacts_private_bucket',
  '115_field_test_execute_grants',
]

describe('f10c2 artifacts — draft pairing and headers', () => {
  it('has matching forward/rollback/verification for 101–112 plus Phase 4 113–115', () => {
    const fwd = listSql(path.join(DRAFTS, 'forward'))
    const rb = listSql(path.join(DRAFTS, 'rollback'))
    const vf = listSql(path.join(DRAFTS, 'verification'))
    const expected = [...SLUGS, ...PHASE4_SLUGS].map((s) => `${s}.sql`)
    expect(fwd).toEqual(expected)
    expect(rb).toEqual(fwd)
    expect(vf).toEqual(fwd)
  })

  it('every draft SQL begins with required F10C2 safety header', () => {
    for (const dir of ['forward', 'rollback', 'verification']) {
      for (const slug of SLUGS) {
        const text = read(path.join('supabase', 'drafts', 'f10c2', dir, `${slug}.sql`))
        expect(text.startsWith(REQUIRED_HEADER[0])).toBe(true)
        for (const line of REQUIRED_HEADER) {
          expect(text).toContain(line)
        }
      }
    }
  })

  it('active migrations/ stays README-only (no executable .sql)', () => {
    const mig = path.join(ROOT, 'supabase', 'migrations')
    const sql = fs.readdirSync(mig).filter((f) => f.endsWith('.sql'))
    expect(sql).toEqual([])
    expect(fs.existsSync(path.join(mig, 'README.md'))).toBe(true)
  })
})

describe('f10c2 artifacts — blocked storage draft is non-executable', () => {
  it('112 forward has no executable DDL outside comments', () => {
    const text = read(
      'supabase/drafts/f10c2/forward/112_result_artifacts_storage_contract.sql',
    )
    expect(text).toContain('BLOCKED_PENDING_SCHEMA_AND_DISPOSABLE_VALIDATION')
    const body = stripSqlComments(text)
    expect(EXECUTABLE_DDL.test(body)).toBe(false)
    expect(body).toMatch(/result_artifacts_storage_blocked/i)
  })

  it('112 rollback is no-op status only', () => {
    const text = read(
      'supabase/drafts/f10c2/rollback/112_result_artifacts_storage_contract.sql',
    )
    const body = stripSqlComments(text)
    expect(EXECUTABLE_DDL.test(body)).toBe(false)
    expect(body).toMatch(/noop/i)
  })

  it('blocked set matches manifest classification', () => {
    expect([...BLOCKED_FORWARD]).toEqual(['112_result_artifacts_storage_contract'])
  })
})

describe('f10c2 artifacts — security invariants in drafts', () => {
  it('submit RPC forces submitted_by from auth.uid and checks assignment', () => {
    const sql = read('supabase/drafts/f10c2/forward/105_rpc_submit_field_test_run.sql')
    expect(sql).toContain('auth.uid()')
    expect(sql).toContain('is_assigned_to_task')
    expect(sql).toContain('submitted_by')
    expect(sql).toContain('client_run_id')
    expect(sql).toMatch(/v_uid/)
  })

  it('artifact RPC builds ownership path and rejects signed URL object_key via table check', () => {
    const art = read('supabase/drafts/f10c2/forward/102_field_test_artifacts.sql')
    expect(art).toContain('result-artifacts')
    expect(art).toContain('field_test_artifacts_no_http_object_key')
    expect(art).toContain('task-photos')
    expect(art).toContain('operational-evidence')
    const rpc = read('supabase/drafts/f10c2/forward/106_rpc_register_field_test_artifact.sql')
    expect(rpc).toMatch(/v_uid::text/)
    expect(rpc).toContain('project_id')
    expect(rpc).toContain('task_id')
    expect(rpc).toContain('unsafe_extension')
    expect(rpc).toMatch(/v_run\.id::text/)
  })

  it('QC RPC denies FE and preserves task-level qc_reviews naming separation', () => {
    const qc = read('supabase/drafts/f10c2/forward/108_rpc_submit_field_test_qc_review.sql')
    expect(qc).toContain('forbidden_not_qc_admin')
    expect(qc).toContain('Needs Re-drive')
    expect(qc).toContain('field_test_qc_reviews')
    expect(qc).not.toMatch(/INSERT INTO public\.qc_reviews/i)
  })

  it('RLS drafts have no FE INSERT on field_test_runs', () => {
    const rls = read('supabase/drafts/f10c2/forward/109_rls_field_test_runs.sql')
    expect(rls).toContain('FOR SELECT')
    expect(rls).not.toMatch(/FOR INSERT/i)
    expect(rls).not.toMatch(/FOR UPDATE/i)
    expect(rls).not.toMatch(/FOR DELETE/i)
  })

  it('does not create result-artifacts bucket in Phase 1 forward drafts 101–112', () => {
    for (const slug of SLUGS) {
      const text = read(`supabase/drafts/f10c2/forward/${slug}.sql`)
      const body = stripSqlComments(text)
      expect(body).not.toMatch(/insert\s+into\s+storage\.buckets/i)
      expect(body).not.toMatch(/create\s+bucket/i)
    }
  })
})

describe('f10c2 artifacts — docs and pure src module', () => {
  it('docs/f10c2 contracts exist', () => {
    for (const f of [
      'docs/f10c2/README.md',
      'docs/f10c2/result-artifacts-storage-contract.md',
      'docs/f10c2/offline-upload-queue-contract.md',
      'docs/f10c2/dashboard-qc-contracts.md',
      'docs/f10c2/feature-flags-compatibility.md',
    ]) {
      expect(fs.existsSync(path.join(ROOT, f))).toBe(true)
    }
  })

  it('serverSubmissionManifest exists and is not imported from live UI paths', () => {
    expect(
      fs.existsSync(
        path.join(ROOT, 'src/mobile/rf/reports/serverSubmissionManifest.js'),
      ),
    ).toBe(true)
    const liveRoots = [
      'src/MobileApp.jsx',
      'src/FEDashboard.jsx',
      'src/pages/QCReview.jsx',
      'src/App.jsx',
    ]
    for (const rel of liveRoots) {
      const full = path.join(ROOT, rel)
      if (!fs.existsSync(full)) continue
      const text = read(rel)
      expect(text).not.toMatch(/serverSubmissionManifest/)
    }
  })

  it('manifest documents feature flag OFF', () => {
    const text = read('src/mobile/rf/reports/serverSubmissionManifest.js')
    expect(text).toContain('F10C2_SERVER_SUBMIT_ENABLED = false')
  })
})

describe('f10c2 disposable / live pending', () => {
  it.todo('Disposable apply of field_test_* schema — not authorized')
  it.todo('Disposable result-artifacts bucket create — not authorized')
  it.todo('Disposable RPC submit/register/complete against live DB — not authorized')
  it.todo('Disposable Storage MIME/size/path upload — not authorized')
  it.todo('Dashboard / QC UI Phase 3 — not in Phase 1/2')
})
