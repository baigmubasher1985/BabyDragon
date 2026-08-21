# Feature Flags + Compatibility (F10C2 Phase 1–3)

## Feature flags

| Flag | Default | Meaning |
|------|---------|---------|
| `F10C2_SERVER_SUBMIT` | **OFF** (`F10C2_SERVER_SUBMIT_ENABLED = false`) | Real server submit / Storage |
| `F10C2_MOCK_RESULT_UPLOAD` | **ON** (`F10C2_MOCK_RESULT_UPLOAD_ENABLED = true`) | Local mock packaging + mock transport |
| `F10C2_RESULT_ARTIFACTS_UPLOAD` | OFF (docs) | Real Storage path (future) |
| `F10C2_DASHBOARD_RESULTS` | **MOCK UI ON** (local provider) | Field Results dashboard Phase 3 — **not live DB** |
| `F10C2_RUN_LEVEL_QC` | **MOCK UI ON** (local provider) | Run-level QC workspace Phase 3 — **not live RPC** |

## Compatibility rules

1. Additive — do not alter RF/data-report KPI formulas or Excel layouts.
2. Preserve dual offline queues; extend mobile queue only.
3. Preserve task-photos / operational-evidence / task-level `qc_reviews`.
4. Offline must not block local report creation.
5. Queued ≠ uploaded in UI copy.
6. Corrupt queue records quarantined; legacy items tolerated (versioned records).
7. Field Results dashboard uses replaceable mock provider; no direct `field_test_*` queries from components.

## Regression protection

- Existing exporters / MobileApp field workflows remain available.
- Real submit flag stays false until a separately authorized server cutover.
- Live upload / live dashboard DB are **not** claimed validated.
