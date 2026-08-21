// F10C1I Phase 2 R1 — admin-reset-password handler (injectable deps for local tests).
// NOT DEPLOYED. Target user UUID authoritative. Never return/log/audit password.

import { buildCorsHeaders, handleCorsPreflight, parseAllowedOrigins } from '../_shared/cors.ts'
import {
  AuthzError,
  assertAdminOrSuperAdmin,
  assertMayResetPassword,
  isUuid,
  type AppRole,
  type CallerProfile,
} from '../_shared/authz.ts'
import { writeSecurityAudit, AuditWriteError } from '../_shared/audit.ts'
import { errorResponse, jsonResponse } from '../_shared/response.ts'

export type ResetPasswordDeps = {
  getAllowedOrigins: () => string[]
  getUserClient: (authHeader: string) => {
    auth: { getUser: () => Promise<{ data: { user: { id: string } | null }; error: unknown }> }
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: CallerProfile | null; error: unknown }>
        }
      }
    }
  }
  getServiceClient: () => {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: CallerProfile | null; error: unknown }>
        }
      }
      insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>
    }
    auth: {
      admin: {
        updateUserById: (
          id: string,
          attrs: { password: string },
        ) => Promise<{ data: unknown; error: unknown }>
      }
    }
  }
}

function defaultOrigins(): string[] {
  return parseAllowedOrigins(
    typeof Deno !== 'undefined' ? Deno.env.get('ALLOWED_ORIGINS') : undefined,
  )
}

export async function handleAdminResetPassword(
  req: Request,
  deps: ResetPasswordDeps,
): Promise<Response> {
  const origins = deps.getAllowedOrigins()
  const cors = buildCorsHeaders(req, origins)
  const pre = handleCorsPreflight(req, origins)
  if (pre) return pre

  let actorId: string | null = null
  let service: ReturnType<ResetPasswordDeps['getServiceClient']> | null = null
  let mutationDone = false
  let targetId: string | null = null

  try {
    if (req.method !== 'POST') throw new AuthzError('method_not_allowed', 405)

    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = deps.getUserClient(authHeader)
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser()
    if (userErr || !user) throw new AuthzError('invalid_jwt', 401)
    actorId = user.id

    const { data: profile, error: profileErr } = await userClient
      .from('profiles')
      .select('id, role, is_active, email')
      .eq('id', user.id)
      .maybeSingle()
    if (profileErr || !profile) throw new AuthzError('profile_missing', 403)
    const caller = profile as CallerProfile
    assertAdminOrSuperAdmin(caller)

    const body = await req.json()
    // Reject unknown authoritative identity fields; UUID is required (not email).
    if (body?.email !== undefined && body?.user_id === undefined) {
      throw new AuthzError('user_id_required_not_email', 400)
    }
    const userId = typeof body?.user_id === 'string' ? body.user_id.trim() : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    if (!isUuid(userId)) throw new AuthzError('invalid_user_id', 400)
    if (!password || password.length < 8) throw new AuthzError('invalid_body', 400)

    service = deps.getServiceClient()
    const { data: target, error: targetErr } = await service
      .from('profiles')
      .select('id, role, is_active, email')
      .eq('id', userId)
      .maybeSingle()
    if (targetErr || !target) throw new AuthzError('target_not_found', 404)

    assertMayResetPassword(caller, {
      id: target.id,
      role: target.role as AppRole,
    })

    const { error: updErr } = await service.auth.admin.updateUserById(userId, { password })
    if (updErr) throw new AuthzError('reset_failed', 400)
    mutationDone = true
    targetId = userId

    await writeSecurityAudit(
      async (row) => service!.from('security_audit_log').insert(row),
      {
        actor_user_id: actorId,
        action: 'admin_reset_password',
        target_type: 'auth.users',
        target_id: userId,
        outcome: 'success',
        detail: { target_role: target.role },
      },
    )

    return jsonResponse({ ok: true, user_id: userId }, 200, cors)
  } catch (err) {
    if (service && actorId) {
      try {
        await writeSecurityAudit(
          async (row) => service!.from('security_audit_log').insert(row),
          {
            actor_user_id: actorId,
            action: 'admin_reset_password',
            target_type: 'auth.users',
            target_id: targetId,
            outcome: err instanceof AuthzError && err.status < 500 ? 'denied' : 'error',
            detail: {
              code: err instanceof AuthzError ? err.code : 'internal_error',
              mutation_done: mutationDone,
            },
          },
        )
      } catch (auditErr) {
        // Mutation already happened: prefer safe partial-failure over undoing Auth password.
        if (mutationDone) {
          return jsonResponse(
            { ok: true, user_id: targetId, warning: 'audit_write_failed_reconcile' },
            200,
            cors,
          )
        }
        if (auditErr instanceof AuditWriteError && !(err instanceof AuthzError)) {
          return errorResponse(auditErr, cors)
        }
      }
    }
    // Fail-closed when no irreversible mutation yet and audit failed on success path handled above.
    if (err instanceof AuditWriteError && !mutationDone) {
      return errorResponse(err, cors)
    }
    return errorResponse(err, cors)
  }
}

export function createDefaultResetDeps(env: {
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  ALLOWED_ORIGINS?: string
  createClient: (url: string, key: string, opts?: unknown) => unknown
}): ResetPasswordDeps {
  return {
    getAllowedOrigins: () => parseAllowedOrigins(env.ALLOWED_ORIGINS),
    getUserClient: (authHeader: string) => {
      if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) throw new AuthzError('misconfigured', 500)
      return env.createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      }) as ReturnType<ResetPasswordDeps['getUserClient']>
    },
    getServiceClient: () => {
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
        throw new AuthzError('misconfigured', 500)
      }
      return env.createClient(
        env.SUPABASE_URL,
        env.SUPABASE_SERVICE_ROLE_KEY,
      ) as ReturnType<ResetPasswordDeps['getServiceClient']>
    },
  }
}

// Silence unused defaultOrigins in pure handler module (used by index).
void defaultOrigins
