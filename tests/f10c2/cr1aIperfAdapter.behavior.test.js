import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { classifyIperfFailure } from '../../src/mobile/rf/reports/dataTestOutcome.js'
import { mapIperfExportStatus } from '../../src/mobile/rf/reports/iperf3ReportExport.js'
import { buildIperf3CommandFromSetup } from '../../src/mobile/testEngines/iperf3CommandParser.js'
import {
  buildIperfIterationResult,
  mapIperf3NativeResult,
} from '../../src/mobile/testEngines/iperf3ResultMapper.js'

const ROOT = process.cwd()

vi.mock('../../src/mobile/plugins/babyDragonIperf.js', () => ({
  BabyDragonIperf: {
    probeIperfVersion: vi.fn(),
    getIperfStatus: vi.fn(),
    runIperf3: vi.fn(),
    addListener: vi.fn(async () => ({ remove: async () => {} })),
    cancelIperf3: vi.fn(),
  },
}))

describe('CR1-A iPerf adapter / native contract', () => {
  it('maps native timeout to incomplete without inventing 0 Mbps or 0 bytes', () => {
    const mapped = mapIperf3NativeResult({
      ok: false,
      status: 'timeout',
      failure_class: 'timeout',
      exit_code: -1,
      stdout: '',
      stderr: '',
      message: 'iPerf3 process wait timed out before JSON output. Server connectivity was not confirmed.',
    }, { direction: 'dl_ul', bidirMode: true })
    expect(mapped.status).toBe('incomplete')
    expect(mapped.dlMbps).toBeNull()
    expect(mapped.ulMbps).toBeNull()
    expect(mapped.dlBytes).toBeNull()
    expect(mapped.ulBytes).toBeNull()
    const row = buildIperfIterationResult(1, mapped, { direction: 'dl_ul' }, { status: 'timeout' })
    expect(row.status).toBe('incomplete')
    expect(row.dlMeasuredBytes).toBeNull()
    expect(row.ulMeasuredBytes).toBeNull()
    expect(row.failureClass).toBe('timeout')
    expect(mapIperfExportStatus(row.status)).toBe('incomplete')
  })

  it('classifies known failure categories instead of generic exit -1', () => {
    const classes = [
      'binary_missing',
      'unsupported_abi',
      'permission_denied',
      'linker_failed',
      'process_spawn_failed',
      'dns_failed',
      'connection_refused',
      'network_unreachable',
      'timeout',
      'protocol_error',
      'server_error',
      'user_cancelled',
    ]
    for (const key of classes) {
      expect(classifyIperfFailure(key).failureClass).toBe(key)
    }
    expect(classifyIperfFailure('iPerf3 exited with code -1').failureClass).toBe('process_spawn_failed')
    expect(classifyIperfFailure('connection refused').failureClass).toBe('connection_refused')
  })

  it('builds DL, UL and bidirectional commands', () => {
    const ul = buildIperf3CommandFromSetup({ server: '160.242.19.254', port: 9205, direction: 'ul', protocol: 'TCP', durationSeconds: 5 })
    const dl = buildIperf3CommandFromSetup({ server: '160.242.19.254', port: 9205, direction: 'dl', protocol: 'TCP', durationSeconds: 5 })
    const both = buildIperf3CommandFromSetup({ server: '160.242.19.254', port: 9205, direction: 'dl_ul', protocol: 'TCP', durationSeconds: 5 })
    expect(ul).toContain('-c 160.242.19.254')
    expect(ul).toContain('-p 9205')
    expect(ul).not.toContain('-R')
    expect(ul).not.toContain('--bidir')
    expect(dl).toContain('-R')
    expect(dl).not.toContain('--bidir')
    expect(both).toContain('--bidir')
    expect(both).not.toContain(' -R')
  })

  it('stops before network testing when version/help probe fails and keeps failed iteration', async () => {
    const { BabyDragonIperf } = await import('../../src/mobile/plugins/babyDragonIperf.js')
    BabyDragonIperf.probeIperfVersion.mockResolvedValue({
      ok: false,
      status: 'binary_missing',
      failure_class: 'binary_missing',
      message: 'iPerf3 ELF binary is missing for ABI arm64-v8a.',
      stdout: '',
    })
    const { runIperf3ThroughputTest } = await import('../../src/mobile/testEngines/iperf3Runner.js')
    const result = await runIperf3ThroughputTest({
      config: { server: '160.242.19.254', port: 9205, direction: 'dl_ul', protocol: 'TCP', durationSeconds: 5, iterations: 1 },
    })
    expect(BabyDragonIperf.runIperf3).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    expect(result.iterationResults).toHaveLength(1)
    expect(result.iterationResults[0].status).toBe('incomplete')
    expect(result.avgDlMbps).toBeNull()
    expect(result.avgUlMbps).toBeNull()
    expect(result.downloadBytes).toBeNull()
    expect(result.uploadBytes).toBeNull()
  })

  it('keeps native plugin contract for ABI/ELF probe, leftover binary preservation, and classified timeout', () => {
    const java = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/mobbitechglobal/babydragon/BabyDragonIperfPlugin.java'), 'utf8')
    expect(java).toMatch(/public void probeIperfVersion/)
    expect(java).toMatch(/public void prepareIperfBinary/)
    expect(java).toMatch(/isAssetElf/)
    expect(java).toMatch(/boolean shouldCopy = assetElf &&/)
    expect(java).toMatch(/Placeholder assets were not copied/)
    expect(java).toMatch(/failure_class", "timeout"/)
    expect(java).toMatch(/classifyLaunchFailure/)
    expect(java).toMatch(/"dl_ul".equals\(cfg.direction\)/)
    const readme = fs.readFileSync(path.join(ROOT, 'android/app/src/main/assets/iperf3/README_IPERF3_BINARIES.md'), 'utf8')
    expect(readme.toLowerCase()).toMatch(/iperf/)
    const binaryPath = path.join(ROOT, 'android/app/src/main/assets/iperf3/arm64-v8a/iperf3')
    expect(fs.existsSync(path.join(ROOT, 'android/app/src/main/assets/iperf3/arm64-v8a/PLACE_IPERF3_BINARY_HERE.txt'))).toBe(true)
    if (fs.existsSync(binaryPath)) {
      const magic = fs.readFileSync(binaryPath).subarray(0, 4)
      expect(Array.from(magic)).toEqual([0x7f, 0x45, 0x4c, 0x46])
    }
  })
})
