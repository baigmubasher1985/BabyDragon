/**
 * F10C2 Phase 3 — QC validation + history + decision coverage.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  buildAppendQcHistoryEntry,
  validateFieldResultQcDecision,
} from '../../src/fieldResults/qc/qcValidation.js'
import { FIELD_RESULT_QC_DECISIONS } from '../../src/fieldResults/models/fieldResultTypes.js'
import { createFieldResultsRepository } from '../../src/fieldResults/repository/fieldResultsRepository.js'
import { buildFieldResultsFixtures } from '../../src/fieldResults/fixtures/fieldResultsFixtures.js'

describe('f10c2 phase3 — QC validation', () => {
  it('supports every Phase 3 field-result QC decision', () => {
    expect(FIELD_RESULT_QC_DECISIONS).toEqual([
      'QC Passed',
      'QC Failed',
      'Needs Re-drive',
      'Waiting for Processing',
      'Waiting for Logs',
      'Log Naming Issue',
      'Missing Evidence',
    ])
  })

  it('requires notes for QC Failed', () => {
    const r = validateFieldResultQcDecision(
      { decision: 'QC Failed', notes: '' },
      { processing_state: 'ready', artifacts: [] },
    )
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.code === 'notes_required')).toBe(true)
  })

  it('requires re-drive reason for Needs Re-drive', () => {
    const r = validateFieldResultQcDecision(
      { decision: 'Needs Re-drive', notes: 'x', redriveReason: '' },
      { processing_state: 'ready', artifacts: [] },
    )
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.code === 'redrive_reason_required')).toBe(true)
  })

  it('requires missing evidence details', () => {
    const r = validateFieldResultQcDecision(
      { decision: 'Missing Evidence', notes: 'x', missingEvidence: [] },
      { processing_state: 'ready', artifacts: [] },
    )
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.code === 'missing_evidence_required')).toBe(true)
  })

  it('blocks final decisions while processing incomplete', () => {
    const r = validateFieldResultQcDecision(
      { decision: 'QC Passed', notes: '' },
      { processing_state: 'processing', artifacts: [] },
    )
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.code === 'processing_incomplete')).toBe(true)

    const wait = validateFieldResultQcDecision(
      { decision: 'Waiting for Processing', notes: '' },
      { processing_state: 'processing', artifacts: [] },
    )
    expect(wait.ok).toBe(true)
  })

  it('blocks QC Passed when required artifacts missing unless override', () => {
    const result = {
      processing_state: 'ready',
      artifacts: [{ required: true, missing: true, available: false }],
    }
    const blocked = validateFieldResultQcDecision({ decision: 'QC Passed' }, result)
    expect(blocked.ok).toBe(false)
    const allowed = validateFieldResultQcDecision(
      { decision: 'QC Passed', allowMissingArtifactOverride: true },
      result,
    )
    expect(allowed.ok).toBe(true)
  })

  it('append history keeps previous decision pointer', () => {
    const e1 = buildAppendQcHistoryEntry({
      previousHistory: [],
      decision: 'Waiting for Logs',
      notes: 'queued',
      reviewer: { id: 'a', name: 'Admin' },
    })
    const e2 = buildAppendQcHistoryEntry({
      previousHistory: [e1],
      decision: 'QC Passed',
      notes: 'ok',
      reviewer: { id: 'a', name: 'Admin' },
    })
    expect(e2.previous_decision).toBe('Waiting for Logs')
    expect(e1.decision).toBe('Waiting for Logs')
  })
})

describe('f10c2 phase3 — QC provider decisions coverage', () => {
  let repo
  beforeEach(() => {
    repo = createFieldResultsRepository({ forceNew: true })
    repo.reset()
  })

  it('can save each waiting/final decision on a ready result when valid', async () => {
    const actor = { id: 'adm', role: 'admin', name: 'Admin' }
    const cases = [
      { decision: 'Waiting for Logs', notes: '' },
      { decision: 'Log Naming Issue', notes: 'bad name' },
      {
        decision: 'Missing Evidence',
        notes: 'need files',
        missingEvidence: ['rf_csv'],
      },
      { decision: 'QC Failed', notes: 'criteria fail' },
      { decision: 'Needs Re-drive', notes: 'retry', redriveReason: 'coverage hole' },
      { decision: 'QC Passed', notes: 'human pass' },
    ]
    for (const c of cases) {
      const res = await repo.saveResultQcDecision('run-native-http-success', c, actor)
      expect(res.ok, c.decision).toBe(true)
      expect(res.result.overview.latest_qc_status).toBe(c.decision)
    }
  })

  it('preserves existing task-level QC decision vocabulary (compatibility)', () => {
    // Task-level QCReview decisions remain unchanged in source
    const legacy = [
      'QC Passed',
      'QC Failed',
      'Needs Re-drive',
      'Waiting for Logs',
      'Log Naming Issue',
      'Missing Evidence',
    ]
    for (const d of legacy) {
      expect(FIELD_RESULT_QC_DECISIONS).toContain(d)
    }
    // Additive only
    expect(FIELD_RESULT_QC_DECISIONS).toContain('Waiting for Processing')
  })

  it('fixtures include QC Passed/Failed/Missing Evidence/Needs Re-drive', () => {
    const { runs } = buildFieldResultsFixtures()
    const statuses = new Set(runs.map((r) => r.latest_qc_status))
    expect(statuses.has('QC Passed')).toBe(true)
    expect(statuses.has('QC Failed')).toBe(true)
    expect(statuses.has('Missing Evidence')).toBe(true)
    expect(statuses.has('Needs Re-drive')).toBe(true)
  })
})
