# BabyDragon / NetField-360 — Continuity note for future Cursor sessions

**Read this before touching F10C2 / CR1 work.**
**Never discard, reset, clean, stash, or revert the dirty working tree** that holds CR1-B through CR1-E. Do not stage, commit, push, PR, merge, or deploy unless the owner explicitly asks.

Last updated: 2026-08-29 (CR1-E-R1 217-only hashed runner — Session Pooler SQL sender attached; still a dedicated 217 runner; Auth/seed still blocked; 217 not executed until dedicated flag + --execute)

## Branch and git-gate

- Branch: `step-1j2-f10c1i-security-baseline`
- Git-gate (45-path wrapper and 217-only runner): approved branch; local HEAD equals its remote-tracking branch; no staged changes; execution-package files must match committed Git content on `--execute`; reviewed hashes must match the dedicated manifest; optional local `F10C2_PERMANENT_STAGING_APPROVED_GIT_SHA` must equal current HEAD if supplied. No commit SHA is hardcoded in tracked source or tests.
- Unrelated unstaged files outside the execution package are not a blocker. Dirty or untracked execution-package files fail execute.
- Working tree: dirty on purpose. CR1-B through CR1-E live as uncommitted tracked and untracked files.

## SQL and targets

- Disposable project name `babydragon-f10c2-disposable`, ref `cxyqqgmepiphyejvceum` — evidence only. Do not contact.
- SQL **215** applied on disposable only. Do not reapply 215.
- SQL **216** (`set_acceptance_profile_active`) **newly applied once** on disposable 2026-08-28 (`CR1E_APPLY` one-shot). Do not reapply 216.
- SQL **214** never executed; quarantined at `supabase/drafts/f10c2/never-run/214/` (`CR1_NEVER_RUN`). Not draft-in-forward. Not silently required. Canonical order: **210 → 211 → 212 → 213 → skip 214 → 215 → 216**.
- SQL **217** is **CR1E_DRAFT_ONLY** (`217_cr1e_staging_grant_hardening`). Revised privilege contract is **approved** (current sixteen tables + future default grants). Prepared, not executed, not in the 45-path allowlist. Next apply must use the **217-only hashed runner** (`scripts/f10c2/applyPermanentStaging217.mjs`) with `F10C2_PERMANENT_STAGING_217_EXECUTION_APPROVED=yes` **and** `--execute`. Do not reuse `F10C2_PERMANENT_STAGING_SQL_EXECUTION_APPROVED`. Hash manifest: `scripts/f10c2/permanentStaging217.hashes.json`. Recovery lives under `rollback/` and is a **manual emergency recovery**, not a bit-identical inverse. Never auto-run.
- SQL **218** is **not required**. Vendor is `projects.customer` text, not a missing `vendors` table.
- Never execute **009, 010, 012, 013, 112, 207**.
- Production prefix **nsne** is denied. Do not contact production.
- Permanent staging identity: `babydragon-permanent-staging` / `qxtnoxkyyancndgswjnu` / `qxtnoxkyyancndgswjnu.supabase.co` / Session Pooler user `postgres.qxtnoxkyyancndgswjnu`.
- **45/45 hashed migrations applied and verified** on permanent staging. Local gitignored ledger `.permanent-staging-apply-ledger.json` records those 45 numbers. SQL execution approval is **reset to no**.
- Wrapper: `scripts/f10c2/applyPermanentStagingMigrations.mjs` — exact 45-path allowlist. Slot 000 is `supabase/drafts/f10c2/permanent-staging/000_permanent_staging_operational_schema.sql`. Never execute **009, 010, 012, 013, 112, 207, 214**.
- Hash manifest: `scripts/f10c2/permanentStagingAllowlist.hashes.json`. Wrapper verifies SHA-256 before any connection. SQL files are never rewritten at apply time.
- Do not re-apply the 45-path set. A complete 45-verified ledger is a post-apply state: execute refuses re-apply. Do not delete the ledger to make tests pass.

## Permanent staging apply ledger (ids only — no secrets)

Executed and verified: `000, 001, 002, 003, 004, 005, 006, 007, 008, 011, 014, 015, 016, 017, 018, 019, 020, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 113, 114, 115, 201, 202, 203, 204, 205, 206, 208, 209, 210, 211, 212, 213, 215, 216`.

Skipped / never-run: `009, 010, 012, 013, 112, 207, 214`.

Target recorded in the gitignored ledger: project `babydragon-permanent-staging`, ref `qxtnoxkyyancndgswjnu`. Hashes match the reviewed allowlist manifest. No credential values. No production or disposable identity.

