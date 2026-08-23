/**
 * Static validation of the Phase 4B-S operational bootstrap.
 * Does not connect to Supabase or PostgreSQL.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BOOTSTRAP_SLUG,
  OPERATIONAL_TABLES_IN_DEPENDENCY_ORDER,
  OPERATIONAL_TABLE_DEPENDENCIES,
  REQUIRED_APP_COLUMNS,
  NEVER_EXECUTE,
} from './operationalBootstrapContract.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BOOTSTRAP_DIR = path.join(ROOT, 'supabase/drafts/f10c2/phase4b/bootstrap')
const FORWARD = path.join(BOOTSTRAP_DIR, `${BOOTSTRAP_SLUG}.sql`)
const VERIFY = path.join(BOOTSTRAP_DIR, `${BOOTSTRAP_SLUG}.verify.sql`)
const ROLLBACK = path.join(BOOTSTRAP_DIR, `${BOOTSTRAP_SLUG}.rollback.sql`)

const FORBIDDEN_FORWARD = [
  { name: 'drop_table', re: /\bDROP\s+TABLE\b/i },
  { name: 'truncate', re: /\bTRUNCATE\b/i },
  { name: 'cascade', re: /\bCASCADE\b/i },
  { name: 'disable_rls', re: /\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i },
  { name: 'grant_all_anon', re: /\bGRANT\s+ALL\b[\s\S]{0,80}\banon\b/i },
  { name: 'grant_all_public', re: /\bGRANT\s+ALL\b[\s\S]{0,80}\bPUBLIC\b/i },
  { name: 'insert_rows', re: /\bINSERT\s+INTO\b/i },
  { name: 'copy_data', re: /^\s*COPY\s+/im },
  { name: 'set_local_in_forward', re: /\bSET\s+LOCAL\s+app\.f10c2_disposable_confirmed\b/i },
  { name: 'migration_207', re: /\b207_rls_tenant_storage_assumptions\b/ },
  { name: 'production_ref', re: /\bnsne[a-z0-9]{4,}\b/i },
  { name: 'jwt_blob', re: /\beyJ[A-Za-z0-9_-]{20,}\b/ },
  { name: 'permissive_true_policy', re: /\bUSING\s*\(\s*true\s*\)/i },
]

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
}

function extractCreateTableOrder(sql) {
  const order = []
  const re = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.([a-z_]+)/gi
  let match
  while ((match = re.exec(sql))) {
    order.push(match[1])
  }
  return order
}

function extractDeclaredColumns(sql, table) {
  const re = new RegExp(
    `CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+public\\.${table}\\s*\\(([\\s\\S]*?)\\);`,
    'i',
  )
  const block = sql.match(re)
  if (!block) return []
  return [...block[1].matchAll(/^\s*([a-z_][a-z0-9_]*)\s+/gim)]
    .map((m) => m[1])
    .filter((name) => !['constraint', 'primary', 'unique', 'check', 'foreign'].includes(name.toLowerCase()))
}

function validateDependencyOrder(createOrder) {
  const issues = []
  const created = new Set()
  for (const table of createOrder) {
    const deps = OPERATIONAL_TABLE_DEPENDENCIES[table] || []
    for (const dep of deps) {
      if (dep === 'auth.users') continue
      if (!created.has(dep)) {
        issues.push(`${table} created before dependency ${dep}`)
      }
    }
    created.add(table)
  }
  return issues
}

export function validateOperationalBootstrapFiles() {
  const findings = []
  const forward = fs.readFileSync(FORWARD, 'utf8')
  const verify = fs.readFileSync(VERIFY, 'utf8')
  const rollback = fs.readFileSync(ROLLBACK, 'utf8')
  const forwardBare = stripSqlComments(forward)
  const verifyBare = stripSqlComments(verify)
  const rollbackBare = stripSqlComments(rollback)

  if (!forward.includes('DISPOSABLE ONLY')) {
    findings.push({ file: 'forward', issue: 'missing_disposable_banner' })
  }
  if (!forward.includes("current_setting('app.f10c2_disposable_confirmed'")) {
    findings.push({ file: 'forward', issue: 'missing_sql_marker_assertion' })
  }
  if (!forward.includes('CREATE EXTENSION IF NOT EXISTS pgcrypto')) {
    findings.push({ file: 'forward', issue: 'missing_pgcrypto' })
  }

  for (const rule of FORBIDDEN_FORWARD) {
    if (rule.re.test(forwardBare)) findings.push({ file: 'forward', issue: rule.name })
  }

  const createOrder = extractCreateTableOrder(forward)
  if (JSON.stringify(createOrder) !== JSON.stringify(OPERATIONAL_TABLES_IN_DEPENDENCY_ORDER)) {
    findings.push({
      file: 'forward',
      issue: `create_order_mismatch:${createOrder.join(',')}`,
    })
  }
  for (const issue of validateDependencyOrder(createOrder)) {
    findings.push({ file: 'forward', issue })
  }
  for (const table of OPERATIONAL_TABLES_IN_DEPENDENCY_ORDER) {
    const cols = extractDeclaredColumns(forward, table)
    for (const required of REQUIRED_APP_COLUMNS[table]) {
      if (!cols.includes(required)) {
        findings.push({ file: 'forward', issue: `missing_column:${table}.${required}` })
      }
    }
  }

  if (/\bINSERT\s+INTO\b/i.test(verifyBare) || /\bDROP\s+TABLE\b/i.test(verifyBare) || /\bCREATE\s+TABLE\b/i.test(verifyBare)) {
    findings.push({ file: 'verify', issue: 'verify_not_select_only' })
  }
  if (!verify.includes("current_setting('app.f10c2_disposable_confirmed'")) {
    findings.push({ file: 'verify', issue: 'missing_sql_marker_assertion' })
  }

  if (!rollback.includes("app.f10c2_disposable_cleanup_confirmed")) {
    findings.push({ file: 'rollback', issue: 'missing_separate_cleanup_marker' })
  }
  if (/\bCASCADE\b/i.test(rollbackBare) || /\bTRUNCATE\b/i.test(rollbackBare)) {
    findings.push({ file: 'rollback', issue: 'destructive_cascade_or_truncate' })
  }
  for (const table of [...OPERATIONAL_TABLES_IN_DEPENDENCY_ORDER].reverse()) {
    if (!rollback.includes(`DROP TABLE IF EXISTS public.${table}`)) {
      findings.push({ file: 'rollback', issue: `missing_drop:${table}` })
    }
  }
  for (const slug of NEVER_EXECUTE) {
    if (forward.includes(slug) || verify.includes(slug)) {
      findings.push({ file: 'forward', issue: `contains_${slug}` })
    }
  }

  return {
    findings,
    createOrder,
    tables: OPERATIONAL_TABLES_IN_DEPENDENCY_ORDER,
    files: { forward: FORWARD, verify: VERIFY, rollback: ROLLBACK },
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  const result = validateOperationalBootstrapFiles()
  console.log('F10C2 Phase 4B-S operational bootstrap static validation (no SQL execution)')
  console.log(`tables=${result.tables.join(',')}`)
  console.log(`create_order=${result.createOrder.join(',')}`)
  console.log(`findings=${result.findings.length}`)
  if (result.findings.length) {
    for (const f of result.findings) console.error(`  ${f.file}: ${f.issue}`)
    process.exitCode = 2
  } else {
    console.log('RESULT: bootstrap SQL static checks passed — no database connection')
  }
}
