# F10C1I — Migration Manifest (UNAPPLIED)

**Nature:** Proposed future order only. **No production apply commands.**

**Phase 2 location change:** Draft SQL lives under `supabase/drafts/{forward,rollback,verification}/`.  
Active `supabase/migrations/` remains **README-only**.

## Product target alignment

This security migration sequence is a **prerequisite** for the principal BabyDragon objective (secure result upload → run records → Dashboard/QC → QC decision → re-drive), not a standalone security platform.

**Proposed next feature phase (unauthorized):**

`STEP 1J2-F10C2 — SERVER RESULTS INGESTION AND QC INTEGRATION`

Do **not** create result-ingestion schema or `result-artifacts` bucket in F10C1I.

---

## Classification legend

| Class | Meaning |
|-------|---------|
| **(a) draftable / apply-candidate** | May enter sequential apply path after gates (owner / disposable) clear |
| **(b) blocked documentation-only** | Comments + optional harmless `SELECT` status marker only — **not** sequential apply |
| **(c) future F10C2** | Out of scope; separately unauthorized |

Blocked forward drafts are **non-executable** (no `BEGIN`/`COMMIT`/`CREATE`/`ALTER`/`DROP`/`INSERT`/`UPDATE`/`DELETE`/`GRANT`/`REVOKE` outside comments). Quarantined end-state SQL is comment-only or lives outside the sequential path.

---

## Proposed order (20 draft pairs)

| # | Draft slug | Class | Purpose | Dependencies | Stop / block |
|---|------------|-------|---------|--------------|--------------|
| 1 | `001_security_audit_log` | (a) | Append-only audit table + RLS | None | Wrong shape |
| 2 | `002_harden_existing_functions` | (a) | Fail-closed helpers; empty search_path | Owner gate | **OWNER GATE** |
| 3 | `003_security_helpers` | (a) | `is_super_admin`, `is_assigned_to_task` | #2 | **OWNER GATE** |
| 4 | `004_rpc_update_assigned_task_status` | (a) | Narrow status RPC + event-time skew | #3 | **OWNER GATE** |
| 5 | `005_rpc_update_assigned_checklist_item` | (a) | Checklist RPC + event-time skew | #3 | **OWNER GATE** |
| 6 | `006_rpc_insert_assigned_task_issue` | (a) | Force `reported_by`, `status=open` | #3 | **OWNER GATE** |
| 7 | `007_rpc_insert_assigned_task_update` | (a) | Force `user_id`; reject URL durable refs | #3 | **OWNER GATE** |
| 8 | `008_execute_grants` | (a) | REVOKE PUBLIC/anon; GRANT authenticated | #2–#7 | EXECUTE regressions |
| 9 | `009_rls_profiles` | **(b)** | Privileged UPDATE cutover docs | Edge + Admin app | **EDGE/CLIENT CUTOVER** |
| 10 | `010_rls_tasks` | **(b)** | FE UPDATE removal docs | RPC client cutover | **RPC/CLIENT CUTOVER** |
| 11 | `011_rls_task_updates` | (a) | FE SELECT + Admin SELECT; **no FE INSERT** (RPC-only) | #7 + client cutover | FE insert blank if applied early |
| 12 | `012_rls_task_checklist_items` | **(b)** | FE UPDATE removal docs (RPC-only end-state) | #5 + client cutover | **RPC/CLIENT CUTOVER** |
| 13 | `013_rls_task_issue_reports` | **(b)** | FE INSERT removal docs (RPC-only end-state) | #6 + client cutover | **RPC/CLIENT CUTOVER** |
| 14 | `014_rls_task_grids` | (a) | Adm write; FE SELECT assigned | #10 cutover | Admin overview blank |
| 15 | `015_rls_projects` | (a) | FE via assignment | #10 cutover | Project leak / blank |
| 16 | `016_rls_grids` | (a) | Dual grid linkage | #4, #14 | Map blank |
| 17 | `017_rls_routes` | (a) | FE read-only via grids | #16 | Routes blank |
| 18 | `018_rls_route_grids` | (a) | FE read-only | #17 | Junction leak |
| 19 | `019_rls_cell_files_sites_sectors` | (a) | FE read-only maps | #16 | Layers missing |
| 20 | `020_operational_evidence_schema_contract` | (a)+(b) | qc_reviews (a); storage write **(b)** | #2 | **No bucket DDL**; schema decision pending |

**(c) F10C2 Phase 1 drafts:** live under `supabase/drafts/f10c2/` (sequences 101–112). See `supabase/drafts/f10c2/MIGRATION_MANIFEST.md`. Still **UNAPPLIED**; no bucket create; no production apply. Not part of the F10C1I 001–020 apply path.

Each F10C1I pair: `drafts/forward/NNN_*.sql` + `drafts/rollback/NNN_*.sql` + `drafts/verification/NNN_*.sql`.

### Rollback rule

- Transactional policy-replacement rollbacks where forward was apply-candidate  
- **Blocked / no-op forward → no-op rollback** (no unnecessary production policy rewrite)  
- Captured baselines: `supabase/tests/fixtures/captured_rls_policies_02a.json`  
- Do **not** claim “exact” restoration unless verified against disposable/live metadata  

### Storage contract (binding)

- Durable needs **both** `bucket=operational-evidence` **and** `object_key={project_id}/{task_id}/{verified_user_id}/{artifact_id}.{ext}`  
- Live `task_updates` has **only** `photo_url` — object_key text in `photo_url` alone does **not** complete the contract  
- Operational evidence write: **`BLOCKED_PENDING_SCHEMA_AND_DISPOSABLE_VALIDATION`**  
- Dual-read legacy `task-photos` / historical public URLs  
- Do **not** create buckets; do **not** touch `task-photos` objects; do **not** create `result-artifacts`  

### Global stop conditions

- No disposable project → do not apply  
- SECURITY DEFINER owner unresolved → stop before DEFINER apply  
- Broad permissive policy left beside scoped policy → abort table swap  
- Automatic client fallback from rejected secure RPC → forbidden  
- Blocked documentation-only drafts → never apply as DDL  

### No production apply commands

This manifest must not be used as a runbook to mutate production.
