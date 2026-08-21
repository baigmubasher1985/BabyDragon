# Client Cutover Contract

**Step:** F10C1I Phase 2 · **Status:** Documentation only — **no runtime change under src/**

## Product target alignment

Secure client adapters exist to support the principal BabyDragon path (including a future **STEP 1J2-F10C2 — SERVER RESULTS INGESTION AND QC INTEGRATION** vertical slice). They are not a generic multi-tenant SDK.

F10C2 remains unauthorized. No RF/result upload adapters are activated here. **No `src/**` modifications in Phase 2.**

## Modes

| Mode | Meaning | Phase 2 default |
|------|---------|-----------------|
| `legacy` | Current direct table mutations / public URL patterns | **YES — default** |
| `secure_disposable` | Explicit opt-in against disposable backend + secure RPCs/Edge | No (requires config) |
| `secure_production` | Explicit opt-in after disposable proof + production window | No |

Adapters require **explicit capability / cutover configuration**. Silent mode switches are forbidden.

## Hard rules

1. **No insecure fallback:** If a secure RPC / Edge call is rejected, the client **must not** automatically fall back to an insecure direct table mutation.  
2. **Paired Edge + profile cutover:** Deploy Edge (`admin-manage-profile` et al.) + Admin app together; only then revoke client UPDATE of `role` / `is_active` / `email`. Rollback app + policy + Edge as one group. Draft `009_rls_profiles` remains **blocked documentation-only** until this pairing is validated.  
3. **Paired RPC + task cutover:** Clients must call `update_assigned_task_status` before dropping FE direct `tasks` UPDATE. Draft `010_rls_tasks` remains **blocked documentation-only** until then.  
4. **Paired RPC + checklist/issue cutover:** Clients must call `update_assigned_checklist_item` / `insert_assigned_task_issue` before dropping FE direct mutations. Drafts `012` / `013` remain **blocked documentation-only** until then.  
5. **Task updates:** After RPC path, FE must not retain direct INSERT; draft `011` is apply-candidate with SELECT-only FE policies (RPC-only mutation). Apply only with client cutover.  
6. **Identity:** Server uses `auth.uid()`; clients never supply authoritative `user_id` / `user_email` / `reported_by` / `completed_by` / `uploader` / `role` / `is_active`.  
7. **Fail closed:** Inactive profiles (`is_active` not `IS TRUE`) denied.  
8. **Storage:** Durable needs both `bucket` + `object_key`; live `photo_url` alone is insufficient; dual-read legacy `task-photos`; never durable signed URLs. Write path remains `BLOCKED_PENDING_SCHEMA_AND_DISPOSABLE_VALIDATION`.  
9. **Queues:** Keep web and mobile offline queues separate; future `artifact_id` on create.  
10. **Realtime:** Leave publication membership unchanged (polling / `fetchAll`).  

## Explicit non-goals (Phase 2)

- Modifying any file under `src/**`  
- Replacing live Supabase client calls  
- Enabling `secure_disposable` or `secure_production` by default  
- Deploying Edge Functions  

## Future F10C2 note

Result-package upload and QC listing will need a **separate** secure mode and a distinct private results bucket — not `operational-evidence` and not `task-photos`. That work requires separate human authorization.
