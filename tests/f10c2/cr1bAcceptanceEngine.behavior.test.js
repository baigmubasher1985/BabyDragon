/**
 * F10C2 CR1-B — acceptance engine behavior (local, no live DB).
 */
import { describe, it, expect } from 'vitest'
import { VERDICTS, compareThreshold } from '../../src/acceptance/verdicts.js'
import { resolveAcceptanceProfile } from '../../src/acceptance/profileResolution.js'
import { evaluateDlUlIteration, evaluateDlUlRun } from '../../src/acceptance/dlUlEvaluation.js'
import { evaluateMoMt } from '../../src/acceptance/moMtEvaluation.js'
import { evaluateFieldTestRun } from '../../src/acceptance/evaluateRun.js'
import { createCanonicalIngestStore, extractCanonicalMeasurements } from '../../src/acceptance/canonicalIngest.js'
import {
  canMutateAcceptanceProfile,
  denyQcMutation,
  denyOverride,
} from '../../src/acceptance/permissions.js'

const baseRules = {
  min_dl_mbps: 100,
  min_ul_mbps: 10,
  enabled_directions: ['dl', 'ul'],
  combine_mode: 'AND',
  required_completed_iterations: 1,
}

describe('f10c2 cr1b — DL/UL thresholds', () => {
  it('treats equality as PASS, above as PASS, below as FAIL', () => {
    expect(compareThreshold(100, 100)).toMatchObject({ verdict: VERDICTS.PASS, reason: 'equal' })
    expect(compareThreshold(120, 100)).toMatchObject({ verdict: VERDICTS.PASS, reason: 'above' })
    expect(compareThreshold(99.9, 100)).toMatchObject({ verdict: VERDICTS.FAIL, reason: 'below' })
  })

  it('never converts a missing measurement to zero FAIL', () => {
    const missing = evaluateDlUlIteration({ iteration_number: 1, status: 'completed', dl_mbps: null, ul_mbps: 12 }, baseRules)
    expect(missing.actual_dl_mbps).toBeNull()
    expect(missing.dl_verdict).toBe(VERDICTS.INCOMPLETE)
    expect(missing.overall_verdict).toBe(VERDICTS.INCOMPLETE)
    expect(missing.incomplete_reason).toBe('missing_measurement')
  })

  it('marks execution failure INCOMPLETE instead of zero-throughput FAIL', () => {
    const failed = evaluateDlUlIteration({
      iteration_number: 2,
      status: 'failed',
      execution_failed: true,
      dl_mbps: null,
      ul_mbps: null,
      failure_reason: 'native_http_timeout',
    }, baseRules)
    expect(failed.dl_verdict).toBe(VERDICTS.INCOMPLETE)
    expect(failed.ul_verdict).toBe(VERDICTS.INCOMPLETE)
    expect(failed.overall_verdict).toBe(VERDICTS.INCOMPLETE)
    expect(failed.overall_verdict).not.toBe(VERDICTS.FAIL)
  })

  it('marks unsupported engines NOT_EVALUATED', () => {
    const row = evaluateDlUlIteration({ iteration_number: 1, scenario_kind: 'ookla_app', dl_mbps: 200, ul_mbps: 20 }, baseRules, 'ookla_app')
    expect(row.overall_verdict).toBe(VERDICTS.NOT_EVALUATED)
  })
})

