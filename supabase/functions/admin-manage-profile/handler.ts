// F10C1I Phase 2 R1 — admin-manage-profile handler (injectable deps).
// NOT DEPLOYED. Hierarchy before mutation. Not claimed atomic across Auth+DB.

import { buildCorsHeaders, handleCorsPreflight, parseAllowedOrigins } from '../_shared/cors.ts'
import {
  AuthzError,
  assertMayManageProfile,
  isUuid,
  type AppRole,
  type CallerProfile,
} from '../_shared/authz.ts'
import { writeSecurityAudit, AuditWriteError } from '../_shared/audit.ts'
import { errorResponse, jsonResponse } from '../_shared/response.ts'

export type ManageProfileDeps = {
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
        // count active super_admins
      }
      update: (patch: Record<string, unknown>) => {
        eq: (col: string, val: string) => {
          select: (cols: string) => Promise<{ data: unknown[] | null; error: unknown }>
        }
      }
      insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>
    }
    countActiveSuperAdmins: () => Promise<number>
  }
}

const ALLOWED_BODY_KEYS = new Set(['user_id', 'role', 'is_active'])

export async function handleAdminManageProfile(
  req: Request,
  deps: ManageProfileDeps,
): Promise<Response> {
  const origins = deps.getAllowedOrigins()
  const cors = buildCorsHeaders(req, origins)
  const pre = handleCorsPreflight(req, origins)
  if (pre) return pre

  let actorId: string | null = null
  let service: ReturnType<ManageProfileDeps['getServiceClient']> | null = null
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

    const body = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new AuthzError('invalid_body', 400)
    }
    const unknown = Object.keys(body).filter((k) => !ALLOWED_BODY_KEYS.has(k))
    if (unknown.length) throw new AuthzError('unknown_fields', 400)

    const targetIdRaw = typeof body.user_id === 'string' ? body.user_id.trim() : ''
    if (!isUuid(targetIdRaw)) throw new AuthzError('invalid_user_id', 400)
    targetId = targetIdRaw

    const patch: { role?: AppRole; is_active?: boolean } = {}
    if (body.role !== undefined) {
      if (body.role !== 'fe' && body.role !== 'admin' && body.role !== 'super_admin') {
        throw new AuthzError('invalid_role', 400)
      }
      patch.role = body.role
    }
    if (body.is_active !== undefined) {
      if (typeof body.is_active !== 'boolean') throw new AuthzError('invalid_is_active', 400)
      patch.is_active = body.is_active
    }
    if (Object.keys(patch).length === 0) throw new AuthzError('empty_patch', 400)

    service = deps.getServiceClient()
    const { data: target, error: targetErr } = await service
      .from('profiles')
      .select('id, role, is_active, email')
      .eq('id', targetId)
      .maybeSingle()
    if (targetErr || !target) throw new AuthzError('target_not_found', 404)

    // NOTE (disposable validation): target.role may race between authz check and update.
    // This handler does not claim atomic cross-service locking.
    const activeSuperAdminCount = await service.countActiveSuperAdmins()

    assertMayManageProfile({
      caller,
      target: target as CallerProfile,
      patch,
      activeSuperAdminCount,
    })

    const { data: updatedRows, error: updErr } = await service
      .from('profiles')
      .update(patch)
      .eq('id', targetId)
      .select('id')
    if (updErr) throw new AuthzError('update_failed', 400)
    if (!updatedRows || updatedRows.length !== 1) {
      throw new AuthzError('update_row_mismatch', 409)
    }
    mutationDone = true

    await writeSecurityAudit(
      async (row) => service!.from('security_audit_log').insert(row),
      {
        actor_user_id: actorId,
        action: 'admin_manage_profile',
        target_type: 'profiles',
        target_id: targetId,
        outcome: 'success',
        detail: { fields: Object.keys(patch) },
      },
    )

    return jsonResponse({ ok: true, id: targetId, updated: Object.keys(patch) }, 200, cors)
  } catch (err) {
    if (service && actorId) {
      try {
        await writeSecurityAudit(
          async (row) => service!.from('security_audit_log').insert(row),
          {
            actor_user_id: actorId,
            action: 'admin_manage_profile',
            target_type: 'profiles',
            target_id: targetId,
            outcome: err instanceof AuthzError && err.status < 500 ? 'denied' : 'error',
            detail: {
              code: err instanceof AuthzError ? err.code : 'internal_error',
              mutation_done: mutationDone,
            },
          },
        )
      } catch (auditErr) {
        if (mutationDone) {
          return jsonResponse(
            { ok: true, id: targetId, warning: 'audit_write_failed_reconcile' },
            200,
            cors,
          )
        }
        if (auditErr instanceof AuditWriteError) return errorResponse(auditErr, cors)
      }
    }
    return errorResponse(err, cors)
  }
}

export function createDefaultManageProfileDeps(env: {
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  ALLOWED_ORIGINS?: string
  createClient: (url: string, key: string, opts?: unknown) => unknown
}): ManageProfileDeps {
  return {
    getAllowedOrigins: () => parseAllowedOrigins(env.ALLOWED_ORIGINS),
    getUserClient: (authHeader: string) => {
      if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) throw new AuthzError('misconfigured', 500)
      return env.createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      }) as ReturnType<ManageProfileDeps['getUserClient']>
    },
    getServiceClient: () => {
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
        throw new AuthzError('misconfigured', 500)
      }
      const client = env.createClient(
        env.SUPABASE_URL,
        env.SUPABASE_SERVICE_ROLE_KEY,
      ) as ReturnType<ManageProfileDeps['getServiceClient']> & {
        from: ManageProfileDeps['getServiceClient'] extends () => infer R ? R['from'] : never
      }
      return {
        from: client.from.bind(client),
        countActiveSuperAdmins: async () => {
          // Runtime Edge: count via query. Injected in tests.
          const anyClient = client as {
            from: (t: string) => {
              select: (
                cols: string,
                opts: { count: string; head: boolean },
              ) => {
                eq: (c: string, v: string) => {
                  eq: (
                    c2: string,
                    v2: boolean,
                  ) => Promise<{ count: number | null; error: unknown }>
                }
              }
            }
          }
          const { count, error } = await anyClient
            .from('profiles')
            .select('id', { count: 'exact', head: true })
            .eq('role', 'super_admin')
            .eq('is_active', true)
          if (error) throw new AuthzError('super_admin_count_failed', 500)
          return count ?? 0
        },
      }
    },
  }
}
