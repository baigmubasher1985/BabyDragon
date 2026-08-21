/**
 * F10C2 Phase 3 — client-side QC validation (UX only).
 * Future server/RPC remains authoritative.
 */

import {
  FIELD_RESULT_QC_DECISIONS,
  QC_WAITING_DECISIONS,
} from '../models/fieldResultTypes.js';

/**
 * @param {object} input
 * @param {string} input.decision
 * @param {string} [input.notes]
 * @param {string} [input.redriveReason]
 * @param {string[]} [input.missingEvidence]
 * @param {boolean} [input.allowMissingArtifactOverride]
 * @param {object} result — field result detail (artifacts, processing_state)
 */
export function validateFieldResultQcDecision(input, result) {
  const errors = [];
  const decision = String(input?.decision || '').trim();
  const notes = String(input?.notes || '').trim();
  const redriveReason = String(input?.redriveReason || '').trim();
  const missingEvidence = Array.isArray(input?.missingEvidence)
    ? input.missingEvidence.map((x) => String(x).trim()).filter(Boolean)
    : [];
  const override = input?.allowMissingArtifactOverride === true;

  if (!decision) {
    errors.push({ code: 'decision_required', message: 'QC decision is required.' });
  } else if (!FIELD_RESULT_QC_DECISIONS.includes(decision)) {
    errors.push({ code: 'decision_invalid', message: 'QC decision is not authorized.' });
  }

  if (decision === 'QC Failed' && !notes) {
    errors.push({ code: 'notes_required', message: 'Reviewer notes are required for QC Failed.' });
  }

  if (decision === 'Needs Re-drive' && !redriveReason) {
    errors.push({
      code: 'redrive_reason_required',
      message: 'Re-drive reason is required for Needs Re-drive.',
    });
  }

  if (decision === 'Missing Evidence' && missingEvidence.length === 0) {
    errors.push({
      code: 'missing_evidence_required',
      message: 'Missing-evidence details are required for Missing Evidence.',
    });
  }

  const processing = String(result?.processing_state || '').toLowerCase();
  const processingIncomplete = processing === 'processing' || processing === 'pending' || processing === 'incomplete';
  if (processingIncomplete && decision && !QC_WAITING_DECISIONS.includes(decision)) {
    errors.push({
      code: 'processing_incomplete',
      message:
        'Final QC decision is not allowed while processing is incomplete (waiting decisions only).',
    });
  }

  const requiredMissing = (result?.artifacts || []).filter(
    (a) => a.required && (a.missing || a.available === false || a.upload_status === 'missing'),
  );
  if (decision === 'QC Passed' && requiredMissing.length > 0 && !override) {
    errors.push({
      code: 'required_artifacts_missing',
      message:
        'QC Passed is blocked while required artifacts are missing (override not authorized).',
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    normalized: {
      decision,
      notes,
      redriveReason,
      missingEvidence,
      allowMissingArtifactOverride: override,
    },
  };
}

/**
 * Build append-only history entry from prior latest + new decision.
 */
export function buildAppendQcHistoryEntry({
  previousHistory = [],
  decision,
  notes,
  missingEvidence = [],
  redriveReason = '',
  redriveTaskId = null,
  reviewer,
  decidedAt = null,
}) {
  const previous = previousHistory.length
    ? previousHistory[previousHistory.length - 1]
    : null;
  return {
    id: `qc-hist-${Date.now()}-${previousHistory.length + 1}`,
    decision,
    reviewer_id: reviewer?.id || null,
    reviewer_name: reviewer?.name || reviewer?.email || 'Reviewer',
    decided_at: decidedAt || new Date().toISOString(),
    notes: notes || '',
    missing_evidence: [...missingEvidence],
    redrive_reason: redriveReason || '',
    redrive_task_id: redriveTaskId || null,
    previous_decision: previous?.decision || null,
  };
}