describe('f10c2 cr1b — DL-only / UL-only / DL+UL AND/OR', () => {
  const iter = { iteration_number: 1, status: 'completed', dl_mbps: 150, ul_mbps: 5 }

  it('evaluates DL only', () => {
    const row = evaluateDlUlIteration(iter, { ...baseRules, enabled_directions: ['dl'] })
    expect(row.dl_verdict).toBe(VERDICTS.PASS)
    expect(row.ul_verdict).toBe(VERDICTS.NA)
    expect(row.overall_verdict).toBe(VERDICTS.PASS)
  })

  it('evaluates UL only', () => {
    const row = evaluateDlUlIteration(iter, { ...baseRules, enabled_directions: ['ul'] })
    expect(row.ul_verdict).toBe(VERDICTS.FAIL)
    expect(row.dl_verdict).toBe(VERDICTS.NA)
    expect(row.overall_verdict).toBe(VERDICTS.FAIL)
  })

  it('AND requires both enabled directions', () => {
    const row = evaluateDlUlIteration(iter, { ...baseRules, combine_mode: 'AND' })
    expect(row.dl_verdict).toBe(VERDICTS.PASS)
    expect(row.ul_verdict).toBe(VERDICTS.FAIL)
    expect(row.overall_verdict).toBe(VERDICTS.FAIL)
  })

  it('OR passes when either enabled direction passes', () => {
    const row = evaluateDlUlIteration(iter, { ...baseRules, combine_mode: 'OR' })
    expect(row.overall_verdict).toBe(VERDICTS.PASS)
  })
})

describe('f10c2 cr1b — count fields', () => {
  it('exposes requested/attempted/completed/execution-failed/evaluable and pass/fail rates', () => {
    const result = evaluateDlUlRun({
      iterations: [
        { iteration_number: 1, status: 'completed', dl_mbps: 110, ul_mbps: 12 },
        { iteration_number: 2, status: 'completed', dl_mbps: 80, ul_mbps: 12 },
        { iteration_number: 3, status: 'failed', execution_failed: true },
      ],
      rules: baseRules,
      requested: 3,
      attempted: 3,
      completed: 2,
      failed: 1,
    })
    expect(result.counts.requested).toBe(3)
    expect(result.counts.attempted).toBe(3)
    expect(result.counts.completed).toBe(2)
    expect(result.counts.execution_failed).toBe(1)
    expect(result.counts.evaluable).toBeGreaterThan(0)
    expect(result.counts.dl_pass).toBe(1)
    expect(result.counts.dl_fail).toBe(1)
    expect(result.counts.ul_pass).toBe(2)
    expect(result.overall_verdict).toBe(VERDICTS.INCOMPLETE)
  })
})

describe('f10c2 cr1b — MO/MT', () => {
  const events = [
    { direction: 'MO', event_type: 'success' },
    { direction: 'MO', event_type: 'failed' },
    { direction: 'MT', event_type: 'success' },
    { direction: 'MT', event_type: 'incomplete' },
  ]

  it('counts from persisted events and compares required vs actual', () => {
    const result = evaluateMoMt({
      events,
      rules: { enabled_directions: ['MO', 'MT'], required_mo_success: 1, required_mt_success: 2, combine_mode: 'AND' },
    })
    expect(result.mo.attempted).toBe(2)
    expect(result.mo.successful).toBe(1)
    expect(result.mo.failed).toBe(1)
    expect(result.mt.incomplete).toBe(1)
    expect(result.mo.verdict).toBe(VERDICTS.PASS)
    expect(result.mt.verdict).toBe(VERDICTS.FAIL)
    expect(result.overall_verdict).toBe(VERDICTS.FAIL)
  })

  it('displays N/A not PASS for disabled directions', () => {
    const result = evaluateMoMt({
      events,
      rules: { enabled_directions: ['MO'], required_mo_success: 1, required_mt_success: 0 },
    })
    expect(result.mt.verdict).toBe(VERDICTS.NA)
    expect(result.mt.verdict).not.toBe(VERDICTS.PASS)
    expect(result.mo.verdict).toBe(VERDICTS.PASS)
  })
})

