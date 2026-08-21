# Edge Functions — Undeployed (F10C1I Phase 2)

**Status:** Source present · **NOT DEPLOYED** · **NOT INVOKED**

| Path | Role |
|------|------|
| `_shared/cors.ts` | Strict origin allowlist CORS |
| `_shared/authz.ts` | JWT caller profile; `is_active IS TRUE`; Admin/SA gates |
| `_shared/audit.ts` | Sanitized `security_audit_log` writer |
| `_shared/response.ts` | Sanitized JSON errors |
| `admin-create-user/index.ts` | Admin creates FE only; SA per role policy |
| `admin-reset-password/index.ts` | Admin/SA password reset; never logs password |
| `admin-manage-profile/index.ts` | Admin FE `is_active`; SA role grants; email immutable |

Secrets (`SUPABASE_SERVICE_ROLE_KEY`, `ALLOWED_ORIGINS`, etc.) come from Edge runtime env only — never committed.
