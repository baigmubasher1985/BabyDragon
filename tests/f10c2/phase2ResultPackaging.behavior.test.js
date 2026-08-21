import { describe, it, expect, beforeEach } from 'vitest'
import { installLocalStorageShim, clearLocalStorageShim } from './fixtures/localStorageShim.js'
import {
  PACKAGE_STATES,
  ARTIFACT_STATES,
  canResumePackage,
  isPackageSuccess,
} from '../../src/mobile/rf/submission/resultPackageStates.js'
import {
  MAX_UPLOAD_ATTEMPTS,
  backoffDelayMs,
  backoffDelayMsWithJitter,
  classifyUploadError,
  sanitizeFeError,
  shouldGiveUp,
} from '../../src/mobile/rf/submission/resultRetryPolicy.js'
import {
  evaluateResultAuthGate,
  stripSecretsFromPayload,
  assertNoSecretsInRecord,
} from '../../src/mobile/rf/submission/resultAuthGate.js'
import {
  getOrCreateClientRunId,
  getOrCreateArtifactId,
  buildRunIdentityKey,
  __resetIdStoresForTests,
} from '../../src/mobile/rf/submission/clientRunIdStore.js'
import {
  stripAbsolutePath,
  rejectUnsafePath,
  buildLocalArtifactRecord,
  inferArtifactType,
  computeChecksumHex,
} from '../../src/mobile/rf/submission/artifactLocalDescriptors.js'
import {
  adaptScenarioForSubmission,
} from '../../src/mobile/rf/submission/scenarioResultAdapters.js'
import {
  createMockResultTransport,
  MOCK_FAILURE_MODES,
} from '../../src/mobile/rf/submission/mockResultTransport.js'
import {
  buildResultPackagePayload,
  processResultPackagePayload,
  cancelResultPackageLocally,
  summarizeResultPackage,
  F10C2_MOCK_RESULT_UPLOAD_ENABLED,
} from '../../src/mobile/rf/submission/resultUploadOrchestrator.js'
import {
  enqueueFieldTestResultSubmit,
  cancelQueuedFieldTestResult,
  listFieldTestResultQueueItems,
} from '../../src/mobile/rf/submission/enqueueFieldTestResult.js'
import {
  OFFLINE_ACTION_TYPES,
  readMobileQueue,
  saveMobileQueue,
  MOBILE_QUEUE_STORAGE_KEY,
} from '../../src/mobile/mobileOfflineQueue.js'
import {
  F10C2_SERVER_SUBMIT_ENABLED,
  ARTIFACT_TYPES,
  validateServerSubmissionManifest,
} from '../../src/mobile/rf/reports/serverSubmissionManifest.js'
import { F10C2_UUIDS, makeSession } from './fixtures/syntheticFieldResults.js'

const taskContext = {
  taskId: F10C2_UUIDS.taskAssignedToFeA,
  projectId: F10C2_UUIDS.project,
  gridId: F10C2_UUIDS.grid,
}

beforeEach(() => {
  installLocalStorageShim()
  clearLocalStorageShim()
  __resetIdStoresForTests()
  saveMobileQueue([])
})

describe('phase2 flags', () => {
  it('keeps real server submit OFF and mock packaging ON', () => {
    expect(F10C2_SERVER_SUBMIT_ENABLED).toBe(false)
    expect(F10C2_MOCK_RESULT_UPLOAD_ENABLED).toBe(true)
  })
})

describe('queue reuse — field_test_result_submit extends mobile queue', () => {
  it('adds action type without inventing a third storage key', () => {
    expect(OFFLINE_ACTION_TYPES.FIELD_TEST_RESULT_SUBMIT).toBe('field_test_result_submit')
    expect(MOBILE_QUEUE_STORAGE_KEY).toBe('babydragon_mobile_offline_queue_v1')
    expect(Object.values(OFFLINE_ACTION_TYPES)).toContain('task_update')
    expect(Object.values(OFFLINE_ACTION_TYPES)).toContain('gps_checkpoint')
  })
})

