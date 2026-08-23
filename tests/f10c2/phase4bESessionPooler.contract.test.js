import { describe, it, expect } from 'vitest'
import {
  parseDisposableDbUri,
  evaluatePhase4bTarget,
  EXPECTED_DISPOSABLE_PROJECT_NAME,
  AUTHORIZED_DISPOSABLE_PROJECT_REF,
  AUTHORIZED_DISPOSABLE_API_HOST,
  WITHDRAWN_TRANSCRIPTION_REF,
  DENIED_PRODUCTION_REF_PREFIX,
} from '../../src/lib/phase4bTargetGuard.js'

const REF = AUTHORIZED_DISPOSABLE_PROJECT_REF
const POOLER = `postgresql://postgres.${REF}:secret@aws-0-us-west-2.pooler.supabase.com:5432/postgres`
const DIRECT = `postgresql://postgres:secret@db.${REF}.supabase.co:5432/postgres`

function authorizedTarget(overrides = {}) {
  return {
    disposableUrl: `https://${AUTHORIZED_DISPOSABLE_API_HOST}`,
    appViteUrl: 'https://other.example.invalid',
    confirmed: 'yes',
    explicitDisposableRef: REF,
    projectName: EXPECTED_DISPOSABLE_PROJECT_NAME,
    syntheticDataMode: 'yes',
    productionDataImport: 'disabled',
    disposableDbUrl: POOLER,
    ...overrides,
  }
}

describe('f10c2 phase4b-e session pooler guard', () => {
  it('accepts session pooler identity from username suffix, not hostname', () => {
    const parsed = parseDisposableDbUri(POOLER, REF)
    expect(parsed.ok).toBe(true)
    expect(parsed.schemeValid).toBe(true)
    expect(parsed.mode).toBe('session pooler')
    expect(parsed.usernameRefMatches).toBe(true)
    expect(parsed.port).toBe(5432)
    expect(parsed.database).toBe('postgres')
    expect(parsed.hostname.endsWith('.pooler.supabase.com')).toBe(true)
    expect(parsed.hostname.includes(REF)).toBe(false)
  })

  it('accepts direct db.<ref>.supabase.co', () => {
    const parsed = parseDisposableDbUri(DIRECT, REF)
    expect(parsed.ok).toBe(true)
    expect(parsed.mode).toBe('direct')
  })

  it('requires ref, API host, and pooler username to agree on the authorized disposable identity', () => {
    const accepted = evaluatePhase4bTarget(authorizedTarget())
    expect(accepted.ok).toBe(true)
    expect(accepted.identitySignalsAgree).toBe(true)
    expect(accepted.authorizedProjectRef).toBe(REF)
    expect(accepted.dbUri.usernameRefMatches).toBe(true)
  })

  it('rejects the withdrawn transcription-error ref even when internally consistent', () => {
    const wrong = WITHDRAWN_TRANSCRIPTION_REF
    const result = evaluatePhase4bTarget(authorizedTarget({
      disposableUrl: `https://${wrong}.supabase.co`,
      explicitDisposableRef: wrong,
      disposableDbUrl: `postgresql://postgres.${wrong}:secret@aws-0-us-west-2.pooler.supabase.com:5432/postgres`,
    }))
    expect(result.ok).toBe(false)
    expect(result.reasons.join(' ')).toMatch(/transcription-error/)
  })

  it('rejects pooler username for another project when API host is authorized', () => {
    const result = evaluatePhase4bTarget(authorizedTarget({
      disposableDbUrl: `postgresql://postgres.${WITHDRAWN_TRANSCRIPTION_REF}:secret@aws-0-us-west-2.pooler.supabase.com:5432/postgres`,
    }))
    expect(result.ok).toBe(false)
    expect(result.reasons.join(' ')).toMatch(/must agree|another project|authorized-project-ref/)
  })

  it('rejects duplicated scheme, port 6543, wrong username, nsne, and non-supabase pooler', () => {
    expect(parseDisposableDbUri(`postgresql:postgresql://postgres.${REF}:x@aws-0-us-west-2.pooler.supabase.com:5432/postgres`, REF).ok).toBe(false)
    expect(parseDisposableDbUri(`postgresql://postgres.${REF}:x@aws-0-us-west-2.pooler.supabase.com:6543/postgres`, REF).reasons.join(' ')).toMatch(/6543/)
    expect(parseDisposableDbUri('postgresql://postgres.otherref:x@aws-0-us-west-2.pooler.supabase.com:5432/postgres', REF).ok).toBe(false)
    expect(parseDisposableDbUri(`postgresql://postgres.${DENIED_PRODUCTION_REF_PREFIX}zzzz:x@aws-0-us-west-2.pooler.supabase.com:5432/postgres`, REF).ok).toBe(false)
    expect(parseDisposableDbUri(`postgresql://postgres.${REF}:x@evil.pooler.example.com:5432/postgres`, REF).ok).toBe(false)
    expect(parseDisposableDbUri('postgresql://:x@aws-0-us-west-2.pooler.supabase.com:5432/postgres', REF).ok).toBe(false)
  })

  it('still rejects production API identity', () => {
    const result = evaluatePhase4bTarget(authorizedTarget({
      disposableUrl: `https://${DENIED_PRODUCTION_REF_PREFIX}zzzz.supabase.co`,
      explicitDisposableRef: `${DENIED_PRODUCTION_REF_PREFIX}zzzz`,
    }))
    expect(result.ok).toBe(false)
    expect(result.reasons.join(' ')).toMatch(/denied production prefix/)
  })
})
