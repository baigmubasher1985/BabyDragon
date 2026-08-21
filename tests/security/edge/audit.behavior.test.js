import { describe, it, expect } from 'vitest'
import {
  sanitizeDetail,
  writeSecurityAudit,
  AuditWriteError,
} from '../../../supabase/functions/_shared/audit.ts'

describe('edge.audit.behavior — sanitization + insert error checking', () => {
  it('recursively strips nested secrets and JWT-shaped strings', () => {
    const jwtSample = ['eyJ', 'hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', '.aaa.bbb'].join('')
    const cleaned = sanitizeDetail({
      ok: true,
      password: 'hunter2',
      nested: {
        authorization: 'Bearer abc',
        list: [{ token: 'x', safe: 1 }, jwtSample],
      },
      reason: 'denied',
    })
    expect(cleaned).toEqual({
      ok: true,
      nested: {
        list: [{ safe: 1 }, '[redacted]'],
      },
      reason: 'denied',
    })
  })

  it('throws AuditWriteError when insert returns error', async () => {
    await expect(
      writeSecurityAudit(async () => ({ error: { message: 'db down' } }), {
        actor_user_id: 'a',
        action: 'test',
        outcome: 'error',
        detail: { password: 'nope', code: 'x' },
      }),
    ).rejects.toBeInstanceOf(AuditWriteError)
  })

  it('succeeds when insert returns no error and never persists secret values', async () => {
    let saved = null
    await writeSecurityAudit(
      async (row) => {
        saved = row
        return { error: null }
      },
      {
        actor_user_id: 'actor',
        action: 'admin_manage_profile',
        target_id: 'target',
        outcome: 'success',
        detail: { password: 's3cret-value', target_role: 'fe' },
      },
    )
    expect(saved.detail).toEqual({ target_role: 'fe' })
    expect(JSON.stringify(saved.detail)).not.toMatch(/s3cret-value/)
    expect(saved.detail).not.toHaveProperty('password')
  })
})
