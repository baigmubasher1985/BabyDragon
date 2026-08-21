# Result Upload State Machine (F10C2 Phase 2)

## Package states

`draft` → `queued` → `registering` → `registered` → `uploading` → `partially_uploaded` → `finalizing` → `uploaded`

Also:

| State | Meaning |
|-------|---------|
| `retry_wait` | Bounded backoff before next attempt |
| `blocked_auth` | Need sign-in; not a permanent failure |
| `failed_permanent` | Stop auto-retry (manual Retry Now allowed) |
| `cancelled_local_only` | Cancel ≠ failure; local report retained |

Rules:

- Persist transitions on the queue item payload
- Resume from last checkpoint (`field_test_run_id`, confirmed artifacts)
- Never mark `uploaded` before successful `finalizeResult`
- Skip already-confirmed artifacts
- Partial uploads remain `partially_uploaded`

## Artifact states

`pending` | `uploading` | `uploaded` | `retry_wait` | `failed_permanent` | `missing_local`

## Retries

Backoff (contract): 1s → 5s → 15s → 60s cap, max **8** attempts, with jitter.

**Retryable:** offline/network, timeout, temporary 5xx, upload interrupt, auth refresh after recovery.

**Permanent:** invalid manifest, foreign task / owner mismatch, invalid MIME/type, oversized, checksum mismatch after classification, missing required local artifact, rejected contract version.

Manual **Retry Now** clears `next_attempt_at` and re-enters orchestration.
