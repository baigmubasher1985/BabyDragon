// F10C1I Phase 2 R1 — undeployed Edge shared CORS helper.
// CORS is NOT authentication. JWT authz remains mandatory for non-OPTIONS.
// No secrets. No production URLs.

const DEFAULT_ALLOW_HEADERS = 'authorization, x-client-info, apikey, content-type'
const DEFAULT_ALLOW_METHODS = 'POST, OPTIONS'

export type CorsDecision = {
  allowed: boolean
  origin: string | null
  reason: 'allowed' | 'missing_allowlist' | 'empty_allowlist' | 'missing_origin' | 'disallowed_origin'
}

/**
 * Parse ALLOWED_ORIGINS env (comma-separated). Empty/missing → fail-closed.
 */
export function parseAllowedOrigins(raw: string | null | undefined): string[] {
  if (raw == null) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function evaluateCorsOrigin(
  requestOrigin: string | null | undefined,
  allowedOrigins: string[],
  allowlistPresent = true,
): CorsDecision {
  const origin = (requestOrigin ?? '').trim()
  if (!allowlistPresent) {
    return { allowed: false, origin: origin || null, reason: 'missing_allowlist' }
  }
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) {
    return { allowed: false, origin: origin || null, reason: 'empty_allowlist' }
  }
  if (!origin) {
    // Non-browser callers may omit Origin; CORS headers omitted; JWT still required.
    return { allowed: false, origin: null, reason: 'missing_origin' }
  }
  if (!allowedOrigins.includes(origin)) {
    return { allowed: false, origin, reason: 'disallowed_origin' }
  }
  return { allowed: true, origin, reason: 'allowed' }
}

/**
 * Strict CORS fail-closed:
 * - Missing/empty allowlist → no usable ACAO
 * - Disallowed Origin → omit ACAO
 * - Allowed Origin → reflect that origin only
 * Non-browser (no Origin) → omit ACAO; caller proceeds only via JWT on POST.
 */
export function buildCorsHeaders(req: Request, allowedOrigins: string[]): HeadersInit {
  const decision = evaluateCorsOrigin(req.headers.get('Origin'), allowedOrigins)
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': DEFAULT_ALLOW_HEADERS,
    'Access-Control-Allow-Methods': DEFAULT_ALLOW_METHODS,
    Vary: 'Origin',
  }
  if (decision.allowed && decision.origin) {
    headers['Access-Control-Allow-Origin'] = decision.origin
  }
  // Intentionally omit Access-Control-Allow-Origin when not allowed.
  return headers
}

/**
 * OPTIONS preflight: disallowed/missing allowlist must NOT look successful.
 */
export function handleCorsPreflight(req: Request, allowedOrigins: string[]): Response | null {
  if (req.method !== 'OPTIONS') return null

  if (!allowedOrigins.length) {
    return new Response(JSON.stringify({ error: 'cors_allowlist_missing' }), {
      status: 403,
      headers: {
        'Content-Type': 'application/json',
        Vary: 'Origin',
      },
    })
  }

  const decision = evaluateCorsOrigin(req.headers.get('Origin'), allowedOrigins)
  if (!decision.allowed || decision.reason === 'missing_origin') {
    return new Response(JSON.stringify({ error: 'cors_origin_not_allowed' }), {
      status: 403,
      headers: {
        'Content-Type': 'application/json',
        Vary: 'Origin',
      },
    })
  }

  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders(req, allowedOrigins),
  })
}
