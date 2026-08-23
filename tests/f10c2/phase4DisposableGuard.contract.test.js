import { describe, it, expect } from 'vitest'
import {
  evaluateDisposableTarget,
  assertDisposableTarget,
  redactProjectRef,
} from '../../src/lib/disposableSupabaseGuard.js'

describe('f10c2 phase4 — disposable target guard', () => {
  it('rejects missing confirmation and missing URL', () => {
    const result = evaluateDisposableTarget({
      disposableUrl: '',
      confirmed: '',
      appViteUrl: 'https://prodhost.example.invalid',
    })
    expect(result.ok).toBe(false)
    expect(result.reasons.some((r) => r.includes('CONFIRMED'))).toBe(true)
  })

  it('rejects when disposable hostname matches app VITE hostname', () => {
    const result = evaluateDisposableTarget({
      disposableUrl: 'https://abcdrefxyz.example.invalid',
      appViteUrl: 'https://abcdrefxyz.example.invalid',
      confirmed: 'yes',
    })
    expect(result.ok).toBe(false)
    expect(result.reasons.join(' ')).toMatch(/matches VITE_SUPABASE_URL/i)
  })

  it('rejects explicit denied production ref', () => {
    const result = evaluateDisposableTarget({
      disposableUrl: 'https://prodxxxx.supabase.invalid',
      appViteUrl: 'https://otheryyyy.supabase.invalid',
      confirmed: 'yes',
      deniedProductionRef: 'prodxxxx',
    })
    expect(result.ok).toBe(false)
    expect(result.reasons.join(' ')).toMatch(/denied production/i)
  })

  it('accepts a distinct confirmed disposable hostname', () => {
    const result = evaluateDisposableTarget({
      disposableUrl: 'https://dispabcd.example.invalid',
      appViteUrl: 'https://prodwxyz.example.invalid',
      confirmed: 'yes',
      explicitDisposableRef: 'dispabcd',
      commandCategory: 'identity-check',
      changesDisposableProject: false,
    })
    expect(result.ok).toBe(true)
    expect(result.hostname).toBe('dispabcd.example.invalid')
    expect(result.projectRefRedacted).toBe(redactProjectRef('dispabcd'))
    expect(() =>
      assertDisposableTarget({
        disposableUrl: 'https://dispabcd.example.invalid',
        appViteUrl: 'https://prodwxyz.example.invalid',
        confirmed: 'yes',
        explicitDisposableRef: 'dispabcd',
      }),
    ).not.toThrow()
  })

  it('accepts local disposable hostname', () => {
    const result = evaluateDisposableTarget({
      disposableUrl: 'http://127.0.0.1:54321',
      appViteUrl: 'https://prodwxyz.example.invalid',
      confirmed: 'yes',
    })
    expect(result.ok).toBe(true)
    expect(result.local).toBe(true)
    expect(result.projectRef).toBe('local-disposable')
  })
})