describe('idempotency — client_run_id and artifact_id', () => {
  it('reuses client_run_id for same run identity', () => {
    const key = buildRunIdentityKey({ sessionId: 'session-http-1', taskId: taskContext.taskId })
    const a = getOrCreateClientRunId(key)
    const b = getOrCreateClientRunId(key)
    expect(a.client_run_id).toBe(b.client_run_id)
    expect(b.created).toBe(false)
  })

  it('keeps artifact_id stable across retries', () => {
    const { client_run_id } = getOrCreateClientRunId('session:stable-art')
    const a = getOrCreateArtifactId({
      clientRunId: client_run_id,
      artifactType: ARTIFACT_TYPES.RF_CSV,
      logicalName: 'Report_RF_GPS_Trace.csv',
    })
    const b = getOrCreateArtifactId({
      clientRunId: client_run_id,
      artifactType: ARTIFACT_TYPES.RF_CSV,
      logicalName: 'Report_RF_GPS_Trace.csv',
    })
    expect(a.artifact_id).toBe(b.artifact_id)
  })

  it('merges duplicate enqueue for same client_run_id', async () => {
    const session = makeSession('native_http', {
      id: 'session-merge-1',
      dataTestOutcome: { plannedIterations: 2, completedIterations: 2, failedIterations: 0 },
    })
    const files = [
      { fileName: 'Synthetic_Report.json', mimeType: 'application/json', content: '{"ok":true}' },
    ]
    const first = await enqueueFieldTestResultSubmit({
      session,
      taskContext,
      files,
      ownerUserId: F10C2_UUIDS.feA,
      reportName: 'Synthetic_Report',
    })
    const second = await enqueueFieldTestResultSubmit({
      session,
      taskContext,
      files,
      ownerUserId: F10C2_UUIDS.feA,
      reportName: 'Synthetic_Report',
    })
    expect(first.ok).toBe(true)
    expect(second.reason).toBe('merged_existing')
    expect(second.client_run_id).toBe(first.client_run_id)
    expect(listFieldTestResultQueueItems()).toHaveLength(1)
  })
})

describe('artifact path / mime safety', () => {
  it('strips absolute paths and rejects traversal / URLs', () => {
    expect(stripAbsolutePath('C:/Users/me/Reports/a.csv')).toBe('a.csv')
    expect(rejectUnsafePath('../etc/passwd').ok).toBe(false)
    expect(rejectUnsafePath('https://evil.example/a.csv').ok).toBe(false)
  })

  it('infers types and builds local descriptor without absolute path in server name', async () => {
    const checksum = await computeChecksumHex('a,b\n1,2\n')
    const { client_run_id } = getOrCreateClientRunId('session:art-1')
    const rec = buildLocalArtifactRecord({
      clientRunId: client_run_id,
      fileName: '/sdcard/BabyDragon/Reports/x_RF_GPS_Trace.csv',
      sizeBytes: 8,
      checksum,
    })
    expect(inferArtifactType(rec.original_file_name)).toBe(ARTIFACT_TYPES.RF_CSV)
    expect(rec.original_file_name).toBe('x_RF_GPS_Trace.csv')
    expect(rec.original_file_name.includes('/')).toBe(false)
  })
})

describe('scenario adapters — reuse truth', () => {
  const cases = [
    ['native_http', { appIterationResults: [] }],
    ['ftp', { appIterationResults: [{ id: 1 }] }],
    ['iperf3', { appIterationResults: [] }],
    ['ookla_app', { appOoklaEvidenceIterations: [] }],
    ['fcc_app', { appFccEvidenceIterations: [{ id: 1 }] }],
    ['rf_data', { sampleCount: 0 }],
  ]

  for (const [key, overrides] of cases) {
    it(`adapts ${key} including edge zeros/missing`, () => {
      const session = makeSession(key, {
        ...overrides,
        dataTestOutcome: {
          normalizedStatus: key === 'native_http' ? 'interrupted' : 'complete_with_failures',
          plannedIterations: 3,
          completedIterations: 1,
          failedIterations: 1,
          interrupted: key === 'native_http',
        },
        sampleCount: key === 'rf_data' ? 0 : 4,
        gpsSampleCount: 0,
        voiceEventCount: 0,
        nrMode: 'NR_NSA',
      })
      const adapted = adaptScenarioForSubmission(session)
      expect(adapted.scenario_type).toBe(key === 'ookla_app' || key === 'fcc_app' || key === 'rf_data' ? (
        key === 'rf_data' ? 'rf_data' : key
      ) : key)
      expect(adapted.gps.missing).toBe(true)
      expect(adapted.voice.missing).toBe(true)
      expect(adapted.nr_mode).toBe('NR_NSA')
    })
  }
})

