# Permanent staging cutover package (prepare only)

**Status:** CR1-E-R1 — permanent-staging **45/45 applied and verified**. Revised **217** privilege contract is **approved** (current sixteen tables + future default grants). 217-only hashed runner has the authorized Session Pooler SQL sender **attached** and remains a **dedicated 217 runner** (does not re-run the 45-path wrapper). 217 is **not executed** until dedicated approval is yes **and** `--execute`. 45-path SQL execution approval remains **no**. Dedicated 217 flag remains **no**. Auth users and baseline seed are **still blocked**. Draft **218** is not required. Disposable SQL **216** remains disposable-only evidence (2026-08-28). Do not re-apply the 45-path set. Do not run 217 recovery automatically.
**Gate:** CR1-E-R1 217-ONLY EXECUTION PACKAGE READY — HASHED SINGLE-MIGRATION RUNNER VERIFIED — EXACT CHECKPOINT READY — SQL UNAUTHORIZED — PRODUCTION UNTOUCHED
**Owner:** MobbiTech Global LLC · Product: BabyDragon / NetField-360
**Dated:** 2026-08-29

Authorized staging identity (not production):

- Project name: `babydragon-permanent-staging`
- Ref: `qxtnoxkyyancndgswjnu`
- API host: `qxtnoxkyyancndgswjnu.supabase.co`
- Session Pooler user: `postgres.qxtnoxkyyancndgswjnu`
- Connection method: session-pooler
- 45-path wrapper: `scripts/f10c2/applyPermanentStagingMigrations.mjs` (explicit 45-path allowlist; execute refused while `F10C2_PERMANENT_STAGING_SQL_EXECUTION_APPROVED` is no; do not re-apply)
- 217-only runner: `scripts/f10c2/applyPermanentStaging217.mjs` (Session Pooler SQL sender attached; still dedicated — not the 45-path wrapper; dry-run by default; execute requires `F10C2_PERMANENT_STAGING_217_EXECUTION_APPROVED=yes` **and** `--execute`; never reuses the 45-path flag)
- 217 hash manifest: `scripts/f10c2/permanentStaging217.hashes.json` (forward, verification, rollback SHA-256)
- Git-gate (both runners): approved branch `step-1j2-f10c1i-security-baseline`; local HEAD equals remote-tracking; no staged changes; execution-package files match committed Git content on execute; reviewed hashes match the dedicated manifest; optional `F10C2_PERMANENT_STAGING_APPROVED_GIT_SHA` must equal current HEAD if supplied. No commit SHA is hardcoded.
- Local gitignored apply ledger: `.permanent-staging-apply-ledger.json` — 45 verified entries; do not delete to make tests pass. 217 records a separate gitignored ledger `.permanent-staging-217-apply-ledger.json` after a later authorized apply.

The 45-path chain is already applied. Do not create Auth users, seed, upload packages, or click Sync Now until draft **217** is reviewed and a later SQL approval is yes. Production prefix `nsne` and disposable ref `cxyqqgmepiphyejvceum` remain denied.

Do not copy the disposable database. Classify data A / B / C below.

Production prefix `nsne` remains denied.

Owner decisions recorded:

1. Unproven disposable assignment intentionally preserved.
2. Temporary E2E rule is **Inactive** after authorized 216 + Admin UI Deactivate. Assignment on `F10C2-P4BU-E2E` is preserved; effective fallback is **CR1-B disposable default**.
3. Secure profile-status RPC is required.
4. Disposable rows will not be copied.
5. Clean baseline configuration will be reviewed and seeded.
6. Physical HTTP/iPerf packages may later be re-uploaded through the supported workflow.
7. Permanent staging is the future development environment.
8. Production remains isolated until launch approval.

---

## 1. Canonical ordered migration manifest

Apply in this exact order on a **blank** permanent staging project. Never write `000…209` as an executable range. Each number below is an individual allowlist entry. Executable source of truth: `scripts/f10c2/permanentStagingApplyPlan.mjs` (`PERMANENT_STAGING_FORWARD_PATHS`). Wrapper: `scripts/f10c2/applyPermanentStagingMigrations.mjs`.

Never execute: **009, 010, 012, 013, 112, 207, 214**.

