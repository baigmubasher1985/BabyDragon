import { describe, it, expect } from 'vitest'
import { handleAdminResetPassword } from '../../../supabase/functions/admin-reset-password/handler.ts'

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
const ADMIN2 = {
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  role: 'admin',
  is_active: true,
  email: 'admin2@example.com',
}
const SA2 = {
  id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  role: 'super_admin',
  is_active: true,
  email: 'sa2@example.com',
}

function makeDeps({ caller, target, updateError = null, auditError = null }) {
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
        from: (table) => {
          if (table === 'profiles') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: target, error: target ? null : { m: 'x' } }),
                }),
              }),
            }
          }
          if (table === 'security_audit_log') {
            return {
              insert: async (row) => {
                audits.push(row)
                return { error: auditError }
              },
            }
          }
          return {}
        },
        auth: {
          admin: {
            updateUserById: async () => ({ data: {}, error: updateError }),
          },
        },
      }),
    },
  }
}

async function post(body, deps) {
  const req = new Request('https://fn.local/admin-reset-password', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test',
      Origin: 'https://app.example',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  return handleAdminResetPassword(req, deps)
}

describe('edge.admin-reset-password.behavior', () => {
  const cases = [
    { caller: ADMIN, target: FE, expectStatus: 200, label: 'admin→fe' },
    { caller: ADMIN, target: ADMIN2, expectStatus: 403, label: 'admin→admin' },
    { caller: ADMIN, target: SA, expectStatus: 403, label: 'admin→sa' },
    { caller: ADMIN, target: ADMIN, expectStatus: 403, label: 'admin→self' },
    { caller: SA, target: FE, expectStatus: 200, label: 'sa→fe' },
    { caller: SA, target: ADMIN2, expectStatus: 200, label: 'sa→admin' },
    { caller: SA, target: SA2, expectStatus: 403, label: 'sa→sa' },
    { caller: SA, target: SA, expectStatus: 403, label: 'sa→self' },
  ]

  for (const c of cases) {
    it(`${c.label} → HTTP ${c.expectStatus}`, async () => {
      const { deps, audits } = makeDeps({ caller: c.caller, target: c.target })
      const res = await post({ user_id: c.target.id, password: 'NewPassw0rd!' }, deps)
      expect(res.status).toBe(c.expectStatus)
      const text = await res.text()
      expect(text).not.toMatch(/NewPassw0rd/)
      if (c.expectStatus === 200) {
        expect(audits.some((a) => a.outcome === 'success')).toBe(true)
        expect(JSON.stringify(audits)).not.toContain('NewPassw0rd')
        expect(audits.every((a) => !a.detail || !('password' in a.detail))).toBe(true)
      }
    })
  }

  it('rejects email-only lookup and invalid UUID', async () => {
    const { deps } = makeDeps({ caller: ADMIN, target: FE })
    const emailOnly = await post({ email: 'fe@example.com', password: 'NewPassw0rd!' }, deps)
    expect(emailOnly.status).toBe(400)
    const badUuid = await post({ user_id: 'not-a-uuid', password: 'NewPassw0rd!' }, deps)
    expect(badUuid.status).toBe(400)
  })

  it('rejects missing target profile', async () => {
    const { deps } = makeDeps({ caller: ADMIN, target: null })
    const res = await post(
      { user_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', password: 'NewPassw0rd!' },
      deps,
    )
    expect(res.status).toBe(404)
  })
})
