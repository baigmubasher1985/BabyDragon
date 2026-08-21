# admin-create-user (UNDEPLOYED)

**Status:** Draft Edge Function — **NOT DEPLOYED** · F10C1I Phase 2 R1

## Orphan prevention

1. Auth `createUser` succeeds → profile upsert  
2. If profile upsert fails → **delete** the newly created Auth user  
3. If compensation delete succeeds → sanitized `profile_upsert_failed` (safe to retry; no duplicate identity)  
4. If compensation delete fails → sanitized `profile_upsert_failed_cleanup_failed` + audit detail `reconcile: manual_delete_orphaned_auth_user`  

**Manual reconciliation (if compensation fails):** Operator deletes the orphaned Auth user by UUID using service-role Admin API offline notes (UUID only — no passwords). Do not invent automated cross-service atomicity claims.

## Hierarchy

- Admin may create **FE only**
- Super admin may create `admin` / `super_admin` per `assertMaySetRole`
- Duplicate email → `409 duplicate_email`
- Unauthorized role → denied

## Audit

Checks `{ error }` on every audit insert. Never audits password or raw provider errors.
