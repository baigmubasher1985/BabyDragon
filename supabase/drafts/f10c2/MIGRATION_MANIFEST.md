# F10C2 Phase 1 — Migration Manifest (UNAPPLIED)

**Nature:** Proposed future order only. **No production or disposable apply commands.**  
**Prerequisite:** F10C1I Phase 2 R1 security baseline accepted (helpers, assignment, auth.uid() ownership).

Draft SQL path: `supabase/drafts/f10c2/{forward,rollback,verification}/`  
Active `supabase/migrations/` remains README-only.

## Classification legend

| Class | Meaning |
|-------|---------|
| **(a) draftable / apply-candidate** | May enter sequential apply path after disposable + owner gates clear |
| **(b) blocked documentation-only** | Comments + optional harmless `SELECT` only — not sequential apply |

## Proposed order (101–112)

| # | Draft slug | Class | Purpose | Stop / block |
|---|------------|-------|---------|--------------|
| 101 | `101_field_test_runs` | (a) | Run table + indexes + client_run_id unique | Wrong FK / missing helpers |
| 102 | `102_field_test_artifacts` | (a) | Artifact table; bucket+object_key; checksum unique | Signed URL columns |
| 103 | `103_field_test_metrics` | (a) | Optional normalized KPI rows | Full payload duplication |
| 104 | `104_field_test_qc_reviews` | (a) | Run-level QC; link redrive_task_id | Must not replace task `qc_reviews` |
| 105 | `105_rpc_submit_field_test_run` | (a) | Idempotent run submit; force submitted_by=auth.uid() | **OWNER GATE** |
| 106 | `106_rpc_register_field_test_artifact` | (a) | Register artifact metadata; path ownership | **OWNER GATE** |
| 107 | `107_rpc_complete_field_test_artifact_upload` | (a) | Mark upload complete; checksum match | **OWNER GATE** |
| 108 | `108_rpc_submit_field_test_qc_review` | (a) | Admin/SA/QC write QC decision | **OWNER GATE** |
| 109 | `109_rls_field_test_runs` | (a) | FE SELECT assigned; Admin/SA/QC read; no direct FE INSERT | FE insert blank if applied without RPC |
| 110 | `110_rls_field_test_artifacts_metrics` | (a) | Same ownership model for artifacts + metrics | Leak across tasks |
| 111 | `111_rls_field_test_qc_reviews` | (a) | Admin/SA/QC mutate; FE read own assigned runs | FE write QC |
| 112 | `112_result_artifacts_storage_contract` | **(b)** | Document private bucket contract | **No bucket DDL** |
| 113 | `113_rpc_finalize_field_test_run` | (a) Phase 4 | FE finalize run when artifacts complete | **OWNER GATE** (disposable postgres) |
| 114 | `114_result_artifacts_private_bucket` | (a) Phase 4 | Private `result-artifacts` bucket + storage policies | Disposable Storage only |
| 115 | `115_field_test_execute_grants` | (a) Phase 4 | REVOKE anon/PUBLIC; GRANT authenticated on result RPCs | EXECUTE regressions |

### Rollback rule

- Transactional drops for apply-candidate schema/RPC/RLS  
- Blocked / no-op forward → no-op rollback  
- Do not claim exact restoration without disposable verification  

### Storage contract (binding)

- Durable needs **both** `bucket=result-artifacts` **and**  
  `object_key={project_id}/{task_id}/{verified_user_id}/{field_test_run_id}/{artifact_id}.{safe_ext}`  
- Never store signed/public URLs as durable refs  
- Separate from `operational-evidence` and legacy `task-photos`  
- No overwrite; checksum + artifact_id idempotency  

### Global stop conditions

- No disposable project → do not apply  
- SECURITY DEFINER owner unresolved → stop before DEFINER RPCs  
- Bucket create unauthorized → leave 112 blocked  
- Automatic client fallback from rejected secure RPC → forbidden  

### No production apply commands

This manifest must not be used as a runbook to mutate production.

## Phase 4A (separate folder, not this apply order)

Tenant/storage drafts 201–207 live under `supabase/drafts/f10c2/phase4a/`. Do **not** add them to `scripts/f10c2/applyDisposableMigrations.mjs`. See `phase4a/MIGRATION_MANIFEST.md`.
