# Operational Evidence Contract

**Step:** F10C1I Phase 2 R1 · **Status:** Design contract (unapplied)  
**Storage write path:** `BLOCKED_PENDING_SCHEMA_AND_DISPOSABLE_VALIDATION`

## Scope

Private **operational** photos / note images only.  
RF / data-test / Unified Field Report packages are **out of scope** for this bucket and belong to a future distinct private **results** bucket under **STEP 1J2-F10C2** (unauthorized here).

## Bucket vs object_key (binding)

| Field | Value |
|-------|--------|
| `bucket` | `operational-evidence` |
| `object_key` | `{project_id}/{task_id}/{verified_user_id}/{artifact_id}.{safe_extension}` |

**Do not** put the bucket name inside `object_key`.

Correct durable pair:

```text
bucket = operational-evidence
object_key = {project_id}/{task_id}/{verified_user_id}/{artifact_id}.jpg
```

## Why photo_url alone is insufficient

Captured live schema for `task_updates` exposes **`photo_url` only** (no `bucket` / `object_key` columns).

Storing a non-URL `object_key` string inside `photo_url` may be used as a **temporary dual-read bridge**, but it does **not** complete the durable private-evidence contract. Durable persistence requires **both** bucket and object_key (plus checksum when designed).

## Future schema decision (required — do not invent/apply in F10C1I)

Choose **one** of the following in a separately authorized disposable design:

1. Add explicit `bucket` + `object_key` (+ checksum) columns on the operational evidence persistence surface, **or**  
2. Introduce a dedicated operational-evidence table keyed to task/update rows  

Until that decision is captured and validated, operational evidence **write** remains blocked. Dual-read of legacy public URLs in `photo_url` / `task-photos` continues.

## Limits (first wave — when unblocked)

| Rule | Value |
|------|-------|
| Max size | **15 MB** accept; **>15 MB** reject |
| MIME | `image/jpeg`, `image/png` only |
| Bucket | `operational-evidence` (private) — create only in disposable when authorized |
| Legacy | `task-photos` dual-read until cutover; **do not** mutate production objects in first wave |

## Forbidden

- Claiming `object_key` in `photo_url` alone completes the durable contract  
- RF / GPS / CSV / JSON / XLSX / ZIP / OOKLA / FCC / Unified packages in this bucket or in `task-photos`  
- Creating `operational-evidence` or `result-artifacts` buckets in Phase 2 drafts  
- F10C2 RF / result persistence  

## Dual offline queues

`artifact_id` persistence applies independently to web IDB and mobile localStorage+files IDB queues. Do not merge queues.
