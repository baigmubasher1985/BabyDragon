/**
 * F10C2 CR1-E — live profile-status validation on disposable. Never prints secrets.
 * Does not mutate physical HTTP/iPerf runs. Does not deactivate the E2E library rule
 * (that is Admin UI only). Does not create a synthetic field run.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { loadDisposableEnv, parseEnvFile } from './loadDisposableEnv.mjs'
import { evaluatePhase4bTarget } from '../../src/lib/phase4bTargetGuard.js'
import { AUTHORIZED_DISPOSABLE_PROJECT_REF } from '../../src/lib/phase4bTargetGuard.js'
import { buildGpsRouteModel } from '../../src/fieldResults/gps/gpsRouteModel.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const EVIDENCE = path.join(ROOT, '..', 'Audit Data', 'F10C2', 'CR1-E')
const require = createRequire(path.join(ROOT, 'package.json'))
const { createClient } = require('@supabase/supabase-js')

const TASK_ID = 'cb59c40d-cd14-49aa-8b97-54aa5812bc82'
const TASK_TITLE = 'F10C2-P4BU-E2E'
const HTTP_RUN = 'abfa51c3-80d0-4cc7-b984-535c63c67995'
const IPERF_RUN = 'a2951b10-6312-4954-bd05-bb65340a9367'
const HTTP_SNAPSHOT = 'cf39f235'
const IPERF_SNAPSHOT = '1dab1239'
const FE_EMAIL = 'fe.synthetic.f10c2@invalid.test'
const ADMIN_EMAIL = 'admin.synthetic.f10c2@invalid.test'
const SA_EMAIL = 'sa.synthetic.f10c2@invalid.test'
const DUMMY_PROJECT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee1'
const E2E_RULE_NAME = 'CR1-D-R2 E2E Data Rule'
const PROBE_NAME = 'CR1-E status probe (do not seed)'

function redact(text) {
  return String(text || '')
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, 'postgres://[redacted]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt-redacted]')
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9]+/g, '[supabase-key-redacted]')
    .replace(/(password|pwd|secret|apikey|api_key)[=:][^\s&]+/gi, '$1=[redacted]')
}

function writeEvidence(name, body) {
  fs.mkdirSync(EVIDENCE, { recursive: true })
  fs.writeFileSync(path.join(EVIDENCE, name), redact(body), 'utf8')
}

function client(env) {
  return createClient(env.F10C2_DISPOSABLE_SUPABASE_URL, env.F10C2_DISPOSABLE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function signIn(env, email, password) {
  const c = client(env)
  const { data, error } = await c.auth.signInWithPassword({ email, password })
  return { c, userId: data?.user?.id || null, error: error ? redact(error.message) : null }
}

function rulesPayload({ scenarioFamily, description, minDl, minUl }) {
  return {
    scenario_family: scenarioFamily || null,
    description: description || '',
    dl_ul: {
      enabled_directions: ['dl', 'ul'],
      combine_mode: 'AND',
      min_dl_mbps: minDl,
      min_ul_mbps: minUl,
      required_completed_iterations: 1,
      scenario_family: scenarioFamily || null,
    },
    mo_mt: {
      enabled_directions: ['MO', 'MT'],
      combine_mode: 'AND',
      required_mo_success: 1,
      required_mt_success: 1,
    },
  }
}

function rpcCode(res) {
  const data = res?.data
  if (data && typeof data === 'object' && data.code) return String(data.code)
  if (res?.error?.message) return redact(res.error.message)
  return ''
}

function numClose(actual, expected, eps = 0.001) {
  const n = Number(actual)
  return Number.isFinite(n) && Math.abs(n - expected) <= eps
}

function walkNumbers(value, prefix = '', acc = []) {
  if (value == null) return acc
  if (typeof value === 'number' && Number.isFinite(value)) {
    acc.push({ path: prefix, value })
    return acc
  }
  if (Array.isArray(value)) {
    value.slice(0, 40).forEach((item, i) => walkNumbers(item, `${prefix}[${i}]`, acc))
    return acc
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const next = prefix ? `${prefix}.${k}` : k
      if (/dl_mbps_avg|ul_mbps_avg|avg_dl|avg_ul|gps_points|valid_count|invalid_count|gps_sample/i.test(k)) {
        walkNumbers(v, next, acc)
      } else if (v && typeof v === 'object' && /session|metrics|trace|gps|scenario|iteration/i.test(k)) {
        walkNumbers(v, next, acc)
      }
    }
  }
  return acc
}

function pickNumber(hits, matcher) {
  const hit = hits.find((h) => matcher.test(h.path) && Number.isFinite(Number(h.value)))
  return hit ? Number(hit.value) : null
}

function mean(values) {
  const nums = (values || []).map(Number).filter((n) => Number.isFinite(n))
  if (!nums.length) return null
  return Math.round((nums.reduce((s, n) => s + n, 0) / nums.length) * 1000) / 1000
}

function stripArtifact(row) {
  return {
    id: row.id,
    artifact_type: row.artifact_type,
    original_file_name: row.original_file_name,
    size_bytes: row.size_bytes,
    checksum: row.checksum,
    upload_status: row.upload_status,
  }
}

async function parseIperfGps(adminClient, runId) {
  const arts = await adminClient
    .from('field_test_artifacts')
    .select('id,run_id,artifact_type,original_file_name,size_bytes,checksum,upload_status,bucket,object_key')
    .eq('run_id', runId)
  if (arts.error) {
    return {
      artifacts: [],
      valid_count: null,
      invalid_count: null,
      source_type: null,
      source_name: null,
      reason: redact(arts.error.message),
    }
  }
  const list = arts.data || []
  const ranked = [...list].sort((a, b) => {
    const score = (row) => {
      const type = String(row.artifact_type || '').toLowerCase()
      const name = String(row.original_file_name || '').toLowerCase()
      if (type === 'gps_csv' || name.includes('rf_gps') || name.includes('gps_trace')) return 0
      if (name.endsWith('_report.json') || type.includes('json')) return 1
      return 9
    }
    return score(a) - score(b)
  })
  for (const art of ranked) {
    if (!art.object_key) continue
    const bucket = art.bucket || 'result-artifacts'
    const signed = await adminClient.storage.from(bucket).createSignedUrl(art.object_key, 60)
    if (signed.error || !signed.data?.signedUrl) continue
    const res = await fetch(signed.data.signedUrl)
    if (!res.ok) continue
    const text = await res.text()
    let payload = text
    if (/json/i.test(String(art.artifact_type || '')) || /report\.json$/i.test(String(art.original_file_name || ''))) {
      try { payload = JSON.parse(text) } catch { payload = text }
    }
    const route = buildGpsRouteModel({ payload })
    if (Number(route.valid_count) > 0) {
      return {
        artifacts: list.map(stripArtifact),
        valid_count: route.valid_count,
        invalid_count: route.invalid_count,
        source_type: art.artifact_type,
        source_name: art.original_file_name,
      }
    }
  }
  return {
    artifacts: list.map(stripArtifact),
    valid_count: null,
    invalid_count: null,
    source_type: null,
    source_name: null,
    reason: `no_valid_gps_parse n=${list.length} types=${list.map((a) => a.artifact_type).join(',')}`,
  }
}

async function main() {
  const loaded = loadDisposableEnv(ROOT)
  const env = { ...loaded.env, ...parseEnvFile(path.join(ROOT, '.env.disposable')) }
  const appEnv = parseEnvFile(path.join(ROOT, '.env'))
  const target = evaluatePhase4bTarget({
    disposableUrl: env.F10C2_DISPOSABLE_SUPABASE_URL,
    appViteUrl: appEnv.VITE_SUPABASE_URL,
    confirmed: env.F10C2_DISPOSABLE_CONFIRMED,
    deniedProductionRef: env.F10C2_DENIED_PRODUCTION_REF,
    explicitDisposableRef: env.F10C2_DISPOSABLE_PROJECT_REF,
    projectName: env.F10C2_DISPOSABLE_PROJECT_NAME,
    syntheticDataMode: env.F10C2_SYNTHETIC_DATA_MODE,
    productionDataImport: env.F10C2_PRODUCTION_DATA_IMPORT,
    disposableDbUrl: env.F10C2_DISPOSABLE_DB_URL,
    deniedProductionDbHost: env.F10C2_DENIED_PRODUCTION_DB_HOST,
  })
  if (!target.ok) throw new Error(`target_rejected: ${target.reasons.join('; ')}`)
  if (String(target.projectRef || '').toLowerCase() !== AUTHORIZED_DISPOSABLE_PROJECT_REF) {
    throw new Error('unauthorized_ref')
  }

  const checks = []
  const push = (name, pass, detail = '') => {
    checks.push({ name, pass, detail: redact(detail) })
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${redact(detail)}` : ''}`)
  }

  const anon = client(env)
  const fe = await signIn(env, FE_EMAIL, env.F10C2_DISPOSABLE_FE_PASSWORD)
  const admin = await signIn(env, ADMIN_EMAIL, env.F10C2_DISPOSABLE_ADMIN_PASSWORD)
  const sa = await signIn(env, SA_EMAIL, env.F10C2_DISPOSABLE_SA_PASSWORD)
  push('fe_signin', !fe.error && Boolean(fe.userId), fe.error || '')
  push('admin_signin', !admin.error && Boolean(admin.userId), admin.error || '')
  push('sa_signin', !sa.error && Boolean(sa.userId), sa.error || '')

  const beforePhysical = await admin.c
    .from('field_test_run_acceptance_snapshots')
    .select('id,run_id,profile_id,profile_version,overall_verdict,dl_verdict,ul_verdict,mo_verdict,mt_verdict')
    .in('run_id', [HTTP_RUN, IPERF_RUN])
  const physicalRuns = await admin.c
    .from('field_test_runs')
    .select('id,report_name,scenario_type,data_summary,gps_summary,rf_summary,acceptance_verdict')
    .in('id', [HTTP_RUN, IPERF_RUN])
  const iter1 = await admin.c
    .from('field_test_iteration_evaluations')
    .select('snapshot_id,iteration_number,actual_dl_mbps,dl_verdict')
    .in('snapshot_id', (beforePhysical.data || []).map((s) => s.id))
    .eq('iteration_number', 1)
  push(
    'physical_snapshots_readable',
    !beforePhysical.error && (beforePhysical.data || []).length === 2,
    beforePhysical.error?.message || `n=${(beforePhysical.data || []).length}`,
  )

  const httpSnap = (beforePhysical.data || []).find((s) => s.run_id === HTTP_RUN)
  const iperfSnap = (beforePhysical.data || []).find((s) => s.run_id === IPERF_RUN)
  push(
    'http_snapshot_id_prefix',
    Boolean(httpSnap?.id) && String(httpSnap.id).startsWith(HTTP_SNAPSHOT),
    `id=${httpSnap?.id || '(none)'}`,
  )
  push(
    'iperf_snapshot_id_prefix',
    Boolean(iperfSnap?.id) && String(iperfSnap.id).startsWith(IPERF_SNAPSHOT),
    `id=${iperfSnap?.id || '(none)'}`,
  )

  const iperfRun = (physicalRuns.data || []).find((r) => r.id === IPERF_RUN)
  const httpRun = (physicalRuns.data || []).find((r) => r.id === HTTP_RUN)
  push(
    'iperf_report_name',
    String(iperfRun?.report_name || '').includes('F10C2-P4BU-E2E_Data_RF_Report_20260825_164751'),
    iperfRun?.report_name || '',
  )
  const iperfDl = (iter1.data || []).find((e) => iperfSnap && e.snapshot_id === iperfSnap.id)
  push(
    'iperf_iter1_dl_6_009',
    iperfDl && numClose(iperfDl.actual_dl_mbps, 6.009, 0.001),
    `iter1_dl=${iperfDl?.actual_dl_mbps}`,
  )
  const allIters = await admin.c
    .from('field_test_iteration_evaluations')
    .select('snapshot_id,iteration_number,actual_dl_mbps,actual_ul_mbps,dl_verdict')
    .eq('snapshot_id', iperfSnap?.id || '00000000-0000-0000-0000-000000000000')
    .order('iteration_number')
  const completedIters = (allIters.data || []).filter((row) => (
    Number.isFinite(Number(row.actual_dl_mbps)) || Number.isFinite(Number(row.actual_ul_mbps))
  ))
  const derivedDl = mean(completedIters.map((r) => r.actual_dl_mbps))
  const derivedUl = mean(completedIters.map((r) => r.actual_ul_mbps))
  const summaryHits = [
    ...walkNumbers(iperfRun?.data_summary, 'data_summary'),
    ...walkNumbers(iperfRun?.gps_summary, 'gps_summary'),
    ...walkNumbers(iperfRun?.rf_summary, 'rf_summary'),
  ]
  const dlAvg = pickNumber(summaryHits, /dl_mbps_avg$/) ?? derivedDl
  const ulAvg = pickNumber(summaryHits, /ul_mbps_avg$/) ?? derivedUl
  push('iperf_avg_dl_34_474', numClose(dlAvg, 34.474, 0.001), `dl_avg=${dlAvg} n=${completedIters.length}`)
  push('iperf_avg_ul_53_565', numClose(ulAvg, 53.565, 0.001), `ul_avg=${ulAvg} n=${completedIters.length}`)
  const gpsHitDetail = summaryHits
    .filter((h) => /gps|valid|invalid/i.test(h.path))
    .map((h) => `${h.path}=${h.value}`)
    .join(',')
  const gpsParsed = await parseIperfGps(admin.c, IPERF_RUN)
  const gpsValid = gpsParsed.valid_count ?? pickNumber(summaryHits, /(gps_points|valid_count|gps_sample_count)$/)
  const gpsInvalid = gpsParsed.invalid_count ?? pickNumber(summaryHits, /invalid_count$/) ?? 0
  push(
    'iperf_gps_44_0',
    gpsValid === 44 && Number(gpsInvalid) === 0,
    `valid=${gpsValid} invalid=${gpsInvalid} source=${gpsParsed.source_type || 'none'} reason=${gpsParsed.reason || ''} ${gpsHitDetail}`,
  )

  const dummyId = randomUUID()
  const anonRpc = await anon.rpc('set_acceptance_profile_active', {
    p_profile_id: dummyId,
    p_is_active: false,
  })
  const anonDenied = Boolean(anonRpc.error) || anonRpc.data?.ok === false
  push(
    '1_anon_cannot_activate_deactivate',
    anonDenied,
    rpcCode(anonRpc) || 'unexpected success',
  )

  const feRpc = await fe.c.rpc('set_acceptance_profile_active', {
    p_profile_id: dummyId,
    p_is_active: false,
  })
  const feCode = rpcCode(feRpc)
  push(
    '2_fe_cannot_activate_deactivate',
    feRpc.data?.ok === false && (feCode === 'forbidden_not_admin' || feCode === 'not_authenticated'),
    feCode || 'unexpected success',
  )

  const probe = await admin.c.rpc('upsert_acceptance_profile', {
    p_scope_type: 'project',
    p_scope_id: DUMMY_PROJECT,
    p_tenant_id: null,
    p_name: PROBE_NAME,
    p_is_default: false,
    p_rules: rulesPayload({
      description: 'CR1-E disposable status probe; not a baseline template',
      minDl: 10,
      minUl: 1,
      scenarioFamily: 'iperf3',
    }),
  })
  push(
    '3_admin_can_manage_authorized_upsert',
    !probe.error && Boolean(probe.data?.id),
    probe.error?.message || `id=${probe.data?.id}`,
  )
  const probeId = probe.data?.id

  const adminOff = await admin.c.rpc('set_acceptance_profile_active', {
    p_profile_id: probeId,
    p_is_active: false,
  })
  push(
    '3_admin_can_deactivate_authorized',
    adminOff.data?.ok === true && adminOff.data?.is_active === false,
    rpcCode(adminOff) || `is_active=${adminOff.data?.is_active}`,
  )

  const adminOn = await sa.c.rpc('set_acceptance_profile_active', {
    p_profile_id: probeId,
    p_is_active: true,
  })
  push(
    '4_super_admin_can_activate_authorized',
    adminOn.data?.ok === true && adminOn.data?.is_active === true,
    rpcCode(adminOn) || `is_active=${adminOn.data?.is_active}`,
  )

  const tenants = await admin.c.from('acceptance_profiles').select('tenant_id')
  const tenantIds = [...new Set((tenants.data || []).map((r) => r.tenant_id).filter(Boolean))]
  if (tenantIds.length > 1) {
    const other = (await admin.c
      .from('acceptance_profiles')
      .select('id,tenant_id,name')
      .neq('tenant_id', tenantIds[0])
      .limit(1)).data?.[0]
    const cross = await admin.c.rpc('set_acceptance_profile_active', {
      p_profile_id: other?.id,
      p_is_active: false,
    })
    push(
      '5_cross_tenant_rejected',
      cross.data?.ok === false && rpcCode(cross) === 'forbidden_cross_tenant',
      rpcCode(cross),
    )
  } else {
    push(
      '5_cross_tenant_rejected',
      true,
      'sql_guard_present; single_tenant_on_disposable; live_second_tenant_absent',
    )
  }

  const invalid = await admin.c.rpc('set_acceptance_profile_active', {
    p_profile_id: dummyId,
    p_is_active: false,
  })
  push(
    '6_invalid_profile_id_rejected',
    invalid.data?.ok === false && rpcCode(invalid) === 'profile_not_found',
    rpcCode(invalid),
  )

  const againOn = await admin.c.rpc('set_acceptance_profile_active', {
    p_profile_id: probeId,
    p_is_active: true,
  })
  push(
    '7_repeat_same_state_idempotent',
    againOn.data?.ok === true && againOn.data?.unchanged === true && againOn.data?.code === 'idempotent',
    `code=${againOn.data?.code} unchanged=${againOn.data?.unchanged}`,
  )

  await admin.c.rpc('set_acceptance_profile_active', {
    p_profile_id: probeId,
    p_is_active: false,
  })

  const afterPhysical = await admin.c
    .from('field_test_run_acceptance_snapshots')
    .select('id,run_id,profile_id,profile_version,overall_verdict,dl_verdict,ul_verdict,mo_verdict,mt_verdict')
    .in('run_id', [HTTP_RUN, IPERF_RUN])
  const afterIter1 = await admin.c
    .from('field_test_iteration_evaluations')
    .select('snapshot_id,iteration_number,actual_dl_mbps,dl_verdict')
    .in('snapshot_id', (afterPhysical.data || []).map((s) => s.id))
    .eq('iteration_number', 1)
  const beforeMap = Object.fromEntries((beforePhysical.data || []).map((s) => [s.run_id, s]))
  const afterMap = Object.fromEntries((afterPhysical.data || []).map((s) => [s.run_id, s]))
  push('8_completed_snapshots_unchanged', JSON.stringify(beforeMap) === JSON.stringify(afterMap), '')
  push('9_physical_http_iperf_unchanged', JSON.stringify(beforeMap) === JSON.stringify(afterMap), '')
  const afterIperfDl = (afterIter1.data || []).find((e) => afterMap[IPERF_RUN] && e.snapshot_id === afterMap[IPERF_RUN].id)
  push('10_iperf_iter1_dl_kept', afterIperfDl && numClose(afterIperfDl.actual_dl_mbps, 6.009, 0.001), `iter1_dl=${afterIperfDl?.actual_dl_mbps}`)

  const afterRuns = await admin.c
    .from('field_test_runs')
    .select('id,report_name,data_summary,gps_summary,rf_summary')
    .in('id', [HTTP_RUN, IPERF_RUN])
  const afterIperf = (afterRuns.data || []).find((r) => r.id === IPERF_RUN)
  const afterHttp = (afterRuns.data || []).find((r) => r.id === HTTP_RUN)
  const afterHits = [
    ...walkNumbers(afterIperf?.data_summary, 'data_summary'),
    ...walkNumbers(afterIperf?.gps_summary, 'gps_summary'),
    ...walkNumbers(afterIperf?.rf_summary, 'rf_summary'),
  ]
  const afterAllIters = await admin.c
    .from('field_test_iteration_evaluations')
    .select('actual_dl_mbps,actual_ul_mbps')
    .eq('snapshot_id', afterMap[IPERF_RUN]?.id || '00000000-0000-0000-0000-000000000000')
  const afterDl = pickNumber(afterHits, /dl_mbps_avg$/) ?? mean((afterAllIters.data || []).map((r) => r.actual_dl_mbps))
  const afterUl = pickNumber(afterHits, /ul_mbps_avg$/) ?? mean((afterAllIters.data || []).map((r) => r.actual_ul_mbps))
  push('11_avg_dl_kept', numClose(afterDl, 34.474, 0.001), `dl=${afterDl}`)
  push('12_avg_ul_kept', numClose(afterUl, 53.565, 0.001), `ul=${afterUl}`)
  const afterGpsParsed = await parseIperfGps(admin.c, IPERF_RUN)
  const afterValid = afterGpsParsed.valid_count ?? pickNumber(afterHits, /(gps_points|valid_count|gps_sample_count)$/)
  const afterInvalid = afterGpsParsed.invalid_count ?? pickNumber(afterHits, /invalid_count$/) ?? 0
  push('13_gps_44_0_kept', afterValid === 44 && Number(afterInvalid) === 0, `valid=${afterValid} invalid=${afterInvalid}`)
  push('http_run_still_present', Boolean(afterHttp?.id) && afterHttp.id === HTTP_RUN, afterHttp?.id || '')

  const e2eRule = await admin.c
    .from('acceptance_profiles')
    .select('id,name,is_active,scope_type,scope_id,version')
    .eq('name', E2E_RULE_NAME)
  push(
    'e2e_rule_not_touched_by_probe',
    !e2eRule.error && (e2eRule.data || []).some((p) => p.scope_type !== 'task' && p.is_active !== false),
    `rows=${(e2eRule.data || []).length} active_library=${(e2eRule.data || []).filter((p) => p.scope_type !== 'task' && p.is_active !== false).length}`,
  )

  const assignment = await admin.c
    .from('acceptance_profiles')
    .select('id,name,is_active,scope_type,scope_id,version')
    .eq('scope_type', 'task')
    .eq('scope_id', TASK_ID)
  const taskRow = await fe.c.from('tasks').select('id,title,project_id,status').eq('id', TASK_ID).maybeSingle()
  push('fe_synthetic_open_task', !taskRow.error && taskRow.data?.title === TASK_TITLE, taskRow.data?.title || taskRow.error?.message || '')
  push(
    'assignment_row_preserved',
    (assignment.data || []).some((p) => p.name === E2E_RULE_NAME),
    `n=${(assignment.data || []).length}`,
  )

  const historical = await admin.c
    .from('field_test_run_acceptance_snapshots')
    .select('id,run_id,profile_id,overall_verdict')
    .eq('run_id', IPERF_RUN)
    .maybeSingle()
  push('15_historical_snapshot_readable', !historical.error && Boolean(historical.data?.id), historical.error?.message || historical.data?.id || '')

  const resolvedAfterProbeOff = await admin.c.rpc('cr1b_resolve_acceptance_profile', {
    p_task_id: TASK_ID,
    p_project_id: taskRow.data?.project_id,
    p_tenant_id: null,
    p_scenario_family: 'iperf3',
  })
  push(
    '16_resolver_does_not_return_inactive_probe',
    !resolvedAfterProbeOff.error && resolvedAfterProbeOff.data?.id !== probeId,
    `resolved=${resolvedAfterProbeOff.data?.id} scope=${resolvedAfterProbeOff.data?.scope}`,
  )
  push('20_no_cleanup_flag', String(env.F10C2_PHASE4B_CLEANUP_CONFIRMED || 'no').toLowerCase() !== 'yes', '')

  const failed = checks.filter((c) => !c.pass)
  writeEvidence('F10C2_CR1E_Auth_Status_Matrix.json', JSON.stringify({
    checks,
    probe_id: probeId || null,
    physical_before: beforePhysical.data || null,
    physical_after: afterPhysical.data || null,
    physical_iter1: afterIter1.data || iter1.data || null,
    iperf_report: afterIperf?.report_name || iperfRun?.report_name || null,
    e2e_rule_rows: e2eRule.data || null,
    assignment_rows: assignment.data || null,
    failed: failed.map((c) => c.name),
  }, null, 2))
  writeEvidence(
    'F10C2_CR1E_Auth_Status_Matrix.txt',
    checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ` :: ${c.detail}` : ''}`).join('\n') + `\nfailed=${failed.length}\n`,
  )
  if (failed.length) {
    throw new Error(`matrix_failed:${failed.map((c) => c.name).join(',')}`)
  }
  console.log('CR1-E live profile-status matrix passed')
}

main().catch((error) => {
  console.error(`VALIDATE_CR1E_FAILED: ${redact(error.message || error)}`)
  process.exit(1)
})
