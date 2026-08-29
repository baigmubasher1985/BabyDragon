/**
 * F10C2 CR1 — fail-closed selective queue targeting.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { installLocalStorageShim, clearLocalStorageShim } from './fixtures/localStorageShim.js'
import {
  OFFLINE_ACTION_TYPES,
  MOBILE_QUEUE_STORAGE_KEY,
} from '../../src/mobile/mobileOfflineQueue.js'
import {
  selectFieldTestQueueTargets,
  processSelectedFieldTestResultQueue,
  PROTECTED_QUEUE_SESSION_ID,
} from '../../src/mobile/rf/submission/enqueueFieldTestResult.js'

function seed(items) {
  globalThis.localStorage.setItem(MOBILE_QUEUE_STORAGE_KEY, JSON.stringify(items))
}

function submitItem(id, identityKey, extra = {}) {
  return {
    id,
    type: OFFLINE_ACTION_TYPES.FIELD_TEST_RESULT_SUBMIT,
    payload: {
      client_run_id: extra.client_run_id || `client-${id}`,
      identity_key: identityKey,
      package_state: extra.package_state || 'failed_permanent',
      manifest: { scenario_type: extra.scenario || 'native_http', report_name: extra.report_name || null },
    },
  }
}

describe('f10c2 cr1 — selective retry targeting', () => {
  beforeEach(() => {
    installLocalStorageShim()
    clearLocalStorageShim()
  })

  it('selects exactly the two approved canonical packages and refuses the protected session', () => {
    seed([
      submitItem('q-http', 'session:bd-rf-1787694437783|scenario:native_http', { scenario: 'native_http' }),
      submitItem('q-iperf', 'session:bd-rf-1787694471111|scenario:iperf3', { scenario: 'iperf3' }),
      submitItem('q-protected', `session:${PROTECTED_QUEUE_SESSION_ID}|scenario:iperf3`, { scenario: 'iperf3' }),
      { id: 'q-task', type: OFFLINE_ACTION_TYPES.TASK_STATUS, payload: { task_id: 'x' } },
    ])
    const selected = selectFieldTestQueueTargets([
      'bd-rf-1787694437783::native_http',
      'bd-rf-1787694471111::iperf3',
    ])
    expect(selected.ok).toBe(true)
    expect(selected.matches).toHaveLength(2)
    expect(selected.matches.map((m) => m.item.id).sort()).toEqual(['q-http', 'q-iperf'])
  })

  it('fails closed if the protected package is in the target list', () => {
    seed([
      submitItem('q-protected', `session:${PROTECTED_QUEUE_SESSION_ID}|scenario:iperf3`),
    ])
    const selected = selectFieldTestQueueTargets([`${PROTECTED_QUEUE_SESSION_ID}::iperf3`])
    expect(selected.ok).toBe(false)
    expect(selected.code).toBe('protected_package_denied')
  })

  it('fails closed when a target is missing', () => {
    seed([
      submitItem('q-http', 'session:bd-rf-1787694437783|scenario:native_http'),
    ])
    const selected = selectFieldTestQueueTargets([
      'bd-rf-1787694437783::native_http',
      'bd-rf-1787694471111::iperf3',
    ])
    expect(selected.ok).toBe(false)
    expect(selected.code).toBe('selective_target_ambiguous_or_missing')
  })

  it('processes only matched items and leaves the protected row queued', async () => {
    seed([
      submitItem('q-http', 'session:bd-rf-1787694437783|scenario:native_http', { client_run_id: '1e969145-3ddb-4636-adf2-7a1e08328be7' }),
      submitItem('q-iperf', 'session:bd-rf-1787694471111|scenario:iperf3', { client_run_id: '6dfc70ed-b9c1-4672-80ec-826a3fb299ed' }),
      submitItem('q-protected', `session:${PROTECTED_QUEUE_SESSION_ID}|scenario:iperf3`),
    ])
    const processed = []
    const result = await processSelectedFieldTestResultQueue({
      canonicalIds: ['bd-rf-1787694437783::native_http', 'bd-rf-1787694471111::iperf3'],
      processItem: async (item) => {
        processed.push(item.payload.identity_key)
        return { keep: false, payload: { ...item.payload, package_state: 'uploaded' }, reason: 'uploaded' }
      },
    })
    expect(result.ok).toBe(true)
    expect(processed).toHaveLength(2)
    expect(processed.some((k) => k.includes(PROTECTED_QUEUE_SESSION_ID))).toBe(false)
    const remaining = JSON.parse(globalThis.localStorage.getItem(MOBILE_QUEUE_STORAGE_KEY))
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe('q-protected')
  })
})
