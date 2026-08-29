# ADR 0001 — Permanent Staging Before Continued Feature Development

- **Status:** Accepted (owner decision, 2026-08-28, CR1-E)
- **Product:** BabyDragon / NetField-360
- **Owner:** MobbiTech Global LLC

## Decision

BabyDragon will stop using the disposable project for normal future feature development after the permanent staging cutover succeeds.

Required environments:

1. **Permanent development/staging** — durable, production-like, controlled test data, reset only through authorized recovery.
2. **Production** — isolated, no synthetic validation data, no experimental development, reviewed migrations/releases only.

The disposable project (`babydragon-f10c2-disposable`) remains evidence only and must not become the system of record. Production must not be used as a development environment.

## Reasons

- Avoid repeating database-specific corrections when the product later moves off a throwaway project.
- Validate the final schema continuously (APK upload, ingest, acceptance, QC, reports, security).
- Keep integrations stable (Auth, RLS, RPC, storage).
- Prevent synthetic test debris from reaching production.
- Provide a realistic environment for APK, dashboard, and QC testing.
- Make production deployment repeatable from the same canonical path.

## Consequences

- Permanent staging incurs ongoing maintenance.
- Schema changes must use versioned migrations, not console edits.
- Production remains separate and unauthorized until an explicit launch gate.
- Test data must be labeled and managed (no silent copy from disposable).
- Secrets remain environment-specific (gitignored files, variable **names** only in repo).
- Future customer-hosted / on-prem deployments must use the same migration path.
- No permanent database is created or contacted until the owner supplies project identity and execution authorization.
- Suggested staging project name `babydragon-permanent-staging` is a name only until a generated ref and SQL authorization exist.
- SQL **216** (profile-status RPC) was applied once on disposable (`cxyqqgmepiphyejvceum`) on 2026-08-28. Do not reapply. Permanent staging still requires its own owner identity and migration authorization.

## Rejected approaches

1. **Developing directly in production.** Rejected: mixes experiment with live data; forbids synthetic validation; cannot be rolled back safely.
2. **Continuing indefinitely on a disposable database and migrating only after the application is considered finished.** Rejected: forces a second round of schema and permission corrections at the worst time; disposable debris would tempt a blind copy.

## See also

- `docs/f10c2/README.md` (Master Plan CR1-E)
- `docs/f10c2/permanent-staging/CUTOVER_PACKAGE.md`
- `docs/f10c2/CONTINUITY.md`
