# F10C2 Phase 4 — Disposable integration notes

**Production is denied.** Apply, Storage DDL, and live validation run only after `scripts/f10c2/assertDisposableTarget.mjs` accepts a separate `.env.disposable`.

## Human-provided disposable values (never commit)

Copy `.env.disposable.example` → `.env.disposable` (gitignored):

- `F10C2_DISPOSABLE_CONFIRMED=yes`
- `F10C2_DISPOSABLE_PROJECT_REF` (must not equal the app/production ref)
- `F10C2_DISPOSABLE_SUPABASE_URL` (must not equal `VITE_SUPABASE_URL`)
- `F10C2_DISPOSABLE_ANON_KEY` (anon only)
- `F10C2_DISPOSABLE_SERVICE_ROLE_KEY` (scripts only — never `VITE_`)
- `F10C2_DISPOSABLE_DB_URL` (Postgres URI for apply)
- Synthetic FE / admin / super_admin test users

The app `.env` `VITE_SUPABASE_*` pair is treated as the denied production/app target for apply scripts.

## Apply order (disposable only)

1. F10C1I apply-candidates: 001–008, 011, 014–020  
   Skip blocked docs-only: 009, 010, 012, 013  
2. F10C2 apply-candidates: 101–111, 113–115  
   Skip blocked docs-only: 112  
3. Disposable owner for SECURITY DEFINER objects: `postgres` on the disposable project (not a guessed production role)

Prerequisite: the disposable database must already contain the operational schema (`profiles`, `tasks`, `projects`, and related tables). A blank project cannot receive F10C1I policy replacements.

## Client flags (default safe)

| Flag | Default | Live meaning |
|------|---------|--------------|
| `VITE_F10C2_SERVER_SUBMIT_ENABLED` | unset/false | Real result transport |
| `VITE_F10C2_FIELD_RESULTS_PROVIDER` | mock | `supabase` selects dashboard provider |
| `F10C2_SERVER_SUBMIT_ENABLED` in source | **false** | Compile-time default stays off |

Mock provider and mock transport remain for deterministic tests.

## Commands

```text
npm run f10c2:assert-disposable
npm run f10c2:apply-disposable
npm run f10c2:validate-disposable
```

These commands print redacted project refs only. They refuse to run against the app `VITE_SUPABASE_URL` hostname.

## Permanent staging (CR1-E)

Disposable remains evidence only. Continued development belongs on a **permanent staging** project after owner authorization. Prepare-only package: [permanent-staging/CUTOVER_PACKAGE.md](./permanent-staging/CUTOVER_PACKAGE.md). Copy `.env.permanent-staging.example` → `.env.permanent-staging` (gitignored). Canonical variable names: `BABYDRAGON_STAGING_*` (compatible `F10C2_PERMANENT_STAGING_*` aliases). If no target is authorized, stop with **PERMANENT STAGING TARGET REQUIRED — CUTOVER PACKAGE READY — NO DATABASE CONTACTED**. Do not copy disposable data. SQL **216** was applied once on disposable; do not reapply. Permanent staging is still not contacted.
