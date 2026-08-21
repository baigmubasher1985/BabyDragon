# verification/ — Verification SQL only (DRAFT / UNAPPLIED)

Pos/neg and inventory checks for disposable validation.

- Separate from forward (`migrations/`) and rollback (`rollback/`).
- Must not mutate data or policies when written as SELECT-only checks.
- Includes future checks for zero Realtime publication membership on application tables.

**No SQL executed in Phase 1.**
