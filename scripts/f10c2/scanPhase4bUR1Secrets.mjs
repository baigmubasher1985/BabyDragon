/**
 * Secret scan of 4B-U-R1 new/changed files. Prints finding kinds only.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const files = [
  'scripts/f10c2/applyPhase4bU209.mjs',
  'scripts/f10c2/validatePhase4bU209Live.mjs',
  'scripts/f10c2/scanPhase4bUR1Secrets.mjs',
  'tests/f10c2/phase4bUR1RlsRemediation.contract.test.js',
  'supabase/drafts/f10c2/phase4b/forward/209_disposable_operational_profile_task_rls_remediation.sql',
  'supabase/drafts/f10c2/phase4b/verification/209_disposable_operational_profile_task_rls_remediation.sql',
  'supabase/drafts/f10c2/phase4b/rollback/209_disposable_operational_profile_task_rls_remediation.sql',
]
const jwt = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/
const findings = []
for (const rel of files) {
  const t = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  if (jwt.test(t)) findings.push(`${rel}:jwt`)
  if (/service_role\s*=\s*['"][^'"]+/.test(t)) findings.push(`${rel}:service_role_assign`)
  if (/\bnsne[a-z0-9]{4,}/i.test(t)) findings.push(`${rel}:prod_prefix`)
  if (/postgres(?:ql)?:\/\/[^\s:]+:[^\s@]+@/.test(t)) findings.push(`${rel}:db_url`)
}
console.log(`secret_scan_files=${files.length}`)
console.log(`findings=${findings.length}`)
if (findings.length) {
  for (const f of findings) console.log(f)
  process.exitCode = 2
} else {
  console.log('RESULT: no jwt/service-role-assignment/prod-prefix/db-url in 4B-U-R1 files')
}
