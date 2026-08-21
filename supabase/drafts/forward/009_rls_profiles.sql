-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: BLOCKED_PENDING_EDGE_AND_CLIENT_CUTOVER — documentation-only; NOT in sequential apply path.
-- NOTE: Do not remove Admin UPDATE or self UPDATE of role/is_active/email until paired Edge + Admin cutover.
-- PAIR: 009_rls_profiles
-- ROLE: FORWARD
-- CLASSIFICATION: blocked_documentation_only

-- Harmless status marker only (no DDL/DML).
SELECT 'profiles_privileged_cutover_blocked_pending_edge_and_client_cutover' AS status;

-- =============================================================================
-- QUARANTINED END-STATE TEMPLATE (NOT EXECUTABLE — comments only)
-- Target after Edge admin-manage-profile + Admin app cutover proof:
-- SELECT: id = auth.uid() OR is_admin_or_super_admin()
-- Privileged role/is_active/email mutations: Edge/service_role only
-- Optional later: narrow update_own_profile_display(full_name) — not authored here
-- =============================================================================
-- -- (policy DROP/CREATE intentionally omitted from executable path)
