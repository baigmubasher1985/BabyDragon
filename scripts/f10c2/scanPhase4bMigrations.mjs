/**
 * Static scan of Phase 4B executable drafts. No database connection.
 */
import fs from 'node:fs'
import { listPhase4bApplyPlan, PHASE4A_NEVER_EXECUTE } from './phase4bApplyPlan.mjs'

const FORBIDDEN = /\b(DROP\s+DATABASE|TRUNCATE|DROP\s+TABLE)\b/i
const PROD_PREFIX = /\bnsne[a-z0-9]{4,}\b/i
const SERVICE_ASSIGN = /service_role\s*=\s*['"][^'"]+/i

const plan = listPhase4bApplyPlan()
const findings = []

for (const step of plan.stages) {
  const text = fs.readFileSync(step.file, 'utf8')
  if (FORBIDDEN.test(text)) findings.push({ slug: step.slug, issue: 'destructive_sql' })
  if (PROD_PREFIX.test(text)) findings.push({ slug: step.slug, issue: 'production_ref' })
  if (SERVICE_ASSIGN.test(text)) findings.push({ slug: step.slug, issue: 'service_role_assignment' })
}

const leaked = plan.stages.filter((s) => PHASE4A_NEVER_EXECUTE.includes(s.slug) || s.slug.startsWith('207_'))

console.log('F10C2 Phase 4B-S migration static scan (no SQL execution)')
console.log(`scanned=${plan.stages.length}`)
console.log(`findings=${findings.length}`)
if (leaked.length) {
  console.error('207 leaked into executable plan')
  process.exitCode = 2
}
if (findings.length) {
  for (const f of findings) console.error(`  ${f.slug}: ${f.issue}`)
  process.exitCode = 2
} else {
  console.log('RESULT: no DROP TABLE/DATABASE/TRUNCATE, no production refs, 207 excluded')
}
