import { describe, it, expect } from 'vitest'

/**
 * Mirrors 004/005 draft decisions locally (no DB).
 * Server time authoritative; client event optional within skew.
 */
const FUTURE_SKEW_MS = 5 * 60 * 1000
const PAST_SKEW_MS = 24 * 60 * 60 * 1000

function resolveOptionalClientTime(clientTs, serverNow = Date.now()) {
  if (clientTs == null) return { ok: true, ts: serverNow, source: 'server' }
  const t = Date.parse(clientTs)
  if (Number.isNaN(t)) return { ok: false, reason: 'invalid_ts' }
  if (t > serverNow + FUTURE_SKEW_MS) return { ok: false, reason: 'far_future' }
  if (t < serverNow - PAST_SKEW_MS) return { ok: false, reason: 'too_old' }
  return { ok: true, ts: t, source: 'client' }
}

function resolveStartedAt({ existingStartedAt, status, pStartedAt, serverNow }) {
  if (existingStartedAt != null) {
    return { ok: true, startedAt: existingStartedAt, preserved: true }
  }
  if (status !== 'in_progress') {
    return { ok: true, startedAt: existingStartedAt, preserved: false }
  }
  const r = resolveOptionalClientTime(pStartedAt, serverNow)
  if (!r.ok) return r
  return { ok: true, startedAt: r.ts, preserved: false }
}

function resolveCompletedAt({ startedAt, pCompletedAt, serverNow }) {
  const r = resolveOptionalClientTime(pCompletedAt, serverNow)
  if (!r.ok) return r
  if (startedAt != null && r.ts < startedAt) return { ok: false, reason: 'completed_before_started' }
  return { ok: true, completedAt: r.ts }
}

function resolveChecklistClearOrComplete({ isDone, pEventAt, serverNow }) {
  if (!isDone) {
    return {
      ok: true,
      completed_at: null,
      completed_by: null,
      updated_at: serverNow, // clear uses server time
      clearUsesServerTime: true,
    }
  }
  const r = resolveOptionalClientTime(pEventAt, serverNow)
  if (!r.ok) return r
  return {
    ok: true,
    completed_at: r.ts,
    completed_by: 'auth.uid()',
    updated_at: r.ts,
  }
}

describe('rpc.eventTime.behavior — status + checklist', () => {
  const now = Date.parse('2026-08-20T12:00:00.000Z')

  it('preserves earlier legitimate started_at and rejects far-future client start', () => {
    const preserved = resolveStartedAt({
      existingStartedAt: now - 60_000,
      status: 'in_progress',
      pStartedAt: new Date(now).toISOString(),
      serverNow: now,
    })
    expect(preserved.preserved).toBe(true)
    expect(preserved.startedAt).toBe(now - 60_000)

    const far = resolveStartedAt({
      existingStartedAt: null,
      status: 'in_progress',
      pStartedAt: new Date(now + 10 * 60 * 1000).toISOString(),
      serverNow: now,
    })
    expect(far.ok).toBe(false)
    expect(far.reason).toBe('far_future')
  })

  it('rejects completed_at before started_at', () => {
    const r = resolveCompletedAt({
      startedAt: now,
      pCompletedAt: new Date(now - 1000).toISOString(),
      serverNow: now,
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('completed_before_started')
  })

  it('checklist clear nulls completion fields and stamps server updated_at', () => {
    const r = resolveChecklistClearOrComplete({
      isDone: false,
      pEventAt: new Date(now - 1000).toISOString(),
      serverNow: now,
    })
    expect(r.ok).toBe(true)
    expect(r.completed_at).toBeNull()
    expect(r.completed_by).toBeNull()
    expect(r.updated_at).toBe(now)
    expect(r.clearUsesServerTime).toBe(true)
  })

  it('checklist complete accepts in-window client event_at', () => {
    const r = resolveChecklistClearOrComplete({
      isDone: true,
      pEventAt: new Date(now - 30_000).toISOString(),
      serverNow: now,
    })
    expect(r.ok).toBe(true)
    expect(r.completed_by).toBe('auth.uid()')
    expect(r.completed_at).toBe(now - 30_000)
  })
})
