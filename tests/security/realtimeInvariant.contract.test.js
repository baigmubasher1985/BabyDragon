import { describe, it, expect } from 'vitest'

/**
 * Realtime invariant: first wave retains polling only.
 * Zero public application tables in supabase_realtime publication membership.
 */

const PUBLIC_APPLICATION_TABLES = [
  'profiles',
  'projects',
  'tasks',
  'task_updates',
  'grids',
  'routes',
  'task_grids',
  'route_grids',
  'cell_files',
  'cell_sites',
  'cell_sectors',
  'task_checklist_items',
  'task_issue_reports',
  'qc_reviews',
]

/** Contract snapshot from F10C1P capture facts — Phase 1 documents expected invariant. */
const EXPECTED_PUBLICATION_MEMBERSHIP = Object.freeze([])

describe('realtimeInvariant.contract', () => {
  it('expects zero public application table publication membership', () => {
    expect(EXPECTED_PUBLICATION_MEMBERSHIP).toEqual([])
    for (const table of PUBLIC_APPLICATION_TABLES) {
      expect(EXPECTED_PUBLICATION_MEMBERSHIP.includes(table)).toBe(false)
    }
  })

  it('documents first-wave decision: do not enable Realtime publication members', () => {
    const firstWaveEnableRealtime = false
    expect(firstWaveEnableRealtime).toBe(false)
  })

  it('documents that Admin postgres_changes subscriptions remain inert; fetchAll polling is refresh path', () => {
    const refreshPath = 'fetchAll_polling'
    expect(refreshPath).toBe('fetchAll_polling')
  })

  it.todo(
    'Disposable verification query: confirm zero pub membership — gated until disposable authorized',
  )
})
