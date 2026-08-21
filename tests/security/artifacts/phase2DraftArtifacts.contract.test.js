import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const ROOT = process.cwd()
const DRAFTS = path.join(ROOT, 'supabase', 'drafts')

const SLUGS = [
  '001_security_audit_log',
  '002_harden_existing_functions',
  '003_security_helpers',
  '004_rpc_update_assigned_task_status',
  '005_rpc_update_assigned_checklist_item',
  '006_rpc_insert_assigned_task_issue',
  '007_rpc_insert_assigned_task_update',
  '008_execute_grants',
  '009_rls_profiles',
  '010_rls_tasks',
  '011_rls_task_updates',
  '012_rls_task_checklist_items',
  '013_rls_task_issue_reports',
  '014_rls_task_grids',
  '015_rls_projects',
  '016_rls_grids',
  '017_rls_routes',
  '018_rls_route_grids',
  '019_rls_cell_files_sites_sectors',
  '020_operational_evidence_schema_contract',
]

const BLOCKED_FORWARD = new Set([
  '009_rls_profiles',
  '010_rls_tasks',
  '012_rls_task_checklist_items',
  '013_rls_task_issue_reports',
])

const REQUIRED_HEADER = [
  '-- DRAFT / UNAPPLIED / DO NOT RUN',
  '-- F10C1I PHASE 2',
  '-- NO DATABASE TARGET AUTHORIZED',
]

const EXECUTABLE_DDL =
  /\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|GRANT|REVOKE|BEGIN|COMMIT)\b/i

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

