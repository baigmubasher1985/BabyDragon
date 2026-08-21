# Security contract tests (F10C1I)

Synthetic Phase 1 suites encode role/assignment/storage contracts **without** a live database.

Phase 2 adds `tests/security/artifacts/**` which inspects actual draft SQL and Edge TypeScript on disk.

Disposable/live enforcement remains `it.todo` until separately authorized.
