// F10C1I Phase 2 R1 — admin-create-user handler (injectable deps).
// NOT DEPLOYED. Compensates orphaned Auth users if profile upsert fails.

import { buildCorsHeaders, handleCorsPreflight, parseAllowedOrigins } from '../_shared/cors.ts'
import {
  AuthzError,
  assertAdminOrSuperAdmin,
  assertMaySetRole,
  type AppRole,
  type CallerProfile,
} from '../_shared/authz.ts'
import { writeSecurityAudit, AuditWriteError } from '../_shared/audit.ts'
import { errorResponse, jsonResponse } from '../_shared/response.ts'

export type CreateUserDeps = {
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
      upsert: (row: Record<string, unknown>) => Promise<{ error: unknown }>
      insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>
    }
    auth: {
      admin: {
        createUser: (attrs: {
          email: string
          password: string
          email_confirm: boolean
        }) => Promise<{ data: { user: { id: string } | null }; error: { message?: string } | null }>
        deleteUser: (id: string) => Promise<{ data: unknown; error: unknown }>
      }
    }
  }
}

const ALLOWED_ROLES: AppRole[] = ['fe', 'admin', 'super_admin']

function isDuplicateIdentityError(err: { message?: string } | null | undefined): boolean {
  const msg = (err?.message ?? '').toLowerCase()
  return msg.includes('already') || msg.includes('duplicate') || msg.includes('exists')
}

export async function handleAdminCreateUser(
  req: Request,
  deps: CreateUserDeps,
): Promise<Response> {
  const origins = deps.getAllowedOrigins()
  const cors = buildCorsHeaders(req, origins)
  const pre = handleCorsPreflight(req, origins)
  if (pre) return pre

  let actorId: string | null = null
  let service: ReturnType<CreateUserDeps['getServiceClient']> | null = null
  let createdUserId: string | null = null
  let authCreated = false

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
    const email = typeof body?.email === 'string' ? body.email.trim() : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    const role = body?.role as AppRole
    if (!email || !password || password.length < 8) throw new AuthzError('invalid_body', 400)
    if (!ALLOWED_ROLES.includes(role)) throw new AuthzError('invalid_role', 400)

    assertMaySetRole(caller, role)
    if (caller.role === 'admin' && role !== 'fe') {
      throw new AuthzError('admin_may_create_fe_only', 403)
    }

    service = deps.getServiceClient()
    const { data: created, error: createErr } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (createErr || !created.user) {
      if (isDuplicateIdentityError(createErr)) {
        throw new AuthzError('duplicate_email', 409)
      }
      throw new AuthzError('create_failed', 400)
    }
    authCreated = true
    createdUserId = created.user.id

    const { error: upsertErr } = await service.from('profiles').upsert({
      id: created.user.id,
      email,
      role,
      is_active: true,
    })

    if (upsertErr) {
      const { error: delErr } = await service.auth.admin.deleteUser(created.user.id)
      if (delErr) {
        // Compensation failed — Auth user may be orphaned; require manual reconciliation.
        await writeSecurityAudit(
          async (row) => service!.from('security_audit_log').insert(row),
          {
            actor_user_id: actorId,
            action: 'admin_create_user',
            target_type: 'auth.users',
            target_id: created.user.id,
            outcome: 'error',
            detail: {
              code: 'profile_upsert_failed_cleanup_failed',
              reconcile: 'manual_delete_orphaned_auth_user',
            },
          },
        ).catch(() => {
          /* still return sanitized error below */
        })
        throw new AuthzError('profile_upsert_failed_cleanup_failed', 500)
      }
      // Cleanup succeeded — no duplicate identity on retry
      createdUserId = null
      authCreated = false
      throw new AuthzError('profile_upsert_failed', 500)
    }

    await writeSecurityAudit(
      async (row) => service!.from('security_audit_log').insert(row),
      {
        actor_user_id: actorId,
        action: 'admin_create_user',
        target_type: 'profiles',
        target_id: created.user.id,
        outcome: 'success',
        detail: { role },
      },
    )

    return jsonResponse({ id: created.user.id, email, role }, 200, cors)
  } catch (err) {
    if (service && actorId) {
      try {
        await writeSecurityAudit(
          async (row) => service!.from('security_audit_log').insert(row),
          {
            actor_user_id: actorId,
            action: 'admin_create_user',
            target_type: createdUserId ? 'auth.users' : 'profiles',
            target_id: createdUserId,
            outcome: err instanceof AuthzError && err.status < 500 ? 'denied' : 'error',
            detail: {
              code: err instanceof AuthzError ? err.code : 'internal_error',
              auth_created: authCreated,
            },
          },
        )
      } catch {
        // If Auth user was created and profile path already returned a specific code, keep it.
        if (authCreated && createdUserId && !(err instanceof AuthzError && err.code.includes('cleanup'))) {
          // Prefer reporting original sanitized error; audit failure after mutation → partial.
        }
      }
    }
    if (err instanceof AuditWriteError && authCreated) {
      return jsonResponse(
        {
          id: createdUserId,
          warning: 'audit_write_failed_reconcile',
        },
        200,
        cors,
      )
    }
    return errorResponse(err, cors)
  }
}

export function createDefaultCreateUserDeps(env: {
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  ALLOWED_ORIGINS?: string
  createClient: (url: string, key: string, opts?: unknown) => unknown
}): CreateUserDeps {
  return {
    getAllowedOrigins: () => parseAllowedOrigins(env.ALLOWED_ORIGINS),
    getUserClient: (authHeader: string) => {
      if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) throw new AuthzError('misconfigured', 500)
      return env.createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      }) as ReturnType<CreateUserDeps['getUserClient']>
    },
    getServiceClient: () => {
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
        throw new AuthzError('misconfigured', 500)
      }
      return env.createClient(
        env.SUPABASE_URL,
        env.SUPABASE_SERVICE_ROLE_KEY,
      ) as ReturnType<CreateUserDeps['getServiceClient']>
    },
  }
}
