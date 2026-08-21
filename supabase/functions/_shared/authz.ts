// F10C1I Phase 2 R1 — undeployed authz helpers.
// service_role must never appear in client/APK/Vite source.

export type AppRole = 'fe' | 'admin' | 'super_admin'

export type CallerProfile = {
  id: string
  role: AppRole
  is_active: boolean
  email: string | null
}

export class AuthzError extends Error {
  status: number
  code: string
  constructor(code: string, status = 403) {
    super(code)
    this.code = code
    this.status = status
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

/** Fail closed: is_active must be strictly true. */
export function assertActive(
  profile: CallerProfile | null | undefined,
): asserts profile is CallerProfile {
  if (!profile || profile.is_active !== true) {
    throw new AuthzError('inactive_or_unknown', 403)
  }
}

export function assertAdminOrSuperAdmin(profile: CallerProfile): void {
  assertActive(profile)
  if (profile.role !== 'admin' && profile.role !== 'super_admin') {
    throw new AuthzError('admin_required', 403)
  }
}

export function assertSuperAdmin(profile: CallerProfile): void {
  assertActive(profile)
  if (profile.role !== 'super_admin') {
    throw new AuthzError('super_admin_required', 403)
  }
}

/** Admin may manage FE activation only; SA required for admin/super_admin grants. */
export function assertMaySetRole(caller: CallerProfile, nextRole: AppRole): void {
  assertActive(caller)
  if (nextRole === 'fe') {
    assertAdminOrSuperAdmin(caller)
    return
  }
  if (nextRole === 'admin' || nextRole === 'super_admin') {
    assertSuperAdmin(caller)
    return
  }
  throw new AuthzError('invalid_role', 400)
}

export function assertMaySetIsActive(caller: CallerProfile, targetRole: AppRole): void {
  assertActive(caller)
  if (targetRole === 'fe') {
    assertAdminOrSuperAdmin(caller)
    return
  }
  assertSuperAdmin(caller)
}

/**
 * Password reset hierarchy:
 * - Admin resets FE only; Admin must NOT reset admin/super_admin
 * - Only super_admin resets admin
 * - Fail-closed: super_admin may NOT reset another super_admin (no proven requirement)
 * - Self-reset via this endpoint forbidden
 */
export function assertMayResetPassword(
  caller: CallerProfile,
  target: { id: string; role: AppRole },
): void {
  assertAdminOrSuperAdmin(caller)
  if (caller.id === target.id) {
    throw new AuthzError('self_reset_forbidden', 403)
  }
  if (caller.role === 'admin' && target.role !== 'fe') {
    throw new AuthzError('admin_may_reset_fe_only', 403)
  }
  if (target.role === 'fe') {
    return
  }
  if (target.role === 'admin') {
    // Only reachable for super_admin callers after the admin gate above.
    return
  }
  if (target.role === 'super_admin') {
    throw new AuthzError('super_admin_reset_forbidden', 403)
  }
  throw new AuthzError('invalid_target_role', 400)
}

/**
 * Profile manage hierarchy before mutation.
 * Admin: FE activation only; Admin may not change roles.
 * SA: may grant/revoke admin-level; fail-closed rules for final active SA.
 */
export function assertMayManageProfile(args: {
  caller: CallerProfile
  target: CallerProfile
  patch: { role?: AppRole; is_active?: boolean }
  activeSuperAdminCount?: number
}): void {
  const { caller, target, patch, activeSuperAdminCount } = args
  assertAdminOrSuperAdmin(caller)

  if (patch.role !== undefined) {
    if (caller.role === 'admin') {
      throw new AuthzError('admin_cannot_change_roles', 403)
    }
    assertMaySetRole(caller, patch.role)
    // Self-demotion from super_admin blocked unless another active SA remains
    if (
      caller.id === target.id &&
      caller.role === 'super_admin' &&
      patch.role !== 'super_admin'
    ) {
      if (activeSuperAdminCount == null || activeSuperAdminCount <= 1) {
        throw new AuthzError('final_super_admin_demotion_forbidden', 403)
      }
    }
  }

  if (patch.is_active !== undefined) {
    if (caller.role === 'admin' && target.role !== 'fe') {
      throw new AuthzError('admin_may_activate_fe_only', 403)
    }
    assertMaySetIsActive(caller, target.role)
    if (
      patch.is_active === false &&
      target.role === 'super_admin' &&
      (activeSuperAdminCount == null || activeSuperAdminCount <= 1)
    ) {
      throw new AuthzError('final_super_admin_deactivation_forbidden', 403)
    }
    if (caller.id === target.id && patch.is_active === false) {
      throw new AuthzError('self_deactivation_forbidden', 403)
    }
  }
}

export async function requireVerifiedUserId(
  getUser: () => Promise<{ id: string } | null>,
): Promise<string> {
  const user = await getUser()
  if (!user?.id) throw new AuthzError('invalid_jwt', 401)
  return user.id
}
