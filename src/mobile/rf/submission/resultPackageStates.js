/**
 * F10C2 Phase 2 — Package + artifact state machine constants.
 * Persist transitions; never mark uploaded before finalize.
 */

export const PACKAGE_STATES = Object.freeze({
  DRAFT: "draft",
  QUEUED: "queued",
  REGISTERING: "registering",
  REGISTERED: "registered",
  UPLOADING: "uploading",
  PARTIALLY_UPLOADED: "partially_uploaded",
  FINALIZING: "finalizing",
  UPLOADED: "uploaded",
  RETRY_WAIT: "retry_wait",
  BLOCKED_AUTH: "blocked_auth",
  FAILED_PERMANENT: "failed_permanent",
  CANCELLED_LOCAL_ONLY: "cancelled_local_only",
});

export const ARTIFACT_STATES = Object.freeze({
  PENDING: "pending",
  UPLOADING: "uploading",
  UPLOADED: "uploaded",
  RETRY_WAIT: "retry_wait",
  FAILED_PERMANENT: "failed_permanent",
  MISSING_LOCAL: "missing_local",
});

/** Terminal package states that must not auto-resubmit. */
export const PACKAGE_TERMINAL_SUCCESS = Object.freeze([PACKAGE_STATES.UPLOADED]);

export const PACKAGE_TERMINAL_STOP = Object.freeze([
  PACKAGE_STATES.UPLOADED,
  PACKAGE_STATES.FAILED_PERMANENT,
  PACKAGE_STATES.CANCELLED_LOCAL_ONLY,
]);

export function isPackageTerminal(state) {
  return PACKAGE_TERMINAL_STOP.includes(state);
}

export function isPackageSuccess(state) {
  return state === PACKAGE_STATES.UPLOADED;
}

export function canResumePackage(state) {
  return [
    PACKAGE_STATES.QUEUED,
    PACKAGE_STATES.REGISTERING,
    PACKAGE_STATES.REGISTERED,
    PACKAGE_STATES.UPLOADING,
    PACKAGE_STATES.PARTIALLY_UPLOADED,
    PACKAGE_STATES.FINALIZING,
    PACKAGE_STATES.RETRY_WAIT,
    PACKAGE_STATES.BLOCKED_AUTH,
  ].includes(state);
}

export function canManualRetry(state) {
  return [
    PACKAGE_STATES.RETRY_WAIT,
    PACKAGE_STATES.BLOCKED_AUTH,
    PACKAGE_STATES.FAILED_PERMANENT,
    PACKAGE_STATES.PARTIALLY_UPLOADED,
  ].includes(state);
}

export function nextPackageStateAfterArtifactProgress({
  confirmedCount,
  totalCount,
  anyMissing,
}) {
  if (anyMissing) return PACKAGE_STATES.PARTIALLY_UPLOADED;
  if (totalCount <= 0) return PACKAGE_STATES.REGISTERED;
  if (confirmedCount <= 0) return PACKAGE_STATES.UPLOADING;
  if (confirmedCount < totalCount) return PACKAGE_STATES.PARTIALLY_UPLOADED;
  return PACKAGE_STATES.FINALIZING;
}

export default {
  PACKAGE_STATES,
  ARTIFACT_STATES,
  PACKAGE_TERMINAL_SUCCESS,
  PACKAGE_TERMINAL_STOP,
  isPackageTerminal,
  isPackageSuccess,
  canResumePackage,
  canManualRetry,
  nextPackageStateAfterArtifactProgress,
};
