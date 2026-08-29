/**
 * F10C2 Phase 3 — static source contracts (dashboard/QC, flags, no live DB).
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const ROOT = process.cwd()

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel))
}

describe('f10c2 phase3 — static contracts', () => {
  it('phase3 modules and docs exist', () => {
    for (const f of [
      'src/fieldResults/index.js',
      'src/fieldResults/repository/fieldResultsRepository.js',
      'src/fieldResults/repository/mockFieldResultsProvider.js',
      'src/fieldResults/fixtures/fieldResultsFixtures.js',
      'src/fieldResults/components/FieldResultsPage.jsx',
      'src/fieldResults/components/FieldResultsList.jsx',
      'src/fieldResults/components/FieldResultDetail.jsx',
      'docs/f10c2/field-results-dashboard.md',
      'docs/f10c2/field-results-qc-workflow.md',
      'docs/f10c2/field-results-provider.md',
    ]) {
      expect(exists(f), f).toBe(true)
    }
  })

  it('AdminDashboard wires Field Results nav for admin only surface under Field Operations', () => {
    const text = read('src/AdminDashboard.jsx')
    expect(text).toContain('fieldResults')
    expect(text).toContain('Field Results')
    expect(text).toContain('FieldResultsPage')
    const opsIdx = text.indexOf('title: "Field Operations"')
    const qcIdx = text.indexOf('title: "QC & Reports"')
    const fieldIdx = text.indexOf('{ id: "fieldResults"')
    expect(opsIdx).toBeGreaterThan(-1)
    expect(qcIdx).toBeGreaterThan(-1)
    expect(fieldIdx).toBeGreaterThan(opsIdx)
    expect(fieldIdx).toBeLessThan(qcIdx)
    expect(text).toContain('{ id: "qc", label: "QC Review"')
    expect(text).toContain('{ id: "reports", label: "Reports"')
  })

  it('FE dashboard does not expose Field Results admin nav', () => {
    const text = read('src/FEDashboard.jsx')
    expect(text).not.toContain('FieldResultsPage')
    expect(text).not.toContain('fieldResults')
  })

  it('mock provider does not import supabase or use fetch/service role', () => {
    const text = read('src/fieldResults/repository/mockFieldResultsProvider.js')
    expect(text).not.toMatch(/from\s+['"].*supabase/i)
    expect(text).not.toMatch(/\bfetch\s*\(/)
    expect(text).not.toMatch(/SERVICE_ROLE|serviceRole|service_role\s*=/i)
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)
    expect(text).not.toMatch(/https:\/\/[a-z0-9-]+\.supabase\.co/i)
  })

  it('field results components do not query field_test_ tables directly', () => {
    for (const rel of [
      'src/fieldResults/components/FieldResultsPage.jsx',
      'src/fieldResults/components/FieldResultsList.jsx',
      'src/fieldResults/components/FieldResultDetail.jsx',
    ]) {
      const text = read(rel)
      expect(text).not.toMatch(/from\(['"]field_test_/)
      expect(text).not.toMatch(/\.from\(['"]field_test_/)
    }
  })

  it('Phase 2 flags remain safe', () => {
    const manifest = read('src/mobile/rf/reports/serverSubmissionManifest.js')
    expect(manifest).toContain('F10C2_SERVER_SUBMIT_ENABLED = false')
    const orch = read('src/mobile/rf/submission/resultUploadOrchestrator.js')
    expect(orch).toContain('F10C2_MOCK_RESULT_UPLOAD_ENABLED = true')
  })

  it('Sync tab upload status module still present', () => {
    expect(exists('src/mobile/MobileResultUploadStatus.jsx')).toBe(true)
    const mobile = read('src/mobile/MobileApp.jsx')
    expect(mobile).toMatch(/MobileResultUploadStatus|ResultUpload/)
  })

  it('QCReview V1 decisions array not removed', () => {
    const text = read('src/pages/QCReview.jsx')
    expect(text).toContain('"QC Passed"')
    expect(text).toContain('"Needs Re-drive"')
    expect(text).toContain('Open Field Results')
  })

  it('docs mark Phase 3 as mock/local not live', () => {
    const readme = read('docs/f10c2/README.md')
    expect(readme.toLowerCase()).toMatch(/phase 3/)
    expect(readme.toLowerCase()).toMatch(/mock|local/)
    expect(readme.toLowerCase()).toMatch(/not live|no real supabase|not.*live server/i)
  })
})

describe('f10c2 phase3 — disposable / live still pending', () => {
  it.todo('Disposable Supabase apply of field_test_* + dashboard provider — not authorized in Phase 3')
  it.todo('Real signed URL mint for result-artifacts — not authorized')
  it.todo('Live RLS proof for Field Results QC writes — not authorized')
  it.todo('Docker/K8s Phase 4 — not authorized')
})
