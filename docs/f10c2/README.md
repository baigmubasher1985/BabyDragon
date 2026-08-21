# F10C2 — Unified Field Results (Phases 1–3)

**Nature:** Contracts (Phase 1) · Mobile mock packaging/upload (Phase 2) · Dashboard/QC **mock** UI (Phase 3).  
**No real Supabase upload/query from F10C2 paths. No Storage. No RPC apply. No production action.**

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Schema/RPC/RLS drafts, canonical manifest | Complete (contracts) |
| 2 | Mobile packaging + offline mock upload | Complete (mock) |
| 3 | Field Results dashboard + QC workflow | **Complete (local/mock — not live server)** |
| 4 | Docker / K8s beyond existing | Pending |

## Documents

| Doc | Topic |
|-----|-------|
| [mobile-result-packaging.md](./mobile-result-packaging.md) | Manifest, adapters, artifacts |
| [result-upload-state-machine.md](./result-upload-state-machine.md) | Package + artifact states |
| [mock-result-transport.md](./mock-result-transport.md) | Mock transport |
| [offline-upload-queue-contract.md](./offline-upload-queue-contract.md) | Dual-queue reuse |
| [result-artifacts-storage-contract.md](./result-artifacts-storage-contract.md) | Private bucket contract |
| [dashboard-qc-contracts.md](./dashboard-qc-contracts.md) | Phase 1 dashboard/QC contracts |
| [field-results-dashboard.md](./field-results-dashboard.md) | Phase 3 IA / list-detail |
| [field-results-provider.md](./field-results-provider.md) | Replaceable provider boundary |
| [field-results-qc-workflow.md](./field-results-qc-workflow.md) | QC decisions / history / roles |
| [feature-flags-compatibility.md](./feature-flags-compatibility.md) | Flags |

## Code

| Path | Role |
|------|------|
| `src/mobile/rf/reports/serverSubmissionManifest.js` | Canonical manifest |
| `src/mobile/rf/submission/*` | Packaging + mock transport |
| `src/mobile/MobileResultUploadStatus.jsx` | Sync-tab queue UX |
| `src/fieldResults/**` | Phase 3 dashboard + mock provider |
| `src/AdminDashboard.jsx` | Field Results nav (admin) |
| `src/pages/QCReview.jsx` | Additive link to Field Results |
| `tests/f10c2/*` | Phase 1–3 local tests |

## Flags

| Flag | Value | Meaning |
|------|-------|---------|
| `F10C2_SERVER_SUBMIT_ENABLED` | **false** | Real server submit OFF |
| `F10C2_MOCK_RESULT_UPLOAD_ENABLED` | **true** | Local mock packaging/upload path |
| Dashboard provider | **mock** | No live DB |

## Explicit non-claims

- Live upload to Supabase / Storage was **not** validated.
- Disposable DB apply was **not** performed.
- Phase 3 dashboard uses **mock fixtures only** — not live server integration.
- Client role gates do **not** replace RLS.