describe('f10c2 cr1b — profile precedence and snapshots', () => {
  const tenant = { id: 'p-tenant', scope_type: 'tenant', tenant_id: 't1', is_default: true, is_active: true, version: 1, rules: baseRules }
  const project = { id: 'p-proj', scope_type: 'project', scope_id: 'proj-1', is_active: true, version: 2, rules: { ...baseRules, min_dl_mbps: 50 } }
  const task = { id: 'p-task', scope_type: 'task', scope_id: 'task-1', is_active: true, version: 3, rules: { ...baseRules, min_dl_mbps: 20 } }

  it('resolves task override over project over tenant default', () => {
    const r = resolveAcceptanceProfile({ taskId: 'task-1', projectId: 'proj-1', tenantId: 't1', profiles: [tenant, project, task] })
    expect(r.ok).toBe(true)
    expect(r.scope).toBe('task')
    expect(r.profile.id).toBe('p-task')
  })

  it('rejects ambiguous resolution at the winning level', () => {
    const r = resolveAcceptanceProfile({
      taskId: 'task-1',
      projectId: 'proj-1',
      profiles: [task, { ...task, id: 'p-task-2' }],
    })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('ambiguous_profile_resolution')
  })

  it('stores an immutable snapshot that later threshold changes cannot rewrite', () => {
    const first = evaluateFieldTestRun({
      run: { task_id: 'task-1', project_id: 'proj-1', tenant_id: 't1', scenario_type: 'iperf3' },
      iterations: [{ iteration_number: 1, status: 'completed', dl_mbps: 30, ul_mbps: 12 }],
      profiles: [task],
      evaluatedAt: '2026-08-24T12:00:00.000Z',
    })
    expect(first.ok).toBe(true)
    expect(first.snapshot.profile_version).toBe(3)
    expect(first.snapshot.overall_verdict).toBe(VERDICTS.PASS)

    const changedProfiles = [{ ...task, rules: { ...baseRules, min_dl_mbps: 999 }, version: 4 }]
    const second = evaluateFieldTestRun({
      run: { task_id: 'task-1', project_id: 'proj-1' },
      iterations: [{ iteration_number: 1, status: 'completed', dl_mbps: 30, ul_mbps: 12 }],
      profiles: changedProfiles,
      existingSnapshot: first.snapshot,
    })
    expect(second.idempotent).toBe(true)
    expect(second.snapshot.overall_verdict).toBe(VERDICTS.PASS)
    expect(second.snapshot.profile_version).toBe(3)
    expect(second.snapshot.resolved_rules.dl_ul.min_dl_mbps).toBe(20)
  })
})

describe('f10c2 cr1b — canonical ingest idempotency', () => {
  const profiles = [{
    id: 'p1',
    scope_type: 'tenant',
    is_default: true,
    is_active: true,
    version: 1,
    rules: baseRules,
  }]

  function payload(overrides = {}) {
    return {
      client_run_id: 'client-run-1',
      idempotency_key: 'pkg:client-run-1',
      package_identity: 'pkg-1',
      task_id: 'task-1',
      project_id: 'proj-1',
      scenario_type: 'iperf3',
      manifest: {
        client_run_id: 'client-run-1',
        task_id: 'task-1',
        project_id: 'proj-1',
        scenario_type: 'iperf3',
        data_summary: { scenarios: [{ attempt_counts: { planned: 1, completed: 1, failed: 0 } }] },
      },
      iterations: [{ iteration_number: 1, status: 'completed', dl_mbps: 120, ul_mbps: 15 }],
      ...overrides,
    }
  }

  it('returns the same server result for a repeated package/idempotency identity', () => {
    const store = createCanonicalIngestStore({ profiles })
    const first = store.ingest(payload())
    const second = store.ingest(payload())
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(second.idempotent).toBe(true)
    expect(second.run.id).toBe(first.run.id)
    expect(store.list()).toHaveLength(1)
    expect(second.run.iterations).toHaveLength(1)
  })

  it('rejects idempotency key reuse for a different identity', () => {
    const store = createCanonicalIngestStore({ profiles })
    expect(store.ingest(payload()).ok).toBe(true)
    const reuse = store.ingest(payload({ client_run_id: 'other-run', package_identity: 'pkg-other' }))
    expect(reuse.ok).toBe(false)
    expect(reuse.code).toBe('idempotency_key_reuse')
  })

  it('is idempotent on re-evaluation', () => {
    const store = createCanonicalIngestStore({ profiles })
    store.ingest(payload())
    const again = store.reevaluate('client-run-1')
    expect(again.ok).toBe(true)
    expect(again.idempotent).toBe(true)
    expect(again.snapshot.overall_verdict).toBe(VERDICTS.PASS)
  })

  it('coerces epoch-millis iteration timestamps to ISO before ingest', () => {
    const extracted = extractCanonicalMeasurements({
      client_run_id: 'client-run-ts',
      identity_key: 'session:bd-rf-1787694437783|scenario:native_http',
      manifest: {
        scenario_type: 'native_http',
        data_summary: {
          scenarios: [{
            scenario_type: 'native_http',
            iterations: [{
              iteration: 1,
              status: 'complete',
              dl_mbps: 175.65,
              ul_mbps: 93.47,
              started_at: 1787694437966,
              ended_at: 1787694445261,
            }],
          }],
        },
      },
    })
    expect(extracted.iterations[0].started_at).toBe('2026-08-25T21:47:17.966Z')
    expect(extracted.iterations[0].ended_at).toBe('2026-08-25T21:47:25.261Z')
    expect(String(extracted.iterations[0].started_at)).not.toMatch(/^\d{13}$/)
  })
})

