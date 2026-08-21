import { describe, it, expect } from 'vitest'
import {
  assertMayResetPassword,
  assertMayManageProfile,
  assertMaySetRole,
  AuthzError,
} from '../../../supabase/functions/_shared/authz.ts'

const admin = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'admin', is_active: true, email: 'a@x' }
const sa = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', role: 'super_admin', is_active: true, email: 's@x' }
const fe = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', role: 'fe', is_active: true, email: 'f@x' }
const admin2 = { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', role: 'admin', is_active: true, email: 'a2@x' }
const sa2 = { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', role: 'super_admin', is_active: true, email: 's2@x' }

function expectCode(fn, code) {
  try {
    fn()
    throw new Error('expected throw')
  } catch (e) {
    expect(e).toBeInstanceOf(AuthzError)
    expect(e.code).toBe(code)
  }
}

describe('edge.authz.behavior — reset password matrix', () => {
  it('admin resets FE; denies admin/SA/self', () => {
    expect(() => assertMayResetPassword(admin, fe)).not.toThrow()
    expectCode(() => assertMayResetPassword(admin, admin2), 'admin_may_reset_fe_only')
    expectCode(() => assertMayResetPassword(admin, sa), 'admin_may_reset_fe_only')
    expectCode(() => assertMayResetPassword(admin, admin), 'self_reset_forbidden')
  })

  it('super_admin resets FE and admin; fail-closed on other SA and self', () => {
    expect(() => assertMayResetPassword(sa, fe)).not.toThrow()
    expect(() => assertMayResetPassword(sa, admin2)).not.toThrow()
    expectCode(() => assertMayResetPassword(sa, sa2), 'super_admin_reset_forbidden')
    expectCode(() => assertMayResetPassword(sa, sa), 'self_reset_forbidden')
  })
})

describe('edge.authz.behavior — manage profile hierarchy', () => {
  it('admin activates FE only; cannot change roles', () => {
    expect(() =>
      assertMayManageProfile({
        caller: admin,
        target: fe,
        patch: { is_active: false },
        activeSuperAdminCount: 2,
      }),
    ).not.toThrow()
    expectCode(
      () =>
        assertMayManageProfile({
          caller: admin,
          target: admin2,
          patch: { is_active: false },
          activeSuperAdminCount: 2,
        }),
      'admin_may_activate_fe_only',
    )
    expectCode(
      () =>
        assertMayManageProfile({
          caller: admin,
          target: fe,
          patch: { role: 'admin' },
          activeSuperAdminCount: 2,
        }),
      'admin_cannot_change_roles',
    )
  })

  it('blocks final active super_admin deactivation/demotion and self-deactivation', () => {
    expectCode(
      () =>
        assertMayManageProfile({
          caller: sa,
          target: sa,
          patch: { is_active: false },
          activeSuperAdminCount: 1,
        }),
      'final_super_admin_deactivation_forbidden',
    )
    expectCode(
      () =>
        assertMayManageProfile({
          caller: sa,
          target: sa,
          patch: { role: 'admin' },
          activeSuperAdminCount: 1,
        }),
      'final_super_admin_demotion_forbidden',
    )
    expectCode(
      () =>
        assertMayManageProfile({
          caller: sa,
          target: sa,
          patch: { is_active: false },
          activeSuperAdminCount: 2,
        }),
      'self_deactivation_forbidden',
    )
  })

  it('SA may set admin role', () => {
    expect(() => assertMaySetRole(sa, 'admin')).not.toThrow()
    expectCode(() => assertMaySetRole(admin, 'admin'), 'super_admin_required')
  })
})