## CR1-E-R1 foundation review (2026-08-29)

Two local wrapper-test failures were contract bugs, not database failures:

1. Git gate used to hardcode a commit SHA, which created a stale-SHA cycle. The gate no longer pins a SHA. It requires the approved branch, HEAD == remote-tracking, no staged changes, clean execution-package files on execute, reviewed hashes, and an optional locally supplied approved SHA.
2. Execute tests assumed the gitignored apply ledger was absent. After the authorized 45/45 apply it exists with 45 verified entries. Tests now cover **pre-apply (absent)** and **post-apply (exactly 45 verified)**. Wrapper resume policy treats a complete ledger as “already applied — refuse re-apply”, not as a partial ledger. The file was not deleted.

**217-only runner** is ready with the authorized Session Pooler SQL sender attached (same proven connection/execution pattern as the 45-path wrapper, copied into the dedicated runner so 45 migrations are never re-run). Dry-run by default; refuses unless the dedicated 217 flag is yes **and** `--execute`; requires the complete verified 45-entry ledger; refuses hash mismatch and reapplication; sends only 217 forward then 217 verification; never auto-rollback, cleanup, Auth, or seed.

**STG-GRANT-001 remains open** until 217 is authorized. Draft 217 now covers current tables **and** future objects:

- Catalog inspect (SELECT-only): all 31 public tables and 24 public functions are owned by `postgres`. Public default-ACL grantors are `postgres` and `supabase_admin`. The staging session is `postgres` and is **not** a member of `supabase_admin`, so 217 cannot `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin`. `postgres` also has storage defaults — 217 does not touch storage, auth, realtime, or extensions.
- Future tables/sequences/functions created by `postgres` (the migration owner): no automatic PUBLIC / anon / authenticated privileges. Explicit GRANTs must be added by the creating migration. No convenience authenticated SELECT/EXECUTE default.
- `supabase_admin` public client defaults remain as a documented platform residual (objects created by that role, not by our migrations).
- Recovery is **manual emergency only**. It reopens direct client writes. It does not restore table-wipe (TRUNCATE) or MAINTAIN. Forward-fix is preferred, especially on production. Never run recovery automatically.

Draft **217** privilege contract is approved. The 217-only hashed runner has its Session Pooler sender attached and remains a dedicated runner (not the 45-path wrapper). Do not apply until dedicated 217 approval is yes **and** `--execute` is passed.

**Vendor contract:** there is no `vendors` table and none is required before Auth/seed. Product vendor display is `projects.customer` (Admin Create Project customer field). Field Results now selects `customer` so the Vendor column can show the persisted name. Do not invent 218.

Auth users, seed, package upload, and Sync Now were **not** started. SQL approval remains **no**.

## CR1-E disposable evidence (2026-08-28)

- `set_acceptance_profile_active` verified on disposable: SECURITY DEFINER, no client UPDATE policy, anon cannot execute, authenticated can execute.
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

`npm run test:f10c2`: **50 files, 497 passed, 14 todo**.

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
Do not blindly copy disposable data. Classify A/B/C in the cutover package. Authorized staging name/ref: `babydragon-permanent-staging` / `qxtnoxkyyancndgswjnu`.

Schema 45/45 is applied. Auth and baseline seed are still blocked on owner review of draft **217** plus explicit SQL approval. Baseline templates remain **approved definitions only — not seeded**.

## Production

Isolated. Unauthorized. Untouched.

## Exact next authorized action

1. Owner authorizes SQL for **217 only**.
2. If authorized: set `F10C2_PERMANENT_STAGING_217_EXECUTION_APPROVED=yes` locally and run `node scripts/f10c2/applyPermanentStaging217.mjs --execute`. Do **not** set or reuse `F10C2_PERMANENT_STAGING_SQL_EXECUTION_APPROVED` for this pass. Do not re-apply the 45-path wrapper. Do not apply 218. Do not run the recovery file.
3. After 217 verifies: create staging Auth users and the approved Class A baseline seed. Not before.
4. Do not restore `F10C2-P4BU-E2E`. Do not SQL-reactivate **CR1-D-R2 E2E Data Rule**. Do not reapply 216 on disposable. Do not apply 214.

## Remaining cosmetic and functional issues

See `docs/f10c2/UI_UX_BACKLOG.md` (UX-01 is closed on disposable after 216). Highest remaining: synthetic labels in operator UI, Field Results table scroll at 1366, missing-data wording consistency, GPS cluster scale.

## PowerShell

No bash `&&`. Use `;`.
