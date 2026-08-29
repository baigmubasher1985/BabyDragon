-- F10C2 CR1-E
-- PAIR: 216_cr1e_acceptance_profile_status
-- ROLE: ROLLBACK
-- Drops the profile-status RPC only. Does not rewrite snapshots, runs, QC, users, or artifacts.
-- Does not restore client UPDATE on acceptance_profiles (there was none).
-- DO NOT EXECUTE unless verification proves a partial 216 apply.

BEGIN;

DROP FUNCTION IF EXISTS public.set_acceptance_profile_active(uuid, boolean);

COMMIT;
