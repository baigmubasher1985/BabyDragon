# F10C2 — Unified Field Results (Phases 1–4B-S)

**Nature:** Contracts (Phase 1) · Mobile packaging/upload (Phase 2 mock + Phase 4 real transport) · Dashboard/QC (Phase 3 mock + Phase 4 real provider) · Multi-tenant storage architecture (Phase 4A drafts) · Disposable operational bootstrap (Phase 4B-S).
**No production Supabase mutation.** Real transport is off by default (`F10C2_SERVER_SUBMIT_ENABLED = false`).

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Schema/RPC/RLS drafts, canonical manifest | Complete (contracts) |
| 2 | Mobile packaging + offline mock upload | Complete (mock) |
| 3 | Field Results dashboard + QC workflow | Complete (local/mock) |
| 4 | Disposable Supabase end-to-end integration | Code ready; live apply requires proven disposable project |
| 4A | Multi-tenant storage-neutral architecture | Local interface + unapplied drafts; no DB action |
| 4A-R1 | Tenant storage integrity corrections | Unapplied drafts 201–206; **207 NEVER EXECUTE** |
| 4B-P | Disposable validation preparation | Local plan/guards; operational tables were the blocker |
| 4B-S | Disposable operational schema bootstrap | Local SQL + dual guard; **not executed** |

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
| [phase4-disposable-integration.md](./phase4-disposable-integration.md) | Phase 4 disposable apply / flags |
| [phase4a-multi-tenant-storage.md](./phase4a-multi-tenant-storage.md) | Phase 4A storage-neutral / tenant architecture |
| [F10C2_Phase4B_Final_Execution_Order.md](./F10C2_Phase4B_Final_Execution_Order.md) | Phase 4B final 0–11 execution order (207 NEVER EXECUTE) |

## Code

| Path | Role |
|------|------|
| `src/mobile/rf/reports/serverSubmissionManifest.js` | Canonical manifest |
| `src/mobile/rf/submission/*` | Packaging + mock + real transport |
| `src/mobile/MobileResultUploadStatus.jsx` | Sync-tab queue UX |
| `src/fieldResults/**` | Dashboard + mock/supabase providers |
| `src/storage/**` | ArtifactStorageProvider + deployment config |
| `src/processing/customerWorkerContract.js` | Customer-worker processing boundary |
| `supabase/drafts/f10c2/phase4a/` | Unapplied tenant/storage drafts 201–207 |
| `src/AdminDashboard.jsx` | Field Results nav (admin) |
| `src/pages/QCReview.jsx` | Additive link to Field Results |
| `tests/f10c2/*` | Phase 1–4 local tests |
| `scripts/f10c2/*` | Disposable identity / apply (fail-closed) |

## Flags

| Flag | Value | Meaning |
|------|-------|---------|
| `F10C2_SERVER_SUBMIT_ENABLED` | **false** (source default) | Real server submit OFF unless `VITE_F10C2_SERVER_SUBMIT_ENABLED=true` |
| `F10C2_MOCK_RESULT_UPLOAD_ENABLED` | **true** | Local mock packaging/upload path remains available |
| Dashboard provider | **mock** default | `VITE_F10C2_FIELD_RESULTS_PROVIDER=supabase` selects live provider |

## Explicit non-claims

- No real Supabase upload/query from F10C2 paths unless Phase 4 flags and a proven disposable target are set. Phase 4A drafts are not applied.
- Production project apply / Storage / Auth mutation is not authorized.
- Client role gates do **not** replace RLS.
