import { describe, it, expect } from 'vitest'
import {
  SCENARIO_KEYS,
  resolveScenarioKey,
} from '../../src/mobile/rf/reports/scenarioReportModel.js'
import {
  F10C2_SERVER_SUBMIT_ENABLED,
  SERVER_SUBMISSION_MANIFEST_SCHEMA_VERSION,
  ARTIFACT_TYPES,
  RESULT_ARTIFACTS_BUCKET,
  buildServerSubmissionManifest,
  validateServerSubmissionManifest,
  buildArtifactDescriptor,
  buildResultArtifactObjectKey,
  durableArtifactRef,
} from '../../src/mobile/rf/reports/serverSubmissionManifest.js'
import {
  F10C2_UUIDS,
  SCENARIO_TYPES,
  makeSession,
} from './fixtures/syntheticFieldResults.js'

const taskContext = {
  taskId: F10C2_UUIDS.taskAssignedToFeA,
  projectId: F10C2_UUIDS.project,
  gridId: F10C2_UUIDS.grid,
}

describe('serverSubmissionManifest — feature flag', () => {
  it('keeps F10C2_SERVER_SUBMIT disabled by default', () => {
    expect(F10C2_SERVER_SUBMIT_ENABLED).toBe(false)
  })
})

describe('serverSubmissionManifest — scenario families', () => {
  const cases = [
    ['native_http', SCENARIO_KEYS.NATIVE_HTTP],
    ['ftp', SCENARIO_KEYS.FTP],
    ['iperf3', SCENARIO_KEYS.IPERF3],
    ['ookla_app', SCENARIO_KEYS.OOKLA],
    ['fcc_app', SCENARIO_KEYS.FCC],
    ['rf_data', SCENARIO_KEYS.RF_ONLY],
  ]

  for (const [label, expectedKey] of cases) {
    it(`builds manifest for ${label}`, () => {
      const session = makeSession(label)
      expect(resolveScenarioKey(session)).toBe(expectedKey)
      const manifest = buildServerSubmissionManifest({
        clientRunId: F10C2_UUIDS.clientRun,
        session,
        taskContext,
        device: { model: 'SyntheticPhone', appVersion: '0.0.0-test', buildNumber: '1' },
        network: { rat: 'LTE', operator: 'SyntheticCarrier' },
      })
      expect(manifest.schema_version).toBe(SERVER_SUBMISSION_MANIFEST_SCHEMA_VERSION)
      expect(manifest.scenario_type).toBe(expectedKey)
      expect(manifest.client_run_id).toBe(F10C2_UUIDS.clientRun)
      expect(manifest.ownership.submitted_by_client_supplied).toBeNull()
      expect(validateServerSubmissionManifest(manifest).ok).toBe(true)
    })
  }

  it('builds unified_field_report when multiple scenarios present', () => {
    const manifest = buildServerSubmissionManifest({
      clientRunId: F10C2_UUIDS.clientRun,
      unifiedReport: {
        reportKind: 'unified_field_report',
        scenarios: [
          { session: makeSession('native_http'), scenarioKey: 'native_http' },
          { session: makeSession('rf_data'), scenarioKey: 'rf_data' },
        ],
      },
      taskContext,
    })
    expect(manifest.scenario_type).toBe('unified_field_report')
    expect(manifest.data_summary.scenario_count).toBe(2)
    expect(SCENARIO_TYPES).toContain('unified_field_report')
  })
})

