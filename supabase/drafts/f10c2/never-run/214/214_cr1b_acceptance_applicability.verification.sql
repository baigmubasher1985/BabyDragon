-- QUARANTINED — NEVER RUN
-- Archive: supabase/drafts/f10c2/never-run/214/
-- DO NOT APPLY. DO NOT COPY INTO phase4b/verification.
-- Canonical order: 210 → 211 → 212 → 213 → skip 214 → 215 → 216
-- DRAFT VERIFICATION — 214_cr1b_acceptance_applicability
-- Historical only. Do not run against any database.

SELECT proname
FROM pg_proc
WHERE proname = 'cr1b_scenario_voice_applicable';
