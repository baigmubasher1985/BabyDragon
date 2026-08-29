/**
 * CR1-B-U-R1 — canonical Stop/Save persistence, queue identity, Export/Excel reuse,
 * Unified Report grouping, ambiguous collision fail-closed.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeEach } from 'vitest'
import { installLocalStorageShim, clearLocalStorageShim } from './fixtures/localStorageShim.js'
import {
  persistCanonicalStopSave,
  CANONICAL_PERSIST_MODES,
  shouldEnqueueForPersistMode,
} from '../../src/mobile/rf/reports/canonicalStopSave.js'
import {
  buildCanonicalPackageIdentity,
  buildExportArtifactFolderId,
  isExportArtifactFolderId,
} from '../../src/mobile/rf/reports/canonicalPackageIdentity.js'
import {
  durablePackageIdentity,
  groupDraftsByCanonicalIdentity,
  applyScopeAutoSelection,
  buildUnifiedDraftFromSession,
  filterDraftsForActiveContext,
} from '../../src/mobile/rf/reports/savedReportPackageDiscovery.js'
import {
  enqueueFieldTestResultSubmit,
  listFieldTestResultQueueItems,
} from '../../src/mobile/rf/submission/enqueueFieldTestResult.js'
import { __resetIdStoresForTests } from '../../src/mobile/rf/submission/clientRunIdStore.js'
import { saveMobileQueue } from '../../src/mobile/mobileOfflineQueue.js'
import { F10C2_UUIDS } from './fixtures/syntheticFieldResults.js'

const CURRENT_TASK = 'F10C2-P4BU-E2E'
const CURRENT_GRID = 'F10C2-P4BU-E2E'

const taskContext = {
  taskId: F10C2_UUIDS.taskAssignedToFeA,
  projectId: F10C2_UUIDS.project,
  gridId: F10C2_UUIDS.grid,
}

function httpSession(id, extras = {}) {
  return {
    id,
    startedAt: extras.startedAt || '2026-08-24T00:30:05.000Z',
    endedAt: extras.endedAt || '2026-08-24T00:33:03.000Z',
    taskLabel: extras.taskLabel || CURRENT_TASK,
    grid: extras.grid || CURRENT_GRID,
    appEngineId: 'native_http',
    appTestType: 'http',
    appTestStatus: 'saved',
    sampleCount: extras.sampleCount || 40,
    appCompletedIterations: extras.appCompletedIterations || 3,
    appIterationResults: extras.appIterationResults || [
      { iteration: 1, status: 'complete', dlMbps: 12, ulMbps: 4 },
    ],
    ...extras,
  }
}

function nativeHttpDraft(sessionId, extras = {}) {
  return buildUnifiedDraftFromSession(httpSession(sessionId, extras), {
    packageId: extras.packageId || `${sessionId}__export_${extras.stamp || '20260824_003303'}`,
    sourcePackage: extras.packageId || `${sessionId}__export_${extras.stamp || '20260824_003303'}`,
    selected: false,
    modifiedAtMs: extras.modifiedAtMs,
  })
}

beforeEach(() => {
  installLocalStorageShim()
  clearLocalStorageShim()
  __resetIdStoresForTests()
  saveMobileQueue([])
})

describe('CR1-B-U-R1 canonical Stop/Save persistence', () => {
  it('persists one canonical package and one queue entry without uploading', async () => {
    const session = httpSession('bd-rf-1787549405888')
    const savedFolders = []
    const result = await persistCanonicalStopSave({
      session,
      taskContext,
      ownerUserId: F10C2_UUIDS.feA,
      buildPackage: ({ persistMode }) => ({
        persistMode,
        sessionId: buildCanonicalPackageIdentity(session).folderId,
        displayName: 'canonical',
        files: [{ fileName: 'Report.json', mimeType: 'application/json', content: '{}' }],
      }),
      savePackage: async (pkg) => {
        savedFolders.push(pkg.sessionId)
        return { ok: true, basePath: `Downloads/BabyDragon/Reports/${pkg.sessionId}` }
      },
      enqueue: enqueueFieldTestResultSubmit,
    })
    expect(result.ok).toBe(true)
    expect(result.uploaded).toBe(false)
    expect(savedFolders).toHaveLength(1)
    expect(isExportArtifactFolderId(savedFolders[0])).toBe(false)
    expect(listFieldTestResultQueueItems()).toHaveLength(1)
    expect(result.enqueueResult.client_run_id).toBeTruthy()
  })

  it('reuses the same canonical identity and merges to one queue row on repeat Stop/Save', async () => {
    const session = httpSession('bd-rf-1787549405888')
    const folders = []
    const save = async (pkg) => {
      folders.push(pkg.sessionId)
      return { ok: true }
    }
    const buildPackage = () => ({
      sessionId: buildCanonicalPackageIdentity(session).folderId,
      displayName: 'canonical',
      files: [{ fileName: 'Report.json', mimeType: 'application/json', content: '{"n":1}' }],
    })
    const first = await persistCanonicalStopSave({
      session, taskContext, buildPackage, savePackage: save, enqueue: enqueueFieldTestResultSubmit,
    })
    const second = await persistCanonicalStopSave({
      session, taskContext, buildPackage, savePackage: save, enqueue: enqueueFieldTestResultSubmit,
    })
    expect(first.ok && second.ok).toBe(true)
    expect(folders[0]).toBe(folders[1])
    expect(second.enqueueResult.reason).toBe('merged_existing')
    expect(second.enqueueResult.client_run_id).toBe(first.enqueueResult.client_run_id)
    expect(listFieldTestResultQueueItems()).toHaveLength(1)
  })

  it('survives process restart via durable queue + identity store', async () => {
    const session = httpSession('bd-rf-restart-1')
    const first = await persistCanonicalStopSave({
      session,
      taskContext,
      buildPackage: () => ({
        sessionId: buildCanonicalPackageIdentity(session).folderId,
        files: [{ fileName: 'Report.json', mimeType: 'application/json', content: '{}' }],
      }),
      savePackage: async () => ({ ok: true }),
      enqueue: enqueueFieldTestResultSubmit,
    })
    const snapshot = listFieldTestResultQueueItems()
    expect(snapshot).toHaveLength(1)
    const runId = first.enqueueResult.client_run_id
    const again = await persistCanonicalStopSave({
      session,
      taskContext,
      buildPackage: () => ({
        sessionId: buildCanonicalPackageIdentity(session).folderId,
        files: [{ fileName: 'Report.json', mimeType: 'application/json', content: '{}' }],
      }),
      savePackage: async () => ({ ok: true }),
      enqueue: enqueueFieldTestResultSubmit,
    })
    expect(again.enqueueResult.client_run_id).toBe(runId)
    expect(listFieldTestResultQueueItems()).toHaveLength(1)
  })

  it('does not upload as part of Stop/Save and does not enqueue for Export/Excel modes', () => {
    expect(shouldEnqueueForPersistMode(CANONICAL_PERSIST_MODES.CANONICAL)).toBe(true)
    expect(shouldEnqueueForPersistMode(CANONICAL_PERSIST_MODES.EXPORT_ARTIFACT)).toBe(false)
    expect(shouldEnqueueForPersistMode(CANONICAL_PERSIST_MODES.EXCEL)).toBe(false)
  })

  it('keeps the session and does not claim Saved when persistence fails', async () => {
    const session = httpSession('bd-rf-fail-persist')
    const result = await persistCanonicalStopSave({
      session,
      taskContext,
      buildPackage: () => ({
        sessionId: 'x',
        files: [{ fileName: 'Report.json', content: '{}' }],
      }),
      savePackage: async () => ({ ok: false, message: 'disk full' }),
      enqueue: enqueueFieldTestResultSubmit,
    })
    expect(result.ok).toBe(false)
    expect(result.stage).toBe('persist')
    expect(result.error).toMatch(/disk full|kept/i)
    expect(listFieldTestResultQueueItems()).toHaveLength(0)
  })

  it('Export artifact folders keep a timestamp but reuse the same canonical identity', () => {
    const session = httpSession('bd-rf-1787549405888')
    const a = buildExportArtifactFolderId(session, Date.parse('2026-08-24T00:33:03Z'))
    const b = buildExportArtifactFolderId(session, Date.parse('2026-08-24T00:38:02Z'))
    expect(isExportArtifactFolderId(a)).toBe(true)
    expect(isExportArtifactFolderId(b)).toBe(true)
    expect(a).not.toBe(b)
    expect(buildCanonicalPackageIdentity(session).canonicalPackageId).toBe('bd-rf-1787549405888::native_http')
  })

  it('wires Stop/Save to canonical persist and keeps Export/Excel from creating a second queue row', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/mobile/rf/MobileRfKpiCore.jsx'), 'utf8')
    expect(src).toMatch(/persistCanonicalStopSave\(/)
    expect(src).toMatch(/persistMode: CANONICAL_PERSIST_MODES\.EXPORT_ARTIFACT/)
    const exportFn = src.slice(src.indexOf('async function exportSavedSession'), src.indexOf('function addSavedSessionToUnifiedReport'))
    expect(exportFn).not.toMatch(/enqueueFieldTestResultSubmit/)
    expect(exportFn).not.toMatch(/tryEnqueueFieldTestResultAfterSave/)
    const excelFn = src.slice(src.indexOf('async function exportExcelPlotReport'), src.indexOf('async function shareExportedReports'))
    expect(excelFn).not.toMatch(/enqueueFieldTestResultSubmit/)
    expect(excelFn).toMatch(/buildCanonicalPackageIdentity\(sessionToExport\)/)
  })
})

describe('CR1-B-U-R1 Unified Report grouping', () => {
  it('groups two export folders from the same Native HTTP session as one scenario', () => {
    const drafts = [
      nativeHttpDraft('bd-rf-1787549405888', { stamp: '20260824_003303', packageId: 'F10C2_..._003303' }),
      nativeHttpDraft('bd-rf-1787549405888', { stamp: '20260824_003802', packageId: 'F10C2_..._003802' }),
    ]
    const grouped = groupDraftsByCanonicalIdentity(drafts)
    expect(grouped.collisions).toHaveLength(0)
    expect(grouped.drafts).toHaveLength(1)
    expect(grouped.drafts[0].label).toBe('Native HTTP')
    expect(grouped.drafts[0].exportArtifacts).toHaveLength(2)
    expect(durablePackageIdentity(grouped.drafts[0])).toBe('bd-rf-1787549405888::native_http')
  })

  it('keeps distinct sessions distinct and preserves CR1-A four scopes', () => {
    const drafts = [
      nativeHttpDraft('bd-rf-current-1'),
      nativeHttpDraft('bd-rf-1787549405888', { stamp: 'a' }),
      nativeHttpDraft('bd-rf-1787549405888', { stamp: 'b' }),
      buildUnifiedDraftFromSession(httpSession('bd-rf-morning-1', {
        taskLabel: 'No active task',
        grid: 'Grid pending',
      }), { packageId: 'morning-1', selected: false }),
      buildUnifiedDraftFromSession(httpSession('bd-rf-other-1', {
        taskLabel: 'Other Field Task',
        grid: 'Grid B',
      }), { packageId: 'other-1', selected: false }),
    ]
    const { partitioned, warnings } = filterDraftsForActiveContext(drafts, {
      taskLabel: CURRENT_TASK,
      grid: CURRENT_GRID,
    })
    const scoped = applyScopeAutoSelection(partitioned)
    expect(scoped.current_task.length).toBe(2)
    expect(scoped.unassigned).toHaveLength(1)
    expect(scoped.other_tasks).toHaveLength(1)
    expect(scoped.all_device).toHaveLength(4)
    expect(scoped.current_task.every((d) => d.selected === true)).toBe(true)
    expect(scoped.unassigned.every((d) => d.selected === false)).toBe(true)
    expect(warnings.join(' ')).toMatch(/unassigned/i)
  })

  it('fails closed on ambiguous identity collisions instead of merging', () => {
    const a = nativeHttpDraft('bd-rf-same-id', { sampleCount: 10, startedAt: '2026-08-24T01:00:00.000Z' })
    const b = nativeHttpDraft('bd-rf-same-id', { sampleCount: 99, startedAt: '2026-08-23T09:00:00.000Z' })
    const grouped = groupDraftsByCanonicalIdentity([a, b])
    expect(grouped.drafts).toHaveLength(0)
    expect(grouped.collisions).toHaveLength(1)
    expect(grouped.collisions[0].reason).toBe('ambiguous_identity_collision')
  })
})
