# WARNING — SQL 214 MUST NEVER BE APPLIED

**DO NOT EXECUTE. DO NOT COPY THESE FILES INTO `phase4b/forward`, `phase4b/verification`, or `phase4b/rollback`. DO NOT ADD `214` TO ANY APPLY LIST.**

This directory is a **quarantine archive**. Migration `214_cr1b_acceptance_applicability` is not an apply-candidate. Canonical CR1 order is:

**210 → 211 → 212 → 213 → skip 214 → 215 → 216**

Never-run alongside 214: `009`, `010`, `012`, `013`, `112`, `207`. Never contact production (`nsne`). Never reapply 215 or 216 without owner authorization.

## What 214 would have done

`214_cr1b_acceptance_applicability.forward.sql` would have created one unused helper:

- `public.cr1b_scenario_voice_applicable(text, jsonb, boolean)` — a SQL twin of `src/acceptance/scenarioApplicability.js`
- It was **never wired** into `evaluate_field_test_run_acceptance` (the draft comment said to wire it later)
- It did **not** add columns, indexes, RPCs, grants, or profile-management behavior
- It was **never executed** on disposable or any other target

Verification would only have selected `proname = 'cr1b_scenario_voice_applicable'`. Rollback would have dropped that unused function.

## Why 215 supersedes 214

SQL **215** (`215_cr1d_acceptance_profile_management`) is the next executed migration after 213. It fully covers the product need that 214 was drafted for, without that unused helper:

| 214 (never run) | 215 (applied on disposable; do not reapply) |
|-----------------|-----------------------------------------------|
| Unused `cr1b_scenario_voice_applicable` helper | No such helper; applicability lives in JS `src/acceptance/scenarioApplicability.js` |
| Did not change profile resolution | Replaces `cr1b_resolve_acceptance_profile` with scenario-family precedence: task+scenario → task → project+scenario → project → tenant+scenario → tenant |
| Did not change evaluate | Replaces `evaluate_field_test_run_acceptance` to resolve by `v_run.scenario_type`; existing snapshots remain immutable |
| No schema additions | Adds `description` and `scenario_family` on `acceptance_profiles`, unique active-scope indexes, `upsert_acceptance_profile` |

214 is **not silently required**. Client applicability already exists. Do not apply 214 to “complete” 215.

## Archive contents (historical only)

- `214_cr1b_acceptance_applicability.forward.sql`
- `214_cr1b_acceptance_applicability.verification.sql`
- `214_cr1b_acceptance_applicability.rollback.sql`

Apply/discovery scripts (`phase4bApplyPlan.mjs`, `scanPhase4bMigrations.mjs`, `applyCr1bMigrations.mjs`, `applyCr1dMigrations.mjs`, `applyCr1eMigrations.mjs`) **must fail** if 214 appears in an apply list or if `214_*.sql` reappears under `phase4b/{forward,verification,rollback}/`.
