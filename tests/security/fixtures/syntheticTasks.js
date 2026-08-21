/**
 * Synthetic tasks for F10C1I Phase 1 security contracts.
 * No production task IDs.
 */

import { SYNTHETIC_UUIDS } from './syntheticActors.js'

export const TASKS = {
  assignedToFeA: {
    id: SYNTHETIC_UUIDS.taskAssignedToFeA,
    project_id: SYNTHETIC_UUIDS.project,
    grid_id: SYNTHETIC_UUIDS.grid,
    assigned_to: SYNTHETIC_UUIDS.feA,
    status: 'pending',
  },
  assignedToFeB: {
    id: SYNTHETIC_UUIDS.taskAssignedToFeB,
    project_id: SYNTHETIC_UUIDS.project,
    grid_id: SYNTHETIC_UUIDS.grid,
    assigned_to: SYNTHETIC_UUIDS.feB,
    status: 'in_progress',
  },
  unassigned: {
    id: SYNTHETIC_UUIDS.taskUnassigned,
    project_id: SYNTHETIC_UUIDS.project,
    grid_id: SYNTHETIC_UUIDS.grid,
    assigned_to: null,
    status: 'pending',
  },
}

/** Columns FE may update via update_assigned_task_status only. */
export const TASK_STATUS_RPC_ALLOWED_COLUMNS = Object.freeze([
  'status',
  'started_at',
  'completed_at',
])

export const TASK_STATUS_RPC_FORBIDDEN_COLUMNS = Object.freeze([
  'assigned_to',
  'project_id',
  'grid_id',
  'id',
  'created_at',
  'title',
])

/** Allowed FE from→to pairs (server-enforced). completed is terminal. */
export const APPROVED_STATUS_TRANSITION_PAIRS = Object.freeze([
  ['pending', 'in_progress'],
  ['on_hold', 'in_progress'],
  ['in_progress', 'on_hold'],
  ['in_progress', 'completed'],
])

/** @deprecated use APPROVED_STATUS_TRANSITION_PAIRS — kept for Phase 1 suite compatibility */
export const APPROVED_STATUS_TRANSITIONS = Object.freeze([
  'in_progress',
  'on_hold',
  'completed',
])

export function isApprovedStatusTransition(fromStatus, toStatus) {
  return APPROVED_STATUS_TRANSITION_PAIRS.some(
    ([from, to]) => from === fromStatus && to === toStatus,
  )
}

/**
 * Contract helper: assignment check uses auth.uid() identity, not client-supplied user id.
 */
export function isAssignedToTask(authUid, task) {
  return Boolean(authUid) && task?.assigned_to === authUid
}
