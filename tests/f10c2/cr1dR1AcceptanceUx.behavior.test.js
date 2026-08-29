/**
 * F10C2 CR1-D-R1 — Acceptance Criteria UX rebuild, theme tokens, Field Results polish.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  emptySimpleRuleForm,
  formFromProfile,
  profileRulesFromForm,
  summarizeSimpleRule,
  validateSimpleRule,
  dlIterationPassCopy,
  isReusableSavedRule,
  persistedVendorName,
  isOpenTask,
  ruleCompatibility,
  prepareSavedRuleUpdate,
  RULE_UPDATED_TOAST,
  libraryProfileFromForm,
} from '../../src/acceptance/simpleRuleUx.js'
import { createMockAcceptanceProfilesProvider } from '../../src/acceptance/profiles/mockAcceptanceProfilesProvider.js'
import { evaluateDlUlRun } from '../../src/acceptance/dlUlEvaluation.js'
import { evaluateFieldTestRun } from '../../src/acceptance/evaluateRun.js'
import { PROFILE_RESOLUTION_ORDER } from '../../src/acceptance/profileResolution.js'
import { VERDICTS } from '../../src/acceptance/verdicts.js'
import { cloneProfile, createNewProfileVersion } from '../../src/acceptance/profileManagement.js'

const ROOT = process.cwd()
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

describe('f10c2 cr1-d-r1 — acceptance UX, theme, field results polish', () => {
  const page = read('src/acceptance/components/AcceptanceCriteriaPage.jsx')
  const accCss = read('src/acceptance/components/AcceptanceCriteria.css')
  const frCss = read('src/fieldResults/components/FieldResults.css')
  const frPage = read('src/fieldResults/components/FieldResultsPage.jsx')
  const frList = read('src/fieldResults/components/FieldResultsList.jsx')
  const frDetail = read('src/fieldResults/components/FieldResultDetail.jsx')
  const theme = read('src/theme/semanticTheme.css')
  const indexHtml = read('index.html')
  const dash = read('src/AdminDashboard.jsx')

  it('1. shared semantic tokens exist and flip with day/night classes', () => {
    expect(theme).toContain('--bd-page-bg')
    expect(theme).toContain('--bd-card-bg')
    expect(theme).toContain('--bd-text')
    expect(theme).toContain('html.bd-theme-day')
    expect(theme).toContain('body.bd-theme-night')
    expect(read('src/main.jsx')).toContain('semanticTheme.css')
  })

  it('2. Field Results --bdfr-* maps to global tokens instead of hardcoded navy', () => {
    expect(frCss).toContain('--bdfr-text: var(--bd-text')
    expect(frCss).toContain('--bdfr-panel: var(--bd-card-bg')
    expect(frCss).not.toMatch(/body\.bd-theme-day \.bdfr-page[\s\S]{0,200}--bdfr-text:\s*#e8f1ff/)
  })

  it('3. Day mode Field Results does not force dark text onto light pages', () => {
    expect(frCss).toContain('body.bd-theme-day .bdfr-page')
    expect(frCss).toContain('body.bd-theme-night .bdfr-page')
    const dayBlock = frCss.slice(frCss.indexOf('body.bd-theme-day .bdfr-page'), frCss.indexOf('body.bd-theme-night .bdfr-page'))
    expect(dayBlock).not.toContain('#e8f1ff')
    expect(dayBlock).toContain('var(--bd-text)')
  })

  it('4. Acceptance Criteria inherits semantic card/text tokens', () => {
    expect(accCss).toContain('var(--bd-text')
    expect(accCss).toContain('var(--bd-card-bg')
    expect(accCss).not.toContain('#07111f')
  })

  it('5. theme persists in localStorage and is applied before first paint', () => {
    expect(dash).toContain('babyDragonTheme')
    expect(indexHtml).toContain("localStorage.getItem('babyDragonTheme')")
    expect(indexHtml).toContain('bd-theme-day')
  })

  it('6. two stacked panels: Pass/Fail Criteria then Assign to Open Tasks', () => {
    const top = page.indexOf('Pass/Fail Criteria')
    const bottom = page.indexOf('Assign Criteria to Open Tasks')
    expect(top).toBeGreaterThan(-1)
    expect(bottom).toBeGreaterThan(top)
    expect(page).toContain('Create simple reusable rules and assign them to field tasks.')
  })

  it('7. simple form has name, description, DL/UL, MO/MT and no JSON editor', () => {
    expect(page).toContain('Rule Name')
    expect(page).toContain('Require Download')
    expect(page).toContain('Require Upload')
    expect(page).toContain('Require MO')
    expect(page).toContain('Require MT')
    expect(page).not.toContain('JSON.stringify')
    expect(page).not.toContain('bd-acc-json')
  })

  it('8. default UI hides clone, create new version, raw version numbers, and scope/resolver jargon', () => {
    expect(page).not.toContain('Create New Version')
    expect(page).not.toContain('>Clone<')
    expect(page).not.toContain('onClone')
    expect(page).not.toContain('PROFILE_RESOLUTION_ORDER')
    expect(page).not.toContain('scenario_family')
    expect(page).not.toContain('tenant default')
    expect(page).toContain('Save Rule')
    expect(page).toContain('Save Updated Rule')
    expect(page).toContain('Clear Form')
    expect(page).toContain('Cancel Edit')
  })

  it('9. saved rules table is operational: name, summary, assigned tasks, status, edit, activate', () => {
    expect(page).toContain('Saved Rules')
    expect(page).toContain('Simple Summary')
    expect(page).toContain('Assigned Tasks')
    expect(page).toContain('Activate/Deactivate')
    expect(page).toContain('Edit Rule')
  })

  it('10. plain-language iteration copy avoids >= and JSON keys', () => {
    expect(dlIterationPassCopy(10, 20)).toBe('DL passes when 20 completed iterations each reach at least 10 Mbps.')
    expect(page).toContain('dlIterationPassCopy')
    expect(page).toContain('DATA_THROUGHPUT_NOTE')
    expect(read('src/acceptance/simpleRuleUx.js')).toContain('Only completed iterations meeting the threshold count as passes. Missing evidence is marked Incomplete.')
  })

  it('11. Standard Data Test summary uses the owner example wording', () => {
    const form = {
      ...emptySimpleRuleForm(),
      requireDl: true,
      dlMinMbps: '10',
      dlPassingCount: '20',
      requireUl: true,
      ulMinMbps: '1',
      ulPassingCount: '20',
      requireMo: true,
      moSuccessCount: '10',
      requireMt: true,
      mtSuccessCount: '10',
    }
    expect(summarizeSimpleRule(form)).toBe(
      'DL: 20 passes at 10 Mbps · UL: 20 passes at 1 Mbps · MO: 10 successes · MT: 10 successes',
    )
  })

  it('12. validation blocks blank name, no requirements, negatives, decimals, zero counts, duplicate names', () => {
    expect(validateSimpleRule({ ...emptySimpleRuleForm(), name: '' }).ok).toBe(false)
    expect(validateSimpleRule({ ...emptySimpleRuleForm(), name: 'A' }).errors[0]).toMatch(/at least one requirement/i)
    expect(validateSimpleRule({ ...emptySimpleRuleForm(), name: 'A', requireDl: true, dlMinMbps: '-1', dlPassingCount: '2' }).ok).toBe(false)
    expect(validateSimpleRule({ ...emptySimpleRuleForm(), name: 'A', requireDl: true, dlMinMbps: '10', dlPassingCount: '1.5' }).ok).toBe(false)
    expect(validateSimpleRule({ ...emptySimpleRuleForm(), name: 'A', requireDl: true, dlMinMbps: '10', dlPassingCount: '0' }).ok).toBe(false)
    const dup = validateSimpleRule(
      { ...emptySimpleRuleForm(), name: 'Standard Data Test', requireDl: true, dlMinMbps: '10', dlPassingCount: '20' },
      { profiles: [{ id: 'x', name: 'Standard Data Test', is_active: true, scope_type: 'tenant' }] },
    )
    expect(dup.ok).toBe(false)
    expect(dup.errors[0]).toMatch(/already exists/)
  })

  it('13. form maps onto existing engine rules including required passing counts', () => {
    const rules = profileRulesFromForm({
      ...emptySimpleRuleForm(),
      requireDl: true,
      dlMinMbps: '10',
      dlPassingCount: '20',
      requireUl: true,
      ulMinMbps: '1',
      ulPassingCount: '20',
    })
    expect(rules.dl_ul.min_dl_mbps).toBe(10)
    expect(rules.dl_ul.min_ul_mbps).toBe(1)
    expect(rules.dl_ul.required_dl_passing_iterations).toBe(20)
    expect(rules.dl_ul.required_ul_passing_iterations).toBe(20)
    const back = formFromProfile({ name: 'Standard Data Test', rules })
    expect(back.requireDl).toBe(true)
    expect(back.dlPassingCount).toBe('20')
  })

  it('14. required passing count does not treat failed or missing iterations as passing', () => {
    const rules = {
      enabled_directions: ['dl', 'ul'],
      min_dl_mbps: 10,
      min_ul_mbps: 1,
      required_dl_passing_iterations: 20,
      required_ul_passing_iterations: 20,
    }
    const iterations = [
      ...Array.from({ length: 20 }, (_, i) => ({ iteration_number: i + 1, status: 'completed', dl_mbps: 12, ul_mbps: 2 })),
      { iteration_number: 21, status: 'failed', dl_mbps: null, ul_mbps: null },
      { iteration_number: 22, status: 'completed', dl_mbps: null, ul_mbps: 2 },
    ]
    const pass = evaluateDlUlRun({ iterations, rules })
    expect(pass.counts.dl_pass).toBe(20)
    expect(pass.overall_verdict).toBe(VERDICTS.PASS)
    const missing = evaluateDlUlRun({
      iterations: Array.from({ length: 19 }, (_, i) => ({ iteration_number: i + 1, status: 'completed', dl_mbps: 12, ul_mbps: 2 }))
        .concat([{ iteration_number: 20, status: 'completed', dl_mbps: null, ul_mbps: 2 }]),
      rules,
    })
    expect(missing.overall_verdict).toBe(VERDICTS.INCOMPLETE)
    const fail = evaluateDlUlRun({
      iterations: Array.from({ length: 18 }, (_, i) => ({ iteration_number: i + 1, status: 'completed', dl_mbps: 12, ul_mbps: 2 }))
        .concat([
          { iteration_number: 19, status: 'completed', dl_mbps: 4, ul_mbps: 2 },
          { iteration_number: 20, status: 'completed', dl_mbps: 4, ul_mbps: 2 },
        ]),
      rules,
    })
    expect(fail.overall_verdict).toBe(VERDICTS.FAIL)
  })

  it('15. legacy percentage/AND profiles are not weakened when passing counts are absent', () => {
    const result = evaluateDlUlRun({
      iterations: [
        { iteration_number: 1, status: 'completed', dl_mbps: 80, ul_mbps: 12 },
        { iteration_number: 2, status: 'completed', dl_mbps: 10, ul_mbps: 12 },
      ],
      rules: { enabled_directions: ['dl', 'ul'], min_dl_mbps: 50, min_ul_mbps: 10 },
    })
    expect(result.overall_verdict).toBe(VERDICTS.FAIL)
  })

  it('16. editing a snapshotted rule creates a new immutable version internally with operational toast', () => {
    const profile = { id: 'p1', version: 2, name: 'Standard Data Test' }
    const prepared = prepareSavedRuleUpdate(profile, [{ profile_id: 'p1', profile_version: 2 }], { role: 'admin' })
    expect(prepared.ok).toBe(true)
    expect(prepared.createdNewVersion).toBe(true)
    expect(prepared.profile.version).toBe(3)
    expect(prepared.toast).toBe(RULE_UPDATED_TOAST)
    expect(page).toContain('Rule updated. Previous completed results remain unchanged.')
    expect(cloneProfile(profile).profile.id).not.toBe(profile.id)
    expect(createNewProfileVersion(profile).profile.version).toBe(3)
  })

  it('17. open-task assignment columns and bulk confirm copy exist', () => {
    expect(page).toContain('Project Name')
    expect(page).toContain('Vendor Name')
    expect(page).toContain('Task Name / Grid')
    expect(page).toContain('Assigned FE')
    expect(page).toContain('Current Criteria')
    expect(page).toContain('Select Criteria')
    expect(page).toContain('Assign to Selected')
    expect(page).toContain('Change Assignment')
    expect(page).toContain('Assign “')
    expect(page).toContain('selected task(s)?')
    expect(isOpenTask({ status: 'assigned' })).toBe(true)
    expect(isOpenTask({ status: 'completed' })).toBe(false)
  })

  it('18. vendor names come from persisted customer/vendor fields and are not fabricated', () => {
    expect(persistedVendorName({ projects: { customer: 'Acme Wireless' } })).toBe('Acme Wireless')
    expect(persistedVendorName({})).toBe('—')
    expect(page).toContain('persistedVendorName')
  })

  it('19. incompatible rule vs test type is rejected in plain language', () => {
    const dataRule = libraryProfileFromForm({
      ...emptySimpleRuleForm(),
      name: 'Standard Data Test',
      requireDl: true,
      dlMinMbps: '10',
      dlPassingCount: '20',
    })
    const bad = ruleCompatibility(dataRule, 'voice_mo')
    expect(bad.ok).toBe(false)
    expect(bad.message).toMatch(/voice-only/)
    expect(page).toContain('ruleCompatibility')
  })

  it('20. default assignment UI does not expose precedence; task-specific note is human', () => {
    expect(page).toContain('This task has a task-specific criterion.')
    expect(page).not.toContain('Resolution order')
    expect(PROFILE_RESOLUTION_ORDER[0]).toBe('task+scenario')
  })

  it('21. mock save/update/assign wrap existing profile APIs without SQL', async () => {
    const provider = createMockAcceptanceProfilesProvider()
    const saved = await provider.saveRule({
      ...emptySimpleRuleForm(),
      name: 'Indoor Voice Rule',
      requireMo: true,
      moSuccessCount: '5',
    }, { role: 'admin' })
    expect(saved.ok).toBe(true)
    const listed = await provider.listProfiles()
    expect(listed.profiles.some((p) => p.name === 'Indoor Voice Rule' && isReusableSavedRule(p))).toBe(true)
    const task = { id: 'task-open-1', project_id: 'proj-syn-001', test_type: 'native_http', status: 'assigned' }
    const assigned = await provider.assignToTasks('profile-standard-data', [task], { role: 'admin' })
    expect(assigned.ok).toBe(true)
  })

  it('22. Field Results header is operational and hides architecture warnings', () => {
    expect(frPage).toContain('Review completed field tests, measured results, GPS routes and reports.')
    expect(frPage).toContain('Disposable Validation')
    expect(frPage).not.toContain('CR1-D')
    expect(frPage).not.toContain('Private artifact')
    expect(frPage).not.toContain('RLS/RPC')
    expect(frPage).not.toContain('Production is not a valid target')
  })

  it('23. primary Field Results filters are Search/Project/Vendor/FE/Test Type/Date/Acceptance/QC', () => {
    expect(frList).toContain('More Filters')
    const primary = frList.slice(0, frList.indexOf('More Filters'))
    expect(primary).toContain('Filter by project')
    expect(primary).toContain('Filter by vendor')
    expect(primary).toContain('Filter by field engineer')
    expect(primary).toContain('Filter by test type')
    expect(primary).toContain('Start date')
    expect(primary).toContain('Filter by acceptance verdict')
    expect(primary).not.toContain('Filter by grid')
    expect(frList).toContain('Filter by grid')
  })

  it('24. Field Results table columns match the polished operational set', () => {
    expect(frList).toContain('>Report</th>')
    expect(frList).toContain('>Project</th>')
    expect(frList).toContain('Task / Grid')
    expect(frList).toContain('>Vendor</th>')
    expect(frList).toContain('>FE</th>')
    expect(frList).toContain('>Test Type</th>')
    expect(frList).toContain('>Date</th>')
    expect(frList).toContain('>Iterations</th>')
    expect(frList).toContain('>Acceptance</th>')
    expect(frList).toContain('>QC</th>')
    expect(frList).toContain('>View</th>')
    expect(frList).toContain('Collapse run details')
  })

  it('25. result detail default order is summary, pass/fail, throughput, GPS, RF, downloads, advanced collapsed', () => {
    const start = frDetail.indexOf('function OpsOverviewPanel')
    const end = frDetail.indexOf('function OverviewPanel')
    const ops = frDetail.slice(start, end)
    const order = [
      'Test Summary',
      'Pass/Fail Results',
      'Throughput Summary',
      'GPS Driven Route',
      'RF Summary',
      'ArtifactsPanel',
    ]
    let last = -1
    for (const label of order) {
      const idx = ops.indexOf(label)
      expect(ops).toContain(label)
      expect(idx).toBeGreaterThan(last)
      last = idx
    }
    expect(frDetail).toContain('Download Reports')
    expect(frDetail).toContain('Advanced Technical Details')
    expect(frDetail).toContain("id: 'overview'")
  })

  it('26. default UI wording avoids resolver/snapshot/JSON/RPC jargon', () => {
    expect(page.toLowerCase()).not.toContain('resolver')
    expect(page.toLowerCase()).not.toContain('snapshot')
    expect(page.toLowerCase()).not.toContain('precedence')
    expect(page.toLowerCase()).not.toContain('canonical package')
    expect(frPage.toLowerCase()).not.toContain('synthetic resolution')
  })

  it('27. SQL 215 precedence internals remain intact', () => {
    expect(PROFILE_RESOLUTION_ORDER).toEqual([
      'task+scenario', 'task', 'project+scenario', 'project', 'tenant+scenario', 'tenant',
    ])
    expect(read('supabase/drafts/f10c2/phase4b/forward/215_cr1d_acceptance_profile_management.sql')).toContain('cr1b_resolve_acceptance_profile')
  })

  it('28. historical HTTP/iPerf snapshot identities are still referenced by existing tests and not rewritten here', () => {
    const simplify = read('tests/f10c2/cr1dFieldResultsSimplify.behavior.test.js')
    const arch = read('tests/f10c2/cr1cFieldResultsArchitecture.behavior.test.js')
    expect(simplify).toContain('abfa51c3-80d0-4cc7-b984-535c63c67995')
    expect(arch).toContain('a2951b10-6312-4954-bd05-bb65340a9367')
    expect(fs.existsSync(path.join(ROOT, 'tests/f10c2/cr1buR1IperfTruth.behavior.test.js'))).toBe(true)
  })

  it('29. evaluateRun still returns the same snapshot when an existing snapshot is supplied', () => {
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

  it('30. QC Review consumes the same semantic tokens', () => {
    const qc = read('src/pages/QCReview.jsx')
    expect(qc).toContain('var(--bd-card-bg')
    expect(qc).toContain('var(--bd-text')
    expect(qc).toContain('body.bd-theme-day .bdqc-page')
  })
})
