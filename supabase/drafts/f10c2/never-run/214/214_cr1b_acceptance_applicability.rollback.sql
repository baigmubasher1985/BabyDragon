-- QUARANTINED — NEVER RUN
-- Archive: supabase/drafts/f10c2/never-run/214/
-- DO NOT APPLY. DO NOT COPY INTO phase4b/rollback.
-- Canonical order: 210 → 211 → 212 → 213 → skip 214 → 215 → 216
-- DRAFT ROLLBACK — 214_cr1b_acceptance_applicability
-- Historical only. Inverse of unused helper. DO NOT EXECUTE.

BEGIN;
DROP FUNCTION IF EXISTS public.cr1b_scenario_voice_applicable(text, jsonb, boolean);
COMMIT;