describe('serverSubmissionManifest — partial / failed / missing optional', () => {
  it('allows RF-only with empty data metrics', () => {
    const manifest = buildServerSubmissionManifest({
      clientRunId: F10C2_UUIDS.clientRun,
      session: makeSession('rf_data', { appIterationResults: [] }),
      taskContext,
    })
    expect(manifest.scenario_type).toBe(SCENARIO_KEYS.RF_ONLY)
    expect(manifest.data_summary.scenarios[0].attempt_counts.failed).toBeNull()
    expect(validateServerSubmissionManifest(manifest).ok).toBe(true)
  })

  it('captures failed / partial failure truth without inventing KPIs', () => {
    const session = makeSession('native_http', {
      dataTestOutcome: {
        normalizedStatus: 'complete_with_failures',
        plannedIterations: 5,
        completedIterations: 3,
        failedIterations: 2,
        conciseReason: 'Two HTTP iterations failed',
        failureTruth: 'iteration_timeout',
      },
    })
    const manifest = buildServerSubmissionManifest({
      clientRunId: F10C2_UUIDS.clientRun,
      session,
      taskContext,
    })
    const failure = manifest.data_summary.scenarios[0].failure_truth
    expect(failure.normalizedStatus).toBe('complete_with_failures')
    expect(failure.failedIterations).toBe(2)
    expect(failure.conciseReason).toContain('failed')
  })

  it('rejects missing client_run_id / task / project', () => {
    expect(() =>
      buildServerSubmissionManifest({ session: makeSession('rf_data'), taskContext }),
    ).toThrow('client_run_id_required')
    expect(() =>
      buildServerSubmissionManifest({
        clientRunId: F10C2_UUIDS.clientRun,
        session: makeSession('rf_data'),
        taskContext: { projectId: F10C2_UUIDS.project },
      }),
    ).toThrow('task_id_required')
  })
})

describe('serverSubmissionManifest — artifacts', () => {
  it('builds descriptors without signed URLs', () => {
    const key = buildResultArtifactObjectKey({
      projectId: F10C2_UUIDS.project,
      taskId: F10C2_UUIDS.taskAssignedToFeA,
      verifiedUserId: F10C2_UUIDS.feA,
      fieldTestRunId: F10C2_UUIDS.fieldTestRun,
      artifactId: F10C2_UUIDS.artifactA,
      safeExtension: 'json',
    })
    expect(key.split('/')).toHaveLength(5)
    expect(key.startsWith(`${RESULT_ARTIFACTS_BUCKET}/`)).toBe(false)
    const ref = durableArtifactRef(RESULT_ARTIFACTS_BUCKET, key)
    expect(ref).toEqual({ bucket: RESULT_ARTIFACTS_BUCKET, object_key: key })
    expect(JSON.stringify(ref)).not.toMatch(/https?:\/\//i)

    const descriptor = buildArtifactDescriptor({
      artifactId: F10C2_UUIDS.artifactA,
      artifactType: ARTIFACT_TYPES.UNIFIED_JSON,
      mimeType: 'application/json',
      sizeBytes: 1200,
      checksum: 'sha256:synthetic',
      safeExtension: 'json',
      objectKey: key,
    })
    const manifest = buildServerSubmissionManifest({
      clientRunId: F10C2_UUIDS.clientRun,
      session: makeSession('native_http'),
      taskContext,
      artifacts: [descriptor],
    })
    expect(validateServerSubmissionManifest(manifest).ok).toBe(true)
  })

  it('rejects signed URL as durable object_key', () => {
    expect(() =>
      buildArtifactDescriptor({
        artifactId: F10C2_UUIDS.artifactA,
        artifactType: ARTIFACT_TYPES.RF_CSV,
        mimeType: 'text/csv',
        sizeBytes: 10,
        checksum: 'sha256:x',
        objectKey: 'https://example.invalid/signed',
      }),
    ).toThrow('signed_or_public_url_not_durable')
  })

  it('rejects unsafe extension', () => {
    expect(() =>
      buildResultArtifactObjectKey({
        projectId: F10C2_UUIDS.project,
        taskId: F10C2_UUIDS.taskAssignedToFeA,
        verifiedUserId: F10C2_UUIDS.feA,
        fieldTestRunId: F10C2_UUIDS.fieldTestRun,
        artifactId: F10C2_UUIDS.artifactA,
        safeExtension: 'exe',
      }),
    ).toThrow('unsafe_extension')
  })
})
