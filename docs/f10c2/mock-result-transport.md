# Mock Result Transport (F10C2 Phase 2)

**Kind:** `mock_f10c2_phase2`  
**Location:** `src/mobile/rf/submission/mockResultTransport.js`

## Operations (replaceable interface)

| Method | Role |
|--------|------|
| `registerResult(manifest)` | Idempotent run registration |
| `requestArtifactUpload({ fieldTestRunId, artifact })` | Register artifact + mock ticket |
| `uploadArtifact({ artifactId, uploadTicket, ... })` | Mock byte upload / resume |
| `confirmArtifact({ artifactId, checksum })` | Complete with checksum |
| `finalizeResult({ clientRunId, fieldTestRunId })` | Mark run uploaded |
| `fetchSubmissionStatus({ clientRunId })` | Restart / recovery probe |

## Simulated failure modes

`success`, `duplicate_registration`, `expired_auth`, `retryable_network`, `permanent_validation`, `interrupted_artifact`, `already_confirmed_artifact`, `finalization_failure`, `status_recovery`

## Future real transport boundary

A future module (not in this phase) may implement the **same method names** against:

- `submit_field_test_run`
- `register_field_test_artifact`
- Storage upload to private `result-artifacts`
- `complete_field_test_artifact_upload`

Constraints for that future swap:

- Keep idempotency keys (`client_run_id`, `artifact_id`)
- Keep durable `bucket` + `object_key` (no signed URL persistence)
- Keep `F10C2_SERVER_SUBMIT_ENABLED` gate
- Never put service-role or JWTs into the queue

## Explicit limitation

Phase 2 **did not** connect to any Supabase project, create buckets, or validate live upload.
