# rollback/ — Rollback SQL only (DRAFT / UNAPPLIED)

Rollback scripts for each forward migration live **here**, not under `migrations/`.

- One rollback artifact per forward migration (naming should mirror the forward file).
- Verification remains under `../verification/`.
- Never apply to production without a separate window.

**No SQL applied in Phase 1.**
