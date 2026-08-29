/**
 * F10C2 CR1-B — live auth/QC/ingest matrix on disposable. Never prints secrets.
 * Creates a NEW synthetic run only; does not modify preserved morning packages.
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
const EVIDENCE = path.join(ROOT, '..', 'Audit Data', 'F10C2', 'CR1-B')
const require = createRequire(path.join(ROOT, 'package.json'))
const { createClient } = require('@supabase/supabase-js')

const TASK_ID = 'cb59c40d-cd14-49aa-8b97-54aa5812bc82'
const TASK_TITLE = 'F10C2-P4BU-E2E'
const FE_EMAIL = 'fe.synthetic.f10c2@invalid.test'
const ADMIN_EMAIL = 'admin.synthetic.f10c2@invalid.test'
const SA_EMAIL = 'sa.synthetic.f10c2@invalid.test'

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

  const anonProfile = await anon.rpc('upsert_acceptance_profile', {
    p_scope_type: 'tenant',
    p_scope_id: null,
    p_tenant_id: null,
    p_name: 'anon-should-fail',
    p_is_default: true,
    p_rules: { dl_ul: { min_dl_mbps: 1 } },
  })
  push('anon_profile_upsert_denied', Boolean(anonProfile.error), anonProfile.error?.message || 'unexpected success')

  const feProfile = await fe.c.rpc('upsert_acceptance_profile', {
    p_scope_type: 'tenant',
    p_scope_id: null,
    p_tenant_id: null,
    p_name: 'fe-should-fail',
    p_is_default: true,
    p_rules: { dl_ul: { min_dl_mbps: 1 } },
  })
  push('fe_profile_upsert_denied', Boolean(feProfile.error), feProfile.error?.message || 'unexpected success')

  const adminProfile = await admin.c.rpc('upsert_acceptance_profile', {
    p_scope_type: 'tenant',
    p_scope_id: null,
    p_tenant_id: null,
    p_name: 'CR1-B disposable default',
    p_is_default: true,
    p_rules: {
      dl_ul: {
        enabled_directions: ['dl', 'ul'],
        combine_mode: 'AND',
        min_dl_mbps: 50,
        min_ul_mbps: 5,
        required_completed_iterations: 1,
      },
      mo_mt: {
        enabled_directions: ['MO', 'MT'],
        combine_mode: 'AND',
        required_mo_success: 1,
        required_mt_success: 1,
      },
    },
  })
  push('admin_profile_upsert', !adminProfile.error && Boolean(adminProfile.data?.id), adminProfile.error?.message || `version=${adminProfile.data?.version}`)

  const saProfile = await sa.c.rpc('upsert_acceptance_profile', {
    p_scope_type: 'tenant',
    p_scope_id: null,
    p_tenant_id: null,
    p_name: 'CR1-B disposable default',
    p_is_default: true,
    p_rules: {
      dl_ul: {
        enabled_directions: ['dl', 'ul'],
        combine_mode: 'AND',
        min_dl_mbps: 50,
        min_ul_mbps: 5,
        required_completed_iterations: 1,
      },
      mo_mt: { enabled_directions: ['MO'], required_mo_success: 1, required_mt_success: 0 },
    },
  })
  push('sa_profile_upsert_version_bump', !saProfile.error && Number(saProfile.data?.version) >= 1, saProfile.error?.message || `version=${saProfile.data?.version}`)

  const task = await fe.c.from('tasks').select('id,title,project_id').eq('id', TASK_ID).maybeSingle()
  push('fe_synthetic_task', !task.error && task.data?.title === TASK_TITLE, task.error?.message || task.data?.title || '')

  const clientRunId = randomUUID()
  const idem = `cr1b-synth:${clientRunId}`
  const submitted = await fe.c.rpc('submit_field_test_run', {
    p_client_run_id: clientRunId,
    p_task_id: TASK_ID,
    p_project_id: task.data?.project_id,
    p_scenario_type: 'iperf3',
    p_report_name: 'CR1-B-SYNTH-NEW-RUN',
    p_data_summary: { scenarios: [{ attempt_counts: { planned: 1, completed: 1, failed: 0 } }] },
  })
  const run = Array.isArray(submitted.data) ? submitted.data[0] : submitted.data
  push('fe_submit_new_synthetic_run', !submitted.error && Boolean(run?.id), submitted.error?.message || '')

  const payload = {
    package_identity: `pkg:${clientRunId}`,
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
  push('fe_ingest', !ingest1.error, ingest1.error?.message || '')

  const ingest2 = await fe.c.rpc('ingest_field_test_canonical_result', {
    p_run_id: run?.id,
    p_idempotency_key: idem,
    p_payload: payload,
  })
  push('fe_ingest_idempotent', !ingest2.error, ingest2.error?.message || '')

  const reuse = await fe.c.rpc('ingest_field_test_canonical_result', {
    p_run_id: run?.id,
    p_idempotency_key: idem,
    p_payload: { ...payload, package_identity: 'other-package' },
  })
  const otherRun = await fe.c.rpc('submit_field_test_run', {
    p_client_run_id: randomUUID(),
    p_task_id: TASK_ID,
    p_project_id: task.data?.project_id,
    p_scenario_type: 'iperf3',
    p_report_name: 'CR1-B-SYNTH-OTHER',
  })
  const other = Array.isArray(otherRun.data) ? otherRun.data[0] : otherRun.data
  const reuseOther = await fe.c.rpc('ingest_field_test_canonical_result', {
    p_run_id: other?.id,
    p_idempotency_key: idem,
    p_payload: payload,
  })
  push('idempotency_key_reuse_rejected', Boolean(reuseOther.error), reuseOther.error?.message || reuse.error?.message || 'no error')

  const snap = await admin.c.from('field_test_run_acceptance_snapshots').select('run_id,profile_version,overall_verdict,dl_verdict,ul_verdict').eq('run_id', run?.id).maybeSingle()
  push('admin_snapshot_visible', !snap.error && ['PASS', 'FAIL', 'INCOMPLETE', 'NOT_EVALUATED'].includes(snap.data?.overall_verdict), snap.error?.message || snap.data?.overall_verdict || '')

  const evals = await admin.c.from('field_test_iteration_evaluations').select('iteration_number,actual_dl_mbps,dl_verdict,actual_ul_mbps,ul_verdict,overall_verdict').eq('snapshot_id', snap.data ? undefined : '00000000-0000-0000-0000-000000000000')
  const evalsByRun = await admin.c
    .from('field_test_run_acceptance_snapshots')
    .select('id, field_test_iteration_evaluations(iteration_number,actual_dl_mbps,dl_threshold,dl_verdict,actual_ul_mbps,ul_threshold,ul_verdict,overall_verdict)')
    .eq('run_id', run?.id)
    .maybeSingle()
  void evals
  push(
    'admin_iteration_drilldown',
    !evalsByRun.error && Array.isArray(evalsByRun.data?.field_test_iteration_evaluations) && evalsByRun.data.field_test_iteration_evaluations.length >= 1,
    evalsByRun.error?.message || `n=${evalsByRun.data?.field_test_iteration_evaluations?.length || 0}`,
  )

  const feQc = await fe.c.rpc('submit_field_test_qc_review', {
    p_field_test_run_id: run?.id,
    p_qc_decision: 'QC Passed',
    p_qc_notes: 'fe should fail',
  })
  push('fe_qc_denied', Boolean(feQc.error), feQc.error?.message || 'unexpected success')

  const anonQc = await anon.rpc('submit_field_test_qc_review', {
    p_field_test_run_id: run?.id,
    p_qc_decision: 'QC Passed',
  })
  push('anon_qc_denied', Boolean(anonQc.error), anonQc.error?.message || 'unexpected success')

  const adminQc = await admin.c.rpc('submit_field_test_qc_review', {
    p_field_test_run_id: run?.id,
    p_qc_decision: 'QC Passed',
    p_qc_notes: 'CR1-B synthetic QC persist',
  })
  push('admin_qc_saved', !adminQc.error, adminQc.error?.message || '')
  const qcReload = await admin.c.from('field_test_qc_reviews').select('qc_decision,qc_notes').eq('field_test_run_id', run?.id).maybeSingle()
  push('admin_qc_reload', !qcReload.error && qcReload.data?.qc_decision === 'QC Passed', qcReload.error?.message || qcReload.data?.qc_decision || '')

  const feOverride = await fe.c.rpc('override_field_test_acceptance_verdict', {
    p_run_id: run?.id,
    p_override_verdict: 'FAIL',
    p_reason: 'fe should fail',
  })
  push('fe_override_denied', Boolean(feOverride.error), feOverride.error?.message || 'unexpected success')

  const adminOverride = await admin.c.rpc('override_field_test_acceptance_verdict', {
    p_run_id: run?.id,
    p_override_verdict: 'FAIL',
    p_reason: 'customer dispute synthetic',
  })
  push('admin_override_saved', !adminOverride.error, adminOverride.error?.message || '')
  const ovReload = await admin.c.from('qc_verdict_overrides').select('computed_verdict,override_verdict,reason').eq('run_id', run?.id).maybeSingle()
  push(
    'override_preserves_computed',
    !ovReload.error && ovReload.data?.override_verdict === 'FAIL' && Boolean(ovReload.data?.computed_verdict),
    ovReload.error?.message || `${ovReload.data?.computed_verdict}->${ovReload.data?.override_verdict}`,
  )

  const feRuns = await fe.c.from('field_test_runs').select('id,report_name,submitted_by')
  const leaked = (feRuns.data || []).filter((r) => r.submitted_by && r.submitted_by !== fe.userId)
  push('fe_cross_owner_runs_hidden', leaked.length === 0, `leaked=${leaked.length}`)

  const failed = checks.filter((c) => !c.pass)
  writeEvidence('F10C2_CR1B_Auth_QC_Ingest_Matrix.json', JSON.stringify({
    checks,
    synthetic_run_id: run?.id || null,
    synthetic_client_run_id: clientRunId,
    snapshot: snap.data || null,
    failed: failed.map((c) => c.name),
  }, null, 2))
  writeEvidence(
    'F10C2_CR1B_Auth_QC_Ingest_Matrix.txt',
    checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ` :: ${c.detail}` : ''}`).join('\n') + `\nfailed=${failed.length}\n`,
  )
  if (failed.length) {
    throw new Error(`matrix_failed:${failed.map((c) => c.name).join(',')}`)
  }
  console.log('CR1-B live auth/QC/ingest matrix passed')
}

main().catch((error) => {
  console.error(`VALIDATE_CR1B_MATRIX_FAILED: ${redact(error.message || error)}`)
  process.exit(1)
})
