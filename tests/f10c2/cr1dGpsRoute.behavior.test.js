/**
 * F10C2 CR1-D — GPS driven route (items 19–26).
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  buildGpsRouteModel,
  downsampleForRender,
  emptyGpsRouteState,
  GPS_EMPTY_REASONS,
  haversineMeters,
  isValidGpsCoordinate,
  parseGpsCsv,
} from '../../src/fieldResults/gps/gpsRouteModel.js'
import { loadGpsRouteForRun } from '../../src/fieldResults/gps/loadGpsRoute.js'
import { buildFieldResultsFixtures } from '../../src/fieldResults/fixtures/fieldResultsFixtures.js'
import { toListRow } from '../../src/fieldResults/selectors/fieldResultSelectors.js'
import { createMockFieldResultsProvider } from '../../src/fieldResults/repository/mockFieldResultsProvider.js'

const ROOT = process.cwd()
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

describe('f10c2 cr1-d — GPS driven route (19-26)', () => {
  const samples = [
    { latitude: 32.75, longitude: -96.80, timestamp_iso: '2026-08-10T14:00:00.000Z', sample_index: 1, accuracy_m: 4 },
    { latitude: 0, longitude: 0, timestamp_iso: '2026-08-10T14:01:00.000Z', sample_index: 2 },
    { latitude: 32.76, longitude: -96.79, timestamp_iso: '2026-08-10T14:02:00.000Z', sample_index: 3, accuracy_m: 5 },
    { latitude: 91, longitude: -96.78, timestamp_iso: '2026-08-10T14:03:00.000Z', sample_index: 4 },
    { latitude: 32.78, longitude: -96.75, timestamp_iso: '2026-08-10T14:04:00.000Z', sample_index: 5, accuracy_m: 6 },
  ]

  it('19. keeps chronological order by sample_index / timestamp', () => {
    const shuffled = [samples[4], samples[0], samples[2]]
    const route = buildGpsRouteModel({ payload: shuffled })
    expect(route.render_points[0][0]).toBe(32.75)
    expect(route.render_points[route.render_points.length - 1][0]).toBe(32.78)
  })

  it('20. rejects missing, out-of-range, and illegitimate 0/0 coordinates', () => {
    expect(isValidGpsCoordinate(0, 0)).toBe(false)
    expect(isValidGpsCoordinate(91, -96)).toBe(false)
    expect(isValidGpsCoordinate(null, -96)).toBe(false)
    expect(isValidGpsCoordinate(32.75, -96.8)).toBe(true)
    const route = buildGpsRouteModel({ payload: samples })
    expect(route.invalid_count).toBe(2)
    expect(route.valid_count).toBe(3)
  })

  it('21. Start is first valid and End is last valid with fit-ready points', () => {
    const route = buildGpsRouteModel({ payload: samples })
    expect(route.start.lat).toBe(32.75)
    expect(route.end.lat).toBe(32.78)
    expect(route.render_points.length).toBe(3)
  })

  it('22. reports valid/invalid counts, start/end time, distance, and accuracy when available', () => {
    const route = buildGpsRouteModel({ payload: samples })
    expect(route.start_time).toContain('2026-08-10T14:00:00')
    expect(route.end_time).toContain('2026-08-10T14:04:00')
    expect(route.distance_m).toBeGreaterThan(0)
    expect(route.accuracy_m).toBeGreaterThan(0)
    expect(haversineMeters(route.start, route.end)).toBeGreaterThan(0)
  })

  it('23. downsample is render-only, labeled, and preserves raw count', () => {
    const many = Array.from({ length: 1200 }, (_, i) => ({
      latitude: 32.7 + i * 0.0001,
      longitude: -96.8,
      sample_index: i + 1,
    }))
    const route = buildGpsRouteModel({ payload: many, maxRenderPoints: 50 })
    expect(route.downsampled).toBe(true)
    expect(route.render_count).toBeLessThan(route.raw_valid_count)
    expect(route.raw_valid_count).toBe(1200)
    const raw = downsampleForRender(many, 50)
    expect(raw.downsampled).toBe(true)
  })

  it('24. list rows do not embed raw GPS traces', () => {
    const { runs } = buildFieldResultsFixtures()
    const row = toListRow(runs.find((r) => r.id === 'run-native-http-success'))
    expect(row.gps_trace_points).toBeUndefined()
    expect(row.has_raw_rf_samples).toBe(false)
    expect(read('src/fieldResults/components/FieldResultsList.jsx')).not.toContain('getGpsRoute')
  })

  it('25. empty states cover not uploaded, pending artifact, no valid samples, and tiles unavailable', () => {
    expect(emptyGpsRouteState().empty_reason).toBe(GPS_EMPTY_REASONS.NOT_UPLOADED)
    expect(GPS_EMPTY_REASONS.ARTIFACT_PENDING).toBe('artifact_pending')
    expect(GPS_EMPTY_REASONS.NO_VALID_SAMPLES).toBe('no_valid_samples')
    expect(GPS_EMPTY_REASONS.TILES_UNAVAILABLE).toBe('tiles_unavailable')
    const map = read('src/fieldResults/components/GpsRouteMap.jsx')
    expect(map).toContain('GPS was not uploaded')
    expect(map).toContain('artifact is pending')
    expect(map).toContain('No valid GPS samples')
    expect(map).toContain('Map tiles unavailable')
    expect(map).toContain('TileLoadGuard')
    expect(map).toContain('Fit Route')
  })

  it('26. parses canonical JSON trace samples and CSV without fabricating points', async () => {
    const jsonRoute = buildGpsRouteModel({
      payload: { trace: { sample_count: 3, samples } },
    })
    expect(jsonRoute.valid_count).toBe(3)
    const csv = parseGpsCsv('latitude,longitude\n32.75,-96.8\n0,0\n32.76,-96.79\n')
    const csvRoute = buildGpsRouteModel({ payload: csv })
    expect(csvRoute.valid_count).toBe(2)
    const provider = createMockFieldResultsProvider({ latencyMs: 0 })
    const res = await provider.getGpsRoute('run-native-http-success', { role: 'admin' })
    expect(res.ok).toBe(true)
    expect(res.route.valid_count).toBe(3)
    expect(res.route.labeled_synthetic).toBe(true)
    const jsonTextRoute = buildGpsRouteModel({
      payload: JSON.stringify({ trace: { sample_count: 2, samples: [samples[0], samples[2]] } }),
    })
    expect(jsonTextRoute.valid_count).toBe(2)
    const missing = await loadGpsRouteForRun({ run: { artifacts: [] } })
    expect(missing.route.empty_reason).toBe(GPS_EMPTY_REASONS.NOT_UPLOADED)

    const physicalCsv = path.join(
      ROOT,
      '..',
      'Audit Data',
      'F10C2',
      'CR1-B-U-R1',
      'package_inspect',
      'http',
      'bd-rf-1787694437783__native_http',
      'F10C2-P4BU-E2E_Data_RF_Report_20260825_164717_RF_GPS_Trace.csv',
    )
    if (fs.existsSync(physicalCsv)) {
      const physicalRoute = buildGpsRouteModel({
        payload: parseGpsCsv(fs.readFileSync(physicalCsv, 'utf8')),
      })
      expect(physicalRoute.valid_count).toBe(18)
      expect(physicalRoute.invalid_count).toBe(0)
      expect(physicalRoute.start).toBeTruthy()
      expect(physicalRoute.end).toBeTruthy()
      expect(physicalRoute.empty_reason).toBeNull()
    }
  })
})
