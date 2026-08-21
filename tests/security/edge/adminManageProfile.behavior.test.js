import { describe, it, expect } from 'vitest'
import { handleAdminManageProfile } from '../../../supabase/functions/admin-manage-profile/handler.ts'

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
const FE = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  role: 'fe',
  is_active: true,
  email: 'fe@example.com',
}

function makeDeps({
  caller,
  target,
  activeSuperAdminCount = 2,
  updatedRows = [{ id: target?.id }],
  updateError = null,
}) {
  const audits = []
  return {
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
        countActiveSuperAdmins: async () => activeSuperAdminCount,
        from: (table) => {
          if (table === 'profiles') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: target, error: target ? null : { m: 1 } }),
                }),
              }),
              update: () => ({
                eq: () => ({
                  select: async () => ({ data: updatedRows, error: updateError }),
                }),
              }),
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
      }),
    },
  }
}

async function post(body, deps) {
  return handleAdminManageProfile(
    new Request('https://fn.local/admin-manage-profile', {
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

describe('edge.admin-manage-profile.behavior', () => {
  it('admin may deactivate FE; cannot change roles; rejects unknown fields', async () => {
    const ok = makeDeps({ caller: ADMIN, target: FE })
    const res = await post({ user_id: FE.id, is_active: false }, ok.deps)
    expect(res.status).toBe(200)

    const role = makeDeps({ caller: ADMIN, target: FE })
    const resRole = await post({ user_id: FE.id, role: 'admin' }, role.deps)
    expect(resRole.status).toBe(403)

    const unknown = makeDeps({ caller: ADMIN, target: FE })
    const resUnk = await post({ user_id: FE.id, is_active: false, email: 'x' }, unknown.deps)
    expect(resUnk.status).toBe(400)
    expect(await resUnk.json()).toEqual({ error: 'unknown_fields' })
  })

  it('rejects invalid UUID and update row mismatch', async () => {
    const bad = makeDeps({ caller: ADMIN, target: FE })
    const res = await post({ user_id: 'bad', is_active: false }, bad.deps)
    expect(res.status).toBe(400)

    const mismatch = makeDeps({ caller: ADMIN, target: FE, updatedRows: [] })
    const res2 = await post({ user_id: FE.id, is_active: false }, mismatch.deps)
    expect(res2.status).toBe(409)
  })

  it('blocks final active SA deactivation', async () => {
    const { deps } = makeDeps({
      caller: SA,
      target: SA,
      activeSuperAdminCount: 1,
    })
    const res = await post({ user_id: SA.id, is_active: false }, deps)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'final_super_admin_deactivation_forbidden' })
  })

  it('audits success', async () => {
    const { deps, audits } = makeDeps({ caller: SA, target: FE })
    const res = await post({ user_id: FE.id, role: 'admin' }, deps)
    expect(res.status).toBe(200)
    expect(audits.some((a) => a.outcome === 'success' && a.action === 'admin_manage_profile')).toBe(
      true,
    )
  })
})
