import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { listApplyPlan } from '../../scripts/f10c2/applyDisposableMigrations.mjs'

const ROOT = process.cwd()

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

function walk(rel, acc = []) {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) return acc
  const st = fs.statSync(abs)
  if (st.isFile()) {
    acc.push(rel.replaceAll('\\', '/'))
    return acc
  }
  for (const ent of fs.readdirSync(abs)) {
    walk(path.join(rel, ent), acc)
  }
  return acc
}

const CLIENT_ROOTS = [
  'src/storage',
  'src/processing',
  'src/mobile/rf/submission',
  'src/fieldResults',
  'src/lib/f10c2FeatureFlags.js',
]

const FORBIDDEN_ASSIGN = [
  /VITE_SUPABASE_SERVICE_ROLE/,
  /VITE_AWS_SECRET/,
  /VITE_AZURE_STORAGE_KEY/,
  /VITE_GRAPH_CLIENT_SECRET/,
  /VITE_GOOGLE_CLIENT_SECRET/,
  /VITE_SFTP_PASSWORD/,
  /VITE_DATABASE_URL/,
]

describe('f10c2 phase4a — static contracts', () => {
  it('keeps compile-time server submit flag false and mock upload on', () => {
    expect(read('src/mobile/rf/reports/serverSubmissionManifest.js')).toContain(
      'F10C2_SERVER_SUBMIT_ENABLED = false',
    )
    expect(read('src/mobile/rf/submission/resultUploadOrchestrator.js')).toContain(
      'F10C2_MOCK_RESULT_UPLOAD_ENABLED = true',
    )
  })

  it('never calls getPublicUrl from Phase 4A storage or dashboard providers', () => {
    const files = [
      'src/storage/providers/supabaseArtifactStorageProvider.js',
      'src/storage/providers/mockArtifactStorageProvider.js',
      'src/fieldResults/repository/supabaseFieldResultsProvider.js',
      'src/mobile/rf/submission/supabaseResultTransport.js',
    ]
    for (const rel of files) {
      expect(read(rel)).not.toMatch(/\.getPublicUrl\s*\(/)
    }
  })

  it('client modules do not embed server credential env names', () => {
    const files = CLIENT_ROOTS.flatMap((rel) => {
      const abs = path.join(ROOT, rel)
      if (!fs.existsSync(abs)) return []
      return fs.statSync(abs).isFile()
        ? [rel]
        : walk(rel).filter((f) => /\.(js|jsx)$/.test(f))
    })
    expect(files.length).toBeGreaterThan(8)
    for (const rel of files) {
      const text = read(rel)
      for (const pattern of FORBIDDEN_ASSIGN) {
        expect(text).not.toMatch(pattern)
      }
      expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./)
    }
  })

  it('Phase 4 apply plan still excludes Phase 4A slugs 201–207', () => {
    const slugs = listApplyPlan().f10c2.map((s) => s.slug)
    expect(slugs).toContain('115_field_test_execute_grants')
    for (const n of [201, 202, 203, 204, 205, 206, 207]) {
      expect(slugs.some((s) => s.startsWith(`${n}_`))).toBe(false)
    }
    const applySrc = read('scripts/f10c2/applyDisposableMigrations.mjs')
    expect(applySrc).not.toMatch(/201_tenants/)
    expect(applySrc).not.toMatch(/phase4a/)
  })

  it('docs keep the Phase 2 “no real supabase” phrase', () => {
    expect(read('docs/f10c2/README.md').toLowerCase()).toContain('no real supabase')
    expect(fs.existsSync(path.join(ROOT, 'docs/f10c2/phase4a-multi-tenant-storage.md'))).toBe(true)
  })

  it('k8s and docker notes stay documentation-only (no deploy manifests)', () => {
    const k8s = fs.readdirSync(path.join(ROOT, 'infra/k8s'))
    const docker = fs.readdirSync(path.join(ROOT, 'infra/docker'))
    expect(k8s).toEqual(['README.md'])
    expect(docker).toEqual(['README.md'])
    const k8sText = read('infra/k8s/README.md')
    expect(k8sText).toMatch(/stateless/i)
    expect(k8sText).toMatch(/Secret/)
    expect(k8sText).toMatch(/ConfigMap/)
    expect(k8sText).toMatch(/health/i)
    expect(k8sText).not.toMatch(/apiVersion:\s*apps\/v1/)
  })
})