| # | Forward path |
|---|--------------|
| 000 | `supabase/drafts/f10c2/permanent-staging/000_permanent_staging_operational_schema.sql` (staging adapter; replaces disposable 000 in this allowlist only) |
| 001 | `supabase/drafts/forward/001_security_audit_log.sql` |
| 002 | `supabase/drafts/forward/002_harden_existing_functions.sql` |
| 003 | `supabase/drafts/forward/003_security_helpers.sql` |
| 004 | `supabase/drafts/forward/004_rpc_update_assigned_task_status.sql` |
| 005 | `supabase/drafts/forward/005_rpc_update_assigned_checklist_item.sql` |
| 006 | `supabase/drafts/forward/006_rpc_insert_assigned_task_issue.sql` |
| 007 | `supabase/drafts/forward/007_rpc_insert_assigned_task_update.sql` |
| 008 | `supabase/drafts/forward/008_execute_grants.sql` |
| 011 | `supabase/drafts/forward/011_rls_task_updates.sql` |
| 014 | `supabase/drafts/forward/014_rls_task_grids.sql` |
| 015 | `supabase/drafts/forward/015_rls_projects.sql` |
| 016 | `supabase/drafts/forward/016_rls_grids.sql` |
| 017 | `supabase/drafts/forward/017_rls_routes.sql` |
| 018 | `supabase/drafts/forward/018_rls_route_grids.sql` |
| 019 | `supabase/drafts/forward/019_rls_cell_files_sites_sectors.sql` |
| 020 | `supabase/drafts/forward/020_operational_evidence_schema_contract.sql` |
| 101 | `supabase/drafts/f10c2/forward/101_field_test_runs.sql` |
| 102 | `supabase/drafts/f10c2/forward/102_field_test_artifacts.sql` |
| 103 | `supabase/drafts/f10c2/forward/103_field_test_metrics.sql` |
| 104 | `supabase/drafts/f10c2/forward/104_field_test_qc_reviews.sql` |
| 105 | `supabase/drafts/f10c2/forward/105_rpc_submit_field_test_run.sql` |
| 106 | `supabase/drafts/f10c2/forward/106_rpc_register_field_test_artifact.sql` |
| 107 | `supabase/drafts/f10c2/forward/107_rpc_complete_field_test_artifact_upload.sql` |
| 108 | `supabase/drafts/f10c2/forward/108_rpc_submit_field_test_qc_review.sql` |
| 109 | `supabase/drafts/f10c2/forward/109_rls_field_test_runs.sql` |
| 110 | `supabase/drafts/f10c2/forward/110_rls_field_test_artifacts_metrics.sql` |
| 111 | `supabase/drafts/f10c2/forward/111_rls_field_test_qc_reviews.sql` |
| 113 | `supabase/drafts/f10c2/forward/113_rpc_finalize_field_test_run.sql` |
| 114 | `supabase/drafts/f10c2/forward/114_result_artifacts_private_bucket.sql` |
| 115 | `supabase/drafts/f10c2/forward/115_field_test_execute_grants.sql` |
| 201 | `supabase/drafts/f10c2/phase4a/forward/201_tenants.sql` |
| 202 | `supabase/drafts/f10c2/phase4a/forward/202_storage_connections.sql` |
| 203 | `supabase/drafts/f10c2/phase4a/forward/203_tenant_storage_policies.sql` |
| 204 | `supabase/drafts/f10c2/phase4a/forward/204_field_test_artifacts_tenant_columns.sql` |
| 205 | `supabase/drafts/f10c2/phase4a/forward/205_artifact_transfer_jobs.sql` |
| 206 | `supabase/drafts/f10c2/phase4a/forward/206_rpc_request_artifact_upload_plan.sql` |
| 208 | `supabase/drafts/f10c2/phase4b/forward/208_phase4b_validation_remediation.sql` |
| 209 | `supabase/drafts/f10c2/phase4b/forward/209_disposable_operational_profile_task_rls_remediation.sql` |
| 210 | `supabase/drafts/f10c2/phase4b/forward/210_cr1b_canonical_ingestion_schema.sql` |
| 211 | `supabase/drafts/f10c2/phase4b/forward/211_cr1b_acceptance_engine_schema.sql` |
| 212 | `supabase/drafts/f10c2/phase4b/forward/212_cr1b_rpc_ingest_evaluate_qc.sql` |
| 213 | `supabase/drafts/f10c2/phase4b/forward/213_cr1b_rls_grants.sql` |
| skip 214 | `supabase/drafts/f10c2/never-run/214/` — **NEVER RUN.** Quarantined. Not in the allowlist. |
| 215 | `supabase/drafts/f10c2/phase4b/forward/215_cr1d_acceptance_profile_management.sql` |
| 216 | `supabase/drafts/f10c2/phase4b/forward/216_cr1e_acceptance_profile_status.sql` |