function stripSqlComments(text) {
  // Line comments
  let out = text
    .split(/\r?\n/)
    .map((l) => {
      const trimmed = l.trim()
      if (trimmed.startsWith('--')) return ''
      const idx = l.indexOf('--')
      return idx >= 0 ? l.slice(0, idx) : l
    })
    .join('\n')
  // Block comments
  out = out.replace(/\/\*[\s\S]*?\*\//g, '')
  return out
}

function listSql(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

describe('artifacts — draft pairing and headers', () => {
  it('has matching forward/rollback/verification for 001–020', () => {
    const fwd = listSql(path.join(DRAFTS, 'forward'))
    const rb = listSql(path.join(DRAFTS, 'rollback'))
    const vf = listSql(path.join(DRAFTS, 'verification'))
    expect(fwd).toEqual(SLUGS.map((s) => `${s}.sql`))
    expect(rb).toEqual(fwd)
    expect(vf).toEqual(fwd)
  })

  it('every draft SQL begins with required safety header', () => {
    for (const dir of ['forward', 'rollback', 'verification']) {
      for (const slug of SLUGS) {
        const text = read(path.join('supabase', 'drafts', dir, `${slug}.sql`))
        for (const line of REQUIRED_HEADER) {
          expect(text.startsWith(REQUIRED_HEADER[0])).toBe(true)
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

describe('artifacts — BLOCKED_PENDING files are non-executable', () => {
  it('fails if BLOCKED_PENDING forward/rollback contain executable DDL outside comments', () => {
    for (const slug of BLOCKED_FORWARD) {
      for (const dir of ['forward', 'rollback']) {
        const text = read(path.join('supabase', 'drafts', dir, `${slug}.sql`))
        expect(text).toMatch(/BLOCKED_PENDING_/)
        const code = stripSqlComments(text)
        expect(code, `${dir}/${slug}`).not.toMatch(EXECUTABLE_DDL)
        expect(code.toLowerCase()).toMatch(/\bselect\b/)
      }
    }
  })

  it('020 storage write remains blocked marker; no bucket DDL', () => {
    const text = read(
      'supabase/drafts/forward/020_operational_evidence_schema_contract.sql',
    )
    expect(text).toContain('BLOCKED_PENDING_SCHEMA_AND_DISPOSABLE_VALIDATION')
    expect(text.toLowerCase()).not.toMatch(/insert\s+into\s+storage\.buckets/)
    expect(text.toLowerCase()).not.toMatch(/create\s+bucket/)
    expect(text).toMatch(/photo_url alone does NOT complete|photo_url only/i)
  })
})

describe('artifacts — verification SELECT-only', () => {
  const MUTATING =
    /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|GRANT|REVOKE|TRUNCATE|COPY)\b/i

  it('verification files avoid mutating keywords outside comments', () => {
    for (const slug of SLUGS) {
      const text = read(path.join('supabase', 'drafts', 'verification', `${slug}.sql`))
      const codeLines = text
        .split(/\r?\n/)
        .filter((l) => !l.trim().startsWith('--'))
        .join('\n')
      expect(codeLines).not.toMatch(MUTATING)
      expect(codeLines.toLowerCase()).toMatch(/\bselect\b/)
    }
  })
})

describe('artifacts — no secrets / production refs', () => {
  const SECRETISH =
    /supabase\.co|eyJ[A-Za-z0-9_-]{10,}\.|service_role\s*=\s*['"][^'"]+|password\s*=\s*['"][^'"]{8,}/i

  it('drafts, functions, docs/security, contract tests avoid production secrets', () => {
    const roots = [
      'supabase/drafts',
      'supabase/functions',
      'docs/security',
      'supabase/config.example.toml',
      'supabase/MIGRATION_MANIFEST.md',
    ]
    const files = []
    for (const r of roots) {
      const abs = path.join(ROOT, r)
      if (fs.statSync(abs).isFile()) {
        files.push(abs)
        continue
      }
      const walk = (d) => {
        for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, ent.name)
          if (ent.isDirectory()) walk(p)
          else if (/\.(sql|ts|js|md|toml)$/.test(ent.name)) files.push(p)
        }
      }
      walk(abs)
    }
    // Contract tests (exclude edge behavior fixtures that intentionally use fake passwords)
    const sec = path.join(ROOT, 'tests', 'security')
    for (const ent of fs.readdirSync(sec, { withFileTypes: true })) {
      if (ent.isFile() && ent.name.endsWith('.test.js')) {
        files.push(path.join(sec, ent.name))
      }
      if (ent.isDirectory() && ent.name === 'artifacts') {
        for (const f of fs.readdirSync(path.join(sec, ent.name))) {
          if (f.endsWith('.test.js')) files.push(path.join(sec, ent.name, f))
        }
      }
    }
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8')
      expect(text, f).not.toMatch(SECRETISH)
    }
  })

  it('config.example.toml remains non-operational (no project ref)', () => {
    const text = read('supabase/config.example.toml')
    expect(text).not.toMatch(/project_id\s*=\s*"[^"<]+"/)
    expect(fs.existsSync(path.join(ROOT, 'supabase', 'config.toml'))).toBe(false)
  })
})

describe('artifacts — RPC contracts in forward SQL', () => {
  it('status RPC encodes transitions, skew windows, and no started_at rewrite', () => {
    const text = read(
      'supabase/drafts/forward/004_rpc_update_assigned_task_status.sql',
    )
    expect(text).toContain('update_assigned_task_status')
    expect(text).toContain('terminal_completed')
    expect(text).toContain('client_started_at_far_future')
    expect(text).toContain('completed_before_started')
    expect(text).toContain('interval \'5 minutes\'')
    expect(text).toContain('BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION')
  })

  it('checklist RPC forces completed_by and documents clear server-time behavior', () => {
    const text = read(
      'supabase/drafts/forward/005_rpc_update_assigned_checklist_item.sql',
    )
    expect(text).toContain('p_item_id')
    expect(text).toContain('p_is_done')
    expect(text).toContain('p_event_at')
    expect(text).toContain('client_event_at_far_future')
    expect(text).toMatch(/completed_by\s*=\s*CASE WHEN p_is_done THEN v_uid/i)
    expect(text).not.toMatch(/p_completed_by/)
    expect(text).not.toMatch(/p_task_id/)
    expect(text).not.toMatch(/p_label/)
  })

  it('issue RPC forces reported_by and status open', () => {
    const text = read('supabase/drafts/forward/006_rpc_insert_assigned_task_issue.sql')
    expect(text).toContain("'open'")
    expect(text).toMatch(/reported_by[\s\S]*v_uid/)
    expect(text).not.toMatch(/p_reported_by/)
    expect(text).not.toMatch(/p_status/)
  })

  it('task update RPC rejects URL durable refs and ignores client user identity params', () => {
    const text = read(
      'supabase/drafts/forward/007_rpc_insert_assigned_task_update.sql',
    )
    expect(text).toContain('signed_or_public_url_not_durable')
    expect(text).toContain('^https?://')
    expect(text).toMatch(/user_id[\s\S]*v_uid/)
    expect(text).not.toMatch(/p_user_id/)
    expect(text).not.toMatch(/p_user_email/)
  })
})

describe('artifacts — RLS mutation boundary', () => {
  it('011 has no FE INSERT policy (RPC-only mutation)', () => {
    const text = read('supabase/drafts/forward/011_rls_task_updates.sql')
    expect(text).toContain('task_updates_fe_select_assigned_task')
    expect(text).not.toMatch(/FOR INSERT/i)
    expect(text).toMatch(/NO FE INSERT|Intentionally NO FE INSERT/i)
  })

  it('012/013 are blocked docs without FE mutation policies in executable code', () => {
    const c = read('supabase/drafts/forward/012_rls_task_checklist_items.sql')
    const i = read('supabase/drafts/forward/013_rls_task_issue_reports.sql')
    expect(c).toContain('BLOCKED_PENDING_RPC_CLIENT_CUTOVER')
    expect(i).toContain('BLOCKED_PENDING_RPC_CLIENT_CUTOVER')
    expect(stripSqlComments(c)).not.toMatch(EXECUTABLE_DDL)
    expect(stripSqlComments(i)).not.toMatch(EXECUTABLE_DDL)
  })
})

describe('artifacts — storage contract and buckets', () => {
  it('docs and draft 020 require bucket+object_key pair; photo_url alone insufficient', () => {
    const doc = read('docs/security/operational-evidence-contract.md')
    const d020 = read(
      'supabase/drafts/forward/020_operational_evidence_schema_contract.sql',
    )
    expect(doc).toContain('operational-evidence')
    expect(doc).toContain(
      '{project_id}/{task_id}/{verified_user_id}/{artifact_id}.{safe_extension}',
    )
    expect(doc).toMatch(/photo_url alone is insufficient|insufficient/i)
    expect(doc).toContain('BLOCKED_PENDING_SCHEMA_AND_DISPOSABLE_VALIDATION')
    expect(d020).toContain('NO bucket prefix inside object_key')
    expect(d020).toContain('BLOCKED_PENDING_SCHEMA_AND_DISPOSABLE_VALIDATION')
  })

  it('does not create result-artifacts or operational-evidence buckets in drafts', () => {
    for (const slug of SLUGS) {
      const text = read(path.join('supabase', 'drafts', 'forward', `${slug}.sql`))
      expect(text.toLowerCase()).not.toMatch(/insert\s+into\s+storage\.buckets/)
      expect(text.toLowerCase()).not.toMatch(/create\s+bucket/)
    }
  })
})

describe('artifacts — EXECUTE revoke and search_path', () => {
  it('008 revokes PUBLIC/anon and grants authenticated on RPCs', () => {
    const text = read('supabase/drafts/forward/008_execute_grants.sql')
    expect(text).toMatch(/REVOKE ALL ON FUNCTION public\.update_assigned_task_status[\s\S]*FROM PUBLIC/)
    expect(text).toMatch(/REVOKE ALL ON FUNCTION public\.update_assigned_task_status[\s\S]*FROM anon/)
    expect(text).toMatch(/GRANT EXECUTE ON FUNCTION public\.update_assigned_task_status[\s\S]*TO authenticated/)
  })

  it('DEFINER drafts set empty search_path', () => {
    for (const slug of [
      '002_harden_existing_functions',
      '003_security_helpers',
      '004_rpc_update_assigned_task_status',
      '005_rpc_update_assigned_checklist_item',
      '006_rpc_insert_assigned_task_issue',
      '007_rpc_insert_assigned_task_update',
    ]) {
      const text = read(path.join('supabase', 'drafts', 'forward', `${slug}.sql`))
      expect(text).toContain("SET search_path = ''")
    }
  })
})

describe('artifacts — rollback restoration baselines', () => {
  it('002 rollback restores coalesce(is_active, true) captured body marker', () => {
    const text = read('supabase/drafts/rollback/002_harden_existing_functions.sql')
    expect(text).toContain('coalesce(is_active, true) = true')
    expect(text).toContain("SET search_path TO 'public'")
  })

  it('captured 02a fixture exists for static policy comparison', () => {
    const fixture = read('supabase/tests/fixtures/captured_rls_policies_02a.json')
    const json = JSON.parse(fixture)
    expect(json.tasks.length).toBeGreaterThan(0)
    expect(json.profiles.length).toBeGreaterThan(0)
    expect(json.task_updates.some((p) => p.policyname.includes('FE can insert'))).toBe(true)
  })

  it('blocked rollbacks are no-op (no executable DDL)', () => {
    for (const slug of BLOCKED_FORWARD) {
      const text = read(path.join('supabase', 'drafts', 'rollback', `${slug}.sql`))
      expect(stripSqlComments(text)).not.toMatch(EXECUTABLE_DDL)
      expect(text).toMatch(/noop|no-op|documentation-only/i)
    }
  })
})

describe('artifacts — cutover blockers', () => {
  it('009 and 010 document blocked cutovers', () => {
    const p = read('supabase/drafts/forward/009_rls_profiles.sql')
    const t = read('supabase/drafts/forward/010_rls_tasks.sql')
    expect(p).toContain('BLOCKED_PENDING_EDGE_AND_CLIENT_CUTOVER')
    expect(t).toContain('BLOCKED_PENDING_RPC_CLIENT_CUTOVER')
  })

  it('manifest distinguishes apply-candidate vs blocked vs F10C2', () => {
    const m = read('supabase/MIGRATION_MANIFEST.md')
    expect(m).toContain('draftable / apply-candidate')
    expect(m).toContain('blocked documentation-only')
    expect(m).toContain('future F10C2')
  })
})

describe('artifacts — Edge Functions undeployed source', () => {
  const edgeFiles = [
    'supabase/functions/_shared/cors.ts',
    'supabase/functions/_shared/authz.ts',
    'supabase/functions/_shared/audit.ts',
    'supabase/functions/_shared/response.ts',
    'supabase/functions/admin-create-user/index.ts',
    'supabase/functions/admin-create-user/handler.ts',
    'supabase/functions/admin-reset-password/index.ts',
    'supabase/functions/admin-reset-password/handler.ts',
    'supabase/functions/admin-manage-profile/index.ts',
    'supabase/functions/admin-manage-profile/handler.ts',
  ]

  it('Edge sources exist and enforce JWT + is_active + role gates', () => {
    for (const f of edgeFiles) {
      expect(fs.existsSync(path.join(ROOT, f)), f).toBe(true)
    }
    const authz = read('supabase/functions/_shared/authz.ts')
    expect(authz).toContain('is_active !== true')
    expect(authz).toContain('assertMayResetPassword')
    expect(authz).toContain('assertMayManageProfile')

    const create = read('supabase/functions/admin-create-user/handler.ts')
    expect(create).toContain('deleteUser')
    expect(create).toContain('profile_upsert_failed_cleanup_failed')
    expect(create).toContain('writeSecurityAudit')

    const reset = read('supabase/functions/admin-reset-password/handler.ts')
    expect(reset).toContain('user_id_required_not_email')
    expect(reset).toContain('assertMayResetPassword')

    const manage = read('supabase/functions/admin-manage-profile/handler.ts')
    expect(manage).toContain('unknown_fields')
    expect(manage).toContain('assertMayManageProfile')
    expect(authz).toContain('final_super_admin_deactivation_forbidden')
  })

  it('CORS helper is fail-closed allowlist based', () => {
    const cors = read('supabase/functions/_shared/cors.ts')
    expect(cors).toContain('cors_allowlist_missing')
    expect(cors).toContain('cors_origin_not_allowed')
    expect(cors).toMatch(/omit Access-Control-Allow-Origin|Intentionally omit/i)
  })
})

describe('artifacts — disposable live gates remain todo (not counted as passed)', () => {
  it.todo('Disposable apply 001–020 with owner gate resolved — not authorized')
  it.todo('Disposable F10C1S §16 positive/negative matrix — not authorized')
  it.todo('Disposable Edge deploy + Admin cutover validation — not authorized')
  it.todo('Disposable private operational-evidence bucket create — not authorized')
  it.todo('Disposable Storage MIME/size/path/idempotency — not authorized')
  it.todo('Live RLS enforcement after broad policy drop — not authorized')
  it.todo('Production apply window — not authorized')
  it.todo('F10C2 results schema/bucket — separately unauthorized')
  it.todo('Runtime src/** client integration — separately unauthorized')
})
