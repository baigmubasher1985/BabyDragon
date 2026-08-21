import { describe, it, expect } from 'vitest'
import {
  buildCorsHeaders,
  evaluateCorsOrigin,
  handleCorsPreflight,
  parseAllowedOrigins,
} from '../../../supabase/functions/_shared/cors.ts'

describe('edge.cors.behavior — fail-closed', () => {
  it('missing allowlist yields no usable ACAO', () => {
    const d = evaluateCorsOrigin('https://app.example', [], false)
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('missing_allowlist')
    const headers = buildCorsHeaders(
      new Request('https://fn.local', { headers: { Origin: 'https://app.example' } }),
      [],
    )
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined()
  })

  it('empty allowlist yields no usable ACAO', () => {
    expect(parseAllowedOrigins('')).toEqual([])
    expect(parseAllowedOrigins('   ,  ')).toEqual([])
    const d = evaluateCorsOrigin('https://app.example', [])
    expect(d.reason).toBe('empty_allowlist')
    const headers = buildCorsHeaders(
      new Request('https://fn.local', { headers: { Origin: 'https://app.example' } }),
      [],
    )
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined()
  })

  it('allowed origin reflects ACAO', () => {
    const allowed = ['https://app.example']
    const headers = buildCorsHeaders(
      new Request('https://fn.local', { headers: { Origin: 'https://app.example' } }),
      allowed,
    )
    expect(headers['Access-Control-Allow-Origin']).toBe('https://app.example')
  })

  it('disallowed origin omits ACAO', () => {
    const headers = buildCorsHeaders(
      new Request('https://fn.local', { headers: { Origin: 'https://evil.example' } }),
      ['https://app.example'],
    )
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined()
  })

  it('OPTIONS from disallowed/missing allowlist is not successful', async () => {
    const denied = handleCorsPreflight(
      new Request('https://fn.local', {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil.example' },
      }),
      ['https://app.example'],
    )
    expect(denied).not.toBeNull()
    expect(denied.status).toBe(403)
    expect(denied.headers.get('Access-Control-Allow-Origin')).toBeNull()

    const missing = handleCorsPreflight(
      new Request('https://fn.local', {
        method: 'OPTIONS',
        headers: { Origin: 'https://app.example' },
      }),
      [],
    )
    expect(missing.status).toBe(403)

    const ok = handleCorsPreflight(
      new Request('https://fn.local', {
        method: 'OPTIONS',
        headers: { Origin: 'https://app.example' },
      }),
      ['https://app.example'],
    )
    expect(ok.status).toBe(204)
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example')
  })

  it('non-browser without Origin omits ACAO (JWT still required separately)', () => {
    const headers = buildCorsHeaders(new Request('https://fn.local', { method: 'POST' }), [
      'https://app.example',
    ])
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined()
  })

  it('documents CORS is not authentication', () => {
    // Even with allowed ACAO, handlers still require JWT — CORS only governs browser cross-origin.
    expect(true).toBe(true)
  })
})
