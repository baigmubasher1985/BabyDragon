# F10C2 Phase 4B — Final Execution Order

This file is the Phase 4B draft-adjacent copy of the living plan.

Canonical document: `docs/f10c2/F10C2_Phase4B_Final_Execution_Order.md`

**207 is NEVER EXECUTE.** Do not connect to a database in Phase 4B-S.

## Order

0. JavaScript disposable target guard
1. SQL disposable transaction marker (`SET LOCAL` after JS guard + SQL approval)
2. Operational schema bootstrap **000**
3. F10C1I: `001–008`, `011`, `014–020`
4. F10C2: `101–111`, `113–115`
5. Phase 4A-R1: `201–206`
5b. Phase 4B-E-R1: `208` (fresh after 206; existing 4B-E disposable: 208 only)
5c. Phase 4B-U-R1: `209` (fresh after 208; existing 4B-E/4B-U disposable: 209 only). Production execution is not authorized.
5d. CR1-B: `210`–`213`. **Skip 214** (quarantined `never-run/214/`). CR1-D: `215` only. CR1-E: `216` one-shot. **207 NEVER EXECUTE.** Canonical: **210 → 211 → 212 → 213 → skip 214 → 215 → 216**.
5e. CR1-E: `216` (`CR1E_APPLY` one-shot) — applied on disposable 2026-08-28; do not reapply; never auto-apply. Permanent staging cutover: prepare only — `docs/f10c2/permanent-staging/CUTOVER_PACKAGE.md`. No database contact without owner target authorization.
6. Create synthetic Auth users
7. Insert synthetic profiles / project / grid / task
8. Apply synthetic field-result fixtures **301**
9. Run relational / RPC / storage / QC verification
10. Produce evidence
11. Stop before cleanup

## Keep excluded

- `009`, `010`, `012`, `013`
- `112`
- **`207` — NEVER EXECUTE**
- **`214` — NEVER RUN.** Quarantined at `supabase/drafts/f10c2/never-run/214/`. Do not execute. 215 supersedes.
- **`216` — CR1E_APPLY one-shot; applied on disposable; do not reapply; never auto-apply**
