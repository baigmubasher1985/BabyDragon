/**
 * F10C2 CR1-D-R2 — header controls, Field Results toolbar, compact criteria, assignment.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  DASHBOARD_DENSITY_COMPACT,
  densityLabel,
} from '../../src/lib/dashboardDensity.js'
import {
  DATA_THROUGHPUT_NOTE,
  dlIterationPassCopy,
  emptySimpleRuleForm,
  sanitizeAssignmentError,
  summarizeSimpleRule,
  taskAssignmentFromLibrary,
  ulIterationPassCopy,
} from '../../src/acceptance/simpleRuleUx.js'
import {
  previewAssignmentOverride,
  previewTaskAssignmentReplace,
  replaceActiveTaskAssignments,
} from '../../src/acceptance/profileManagement.js'
import { canMutateAcceptanceProfile } from '../../src/acceptance/permissions.js'
import { createMockAcceptanceProfilesProvider } from '../../src/acceptance/profiles/mockAcceptanceProfilesProvider.js'
import { evaluateFieldTestRun } from '../../src/acceptance/evaluateRun.js'
import { fieldSectionEmptyCopy, formatMetric } from '../../src/fieldResults/models/fieldResultTypes.js'
import { mapFieldTestRunRow } from '../../src/fieldResults/repository/mapFieldTestRunRow.js'

const ROOT = process.cwd()
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

describe('f10c2 cr1-d-r2 — header, field results toolbar, criteria wording, assignment', () => {
  const dash = read('src/AdminDashboard.jsx')
  const page = read('src/acceptance/components/AcceptanceCriteriaPage.jsx')
  const accCss = read('src/acceptance/components/AcceptanceCriteria.css')
  const frDetail = read('src/fieldResults/components/FieldResultDetail.jsx')
  const frCss = read('src/fieldResults/components/FieldResults.css')
  const provider = read('src/acceptance/profiles/supabaseAcceptanceProfilesProvider.js')
  const mockSrc = read('src/acceptance/profiles/mockAcceptanceProfilesProvider.js')

  it('1. density and theme are two labeled header controls in a flex group', () => {
    expect(dash).toContain('admin-topbar-actions')
    expect(dash).toContain('admin-header-control-label')
    expect(dash).toContain('id="bd-density-label"')
    expect(dash).toContain('id="bd-theme-label"')
    expect(dash).toContain('aria-labelledby="bd-density-label"')
    expect(dash).toContain('aria-labelledby="bd-theme-label"')
    expect(densityLabel(DASHBOARD_DENSITY_COMPACT)).toBe('Compact')
    expect(densityLabel('comfortable')).toBe('Comfortable')
  })

  it('2. header buttons are not absolutely stacked over each other', () => {
    expect(dash).toContain('position: static !important')
    expect(dash).not.toContain('right: 108px')
    expect(dash).not.toContain('right: 4px !important')
    expect(dash).not.toContain("transform: translateX(50%)")
    expect(dash).toContain('justify-content: flex-end')
  })

  it('3. Comfortable is never truncated and controls wrap as complete units', () => {
    expect(dash).toContain('white-space: nowrap !important')
    expect(dash).toContain('min-width: 118px')
    expect(dash).toContain('text-overflow: clip')
    expect(dash).toContain('flex-wrap: wrap')
  })

  it('4. header controls expose accessible labels and focus-visible rings', () => {
    expect(dash).toContain('aria-label="Display settings"')
    expect(dash).toContain(':focus-visible')
    expect(dash).toContain('outline: 2px solid #38bdf8')
  })

  it('5. Field Results detail uses one desktop toolbar of four actions', () => {
    expect(frDetail).toContain('bdfr-detail-toolbar')
    expect(frDetail).toContain('Back to Results')
    expect(frDetail).toContain('Refresh')
    expect(frDetail).toContain("label: 'Overview'")
    expect(frDetail).toContain("label: 'Advanced Details'")
    expect(frCss).toContain('.bdfr-detail-toolbar')
    expect(frCss).toContain('flex-wrap: nowrap')
    expect(frCss).toContain('height: 40px')
  })

  it('6. Retry is shown only after a failed load; normal action is Refresh', () => {
    expect(frDetail).toContain('{!error && (')
    expect(frDetail).toContain('Retry')
    expect(frDetail).not.toContain('Retry / refresh')
    expect(frDetail).toContain('role="alert"')
  })

  it('7. missing Field Results sections use explicit empty copy instead of zero', () => {
    expect(fieldSectionEmptyCopy({ loading: true })).toBe('Loading…')
    expect(fieldSectionEmptyCopy({ synthetic: true, kind: 'throughput' })).toBe(
      'No throughput samples were uploaded for this synthetic validation result.',
    )
    expect(fieldSectionEmptyCopy({ processing: 'processing' })).toBe('Processing')
    expect(fieldSectionEmptyCopy({ uploaded: false })).toBe('Not uploaded')
    expect(fieldSectionEmptyCopy({})).toBe('Not collected for this test')
    expect(fieldSectionEmptyCopy({ reason: 'tile timeout' })).toBe('Unavailable due to tile timeout')
    expect(frDetail).toContain('fieldSectionEmptyCopy')
    expect(frDetail).toContain('bdfr-empty-copy')
  })

  it('8. criteria helpers are short, dynamic, and not hardcoded 50/5', () => {
    expect(dlIterationPassCopy(10, 20)).toBe('DL passes when 20 completed iterations each reach at least 10 Mbps.')
    expect(ulIterationPassCopy(1, 20)).toBe('UL passes when 20 completed iterations each reach at least 1 Mbps.')
    expect(dlIterationPassCopy(12, 8)).toContain('8 completed iterations each reach at least 12 Mbps')
    expect(DATA_THROUGHPUT_NOTE).toBe(
      'Only completed iterations meeting the threshold count as passes. Missing evidence is marked Incomplete.',
    )
    expect(page).not.toContain('50 Mbps')
    expect(page).not.toContain('5 Mbps')
    expect(accCss).toContain('.bd-acc-req-row')
    expect(accCss).toContain('.bd-acc-inline-help')
  })

  it('9. new-rule defaults remain DL 10/20 and UL 1/20 and edit loads saved values', () => {
    const blank = emptySimpleRuleForm()
    expect(blank.dlMinMbps).toBe('10')
    expect(blank.dlPassingCount).toBe('20')
    expect(blank.ulMinMbps).toBe('1')
    expect(blank.ulPassingCount).toBe('20')
    expect(page).toContain('formFromProfile')
    expect(page).toContain('Edit Rule')
  })

  it('10. voice row is compact Require MO / Require MT with max input widths', () => {
    expect(page).toContain('Require MO')
    expect(page).toContain('Required Successful MO Calls')
    expect(page).toContain('Require MT')
    expect(page).toContain('Required Successful MT Calls')
    expect(accCss).toContain('max-width: 160px')
    expect(accCss).toContain('max-width: 140px')
  })

  it('11. Assign to Selected is disabled until a bulk rule is chosen', () => {
    expect(page).toContain('Assign to Selected')
    expect(page).toContain('disabled={assigning || !taskRulePick.bulk}')
    expect(page).toContain('Select a saved rule first.')
  })

  it('12. bulk confirm names the rule and selected task count', () => {
    expect(page).toContain('selected task(s)?')
    expect(page).toContain('Assign “{confirmBulk.rule.name}”')
    expect(page).toContain('Assigning…')
  })

  it('13. bulk selection is cleared only after success', () => {
    const assignFn = page.slice(page.indexOf('async function assignBulk'), page.indexOf('const overallSummary'))
    expect(assignFn).toContain('if (res.ok)')
    expect(assignFn).toContain('setSelectedTaskIds(new Set())')
    const afterFail = assignFn.split('if (res.ok)')[0]
    expect(afterFail).not.toContain('setSelectedTaskIds(new Set())')
  })

  it('14. row Assign / Change Assignment requires a selected rule and confirmation', () => {
    expect(page).toContain('disabled={assigning || !pick}')
    expect(page).toContain('requestAssignOne')
    expect(page).toContain('setConfirmRow')
    expect(page).toContain('Change Assignment')
    expect(page).toContain('? "Assign" : "Change Assignment"')
  })

  it('15. incompatible rule vs test type is blocked before RPC', () => {
    expect(page).toContain('ruleCompatibility')
    expect(page).toContain('compat.message')
  })

  it('16. FE and anonymous cannot mutate assignment', () => {
    expect(canMutateAcceptanceProfile('fe')).toBe(false)
    expect(canMutateAcceptanceProfile('anon')).toBe(false)
    expect(canMutateAcceptanceProfile('admin')).toBe(true)
    expect(canMutateAcceptanceProfile('super_admin')).toBe(true)
    expect(page).toContain('Acceptance Criteria is available to admin and super_admin only.')
  })

  it('17. assignment errors are sanitized and never dump raw RPC text', () => {
    expect(sanitizeAssignmentError('forbidden_not_admin')).toMatch(/admin/i)
    expect(sanitizeAssignmentError('duplicate key value violates unique constraint')).toMatch(/conflicting assignment/i)
    expect(sanitizeAssignmentError('postgres://user:pass@host/db')).toBe('Assignment could not be saved. Try again.')
    expect(provider).toContain('sanitizeAssignmentError')
    expect(page).toContain('sanitizeAssignmentError')
    expect(page.toLowerCase()).not.toContain('upsert_acceptance_profile')
  })

  it('18. replacing an existing task assignment is not treated as ambiguous', () => {
    const existing = {
      id: 'p-task', scope_type: 'task', scope_id: 'task-1', is_active: true, name: 'Old Rule',
    }
    const candidate = {
      id: 'p-task-new', scope_type: 'task', scope_id: 'task-1', is_active: true, name: 'New Rule',
    }
    const stacked = previewAssignmentOverride({
      profiles: [existing],
      taskId: 'task-1',
      candidate,
    })
    expect(stacked.ok).toBe(false)
    const replaced = previewTaskAssignmentReplace({
      profiles: [existing],
      taskId: 'task-1',
      candidate,
    })
    expect(replaced.ok).toBe(true)
    const crowded = previewTaskAssignmentReplace({
      profiles: [
        existing,
        { id: 't1', scope_type: 'tenant', tenant_id: 't', is_default: false, is_active: true, name: 'Lib A' },
        { id: 't2', scope_type: 'tenant', tenant_id: 't', is_default: false, is_active: true, name: 'Lib B' },
      ],
      taskId: 'task-1',
      candidate,
    })
    expect(crowded.ok).toBe(true)
    const next = replaceActiveTaskAssignments([existing], candidate)
    expect(next.filter((p) => p.is_active !== false && p.scope_type === 'task')).toHaveLength(1)
    expect(next.find((p) => p.id === 'p-task').is_active).toBe(false)
  })

  it('19. mock change-assignment succeeds and updates Current Criteria name', async () => {
    const repo = createMockAcceptanceProfilesProvider()
    const task = { id: 'task-open-1', project_id: 'proj-syn-001', test_type: 'native_http', status: 'assigned' }
    const first = await repo.assignToTasks('profile-standard-data', [task], { role: 'admin' })
    expect(first.ok).toBe(true)
    const voice = await repo.saveRule({
      ...emptySimpleRuleForm(),
      name: 'CR1-D-R2 Voice Temp',
      requireMo: true,
      moSuccessCount: '3',
    }, { role: 'admin' })
    expect(voice.ok).toBe(true)
    const listed = await repo.listProfiles()
    const voiceRule = listed.profiles.find((p) => p.name === 'CR1-D-R2 Voice Temp')
    const second = await repo.assignToTasks(voiceRule.id, [task], { role: 'admin' })
    expect(second.ok).toBe(true)
    const after = await repo.listProfiles()
    const activeTask = after.profiles.filter((p) => p.scope_type === 'task' && String(p.scope_id) === 'task-open-1' && p.is_active !== false)
    expect(activeTask).toHaveLength(1)
    expect(activeTask[0].name).toBe('CR1-D-R2 Voice Temp')
  })

  it('20. live provider deactivates prior task rows before upsert to avoid unique-index conflict', () => {
    expect(provider).toContain('previewTaskAssignmentReplace')
    expect(provider).toContain('is_active: false')
    expect(provider).toContain("p_scope_type: \"project\"")
    expect(provider).toContain("p_scope_type: \"task\"")
    expect(provider).toContain('cloned_from_id')
    expect(provider).toContain('Number(r.profile_version) === version')
    expect(provider).toContain('familyFromColumn')
    expect(mockSrc).toContain('previewTaskAssignmentReplace')
  })

  it('21. task assignments are stored as task defaults with cloned_from_id', () => {
    const assigned = taskAssignmentFromLibrary(
      { id: 'lib-1', name: 'CR1-D-R2 E2E Data Rule', version: 1, tenant_id: 't1', rules: {} },
      { id: 'task-1', test_type: 'iperf3' },
    )
    expect(assigned.scope_type).toBe('task')
    expect(assigned.scenario_family).toBe(null)
    expect(assigned.cloned_from_id).toBe('lib-1')
  })

  it('22. overview still includes GPS, RF, throughput, and download reports', () => {
    const start = frDetail.indexOf('function OpsOverviewPanel')
    const end = frDetail.indexOf('function OverviewPanel')
    const ops = frDetail.slice(start, end)
    expect(ops.indexOf('Test Summary')).toBeGreaterThan(-1)
    expect(ops.indexOf('Pass/Fail Results')).toBeGreaterThan(ops.indexOf('Test Summary'))
    expect(ops.indexOf('Throughput Summary')).toBeGreaterThan(ops.indexOf('Pass/Fail Results'))
    expect(ops.indexOf('GPS Driven Route')).toBeGreaterThan(ops.indexOf('Throughput Summary'))
    expect(ops.indexOf('RF Summary')).toBeGreaterThan(ops.indexOf('GPS Driven Route'))
    expect(ops).toContain('ArtifactsPanel')
    expect(ops).toContain('Per-iteration DL / UL')
  })

  it('23. physical iPerf 6.009 and snapshot identities remain referenced', () => {
    const simplify = read('tests/f10c2/cr1dFieldResultsSimplify.behavior.test.js')
    const arch = read('tests/f10c2/cr1cFieldResultsArchitecture.behavior.test.js')
    expect(arch).toContain('a2951b10-6312-4954-bd05-bb65340a9367')
    expect(simplify).toContain('abfa51c3-80d0-4cc7-b984-535c63c67995')
    expect(fs.existsSync(path.join(ROOT, 'tests/f10c2/cr1buR1IperfTruth.behavior.test.js'))).toBe(true)
    const mapped = mapFieldTestRunRow({
      run: {
        id: 'a2951b10-6312-4954-bd05-bb65340a9367',
        scenario_type: 'iperf3',
        report_name: 'F10C2-P4BU-E2E_Data_RF_Report_20260825_164751',
        data_summary: {
          metrics: { dl_mbps_avg: 34.474, ul_mbps_avg: 53.565 },
          scenarios: [{
            iterations: [
              { n: 1, status: 'completed', dl_mbps: 6.009, ul_mbps: 50 },
              { n: 2, status: 'completed', dl_mbps: 62.939, ul_mbps: 57.13 },
            ],
          }],
        },
        rf_summary: {},
        gps_summary: {},
      },
    })
    expect(mapped.test_summary.metrics.dl_mbps_avg).toBe(34.474)
    expect(mapped.test_summary.metrics.ul_mbps_avg).toBe(53.565)
    expect(formatMetric(6.009)).toBe('6.009')
    expect(formatMetric(6.009)).not.toBe('0')
    expect(String(mapped.scenario_details?.data_summary?.scenarios?.[0]?.iterations?.[0]?.dl_mbps)).toBe('6.009')
  })

  it('24. evaluateRun still returns the same snapshot when one is supplied', () => {
    const first = evaluateFieldTestRun({
      run: { task_id: 'task-1', project_id: 'proj-1', scenario_type: 'native_http' },
      iterations: [{ iteration_number: 1, status: 'completed', dl_mbps: 90, ul_mbps: 12 }],
      profiles: [{
        id: 'p-task', scope_type: 'task', scope_id: 'task-1', is_active: true, version: 1,
        rules: { min_dl_mbps: 10, min_ul_mbps: 1, enabled_directions: ['dl', 'ul'] },
      }],
    })
    const second = evaluateFieldTestRun({
      run: { task_id: 'task-1' },
      existingSnapshot: first.snapshot,
    })
    expect(second.idempotent).toBe(true)
    expect(second.snapshot).toBe(first.snapshot)
  })

  it('25. no Sync Now trigger is introduced in CR1-D-R2 assignment or field results files', () => {
    expect(page.toLowerCase()).not.toContain('sync now')
    expect(frDetail.toLowerCase()).not.toContain('sync now')
    expect(provider.toLowerCase()).not.toContain('sync now')
  })

  it('26. SQL 215 is not reapplied from the UI path', () => {
    expect(provider).toContain('upsert_acceptance_profile')
    expect(page).not.toContain('applyCr1d')
    expect(page).not.toContain('215_cr1d')
  })

  it('27. Saved Rules summary wording for the E2E data rule stays operational', () => {
    const form = {
      ...emptySimpleRuleForm(),
      requireDl: true,
      dlMinMbps: '10',
      dlPassingCount: '20',
      requireUl: true,
      ulMinMbps: '1',
      ulPassingCount: '20',
    }
    expect(summarizeSimpleRule(form)).toBe('DL: 20 passes at 10 Mbps · UL: 20 passes at 1 Mbps')
  })
})
