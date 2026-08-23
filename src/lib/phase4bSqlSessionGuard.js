/**
 * F10C2 Phase 4B-S — dual-guard SQL session marker.
 *
 * The JavaScript target guard must pass AND SQL execution must be approved
 * before the wrapper may emit SET LOCAL app.f10c2_disposable_confirmed = 'yes'.
 * The SQL bootstrap asserts that marker; the marker alone is not sufficient.
 * This module never opens a database connection.
 */

import { evaluatePhase4bTarget } from "./phase4bTargetGuard.js";

export const DISPOSABLE_SQL_MARKER_GUC = "app.f10c2_disposable_confirmed";
export const DISPOSABLE_SQL_MARKER_VALUE = "yes";
export const DISPOSABLE_SQL_MARKER_STATEMENT =
  "SET LOCAL app.f10c2_disposable_confirmed = 'yes';";

export const DISPOSABLE_CLEANUP_MARKER_GUC = "app.f10c2_disposable_cleanup_confirmed";
export const DISPOSABLE_CLEANUP_MARKER_STATEMENT =
  "SET LOCAL app.f10c2_disposable_cleanup_confirmed = 'yes';";

function trimStr(value) {
  return String(value || "").trim();
}

export function evaluatePhase4bSqlSessionGuard(input = {}) {
  const identity = evaluatePhase4bTarget(input);
  const reasons = [...identity.reasons];

  const approved = trimStr(input.sqlExecutionApproved).toLowerCase();
  if (approved !== "yes") {
    reasons.push(
      "F10C2_PHASE4B_SQL_EXECUTION_APPROVED must be exactly 'yes' before SET LOCAL",
    );
  }

  const ok = reasons.length === 0 && Boolean(identity.hostname);

  return {
    ...identity,
    ok,
    reasons,
    sqlExecutionApproved: approved === "yes",
    maySetSqlMarker: ok,
  };
}

export function assertPhase4bSqlSessionGuard(input = {}) {
  const result = evaluatePhase4bSqlSessionGuard(input);
  if (!result.maySetSqlMarker) {
    const error = new Error(
      `phase4b_sql_session_rejected: ${result.reasons.join("; ")}`,
    );
    error.code = "phase4b_sql_session_rejected";
    error.reasons = result.reasons;
    throw error;
  }
  return result;
}

/**
 * Returns the transaction-local SQL preamble only after both guards pass.
 * Callers must still refuse to open a database in Phase 4B-S.
 */
export function buildDisposableSqlSessionPreamble(input = {}) {
  assertPhase4bSqlSessionGuard(input);
  return {
    transactionStart: "BEGIN;",
    marker: DISPOSABLE_SQL_MARKER_STATEMENT,
    transactionEnd: "COMMIT;",
    note: "SET LOCAL is valid only inside this wrapper transaction after JS target guard + SQL approval.",
  };
}

export function evaluatePhase4bBootstrapCleanupGuard(input = {}) {
  const session = evaluatePhase4bSqlSessionGuard(input);
  const reasons = [...session.reasons];
  const cleanup = trimStr(input.bootstrapCleanupConfirmed).toLowerCase();
  if (cleanup !== "yes") {
    reasons.push(
      "F10C2_PHASE4B_BOOTSTRAP_CLEANUP_CONFIRMED must be exactly 'yes' before cleanup SET LOCAL",
    );
  }
  const ok = reasons.length === 0 && Boolean(session.hostname);
  return {
    ...session,
    ok,
    reasons,
    bootstrapCleanupConfirmed: cleanup === "yes",
    maySetCleanupMarker: ok,
  };
}

export default {
  DISPOSABLE_SQL_MARKER_GUC,
  DISPOSABLE_SQL_MARKER_VALUE,
  DISPOSABLE_SQL_MARKER_STATEMENT,
  DISPOSABLE_CLEANUP_MARKER_GUC,
  DISPOSABLE_CLEANUP_MARKER_STATEMENT,
  evaluatePhase4bSqlSessionGuard,
  assertPhase4bSqlSessionGuard,
  buildDisposableSqlSessionPreamble,
  evaluatePhase4bBootstrapCleanupGuard,
};
