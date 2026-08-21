# Mobile Result Packaging (F10C2 Phase 2)

## Canonical manifest

Source of truth: `src/mobile/rf/reports/serverSubmissionManifest.js`  
Schema: `SERVER_SUBMISSION_MANIFEST_SCHEMA_VERSION = 1.0.0-f10c2-phase1`

Phase 2 **does not invent a second result contract**. Orchestrator builds the Phase 1 manifest via `buildServerSubmissionManifest()`.

### Included fields

`client_run_id`, `task_id`, `project_id`, `grid_id`, `scenario_type`, `scenario_version`, `config` (non-secret), device/network snapshots, RF/GPS/data/events summaries, artifact descriptors, ownership note that `submitted_by` is server-authoritative.

### Forbidden client fields

Never client-supplied: `submitted_by`, `verified_user_id`, `reviewer_id`, QC/processing server fields, JWTs, refresh tokens, service-role keys, signed URLs.

## Scenario adapters

`src/mobile/rf/submission/scenarioResultAdapters.js` reads existing session/unified truth:

| Scenario | Key |
|----------|-----|
| Native HTTP | `native_http` |
| FTP | `ftp` |
| iPerf3 | `iperf3` |
| OOKLA | `ookla_app` |
| FCC | `fcc_app` |
| RF-only | `rf_data` |

Adapters expose attempt counts, failure/interrupted truth, missing RF/GPS/voice, NR mode hints, and zero-external-iteration flags. **No KPI recalculation.**

## Artifacts

Local descriptors: `artifactLocalDescriptors.js`

| Type (Phase 1 names) | Examples |
|----------------------|----------|
| `unified_json` | Report.json |
| `rf_csv` / `gps_csv` / `events_csv` | RF/GPS/event CSVs |
| `scenario_csv` | THP / summary CSV |
| `excel_plot` | Plots / unified xlsx |
| `ookla_evidence` / `fcc_evidence` | Evidence exports |
| `package_zip` / `other` | Optional |

Rules:

- No bucket name inside `object_key` alone (bucket stored separately as `result-artifacts`)
- No signed URLs; no absolute paths in server manifest
- Strip paths; reject traversal / unsafe extensions
- Correct MIME; optional artifacts allowed; missing local marked accurately
- Large binaries are **file refs** (IndexedDB / native paths) — not localStorage JSON blobs

## Idempotency

- `client_run_id` created once per run identity and persisted (`clientRunIdStore.js`)
- UI reopen / retry reuses the same id
- `artifact_id` stable per `(client_run_id, artifact_type, logical_name)` — not filename-path-only
- Duplicate enqueue **merges**; completed packages are not silently resubmitted

## Auth

- Uses existing client session user id as owner **hint** only
- Never stores JWT/refresh in queue/manifest
- `blocked_auth` when signed out; resume after login
- Owner mismatch → permanent fail (do not attribute to a different user)

## Offline queue integration

Extends existing mobile queue (`babydragon_mobile_offline_queue_v1`) with action `field_test_result_submit`.  
Web FE IndexedDB queue untouched. **No third unrelated queue product.**

## Phase 3 consumption

Dashboard/QC will read server `field_test_runs` / artifacts / QC tables (Phase 1 drafts). Phase 2 only prepares client packages for that future path via mock transport today.
