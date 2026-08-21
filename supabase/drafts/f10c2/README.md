# supabase/drafts/f10c2 — F10C2 Phase 1 (UNAPPLIED)

**Status:** DRAFT / UNAPPLIED / DO NOT RUN  
**No database target authorized.**  
**No Storage bucket creation authorized.**

F10C2 Phase 1 result-ingestion drafts live **here**, separate from F10C1I drafts under `supabase/drafts/{forward,rollback,verification}/`.

## Why a dedicated tree

| Choice | Rationale |
|--------|-----------|
| `supabase/drafts/f10c2/{forward,rollback,verification}/` | Keeps F10C1I 001–020 sequential path intact; avoids colliding sequence numbers |
| Sequence **101–112** | Clearly post-F10C1I; not part of security baseline apply order |
| Active `supabase/migrations/` | Remains README-only — **no** executable migration SQL |

## Layout

| Path | Role |
|------|------|
| `forward/` | Proposed schema / RPC / RLS / storage-contract drafts |
| `rollback/` | Paired rollback (no-op when forward blocked) |
| `verification/` | SELECT-only verification queries |
| `MIGRATION_MANIFEST.md` | Classification + apply order (when authorized) |

## Safety headers

Every `.sql` file begins with:

```text
-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 1
-- NO DATABASE TARGET AUTHORIZED
```

## Classification summary

| Class | Drafts |
|-------|--------|
| **(a) draftable / apply-candidate** | 101–111 (schema, RPC, RLS) — still UNAPPLIED; owner gate applies to DEFINER RPCs |
| **(b) blocked documentation-only** | 112 result-artifacts storage (no bucket DDL) |

## Explicit non-actions (Phase 1)

- No `supabase link` / `db push` / migration apply  
- No `result-artifacts` or `operational-evidence` bucket create  
- No mutation of `task-photos` objects  
- No Edge Function deploy  
- No production or disposable DB mutation  
- No runtime client cutover (mobile upload = Phase 2)  

## Product entities (draft)

1. `field_test_runs` — canonical run metadata + summary JSONBs  
2. `field_test_artifacts` — private artifact refs (`bucket` + `object_key` only)  
3. `field_test_metrics` — optional normalized KPIs  
4. `field_test_qc_reviews` — run-level QC; **preserves** existing task-level `qc_reviews`  

Future private bucket name (not created): **`result-artifacts`**.
