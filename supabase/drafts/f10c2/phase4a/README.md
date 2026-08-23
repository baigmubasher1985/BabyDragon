# supabase/drafts/f10c2/phase4a — Multi-tenant storage (UNAPPLIED)

**Status:** DRAFT / UNAPPLIED / DO NOT RUN  
**F10C2 PHASE 4A**  
**No database target authorized.** These drafts are **not** in `scripts/f10c2/applyDisposableMigrations.mjs`.

Phase 4A lives in this folder so Phase 1 pairing (`forward/` 101–115) stays exact.

## Layout

| Path | Role |
|------|------|
| `forward/` | Tenant, connection, policy, artifact columns, transfer jobs, upload-plan RPC, RLS assumptions |
| `rollback/` | Paired rollback for every forward slug |
| `verification/` | SELECT-only checks |
| `MIGRATION_MANIFEST.md` | Classification + proposed later apply order |

## Sequence

| Slug | Class | Purpose |
|------|-------|---------|
| `201_tenants` | (a) | Tenant / organization residency boundary |
| `202_storage_connections` | (a) | Connector metadata + `secret_reference` only |
| `203_tenant_storage_policies` | (a) | Per-artifact-type routing and processing location |
| `204_field_test_artifacts_tenant_columns` | (a) | Nullable tenant columns; relax 102 bucket equality |
| `205_artifact_transfer_jobs` | (a) | Idempotent transfer / resume jobs |
| `206_rpc_request_artifact_upload_plan` | (a) | Session JWT upload-plan RPC (no secrets) |
| `207_rls_tenant_storage_assumptions` | **(b)** | Documentation-only tenant RLS assumptions |

## Explicit non-actions

- Do not apply these drafts to disposable or production  
- Do not add 201–207 to the Phase 4 apply list  
- Do not add NOT NULL tenant columns to populated tables  
- Do not store plaintext connector credentials or signed URLs  
- Do not treat the `secret_reference` regex CHECK as the security control  
- Do not CASCADE-delete tenant operational data at runtime (RESTRICT + `is_active`)  
