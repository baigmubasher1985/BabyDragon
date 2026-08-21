/**
 * Synthetic F10C2 field-result fixtures — synthetic UUIDs only.
 */

import { SYNTHETIC_UUIDS, ACTORS, isActiveFailClosed, isAdminOrSuperAdmin } from '../../security/fixtures/syntheticActors.js'
import { TASKS, isAssignedToTask } from '../../security/fixtures/syntheticTasks.js'

export { SYNTHETIC_UUIDS, ACTORS, TASKS, isActiveFailClosed, isAdminOrSuperAdmin, isAssignedToTask }

export const RESULT_BUCKET = 'result-artifacts'
export const OPS_BUCKET = 'operational-evidence'
export const LEGACY_BUCKET = 'task-photos'

export const F10C2_UUIDS = {
  ...SYNTHETIC_UUIDS,
  clientRun: '88888888-8888-4888-8888-888888888888',
  fieldTestRun: '99999999-9999-4999-8999-999999999999',
  artifactA: 'aaaa1111-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  artifactB: 'bbbb2222-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  redriveTask: 'cccc3333-cccc-4ccc-8ccc-cccccccccccc',
}

export const QC_DECISIONS = Object.freeze([
  'QC Passed',
  'QC Failed',
  'Needs Re-drive',
  'Waiting for Logs',
  'Log Naming Issue',
  'Missing Evidence',
])

export const SCENARIO_TYPES = Object.freeze([
  'native_http',
  'ftp',
  'iperf3',
  'ookla_app',
  'fcc_app',
  'rf_data',
  'unified_field_report',
])

export function makeSession(scenarioKey, overrides = {}) {
  const engineMap = {
    native_http: { appEngineId: 'native_http', appTestType: 'http' },
    ftp: { appEngineId: 'ftp', appTestType: 'ftp' },
    iperf3: { appEngineId: 'iperf3', appTestType: 'iperf3' },
    ookla_app: { appEngineId: 'ookla_external', appTestType: 'ookla', appOoklaEvidenceIterations: [{ id: 1 }] },
    fcc_app: { appEngineId: 'fcc_external', appTestType: 'fcc', appFccEvidenceIterations: [{ id: 1 }] },
    rf_data: { appEngineId: 'rf_only' },
  }
  const base = engineMap[scenarioKey] || engineMap.rf_data
  return {
    id: `session-${scenarioKey}`,
    startedAt: '2026-08-01T12:00:00.000Z',
    endedAt: '2026-08-01T12:15:00.000Z',
    reportLogName: `Synthetic_${scenarioKey}_Report`,
    ...base,
    ...overrides,
  }
}

export const MAX_RESULT_BYTES = 100 * 1024 * 1024
export const ALLOWED_RESULT_MIME = Object.freeze([
  'application/json',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'application/octet-stream',
  'image/jpeg',
  'image/png',
])

export function acceptsResultUpload({ mime, sizeBytes }) {
  if (!ALLOWED_RESULT_MIME.includes(mime)) return false
  if (typeof sizeBytes !== 'number' || sizeBytes < 0) return false
  if (sizeBytes > MAX_RESULT_BYTES) return false
  return true
}

/**
 * Pure in-memory ownership gate mirroring RPC fail-closed rules.
 */
export function evaluateRunSubmitAccess({ actor, taskId, clientSuppliedSubmittedBy = null }) {
  if (!actor?.id) return { ok: false, reason: 'not_authenticated' }
  if (!isActiveFailClosed(actor)) return { ok: false, reason: 'forbidden_inactive_or_not_fe' }
  if (actor.role !== 'fe') return { ok: false, reason: 'forbidden_inactive_or_not_fe' }
  const task =
    Object.values(TASKS).find((t) => t.id === taskId) || { id: taskId, assigned_to: null }
  if (!isAssignedToTask(actor.id, task)) return { ok: false, reason: 'not_assigned' }
  // Client-supplied submitted_by is never authoritative — RPC forces auth.uid().
  const forgedIgnored =
    clientSuppliedSubmittedBy != null && clientSuppliedSubmittedBy !== actor.id
  return {
    ok: true,
    submitted_by: actor.id,
    reason: forgedIgnored ? 'authorized_forged_submitted_by_ignored' : 'authorized',
  }
}