describe('retry policy', () => {
  it('documents backoff + jitter bounds and attempt cap', () => {
    expect(backoffDelayMs(1)).toBe(1000)
    expect(backoffDelayMs(2)).toBe(5000)
    expect(backoffDelayMs(3)).toBe(15000)
    expect(backoffDelayMs(4)).toBe(60000)
    expect(MAX_UPLOAD_ATTEMPTS).toBe(8)
    const j = backoffDelayMsWithJitter(1, () => 0)
    expect(j).toBeGreaterThanOrEqual(250)
    expect(j).toBeLessThanOrEqual(1000)
  })

  it('classifies retryable vs permanent and sanitizes secrets', () => {
    expect(classifyUploadError({ code: 'network' }).kind).toBe('retryable')
    expect(classifyUploadError({ code: 'checksum_mismatch' }).kind).toBe('permanent')
    expect(shouldGiveUp({ attempts: 8, classification: { kind: 'retryable' } })).toBe(true)
    const sanitized = sanitizeFeError('Authorization: Bearer SYNTHETIC_TOKEN_NOT_A_SECRET failed with refresh_token=SYNTHETIC')
    expect(sanitized.toLowerCase()).not.toContain('synthetic_token_not_a_secret')
    expect(sanitized.toLowerCase()).toContain('[redacted]')
  })
})

describe('auth gate', () => {
  it('blocks when signed out and rejects owner mismatch', () => {
    expect(evaluateResultAuthGate({ currentUser: null }).state).toBe(PACKAGE_STATES.BLOCKED_AUTH)
    expect(
      evaluateResultAuthGate({
        currentUser: { id: F10C2_UUIDS.feB },
        queuedOwnerUserId: F10C2_UUIDS.feA,
      }).code,
    ).toBe('owner_mismatch')
  })

  it('strips tokens from payloads', () => {
    const cleaned = stripSecretsFromPayload({
      client_run_id: 'x',
      access_token: 'secret',
      refresh_token: 'secret',
      headers: { Authorization: 'Bearer x', Accept: 'application/json' },
    })
    expect(cleaned.access_token).toBeUndefined()
    expect(cleaned.headers.Authorization).toBeUndefined()
    expect(assertNoSecretsInRecord({ note: 'no tokens here' }).ok).toBe(true)
    // assertNoSecretsInRecord looks for jwt-like / bearer / service_role key material shapes
    expect(assertNoSecretsInRecord({ blob: 'Bearer SYNTHETIC_LONG_TOKEN_VALUE_ABCDEF' }).ok).toBe(false)
  })
})

