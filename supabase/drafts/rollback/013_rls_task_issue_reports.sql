-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: BLOCKED_PENDING_RPC_CLIENT_CUTOVER — forward is documentation-only / no-op.
-- NOTE: Blocked/no-op forward → no-op rollback (no production policy rewrite).
-- PAIR: 013_rls_task_issue_reports
-- ROLE: ROLLBACK
-- CLASSIFICATION: blocked_documentation_only

SELECT 'rls_issues_rollback_noop_forward_was_blocked' AS status;

-- Captured 02a baseline retained in supabase/tests/fixtures/captured_rls_policies_02a.json.
