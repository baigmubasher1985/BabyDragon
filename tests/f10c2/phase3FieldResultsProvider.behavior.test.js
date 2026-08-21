/**
 * F10C2 Phase 3 — Field Results provider behavior (mock only).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createFieldResultsRepository,
  resetFieldResultsRepository,
} from '../../src/fieldResults/repository/fieldResultsRepository.js'
import { buildFieldResultsFixtures } from '../../src/fieldResults/fixtures/fieldResultsFixtures.js'

describe('f10c2 phase3 — mock provider', () => {
  /** @type {ReturnType<typeof createFieldResultsRepository>} */
  let repo

  beforeEach(() => {
    resetFieldResultsRepository()
    repo = createFieldResultsRepository({ forceNew: true })
    repo.reset()
  })

  it('lists deterministic fixtures with pagination', async () => {
    const fixtures = buildFieldResultsFixtures()
    const page1 = await repo.listFieldResults({}, { page: 1, pageSize: 5 })
    expect(page1.ok).toBe(true)
    expect(page1.status).toBe('success')
    expect(page1.rows).toHaveLength(5)
    expect(page1.total).toBe(fixtures.runs.length)
    expect(page1.hasNext).toBe(true)
    const page2 = await repo.listFieldResults({}, { page: 2, pageSize: 5 })
    expect(page2.rows[0].id).not.toBe(page1.rows[0].id)
  })

  it('filters by scenario and QC decision', async () => {
    const http = await repo.listFieldResults({ scenario: 'native_http' }, { page: 1, pageSize: 50 })
    expect(http.ok).toBe(true)
    expect(http.rows.every((r) => r.scenario_type === 'native_http')).toBe(true)
    expect(http.rows.every((r) => r.scenario_label === 'Native HTTP')).toBe(true)

    const passed = await repo.listFieldResults({ qc_decision: 'QC Passed' }, { page: 1, pageSize: 50 })
    expect(passed.rows.every((r) => r.latest_qc_status === 'QC Passed')).toBe(true)
  })

  it('does not include raw RF samples on list rows', async () => {
    const res = await repo.listFieldResults({}, { page: 1, pageSize: 50 })
    for (const row of res.rows) {
      expect(row.raw_rf_samples).toBeUndefined()
      expect(row.has_raw_rf_samples).toBe(false)
      expect(row.rf_samples).toBeUndefined()
    }
  })

  it('returns empty and error/retry simulation', async () => {
    repo.setSimulation({ emptyList: true })
    const empty = await repo.listFieldResults({}, { page: 1, pageSize: 10 })
    expect(empty.status).toBe('empty')
    expect(empty.rows).toHaveLength(0)

    repo.setSimulation({ emptyList: false, failNextList: true })
    const fail = await repo.listFieldResults({}, { page: 1, pageSize: 10 })
    expect(fail.ok).toBe(false)
    expect(fail.retryable).toBe(true)

    const ok = await repo.listFieldResults({}, { page: 1, pageSize: 10 })
    expect(ok.ok).toBe(true)
  })

  it('getFieldResult detail and not found', async () => {
    const ok = await repo.getFieldResult('run-nr-sa')
    expect(ok.ok).toBe(true)
    expect(ok.result.rf_summary.nr_mode).toBe('SA')
    expect(ok.result.has_raw_rf_samples).toBe(false)

    const miss = await repo.getFieldResult('does-not-exist')
    expect(miss.ok).toBe(false)
    expect(miss.error.code).toBe('not_found')
  })

  it('artifact access never returns signed/public URLs; missing not downloadable', async () => {
    const ok = await repo.requestArtifactAccess('run-native-http-success', 'art-http-json')
    expect(ok.ok).toBe(true)
    expect(ok.mock).toBe(true)
    expect(ok.access.public_url).toBeNull()
    expect(ok.access.signed_url).toBeNull()
    expect(ok.access.notice).toMatch(/MOCK/i)

    const miss = await repo.requestArtifactAccess('run-missing-artifact', 'art-miss-req')
    expect(miss.ok).toBe(false)
    expect(miss.downloadable).toBe(false)
  })

  it('saves QC decision append-only and idempotent on duplicate', async () => {
    const actor = { id: 'adm-1', name: 'Admin', role: 'admin' }
    const payload = {
      decision: 'QC Failed',
      notes: 'Throughput criteria not met',
      redriveReason: '',
      missingEvidence: [],
    }
    const first = await repo.saveResultQcDecision('run-ftp-updown', payload, actor)
    expect(first.ok).toBe(true)
    expect(first.idempotent).toBe(false)
    const histLen = first.result.qc_history.length

    const second = await repo.saveResultQcDecision('run-ftp-updown', payload, actor)
    expect(second.ok).toBe(true)
    expect(second.idempotent).toBe(true)
    expect(second.result.qc_history).toHaveLength(histLen)

    const priorIds = first.result.qc_history.map((h) => h.id)
    const stillSame = priorIds.every((id) => second.result.qc_history.some((h) => h.id === id))
    expect(stillSame).toBe(true)
  })

  it('blocks FE from QC save and re-drive', async () => {
    const fe = { id: 'fe-1', role: 'fe', name: 'FE' }
    const save = await repo.saveResultQcDecision(
      'run-native-http-success',
      { decision: 'QC Passed', notes: '' },
      fe,
    )
    expect(save.ok).toBe(false)
    expect(save.error.code).toBe('forbidden_role')

    const rd = await repo.createOrLinkRedrive('run-needs-redrive', 'coverage hole', fe)
    expect(rd.ok).toBe(false)
  })

  it('createOrLinkRedrive preserves original task and links redrive task', async () => {
    const actor = { id: 'adm-1', role: 'admin', name: 'Admin' }
    const before = await repo.getFieldResult('run-needs-redrive')
    const originalTask = before.result.overview.task_id
    const res = await repo.createOrLinkRedrive(
      'run-needs-redrive',
      'Missing GPS coverage on assigned grid',
      actor,
    )
    expect(res.ok).toBe(true)
    expect(res.original_task_id).toBe(originalTask)
    expect(res.redrive_task_id).toBeTruthy()
    expect(res.result.overview.task_id).toBe(originalTask)
    expect(res.result.overview.redrive_task_id).toBe(res.redrive_task_id)
  })

  it('rejects non-mock provider kinds in Phase 3', () => {
    expect(() => createFieldResultsRepository({ kind: 'supabase' })).toThrow(/mock-only/i)
  })
})
