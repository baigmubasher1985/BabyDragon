import fs from 'node:fs'
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import {
  PACKAGE_SCOPES,
  classifyDraftScope,
  partitionDraftsByScope,
  applyScopeAutoSelection,
  draftsForScope,
  durablePackageIdentity,
  dedupeDraftsByIdentity,
  filterDraftsForActiveContext,
  buildUploadAssociation,
  restoreSelectedIdentities,
  buildUnifiedDraftFromSession,
} from '../../src/mobile/rf/reports/savedReportPackageDiscovery.js'

const MORNING_SESSIONS = [
  { id: 'bd-rf-1787575239098', label: 'Data RF', kind: 'rf_gps' },
  { id: 'bd-rf-1787575357767', label: 'Data RF', kind: 'rf_gps' },
  { id: 'bd-rf-1787575493983', label: 'Data RF', kind: 'rf_gps' },
  { id: 'bd-rf-1787576749763', label: 'iPerf3', kind: 'iperf3' },
  { id: 'bd-rf-1787576878592', label: 'iPerf3', kind: 'iperf3' },
]

const CURRENT_TASK = 'F10C2-P4BU-E2E'
const CURRENT_GRID = 'Grid A'
const MORNING_ZIP = 'C:\\Users\\Mubasher\\Desktop\\New folder (3)\\No_active_task_Data_RF_Report_20260824_074237_20260824_074331.zip'

function morningDraft(sessionId, extras = {}) {
  return buildUnifiedDraftFromSession({
    id: sessionId,
    startedAt: '2026-08-24T07:42:37.000Z',
    endedAt: '2026-08-24T07:43:31.000Z',
    taskLabel: 'No active task',
    grid: 'Grid pending',
    appTestType: extras.kind === 'iperf3' ? 'iperf' : 'rf_only',
    appTestStatus: extras.kind === 'iperf3' ? 'incomplete' : 'saved',
    sourcePackage: extras.packageId || sessionId,
  }, {
    packageId: extras.packageId || sessionId,
    sourcePackage: extras.packageId || sessionId,
    selected: false,
    draftId: `${sessionId}-draft`,
  })
}

function currentTaskDraft(sessionId = 'bd-rf-current-1') {
  return buildUnifiedDraftFromSession({
    id: sessionId,
    startedAt: '2026-08-24T12:00:00.000Z',
    taskLabel: CURRENT_TASK,
    grid: CURRENT_GRID,
    appTestType: 'http',
    appTestStatus: 'saved',
    sourcePackage: sessionId,
  }, {
    packageId: sessionId,
    sourcePackage: sessionId,
    selected: false,
    draftId: `${sessionId}-draft`,
  })
}

function otherTaskDraft(sessionId = 'bd-rf-other-1') {
  return buildUnifiedDraftFromSession({
    id: sessionId,
    startedAt: '2026-08-23T09:00:00.000Z',
    taskLabel: 'Other Field Task',
    grid: 'Grid B',
    appTestType: 'ftp',
    appTestStatus: 'saved',
    sourcePackage: sessionId,
  }, {
    packageId: sessionId,
    sourcePackage: sessionId,
    selected: false,
    draftId: `${sessionId}-draft`,
  })
}

