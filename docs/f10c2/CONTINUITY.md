# BabyDragon / NetField-360 — Continuity note for future Cursor sessions

**Read this before touching F10C2 / CR1 work.**
**Never discard, reset, clean, stash, or revert the dirty working tree** that holds CR1-B through CR1-E. Do not stage, commit, push, PR, merge, or deploy unless the owner explicitly asks.

Last updated: 2026-08-28 (CR1-E checkpoint boundary; SQL 214 quarantined)

## Branch and HEAD

- Branch: `step-1j2-f10c1i-security-baseline`
- Committed HEAD: `28822c44a1294d76c3f757b7a039f7d41fe31691`
- Working tree: dirty on purpose. CR1-B through CR1-E live as uncommitted tracked and untracked files.

## SQL and targets

- Disposable project name `babydragon-f10c2-disposable`, ref `cxyqqgmepiphyejvceum` — evidence only.
- SQL **215** applied on disposable only. Do not reapply 215.
- SQL **216** (`set_acceptance_profile_active`) **newly applied once** on disposable 2026-08-28 (`CR1E_APPLY` one-shot). Do not reapply 216.
- SQL **214** never executed; quarantined at `supabase/drafts/f10c2/never-run/214/` (`CR1_NEVER_RUN`). Not draft-in-forward. Not silently required. Canonical order: **210 → 211 → 212 → 213 → skip 214 → 215 → 216**.
- Never execute **009, 010, 012, 013, 112, 207**.
- Production prefix **nsne** is denied. Do not contact production.
- Do not create or connect to a permanent database until the owner supplies: environment name, project name, ref, confirmation it is staging not production, connection method, credential **variable names**, and explicit migration authorization.
- Stop phrase when no target: **PERMANENT STAGING TARGET REQUIRED — CUTOVER PACKAGE READY — NO DATABASE CONTACTED**

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

`npm run test:f10c2`: **47 files, 464 passed, 14 todo**.

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
Do not blindly copy disposable data. Classify A/B/C in the cutover package. Suggested unused project name: `babydragon-permanent-staging`. No generated ref has been supplied — do not create or connect.

Baseline templates are **approved definitions only — not seeded**.

## Production

Isolated. Unauthorized. Untouched.

## Exact next authorized action

1. Owner reviews the CR1-E exact checkpoint A/B file list and authorizes git add/commit if desired.
2. Owner supplies permanent staging project identity (generated ref) and migration authorization.
3. Do not restore `F10C2-P4BU-E2E`. Do not SQL-reactivate **CR1-D-R2 E2E Data Rule**. Do not reapply 216.

## Remaining cosmetic and functional issues

See `docs/f10c2/UI_UX_BACKLOG.md` (UX-01 is closed on disposable after 216). Highest remaining: synthetic labels in operator UI, Field Results table scroll at 1366, missing-data wording consistency, GPS cluster scale.

## PowerShell

No bash `&&`. Use `;`.
