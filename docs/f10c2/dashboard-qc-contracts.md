# Dashboard + QC Contracts (F10C2 Phase 1 → Phase 3)

**Phase 1:** contracts / docs / tests.  
**Phase 3:** local/mock Field Results UI implemented under `src/fieldResults/**` — **not** live Supabase.

## Required dashboard views

| View | Purpose | Phase 3 |
|------|---------|---------|
| Runs list | Filter by project, task, grid, scenario_type, run_status, latest_qc_status, submitted_by, date range | Mock list |
| Run detail | Summaries (RF/data/GPS/events), artifact list, processing status | Mock detail tabs |
| Artifact browser | Metadata only; signed URL mint is ephemeral (never durable DB) | Mock access only |
| QC queue | Runs needing review (`Waiting for Logs`, `Missing Evidence`, unset) | Filters on list |
| Re-drive board | `Needs Re-drive` with `redrive_task_id` linkage | QC workspace + filter |

## QC decisions (align with existing `QCReview.jsx` + additive)

| Decision | Notes |
|----------|-------|
| QC Passed | Accept run |
| QC Failed | Reject without re-drive |
| Needs Re-drive | Sets `redrive_needed`; optional `redrive_task_id` |
| Waiting for Processing | Additive for field results (Phase 3) |
| Waiting for Logs | Default pending |
| Log Naming Issue | Naming / packaging issue |
| Missing Evidence | Lists `missing_evidence` |

## Ownership

| Actor | Capability |
|-------|------------|
| Active assigned FE | Submit run/artifacts via RPC; SELECT own assigned runs |
| Inactive FE | Denied |
| Unassigned FE / foreign task | Denied |
| Admin / Super Admin | SELECT all; submit QC via RPC |
| FE | Cannot write QC decisions |

## Compatibility

- Task-level `qc_reviews` remains for existing QC workflow.
- `field_test_qc_reviews` is **additive** run-level QC linked by `field_test_run_id`.
- Dashboard mapping must not break legacy task QC screens.
- Phase 3 UI uses mock provider; live RLS still mandatory before production.

## Mapping contract (tests)

Dashboard row projection fields:

`run_id`, `client_run_id`, `task_id`, `project_id`, `grid_id`, `scenario_type`, `report_name`, `run_status`, `processing_status`, `latest_qc_status`, `submitted_by`, `created_at`, `artifact_count`, `redrive_needed`.