describe('CR1-A unified report package discovery', () => {
  it('classifies morning No-active-task packages as unassigned', () => {
    for (const row of MORNING_SESSIONS) {
      const draft = morningDraft(row.id, { kind: row.kind })
      expect(classifyDraftScope(draft, { taskLabel: CURRENT_TASK, grid: CURRENT_GRID }))
        .toBe(PACKAGE_SCOPES.UNASSIGNED)
      expect(durablePackageIdentity(draft)).toBe(`${row.id}::${row.kind === 'iperf3' ? 'iperf3' : 'rf_data'}`)
    }
  })

  it('keeps current, unassigned, other-task and all-device scopes without dropping morning packages', () => {
    const drafts = [
      currentTaskDraft(),
      otherTaskDraft(),
      ...MORNING_SESSIONS.map((row) => morningDraft(row.id, { kind: row.kind })),
    ]
    const { partitioned, matched, others, warnings } = filterDraftsForActiveContext(drafts, {
      taskLabel: CURRENT_TASK,
      grid: CURRENT_GRID,
    })
    const scoped = applyScopeAutoSelection(partitioned)

    expect(matched).toHaveLength(1)
    expect(others).toHaveLength(6)
    expect(scoped.unassigned).toHaveLength(5)
    expect(scoped.other_tasks).toHaveLength(1)
    expect(scoped.all_device).toHaveLength(7)
    expect(draftsForScope(scoped, PACKAGE_SCOPES.ALL_DEVICE).map((d) => d.session.id))
      .toEqual(expect.arrayContaining(MORNING_SESSIONS.map((row) => row.id)))
    expect(scoped.current_task.every((d) => d.selected === true)).toBe(true)
    expect(scoped.unassigned.every((d) => d.selected === false)).toBe(true)
    expect(scoped.other_tasks.every((d) => d.selected === false)).toBe(true)
    expect(warnings.join(' ')).toMatch(/unassigned/i)
  })

  it('does not silently auto-select unassigned packages when a current-task match exists', () => {
    const drafts = [currentTaskDraft(), morningDraft('bd-rf-1787575357767')]
    const scoped = applyScopeAutoSelection(partitionDraftsByScope(drafts, {
      taskLabel: CURRENT_TASK,
      grid: CURRENT_GRID,
    }))
    expect(scoped.current_task[0].selected).toBe(true)
    expect(scoped.unassigned[0].selected).toBe(false)
  })

  it('supports explicit selection restore across restart without auto-selecting unassigned leftovers', () => {
    const drafts = applyScopeAutoSelection(partitionDraftsByScope([
      currentTaskDraft(),
      morningDraft('bd-rf-1787575357767'),
    ], { taskLabel: CURRENT_TASK, grid: CURRENT_GRID })).all_device
    const morningId = 'bd-rf-1787575357767::rf_data'
    const restored = restoreSelectedIdentities(drafts, [morningId])
    const morning = restored.find((d) => durablePackageIdentity(d) === morningId)
    const current = restored.find((d) => durablePackageIdentity(d) === 'bd-rf-current-1::native_http')
    expect(morning.selected).toBe(true)
    expect(current.selected).toBe(false)
  })

  it('deduplicates by durable session/package identity, not display name', () => {
    const a = morningDraft('bd-rf-1787575357767', { packageId: 'pkg-a' })
    const cloneName = {
      ...morningDraft('bd-rf-1787575357767', { packageId: 'pkg-a' }),
      label: 'Renamed display',
      draftId: 'other-draft-id',
    }
    const b = morningDraft('bd-rf-1787575493983', { packageId: 'pkg-b' })
    const unique = dedupeDraftsByIdentity([a, cloneName, b])
    expect(unique).toHaveLength(2)
    expect(unique.map((d) => d.session.id)).toEqual(['bd-rf-1787575357767', 'bd-rf-1787575493983'])
  })

  it('creates upload-association metadata without rewriting original identity', () => {
    const ok = buildUploadAssociation({
      packageId: 'bd-rf-1787575357767',
      sessionId: 'bd-rf-1787575357767',
      originalTask: 'No active task',
      originalGrid: 'Grid pending',
      currentTask: CURRENT_TASK,
      currentGrid: CURRENT_GRID,
    })
    expect(ok.ok).toBe(true)
    expect(ok.association.originalImmutable).toBe(true)
    expect(ok.association.packageId).toBe('bd-rf-1787575357767')
    expect(ok.association.originalTask).toBe('No active task')
    expect(ok.association.associatedTask).toBe(CURRENT_TASK)
  })

  it('rejects ambiguous association rather than guessing', () => {
    expect(buildUploadAssociation({
      packageId: 'bd-rf-1787575357767',
      sessionId: 'bd-rf-1787575357767',
      currentTask: 'No active task',
      currentGrid: 'Grid pending',
    })).toEqual({ ok: false, reason: 'ambiguous_no_current_task' })
    expect(buildUploadAssociation({
      currentTask: CURRENT_TASK,
      currentGrid: CURRENT_GRID,
    })).toEqual({ ok: false, reason: 'ambiguous_missing_package_identity' })
  })

  it('proves the attached morning ZIP contains five unassigned sessions and two iPerf packages', async () => {
    expect(fs.existsSync(MORNING_ZIP)).toBe(true)
    const zip = await JSZip.loadAsync(fs.readFileSync(MORNING_ZIP))
    const names = Object.keys(zip.files)
    const reportNames = names.filter((n) => /Report\.json$/i.test(n) && !zip.files[n].dir)
    const iperfJson = names.filter((n) => /iPerf3_.*\.json$/i.test(n) && !zip.files[n].dir)
    expect(reportNames).toHaveLength(5)
    expect(iperfJson).toHaveLength(2)
    const ids = []
    for (const reportName of reportNames) {
      const report = JSON.parse(await zip.file(reportName).async('string'))
      const session = report.session || {}
      const sessionId = session.session_id || session.id
      ids.push(sessionId)
      const draft = buildUnifiedDraftFromSession({
        id: sessionId,
        taskLabel: session.task || 'No active task',
        grid: session.grid || 'Grid pending',
        sourcePackage: reportName,
      }, { packageId: sessionId, selected: false })
      expect(session.task).toBe('No active task')
      expect(session.grid).toBe('Grid pending')
      expect(session.grid_internal_id).toBeNull()
      expect(session.report_log_name).toBeNull()
      expect(classifyDraftScope(draft, { taskLabel: CURRENT_TASK, grid: CURRENT_GRID }))
        .toBe(PACKAGE_SCOPES.UNASSIGNED)
    }
    expect(ids.sort()).toEqual(MORNING_SESSIONS.map((row) => row.id).sort())
  })
})
