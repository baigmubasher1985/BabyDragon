/**
 * F10C2 CR1-C — Field Results information architecture + task-level QC outcome.
 * 20 focused items. No live flags. Mock/provider/selectors only.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { buildFieldResultsFixtures } from '../../src/fieldResults/fixtures/fieldResultsFixtures.js'
import {
  buildDetailViewModel,
  buildListViewModel,
  emptyListFilters,
  toListRow,
} from '../../src/fieldResults/selectors/fieldResultSelectors.js'
import {
  artifactDownloadLabel,
  buildReportDownloadSlots,
  canAccessFieldResultsNav,
  canPerformFieldResultQc,
  formatCountOrNA,
  resolveFieldResultsDashboardRole,
  scenarioLabel,
} from '../../src/fieldResults/models/fieldResultTypes.js'
import { mapFieldTestRunRow } from '../../src/fieldResults/repository/mapFieldTestRunRow.js'
import { createMockFieldResultsProvider } from '../../src/fieldResults/repository/mockFieldResultsProvider.js'
import { displayAcceptanceFromSnapshot } from '../../src/acceptance/scenarioApplicability.js'
import { VERDICTS } from '../../src/acceptance/verdicts.js'
import { denyQcMutation } from '../../src/acceptance/permissions.js'
import {
  computeTaskLevelQcOutcome,
  pickLatestValidRunPerScenario,
  resolveRequiredScenarios,
  TASK_FAIL_REASONS,
} from '../../src/fieldResults/qc/taskLevelQcOutcome.js'

const ROOT = process.cwd()

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

describe('f10c2 cr1-c — 20 architecture items', () => {
  const { runs } = buildFieldResultsFixtures()

  // 1
  it('1. moves Field Results into Field Operations and does not duplicate it under QC & Reports', () => {
    const text = read('src/AdminDashboard.jsx')
    const ops = text.indexOf('title: "Field Operations"')
    const qc = text.indexOf('title: "QC & Reports"')
    const field = text.indexOf('{ id: "fieldResults"')
    expect(field).toBeGreaterThan(ops)
    expect(field).toBeLessThan(qc)
    expect(text.split('{ id: "fieldResults"').length - 1).toBe(1)
    expect(text.slice(qc).indexOf('{ id: "qc"')).toBeGreaterThan(-1)
    expect(text.slice(qc).indexOf('{ id: "reports"')).toBeGreaterThan(-1)
  })

  // 2
  it('2. preserves the fieldResults view id, page import, and active-item highlighting', () => {
    const text = read('src/AdminDashboard.jsx')
    expect(text).toContain('if (activeView === "fieldResults")')
    expect(text).toContain('FieldResultsPage')
    expect(text).toContain('activeView === item.id ? "active"')
    expect(read('src/fieldResults/components/FieldResultsPage.jsx')).toContain('Field Operations')
    expect(read('src/fieldResults/components/FieldResultsPage.jsx')).not.toMatch(/QC & Reports · F10C2/)
  })

  // 3
  it('3. keeps QC Review under QC & Reports and does not turn it into Field Results', () => {
    const dash = read('src/AdminDashboard.jsx')
    const qcBlock = dash.slice(dash.indexOf('title: "QC & Reports"'))
    expect(qcBlock).toContain('QC Review')
    expect(qcBlock).toContain('Reports')
    const qcPage = read('src/pages/QCReview.jsx')
    expect(qcPage).toContain('log_received')
    expect(qcPage).toContain('log_naming_correct')
    expect(qcPage).toContain('required_evidence_received')
    expect(qcPage).toContain('checklist_reviewed')
    expect(qcPage).toContain('issues_reviewed')
    expect(qcPage).toContain('notes_photos_reviewed')
    expect(qcPage).toContain('qc_notes')
    expect(qcPage).toContain('redrive_needed')
    expect(qcPage).toContain('Create Re-drive Task')
    expect(qcPage).toContain('Computed task result')
  })

  // 4
  it('4. keeps Field Results admin-only; FE dashboard and FE/anon QC stay denied', () => {
    const fe = read('src/FEDashboard.jsx')
    expect(fe).not.toContain('FieldResultsPage')
    expect(fe).not.toContain('fieldResults')
    expect(canAccessFieldResultsNav('admin')).toBe(true)
    expect(canAccessFieldResultsNav('super_admin')).toBe(true)
    expect(canAccessFieldResultsNav('fe')).toBe(false)
    expect(canPerformFieldResultQc(resolveFieldResultsDashboardRole('anonymous'))).toBe(false)
    expect(denyQcMutation({ role: 'fe', id: 'fe-1' }).ok).toBe(false)
    expect(denyQcMutation({ role: 'anonymous' }).ok).toBe(false)
  })

  // 5
  it('5. list rows expose identity, scenario, times, counts, upload/processing/acceptance/QC', () => {
    const vm = buildListViewModel(runs, emptyListFilters(), { page: 1, pageSize: 50 })
    expect(vm.rows.length).toBeGreaterThan(0)
    const row = vm.rows[0]
    expect(row).toHaveProperty('id')
    expect(row).toHaveProperty('client_run_id')
    expect(row).toHaveProperty('report_name')
    expect(row).toHaveProperty('task_name')
    expect(row).toHaveProperty('project_name')
    expect(row).toHaveProperty('grid_name')
    expect(row).toHaveProperty('market')
    expect(row).toHaveProperty('field_engineer_name')
    expect(row).toHaveProperty('scenario_type')
    expect(row).toHaveProperty('started_at')
    expect(row).toHaveProperty('ended_at')
    expect(row).toHaveProperty('attempted')
    expect(row).toHaveProperty('completed')
    expect(row).toHaveProperty('failed')
    expect(row).toHaveProperty('upload_state')
    expect(row).toHaveProperty('processing_state')
    expect(row).toHaveProperty('acceptance_verdict')
    expect(row).toHaveProperty('latest_qc_status')
    expect(row.has_raw_rf_samples).toBe(false)
  })

  // 6
  it('6. list UI supports expandable details without inventing scenario families', () => {
    const list = read('src/fieldResults/components/FieldResultsList.jsx')
    expect(list).toContain('Expand run details')
    expect(list).toContain('bdfr-expand')
    expect(list).toContain('Open technical detail')
    const types = new Set(runs.map((r) => r.scenario_type))
    for (const t of ['native_http', 'ftp', 'iperf3', 'ookla_app', 'fcc_app', 'rf_data', 'voice_mo', 'voice_mt', 'combined']) {
      expect(types.has(t)).toBe(true)
      expect(scenarioLabel(t)).toBeTruthy()
    }
  })

  // 7
  it('7. never coerces missing RF/GPS sample counts to 0', () => {
    expect(formatCountOrNA(null)).toBe('N/A')
    expect(formatCountOrNA(undefined)).toBe('N/A')
    expect(formatCountOrNA('')).toBe('N/A')
    expect(formatCountOrNA(18)).toBe('18')
    expect(formatCountOrNA(0)).toBe('0')
    const missingRf = buildDetailViewModel(runs.find((r) => r.id === 'run-missing-rf'))
    expect(missingRf.rf_summary.sample_count).not.toBe(0)
    expect(formatCountOrNA(missingRf.rf_summary.sample_count)).toBe('N/A')
    const missingGps = buildDetailViewModel(runs.find((r) => r.id === 'run-missing-gps'))
    expect(missingGps.gps_summary.sample_count).toBeNull()
    expect(formatCountOrNA(missingGps.gps_summary.sample_count)).toBe('N/A')
  })

  // 8
  it('8. surfaces persisted RF/GPS sample counts when present', () => {
    const http = buildDetailViewModel(runs.find((r) => r.id === 'run-native-http-success'))
    expect(http.rf_summary.sample_count).toBe(380)
    expect(http.gps_summary.sample_count).toBe(420)
    const mapped = mapFieldTestRunRow({
      run: {
        id: 'abfa51c3-80d0-4cc7-b984-535c63c67995',
        client_run_id: '1e969145-3ddb-4636-adf2-7a1e08328be7',
        package_identity: 'bd-rf-1787694437783::native_http',
        scenario_type: 'native_http',
        report_name: 'F10C2-P4BU-E2E',
        rf_summary: { sample_count: 18 },
        gps_summary: { sample_count: 18 },
        data_summary: { metrics: { dl_mbps_avg: 195.84, ul_mbps_avg: 117.68 } },
      },
    })
    expect(mapped.canonical_package_id).toBe('bd-rf-1787694437783::native_http')
    expect(mapped.scenario_details.dashboard.rf_gps.rf_sample_count).toBe(18)
    expect(mapped.scenario_details.dashboard.rf_gps.gps_sample_count).toBe(18)
    const fromIdentityKey = mapFieldTestRunRow({
      run: {
        id: 'a2951b10-6312-4954-bd05-bb65340a9367',
        scenario_type: 'iperf3',
        report_name: 'F10C2-P4BU-E2E',
        package_identity: 'session:bd-rf-1787694471111|scenario:iperf3',
        rf_summary: {},
        gps_summary: {},
        data_summary: {},
      },
    })
    expect(fromIdentityKey.canonical_package_id).toBe('bd-rf-1787694471111::iperf3')
    const absent = mapFieldTestRunRow({
      run: {
        id: 'run-no-counts',
        scenario_type: 'native_http',
        report_name: 'NoCounts',
        rf_summary: {},
        gps_summary: {},
        data_summary: {},
      },
    })
    expect(absent.scenario_details.dashboard.rf_gps.rf_sample_count).toBeNull()
    expect(absent.scenario_details.dashboard.rf_gps.gps_sample_count).toBeNull()
  })

  // 9
  it('9. shows data iterations and DL/UL without fabricating missing families', () => {
    const http = buildDetailViewModel(runs.find((r) => r.id === 'run-native-http-success'))
    expect(http.scenario_details.iterations.length).toBe(5)
    expect(http.scenario_details.iterations[0].dl_mbps).toBe(80)
    expect(http.test_summary.metrics.dl_mbps_avg).toBe(85.2)
    const detailSrc = read('src/fieldResults/components/FieldResultDetail.jsx')
    expect(detailSrc).toContain('Per-iteration DL / UL')
    expect(detailSrc).toContain('Identity')
  })

  // 10
  it('10. data-only HTTP/iPerf display MO/MT as N/A and do not require voice unless combined', () => {
    const displayed = displayAcceptanceFromSnapshot({
      snapshot: {
        overall_verdict: 'FAIL',
        dl_verdict: 'PASS',
        ul_verdict: 'PASS',
        mo_verdict: 'FAIL',
        mt_verdict: 'FAIL',
      },
      scenarioType: 'iperf3',
      iterations: [{ dl_mbps: 34.47, ul_mbps: 53.56 }],
      callEvents: [],
    })
    expect(displayed.mo_verdict).toBe(VERDICTS.NA)
    expect(displayed.mt_verdict).toBe(VERDICTS.NA)
    expect(displayed.overall_verdict).toBe(VERDICTS.PASS)
    const req = resolveRequiredScenarios({
      task: { name: 'F10C2-P4BU-E2E', target_name: 'F10C2-P4BU-E2E' },
      project: { name: 'F10C2-P4BU-E2E' },
    })
    expect(req.required).toEqual(['native_http', 'iperf3'])
    expect(req.required).not.toContain('voice_mo')
    expect(req.required).not.toContain('voice_mt')
  })

  // 11
  it('11. acceptance detail keeps profile, thresholds, measurements, and distinct verdicts', () => {
    const detailSrc = read('src/fieldResults/components/FieldResultDetail.jsx')
    expect(detailSrc).toContain('Profile version')
    expect(detailSrc).toContain('DL threshold')
    expect(detailSrc).toContain('UL threshold')
    expect(detailSrc).toContain('Applicability')
    expect(detailSrc).toContain('Server snapshot overall (immutable)')
    const mapped = mapFieldTestRunRow({
      run: { id: 'r1', scenario_type: 'native_http', report_name: 'HTTP', data_summary: {}, rf_summary: {}, gps_summary: {} },
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
        { iteration_number: 1, actual_dl_mbps: 175.65, dl_threshold: 50, dl_verdict: 'PASS', actual_ul_mbps: 93.47, ul_threshold: 20, ul_verdict: 'PASS' },
      ],
    })
    expect(mapped.acceptance.profile_version).toBe(4)
    expect(mapped.iteration_evaluations[0].dl_threshold).toBe(50)
    expect(mapped.acceptance.mo_verdict).toBe('N/A')
  })

  // 12
  it('12. report downloads label JSON/Excel/CSV/ZIP/RF/GPS and hide download when missing', () => {
    const http = buildDetailViewModel(runs.find((r) => r.id === 'run-native-http-success'))
    const slots = buildReportDownloadSlots(http.artifacts)
    expect(artifactDownloadLabel('unified_json')).toBe('JSON')
    expect(artifactDownloadLabel('excel_plot')).toBe('Excel Plot')
    expect(artifactDownloadLabel('package_zip')).toBe('Unified ZIP')
    expect(artifactDownloadLabel('rf_csv')).toBe('RF raw trace')
    expect(artifactDownloadLabel('gps_csv')).toBe('GPS/route trace')
    const json = slots.find((s) => s.slot_type === 'unified_json')
    const zip = slots.find((s) => s.slot_type === 'package_zip')
    const gps = slots.find((s) => s.slot_type === 'gps_csv')
    expect(json.downloadable).toBe(true)
    expect(zip.status === 'missing' || zip.status === 'pending').toBe(true)
    expect(zip.downloadable).toBe(false)
    expect(gps.downloadable).toBe(false)
    expect(gps.status).toBe('missing')
    for (const art of http.artifacts) {
      expect(art.public_url).toBeUndefined()
      expect(art.signed_url).toBeUndefined()
    }
  })

  // 13
  it('13. signed download path is on-demand; mock never returns a public URL', async () => {
    const provider = createMockFieldResultsProvider({ latencyMs: 0 })
    const res = await provider.requestArtifactAccess('run-native-http-success', 'art-http-json', { role: 'admin' })
    expect(res.ok).toBe(true)
    expect(res.access.public_url).toBeNull()
    expect(res.access.signed_url).toBeNull()
    const missing = await provider.requestArtifactAccess('run-native-http-success', 'art-http-zip', { role: 'admin' })
    expect(missing.ok).toBe(false)
    const src = read('src/fieldResults/repository/supabaseFieldResultsProvider.js')
    expect(src).toContain('createAuthorizedReadAccess')
    expect(src).toContain('public_url: null')
    expect(src).not.toMatch(/getPublicUrl/)
  })

  // 14
  it('14. synthetic non-APK fixtures stay labeled SYNTHETIC', () => {
    for (const run of runs) {
      expect(run.labeled_synthetic).toBe(true)
      expect(run.source_kind).toBe('synthetic')
    }
    const row = toListRow(runs[0])
    expect(row.labeled_synthetic).toBe(true)
    expect(read('src/fieldResults/components/FieldResultsList.jsx')).toContain('SYNTHETIC')
  })

  // 15
  it('15. task PASS only when every required scenario has computed PASS', () => {
    const task = { id: 'task-e2e', name: 'F10C2-P4BU-E2E', target_name: 'F10C2-P4BU-E2E' }
    const outcome = computeTaskLevelQcOutcome({
      task,
      project: { name: 'F10C2-P4BU-E2E' },
      runs: [
        { id: 'http', task_id: 'task-e2e', scenario_type: 'native_http', acceptance_verdict: 'PASS', upload_state: 'uploaded', processing_state: 'ready', started_at: '2026-08-25T21:47:00Z' },
        { id: 'iperf', task_id: 'task-e2e', scenario_type: 'iperf3', acceptance_verdict: 'PASS', upload_state: 'uploaded', processing_state: 'ready', started_at: '2026-08-25T21:48:00Z' },
      ],
    })
    expect(outcome.computed).toBe('PASS')
    expect(outcome.reason).toBeNull()
    expect(outcome.required_count).toBe(2)
    expect(outcome.passed).toBe(2)
  })

  // 16
  it('16. any required FAIL makes the task FAIL with threshold failure', () => {
    const task = { id: 'task-e2e', name: 'F10C2-P4BU-E2E' }
    const outcome = computeTaskLevelQcOutcome({
      task,
      project: { name: 'F10C2-P4BU-E2E' },
      runs: [
        { id: 'http', task_id: 'task-e2e', scenario_type: 'native_http', acceptance_verdict: 'PASS', upload_state: 'uploaded', processing_state: 'ready', started_at: '2026-08-25T21:47:00Z' },
        { id: 'iperf', task_id: 'task-e2e', scenario_type: 'iperf3', acceptance_verdict: 'FAIL', upload_state: 'uploaded', processing_state: 'ready', started_at: '2026-08-25T21:48:00Z' },
      ],
    })
    expect(outcome.computed).toBe('FAIL')
    expect(outcome.reason).toBe(TASK_FAIL_REASONS.THRESHOLD_FAILURE)
    expect(outcome.failed).toBe(1)
    expect(outcome.passed).toBe(1)
  })

  // 17
  it('17. missing/incomplete/processing required scenarios prevent PASS with two-label reasons', () => {
    const task = { id: 'task-e2e', name: 'F10C2-P4BU-E2E' }
    const missing = computeTaskLevelQcOutcome({
      task,
      project: { name: 'F10C2-P4BU-E2E' },
      runs: [
        { id: 'http', task_id: 'task-e2e', scenario_type: 'native_http', acceptance_verdict: 'PASS', upload_state: 'uploaded', processing_state: 'ready', started_at: '2026-08-25T21:47:00Z' },
      ],
    })
    expect(missing.computed).toBe('FAIL')
    expect(missing.reason).toBe(TASK_FAIL_REASONS.MISSING_REQUIRED)

    const processing = computeTaskLevelQcOutcome({
      task,
      project: { name: 'F10C2-P4BU-E2E' },
      runs: [
        { id: 'http', task_id: 'task-e2e', scenario_type: 'native_http', acceptance_verdict: 'PASS', upload_state: 'uploaded', processing_state: 'ready', started_at: '2026-08-25T21:47:00Z' },
        { id: 'iperf', task_id: 'task-e2e', scenario_type: 'iperf3', acceptance_verdict: null, upload_state: 'uploaded', processing_state: 'processing', started_at: '2026-08-25T21:48:00Z' },
      ],
    })
    expect(processing.computed).toBe('FAIL')
    expect(processing.reason).toBe(TASK_FAIL_REASONS.PROCESSING_PENDING)

    const upload = computeTaskLevelQcOutcome({
      task,
      project: { name: 'F10C2-P4BU-E2E' },
      runs: [
        { id: 'http', task_id: 'task-e2e', scenario_type: 'native_http', acceptance_verdict: 'PASS', upload_state: 'uploaded', processing_state: 'ready', started_at: '2026-08-25T21:47:00Z' },
        { id: 'iperf', task_id: 'task-e2e', scenario_type: 'iperf3', acceptance_verdict: 'PASS', upload_state: 'partial', processing_state: 'ready', started_at: '2026-08-25T21:48:00Z' },
      ],
    })
    expect(upload.reason).toBe(TASK_FAIL_REASONS.UPLOAD_INCOMPLETE)

    const incomplete = computeTaskLevelQcOutcome({
      task,
      project: { name: 'F10C2-P4BU-E2E' },
      runs: [
        { id: 'http', task_id: 'task-e2e', scenario_type: 'native_http', acceptance_verdict: 'PASS', upload_state: 'uploaded', processing_state: 'ready', started_at: '2026-08-25T21:47:00Z' },
        { id: 'iperf', task_id: 'task-e2e', scenario_type: 'iperf3', acceptance_verdict: 'INCOMPLETE', upload_state: 'uploaded', processing_state: 'ready', started_at: '2026-08-25T21:48:00Z' },
      ],
    })
    expect(incomplete.reason).toBe(TASK_FAIL_REASONS.ACCEPTANCE_INCOMPLETE)
  })

  // 18
  it('18. optional scenarios do not block PASS; superseded retries are not double-counted', () => {
    const task = { id: 'task-e2e', name: 'F10C2-P4BU-E2E' }
    const outcome = computeTaskLevelQcOutcome({
      task,
      project: { name: 'F10C2-P4BU-E2E' },
      runs: [
        { id: 'http-old', task_id: 'task-e2e', scenario_type: 'native_http', acceptance_verdict: 'FAIL', upload_state: 'uploaded', processing_state: 'ready', started_at: '2026-08-25T20:00:00Z' },
        { id: 'http-new', task_id: 'task-e2e', scenario_type: 'native_http', acceptance_verdict: 'PASS', upload_state: 'uploaded', processing_state: 'ready', started_at: '2026-08-25T21:47:00Z' },
        { id: 'iperf', task_id: 'task-e2e', scenario_type: 'iperf3', acceptance_verdict: 'PASS', upload_state: 'uploaded', processing_state: 'ready', started_at: '2026-08-25T21:48:00Z' },
        { id: 'mo', task_id: 'task-e2e', scenario_type: 'voice_mo', acceptance_verdict: 'FAIL', upload_state: 'uploaded', processing_state: 'ready', started_at: '2026-08-25T21:49:00Z' },
      ],
    })
    expect(outcome.computed).toBe('PASS')
    const latest = pickLatestValidRunPerScenario(outcome.scenarios.map((s) => s.run).filter(Boolean).concat([
      { id: 'http-old', scenario_type: 'native_http', started_at: '2026-08-25T20:00:00Z' },
    ]))
    expect(latest.get('native_http').id).toBe('http-new')
    const superseded = computeTaskLevelQcOutcome({
      task,
      project: { name: 'F10C2-P4BU-E2E' },
      runs: [
        { id: 'http-old', task_id: 'task-e2e', scenario_type: 'native_http', acceptance_verdict: 'PASS', upload_state: 'uploaded', processing_state: 'ready', started_at: '2026-08-25T21:47:00Z', superseded: true },
        { id: 'http-new', task_id: 'task-e2e', scenario_type: 'native_http', acceptance_verdict: 'PASS', upload_state: 'uploaded', processing_state: 'ready', started_at: '2026-08-25T21:50:00Z' },
        { id: 'iperf', task_id: 'task-e2e', scenario_type: 'iperf3', acceptance_verdict: 'PASS', upload_state: 'uploaded', processing_state: 'ready', started_at: '2026-08-25T21:48:00Z' },
      ],
    })
    expect(superseded.computed).toBe('PASS')
    expect(superseded.scenarios.find((s) => s.scenario_type === 'native_http').run.id).toBe('http-new')
  })

  // 19
  it('19. missing persisted required-scenario config fails closed and does not invent requirements', () => {
    const missing = resolveRequiredScenarios({ task: { id: 't1', name: 'Unknown task' }, project: { name: 'Unknown' } })
    expect(missing.ok).toBe(false)
    expect(missing.failClosed).toBe(true)
    expect(missing.required).toEqual([])
    const outcome = computeTaskLevelQcOutcome({
      task: { id: 't1', name: 'Unknown task' },
      project: { name: 'Unknown' },
      runs: [
        { id: 'http', task_id: 't1', scenario_type: 'native_http', acceptance_verdict: 'PASS', upload_state: 'uploaded', processing_state: 'ready' },
      ],
    })
    expect(outcome.computed).toBe('FAIL')
    expect(outcome.reason).toBe(TASK_FAIL_REASONS.MISSING_REQUIRED)
    const explicit = resolveRequiredScenarios({
      task: { required_scenarios: ['native_http', 'ftp'] },
    })
    expect(explicit.source).toBe('persisted_config')
    expect(explicit.required).toEqual(['native_http', 'ftp'])
  })

  // 20
  it('20. manual QC / override retains original computed and does not rewrite run acceptance', () => {
    const computed = computeTaskLevelQcOutcome({
      task: { id: 'task-e2e', name: 'F10C2-P4BU-E2E' },
      project: { name: 'F10C2-P4BU-E2E' },
      runs: [
        { id: 'http', task_id: 'task-e2e', scenario_type: 'native_http', acceptance_verdict: 'PASS', upload_state: 'uploaded', processing_state: 'ready', started_at: '2026-08-25T21:47:00Z' },
        { id: 'iperf', task_id: 'task-e2e', scenario_type: 'iperf3', acceptance_verdict: 'FAIL', upload_state: 'uploaded', processing_state: 'ready', started_at: '2026-08-25T21:48:00Z' },
      ],
      qcDecision: 'QC Passed',
      override: {
        override_verdict: 'QC Passed',
        reviewer: 'admin-1',
        timestamp: '2026-08-25T22:00:00Z',
        reason: 'documented field exception',
      },
    })
    expect(computed.computed).toBe('FAIL')
    expect(computed.qc_decision).toBe('QC Passed')
    expect(computed.override.computed_verdict).toBe('FAIL')
    expect(computed.override.override_verdict).toBe('QC Passed')
    expect(computed.override.reviewer).toBe('admin-1')
    expect(computed.override.reason).toBe('documented field exception')
    const qcSrc = read('src/pages/QCReview.jsx')
    expect(qcSrc).toContain('does not rewrite computed acceptance')
    expect(qcSrc).toContain('Override reason is required')
    const contrast = read('src/fieldResults/components/FieldResults.css')
    expect(contrast).toContain('--bdfr-text')
    expect(contrast).toContain('bd-theme-day .bdfr-page')
    const dash = read('src/AdminDashboard.jsx')
    expect(dash.indexOf('{ id: "fieldResults"')).toBeGreaterThan(dash.indexOf('title: "Field Operations"'))
    expect(dash.indexOf('{ id: "fieldResults"')).toBeLessThan(dash.indexOf('title: "QC & Reports"'))
  })
})

describe('f10c2 cr1-c — contrast tokens exist for both themes', () => {
  it('Field Results CSS forces readable panel text in day and night', () => {
    const css = read('src/fieldResults/components/FieldResults.css')
    expect(css).toContain('--bdfr-link')
    expect(css).toContain('.bdfr-badge-pass')
    expect(css).toContain('.bdfr-badge-fail')
    expect(css).toContain('body.bd-theme-night .bdfr-page')
  })
})
