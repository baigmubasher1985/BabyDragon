import { describe, it, expect } from 'vitest'
import {
  ACTORS,
  isActiveFailClosed,
  isAdminOrSuperAdmin,
  isSuperAdmin,
} from './fixtures/syntheticActors.js'

/**
 * profiles role / is_active / email privileges.
 * Privileged writes via Edge after paired cutover only.
 */

const PRIVILEGED_PROFILE_COLUMNS = Object.freeze(['role', 'is_active', 'email'])

function mayClientUpdateProfileColumn(actor, targetProfileId, column) {
  if (!isActiveFailClosed(actor)) return false
  // After secure cutover: clients must not UPDATE privileged columns
  if (PRIVILEGED_PROFILE_COLUMNS.includes(column)) return false
  // Optional narrow self full_name only
  if (column === 'full_name' && actor.id === targetProfileId && actor.role === 'fe') {
    return true
  }
  return false
}

function mayEdgeActivateFe(caller) {
  return isAdminOrSuperAdmin(caller)
}

function mayEdgeGrantAdminOrSuperAdmin(caller) {
  return isSuperAdmin(caller)
}

describe('profileRole.contract', () => {
  it('denies FE client updates of role, is_active, email', () => {
    const fe = ACTORS.ACTIVE_ASSIGNED_FE
    for (const col of PRIVILEGED_PROFILE_COLUMNS) {
      expect(mayClientUpdateProfileColumn(fe, fe.id, col)).toBe(false)
    }
  })

  it('denies Admin client grant of admin/super_admin; Edge activate FE only', () => {
    expect(mayEdgeGrantAdminOrSuperAdmin(ACTORS.ADMIN)).toBe(false)
    expect(mayEdgeActivateFe(ACTORS.ADMIN)).toBe(true)
    expect(mayEdgeGrantAdminOrSuperAdmin(ACTORS.SUPER_ADMIN)).toBe(true)
  })

  it('denies inactive actors and anon for privileged Edge', () => {
    expect(mayEdgeActivateFe(ACTORS.INACTIVE_FE)).toBe(false)
    expect(mayEdgeActivateFe(ACTORS.ANON)).toBe(false)
    expect(mayEdgeActivateFe(ACTORS.ACTIVE_ASSIGNED_FE)).toBe(false)
  })

  it('fail-closed is_active IS TRUE (never COALESCE true)', () => {
    expect(isActiveFailClosed({ is_active: null })).toBe(false)
    expect(isActiveFailClosed({ is_active: undefined })).toBe(false)
    expect(isActiveFailClosed({ is_active: false })).toBe(false)
    expect(isActiveFailClosed({ is_active: true })).toBe(true)
  })

  it.todo(
    'Live Edge admin-manage-profile disposable tests — gated until disposable + Edge secrets authorized',
  )
})
