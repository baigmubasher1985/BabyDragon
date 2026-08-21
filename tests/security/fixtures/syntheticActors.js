/**
 * Synthetic actors for F10C1I Phase 1 security contracts.
 * Synthetic UUIDs only — no production users, JWTs, or project refs.
 */

export const SYNTHETIC_UUIDS = {
  feA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  feB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  inactiveFe: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  admin: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  superAdmin: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  project: '11111111-1111-4111-8111-111111111111',
  taskAssignedToFeA: '22222222-2222-4222-8222-222222222222',
  taskAssignedToFeB: '33333333-3333-4333-8333-333333333333',
  taskUnassigned: '44444444-4444-4444-8444-444444444444',
  artifact: '55555555-5555-4555-8555-555555555555',
  grid: '66666666-6666-4666-8666-666666666666',
  route: '77777777-7777-4777-8777-777777777777',
}

export const ACTORS = {
  ANON: {
    id: null,
    role: null,
    is_active: false,
    label: 'ANON',
  },
  INACTIVE_FE: {
    id: SYNTHETIC_UUIDS.inactiveFe,
    role: 'fe',
    is_active: false,
    label: 'INACTIVE_FE',
  },
  ACTIVE_ASSIGNED_FE: {
    id: SYNTHETIC_UUIDS.feA,
    role: 'fe',
    is_active: true,
    label: 'ACTIVE_ASSIGNED_FE',
    assignedTaskId: SYNTHETIC_UUIDS.taskAssignedToFeA,
  },
  UNASSIGNED_FE: {
    id: SYNTHETIC_UUIDS.feB,
    role: 'fe',
    is_active: true,
    label: 'UNASSIGNED_FE',
    // Active FE but not assigned to taskAssignedToFeA
    assignedTaskId: SYNTHETIC_UUIDS.taskAssignedToFeB,
  },
  ADMIN: {
    id: SYNTHETIC_UUIDS.admin,
    role: 'admin',
    is_active: true,
    label: 'ADMIN',
  },
  SUPER_ADMIN: {
    id: SYNTHETIC_UUIDS.superAdmin,
    role: 'super_admin',
    is_active: true,
    label: 'SUPER_ADMIN',
  },
}

/** Fail-closed active check — mirrors future helper contract. */
export function isActiveFailClosed(actor) {
  return actor?.is_active === true
}

export function isAdminOrSuperAdmin(actor) {
  return (
    isActiveFailClosed(actor) &&
    (actor.role === 'admin' || actor.role === 'super_admin')
  )
}

export function isSuperAdmin(actor) {
  return isActiveFailClosed(actor) && actor.role === 'super_admin'
}
