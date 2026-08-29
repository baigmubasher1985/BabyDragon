/**
 * F10C2 CR1 — timestamp coercion at the serialization / ingestion boundary.
 */
import { describe, it, expect } from 'vitest'
import { coerceDeviceTimestamp, buildServerSubmissionManifest } from '../../src/mobile/rf/reports/serverSubmissionManifest.js'
import { extractCanonicalMeasurements } from '../../src/acceptance/canonicalIngest.js'

const ISO_HTTP_START = '2026-08-25T21:47:17.783Z'
const MS_HTTP_START = 1787694437783
const SEC_HTTP_START = 1787694437

describe('f10c2 cr1 — coerceDeviceTimestamp', () => {
  it('leaves valid ISO-8601 unchanged (UTC normalized)', () => {
    expect(coerceDeviceTimestamp('2026-08-25T21:47:17.783Z')).toBe(ISO_HTTP_START)
    expect(coerceDeviceTimestamp('2026-08-25T21:47:17.783+00:00')).toBe(ISO_HTTP_START)
  })

  it('converts epoch milliseconds number and digit-string to ISO UTC', () => {
    expect(coerceDeviceTimestamp(MS_HTTP_START)).toBe(ISO_HTTP_START)
    expect(coerceDeviceTimestamp('1787694437783')).toBe(ISO_HTTP_START)
    expect(coerceDeviceTimestamp(1787694437966)).toBe('2026-08-25T21:47:17.966Z')
  })

  it('converts explicit 10-digit epoch seconds to ISO UTC', () => {
    expect(coerceDeviceTimestamp(SEC_HTTP_START)).toBe('2026-08-25T21:47:17.000Z')
    expect(coerceDeviceTimestamp('1787694437')).toBe('2026-08-25T21:47:17.000Z')
  })

  it('fails closed on invalid, NaN, Inf, negative, and unreasonable values', () => {
    expect(coerceDeviceTimestamp(Number.NaN)).toBeNull()
    expect(coerceDeviceTimestamp(Number.POSITIVE_INFINITY)).toBeNull()
    expect(coerceDeviceTimestamp(Number.NEGATIVE_INFINITY)).toBeNull()
    expect(coerceDeviceTimestamp(-1787694437783)).toBeNull()
    expect(coerceDeviceTimestamp('-1787694437783')).toBeNull()
    expect(coerceDeviceTimestamp(0)).toBeNull()
    expect(coerceDeviceTimestamp(123)).toBeNull()
    expect(coerceDeviceTimestamp('not-a-date')).toBeNull()
    expect(coerceDeviceTimestamp('NaN')).toBeNull()
    expect(coerceDeviceTimestamp('Infinity')).toBeNull()
    expect(coerceDeviceTimestamp(99_999_999_999_999)).toBeNull()
    expect(coerceDeviceTimestamp('999')).toBeNull()
  })

  it('never substitutes now() for invalid input', () => {
    const before = Date.now()
    expect(coerceDeviceTimestamp('bogus')).toBeNull()
    expect(coerceDeviceTimestamp(null)).toBeNull()
    expect(coerceDeviceTimestamp('')).toBeNull()
    const after = Date.now()
    expect(after - before).toBeLessThan(1000)
  })

  it('is deterministic across retries', () => {
    const first = coerceDeviceTimestamp(MS_HTTP_START)
    const second = coerceDeviceTimestamp(MS_HTTP_START)
    expect(first).toBe(second)
    expect(first).toBe(ISO_HTTP_START)
  })
})

describe('f10c2 cr1 — conversion does not alter measurements or identity', () => {
  it('preserves DL/UL/bytes/duration/counts and client_run_id while coercing iteration stamps', () => {
    const extracted = extractCanonicalMeasurements({
      client_run_id: '1e969145-3ddb-4636-adf2-7a1e08328be7',
      identity_key: 'session:bd-rf-1787694437783|scenario:native_http',
      manifest: {
        client_run_id: '1e969145-3ddb-4636-adf2-7a1e08328be7',
        scenario_type: 'native_http',
        data_summary: {
          scenarios: [{
            scenario_type: 'native_http',
            attempt_counts: { planned: 2, completed: 2, failed: 0 },
            iterations: [
              { iteration: 1, status: 'completed', dl_mbps: 175.65, ul_mbps: 93.47, started_at: 1787694437966, ended_at: 1787694445261 },
              { iteration: 2, status: 'completed', dl_mbps: 216.03, ul_mbps: 141.89, started_at: 1787694448000, ended_at: 1787694455617 },
            ],
          }],
        },
      },
    })
    expect(extracted.identity.client_run_id).toBe('1e969145-3ddb-4636-adf2-7a1e08328be7')
    expect(extracted.iterations).toHaveLength(2)
    expect(extracted.iterations[0].dl_mbps).toBe(175.65)
    expect(extracted.iterations[0].ul_mbps).toBe(93.47)
    expect(extracted.iterations[1].dl_mbps).toBe(216.03)
    expect(extracted.iterations[1].ul_mbps).toBe(141.89)
    expect(extracted.iterations[0].iteration_number).toBe(1)
    expect(extracted.iterations[1].iteration_number).toBe(2)
    expect(extracted.iterations[0].started_at).toBe('2026-08-25T21:47:17.966Z')
    expect(extracted.iterations[0].ended_at).toBe('2026-08-25T21:47:25.261Z')
    expect(extracted.iterations.map((i) => i.iteration_number)).toEqual([1, 2])
  })

  it('writes ISO manifest timestamps without changing report identity', () => {
    const manifest = buildServerSubmissionManifest({
      clientRunId: '1e969145-3ddb-4636-adf2-7a1e08328be7',
      session: {
        appEngineId: 'native_http',
        startedAt: 1787694437783,
        endedAt: 1787694455617,
        dataTestOutcome: { plannedIterations: 2, completedIterations: 2, failedIterations: 0 },
      },
      taskContext: {
        taskId: '00000000-0000-4000-8000-000000000001',
        projectId: '00000000-0000-4000-8000-000000000002',
      },
    })
    expect(manifest.client_run_id).toBe('1e969145-3ddb-4636-adf2-7a1e08328be7')
    expect(manifest.started_at_device).toBe(ISO_HTTP_START)
    expect(manifest.data_summary.scenarios[0].attempt_counts.planned).toBe(2)
    expect(manifest.data_summary.scenarios[0].attempt_counts.failed).toBe(0)
  })
})
