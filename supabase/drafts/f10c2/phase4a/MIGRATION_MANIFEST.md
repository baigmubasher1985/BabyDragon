# F10C2 Phase 4A — Tenant storage drafts (UNAPPLIED)

**Nature:** Proposed future order only. **No production or disposable apply commands.**  
**Do not add these slugs to `scripts/f10c2/applyDisposableMigrations.mjs`.**

Draft SQL path: `supabase/drafts/f10c2/phase4a/{forward,rollback,verification}/`

## Compatibility sequence (later, after verified backfill)

1. Introduce `tenants`  
2. Add `storage_connections` and `tenant_storage_policies`  
3. Add **nullable** tenant references on existing field-test tables  
4. Backfill under an explicit deployment migration (not this folder)  
5. Add foreign keys / indexes  
6. Transition RLS and RPC authorization  
7. Enforce NOT NULL only after verified backfill  
8. Roll back in reverse (207 → 201)

## Classification

| # | Slug | Class | Purpose |
|---|------|-------|---------|
| 201 | `201_tenants` | (a) | Tenant residency boundary |
| 202 | `202_storage_connections` | (a) | Connector metadata; `secret_reference` only |
| 203 | `203_tenant_storage_policies` | (a) | Artifact-type routing |
| 204 | `204_field_test_artifacts_tenant_columns` | (a) | Nullable columns; relax 102 `bucket = result-artifacts` |
| 205 | `205_artifact_transfer_jobs` | (a) | Transfer / resume jobs |
| 206 | `206_rpc_request_artifact_upload_plan` | (a) | Upload-plan RPC — **OWNER GATE** |
| 207 | `207_rls_tenant_storage_assumptions` | **(b)** | RLS assumptions only — no live policies |

## Binding rules

- No plaintext provider credentials. The `secret_reference` regex CHECK is defense-in-depth only; real prevention is server-side secret management, restricted writes, no browser/APK access, review, and scanning.
- No signed/public URL as durable artifact identity  
- No provider-specific `field_test_*` tables  
- `task-photos` and `operational-evidence` remain banned containers  
- Tenant columns stay nullable until a verified backfill  
- Same-tenant composite FKs: policy→connection, artifact→run, artifact→connection, job→artifact  
- Tenant DELETE uses RESTRICT / soft-deactivation; rollback DROP CASCADE is explicit cleanup only  
- Upload-plan RPC uses persisted `artifact_type` and a derived destination bucket  

## Composite integrity vs backfill

1. Before backfill, `field_test_runs.tenant_id` and `field_test_artifacts.tenant_id` are NULL. MATCH SIMPLE composite FKs do not fire. Transfer jobs are not created until artifact `tenant_id` is set.
2. Backfill runs, then artifacts, copying the same tenant. Composite FKs then reject mismatches.
3. `storage_connection_id` requires `tenant_id` (CHECK) so MATCH SIMPLE cannot hide a cross-tenant connection on a NULL-tenant artifact.
4. Enforce NOT NULL only after a verified backfill (not these drafts).  
