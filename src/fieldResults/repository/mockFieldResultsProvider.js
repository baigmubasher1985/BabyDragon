/**
 * F10C2 Phase 3 — deterministic mock Field Results provider.
 * No Supabase, no fetch, no signed URLs, no privileged server credentials.
 */

import { cloneFixtures } from '../fixtures/fieldResultsFixtures.js';
import {
  buildAppendQcHistoryEntry,
  validateFieldResultQcDecision,
} from '../qc/qcValidation.js';
import {
  buildDetailViewModel,
  buildListViewModel,
  collectFilterOptions,
} from '../selectors/fieldResultSelectors.js';
import { canPerformFieldResultQc } from '../models/fieldResultTypes.js';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createMockFieldResultsProvider(options = {}) {
  let fixtures = cloneFixtures();
  let sim = {
    latencyMs: options.latencyMs ?? 0,
    failNextList: false,
    failNextDetail: false,
    failNextSave: false,
    emptyList: false,
    ...options.simulation,
  };

  const saveIdempotency = new Map();

  async function maybeLatency() {
    if (sim.latencyMs > 0) await delay(sim.latencyMs);
  }

  function findRun(resultId) {
    return fixtures.runs.find((r) => r.id === resultId) || null;
  }

  return {
    kind: 'mock',
    label: 'F10C2 Mock Field Results Provider',

    setSimulation(next) {
      sim = { ...sim, ...next };
    },

    reset() {
      fixtures = cloneFixtures();
      saveIdempotency.clear();
      sim = {
        latencyMs: options.latencyMs ?? 0,
        failNextList: false,
        failNextDetail: false,
        failNextSave: false,
        emptyList: false,
      };
    },

    async getFilterOptions() {
      await maybeLatency();
      return {
        ok: true,
        status: 'success',
        options: collectFilterOptions(fixtures.runs),
      };
    },

    async listFieldResults(filters = {}, pagination = {}) {
      await maybeLatency();
      if (sim.failNextList) {
        sim.failNextList = false;
        return {
          ok: false,
          status: 'error',
          error: { code: 'mock_list_error', message: 'Mock list failure (retry allowed).' },
          retryable: true,
        };
      }
      if (sim.emptyList) {
        return {
          ok: true,
          status: 'empty',
          ...buildListViewModel([], filters, pagination),
          rows: [],
          total: 0,
        };
      }
      const vm = buildListViewModel(fixtures.runs, filters, pagination);
      return {
        ok: true,
        status: vm.total === 0 ? 'empty' : 'success',
        ...vm,
      };
    },

    async getFieldResult(resultId) {
      await maybeLatency();
      if (sim.failNextDetail) {
        sim.failNextDetail = false;
        return {
          ok: false,
          status: 'error',
          error: { code: 'mock_detail_error', message: 'Mock detail failure (retry allowed).' },
          retryable: true,
        };
      }
      const run = findRun(resultId);
      if (!run) {
        return {
          ok: false,
          status: 'error',
          error: { code: 'not_found', message: 'Field result not found.' },
          retryable: false,
        };
      }
      return {
        ok: true,
        status: 'success',
        result: buildDetailViewModel(run),
        _raw: run,
      };
    },

    async listResultArtifacts(resultId) {
      const detail = await this.getFieldResult(resultId);
      if (!detail.ok) return detail;
      return {
        ok: true,
        status: 'success',
        artifacts: detail.result.artifacts || [],
      };
    },

    async getResultQcHistory(resultId) {
      const run = findRun(resultId);
      if (!run) {
        return {
          ok: false,
          status: 'error',
          error: { code: 'not_found', message: 'Field result not found.' },
        };
      }
      return {
        ok: true,
        status: 'success',
        history: [...(run.qc_history || [])],
      };
    },

    async saveResultQcDecision(resultId, decisionInput, actor = {}) {
      await maybeLatency();
      if (sim.failNextSave) {
        sim.failNextSave = false;
        return {
          ok: false,
          status: 'error',
          error: { code: 'mock_save_error', message: 'Mock save failure.' },
          retryable: true,
        };
      }

      if (!canPerformFieldResultQc(actor.role)) {
        return {
          ok: false,
          status: 'error',
          error: {
            code: 'forbidden_role',
            message: 'FE users cannot submit Field Result QC (UX gate; RLS mandatory live).',
          },
          retryable: false,
        };
      }

      const run = findRun(resultId);
      if (!run) {
        return {
          ok: false,
          status: 'error',
          error: { code: 'not_found', message: 'Field result not found.' },
        };
      }

      const validation = validateFieldResultQcDecision(decisionInput, run);
      if (!validation.ok) {
        return {
          ok: false,
          status: 'error',
          error: { code: 'validation_failed', message: validation.errors[0]?.message, details: validation.errors },
        };
      }

      const n = validation.normalized;
      const idemKey = [
        resultId,
        n.decision,
        n.notes,
        n.redriveReason,
        n.missingEvidence.join(','),
        actor.id || '',
      ].join('|');

      const prior = saveIdempotency.get(idemKey);
      if (prior) {
        return {
          ok: true,
          status: 'success',
          idempotent: true,
          result: buildDetailViewModel(run),
          historyEntry: prior.historyEntry,
        };
      }

      const historyEntry = buildAppendQcHistoryEntry({
        previousHistory: run.qc_history || [],
        decision: n.decision,
        notes: n.notes,
        missingEvidence: n.missingEvidence,
        redriveReason: n.redriveReason,
        redriveTaskId: run.redrive_task_id,
        reviewer: actor,
      });

      // Append — never mutate prior history entries
      run.qc_history = [...(run.qc_history || []), historyEntry];
      run.latest_qc_status = n.decision;
      if (n.decision === 'Needs Re-drive') {
        run.redrive_needed = true;
      }

      saveIdempotency.set(idemKey, { historyEntry });

      return {
        ok: true,
        status: 'success',
        idempotent: false,
        result: buildDetailViewModel(run),
        historyEntry,
      };
    },

    async createOrLinkRedrive(resultId, reason, actor = {}) {
      if (!canPerformFieldResultQc(actor.role)) {
        return {
          ok: false,
          status: 'error',
          error: { code: 'forbidden_role', message: 'FE cannot create re-drive linkage.' },
        };
      }
      const run = findRun(resultId);
      if (!run) {
        return {
          ok: false,
          status: 'error',
          error: { code: 'not_found', message: 'Field result not found.' },
        };
      }
      const trimmed = String(reason || '').trim();
      if (!trimmed) {
        return {
          ok: false,
          status: 'error',
          error: { code: 'redrive_reason_required', message: 'Re-drive reason is required.' },
        };
      }

      // Preserve original task relationship; link a synthetic future re-drive task
      const redriveTaskId =
        run.redrive_task_id || `task-redrive-mock-${run.id.replace(/^run-/, '')}`;
      run.redrive_needed = true;
      run.redrive_task_id = redriveTaskId;
      run.latest_qc_status = 'Needs Re-drive';

      const historyEntry = buildAppendQcHistoryEntry({
        previousHistory: run.qc_history || [],
        decision: 'Needs Re-drive',
        notes: 'Re-drive linked via Field Results provider (mock).',
        redriveReason: trimmed,
        redriveTaskId,
        reviewer: actor,
      });
      run.qc_history = [...(run.qc_history || []), historyEntry];

      return {
        ok: true,
        status: 'success',
        original_task_id: run.task_id,
        redrive_task_id: redriveTaskId,
        result: buildDetailViewModel(run),
        historyEntry,
        mock: true,
      };
    },

    /**
     * Artifact access via provider only.
     * Returns mock blob descriptor — never public/signed Storage URLs.
     */
    async requestArtifactAccess(resultId, artifactId, actor = {}) {
      void actor;
      const run = findRun(resultId);
      if (!run) {
        return {
          ok: false,
          status: 'error',
          error: { code: 'not_found', message: 'Field result not found.' },
        };
      }
      const art = (run.artifacts || []).find((a) => a.artifact_id === artifactId);
      if (!art) {
        return {
          ok: false,
          status: 'error',
          error: { code: 'artifact_not_found', message: 'Artifact not found.' },
        };
      }
      if (art.missing || art.available === false || art.upload_status === 'missing') {
        return {
          ok: false,
          status: 'error',
          error: {
            code: 'artifact_unavailable',
            message: 'Missing artifact is not downloadable.',
          },
          downloadable: false,
        };
      }
      if (art.upload_status !== 'uploaded') {
        return {
          ok: false,
          status: 'error',
          error: {
            code: 'artifact_not_ready',
            message: `Artifact upload status is "${art.upload_status}" — not downloadable.`,
          },
          downloadable: false,
        };
      }

      return {
        ok: true,
        status: 'success',
        mock: true,
        downloadable: true,
        access: {
          mode: 'mock_local',
          filename: art.filename,
          mime_type: art.mime_type,
          size_bytes: art.size_bytes,
          // Explicitly no URL fields
          public_url: null,
          signed_url: null,
          notice: 'MOCK DEVELOPMENT ACCESS — not a real Storage signed URL.',
        },
      };
    },
  };
}
