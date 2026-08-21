# Offline Upload Queue Contract (F10C2 Phase 1+2)

## Existing dual queues (preserve both)

| Queue | Store | Typical actions |
|-------|-------|-----------------|
| Web FE | IndexedDB `babydragon_offline_queue` / `pending_actions` | task_update, gps_point, checklist_item, issue_report, photo_evidence |
| Mobile | localStorage `babydragon_mobile_offline_queue_v1` + files IDB `babydragon_mobile_offline_files_v1` | task_status, checklist_item, issue_report, task_update, gps_checkpoint, **field_test_result_submit** |

**Do not merge** into a single queue. **Do not remove** either legacy queue. **No third unrelated queue product.**

## Result upload orchestration (Phase 2)

Mobile queue action: `field_test_result_submit` (versioned payload `record_version`).

1. Generate `client_run_id` once; persist on queue item / id store.
2. Build server submission manifest (Phase 1 pure module).
3. Call transport `registerResult` (mock today; future RPC).
4. For each artifact: stable `artifact_id`; request; upload bytes; confirm checksum.
5. On transient failure: backoff + resume with same IDs.
6. On permanent failure: mark failed; Manual Retry Now allowed; do not spin forever.
7. Cancel → `cancelled_local_only` (local report kept).

Large binaries: file refs via IndexedDB / native report paths — **not** embedded in localStorage JSON.

### Backoff (contract)

| Attempt | Delay |
|---------|-------|
| 1 | 1s |
| 2 | 5s |
| 3 | 15s |
| 4+ | 60s (cap) |
| Max attempts | 8 |

### Resume rules

| State | Resume action |
|-------|---------------|
| Run not registered | `registerResult` |
| Run registered, artifact pending | Register or reuse artifact_id |
| Artifact uploading | Resume byte upload |
| Artifact complete | Skip |
| Checksum mismatch | Permanent fail |
| Auth expired | `blocked_auth` then resume after login |
