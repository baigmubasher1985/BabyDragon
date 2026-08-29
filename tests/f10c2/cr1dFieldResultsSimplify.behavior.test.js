/**
 * F10C2 CR1-D — simplified Field Results + iPerf/RF recovery (items 9–18).
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { buildFieldResultsFixtures } from '../../src/fieldResults/fixtures/fieldResultsFixtures.js'
import {
  buildListViewModel,
  emptyListFilters,
  toListRow,
} from '../../src/fieldResults/selectors/fieldResultSelectors.js'
import { formatCountOrNA } from '../../src/fieldResults/models/fieldResultTypes.js'
import { mapFieldTestRunRow } from '../../src/fieldResults/repository/mapFieldTestRunRow.js'
import { buildServerSubmissionManifest } from '../../src/mobile/rf/reports/serverSubmissionManifest.js'
import { aggregateCompletedIterationThroughput } from '../../src/mobile/testEngines/iperf3ResultMapper.js'

const ROOT = process.cwd()
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

describe('f10c2 cr1-d — simplified Field Results (9-18)', () => {
  const list = read('src/fieldResults/components/FieldResultsList.jsx')
  const detail = read('src/fieldResults/components/FieldResultDetail.jsx')
  const dash = read('src/AdminDashboard.jsx')
  const { runs } = buildFieldResultsFixtures()

  it('9. default list columns omit long UUIDs from the default table body', () => {
    expect(list).toContain('>Report</th>')
    expect(list).toContain('>Project</th>')
    expect(list).toContain('Task / Grid')
    expect(list).toContain('>Vendor</th>')
    expect(list).toContain('>FE</th>')
    expect(list).toContain('>Test Type</th>')
    expect(list).toContain('>Date</th>')
    expect(list).toContain('>Iterations</th>')
    expect(list).toContain('>Acceptance</th>')
    expect(list).toContain('>QC</th>')
    expect(list).toContain('>View</th>')
    const defaultRow = list.slice(list.indexOf('<tbody>'), list.indexOf('expandedIds.has(row.id) &&'))
    expect(defaultRow).not.toContain('>{row.id}<')
    expect(defaultRow).not.toContain('bdfr-id-sub')
    expect(defaultRow).not.toContain('client_run_id')
    expect(list).toContain('Advanced Details')
    const row = toListRow(runs[0])
    expect(row.id).toBeTruthy()
    expect(row.client_run_id).toBeTruthy()
  })

  it('10. default filters are Search/Project/Vendor/FE/Test Type/date/Acceptance/QC; more filters are secondary', () => {
    expect(list).toContain('More Filters')
    expect(list).toContain('bdfr-filters-more')
    const primary = list.slice(0, list.indexOf('More Filters'))
    expect(primary).toContain('Search')
    expect(primary).toContain('Filter by project')
    expect(primary).toContain('Filter by vendor')
    expect(primary).toContain('Filter by field engineer')
    expect(primary).toContain('Filter by test type')
    expect(primary).toContain('Start date')
    expect(primary).toContain('Filter by acceptance verdict')
    expect(primary).toContain('Filter by QC decision')
    expect(primary).not.toContain('Filter by grid')
    expect(list).toContain('Filter by grid')
    expect(list).toContain('Filter by upload state')
    expect(list).toContain('Filter by processing state')
    expect(list).toContain('Filter by re-drive required')
  })

  it('11. Overview is the default detail and Advanced Technical Details is expandable', () => {
    expect(detail).toContain("id: 'overview'")
    expect(detail).toContain('Advanced Technical Details')
    expect(detail).toContain('OpsOverviewPanel')
    expect(detail).toContain('Identity')
    expect(detail).toContain('Per-iteration DL / UL')
  })

  it('12. Field Results does not host QC editing controls', () => {
    expect(detail).not.toContain('Save QC decision')
    expect(detail).not.toContain('QC Workspace')
    expect(detail).not.toContain('aria-label="QC decision"')
    expect(detail).toContain('QC Summary')
    expect(detail).toContain('Open in QC Review')
    expect(read('src/pages/QCReview.jsx')).toContain('Create Re-drive Task')
  })

  it('13. Open in QC Review is wired from Field Results through AdminDashboard', () => {
    expect(dash).toContain('onOpenQcReview={(ctx) => {')
    expect(dash).toContain('setActiveView("qc")')
    expect(dash).toContain('focusTaskId={qcFocus?.taskId || null}')
    expect(read('src/fieldResults/components/FieldResultsPage.jsx')).toContain('onOpenQcReview')
    expect(detail).toContain('taskId: o.task_id')
  })

  it('14. list rows expose completed/requested iteration counts', () => {
    const vm = buildListViewModel(runs, emptyListFilters(), { page: 1, pageSize: 50 })
    expect(vm.rows[0]).toHaveProperty('completed')
    expect(vm.rows[0]).toHaveProperty('requested')
    expect(list).toContain('row.completed')
    expect(list).toContain('row.requested')
  })

  it('15. iPerf averages derive from valid completed iterations only and never treat failed as zero', () => {
    const mapped = mapFieldTestRunRow({
      run: {
        id: 'run-iperf-derived',
        scenario_type: 'iperf3',
        report_name: 'iPerf derived',
        data_summary: {
          scenarios: [{
            iterations: [
              { n: 1, status: 'completed', dl_mbps: 40, ul_mbps: 10 },
              { n: 2, status: 'failed', dl_mbps: null, ul_mbps: null },
              { n: 3, status: 'completed', dl_mbps: 20, ul_mbps: 30 },
            ],
          }],
        },
        rf_summary: {},
        gps_summary: {},
      },
    })
    expect(mapped.test_summary.metrics.dl_mbps_avg).toBe(30)
    expect(mapped.test_summary.metrics.ul_mbps_avg).toBe(20)
    expect(mapped.test_summary.metrics.average_source).toBe('derived_completed_iterations')
    expect(mapped.scenario_details.dashboard.iperf3.dl_mbps).toBe(30)
    const failedOnly = aggregateCompletedIterationThroughput([
      { status: 'failed', dlMbps: null, ulMbps: null },
    ])
    expect(failedOnly.avgDlMbps).toBeNull()
    expect(failedOnly.completed).toBe(0)
  })

  it('16. missing RF/GPS sample counts stay N/A and are never coerced to zero', () => {
    expect(formatCountOrNA(null)).toBe('N/A')
    const missing = mapFieldTestRunRow({
      run: { id: 'x', scenario_type: 'native_http', report_name: 'x', rf_summary: {}, gps_summary: {}, data_summary: {} },
    })
    expect(missing.rf_summary.sample_count).toBeNull()
    expect(missing.gps_summary.sample_count).toBeNull()
    expect(formatCountOrNA(missing.rf_summary.sample_count)).toBe('N/A')
  })

  it('17. RF/GPS sample_count is recovered from canonical session/trace keys in the manifest', () => {
    const manifest = buildServerSubmissionManifest({
      clientRunId: 'client-1',
      unifiedReport: {
        session: { sample_count: 18, gps_points: 18, rat: 'LTE' },
        trace: { sample_count: 18 },
        rf_summary: { rat: 'LTE', nr: { avg_ss_rsrp_dbm: -97.8 } },
      },
      taskContext: { taskId: '00000000-0000-4000-8000-000000000001', projectId: '00000000-0000-4000-8000-000000000002' },
    })
    expect(manifest.rf_summary.sample_count).toBe(18)
    expect(manifest.gps_summary.sample_count).toBe(18)
    const mapped = mapFieldTestRunRow({
      run: {
        id: 'abfa51c3-80d0-4cc7-b984-535c63c67995',
        scenario_type: 'native_http',
        report_name: 'HTTP',
        rf_summary: { sample_count: null },
        gps_summary: { sample_count: null },
        data_summary: { session: { sample_count: 18, gps_points: 18 } },
      },
    })
    expect(mapped.rf_summary.sample_count).toBe(18)
    expect(mapped.gps_summary.sample_count).toBe(18)
  })

  it('18. Field Results remains under Field Operations and QC Review stays under QC & Reports', () => {
    const ops = dash.indexOf('title: "Field Operations"')
    const qc = dash.indexOf('title: "QC & Reports"')
    const field = dash.indexOf('{ id: "fieldResults"')
    expect(field).toBeGreaterThan(ops)
    expect(field).toBeLessThan(qc)
  })
})