Cross-check: `listPhase4bApplyPlan()` (disposable 000 through 213, 43 files) **plus** `215` **plus** `216`. `listPhase4bApplyPlan()` must never auto-apply 215/216. Staging wrapper uses the explicit 45-path array only. Slot 000 is the **permanent-staging adapter** (`000_permanent_staging_operational_schema.sql`). Historical disposable 000 stays under `phase4b/bootstrap/` for disposable apply plans and is **not** in the staging allowlist. Count stays **45** (adapter replaces 000; it is not a 46th file).

Source of truth for existing-disposable apply subsets: `scripts/f10c2/phase4bApplyPlan.mjs`

- `BOOTSTRAP_APPLY` → `000`
- `F10C1I_APPLY` / `F10C1I_SKIP` (`009`, `010`, `012`, `013`)
- `F10C2_APPLY` / `F10C2_SKIP` (`112`)
- `PHASE4A_APPLY` / `PHASE4A_NEVER_EXECUTE` (`207`)
- `PHASE4B_R1_APPLY` = `208`
- `PHASE4B_U_R1_APPLY` = `209`
- `CR1B_APPLY` = `210`, `211`, `212`, `213`
- `CR1_NEVER_RUN` = `214` (quarantined `supabase/drafts/f10c2/never-run/214/`; not draft-in-forward)
- `CR1D_APPLY` = `215`
- `CR1D_DRAFT_ONLY` = empty
- `CR1E_APPLY` = `216` (one-shot; never auto-apply)
- `CR1E_DRAFT_ONLY` = `217_cr1e_staging_grant_hardening` (revised current + future defaults **approved**; not in the 45-path allowlist; apply only via the 217-only hashed runner after dedicated approval). Rollback partner is **manual emergency recovery**, not a bit-identical inverse.

Canonical CR1 order: **210 → 211 → 212 → 213 → skip 214 → 215 → 216**.

Next-apply adapter: **implemented.** Historical `000_disposable_operational_schema.sql` asserts `app.f10c2_disposable_confirmed = yes` (it does not SET that GUC; the disposable JS wrapper does `SET LOCAL`). That GUC is inappropriate on staging. The staging adapter copies the same schema DDL, omits the assert-yes / SET LOCAL / any invented `app.f10c2_staging_confirmed`, and aborts if the disposable GUC is already yes or if `public.profiles` is labeled DISPOSABLE ONLY. Empty-DB proof is a REST-only live gate on the **execute** path (before first migration). The 45-path execute already ran. This pass does not send SQL.

## 2. Migrations to apply (permanent staging, fresh)

**Applied and verified on permanent staging (45/45).** Exact executed ledger ids: `000, 001, 002, 003, 004, 005, 006, 007, 008, 011, 014, 015, 016, 017, 018, 019, 020, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 113, 114, 115, 201, 202, 203, 204, 205, 206, 208, 209, 210, 211, 212, 213, 215, 216`. Do not re-apply. Do not apply `009`, `010`, `012`, `013`, `112`, `207`, or `214`. Draft `217` is ready for a later **217-only** hashed apply. 45-path SQL execution approval is **no**. Dedicated 217 approval is **no**.

## 3. Retired / never-run drafts

| Slug | Rule |
|------|------|
| `009_rls_profiles` | Never-run until Edge + admin profile cutover |
| `010_rls_tasks` | Never-run until RPC + client cutover |
| `012_rls_task_checklist_items` | Never-run until RPC + client cutover |
| `013_rls_task_issue_reports` | Never-run until RPC + client cutover |
| `112_result_artifacts_storage_contract` | Documentation-only; bucket DDL is `114` |
| `207_rls_tenant_storage_assumptions` | **NEVER EXECUTE** |
| `214_cr1b_acceptance_applicability` | **NEVER RUN.** Quarantined at `supabase/drafts/f10c2/never-run/214/`. 215 supersedes. Not silently required. Do not execute |
| `217_cr1e_staging_grant_hardening` | **CR1E_DRAFT_ONLY.** Privilege contract approved. Apply only via `scripts/f10c2/applyPermanentStaging217.mjs` after `F10C2_PERMANENT_STAGING_217_EXECUTION_APPROVED=yes` and `--execute`. Not in the 45-path allowlist. Recovery is manual emergency only and reopens client writes; prefer a forward-fix, especially on production |
| `218_cr1e_vendor_contract` | **Not required.** Vendor is persisted `projects.customer` text. No `vendors` table |

