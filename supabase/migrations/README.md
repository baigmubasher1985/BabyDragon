# migrations/ — Forward SQL only (DRAFT / UNAPPLIED)

Future forward migrations land here after disposable authorization.

- Do **not** place rollback scripts in this directory.
- Do **not** place verification queries in this directory.
- Pairing: `migrations/` ↔ `rollback/` ↔ `verification/` (separate directories).
- Prefer comments-only DRAFT files until executable SQL is separately approved.
- See `../MIGRATION_MANIFEST.md` for proposed order.

**No SQL applied in Phase 1.**
