/**
 * F10C2 CR1 — scenario-aware acceptance applicability.
 */
import { describe, it, expect } from 'vitest'
import { VERDICTS } from '../../src/acceptance/verdicts.js'
import { evaluateFieldTestRun } from '../../src/acceptance/evaluateRun.js'
import { resolveScenarioApplicability } from '../../src/acceptance/scenarioApplicability.js'

const dataProfile = {
  id: 'p-data',
  scope_type: 'tenant',
  is_default: true,
  is_active: true,
  version: 4,
  rules: {
    dl_ul: { min_dl_mbps: 50, min_ul_mbps: 5, enabled_directions: ['dl', 'ul'], combine_mode: 'AND', required_completed_iterations: 1 },
    mo_mt: { enabled_directions: ['MO', 'MT'], required_mo_success: 1, required_mt_success: 0 },
  },
}

const combinedProfile = {
  ...dataProfile,
  id: 'p-combined',
  kind: 'combined',
  rules: {
    ...dataProfile.rules,
    family: 'combined',
  },
}

describe('f10c2 cr1 — applicability resolver', () => {
  it('marks MO/MT not applicable for data-only native_http even when profile has mo_mt rules', () => {
    const a = resolveScenarioApplicability({
      scenarioType: 'native_http',
      iterations: [{ dl_mbps: 195.84, ul_mbps: 117.68 }],
      callEvents: [],
      profile: dataProfile,
    })
    expect(a.evaluate_data).toBe(true)
    expect(a.evaluate_voice).toBe(false)
    expect(a.excluded).toContain('mo_mt')
  })

  it('requires admin combined profile AND both evidence families', () => {
    const noVoice = resolveScenarioApplicability({
      scenarioType: 'native_http',
      iterations: [{ dl_mbps: 100, ul_mbps: 20 }],
      callEvents: [],
      profile: combinedProfile,
    })
    expect(noVoice.evaluate_voice).toBe(false)

    const both = resolveScenarioApplicability({
      scenarioType: 'combined',
      iterations: [{ dl_mbps: 100, ul_mbps: 20 }],
      callEvents: [{ direction: 'MO', event_type: 'success' }],
      profile: combinedProfile,
    })
    expect(both.evaluate_voice).toBe(true)
    expect(both.evaluate_data).toBe(true)
  })
})

describe('f10c2 cr1 — HTTP data-only overall ignores MO', () => {
  it('HTTP DL PASS UL PASS MO N/A overall PASS', () => {
    const result = evaluateFieldTestRun({
      run: { scenario_type: 'native_http', task_id: 't1', project_id: 'p1', tenant_id: 'ten1' },
      iterations: [
        { iteration_number: 1, status: 'completed', dl_mbps: 175.65, ul_mbps: 93.47 },
        { iteration_number: 2, status: 'completed', dl_mbps: 216.03, ul_mbps: 141.89 },
      ],
      callEvents: [],
      profiles: [dataProfile],
    })
    expect(result.ok).toBe(true)
    expect(result.snapshot.dl_verdict).toBe(VERDICTS.PASS)
    expect(result.snapshot.ul_verdict).toBe(VERDICTS.PASS)
    expect(result.snapshot.mo_verdict).toBe(VERDICTS.NA)
    expect(result.snapshot.mt_verdict).toBe(VERDICTS.NA)
    expect(result.snapshot.overall_verdict).toBe(VERDICTS.PASS)
    expect(result.snapshot.resolved_rules.excluded_rules).toContain('mo_mt')
  })
})

describe('f10c2 cr1 — iPerf iteration aggregation, MO N/A, 6.01 unchanged', () => {
  it('iter1 DL FAIL 6.01, iter2 PASS, UL PASS, overall FAIL from aggregation', () => {
    const result = evaluateFieldTestRun({
      run: { scenario_type: 'iperf3', task_id: 't1', project_id: 'p1' },
      iterations: [
        { iteration_number: 1, status: 'completed', dl_mbps: 6.01, ul_mbps: 48.995 },
        { iteration_number: 2, status: 'completed', dl_mbps: 62.94, ul_mbps: 58.135 },
      ],
      callEvents: [],
      profiles: [dataProfile],
    })
    expect(result.snapshot.iteration_evaluations[0].actual_dl_mbps).toBe(6.01)
    expect(result.snapshot.iteration_evaluations[0].dl_verdict).toBe(VERDICTS.FAIL)
    expect(result.snapshot.iteration_evaluations[1].dl_verdict).toBe(VERDICTS.PASS)
    expect(result.snapshot.ul_verdict).toBe(VERDICTS.PASS)
    expect(result.snapshot.mo_verdict).toBe(VERDICTS.NA)
    expect(result.snapshot.overall_verdict).toBe(VERDICTS.FAIL)
  })
})

describe('f10c2 cr1 — voice-only and RF-only', () => {
  it('voice-only sets DL/UL N/A and evaluates MO', () => {
    const result = evaluateFieldTestRun({
      run: { scenario_type: 'voice_mo', task_id: 't1', project_id: 'p1' },
      iterations: [],
      callEvents: [{ direction: 'MO', event_type: 'success' }],
      profiles: [dataProfile],
    })
    expect(result.snapshot.dl_verdict).toBe(VERDICTS.NA)
    expect(result.snapshot.ul_verdict).toBe(VERDICTS.NA)
    expect(result.snapshot.mo_verdict).toBe(VERDICTS.PASS)
    expect(result.snapshot.overall_verdict).toBe(VERDICTS.PASS)
  })

  it('RF-only does not evaluate data or voice unless combined', () => {
    const result = evaluateFieldTestRun({
      run: { scenario_type: 'rf_only', task_id: 't1', project_id: 'p1' },
      iterations: [],
      callEvents: [],
      profiles: [dataProfile],
    })
    expect(result.snapshot.dl_verdict).toBe(VERDICTS.NA)
    expect(result.snapshot.ul_verdict).toBe(VERDICTS.NA)
    expect(result.snapshot.mo_verdict).toBe(VERDICTS.NA)
    expect(result.snapshot.overall_verdict).toBe(VERDICTS.NOT_EVALUATED)
  })
})

describe('f10c2 cr1 — missing measurements stay null', () => {
  it('does not convert missing DL to numeric 0', () => {
    const result = evaluateFieldTestRun({
      run: { scenario_type: 'native_http' },
      iterations: [{ iteration_number: 1, status: 'completed', dl_mbps: null, ul_mbps: 20 }],
      profiles: [dataProfile],
    })
    expect(result.snapshot.iteration_evaluations[0].actual_dl_mbps).toBeNull()
    expect(result.snapshot.iteration_evaluations[0].dl_verdict).toBe(VERDICTS.INCOMPLETE)
    expect(result.snapshot.overall_verdict).toBe(VERDICTS.INCOMPLETE)
  })
})