Disposable-only synthetic fixture **301** is **not** part of permanent staging by default.

## 4. Bootstrap prerequisites

- Authorized staging project (not production, not the disposable evidence project unless the owner explicitly reuses it — default is a **new** durable project)
- PostgreSQL role that can own SECURITY DEFINER functions (documented as disposable `postgres`; staging owner must be named by the owner, never guessed)
- Extensions typically required by bootstrap/helpers (uuid/pgcrypto as declared in `000`)
- Auth enabled; no production identities
- `.env.permanent-staging` present locally, gitignored, **names** matching `.env.permanent-staging.example`

## 5. Extensions and database prerequisites

Follow `000_permanent_staging_operational_schema.sql` (same operational tables as historical disposable 000: profiles, tasks, projects, grids, routes, and related). F10C1I 001–020 do not create those tables. Staging bootstrap is the same schema without a disposable GUC. Do not modify historical `000_disposable_operational_schema.sql`.

## 6. RLS policies

- F10C1I 011, 014–020: operational tables
- F10C2 109–111: field test runs/artifacts/metrics/QC
- 209: profile/task RLS remediation
- 213: CR1-B acceptance + iteration/call RLS — **SELECT for authenticated; mutations via SECURITY DEFINER RPC**
- Storage policies on `storage.objects` from `114`

`acceptance_profiles` remains SELECT-only for the client. Status changes go through SECURITY DEFINER `set_acceptance_profile_active` (**216**, applied on disposable). Do not grant broad client UPDATE.

## 7. RPC / function grants

- F10C1I 008 execute grants (assignment RPCs)
- F10C2 115 field-test execute grants (submit/register/complete/finalize/QC)
- 206 upload-plan RPC
- 212 ingest/evaluate/QC RPCs
- 215 upsert/list/assign profile RPCs
- **216** `set_acceptance_profile_active` — include on authorized staging; already applied on disposable

REVOKE anon/PUBLIC. GRANT authenticated only where intended. No public table grants.

**STG-GRANT-001 (open — revised draft 217):** sixteen post-000 tables still inherit default anon and authenticated write privileges (`tenants`, `storage_connections`, `tenant_storage_policies`, `artifact_transfer_jobs`, `field_test_runs`, `field_test_artifacts`, `field_test_metrics`, `field_test_qc_reviews`, `field_test_iterations`, `field_test_call_events`, `field_test_run_acceptance_snapshots`, `field_test_iteration_evaluations`, `field_test_call_summaries`, `qc_verdict_overrides`, `acceptance_profiles`, `acceptance_rules`). Bootstrap 000 tables already revoke anon. RLS on field-test/acceptance tables does not dismiss the finding. Tenant/storage tables have no RLS (207 never-run).

Draft 217 current-table effect (approved plan): revoke anon/PUBLIC on the sixteen; authenticated SELECT only on the twelve RLS workflow tables; no client table access on the four RLS-less tenant/storage tables; service_role retains required access; mutations stay on secured RPCs; `storage.objects` policies untouched.

Draft 217 future-object effect (catalog-inspected 2026-08-29): `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public` revokes automatic PUBLIC/anon/authenticated privileges on future tables, sequences, and functions. The creating migration must GRANT explicitly. No convenience authenticated default. `postgres` is the owner of all current public tables/functions. `supabase_admin` also has public client default ACLs, but the staging session is not a member of that role, so those platform defaults remain as a documented residual. 217 does not change storage/auth/realtime/extension defaults.

217 recovery (kept under `rollback/`): **manual emergency recovery**, not a bit-identical inverse. It reopens direct client writes. It does not restore table-wipe (TRUNCATE) or MAINTAIN. It restores captured postgres public client defaults minus those broader privileges. Never run automatically. Production documentation: prefer a forward-fix over reopening unsafe grants. Do not apply 217 in this pass.

