import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const ROOT = process.cwd()

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

describe('f10c2 phase2 — static contracts', () => {
  it('phase2 docs exist', () => {
    for (const f of [
      'docs/f10c2/README.md',
      'docs/f10c2/mobile-result-packaging.md',
      'docs/f10c2/result-upload-state-machine.md',
      'docs/f10c2/mock-result-transport.md',
      'docs/f10c2/offline-upload-queue-contract.md',
    ]) {
      expect(fs.existsSync(path.join(ROOT, f))).toBe(true)
    }
  })

  it('submission modules exist under src/mobile/rf/submission', () => {
    for (const f of [
      'src/mobile/rf/submission/index.js',
      'src/mobile/rf/submission/mockResultTransport.js',
      'src/mobile/rf/submission/resultUploadOrchestrator.js',
      'src/mobile/rf/submission/enqueueFieldTestResult.js',
      'src/mobile/rf/submission/scenarioResultAdapters.js',
      'src/mobile/rf/submission/artifactLocalDescriptors.js',
      'src/mobile/MobileResultUploadStatus.jsx',
    ]) {
      expect(fs.existsSync(path.join(ROOT, f))).toBe(true)
    }
  })

  it('mobile queue documents field_test_result_submit extension', () => {
    const text = read('src/mobile/mobileOfflineQueue.js')
    expect(text).toContain('FIELD_TEST_RESULT_SUBMIT')
    expect(text).toContain('field_test_result_submit')
    expect(text).toContain('babydragon_mobile_offline_queue_v1')
  })

  it('keeps real server submit flag false in manifest module', () => {
    const text = read('src/mobile/rf/reports/serverSubmissionManifest.js')
    expect(text).toContain('F10C2_SERVER_SUBMIT_ENABLED = false')
  })

  it('mock transport does not import supabase client or call fetch', () => {
    const text = read('src/mobile/rf/submission/mockResultTransport.js')
    expect(text).not.toMatch(/from\s+['"].*supabase/i)
    expect(text).not.toMatch(/require\(['"]@supabase/i)
    expect(text).not.toMatch(/\bfetch\s*\(/)
    expect(text).toContain('MOCK_TRANSPORT_KIND')
  })

  it('dashboard / QC live paths still do not import submission orchestrator', () => {
    for (const rel of ['src/FEDashboard.jsx', 'src/App.jsx']) {
      const full = path.join(ROOT, rel)
      if (!fs.existsSync(full)) continue
      const text = read(rel)
      expect(text).not.toMatch(/rf\/submission/)
      expect(text).not.toMatch(/serverSubmissionManifest/)
    }
  })

  it('docs state no live upload validated', () => {
    const readme = read('docs/f10c2/README.md')
    expect(readme.toLowerCase()).toContain('no real supabase')
    expect(readme.toLowerCase()).toContain('not')
  })
})

describe('f10c2 phase2 — live / disposable still pending', () => {
  it.todo('Disposable apply of field_test_* schema — not authorized in Phase 2')
  it.todo('Real result-artifacts Storage upload — not authorized')
  it.todo('Real submit_field_test_run RPC against live DB — not authorized')
  it.todo('KB2003 device install of Phase 2 APK — not authorized unless separately approved')
  it.todo('Live Field Results Supabase provider — deferred to post-Phase-3 authorization')
})
