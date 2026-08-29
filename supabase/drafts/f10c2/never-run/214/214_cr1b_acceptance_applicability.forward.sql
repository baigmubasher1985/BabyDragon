-- QUARANTINED — NEVER RUN
-- Archive: supabase/drafts/f10c2/never-run/214/
-- DO NOT APPLY. DO NOT COPY INTO phase4b/forward.
-- Canonical order: 210 → 211 → 212 → 213 → skip 214 → 215 → 216
-- DRAFT / DISPOSABLE CR1-B-U-R2
-- F10C2 CR1 ACCEPTANCE APPLICABILITY (SQL TWIN OF src/acceptance/scenarioApplicability.js)
-- PAIR: 214_cr1b_acceptance_applicability
-- ROLE: FORWARD (ARCHIVED — NOT EXECUTABLE)
-- CLASSIFICATION: NEVER RUN. DO NOT EXECUTE.
-- NOTE: Does not re-apply 209–213. Does not overwrite immutable snapshot rows.
--       Existing unique(run_id) snapshots remain. New evaluations skip inapplicable MO/MT.

BEGIN;

CREATE OR REPLACE FUNCTION public.cr1b_scenario_voice_applicable(
  p_scenario_type text,
  p_profile jsonb,
  p_has_call_events boolean
) RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT
    CASE
      WHEN lower(coalesce(p_scenario_type, '')) IN ('native_http', 'ftp', 'iperf3', 'ookla', 'ookla_app', 'fcc', 'fcc_app')
        AND coalesce(p_profile->>'kind', p_profile->'rules'->>'family', '') <> 'combined'
        THEN false
      WHEN lower(coalesce(p_scenario_type, '')) IN ('native_http', 'ftp', 'iperf3', 'ookla', 'ookla_app', 'fcc', 'fcc_app')
        AND coalesce(p_profile->>'kind', p_profile->'rules'->>'family', '') = 'combined'
        AND coalesce(p_has_call_events, false) IS TRUE
        THEN true
      WHEN lower(coalesce(p_scenario_type, '')) IN ('voice', 'voice_mo', 'voice_mt', 'mo', 'mt')
        THEN true
      WHEN lower(coalesce(p_scenario_type, '')) IN ('rf_only', 'rf_data', 'rf')
        THEN false
      ELSE false
    END;
$function$;

COMMENT ON FUNCTION public.cr1b_scenario_voice_applicable(text, jsonb, boolean) IS
  'DRAFT. Wire into evaluate_field_test_run_acceptance before combining MO/MT into overall. Not executed.';

COMMIT;