## 8. Storage bucket definitions and policies

- Private bucket `result-artifacts` (`114`)
- Object key `{project_id}/{task_id}/{verified_user_id}/{field_test_run_id}/{artifact_id}.{safe_ext}`
- Never store signed/public URLs as durable refs
- Do not use `task-photos` or `operational-evidence` for field-test artifacts
- FE insert own path; admin select; short-lived signed URLs at download time

## 9. Authentication role / bootstrap requirements

Create **real staging Auth users** (not production identities):

- initial `super_admin` profile linked to Auth uid
- optional `admin`
- optional FE only if needed for APK proof (label as staging)

Do not import disposable synthetic emails by default.

## 10. Environment-variable template (names only)

Repo file: `.env.permanent-staging.example`
Actual secrets file: `.env.permanent-staging` (gitignored)

Canonical names (Decision 5):

- `BABYDRAGON_STAGING_PROJECT_NAME` (suggested value later: `babydragon-permanent-staging`)
- `BABYDRAGON_STAGING_PROJECT_REF`
- `BABYDRAGON_STAGING_SUPABASE_URL`
- `BABYDRAGON_STAGING_ANON_KEY`
- `BABYDRAGON_STAGING_SERVICE_ROLE_KEY`
- `BABYDRAGON_STAGING_DATABASE_URL`
- `BABYDRAGON_STAGING_DB_PASSWORD`
- `BABYDRAGON_STAGING_ADMIN_EMAIL`
- `BABYDRAGON_STAGING_ADMIN_PASSWORD`
- `BABYDRAGON_STAGING_FE_EMAIL`
- `BABYDRAGON_STAGING_FE_PASSWORD`

Compatible cutover-gate aliases: `F10C2_PERMANENT_STAGING_*` (including `CONFIRMED`, `NOT_PRODUCTION`, `SQL_EXECUTION_APPROVED`, `217_EXECUTION_APPROVED`, `APPROVED_GIT_SHA`, `CONNECTION_METHOD`). Never print values. The 45-path flag does not authorize 217.

## 11. Controlled seed plan

**Do not copy disposable table rows.** Propose a clean baseline seed for human review, then seed only after approval.

**Class A — canonical configuration (review, then seed; never dump disposable rows):**

- required lookup / reference values
- one approved tenant baseline
- required system configuration
- carefully selected acceptance-rule **templates** (below)
- initial `super_admin` and optional `admin` Auth users created on staging (not imported from disposable)

**Proposed baseline acceptance templates (approved definitions — human review — not seeded):**

1. **Standard Data Throughput**
   - Download enabled. Minimum DL throughput per passing iteration: 10 Mbps. Required passing DL iterations: 20.
   - Upload enabled. Minimum UL throughput per passing iteration: 1 Mbps. Required passing UL iterations: 20.
   - Overall combination: AND.
   - Pass only when both are true: at least 20 completed DL iterations individually reach at least 10 Mbps; at least 20 completed UL iterations individually reach at least 1 Mbps.
   - Failed, missing or incomplete iterations do not count as passes.
   - Missing applicable evidence remains INCOMPLETE—not zero and not PASS.

2. **Standard Voice Calls**
   - MO enabled. Required successful MO calls: 10.
   - MT enabled. Required successful MT calls: 10.
   - Overall combination: AND.
   - Pass only when both are true: at least 10 MO calls succeed; at least 10 MT calls succeed.
   - A successful call must also count as attempted.
   - Disabled directions display N/A / NOT_EVALUATED.
   - Missing applicable evidence remains INCOMPLETE.
   - Do not add an unapproved dropped-call allowance to this baseline template.

3. **Combined Data and Voice**
   - Enable all four: DL 20 passing iterations at 10 Mbps; UL 20 passing iterations at 1 Mbps; MO 10 successful calls; MT 10 successful calls.
   - Overall combination: AND. All four enabled requirements must pass.
   - Absence of any enabled family remains INCOMPLETE unless the verified engine explicitly classifies an execution failure as FAIL.

Explicitly **excluded** from any seed: CR1 synthetic names, disposable-only versions, **CR1-D-R2 E2E Data Rule**, “CR1-B disposable default”, `SYNTHETIC`, `F10C2-P4BU`, lab thresholds copied from disposable rows. Threshold numbers above are starting points for owner review, not committed SLAs.

