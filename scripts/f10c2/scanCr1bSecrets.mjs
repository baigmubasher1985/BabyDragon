/**
 * Secret scan of CR1-B new/changed files. Prints finding kinds only.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CR1B_APPLY, CR1D_APPLY, CR1E_APPLY, assertNo214InApplyList } from './phase4bApplyPlan.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const files = [
  'scripts/f10c2/applyCr1bMigrations.mjs',
  'scripts/f10c2/scanCr1bSecrets.mjs',
  'scripts/f10c2/validateCr1bLive.mjs',
  'scripts/f10c2/validateCr1bAuthMatrix.mjs',
  'src/acceptance/verdicts.js',
  'src/acceptance/canonicalIngest.js',
  'src/acceptance/evaluateRun.js',
  'src/lib/f10c2FeatureFlags.js',
  'src/fieldResults/repository/supabaseFieldResultsProvider.js',
  'tests/f10c2/cr1bAcceptanceEngine.behavior.test.js',
  'scripts/f10c2/applyCr1dMigrations.mjs',
  'scripts/f10c2/applyCr1eMigrations.mjs',
  'scripts/f10c2/applyPermanentStagingMigrations.mjs',
  'scripts/f10c2/applyPermanentStaging217.mjs',
  'scripts/f10c2/applyPermanentStagingAuthSeed.mjs',
  'scripts/f10c2/permanentStagingApplyPlan.mjs',
  'scripts/f10c2/permanentStagingAllowlist.hashes.json',
  'scripts/f10c2/permanentStaging217.hashes.json',
  'scripts/f10c2/permanentStagingAuthSeed.hashes.json',
  'scripts/f10c2/permanentStagingClassABaseline.json',
  'scripts/f10c2/assertPermanentStagingTarget.mjs',
  'scripts/f10c2/probePermanentStagingEmptyTarget.mjs',
  'tests/f10c2/cr1ePermanentStagingApply.contract.test.js',
  'tests/f10c2/cr1ePermanentStaging217.contract.test.js',
  'tests/f10c2/cr1ePermanentStagingAuthSeed.contract.test.js',
  'supabase/drafts/f10c2/permanent-staging/000_permanent_staging_operational_schema.sql',
  'supabase/drafts/f10c2/permanent-staging/000_permanent_staging_operational_schema.verify.sql',
  'supabase/drafts/f10c2/permanent-staging/000_permanent_staging_operational_schema.rollback.sql',
  'scripts/f10c2/validateCr1dLive.mjs',
  'scripts/f10c2/validateCr1eLive.mjs',
  'tests/f10c2/cr1dAcceptanceProfiles.behavior.test.js',
  'tests/f10c2/cr1dMigrations.contract.test.js',
  'src/mobile/rf/reports/canonicalPackageIdentity.js',
  'src/mobile/rf/reports/canonicalStopSave.js',
  'src/mobile/rf/reports/savedReportPackageDiscovery.js',
  'src/mobile/testEngines/iperf3ResultMapper.js',
  'src/mobile/rf/submission/enqueueFieldTestResult.js',
  'src/mobile/rf/submission/clientRunIdStore.js',
  'tests/f10c2/cr1buR1CanonicalPersistence.behavior.test.js',
  'tests/f10c2/cr1buR1IperfTruth.behavior.test.js',
  'tests/f10c2/fixtures/cr1bur1-iperf-bidir-field-derived.json',
  'tests/f10c2/fixtures/cr1bur1-iperf-native-bidir.json',
  ...CR1B_APPLY.flatMap((slug) => [
    `supabase/drafts/f10c2/phase4b/forward/${slug}.sql`,
    `supabase/drafts/f10c2/phase4b/verification/${slug}.sql`,
    `supabase/drafts/f10c2/phase4b/rollback/${slug}.sql`,
  ]),
  ...CR1D_APPLY.flatMap((slug) => [
    `supabase/drafts/f10c2/phase4b/forward/${slug}.sql`,
    `supabase/drafts/f10c2/phase4b/verification/${slug}.sql`,
    `supabase/drafts/f10c2/phase4b/rollback/${slug}.sql`,
  ]),
  ...CR1E_APPLY.flatMap((slug) => [
    `supabase/drafts/f10c2/phase4b/forward/${slug}.sql`,
    `supabase/drafts/f10c2/phase4b/verification/${slug}.sql`,
    `supabase/drafts/f10c2/phase4b/rollback/${slug}.sql`,
  ]),
  'src/acceptance/profileResolution.js',
  'src/acceptance/profiles/supabaseAcceptanceProfilesProvider.js',
  'tests/f10c2/cr1eProfileStatus.behavior.test.js',
  'tests/f10c2/cr1eMigrations.contract.test.js',
  'tests/f10c2/cr1eDefaultPrivileges.contract.test.js',
  'supabase/drafts/f10c2/phase4b/forward/217_cr1e_staging_grant_hardening.sql',
  'supabase/drafts/f10c2/phase4b/verification/217_cr1e_staging_grant_hardening.sql',
  'supabase/drafts/f10c2/phase4b/rollback/217_cr1e_staging_grant_hardening.sql',
]
const jwt = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/
const findings = []
assertNo214InApplyList(CR1B_APPLY, 'CR1B_APPLY')
assertNo214InApplyList(CR1D_APPLY, 'CR1D_APPLY')
assertNo214InApplyList(CR1E_APPLY, 'CR1E_APPLY')
for (const rel of files) {
  const full = path.join(ROOT, rel)
  if (!fs.existsSync(full)) {
    findings.push(`${rel}:missing`)
    continue
  }
  const t = fs.readFileSync(full, 'utf8')
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
  console.log('RESULT: no jwt/service-role-assignment/prod-prefix/db-url in CR1-B files')
}
