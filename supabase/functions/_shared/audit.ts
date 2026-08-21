// F10C1I Phase 2 R1 — undeployed audit writer helper.
// Writes only through server path (service_role) after JWT+authz.
// Never logs passwords, JWTs, headers, keys, raw bodies, or raw provider errors.

export type AuditOutcome = 'success' | 'denied' | 'error'

export type AuditEvent = {
  actor_user_id: string | null
  action: string
  target_type?: string | null
  target_id?: string | null
  outcome: AuditOutcome
  detail?: unknown
}

export class AuditWriteError extends Error {
  code = 'audit_write_failed'
  constructor(message = 'audit_write_failed') {
    super(message)
  }
}

const FORBIDDEN_KEY_FRAGMENTS = [
  'password',
  'passwd',
  'token',
  'jwt',
  'authorization',
  'apikey',
  'api_key',
  'service_role',
  'secret',
  'bearer',
  'cookie',
  'set-cookie',
  'private_key',
  'refresh_token',
  'access_token',
]

function isForbiddenKey(key: string): boolean {
  const lower = key.toLowerCase()
  return FORBIDDEN_KEY_FRAGMENTS.some((f) => lower.includes(f))
}

function looksLikeJwt(value: string): boolean {
  return /^eyJ[A-Za-z0-9_-]+\./.test(value)
}

/**
 * Recursively sanitize nested objects/arrays for audit detail.
 * Drops forbidden keys; redacts JWT-shaped strings; never retains raw secrets.
 */
export function sanitizeDetail(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[truncated]'
  if (value == null) return value
  if (typeof value === 'string') {
    if (looksLikeJwt(value)) return '[redacted]'
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeDetail(v, depth + 1))
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isForbiddenKey(k)) continue
      out[k] = sanitizeDetail(v, depth + 1)
    }
    return out
  }
  return String(value)
}

export type AuditInsertResult = { error?: unknown | null }

/**
 * Insert into public.security_audit_log via injected insertFn.
 * MUST check { error } from every audit insert.
 * On insert failure: throws AuditWriteError (callers apply fail-closed / partial-failure policy).
 */
export async function writeSecurityAudit(
  insertRow: (row: Record<string, unknown>) => Promise<AuditInsertResult | void>,
  event: AuditEvent,
): Promise<void> {
  const safeDetail =
    event.detail === undefined || event.detail === null
      ? null
      : sanitizeDetail(event.detail)

  const result = await insertRow({
    actor_user_id: event.actor_user_id,
    action: event.action,
    target_type: event.target_type ?? null,
    target_id: event.target_id ?? null,
    outcome: event.outcome,
    detail: safeDetail,
  })

  if (result && typeof result === 'object' && 'error' in result && result.error) {
    throw new AuditWriteError('audit_write_failed')
  }
}