**Do not seed by default:** synthetic field results, synthetic projects/tasks/runs, QC fixtures, temporary assignments, disposable artifacts.

## 12. Verification SQL

Run the `verification/` partner for every applied slug individually. For slot 000 use `supabase/drafts/f10c2/permanent-staging/000_permanent_staging_operational_schema.verify.sql` (not the historical disposable verify file). Then: `001`, `002`, `003`, `004`, `005`, `006`, `007`, `008`, `011`, `014`, `015`, `016`, `017`, `018`, `019`, `020`, `101`, `102`, `103`, `104`, `105`, `106`, `107`, `108`, `109`, `110`, `111`, `113`, `114`, `115`, `201`, `202`, `203`, `204`, `205`, `206`, `208`, `209`, `210`, `211`, `212`, `213`, `215`, `216`. SELECT-only. Stop on mismatch. Do not run verification for `009`, `010`, `012`, `013`, `112`, `207`, or `214`. Draft `217` verification exists (current-table grants, postgres public default ACL, broadening/table-wipe detection, documented `supabase_admin` residual, storage defaults untouched) but must not run until that slug is authorized.

## 13. Automated contract tests

- `npm run test:f10c2`
- Focused: `tests/f10c2/cr1bMigrations.contract.test.js`, `cr1dMigrations.contract.test.js`, `cr1eMigrations.contract.test.js`, `cr1eDefaultPrivileges.contract.test.js`, `cr1ePermanentStagingApply.contract.test.js`, `cr1ePermanentStaging217.contract.test.js`, `cr1eProfileStatus.behavior.test.js`, `phase4bPreparation.contract.test.js`, `phase4bSBootstrap.contract.test.js`, `cr1dR2HeaderAssign.behavior.test.js`
- `npm run f10c2:scan-phase4b-migrations`
- `npm run f10c2:scan-cr1b-secrets`

## 14. Cross-tenant isolation tests

- `tests/f10c2` RLS/auth matrices (`validateCr1bAuthMatrix.mjs` pattern)
- Phase 4A tenant columns must not leak artifacts across tenants
- Repeat on staging with two tenants after seed — **after** authorization

## 15. Anonymous / FE / Admin / super_admin permission tests

Reuse CR1-B / CR1-D auth matrices as checklists (FE cannot write QC; anon denied; admin/SA can manage profiles via RPC). Client role gates are UX only.

## 16. APK upload validation

- Server submit flag on only against staging
- Protected queue `bd-rf-1787606300946` never uploaded
- Idempotent `client_run_id`

## 17. Ingestion and idempotency validation

- `212` ingest RPC; repeat submit does not duplicate runs
- Artifact checksum idempotency (`106`/`107`)

## 18. Acceptance resolution validation

Precedence: task+scenario → task → project+scenario → project → tenant+scenario → tenant.
UI assignment must persist after refresh (listProfiles, not mock shell).

## 19. Immutable snapshot validation

`evaluateRun` returns the supplied snapshot. Physical HTTP snapshot `cf39f235-…` and iPerf snapshot `1dab1239-…` must not be rewritten. Pin iter1 DL 6.009 in tests.

## 20. QC aggregation validation

Task-level computed QC does not auto-pass. Human QC is separate. `108` / task-level outcome helpers.

## 21. Signed-artifact download validation

Short-lived URLs only. Missing slots = Not downloadable. No durable public URL.

## 22. GPS / RF validation

Physical package: 44 valid / 0 invalid GPS; RF missing as N/A not zero. Map from signed unified JSON, not a fake polyline.

## 23. Rollback / recovery plan

- Reverse-order rollback SQL for applied slugs
- Staging reset only with written authorization
- Do not DROP DATABASE
- Snapshots remain immutable; rollback of 215 must not rewrite historical evaluations
- **217 recovery is not an automatic inverse.** It reopens direct client writes. Prefer a forward-fix, especially on production. Never restore table-wipe. Never run automatically.

## 24. Disposable-to-permanent comparison checklist

