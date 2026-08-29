/**
 * Static scan of Phase 4B executable drafts. No database connection.
 * Fails if SQL 214 appears in an apply list or in phase4b/{forward,verification,rollback}.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  listPhase4bApplyPlan,
  PHASE4A_NEVER_EXECUTE,
  CR1B_APPLY,
  CR1D_APPLY,
  CR1E_APPLY,
  CR1D_DRAFT_ONLY,
  CR1E_DRAFT_ONLY,
  CR1_NEVER_RUN,
  CR1_NEVER_RUN_DIR,
  assertNo214InApplyList,
  find214InExecutableMigrationPaths,
} from './phase4bApplyPlan.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FORBIDDEN = /\b(DROP\s+DATABASE|TRUNCATE|DROP\s+TABLE)\b/i
const PROD_PREFIX = /\bnsne[a-z0-9]{4,}\b/i
const SERVICE_ASSIGN = /service_role\s*=\s*['"][^'"]+/i

const plan = listPhase4bApplyPlan()
const extra = [...CR1D_APPLY, ...CR1E_APPLY].map((slug) => ({
  slug,
  file: path.join(ROOT, 'supabase/drafts/f10c2/phase4b/forward', `${slug}.sql`),
}))
const findings = []

try {
  assertNo214InApplyList(plan.stages.map((s) => s.slug), 'listPhase4bApplyPlan')
  assertNo214InApplyList(CR1B_APPLY, 'CR1B_APPLY')
  assertNo214InApplyList(CR1D_APPLY, 'CR1D_APPLY')
  assertNo214InApplyList(CR1E_APPLY, 'CR1E_APPLY')
  assertNo214InApplyList(CR1D_DRAFT_ONLY, 'CR1D_DRAFT_ONLY')
  assertNo214InApplyList(CR1E_DRAFT_ONLY, 'CR1E_DRAFT_ONLY')
} catch (error) {
  console.error(String(error.message || error))
  process.exitCode = 2
}

for (const step of [...plan.stages, ...extra]) {
  const text = fs.readFileSync(step.file, 'utf8')
  if (FORBIDDEN.test(text)) findings.push({ slug: step.slug, issue: 'destructive_sql' })
  if (PROD_PREFIX.test(text)) findings.push({ slug: step.slug, issue: 'production_ref' })
  if (SERVICE_ASSIGN.test(text)) findings.push({ slug: step.slug, issue: 'service_role_assignment' })
}

const leaked = [...plan.stages, ...extra].filter((s) => (
  PHASE4A_NEVER_EXECUTE.includes(s.slug)
  || CR1_NEVER_RUN.includes(s.slug)
  || s.slug.startsWith('207_')
  || s.slug.startsWith('214_')
  || CR1E_DRAFT_ONLY.includes(s.slug)
))

const leaked214Files = find214InExecutableMigrationPaths()
const archiveReadme = path.join(ROOT, CR1_NEVER_RUN_DIR, 'README.md')

console.log('F10C2 Phase 4B-S migration static scan (no SQL execution)')
console.log(`scanned=${plan.stages.length + extra.length}`)
console.log(`plan_stages=${plan.stages.length}`)
console.log(`cr1d_one_shot=${CR1D_APPLY.length}`)
console.log(`cr1e_one_shot=${CR1E_APPLY.length}`)
console.log(`cr1e_draft_only=${CR1E_DRAFT_ONLY.join(',') || '(none)'}`)
console.log(`cr1d_draft_only=${CR1D_DRAFT_ONLY.join(',') || '(none — 214 quarantined)'}`)
console.log(`cr1_never_run=${CR1_NEVER_RUN.join(',')}`)
console.log(`canonical_cr1_order=210,211,212,213,skip-214,215,216`)

for (const slug of CR1E_DRAFT_ONLY) {
  const file = path.join(ROOT, 'supabase/drafts/f10c2/phase4b/forward', `${slug}.sql`)
  const text = fs.readFileSync(file, 'utf8')
  if (FORBIDDEN.test(text)) findings.push({ slug, issue: 'destructive_sql' })
  if (PROD_PREFIX.test(text)) findings.push({ slug, issue: 'production_ref' })
  if (SERVICE_ASSIGN.test(text)) findings.push({ slug, issue: 'service_role_assignment' })
}

console.log(`findings=${findings.length}`)
if (leaked.length) {
  console.error('207/214 leaked into executable scan set')
  process.exitCode = 2
}
if (leaked214Files.length) {
  console.error(`SQL 214 present in executable migration paths: ${leaked214Files.join(', ')}`)
  process.exitCode = 2
}
if (!fs.existsSync(archiveReadme)) {
  console.error(`SQL 214 never-run archive README missing: ${CR1_NEVER_RUN_DIR}/README.md`)
  process.exitCode = 2
}
if (findings.length) {
  for (const f of findings) console.error(`  ${f.slug}: ${f.issue}`)
  process.exitCode = 2
} else if (!process.exitCode) {
  console.log('RESULT: no DROP TABLE/DATABASE/TRUNCATE, no production refs, 207 excluded, 214 quarantined')
}
