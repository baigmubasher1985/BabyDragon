# admin-reset-password (UNDEPLOYED)

**Status:** Draft Edge Function — **NOT DEPLOYED** · F10C1I Phase 2 R1

## Behavior

- JWT verified; caller must be active `admin` or `super_admin`
- **Target identity:** `user_id` UUID (authoritative). Email is **not** accepted as the lookup key
- Target profile loaded via service-role; missing profile → `target_not_found`
- Hierarchy:
  - Admin resets **FE only**
  - Admin must **not** reset `admin` / `super_admin`
  - Only `super_admin` resets `admin`
  - Fail-closed: `super_admin` may **not** reset another `super_admin` (no proven requirement)
  - Self-reset via this endpoint forbidden
- Never returns, logs, or audits the password
- Audit: success / denied / error with safe identifiers only

## Audit failure policy

- Before Auth password mutation: fail-closed on audit infrastructure errors where applicable
- After password mutation already succeeded: return safe partial success + `audit_write_failed_reconcile` warning; manual reconciliation of audit row required

## Explicit non-actions

- Not deployed / not invoked
- No production Auth mutation from this draft alone
