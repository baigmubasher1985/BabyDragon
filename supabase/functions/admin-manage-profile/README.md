# admin-manage-profile (UNDEPLOYED)

**Status:** Draft Edge Function — **NOT DEPLOYED** · F10C1I Phase 2 R1

## Behavior

- JWT + active admin/SA
- Strict body schema: only `user_id`, `role?`, `is_active?` — reject unknown fields
- `user_id` must be UUID
- Hierarchy **before** mutation (`assertMayManageProfile`)
- Admin: FE activation only; Admin cannot change roles
- SA: may grant/revoke admin-level; cannot deactivate/demote the final active super_admin
- Self-deactivation forbidden
- Update must affect exactly one intended row (`update_row_mismatch` otherwise)
- Audit success / denied / error; never passwords/JWTs/raw errors

## Race note (disposable validation)

Target `role` / `is_active` may change between authz read and update. This endpoint does **not** claim atomic cross-service locking. Disposable tests should validate conflict behavior separately.

## Explicit non-actions

- Not deployed
- Does not modify Auth email (email immutable via this endpoint — rejected as unknown field)
