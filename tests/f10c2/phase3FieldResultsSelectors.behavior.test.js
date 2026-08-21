/**
 * F10C2 Phase 3 — selectors / list view models.
 */
import { describe, it, expect } from 'vitest'
import { buildFieldResultsFixtures } from '../../src/fieldResults/fixtures/fieldResultsFixtures.js'
import {
  buildDetailViewModel,
  buildListViewModel,
  emptyListFilters,
  filterRuns,
  sortRuns,
  toListRow,
} from '../../src/fieldResults/selectors/fieldResultSelectors.js'
import { scenarioLabel } from '../../src/fieldResults/models/fieldResultTypes.js'

describe('f10c2 phase3 — selectors', () => {
  const { runs } = buildFieldResultsFixtures()

  it('renders human-readable labels for all primary scenario types', () => {
    expect(scenarioLabel('native_http')).toBe('Native HTTP')
    expect(scenarioLabel('ftp')).toBe('FTP')
    expect(scenarioLabel('iperf3')).toBe('iPerf3')
    expect(scenarioLabel('ookla_app')).toBe('OOKLA')
    expect(scenarioLabel('fcc_app')).toBe('FCC')
    expect(scenarioLabel('rf_data')).toBe('RF Only')
  })

  it('list contains fixtures covering required scenarios/states', () => {
    const types = new Set(runs.map((r) => r.scenario_type))
    for (const t of ['native_http', 'ftp', 'iperf3', 'ookla_app', 'fcc_app', 'rf_data']) {
      expect(types.has(t)).toBe(true)
    }
    expect(runs.some((r) => r.completion_status === 'interrupted')).toBe(true)
    expect(runs.some((r) => r.gps_summary?.gaps_warning)).toBe(true)
    expect(runs.some((r) => r.rf_summary?.nr_mode === 'SA')).toBe(true)
    expect(runs.some((r) => r.rf_summary?.nr_mode === 'NSA')).toBe(true)
    expect(runs.some((r) => r.latest_qc_status === 'Needs Re-drive' && r.redrive_task_id)).toBe(true)
    expect(runs.some((r) => r.artifacts?.some((a) => a.missing))).toBe(true)
  })

  it('filters, search, sorting, pagination', () => {
    const filtered = filterRuns(runs, { search: 'OOKLA', scenario: 'ookla_app' })
    expect(filtered.length).toBeGreaterThan(0)
    expect(filtered.every((r) => r.scenario_type === 'ookla_app')).toBe(true)

    const sortedAsc = sortRuns(runs, 'report_name', 'asc')
    const sortedDesc = sortRuns(runs, 'report_name', 'desc')
    expect(sortedAsc[0].report_name <= sortedAsc[1].report_name).toBe(true)
    expect(sortedDesc[0].report_name >= sortedDesc[1].report_name).toBe(true)

    const vm = buildListViewModel(runs, { ...emptyListFilters(), sortBy: 'started_at' }, { page: 1, pageSize: 3 })
    expect(vm.rows).toHaveLength(3)
    expect(vm.totalPages).toBeGreaterThan(1)
  })

  it('list rows never load raw RF samples', () => {
    for (const run of runs) {
      const row = toListRow(run)
      expect(row.has_raw_rf_samples).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(row, 'raw_rf_samples')).toBe(false)
      expect(row.rf_samples).toBeUndefined()
      expect(Array.isArray(row.rf_trace)).toBe(false)
    }
  })

  it('detail shows unavailable metrics as unavailable; NR SA/NSA truth', () => {
    const missingRf = runs.find((r) => r.id === 'run-missing-rf')
    const vm = buildDetailViewModel(missingRf)
    expect(vm.rf_summary.lte.rsrp).toBeNull()

    const sa = buildDetailViewModel(runs.find((r) => r.id === 'run-nr-sa'))
    expect(sa.rf_summary.nr_mode).toBe('SA')
    const nsa = buildDetailViewModel(runs.find((r) => r.id === 'run-nr-nsa'))
    expect(nsa.rf_summary.nr_mode).toBe('NSA')

    const gps = buildDetailViewModel(runs.find((r) => r.id === 'run-missing-gps'))
    expect(gps.gps_summary.gaps_warning).toMatch(/GPS/i)

    const voice = buildDetailViewModel(runs.find((r) => r.id === 'run-voice-events'))
    expect(voice.events_summary.counts.voice_mo).toBeGreaterThan(0)
  })

  it('detail artifacts never construct public/signed URLs', () => {
    const vm = buildDetailViewModel(runs.find((r) => r.id === 'run-native-http-success'))
    for (const a of vm.artifacts) {
      expect(a.public_url).toBeUndefined()
      expect(a.signed_url).toBeUndefined()
    }
  })
})
