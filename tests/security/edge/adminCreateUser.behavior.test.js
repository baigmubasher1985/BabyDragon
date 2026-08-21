import { describe, it, expect } from 'vitest'
import { handleAdminCreateUser } from '../../../supabase/functions/admin-create-user/handler.ts'

const ADMIN = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  role: 'admin',
  is_active: true,
  email: 'admin@example.com',
}
const SA = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  role: 'super_admin',
  is_active: true,
  email: 'sa@example.com',
}

function makeDeps({
  caller,
  createError = null,
  createdId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  upsertError = null,
  deleteError = null,
}) {
  const deleted = []
  const audits = []
  return {
    deleted,
    audits,
    deps: {
      getAllowedOrigins: () => ['https://app.example'],
      getUserClient: () => ({
        auth: {
          getUser: async () => ({ data: { user: { id: caller.id } }, error: null }),
        },
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: caller, error: null }),
            }),
          }),
        }),
      }),
      getServiceClient: () => ({
        from: (table) => {
          if (table === 'profiles') {
            return {
              upsert: async () => ({ error: upsertError }),
            }
          }
          if (table === 'security_audit_log') {
            return {
              insert: async (row) => {
                audits.push(row)
                return { error: null }
              },
            }
          }
          return {}
        },
        auth: {
          admin: {
            createUser: async () =>
              createError
                ? { data: { user: null }, error: createError }
                : { data: { user: { id: createdId } }, error: null },
            deleteUser: async (id) => {
              deleted.push(id)
              return { data: {}, error: deleteError }
            },
          },
        },
      }),
    },
  }
}

async function post(body, deps) {
  return handleAdminCreateUser(
    new Request('https://fn.local/admin-create-user', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test',
        Origin: 'https://app.example',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
    deps,
  )
}

describe('edge.admin-create-user.behavior — orphan compensation', () => {
  it('Auth create fail → sanitized create_failed / duplicate_email', async () => {
    const fail = makeDeps({ caller: ADMIN, createError: { message: 'provider boom' } })
    const res = await post(
      { email: 'n@example.com', password: 'NewPassw0rd!', role: 'fe' },
      fail.deps,
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'create_failed' })

    const dup = makeDeps({
      caller: ADMIN,
      createError: { message: 'User already registered' },
    })
    const resDup = await post(
      { email: 'n@example.com', password: 'NewPassw0rd!', role: 'fe' },
      dup.deps,
    )
    expect(resDup.status).toBe(409)
    expect(await resDup.json()).toEqual({ error: 'duplicate_email' })
  })

  it('profile fail + cleanup success → profile_upsert_failed and Auth deleted', async () => {
    const { deps, deleted } = makeDeps({
      caller: ADMIN,
      upsertError: { message: 'upsert failed' },
      deleteError: null,
    })
    const res = await post(
      { email: 'n@example.com', password: 'NewPassw0rd!', role: 'fe' },
      deps,
    )
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'profile_upsert_failed' })
    expect(deleted).toEqual(['cccccccc-cccc-4ccc-8ccc-cccccccccccc'])
  })

  it('profile fail + cleanup fail → profile_upsert_failed_cleanup_failed', async () => {
    const { deps, deleted, audits } = makeDeps({
      caller: ADMIN,
      upsertError: { message: 'upsert failed' },
      deleteError: { message: 'delete failed' },
    })
    const res = await post(
      { email: 'n@example.com', password: 'NewPassw0rd!', role: 'fe' },
      deps,
    )
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'profile_upsert_failed_cleanup_failed' })
    expect(deleted).toHaveLength(1)
    expect(
      audits.some(
        (a) => a.detail?.code === 'profile_upsert_failed_cleanup_failed' || a.outcome === 'error',
      ),
    ).toBe(true)
  })

  it('unauthorized role (admin creating admin) denied', async () => {
    const { deps } = makeDeps({ caller: ADMIN })
    const res = await post(
      { email: 'n@example.com', password: 'NewPassw0rd!', role: 'admin' },
      deps,
    )
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(['admin_may_create_fe_only', 'super_admin_required']).toContain(body.error)
  })

  it('success path does not echo password', async () => {
    const { deps, audits } = makeDeps({ caller: SA })
    const res = await post(
      { email: 'n@example.com', password: 'NewPassw0rd!', role: 'admin' },
      deps,
    )
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toMatch(/NewPassw0rd/)
    expect(JSON.stringify(audits)).not.toContain('NewPassw0rd')
    expect(audits.every((a) => !a.detail || !('password' in a.detail))).toBe(true)
  })
})
