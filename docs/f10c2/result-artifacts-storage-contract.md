# Result Artifacts Storage Contract (F10C2 Phase 1)

**DRAFT / UNAPPLIED.** Bucket is **not** created in Phase 1.

## Bucket

| Field | Value |
|-------|-------|
| Name | `result-artifacts` |
| Visibility | Private |
| Distinct from | `operational-evidence`, `task-photos` |

## Durable reference

Durable DB persistence requires **both**:

- `bucket = result-artifacts`
- `object_key = {project_id}/{task_id}/{verified_user_id}/{field_test_run_id}/{artifact_id}.{safe_ext}`

Never store signed URLs or public HTTPS URLs as durable refs.

## Supported artifact types

Not all required on every run:

| `artifact_type` | Typical content |
|-----------------|-----------------|
| `unified_json` | Unified Field Report JSON |
| `rf_csv` | RF / GPS trace CSV |
| `gps_csv` | GPS-only CSV when split |
| `events_csv` | Radio / data / voice events |
| `scenario_csv` | Per-scenario iteration CSV |
| `excel_plot` | Excel Plot / Unified workbook |
| `ookla_evidence` | OOKLA external evidence package |
| `fcc_evidence` | FCC external evidence package |
| `package_zip` | Optional multi-file ZIP |
| `other` | Explicitly typed escape hatch |

## MIME / size (Phase 1 contract)

| Rule | Value |
|------|-------|
| Max size | 100 MiB per artifact |
| MIME allow-list | `application/json`, `text/csv`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/zip`, `application/octet-stream`, `image/jpeg`, `image/png` |
| Extensions | `json`, `csv`, `xlsx`, `zip`, `jpg`/`jpeg`, `png` |

## Ownership / idempotency

1. `verified_user_id` path segment MUST equal `auth.uid()` (RPC-enforced).
2. No overwrite of existing `object_key`.
3. Same `(run_id, artifact_type, checksum)` → idempotent success.
4. Same `object_key` with different checksum → reject.
5. Do not place RF packages in `task-photos` or `operational-evidence`.
6. Do not modify/delete existing `task-photos` objects.

## Blocked in Phase 1

- Bucket CREATE / Storage policy APPLY  
- Live upload / signed URL minting for production  
- Edge Function deploy for results upload  

See draft `supabase/drafts/f10c2/forward/112_result_artifacts_storage_contract.sql` (documentation-only).
