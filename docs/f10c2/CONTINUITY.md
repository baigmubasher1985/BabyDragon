# BabyDragon / NetField-360 — Continuity note for future Cursor sessions

**Read this before touching F10C2 / CR1 work.**
**Never discard, reset, clean, stash, or revert the dirty working tree** that holds CR1-B through CR1-E. Do not stage, commit, push, PR, merge, or deploy unless the owner explicitly asks.

Last updated: 2026-08-29 (CR1-E permanent-staging apply package + staging 000 adapter; SQL approval remains no)

## Branch and HEAD

- Branch: `step-1j2-f10c1i-security-baseline`
- Committed HEAD: `00fbce27fd38526888129a4bd2dbca6937088836`
- Working tree: dirty on purpose. CR1-B through CR1-E live as uncommitted tracked and untracked files.

## SQL and targets

- Disposable project name `babydragon-f10c2-disposable`, ref `cxyqqgmepiphyejvceum` — evidence only.
- SQL **215** applied on disposable only. Do not reapply 215.
- SQL **216** (`set_acceptance_profile_active`) **newly applied once** on disposable 2026-08-28 (`CR1E_APPLY` one-shot). Do not reapply 216.
- SQL **214** never executed; quarantined at `supabase/drafts/f10c2/never-run/214/` (`CR1_NEVER_RUN`). Not draft-in-forward. Not silently required. Canonical order: **210 → 211 → 212 → 213 → skip 214 → 215 → 216**.
- Never execute **009, 010, 012, 013, 112, 207**.
- Production prefix **nsne** is denied. Do not contact production.
- Permanent staging identity is authorized for **pre-apply / dry-run only**: `babydragon-permanent-staging` / `qxtnoxkyyancndgswjnu` / `qxtnoxkyyancndgswjnu.supabase.co` / Session Pooler user `postgres.qxtnoxkyyancndgswjnu`. SQL execution approval remains **no**. Do not send SQL until a later explicit approval.
- Wrapper: `scripts/f10c2/applyPermanentStagingMigrations.mjs` — exact 45-path allowlist. Slot 000 is `supabase/drafts/f10c2/permanent-staging/000_permanent_staging_operational_schema.sql` (replaces historical disposable 000 in the **staging** allowlist only). Never execute **009, 010, 012, 013, 112, 207, 214**.
- Hash manifest: `scripts/f10c2/permanentStagingAllowlist.hashes.json`. Wrapper verifies SHA-256 before any connection. SQL files are never rewritten at apply time.
- Empty-DB live check is REST-only on the **execute** path (before first migration). Dry-run is filesystem + env-guard + hash verification only.
- Stop phrase while SQL approval is no: **WAITING FOR EXPLICIT SQL EXECUTION APPROVAL — PRODUCTION UNTOUCHED**

## CR1-E status (2026-08-28)

- `set_acceptance_profile_active` verified: SECURITY DEFINER, no client UPDATE policy, anon cannot execute, authenticated can execute.
- **CR1-D-R2 E2E Data Rule** deactivated through Admin UI (RPC). Persists Inactive after refresh. Absent from new-assignment selectors.
- Synthetic open task **F10C2-P4BU-E2E** assignment row preserved.
  - Assigned criterion: CR1-D-R2 E2E Data Rule — Inactive
  - Effective criterion: **CR1-B disposable default**
- Physical HTTP/iPerf snapshots unchanged. Iter1 DL **6.009**. Averages **34.474 / 53.565**. GPS **44/0**.
- Disposable probe rows named `CR1-E status probe (do not seed)` are inactive lab residue from live matrix retries. Do not seed. Do not copy.

## Temporary E2E cleanup (CR1-E owner decisions)

1. **SYNTHETIC F10C2 Validation Task** — prior Current Criteria proven as **CR1-B disposable default**. Restored via UI Change Assignment.
2. **F10C2-P4BU-E2E** — synthetic **open task** (not the physical run). Assignment record remains **CR1-D-R2 E2E Data Rule** (now Inactive). Independent pre-R2 Current Criteria was **not** captured. Do not guess. Do not change the assignment row.

   **KNOWN DISPOSABLE VALIDATION RESIDUE — PRESERVED BECAUSE PRIOR ASSIGNMENT IS UNPROVEN**

3. Unrelated **SYNTHETIC F10C2 Re-drive Task** remained **CR1-B disposable default**, not task-specific.
4. **CR1-D-R2 E2E Data Rule** is **Inactive** after authorized 216 + Admin UI Deactivate.

Physical runs and snapshots were not modified. Sync Now was not clicked.

## Tests

`npm run test:f10c2`: **48 files, 471 passed, 14 todo**.

## Physical iPerf proof (immutable)

- Report: `F10C2-P4BU-E2E_Data_RF_Report_20260825_164751`
- Run `a2951b10-…`, snapshot `1dab1239-…`
- Iteration 1 DL **6.009** Mbps
- Average DL **34.474** Mbps, average UL **53.565** Mbps
- GPS **44** valid / **0** invalid
- HTTP run `abfa51c3-…`, snapshot `cf39f235-…`
- Protected queue **`bd-rf-1787606300946` — never upload**

## Acceptance assignment precedence

task+scenario → task default → project+scenario → project default → tenant+scenario → tenant default.
Historical snapshots are immutable. Changing today’s Current Criteria must not rewrite completed-run snapshots.

## Permanent staging decision

Stop using the disposable project for normal feature development after permanent staging cutover succeeds. Package: `docs/f10c2/permanent-staging/CUTOVER_PACKAGE.md`. ADR: `docs/adr/0001-permanent-staging-before-continued-feature-development.md`.
Do not blindly copy disposable data. Classify A/B/C in the cutover package. Authorized staging name/ref: `babydragon-permanent-staging` / `qxtnoxkyyancndgswjnu`. Identity-only this pass; do not apply SQL.

Baseline templates are **approved definitions only — not seeded**.

## Production

Isolated. Unauthorized. Untouched.

## Exact next authorized action

1. Owner reviews the CR1-E permanent-staging apply package (adapter, hashed 45-path allowlist, wrapper dry-run ledger) under `Audit Data/F10C2/CR1-E/`.
2. If the owner later authorizes SQL, set `F10C2_PERMANENT_STAGING_SQL_EXECUTION_APPROVED=yes` and run the staging wrapper **execute** pass (hash verify → target verify → REST empty-DB gate first → hashed files). Do not do that in this pass.
3. Do not restore `F10C2-P4BU-E2E`. Do not SQL-reactivate **CR1-D-R2 E2E Data Rule**. Do not reapply 216 on disposable. Do not apply 214.

## Remaining cosmetic and functional issues

See `docs/f10c2/UI_UX_BACKLOG.md` (UX-01 is closed on disposable after 216). Highest remaining: synthetic labels in operator UI, Field Results table scroll at 1366, missing-data wording consistency, GPS cluster scale.

## PowerShell

No bash `&&`. Use `;`.