export function evaluateQcWriteAccess({ actor, decision }) {
  if (!isAdminOrSuperAdmin(actor)) return { ok: false, reason: 'forbidden_not_qc_admin' }
  if (!QC_DECISIONS.includes(decision)) return { ok: false, reason: 'invalid_qc_decision' }
  return { ok: true, reason: 'authorized' }
}

/**
 * In-memory idempotent run registry for contract tests.
 */
export function createRunRegistry() {
  const byClientRunId = new Map()
  return {
    submit({ clientRunId, actor, taskId, projectId, scenarioType }) {
      const access = evaluateRunSubmitAccess({ actor, taskId })
      if (!access.ok) return access
      const existing = byClientRunId.get(clientRunId)
      if (existing) {
        if (existing.submitted_by !== actor.id) {
          return { ok: false, reason: 'client_run_id_owned_by_other' }
        }
        return { ok: true, reason: 'idempotent_success', row: existing }
      }
      const row = {
        id: F10C2_UUIDS.fieldTestRun,
        client_run_id: clientRunId,
        task_id: taskId,
        project_id: projectId,
        submitted_by: actor.id,
        scenario_type: scenarioType,
      }
      byClientRunId.set(clientRunId, row)
      return { ok: true, reason: 'created', row }
    },
    get(clientRunId) {
      return byClientRunId.get(clientRunId) || null
    },
  }
}

export function createArtifactRegistry() {
  const byKey = new Map()
  const byChecksum = new Map()
  return {
    register({ runId, artifactId, artifactType, objectKey, checksum, actor, runOwnerId }) {
      if (actor.id !== runOwnerId) return { ok: false, reason: 'not_run_owner' }
      const ck = `${runId}|${artifactType}|${checksum}`
      if (byChecksum.has(ck)) {
        return { ok: true, reason: 'idempotent_success', row: byChecksum.get(ck) }
      }
      if (byKey.has(objectKey)) {
        const existing = byKey.get(objectKey)
        if (existing.checksum !== checksum) {
          return { ok: false, reason: 'object_key_checksum_conflict' }
        }
        return { ok: true, reason: 'idempotent_success', row: existing }
      }
      const row = { id: artifactId, run_id: runId, artifact_type: artifactType, object_key: objectKey, checksum, upload_status: 'pending' }
      byKey.set(objectKey, row)
      byChecksum.set(ck, row)
      return { ok: true, reason: 'created', row }
    },
    complete({ artifactId, checksum, rows }) {
      const row = rows.find((r) => r.id === artifactId)
      if (!row) return { ok: false, reason: 'artifact_not_found' }
      if (row.checksum !== checksum) return { ok: false, reason: 'checksum_mismatch' }
      if (row.upload_status === 'complete') return { ok: true, reason: 'idempotent_success', row }
      row.upload_status = 'complete'
      return { ok: true, reason: 'completed', row }
    },
  }
}

export function mapDashboardRow(run, { artifactCount = 0, qc = null } = {}) {
  return {
    run_id: run.id,
    client_run_id: run.client_run_id,
    task_id: run.task_id,
    project_id: run.project_id,
    grid_id: run.grid_id || null,
    scenario_type: run.scenario_type,
    report_name: run.report_name || null,
    run_status: run.run_status || 'submitted',
    processing_status: run.processing_status || 'pending',
    latest_qc_status: qc?.qc_decision || run.latest_qc_status || null,
    submitted_by: run.submitted_by,
    created_at: run.created_at || null,
    artifact_count: artifactCount,
    redrive_needed: Boolean(qc?.redrive_needed),
  }
}

export function backoffDelayMs(attempt) {
  const table = { 1: 1000, 2: 5000, 3: 15000 }
  if (attempt <= 0) return 1000
  if (attempt >= 4) return 60000
  return table[attempt]
}

export const MAX_UPLOAD_ATTEMPTS = 8