describe('f10c2 cr1b — permissions', () => {
  it('allows only admin and super_admin to mutate profiles', () => {
    expect(canMutateAcceptanceProfile('admin')).toBe(true)
    expect(canMutateAcceptanceProfile('super_admin')).toBe(true)
    expect(canMutateAcceptanceProfile('fe')).toBe(false)
    expect(canMutateAcceptanceProfile('anonymous')).toBe(false)
  })

  it('denies FE and anonymous QC mutation and audited override', () => {
    expect(denyQcMutation({ role: 'fe', id: 'fe-1' }).ok).toBe(false)
    expect(denyQcMutation({ role: 'anonymous' }).ok).toBe(false)
    expect(denyQcMutation({}).ok).toBe(false)
    expect(denyQcMutation({ role: 'admin', id: 'adm-1' }).ok).toBe(true)
    expect(denyQcMutation({ role: 'super_admin', id: 'sa-1' }).ok).toBe(true)
    expect(denyOverride({ role: 'fe', id: 'fe-1' }).ok).toBe(false)
    expect(denyOverride({ role: 'qc', id: 'qc-1' }).ok).toBe(false)
    expect(denyOverride({ role: 'admin', id: 'adm-1' }).ok).toBe(true)
  })

  it('persists QC and audited override without rewriting the computed snapshot', () => {
    const store = createCanonicalIngestStore({
      profiles: [{ id: 'p1', scope_type: 'tenant', is_default: true, is_active: true, version: 1, rules: baseRules }],
    })
    const ingested = store.ingest({
      client_run_id: 'c1',
      idempotency_key: 'k1',
      package_identity: 'p1',
      iterations: [{ iteration_number: 1, status: 'completed', dl_mbps: 120, ul_mbps: 15 }],
      manifest: { scenario_type: 'iperf3', data_summary: {} },
    })
    const computed = ingested.run.acceptance_snapshot.overall_verdict
    const qc = store.saveQc(ingested.run.id, { decision: 'QC Passed', notes: 'looks good' }, { id: 'adm-1', role: 'admin' })
    expect(qc.ok).toBe(true)
    const again = store.saveQc(ingested.run.id, { decision: 'QC Passed', notes: 'looks good' }, { id: 'adm-1', role: 'admin' })
    expect(again.review.id).toBe(qc.review.id)
    const ov = store.overrideVerdict(ingested.run.id, { verdict: 'FAIL', reason: 'customer dispute' }, { id: 'sa-1', role: 'super_admin' })
    expect(ov.ok).toBe(true)
    expect(ov.override.computed_verdict).toBe(computed)
    expect(ov.override.override_verdict).toBe('FAIL')
    expect(ov.override.reason).toBe('customer dispute')
    expect(ov.override.actor_id).toBe('sa-1')
    expect(store.getByClientRunId('c1').acceptance_snapshot.overall_verdict).toBe(computed)
  })
})
