# supabase/drafts/f10c2/phase4b — disposable validation package (UNAPPLIED)

**Status:** DRAFT / UNAPPLIED / DO NOT RUN during Phase 4B-S.  
**No database connection. No SQL execution in this bootstrap-preparation pass.**

| Path | Role |
|------|------|
| `bootstrap/000_disposable_operational_schema.sql` | DISPOSABLE ONLY operational tables (dual-guard) |
| `bootstrap/000_disposable_operational_schema.verify.sql` | SELECT-only verification |
| `bootstrap/000_disposable_operational_schema.rollback.sql` | Cleanup listing; separate marker; do not run |
| `F10C2_Phase4B_Final_Execution_Order.md` | Final 0–11 execution order |
| `preflight/000_operational_relations.sql` | SELECT-only check that operational tables exist |
| `forward/301_synthetic_fixtures.sql` | Synthetic tenant/connection/run/artifacts/QC (placeholders) |
| `rollback/301_synthetic_fixtures.sql` | Delete synthetic ids/slug only |
| `verification/301_synthetic_fixtures.sql` | SELECT-only fixture checks |

301 is **not** in the 000–206 schema apply list. It is fixture step 8 after bootstrap, security/result/tenant drafts, Auth user creation, and synthetic operational rows.

Migration **207 is NEVER EXECUTE**. SQL **214** is quarantined at `supabase/drafts/f10c2/never-run/214/` (`CR1_NEVER_RUN`). It is **not** draft-in-forward. Apply/discovery scripts must fail if 214 appears in an apply list. Canonical CR1 order: **210 → 211 → 212 → 213 → skip 214 → 215 → 216**. SQL **216** is `CR1E_APPLY` one-shot (applied on disposable 2026-08-28; never auto-apply; do not reapply).