| Topic | Disposable evidence | Permanent staging |
|-------|---------------------|-------------------|
| Project | `babydragon-f10c2-disposable` | Owner-named durable project |
| 215 | Applied | Apply once on fresh chain |
| 214 | Not executed; quarantined never-run | Still not executed |
| 216 | Applied once on disposable | Include on a fresh authorized staging chain |
| Synthetic tasks/runs | Present | Absent by default |
| Physical packages | Present | Re-upload via APK after staging exists (Class C) — not now |
| E2E rule | Inactive after 216 + Admin UI; assignment on `F10C2-P4BU-E2E` preserved; effective **CR1-B disposable default** | Do not migrate the temporary rule |

## 25. Production deployment checklist

Use **this same canonical migration list**. Additional gates: production ref confirmation, no synthetic seed, reviewed app release, explicit owner authorization, deny prefix check (`nsne`). Never apply disposable leftovers.

---

## Critical data classification

### A. Migrate as canonical configuration only if approved — **do not copy disposable rows**

Create a **clean baseline seed** after human review:

- required lookup / reference data
- one approved tenant baseline
- required system configuration
- the three proposed acceptance-rule templates in §11 (or an owner-revised set)
- **no** CR1 synthetic names, **no** disposable-only versions, **no** temporary E2E rule

### B. Do not migrate (Class B disposable test data)

- Synthetic users
- Synthetic projects
- Synthetic vendors
- Synthetic tasks (including **SYNTHETIC F10C2 Validation Task**, synthetic open task **F10C2-P4BU-E2E**, re-drive task)
- Synthetic assignments
- Synthetic runs
- Synthetic / validation QC records
- Temporary rules (including **CR1-D-R2 E2E Data Rule**)
- Disposable artifacts
- Validation fixtures
- Screenshots
- Audit-only fixtures

`F10C2-P4BU-E2E` remains **KNOWN DISPOSABLE VALIDATION RESIDUE — PRESERVED BECAUSE PRIOR ASSIGNMENT IS UNPROVEN** on disposable. It is not a staging seed.

### C. Physical validation evidence — re-upload later; do not copy DB rows

Do **not** copy database rows. After permanent staging exists, is verified, and the owner authorizes an upload, re-upload through the real APK / upload workflow:

1. one known physical Native HTTP package
2. one known physical iPerf3 package

Use them only as controlled permanent-staging E2E evidence. **Do not upload in this pass.**

Preserve expected truth for comparison:

| Item | Identity / value |
|------|------------------|
| Native HTTP run | `abfa51c3-…`, snapshot `cf39f235-…` |
| iPerf run | `a2951b10-…`, snapshot `1dab1239-…` |
| Report | `F10C2-P4BU-E2E_Data_RF_Report_20260825_164751` |
| iPerf iteration 1 DL | **6.009** Mbps |
| Average DL / UL | **34.474** / **53.565** Mbps |
| GPS | **44** valid / **0** invalid |
| Snapshots | Immutable — re-evaluation must not rewrite them |
| Protected queue | `bd-rf-1787606300946` — never upload |

---

## Post-apply verification sequence (plan only — do not run in this pass)

After a later explicit SQL approval and a successful hashed apply, verify in this exact order. Stop on first failure. Do not seed, create Auth, or upload until the empty-Auth / no-synthetic checks pass.

