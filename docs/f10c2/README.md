# BabyDragon / NetField-360 — F10C2 Master Plan

**Owner:** MobbiTech Global LLC
**Canonical plan for this workstream.** Do not create a competing Master Plan.
**No production Supabase mutation.** Real transport is off by default (`F10C2_SERVER_SUBMIT_ENABLED = false`).

Related canonical docs:

| Doc | Role |
|-----|------|
| [OPERATOR_ADMIN_MANUAL.md](./OPERATOR_ADMIN_MANUAL.md) | User / admin / deployment manual |
| [CONTINUITY.md](./CONTINUITY.md) | Session memory for future Cursor work |
| [UI_UX_BACKLOG.md](./UI_UX_BACKLOG.md) | Structured remaining UI/UX issues |
| [permanent-staging/CUTOVER_PACKAGE.md](./permanent-staging/CUTOVER_PACKAGE.md) | Prepare-only permanent staging cutover |
| [../adr/0001-permanent-staging-before-continued-feature-development.md](../adr/0001-permanent-staging-before-continued-feature-development.md) | Architecture decision |

---

## CR1-E — Permanent database foundation (dated 2026-08-28)

### A. Environment strategy

| Environment | Identity | Purpose |
|-------------|----------|---------|
| Local development | Developer workstation, Vite, mock provider by default | UI and unit/contract work without a live database |
| Permanent development/staging | **Not yet authorized.** Owner must supply project name, ref, and execution approval before any contact | Durable, production-like integration for APK, dashboard, ingest, QC, acceptance, and reports |
| Disposable evidence | `babydragon-f10c2-disposable` / `cxyqqgmepiphyejvceum` | Historical validation only. Not the system of record. Do not finish the product here |
| Production | Prefix `nsne` — **denied** | Isolated live system. No synthetic data. No experimental development |
| Optional customer-hosted / on-prem | Future | Same canonical bootstrap + ordered migrations + RLS + storage + seed + verification. Selectable artifact storage |

Do not turn production into a development environment.

### B. Environment purpose

After cutover succeeds, **permanent development/staging** is the normal integration environment for:

- mobile APK uploads
- authentication and roles
- projects, vendors, tasks and assignments
- RF/GPS evidence
- throughput and voice results
- artifact storage
- ingestion
- acceptance criteria
- QC Review
- reports
- security validation
- future connectors

The disposable project remains evidence only.

### C. Production rule

Production receives only:

- version-controlled migrations
- reviewed application releases
- approved configuration
- explicit deployment authorization

No synthetic development activity in production. The same canonical migration path used on permanent staging is what production will eventually receive — never a one-off dump of disposable data.

### D. Database portability

Long-term deployments must support:

- MobbiTech-hosted Supabase/PostgreSQL
- customer-managed PostgreSQL/Supabase
- on-prem deployments
- cloud deployments
- selectable artifact storage (private bucket + object key; no durable signed URLs)

Schema and policy must come from the ordered draft set, not from console clicking.

### E. Migration principle

Permanent staging and production must be reproducible from:

1. Canonical bootstrap (`000` operational schema)
2. Ordered migrations (F10C1I → F10C2 → Phase 4A → 208/209 → 210–213 → skip 214 → 215 → 216)
3. RLS and grants
4. Storage configuration (`result-artifacts` private bucket)
5. Controlled seed/configuration (tenant, initial super_admin, optional admin; **no synthetic field results by default**)
6. Verification suite

No undocumented one-off database fixes. SQL `214` is quarantined at `supabase/drafts/f10c2/never-run/214/` (`CR1_NEVER_RUN`) and is not silently required. Never-run: `009`, `010`, `012`, `013`, `112`, `207`, `214`.

If no authorized permanent target exists, stop with:

**PERMANENT STAGING TARGET REQUIRED — CUTOVER PACKAGE READY — NO DATABASE CONTACTED**

### F. Current project status (2026-08-28)

- Branch `step-1j2-f10c1i-security-baseline`, committed HEAD `28822c44a1294d76c3f757b7a039f7d41fe31691`
- Working tree holds approved but uncommitted CR1-B through CR1-E
- CR1-D-R2 UI: header Density/Theme aligned; compact criteria wording; single and bulk assignment verified on disposable
- SQL `215` applied on disposable only; `214` never executed (quarantined never-run); `215` not reapplied in CR1-E
- SQL `216` (`set_acceptance_profile_active`) **newly applied once** on disposable as `CR1E_APPLY` one-shot; do not reapply
- Checkpoint tests: `npm run test:f10c2` — 47 files, 464 passed, 14 todo
- Physical iPerf GPS proof: 44 valid / 0 invalid; iter1 DL 6.009; averages 34.474 / 53.565; report `F10C2-P4BU-E2E_Data_RF_Report_20260825_164751`
- Immutable snapshots: HTTP `abfa51c3-…` / `cf39f235-…`; iPerf `a2951b10-…` / `1dab1239-…`
- Protected queue `bd-rf-1787606300946` never uploaded
- Temporary E2E cleanup: SYNTHETIC F10C2 Validation Task restored via UI to **CR1-B disposable default**. Synthetic open task `F10C2-P4BU-E2E` is **KNOWN DISPOSABLE VALIDATION RESIDUE — PRESERVED BECAUSE PRIOR ASSIGNMENT IS UNPROVEN**. Assignment row remains. **CR1-D-R2 E2E Data Rule** is **Inactive** after Admin UI Deactivate via 216. Effective fallback: **CR1-B disposable default**.
- Permanent staging: suggested name `babydragon-permanent-staging`; **no generated ref supplied**; do not create or connect
- Production untouched

Owner decisions recorded in this pass:

1. Unproven disposable assignment intentionally preserved.
2. Temporary E2E rule was Active until authorized 216 + Admin UI Deactivate; it is now Inactive with assignment preserved.
3. Secure profile-status RPC is required.
4. Disposable rows will not be copied.
5. Clean baseline configuration will be reviewed and seeded.
6. Physical HTTP/iPerf packages may later be re-uploaded through the supported workflow.
7. Permanent staging is the future development environment.
8. Production remains isolated until launch approval.

### G. Remaining roadmap

1. Core UI completion and cosmetic consistency (see [UI_UX_BACKLOG.md](./UI_UX_BACKLOG.md))
2. Permanent staging cutover (after owner supplies target identity)
3. Full APK-to-dashboard E2E validation on permanent staging
4. Report/QC refinement
5. Security and operational readiness (216 already applied on disposable; include it on authorized permanent staging)
6. Deployment packaging
7. Production launch gate
8. Post-Core enhancements

---

# F10C2 — Unified Field Results (Phases 1–4B-S)

**Nature:** Contracts (Phase 1) · Mobile packaging/upload (Phase 2 mock + Phase 4 real transport) · Dashboard/QC (Phase 3 mock + Phase 4 real provider) · Multi-tenant storage architecture (Phase 4A drafts) · Disposable operational bootstrap (Phase 4B-S).

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
| [OPERATOR_ADMIN_MANUAL.md](./OPERATOR_ADMIN_MANUAL.md) | Operator / admin / deployment manual (CR1-E) |
| [CONTINUITY.md](./CONTINUITY.md) | Future-session memory (CR1-E) |
| [UI_UX_BACKLOG.md](./UI_UX_BACKLOG.md) | Remaining UI/UX issues |
| [permanent-staging/CUTOVER_PACKAGE.md](./permanent-staging/CUTOVER_PACKAGE.md) | Permanent staging cutover (prepare only) |

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
- CR1-E does not create or contact a permanent database until the owner authorizes a named staging project.
