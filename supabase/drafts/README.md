# supabase/drafts — F10C1I Phase 2 R1 + F10C2 Phase 1 (UNAPPLIED)

**Status:** DRAFT / UNAPPLIED / DO NOT RUN  
**No database target authorized.**

Draft SQL lives **here**, not under active `supabase/migrations/`.

## Layout

| Path | Role |
|------|------|
| `forward/` | F10C1I proposed forward changes (001–020) |
| `rollback/` | Paired rollback (no-op when forward blocked) |
| `verification/` | SELECT-only verification queries |
| `f10c2/{forward,rollback,verification}/` | F10C2 Phase 1 result-ingestion drafts (101–112) — see `f10c2/README.md` |

`supabase/migrations/` remains README-only (no executable migration SQL).

## Classification

See `supabase/MIGRATION_MANIFEST.md`:

- **(a) draftable / apply-candidate**
- **(b) blocked documentation-only** (comments + optional harmless SELECT only)
- **(c) future F10C2** (out of scope)

## Safety headers

Every `.sql` file begins with:

```text
-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
```

## Blockers (do not apply)

| Gate | Affects |
|------|---------|
| `BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION` | DEFINER harden/helpers/RPCs (002–007) |
| `BLOCKED_PENDING_EDGE_AND_CLIENT_CUTOVER` | profiles privileged UPDATE (009) — docs only |
| `BLOCKED_PENDING_RPC_CLIENT_CUTOVER` | tasks/checklist/issues FE mutation removal (010, 012, 013) — docs only |
| `BLOCKED_PENDING_SCHEMA_AND_DISPOSABLE_VALIDATION` | operational evidence write (020 storage portion) |
| No bucket DDL | operational-evidence / result-artifacts not created |

## Captured policy fixtures

Static comparison baseline (read-only capture):  
`supabase/tests/fixtures/captured_rls_policies_02a.json`

Do not claim exact rollback restoration without disposable verification.

## Explicit non-actions

- No `supabase link` / `db push` / migration up  
- No Storage bucket creation  
- No Auth/Realtime changes  
- No F10C2 results schema  
- No production mutation  
