/**
 * CR1-B-U-R1 — iPerf bidirectional truth: native JSON → mapper → iteration →
 * export → canonical payload → acceptance.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  mapIperf3NativeResult,
  buildIperfIterationResult,
  aggregateCompletedIterationThroughput,
  aggregateDirectionFromIntervals,
  attachIperfExportIntervals,
  reconcileIperfSessionThroughput,
  CONTINUOUS_IPERF_AGGREGATION_RULE,
} from '../../src/mobile/testEngines/iperf3ResultMapper.js'
import { evaluateDlUlIteration, evaluateDlUlRun } from '../../src/acceptance/dlUlEvaluation.js'
import { createCanonicalIngestStore } from '../../src/acceptance/canonicalIngest.js'
import { VERDICTS } from '../../src/acceptance/verdicts.js'
import { classifyIperfFailure } from '../../src/mobile/rf/reports/dataTestOutcome.js'

const ROOT = process.cwd()
const nativeBidir = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/f10c2/fixtures/cr1bur1-iperf-native-bidir.json'), 'utf8'))
const fieldDerived = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/f10c2/fixtures/cr1bur1-iperf-bidir-field-derived.json'), 'utf8'))

const setup = { direction: 'dl_ul', bidirMode: true, protocol: 'TCP', durationSeconds: 10, intervalSeconds: 5 }

describe('CR1-B-U-R1 iPerf bidirectional mapping', () => {
  it('maps bidir end totals from reverse receiver, not forward sum_received', () => {
    const mapped = mapIperf3NativeResult({ ok: true, status: 'complete', raw_json: nativeBidir }, setup)
    expect(mapped.dlMbps).toBeCloseTo(27.8, 1)
    expect(mapped.ulMbps).toBeCloseTo(0.51, 2)
    expect(mapped.dlMbps).not.toBeCloseTo(0.42, 1)
    const row = buildIperfIterationResult(1, mapped, setup, { status: 'complete' })
    expect(row.dlMbps).toBe(mapped.dlMbps)
    expect(row.ulMbps).toBe(mapped.ulMbps)
    expect(row.dlBytes).toBe(mapped.dlBytes)
    expect(row.ulBytes).toBe(mapped.ulBytes)
  })

  it('reconstructs DL from interval samples when reverse end fields are missing', () => {
    const json = {
      ...nativeBidir,
      end: {
        sum_sent: nativeBidir.end.sum_sent,
        sum_received: nativeBidir.end.sum_received,
      },
    }
    const mapped = mapIperf3NativeResult({ ok: true, status: 'complete', raw_json: json }, setup)
    const intervalMean = aggregateDirectionFromIntervals(mapped.intervalSamples)
    expect(mapped.throughputSource).toBe('interval_reconciled_bidir')
    expect(mapped.dlMbps).toBe(intervalMean.dlMbps)
    expect(mapped.dlMbps).toBeGreaterThan(10)
    expect(mapped.ulMbps).toBeCloseTo(0.51, 2)
  })

  it('reproduces the field 2.64 vs 29.91 discrepancy as a mapping bug, then corrects it', () => {
    expect(fieldDerived.headlinePersistedWrong.avgDlMbps).toBeCloseTo(2.64, 2)
    const intervalMean = aggregateDirectionFromIntervals(fieldDerived.intervals)
    expect(intervalMean.dlMbps).toBeCloseTo(29.91, 1)
    expect(intervalMean.ulMbps).toBeCloseTo(4.18, 1)

    const rows = fieldDerived.iterations.map((row) => ({
      ...row,
      intervalSamples: fieldDerived.intervals.filter((sample) => sample.iteration === row.iteration),
    }))
    const corrected = reconcileIperfSessionThroughput({ appIterationResults: rows })
    expect(corrected.appDlMbps).toBeCloseTo(29.91, 1)
    expect(corrected.appDlMbps).not.toBeCloseTo(2.64, 1)
    const fromCompleted = aggregateCompletedIterationThroughput(corrected.appIterationResults)
    expect(fromCompleted.avgDlMbps).toBe(corrected.appDlMbps)
    expect(fromCompleted.completed).toBe(21)
    expect(CONTINUOUS_IPERF_AGGREGATION_RULE).toMatch(/completed iteration/i)
  })

  it('keeps raw iteration, export attach, and server ingest values in agreement', () => {
    const mapped = mapIperf3NativeResult({ ok: true, status: 'complete', raw_json: nativeBidir }, setup)
    const row = buildIperfIterationResult(1, mapped, setup, { status: 'complete' })
    const exportJson = {
      intervals: mapped.intervalSamples.map((sample) => ({
        iteration: 1,
        interval: sample.index,
        seconds: sample.seconds,
        dlMbps: sample.dlMbps,
        ulMbps: sample.ulMbps,
      })),
    }
    const attached = attachIperfExportIntervals({
      id: 'bd-rf-truth-1',
      appIterationResults: [{ ...row, dlMbps: 0.42, ulMbps: 0.51, intervalSamples: [] }],
    }, exportJson)
    expect(attached.appIterationResults[0].dlMbps).toBeGreaterThan(10)
    expect(attached.appIterationResults[0].dlMbps).not.toBeCloseTo(0.42, 1)
    const store = createCanonicalIngestStore()
    const ingested = store.ingest({
      client_run_id: 'run-truth-1',
      identity_key: 'run-truth-1',
      iterations: [row],
    })
    expect(ingested.ok).toBe(true)
    expect(ingested.run.iterations[0].dl_mbps).toBe(row.dlMbps)
    const evals = evaluateDlUlRun({
      iterations: [{
        iteration_number: row.iteration,
        status: 'completed',
        dl_mbps: row.dlMbps,
        ul_mbps: row.ulMbps,
      }],
      rules: { min_dl_mbps: 5, min_ul_mbps: 0.1, enabled_directions: ['dl', 'ul'] },
    })
    expect(evals.iterations[0].actual_dl_mbps).toBe(row.dlMbps)
    expect(evals.iterations[0].overall_verdict).not.toBe(VERDICTS.INCOMPLETE)
  })

  it('keeps failed iPerf measurements null and INCOMPLETE, never 0 Mbps FAIL', () => {
    const mapped = mapIperf3NativeResult({
      ok: false,
      status: 'timeout',
      failure_class: 'timeout',
      stdout: '',
    }, setup)
    expect(mapped.dlMbps).toBeNull()
    expect(mapped.ulMbps).toBeNull()
    const row = buildIperfIterationResult(1, mapped, setup, { status: 'timeout' })
    expect(row.dlMbps).toBeNull()
    expect(classifyIperfFailure(row.failureClass || 'timeout').failureClass).toBe('timeout')
    const verdict = evaluateDlUlIteration({
      iteration_number: 1,
      status: 'failed',
      execution_failed: true,
      dl_mbps: row.dlMbps,
      ul_mbps: row.ulMbps,
      failure_reason: 'timeout',
    }, { min_dl_mbps: 100, min_ul_mbps: 10, enabled_directions: ['dl', 'ul'] })
    expect(verdict.overall_verdict).toBe(VERDICTS.INCOMPLETE)
    expect(verdict.overall_verdict).not.toBe(VERDICTS.FAIL)
    expect(verdict.actual_dl_mbps).toBeNull()
  })
})
