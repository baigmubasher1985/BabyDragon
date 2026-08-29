# Field Results QC Workflow (F10C2 Phase 3)

Operational QC language for admins lives in [OPERATOR_ADMIN_MANUAL.md](./OPERATOR_ADMIN_MANUAL.md) §8. This file remains the decision-contract note.

## Decisions (field-result level, additive)

| Decision | Notes |
|----------|-------|
| QC Passed | Human accept; blocked if required artifacts missing unless documented override |
| QC Failed | Notes required |
| Needs Re-drive | Re-drive reason required; may link future task via provider |
| Waiting for Processing | Allowed while processing incomplete |
| Waiting for Logs | Default waiting |
| Log Naming Issue | Packaging / naming |
| Missing Evidence | Missing-evidence details required |

Task-level QC Review V1 decisions are **not renamed or removed**.  
“Waiting for Processing” is additive for unified field results.

## Validation (client UX only)

- Decision required
- Notes required for QC Failed
- Re-drive reason required for Needs Re-drive
- Missing-evidence details required for Missing Evidence
- No final decision while processing incomplete (waiting decisions only)
- No QC Passed with missing required artifacts unless authorized override
- Repeated identical save is idempotent in mock mode
- History is **append-only** (prior entries never mutated)

**QC is never auto-passed** because upload completed, iterations completed, or no runtime failures.

## History entry fields

decision · reviewer · date/time · notes · missing evidence · re-drive reason · linked re-drive task · previous decision

## Re-drive

- Original result remains linked to original task
- Provider creates/links a synthetic future re-drive task id
- Does not replace task-level re-drive in QC Review V1

## Role matrix (UX)

| Role | Field Results nav | QC write |
|------|-------------------|----------|
| admin / super_admin | Yes | Yes |
| fe | No (FE dashboard) | No |
| inactive / anon | No | No |

Client checks are **UX only**. Phase 1 RLS/RPC/server authorization remains mandatory before real deployment.

## Mock fixtures

See `src/fieldResults/fixtures/fieldResultsFixtures.js` — sanitized scenarios covering HTTP/FTP/iPerf3/OOKLA/FCC/RF-only, GPS/RF gaps, NR SA/NSA, voice events, artifact/upload/processing/QC states. No real customer data.
