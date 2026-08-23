# Disposable operational schema bootstrap (Phase 4B-S)

**Status:** DRAFT / UNAPPLIED. Local preparation only.  
**Classification:** DISPOSABLE ONLY.  
**Do not run against production. Do not run in Phase 4B-S.**

This folder supplies the missing operational BabyDragon relations so a blank disposable project can receive the accepted F10C1I and F10C2 drafts. F10C1I `001–020` do not create `profiles`, `tasks`, `projects`, and the other operational tables.

## Dual guard

Both are required. The SQL marker alone is not sufficient.

1. **JavaScript target guard** (`src/lib/phase4bTargetGuard.js` + `src/lib/phase4bSqlSessionGuard.js`) must confirm:
   - project name is exactly `babydragon-f10c2-disposable`
   - disposable confirmation is `yes`
   - project ref is not the denied production ref
   - DB host is not the denied production host
   - project URL is not the production `VITE_SUPABASE_URL`
   - synthetic-data mode is `yes`
   - production-data import is `disabled`
   - SQL execution approval is `yes`
2. **SQL transaction marker** is set **only** by the execution wrapper after that JS guard:

   ```sql
   BEGIN;
   SET LOCAL app.f10c2_disposable_confirmed = 'yes';
   -- then 000_disposable_operational_schema.sql
   COMMIT;
   ```

`000_disposable_operational_schema.sql` asserts the marker and **does not** set it.

## Files

| File | Role |
|------|------|
| `000_disposable_operational_schema.sql` | CREATE TABLE IF NOT EXISTS + essential indexes + fail-closed RLS |
| `000_disposable_operational_schema.verify.sql` | SELECT-only existence / emptiness checks |
| `000_disposable_operational_schema.rollback.sql` | Disposable cleanup listing; separate cleanup marker; **do not run** |

## Dependency order

`profiles` → `projects` → `grids` → `tasks` → `task_updates` → `task_grids` → `routes` → `route_grids` → `cell_files` → `cell_sites` → `cell_sectors` → `task_checklist_items` → `task_issue_reports` → `qc_reviews`

`auth.users` is a Supabase-provided relation. This bootstrap never creates Auth users or copies production identities.

## Compatibility

After 000, the Phase 4B executable sequence is:

- F10C1I: `001–008`, `011`, `014–020`
- F10C2: `101–111`, `113–115`
- Phase 4A-R1: `201–206`

See `F10C2_Phase4B_Final_Execution_Order.md`.

## Never include / never execute

- `009`, `010`, `012`, `013`
- `112`
- **`207` — NEVER EXECUTE**

## Explicit non-actions

- No business rows
- No production users, Auth users, UUIDs, emails, logs, reports, coordinates, storage objects, or customer information
- No permissive `USING (true)` policies
- No `GRANT ALL` to `anon` or `public`
- No `DISABLE ROW LEVEL SECURITY`
- No `DROP TABLE` / `TRUNCATE` / `CASCADE` in the forward bootstrap
