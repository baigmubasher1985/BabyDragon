// F10C1I Phase 2 R1 — undeployed sanitized HTTP responses.

import { AuthzError } from './authz.ts'
import { AuditWriteError } from './audit.ts'

export function jsonResponse(
  body: unknown,
  status: number,
  corsHeaders: HeadersInit,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

/** Map errors to safe client codes — never leak internals, passwords, or provider raw errors. */
export function errorResponse(err: unknown, corsHeaders: HeadersInit): Response {
  if (err instanceof AuthzError) {
    return jsonResponse({ error: err.code }, err.status, corsHeaders)
  }
  if (err instanceof AuditWriteError) {
    return jsonResponse({ error: 'audit_write_failed' }, 500, corsHeaders)
  }
  return jsonResponse({ error: 'internal_error' }, 500, corsHeaders)
}
