-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: SECURITY DEFINER owner: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION — do not CREATE ROLE or ALTER OWNER to a guessed role.
-- NOTE: Rollback restores exact bodies from 01b_function_definitions.csv.
-- PAIR: 002_harden_existing_functions
-- ROLE: VERIFICATION (SELECT-ONLY)

SELECT p.proname, p.prosecdef, COALESCE(array_to_string(p.proconfig, ','), '') AS settings
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('is_admin_or_super_admin','get_field_engineers','get_grids_geojson','set_qc_reviews_updated_at')
ORDER BY p.proname;
