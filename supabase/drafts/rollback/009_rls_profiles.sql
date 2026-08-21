-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: BLOCKED_PENDING_EDGE_AND_CLIENT_CUTOVER — forward is documentation-only / no-op.
-- NOTE: Blocked/no-op forward → no-op rollback (no production policy rewrite).
-- PAIR: 009_rls_profiles
-- ROLE: ROLLBACK
-- CLASSIFICATION: blocked_documentation_only

SELECT 'rls_profiles_rollback_noop_forward_was_blocked' AS status;

-- Captured live baseline names (02a) for future disposable restore reference only:
-- "Admins can update users", "Admins can view all profiles",
-- "Users can read their own profile", "Users can update own profile",
-- "Users can view own profile"
-- See supabase/tests/fixtures/captured_rls_policies_02a.json — do not claim exact
-- restoration unless verified against disposable/live metadata.