describe('mock transport + orchestrator', () => {
  async function buildPkg(sessionOverrides = {}) {
    const session = makeSession('native_http', {
      id: 'session-orch-1',
      dataTestOutcome: { plannedIterations: 1, completedIterations: 1, failedIterations: 0 },
      ...sessionOverrides,
    })
    const checksum = await computeChecksumHex('{"ok":1}')
    const { client_run_id } = getOrCreateClientRunId(`session:${session.id}`)
    const localArtifacts = [
      buildLocalArtifactRecord({
        clientRunId: client_run_id,
        fileName: 'Synthetic_Report.json',
        sizeBytes: 8,
        checksum,
      }),
    ]
    return buildResultPackagePayload({
      clientRunId: client_run_id,
      session,
      taskContext,
      localArtifacts,
      ownerUserId: F10C2_UUIDS.feA,
      reportName: 'Synthetic_Report',
    })
  }

  it('uploads successfully through finalize (mock)', async () => {
    const transport = createMockResultTransport()
    let pkg = await buildPkg()
    pkg.package_state = PACKAGE_STATES.QUEUED
    expect(validateServerSubmissionManifest(pkg.manifest).ok).toBe(true)

    const result = await processResultPackagePayload(pkg, {
      transport,
      currentUser: { id: F10C2_UUIDS.feA },
      rng: () => 0.5,
    })
    expect(result.payload.package_state).toBe(PACKAGE_STATES.UPLOADED)
    expect(result.keep).toBe(false)
    expect(isPackageSuccess(result.payload.package_state)).toBe(true)
  })

  it('handles duplicate registration idempotently', async () => {
    const transport = createMockResultTransport({
      defaultFailureMode: MOCK_FAILURE_MODES.DUPLICATE_REGISTRATION,
    })
    let pkg = await buildPkg()
    pkg.package_state = PACKAGE_STATES.QUEUED
    const result = await processResultPackagePayload(pkg, {
      transport,
      currentUser: { id: F10C2_UUIDS.feA },
      rng: () => 0.5,
    })
    // Duplicate mode returns idempotent register then continues upload path
    expect([PACKAGE_STATES.UPLOADED, PACKAGE_STATES.REGISTERED, PACKAGE_STATES.UPLOADING, PACKAGE_STATES.FINALIZING, PACKAGE_STATES.RETRY_WAIT]).toContain(result.payload.package_state)
  })

  it('enters blocked_auth on expired auth', async () => {
    const transport = createMockResultTransport({
      defaultFailureMode: MOCK_FAILURE_MODES.EXPIRED_AUTH,
    })
    let pkg = await buildPkg()
    pkg.package_state = PACKAGE_STATES.QUEUED
    const result = await processResultPackagePayload(pkg, {
      transport,
      currentUser: { id: F10C2_UUIDS.feA },
      rng: () => 0.5,
    })
    expect(result.payload.package_state).toBe(PACKAGE_STATES.BLOCKED_AUTH)
    expect(canResumePackage(result.payload.package_state)).toBe(true)
  })

  it('classifies retryable network into retry_wait', async () => {
    const transport = createMockResultTransport({
      defaultFailureMode: MOCK_FAILURE_MODES.RETRYABLE_NETWORK,
    })
    let pkg = await buildPkg()
    pkg.package_state = PACKAGE_STATES.QUEUED
    const result = await processResultPackagePayload(pkg, {
      transport,
      currentUser: { id: F10C2_UUIDS.feA },
      rng: () => 0.5,
    })
    expect(result.payload.package_state).toBe(PACKAGE_STATES.RETRY_WAIT)
    expect(result.payload.next_attempt_at).toBeTruthy()
  })

  it('marks permanent validation failures', async () => {
    const transport = createMockResultTransport({
      defaultFailureMode: MOCK_FAILURE_MODES.PERMANENT_VALIDATION,
    })
    let pkg = await buildPkg()
    pkg.package_state = PACKAGE_STATES.QUEUED
    const result = await processResultPackagePayload(pkg, {
      transport,
      currentUser: { id: F10C2_UUIDS.feA },
      rng: () => 0.5,
    })
    expect(result.payload.package_state).toBe(PACKAGE_STATES.FAILED_PERMANENT)
  })

  it('survives interrupted artifact as partial / retry', async () => {
    const transport = createMockResultTransport({
      scriptedFailures: {
        'registerResult:1': MOCK_FAILURE_MODES.NONE,
        'requestArtifactUpload:1': MOCK_FAILURE_MODES.NONE,
        'uploadArtifact:1': MOCK_FAILURE_MODES.INTERRUPTED_ARTIFACT,
      },
    })
    let pkg = await buildPkg()
    pkg.package_state = PACKAGE_STATES.QUEUED
    const result = await processResultPackagePayload(pkg, {
      transport,
      currentUser: { id: F10C2_UUIDS.feA },
      rng: () => 0.5,
    })
    expect([PACKAGE_STATES.PARTIALLY_UPLOADED, PACKAGE_STATES.RETRY_WAIT]).toContain(result.payload.package_state)
  })

  it('cancel keeps local-only state without deleting report truth', async () => {
    let pkg = await buildPkg()
    const cancelled = cancelResultPackageLocally(pkg)
    expect(cancelled.package_state).toBe(PACKAGE_STATES.CANCELLED_LOCAL_ONLY)
    expect(cancelled.manifest.report_name).toBeTruthy()
    expect(summarizeResultPackage(cancelled).is_uploaded).toBe(false)
  })

  it('does not resubmit completed packages', async () => {
    const session = makeSession('rf_data', { id: 'session-done-1', sampleCount: 2 })
    const files = [{ fileName: 'RF_Report.json', mimeType: 'application/json', content: '{}' }]
    const queued = await enqueueFieldTestResultSubmit({
      session,
      taskContext,
      files,
      ownerUserId: F10C2_UUIDS.feA,
    })
    const items = readMobileQueue()
    const item = items.find((i) => i.id === queued.queue_item_id)
    item.payload.package_state = PACKAGE_STATES.UPLOADED
    saveMobileQueue([item])

    const again = await enqueueFieldTestResultSubmit({
      session,
      taskContext,
      files,
      ownerUserId: F10C2_UUIDS.feA,
    })
    expect(again.reason).toBe('already_uploaded_no_resubmit')
  })

  it('cancelQueuedFieldTestResult marks cancelled_local_only', async () => {
    const session = makeSession('ftp', { id: 'session-cancel-1' })
    const queued = await enqueueFieldTestResultSubmit({
      session,
      taskContext,
      files: [{ fileName: 'a.csv', mimeType: 'text/csv', content: 'a' }],
      ownerUserId: F10C2_UUIDS.feA,
    })
    const res = cancelQueuedFieldTestResult(queued.client_run_id)
    expect(res.ok).toBe(true)
    expect(listFieldTestResultQueueItems()[0].summary.package_state).toBe(
      PACKAGE_STATES.CANCELLED_LOCAL_ONLY,
    )
  })
})

describe('artifact states enum', () => {
  it('exposes required artifact states', () => {
    expect(ARTIFACT_STATES.PENDING).toBe('pending')
    expect(ARTIFACT_STATES.MISSING_LOCAL).toBe('missing_local')
    expect(ARTIFACT_STATES.UPLOADED).toBe('uploaded')
  })
})
