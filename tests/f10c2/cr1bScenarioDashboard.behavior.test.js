/**
 * F10C2 CR1 — all-scenario Field Results dashboard mapping / QC labels.
 */
import { describe, it, expect } from 'vitest'
import { buildFieldResultsFixtures } from '../../src/fieldResults/fixtures/fieldResultsFixtures.js'
import { buildDetailViewModel, toListRow } from '../../src/fieldResults/selectors/fieldResultSelectors.js'
import { scenarioLabel, resolveFieldResultsDashboardRole, canPerformFieldResultQc } from '../../src/fieldResults/models/fieldResultTypes.js'
import { mapFieldTestRunRow } from '../../src/fieldResults/repository/mapFieldTestRunRow.js'
import { displayAcceptanceFromSnapshot } from '../../src/acceptance/scenarioApplicability.js'
import { VERDICTS } from '../../src/acceptance/verdicts.js'
import { denyQcMutation } from '../../src/acceptance/permissions.js'

describe('f10c2 cr1 — scenario dashboard coverage', () => {
  const { runs } = buildFieldResultsFixtures()

  it('lists every required scenario family', () => {
    const types = new Set(runs.map((r) => r.scenario_type))
    for (const t of ['native_http', 'ftp', 'iperf3', 'ookla_app', 'fcc_app', 'rf_data', 'voice_mo', 'voice_mt', 'combined']) {
      expect(types.has(t)).toBe(true)
    }
    expect(scenarioLabel('voice_mo')).toBe('Voice MO')
    expect(scenarioLabel('voice_mt')).toBe('Voice MT')
    expect(scenarioLabel('combined')).toBe('Combined data + voice')
  })

  it('does not hide a family because another family is absent', () => {
    const ftp = buildDetailViewModel(runs.find((r) => r.scenario_type === 'ftp'))
    expect(ftp.scenario_details.kind || ftp.overview.scenario_type).toBeTruthy()
    const rf = buildDetailViewModel(runs.find((r) => r.scenario_type === 'rf_data'))
    expect(rf.overview.scenario_type).toBe('rf_data')
    expect(rf.test_summary).toBeTruthy()
  })

  it('keeps failures as failures and labels synthetic voice', () => {
    const mt = runs.find((r) => r.id === 'run-voice-mt-synthetic')
    expect(mt.acceptance_verdict).toBe('FAIL')
    expect(mt.call_summary.labeled_synthetic).toBe(true)
    const httpFail = runs.find((r) => r.completion_status === 'complete_with_failures')
    expect(httpFail.has_failures).toBe(true)
  })

  it('list rows stay summary-only', () => {
    for (const run of runs) {
      const row = toListRow(run)
      expect(row.has_raw_rf_samples).toBe(false)
    }
  })
})

describe('f10c2 cr1 — display applicability does not rewrite stored snapshot identity', () => {
  it('HTTP data-only overlay turns MO FAIL into N/A and overall PASS from DL/UL', () => {
    const displayed = displayAcceptanceFromSnapshot({
      snapshot: {
        overall_verdict: 'FAIL',
        dl_verdict: 'PASS',
        ul_verdict: 'PASS',
        mo_verdict: 'FAIL',
        mt_verdict: 'N/A',
        profile_id: 'p-data',
        profile_version: 4,
      },
      scenarioType: 'native_http',
      iterations: [{ dl_mbps: 175.65, ul_mbps: 93.47 }],
      callEvents: [],
    })
    expect(displayed.server_snapshot_retained).toBe(true)
    expect(displayed.server_overall_verdict).toBe('FAIL')
    expect(displayed.mo_verdict).toBe(VERDICTS.NA)
    expect(displayed.overall_verdict).toBe(VERDICTS.PASS)
    expect(displayed.profile_id).toBe('p-data')
    expect(displayed.profile_version).toBe(4)
  })

  it('maps live-shaped rows through the Field Results mapper', () => {
    const mapped = mapFieldTestRunRow({
      run: {
        id: 'abfa51c3-80d0-4cc7-b984-535c63c67995',
        client_run_id: '1e969145-3ddb-4636-adf2-7a1e08328be7',
        scenario_type: 'native_http',
        report_name: 'F10C2-P4BU-E2E',
        task_id: 'task-1',
        project_id: 'proj-1',
        started_at_device: '2026-08-25T21:47:17.783Z',
        data_summary: { metrics: { dl_mbps_avg: 195.84, ul_mbps_avg: 117.68 }, scenarios: [{ attempt_counts: { planned: 2, completed: 2, failed: 0 } }] },
        rf_summary: { sample_count: 18 },
        gps_summary: { sample_count: 18 },
      },
      acceptanceSnapshot: {
        overall_verdict: 'FAIL',
        dl_verdict: 'PASS',
        ul_verdict: 'PASS',
        mo_verdict: 'FAIL',
        mt_verdict: 'N/A',
        profile_id: 'p-data',
        profile_version: 4,
      },
      iterationEvaluations: [
        { iteration_number: 1, actual_dl_mbps: 175.65, actual_ul_mbps: 93.47, dl_verdict: 'PASS', ul_verdict: 'PASS' },
      ],
    })
    expect(mapped.acceptance.overall_verdict).toBe('PASS')
    expect(mapped.acceptance.mo_verdict).toBe('N/A')
    expect(mapped.scenario_details.dashboard.native_http.dl_mbps).toBe(195.84)
    expect(mapped.scenario_details.dashboard.rf_gps.rf_sample_count).toBe(18)
  })
})

describe('f10c2 cr1 — QC role gates', () => {
  it('denies FE and anonymous QC mutation', () => {
    expect(denyQcMutation({ role: 'fe', id: 'fe-1' }).ok).toBe(false)
    expect(denyQcMutation({ role: 'anonymous' }).ok).toBe(false)
    expect(denyQcMutation({ role: 'admin', id: 'adm-1' }).ok).toBe(true)
  })

  it('treats Auth JWT role authenticated as admin on the admin dashboard host', () => {
    expect(resolveFieldResultsDashboardRole('authenticated', { role: 'authenticated' })).toBe('admin')
    expect(canPerformFieldResultQc(resolveFieldResultsDashboardRole('authenticated'))).toBe(true)
    expect(canPerformFieldResultQc(resolveFieldResultsDashboardRole('fe'))).toBe(false)
    expect(canPerformFieldResultQc(resolveFieldResultsDashboardRole('anonymous'))).toBe(false)
  })
})