1. **Tables** — adapter verify SQL; every later `verification/` partner; 14 operational tables + later CR1 tables exist; RLS enabled on bootstrap tables; business tables empty until authorized seed.
2. **RPCs** — 004–007, 105–108, 113, 206, 212, 215, 216 exist as SECURITY DEFINER where specified; `set_acceptance_profile_active` present; no 214 objects.
3. **RLS** — 011, 014–020, 109–111, 209, 213 policies present; no permissive `true` policies; `acceptance_profiles` remains SELECT-only for the client.
4. **Grants** — 008, 115, 213: REVOKE anon/PUBLIC; GRANT authenticated EXECUTE only where intended.
5. **Cross-tenant** — two staging tenants after authorized seed; artifact tenant columns do not leak; repeat `validateCr1bAuthMatrix.mjs` pattern against staging.
6. **Storage** — private `result-artifacts` bucket from 114; object-key contract; no `task-photos` / `operational-evidence` for field-test artifacts; REST bucket list matches.
7. **Acceptance** — profile upsert/list/assign (215) + status RPC (216); precedence task+scenario → task → project+scenario → project → tenant+scenario → tenant.
8. **Inactive fallback** — do not seed **CR1-D-R2 E2E Data Rule**; do not restore `F10C2-P4BU-E2E`; default fallback remains CR1-B disposable-default **behavior** as product rule, not a copied disposable row.
9. **Ingest / idempotency** — `ingest_field_test_canonical_result` / `submit_field_test_run`; repeat submit does not duplicate `client_run_id`; artifact checksum idempotency (106/107).
10. **Snapshots** — `evaluateRun` returns the supplied snapshot; do not rewrite historical HTTP `cf39f235-…` or iPerf `1dab1239-…` (those live on disposable evidence; staging must not import them).
11. **QC** — task-level QC does not auto-pass; 108 / field_test_qc_reviews; human QC separate from computed QC.
12. **Empty Auth before account creation** — Auth admin user count 0 (or proven empty) **before** creating staging SA/Admin/FE; then create real staging users, never production identities.
13. **No synthetic results** — no SYNTHETIC / F10C2-P4BU / disposable fixture rows; `F10C2_PERMANENT_STAGING_SEED_SYNTHETIC_FIELD_RESULTS=no`.
14. **No disposable marker** — `current_setting('app.f10c2_disposable_confirmed', true)` is not `yes`; `public.profiles` comment is not `DISPOSABLE ONLY`.
15. **Staging identity** — project name `babydragon-permanent-staging`, ref `qxtnoxkyyancndgswjnu`, host `qxtnoxkyyancndgswjnu.supabase.co`, pooler user `postgres.qxtnoxkyyancndgswjnu`.
16. **Production untouched** — prefix `nsne` denied; no production SQL, Auth, storage, or env mutation.

Protected queue `bd-rf-1787606300946` is never uploaded.

---

## CR1-E-R1 test-contract correction

Two local failures in `tests/f10c2/cr1ePermanentStagingApply.contract.test.js` were stale contracts:

1. Wrapper Git gate used to hardcode a commit SHA (`REQUIRED_GIT_HEAD`). That stale-SHA cycle is removed. Both the 45-path wrapper and the 217-only runner use the SHA-free git-gate (approved branch, HEAD == remote-tracking, no staged changes, clean execution-package files on execute, reviewed hashes, optional locally supplied approved SHA).
2. Execute tests assumed `.permanent-staging-apply-ledger.json` did not exist. After 45/45 apply the gitignored ledger has 45 verified entries. Tests now cover pre-apply (absent) and post-apply (exactly 45 verified, reviewed hashes, authorized staging ref, no secrets, no production/disposable identity). Wrapper resume policy treats a complete ledger as already applied — refuse re-apply. The ledger was not deleted. The 217-only runner refuses unless that 45-entry ledger is complete and verified.

## Vendor contract (no 218)

Permanent staging has **no `vendors` table**. That is not a missing dependency before Auth/seed.

Current persistence model: **project text field** `projects.customer`.

| Surface | Behavior |
|---------|----------|
| Admin Create Project | Writes `projects.customer` |
| Vendor-management UI | None. Customer field is the vendor identity |
| Assign Task | Displays `selectedProject.customer`; task insert has no vendor column |
| Task records | No `vendor` / `vendor_id` column |
| Project records | `customer text` from 000 |
| Field Results mapper | `vendor_name` ← `project.customer` (provider now selects `customer`) |
| QC Review | `projects.select("*")` includes `customer` |
| Mobile task payload | FE/mobile join `projects (… customer …)` |
| Migrations / Master Plan | No vendors table. Plan wording “projects, vendors, tasks” means the customer/vendor label on the project |

Gap/loss point: Field Results previously selected `projects.id,name,market` and dropped `customer`, so the Vendor column could not show the persisted name. That is a provider mapping gap, now corrected. Do not create a normalized vendors table merely because the UI has a Vendor column.

## What CR1-E / CR1-E-R1 did not do (still true)

- Permanent staging 45/45 applied in the authorized earlier execute pass; 45-path SQL approval is now **no** again
- Draft **217** privilege contract approved; 217-only hashed runner has Session Pooler sender attached and remains dedicated; 217 not executed. Dedicated 217 approval is **no**. Recovery is manual emergency only.
- Draft **218** not created (not required)
- 216 newly applied once on disposable only; 215 not reapplied; 214 not executed
- No Auth users created
- No baseline seed
- No packages uploaded
- Sync Now not clicked
- Disposable not contacted in this pass
- Production untouched
