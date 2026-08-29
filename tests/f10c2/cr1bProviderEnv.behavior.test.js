/**
 * F10C2 CR1-B — provider/environment classification.
 * Live VITE flags in .env.local must not leak into unit tests.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { getResultTransportKind } from '../../src/mobile/rf/submission/resultTransportFactory.js'
import {
  createFieldResultsRepository,
  resetFieldResultsRepository,
} from '../../src/fieldResults/repository/fieldResultsRepository.js'
import { createSupabaseFieldResultsProvider } from '../../src/fieldResults/repository/supabaseFieldResultsProvider.js'
import {
  getFieldResultsProviderKind,
  isF10C2ServerSubmitRuntimeEnabled,
} from '../../src/lib/f10c2FeatureFlags.js'

afterEach(() => {
  delete process.env.VITE_F10C2_SERVER_SUBMIT_ENABLED
  delete process.env.VITE_F10C2_FIELD_RESULTS_PROVIDER
  delete process.env.F10C2_TEST_ALLOW_LIVE_FLAGS
  resetFieldResultsRepository()
})

describe('f10c2 cr1b — provider with/without configured supabase client', () => {
  it('defaults unit tests to mock transport even if host .env.local enables live submit', () => {
    expect(isF10C2ServerSubmitRuntimeEnabled()).toBe(false)
    expect(getResultTransportKind()).toBe('mock_f10c2_phase2')
    expect(getFieldResultsProviderKind()).toBe('mock')
  })

  it('creates the mock Field Results provider without a supabase client', () => {
    const repo = createFieldResultsRepository({ forceNew: true })
    expect(repo.kind).toBe('mock')
  })

  it('throws when supabase kind is requested without an injected client (config defect, not skipped)', () => {
    expect(() => createFieldResultsRepository({ kind: 'supabase' })).toThrow(/supabase_client_required/i)
    expect(() => createSupabaseFieldResultsProvider({})).toThrow(/supabase_client_required/i)
  })

  it('accepts an injected supabase client for the live provider', () => {
    const supabase = {
      from() {
        const api = {
          select: () => api,
          in: async () => ({ data: [], error: null }),
          eq: () => api,
          order: () => api,
          limit: async () => ({ data: [], error: null }),
          maybeSingle: async () => ({ data: null, error: null }),
        }
        return api
      },
    }
    const repo = createFieldResultsRepository({ kind: 'supabase', supabase, forceNew: true })
    expect(repo.kind).toBe('supabase')
  })

  it('treats live-provider env without an injected client as a test configuration defect, not a product skip', () => {
    process.env.F10C2_TEST_ALLOW_LIVE_FLAGS = 'yes'
    process.env.VITE_F10C2_FIELD_RESULTS_PROVIDER = 'supabase'
    expect(getFieldResultsProviderKind()).toBe('supabase')
    expect(() => createFieldResultsRepository({ forceNew: true })).toThrow(/supabase_client_required/i)
  })
})
