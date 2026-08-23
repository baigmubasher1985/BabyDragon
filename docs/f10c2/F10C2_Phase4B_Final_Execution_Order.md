# F10C2 Phase 4B — Final Execution Order

**Status:** Local plan only. Phase 4B-S prepares the operational bootstrap.  
**Phase 4B-E** is the single later human-approved execution pass.  
**Do not connect to Supabase or execute SQL until that approval.**  
**207 is NEVER EXECUTE.**

Owner: MobbiTech Global LLC · Project: BabyDragon / NetField-360

## Dual guard (steps 0–1)

The SQL marker is not sufficient by itself.

0. **JavaScript disposable target guard** must confirm all of:
   - `F10C2_DISPOSABLE_PROJECT_NAME=babydragon-f10c2-disposable`
   - `F10C2_DISPOSABLE_CONFIRMED=yes`
   - project ref is not the denied production ref
   - DB host is not the denied production host
   - disposable URL is not production `VITE_SUPABASE_URL`
   - `F10C2_SYNTHETIC_DATA_MODE=yes`
   - `F10C2_PRODUCTION_DATA_IMPORT=disabled`
   - `F10C2_PHASE4B_SQL_EXECUTION_APPROVED=yes`
1. **SQL disposable transaction marker** — wrapper only, after step 0:

   ```sql
   BEGIN;
   SET LOCAL app.f10c2_disposable_confirmed = 'yes';
   ```

## Executable schema sequence (steps 2–5)

2. **Operational schema bootstrap 000**  
   `supabase/drafts/f10c2/phase4b/bootstrap/000_disposable_operational_schema.sql`
3. **F10C1I:** `001–008`, `011`, `014–020`
4. **F10C2:** `101–111`, `113–115`
5. **Phase 4A-R1:** `201–206`
5b. **Phase 4B-E-R1:** `208` (fresh install after 206; existing 4B-E disposable applies 208 only)

## Synthetic data sequence (steps 6–8)

6. Create **synthetic** Auth users (disposable project only; no production identities)
7. Insert synthetic `profiles` / `project` / `grid` / `task`
8. Apply synthetic field-result fixtures **301**

## Close-out (steps 9–11)

9. Run relational / RPC / storage / QC verification
10. Produce evidence
11. **Stop before cleanup**

Cleanup of synthetic rows or bootstrap objects is a separate later approval. Bootstrap rollback requires `SET LOCAL app.f10c2_disposable_cleanup_confirmed = 'yes'` in addition to the disposable marker. Do not run it in 4B-S or 4B-E unless a dedicated cleanup pass is approved.

## Excluded (keep excluded)

| Item | Rule |
|------|------|
| `009_rls_profiles` | Skipped |
| `010_rls_tasks` | Skipped |
| `012_rls_task_checklist_items` | Skipped |
| `013_rls_task_issue_reports` | Skipped |
| `112_result_artifacts_storage_contract` | Documentation-only |
| **`207_rls_tenant_storage_assumptions`** | **NEVER EXECUTE** |

Phase 4 `listApplyPlan()` remains free of `201–207`.

## Wrapper contract

`scripts/f10c2/bootstrapDisposableOperationalSchema.mjs` and `scripts/f10c2/applyPhase4bMigrations.mjs`:

- Default: dry-run, no database connection
- `--execute` still blocked in Phase 4B-S
- May emit `SET LOCAL` only after JS guard + SQL approval
- Must refuse `207`

Next human step after 4B-S: **one controlled Phase 4B-E execution approval** against a proven disposable project named `babydragon-f10c2-disposable`.
