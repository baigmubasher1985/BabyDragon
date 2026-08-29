/**
 * F10C2 CR1-D — live profile-management validation on disposable. Never prints secrets.
 * Creates a NEW synthetic run only; does not modify preserved physical runs.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { loadDisposableEnv, parseEnvFile } from './loadDisposableEnv.mjs'
import { evaluatePhase4bTarget } from '../../src/lib/phase4bTargetGuard.js'
import { AUTHORIZED_DISPOSABLE_PROJECT_REF } from '../../src/lib/phase4bTargetGuard.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const EVIDENCE = path.join(ROOT, '..', 'Audit Data', 'F10C2', 'CR1-D')
const require = createRequire(path.join(ROOT, 'package.json'))
const { createClient } = require('@supabase/supabase-js')

const TASK_ID = 'cb59c40d-cd14-49aa-8b97-54aa5812bc82'
const TASK_TITLE = 'F10C2-P4BU-E2E'
const HTTP_RUN = 'abfa51c3-80d0-4cc7-b984-535c63c67995'
const IPERF_RUN = 'a2951b10-6312-4954-bd05-bb65340a9367'
const FE_EMAIL = 'fe.synthetic.f10c2@invalid.test'
const ADMIN_EMAIL = 'admin.synthetic.f10c2@invalid.test'
const SA_EMAIL = 'sa.synthetic.f10c2@invalid.test'
const DUMMY_PROJECT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee1'

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

function rulesPayload({ scenarioFamily, description, minDl, minUl, moEnabled = true, mtEnabled = true, combine = 'AND' }) {
  return {
    scenario_family: scenarioFamily || null,
    description: description || '',
    dl_ul: {
      enabled_directions: ['dl', 'ul'],
      combine_mode: combine,
      min_dl_mbps: minDl,
      min_ul_mbps: minUl,
      required_completed_iterations: 1,
      scenario_family: scenarioFamily || null,
    },
    mo_mt: {
      enabled_directions: [
        ...(moEnabled ? ['MO'] : []),
        ...(mtEnabled ? ['MT'] : []),
      ],
      combine_mode: combine,
      required_mo_success: moEnabled ? 1 : 0,
      required_mt_success: mtEnabled ? 1 : 0,
    },
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
    .select('id,run_id,profile_id,profile_version,overall_verdict,dl_verdict,ul_verdict')
    .in('run_id', [HTTP_RUN, IPERF_RUN])
  const iter1 = await admin.c
    .from('field_test_iteration_evaluations')
    .select('snapshot_id,iteration_number,actual_dl_mbps,dl_verdict')
    .in('snapshot_id', (beforePhysical.data || []).map((s) => s.id))
    .eq('iteration_number', 1)
  push('physical_snapshots_readable', !beforePhysical.error && (beforePhysical.data || []).length === 2, beforePhysical.error?.message || `n=${(beforePhysical.data || []).length}`)

  const anonProfile = await anon.rpc('upsert_acceptance_profile', {
    p_scope_type: 'project',
    p_scope_id: DUMMY_PROJECT,
    p_tenant_id: null,
    p_name: 'anon-should-fail',
    p_is_default: false,
    p_rules: rulesPayload({ minDl: 1, minUl: 1, scenarioFamily: 'iperf3' }),
  })
  push('anon_profile_upsert_denied', Boolean(anonProfile.error), anonProfile.error?.message || 'unexpected success')

  const feProfile = await fe.c.rpc('upsert_acceptance_profile', {
    p_scope_type: 'project',
    p_scope_id: DUMMY_PROJECT,
    p_tenant_id: null,
    p_name: 'fe-should-fail',
    p_is_default: false,
    p_rules: rulesPayload({ minDl: 1, minUl: 1, scenarioFamily: 'iperf3' }),
  })
  push('fe_profile_upsert_denied', Boolean(feProfile.error), feProfile.error?.message || 'unexpected success')

  const projectDefault = await admin.c.rpc('upsert_acceptance_profile', {
    p_scope_type: 'project',
    p_scope_id: DUMMY_PROJECT,
    p_tenant_id: null,
    p_name: 'CR1-D synth project default',
    p_is_default: false,
    p_rules: rulesPayload({
      description: 'CR1-D synthetic project default',
      minDl: 10,
      minUl: 2,
    }),
  })
  push(
    'admin_project_default_upsert',
    !projectDefault.error && Boolean(projectDefault.data?.id),
    projectDefault.error?.message || `id=${projectDefault.data?.id} ver=${projectDefault.data?.version}`,
  )

  const projectIperf = await admin.c.rpc('upsert_acceptance_profile', {
    p_scope_type: 'project',
    p_scope_id: DUMMY_PROJECT,
    p_tenant_id: null,
    p_name: 'CR1-D synth project iperf3',
    p_is_default: false,
    p_rules: rulesPayload({
      scenarioFamily: 'iperf3',
      description: 'CR1-D synthetic project iperf3',
      minDl: 77,
      minUl: 9,
    }),
  })
  push(
    'admin_project_iperf_coexists',
    !projectIperf.error && Boolean(projectIperf.data?.id) && projectIperf.data?.id !== projectDefault.data?.id,
    projectIperf.error?.message || `id=${projectIperf.data?.id} family=${projectIperf.data?.scenario_family}`,
  )

  const projectHttp = await sa.c.rpc('upsert_acceptance_profile', {
    p_scope_type: 'project',
    p_scope_id: DUMMY_PROJECT,
    p_tenant_id: null,
    p_name: 'CR1-D synth project http',
    p_is_default: false,
    p_rules: rulesPayload({
      scenarioFamily: 'native_http',
      description: 'CR1-D synthetic project http',
      minDl: 40,
      minUl: 4,
      moEnabled: true,
      mtEnabled: false,
    }),
  })
  push(
    'sa_project_http_coexists',
    !projectHttp.error && Boolean(projectHttp.data?.id) && projectHttp.data?.id !== projectIperf.data?.id,
    projectHttp.error?.message || `id=${projectHttp.data?.id} family=${projectHttp.data?.scenario_family}`,
  )

  const dupIperf = await admin.c.rpc('upsert_acceptance_profile', {
    p_scope_type: 'project',
    p_scope_id: DUMMY_PROJECT,
    p_tenant_id: null,
    p_name: 'CR1-D synth project iperf3',
    p_is_default: false,
    p_rules: rulesPayload({
      scenarioFamily: 'iperf3',
      description: 'version bump same assignment',
      minDl: 77,
      minUl: 9,
    }),
  })
  push(
    'admin_same_assignment_versions',
    !dupIperf.error && dupIperf.data?.id === projectIperf.data?.id && Number(dupIperf.data?.version) >= Number(projectIperf.data?.version),
    dupIperf.error?.message || `version=${dupIperf.data?.version}`,
  )

  const persisted = await admin.c
    .from('acceptance_profiles')
    .select('id,name,description,scenario_family,is_active,scope_type,scope_id,version')
    .eq('scope_id', DUMMY_PROJECT)
    .eq('is_active', true)
  const families = new Set((persisted.data || []).map((p) => p.scenario_family || ''))
  push(
    'concurrent_scenario_assignments',
    !persisted.error && families.has('') && families.has('iperf3') && families.has('native_http'),
    persisted.error?.message || `families=${[...families].join(',')}`,
  )
  const httpRow = (persisted.data || []).find((p) => p.scenario_family === 'native_http')
  push('description_persisted', Boolean(httpRow?.description), httpRow?.description || '')
  const httpRules = await admin.c
    .from('acceptance_rules')
    .select('rule_type,enabled_directions,min_dl_mbps,min_ul_mbps,required_mo_success,required_mt_success,combine_mode')
    .eq('profile_id', httpRow?.id || '00000000-0000-0000-0000-000000000000')
    .eq('profile_version', httpRow?.version || 0)
  const dlRule = (httpRules.data || []).find((r) => r.rule_type === 'dl_ul')
  const moRule = (httpRules.data || []).find((r) => r.rule_type === 'mo_mt')
  push(
    'dl_ul_thresholds_persist',
    Number(dlRule?.min_dl_mbps) === 40 && Number(dlRule?.min_ul_mbps) === 4 && dlRule?.combine_mode === 'AND',
    `dl=${dlRule?.min_dl_mbps} ul=${dlRule?.min_ul_mbps} mode=${dlRule?.combine_mode}`,
  )
  push(
    'mo_mt_independent_disabled_na_config',
    Array.isArray(moRule?.enabled_directions) && moRule.enabled_directions.includes('MO') && !moRule.enabled_directions.includes('MT'),
    JSON.stringify(moRule?.enabled_directions || []),
  )

  const task = await fe.c.from('tasks').select('id,title,project_id').eq('id', TASK_ID).maybeSingle()
  push('fe_synthetic_task', !task.error && task.data?.title === TASK_TITLE, task.error?.message || task.data?.title || '')

  const taskIperf = await admin.c.rpc('upsert_acceptance_profile', {
    p_scope_type: 'task',
    p_scope_id: TASK_ID,
    p_tenant_id: null,
    p_name: 'CR1-D synth task iperf3',
    p_is_default: false,
    p_rules: rulesPayload({
      scenarioFamily: 'iperf3',
      description: 'CR1-D synthetic task+iperf3 for new-run resolution',
      minDl: 8,
      minUl: 1,
    }),
  })
  push(
    'admin_task_iperf_assign',
    !taskIperf.error && Boolean(taskIperf.data?.id),
    taskIperf.error?.message || `id=${taskIperf.data?.id} ver=${taskIperf.data?.version} family=${taskIperf.data?.scenario_family}`,
  )

  const resolved = await admin.c.rpc('cr1b_resolve_acceptance_profile', {
    p_task_id: TASK_ID,
    p_project_id: task.data?.project_id,
    p_tenant_id: null,
    p_scenario_family: 'iperf3',
  })
  push(
    'precedence_task_scenario',
    !resolved.error && resolved.data?.scope === 'task+scenario' && resolved.data?.id === taskIperf.data?.id,
    resolved.error?.message || `scope=${resolved.data?.scope} id=${resolved.data?.id}`,
  )
  const resolvedHttp = await admin.c.rpc('cr1b_resolve_acceptance_profile', {
    p_task_id: TASK_ID,
    p_project_id: task.data?.project_id,
    p_tenant_id: null,
    p_scenario_family: 'native_http',
  })
  push(
    'precedence_falls_through_without_task_http',
    !resolvedHttp.error && resolvedHttp.data?.scope && resolvedHttp.data?.scope !== 'task+scenario',
    resolvedHttp.error?.message || `scope=${resolvedHttp.data?.scope}`,
  )

  const clientRunId = randomUUID()
  const idem = `cr1d-synth:${clientRunId}`
  const submitted = await fe.c.rpc('submit_field_test_run', {
    p_client_run_id: clientRunId,
    p_task_id: TASK_ID,
    p_project_id: task.data?.project_id,
    p_scenario_type: 'iperf3',
    p_report_name: 'CR1-D-SYNTH-NEW-RUN',
    p_data_summary: { scenarios: [{ attempt_counts: { planned: 1, completed: 1, failed: 0 } }] },
  })
  const run = Array.isArray(submitted.data) ? submitted.data[0] : submitted.data
  push('fe_submit_new_synthetic_run', !submitted.error && Boolean(run?.id), submitted.error?.message || '')

  const payload = {
    package_identity: `pkg-cr1d:${clientRunId}`,
    iterations: [{
      iteration_number: 1,
      scenario_kind: 'iperf3',
      status: 'completed',
      dl_mbps: 120,
      ul_mbps: 15,
      started_at: new Date().toISOString(),
    }],
    call_events: [
      { direction: 'MO', event_type: 'success', synthetic: true },
      { direction: 'MT', event_type: 'success', synthetic: true },
    ],
    requested_iterations: 1,
    attempted_iterations: 1,
    completed_iterations: 1,
    failed_iterations: 0,
    upload_state: 'uploaded',
    synthetic_call_events: true,
  }
  const ingest1 = await fe.c.rpc('ingest_field_test_canonical_result', {
    p_run_id: run?.id,
    p_idempotency_key: idem,
    p_payload: payload,
  })
  push('fe_ingest_synthetic', !ingest1.error, ingest1.error?.message || '')

  const snap = await admin.c
    .from('field_test_run_acceptance_snapshots')
    .select('id,run_id,profile_id,profile_version,scope_type,overall_verdict,dl_verdict,ul_verdict,mo_verdict,mt_verdict,effective_configuration')
    .eq('run_id', run?.id)
    .maybeSingle()
  push(
    'new_run_resolved_task_iperf_profile',
    !snap.error && snap.data?.profile_id === taskIperf.data?.id && Number(snap.data?.profile_version) === Number(taskIperf.data?.version),
    snap.error?.message || `profile=${snap.data?.profile_id} ver=${snap.data?.profile_version} scope=${snap.data?.scope_type} verdict=${snap.data?.overall_verdict}`,
  )
  push(
    'new_run_computed_pass',
    snap.data?.overall_verdict === 'PASS' && snap.data?.dl_verdict === 'PASS' && snap.data?.ul_verdict === 'PASS',
    `overall=${snap.data?.overall_verdict} dl=${snap.data?.dl_verdict} ul=${snap.data?.ul_verdict}`,
  )

  const afterPhysical = await admin.c
    .from('field_test_run_acceptance_snapshots')
    .select('id,run_id,profile_id,profile_version,overall_verdict,dl_verdict,ul_verdict')
    .in('run_id', [HTTP_RUN, IPERF_RUN])
  const afterIter1 = await admin.c
    .from('field_test_iteration_evaluations')
    .select('snapshot_id,iteration_number,actual_dl_mbps,dl_verdict')
    .in('snapshot_id', (afterPhysical.data || []).map((s) => s.id))
    .eq('iteration_number', 1)
  const beforeMap = Object.fromEntries((beforePhysical.data || []).map((s) => [s.run_id, s]))
  const afterMap = Object.fromEntries((afterPhysical.data || []).map((s) => [s.run_id, s]))
  const sameHttp = JSON.stringify(beforeMap[HTTP_RUN]) === JSON.stringify(afterMap[HTTP_RUN])
  const sameIperf = JSON.stringify(beforeMap[IPERF_RUN]) === JSON.stringify(afterMap[IPERF_RUN])
  const iperfDl = (afterIter1.data || []).find((e) => afterMap[IPERF_RUN] && e.snapshot_id === afterMap[IPERF_RUN].id)
  push('http_snapshot_immutable', sameHttp, HTTP_RUN)
  push('iperf_snapshot_immutable', sameIperf, IPERF_RUN)
  push(
    'iperf_iter1_dl_kept',
    iperfDl && Number(iperfDl.actual_dl_mbps) >= 6.008 && Number(iperfDl.actual_dl_mbps) <= 6.01,
    `iter1_dl=${iperfDl?.actual_dl_mbps}`,
  )

  const failed = checks.filter((c) => !c.pass)
  writeEvidence('F10C2_CR1D_Auth_Profile_Matrix.json', JSON.stringify({
    checks,
    synthetic_run_id: run?.id || null,
    synthetic_client_run_id: clientRunId,
    synthetic_snapshot: snap.data || null,
    task_iperf_profile: taskIperf.data || null,
    dummy_project_id: DUMMY_PROJECT,
    physical_before: beforePhysical.data || null,
    physical_after: afterPhysical.data || null,
    physical_iter1: iter1.data || afterIter1.data || null,
    failed: failed.map((c) => c.name),
  }, null, 2))
  writeEvidence(
    'F10C2_CR1D_Auth_Profile_Matrix.txt',
    checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ` :: ${c.detail}` : ''}`).join('\n') + `\nfailed=${failed.length}\n`,
  )
  if (failed.length) {
    throw new Error(`matrix_failed:${failed.map((c) => c.name).join(',')}`)
  }
  console.log('CR1-D live profile-management matrix passed')
}

main().catch((error) => {
  console.error(`VALIDATE_CR1D_FAILED: ${redact(error.message || error)}`)
  process.exit(1)
})
