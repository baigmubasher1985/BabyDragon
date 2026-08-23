/**
 * F10C2 Phase 4 — static contracts (flags stay safe; no production refs).
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { listApplyPlan, F10C1I_SKIP, F10C2_SKIP } from '../../scripts/f10c2/applyDisposableMigrations.mjs'

const ROOT = process.cwd()

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

describe('f10c2 phase4 — static contracts', () => {
  it('keeps compile-time server submit flag false', () => {
    expect(read('src/mobile/rf/reports/serverSubmissionManifest.js')).toContain(
      'F10C2_SERVER_SUBMIT_ENABLED = false',
    )
    expect(read('src/mobile/rf/submission/resultUploadOrchestrator.js')).toContain(
      'F10C2_MOCK_RESULT_UPLOAD_ENABLED = true',
    )
  })

  it('real transport exists but mock transport still has no supabase import', () => {
    expect(fs.existsSync(path.join(ROOT, 'src/mobile/rf/submission/supabaseResultTransport.js'))).toBe(true)
    const mock = read('src/mobile/rf/submission/mockResultTransport.js')
    expect(mock).not.toMatch(/from\s+['"].*supabase/i)
    expect(mock).not.toMatch(/\bfetch\s*\(/)
  })

  it('live provider never uses getPublicUrl', () => {
    const text = read('src/fieldResults/repository/supabaseFieldResultsProvider.js')
    expect(text).not.toMatch(/\.getPublicUrl\s*\(/)
    const storage = read('src/storage/providers/supabaseArtifactStorageProvider.js')
    expect(storage).toContain('createSignedUrl')
    expect(storage).toContain('RESULT_ARTIFACTS_BUCKET')
    expect(storage).not.toMatch(/\.getPublicUrl\s*\(/)
  })

  it('components still do not query field_test_ tables', () => {
    for (const rel of [
      'src/fieldResults/components/FieldResultsPage.jsx',
      'src/fieldResults/components/FieldResultsList.jsx',
      'src/fieldResults/components/FieldResultDetail.jsx',
    ]) {
      const text = read(rel)
      expect(text).not.toMatch(/\.from\(['"]field_test_/)
    }
  })

  it('apply plan skips blocked drafts and includes Phase 4 113–115', () => {
    const plan = listApplyPlan()
    expect(F10C1I_SKIP).toEqual([
      '009_rls_profiles',
      '010_rls_tasks',
      '012_rls_task_checklist_items',
      '013_rls_task_issue_reports',
    ])
    expect(F10C2_SKIP).toEqual(['112_result_artifacts_storage_contract'])
    const slugs = plan.f10c2.map((s) => s.slug)
    expect(slugs).toContain('113_rpc_finalize_field_test_run')
    expect(slugs).toContain('114_result_artifacts_private_bucket')
    expect(slugs).toContain('115_field_test_execute_grants')
    expect(slugs).not.toContain('112_result_artifacts_storage_contract')
    expect(slugs.some((s) => /^20[1-7]_/.test(s))).toBe(false)
  })

  it('112 remains documentation-only (no bucket DDL)', () => {
    const text = read('supabase/drafts/f10c2/forward/112_result_artifacts_storage_contract.sql')
    expect(text).toContain('CLASSIFICATION: (b) blocked documentation-only')
  })

  it('114 creates private result-artifacts bucket and does not mention task-photos mutation of objects', () => {
    const text = read('supabase/drafts/f10c2/forward/114_result_artifacts_private_bucket.sql')
    expect(text).toContain("public = false")
    expect(text).toContain("INSERT INTO storage.buckets")
    expect(text).toContain('result-artifacts')
    expect(text).not.toMatch(/DELETE FROM storage\.objects/)
    expect(text).not.toMatch(/UPDATE storage\.objects/)
  })

  it('no service-role VITE_ prefix in phase4 sources', () => {
    const files = [
      'src/mobile/rf/submission/supabaseResultTransport.js',
      'src/fieldResults/repository/supabaseFieldResultsProvider.js',
      'src/lib/f10c2FeatureFlags.js',
      'docs/f10c2/phase4-disposable-integration.md',
    ]
    for (const rel of files) {
      const text = read(rel)
      expect(text).not.toMatch(/VITE_SUPABASE_SERVICE_ROLE/)
      expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./)
    }
  })
})
