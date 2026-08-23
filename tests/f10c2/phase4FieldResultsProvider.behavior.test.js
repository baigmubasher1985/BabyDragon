import { describe, it, expect, vi } from 'vitest'
import { createSupabaseFieldResultsProvider } from '../../src/fieldResults/repository/supabaseFieldResultsProvider.js'
import { mapFieldTestRunRow } from '../../src/fieldResults/repository/mapFieldTestRunRow.js'

function chainFor(rows) {
  const listResult = { data: rows, error: null }
  const oneResult = { data: rows[0] || null, error: null }
  const api = {
    select: () => api,
    in: async () => listResult,
    eq: () => api,
    order: () => api,
    limit: async () => listResult,
    maybeSingle: async () => oneResult,
    insert: () => api,
    single: async () => oneResult,
  }
  return api
}

function createFakeClient({
  runs = [],
  artifacts = [],
  reviews = [],
  tasks = [],
  projects = [],
  grids = [],
  profiles = [],
  rpcImpl,
  signedUrl = 'https://signed.example.invalid/artifact?token=redacted',
  signedError = null,
  sessionRole = 'admin',
} = {}) {
  const tables = {
    field_test_runs: runs,
    field_test_artifacts: artifacts,
    field_test_qc_reviews: reviews,
    tasks,
    projects,
    grids,
    profiles,
  }
  return {
    from(table) {
      return chainFor(tables[table] || [])
    },
    rpc: rpcImpl || vi.fn(async () => ({ data: { qc_decision: 'QC Passed' }, error: null })),
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn(async () => ({
          data: signedError ? null : { signedUrl },
          error: signedError,
        })),
      })),
    },
    __role: sessionRole,
  }
}

const runRow = {
  id: 'run-1',
  client_run_id: 'client-1',
  task_id: 'task-1',
  project_id: 'proj-1',
  grid_id: 'grid-1',
  submitted_by: 'fe-1',
  scenario_type: 'native_http',
  run_status: 'ready',
  processing_status: 'ready',
  report_name: 'SYN-HTTP-001',
  started_at_device: '2026-08-20T10:00:00.000Z',
  ended_at_device: '2026-08-20T10:05:00.000Z',
  device_model: 'Pixel',
  app_version: '0.0.0-phase4',
  build_number: 'p4',
  rf_summary: { sample_count: 12, serving_rsrp_avg: -97 },
  data_summary: { field_status: 'success', scenarios: [{ attempt_counts: { planned: 5, completed: 5, failed: 0 } }] },
  gps_summary: { sample_count: 8 },
  events_summary: {},
  latest_qc_status: null,
}

describe('f10c2 phase4 — field results supabase provider', () => {
  it('does not coerce missing RF metrics to zero', () => {
    const mapped = mapFieldTestRunRow({
      run: {
        ...runRow,
        rf_summary: { notes: 'rf present, averages unavailable' },
        data_summary: {},
      },
      artifacts: [],
    })
    expect(mapped.rf_summary.serving_rsrp_avg).toBeUndefined()
    expect(mapped.attempt_counts.completed).toBeNull()
    expect(mapped.latest_qc_status).toBe('Waiting for Review')
  })

  it('lists hydrated rows and opens signed artifact access', async () => {
    const artifact = {
      id: 'art-1',
      run_id: 'run-1',
      artifact_type: 'unified_json',
      original_file_name: 'report.json',
      mime_type: 'application/json',
      size_bytes: 12,
      checksum: 'sha256:x',
      upload_status: 'complete',
      bucket: 'result-artifacts',
      object_key: 'proj-1/task-1/fe-1/run-1/art-1.json',
    }
    const supabase = createFakeClient({
      runs: [runRow],
      artifacts: [artifact],
      tasks: [{ id: 'task-1', title: 'Task SYN', market: 'SYN' }],
      projects: [{ id: 'proj-1', name: 'Project SYN' }],
      grids: [{ id: 'grid-1', name: 'Grid SYN' }],
      profiles: [{ id: 'fe-1', email: 'fe.syn@example.invalid', full_name: 'FE Syn' }],
    })
    const provider = createSupabaseFieldResultsProvider({ supabase })
    const list = await provider.listFieldResults({}, { page: 1, pageSize: 10 })
    expect(list.ok).toBe(true)
    expect(list.rows[0].scenario_type).toBe('native_http')
    expect(list.rows[0].upload_state).toBe('uploaded')

    const access = await provider.requestArtifactAccess('run-1', 'art-1', { role: 'admin' })
    expect(access.ok).toBe(true)
    expect(access.access.mode).toBe('signed_url')
    expect(access.access.public_url).toBeNull()
    expect(access.access.signed_url).toBeTruthy()
  })

  it('blocks FE from saving QC via client gate', async () => {
    const supabase = createFakeClient({ runs: [runRow] })
    const provider = createSupabaseFieldResultsProvider({ supabase })
    const res = await provider.saveResultQcDecision(
      'run-1',
      { decision: 'QC Passed' },
      { id: 'fe-1', role: 'fe' },
    )
    expect(res.ok).toBe(false)
    expect(res.error.code).toBe('forbidden_role')
  })

  it('prevents duplicate re-drive when linkage already exists', async () => {
    const supabase = createFakeClient({
      runs: [{ ...runRow, latest_qc_status: 'Needs Re-drive' }],
      reviews: [
        {
          id: 'qc-1',
          field_test_run_id: 'run-1',
          qc_decision: 'Needs Re-drive',
          redrive_needed: true,
          redrive_task_id: 'task-redrive-1',
          redrive_reason: 'need another drive',
          reviewer_id: 'adm-1',
          reviewed_at: '2026-08-21T00:00:00.000Z',
        },
      ],
    })
    const provider = createSupabaseFieldResultsProvider({ supabase })
    const res = await provider.createOrLinkRedrive('run-1', 'need another drive', {
      id: 'adm-1',
      role: 'admin',
    })
    expect(res.ok).toBe(true)
    expect(res.idempotent).toBe(true)
    expect(res.redrive_task_id).toBe('task-redrive-1')
  })
})
