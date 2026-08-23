/**
 * F10C2 Phase 4 — live Field Results provider (authenticated anon key only).
 * Components must keep using the repository boundary. Private artifacts use signed URLs only.
 */

import {
  F10C2_SIGNED_URL_TTL_SECONDS,
} from "../../lib/f10c2FeatureFlags.js";
import {
  buildAppendQcHistoryEntry,
  validateFieldResultQcDecision,
} from "../qc/qcValidation.js";
import {
  buildDetailViewModel,
  buildListViewModel,
  collectFilterOptions,
} from "../selectors/fieldResultSelectors.js";
import { canPerformFieldResultQc } from "../models/fieldResultTypes.js";
import { mapFieldTestRunRow } from "./mapFieldTestRunRow.js";
import { createSupabaseArtifactStorageProvider } from "../../storage/providers/supabaseArtifactStorageProvider.js";

function fail(code, message, extra = {}) {
  return {
    ok: false,
    status: "error",
    retryable: extra.retryable === true,
    error: { code, message },
    ...extra,
  };
}

function classifyQueryError(error) {
  const message = String(error?.message || error || "query_failed");
  const lower = message.toLowerCase();
  if (lower.includes("jwt") || lower.includes("not_authenticated") || lower.includes("session")) {
    return { code: "auth_expired_retryable", retryable: true, message };
  }
  if (lower.includes("permission") || lower.includes("rls") || lower.includes("forbidden")) {
    return { code: "forbidden", retryable: false, message };
  }
  return { code: "network", retryable: true, message };
}

export function createSupabaseFieldResultsProvider(options = {}) {
  const supabase = options.supabase;
  if (!supabase) {
    throw new Error("supabase_client_required");
  }

  const signedTtl = Number(options.signedUrlTtlSeconds) || F10C2_SIGNED_URL_TTL_SECONDS;
  const storageProvider = options.storageProvider
    || createSupabaseArtifactStorageProvider({
      supabase,
      signedUrlTtlSeconds: signedTtl,
    });
  const redriveIdempotency = new Map();

  async function hydrateRuns(runRows) {
    const runs = runRows || [];
    if (runs.length === 0) return [];

    const runIds = runs.map((r) => r.id);
    const taskIds = [...new Set(runs.map((r) => r.task_id).filter(Boolean))];
    const projectIds = [...new Set(runs.map((r) => r.project_id).filter(Boolean))];
    const gridIds = [...new Set(runs.map((r) => r.grid_id).filter(Boolean))];
    const feIds = [...new Set(runs.map((r) => r.submitted_by).filter(Boolean))];

    const [arts, qcs, tasks, projects, grids, profiles] = await Promise.all([
      supabase.from("field_test_artifacts").select("*").in("run_id", runIds),
      supabase.from("field_test_qc_reviews").select("*").in("field_test_run_id", runIds),
      taskIds.length
        ? supabase.from("tasks").select("id,title,name,market,project_id,assigned_to,status,grid_id").in("id", taskIds)
        : Promise.resolve({ data: [] }),
      projectIds.length
        ? supabase.from("projects").select("id,name,market").in("id", projectIds)
        : Promise.resolve({ data: [] }),
      gridIds.length
        ? supabase.from("grids").select("id,name,market").in("id", gridIds)
        : Promise.resolve({ data: [] }),
      feIds.length
        ? supabase.from("profiles").select("id,email,full_name,role").in("id", feIds)
        : Promise.resolve({ data: [] }),
    ]);

    const artByRun = new Map();
    for (const a of arts.data || []) {
      const list = artByRun.get(a.run_id) || [];
      list.push(a);
      artByRun.set(a.run_id, list);
    }
    const qcByRun = new Map((qcs.data || []).map((q) => [q.field_test_run_id, q]));
    const taskById = new Map((tasks.data || []).map((t) => [t.id, t]));
    const projectById = new Map((projects.data || []).map((p) => [p.id, p]));
    const gridById = new Map((grids.data || []).map((g) => [g.id, g]));
    const profileById = new Map((profiles.data || []).map((p) => [p.id, p]));

    return runs.map((run) =>
      mapFieldTestRunRow({
        run,
        artifacts: artByRun.get(run.id) || [],
        qcReview: qcByRun.get(run.id) || null,
        task: taskById.get(run.task_id),
        project: projectById.get(run.project_id),
        grid: gridById.get(run.grid_id),
        profile: profileById.get(run.submitted_by),
      }),
    );
  }

  async function loadMapped(resultId) {
    const { data, error } = await supabase
      .from("field_test_runs")
      .select("*")
      .eq("id", resultId)
      .maybeSingle();
    if (error) {
      const c = classifyQueryError(error);
      return fail(c.code, c.message, { retryable: c.retryable });
    }
    if (!data) return fail("not_found", "Field result not found.");
    const mapped = await hydrateRuns([data]);
    return { ok: true, run: mapped[0] };
  }

  return {
    kind: "supabase",
    label: "F10C2 Supabase Field Results Provider",

    async getFilterOptions() {
      const { data, error } = await supabase
        .from("field_test_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) {
        const c = classifyQueryError(error);
        return fail(c.code, c.message, { retryable: c.retryable });
      }
      const mapped = await hydrateRuns(data || []);
      return { ok: true, status: "success", options: collectFilterOptions(mapped) };
    },

    async listFieldResults(filters = {}, pagination = {}) {
      const { data, error } = await supabase
        .from("field_test_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) {
        const c = classifyQueryError(error);
        return fail(c.code, c.message, { retryable: c.retryable });
      }
      const mapped = await hydrateRuns(data || []);
      const vm = buildListViewModel(mapped, filters, pagination);
      return {
        ok: true,
        status: vm.total === 0 ? "empty" : "success",
        ...vm,
      };
    },

    async getFieldResult(resultId) {
      const loaded = await loadMapped(resultId);
      if (!loaded.ok) return loaded;
      return {
        ok: true,
        status: "success",
        result: buildDetailViewModel(loaded.run),
        _raw: loaded.run,
      };
    },

    async listResultArtifacts(resultId) {
      const detail = await this.getFieldResult(resultId);
      if (!detail.ok) return detail;
      return { ok: true, status: "success", artifacts: detail.result.artifacts || [] };
    },

    async getResultQcHistory(resultId) {
      const loaded = await loadMapped(resultId);
      if (!loaded.ok) return loaded;
      return { ok: true, status: "success", history: loaded.run.qc_history || [] };
    },

    async saveResultQcDecision(resultId, decisionInput, actor = {}) {
      if (!canPerformFieldResultQc(actor.role)) {
        return fail("forbidden_role", "FE users cannot submit Field Result QC.");
      }
      const loaded = await loadMapped(resultId);
      if (!loaded.ok) return loaded;
      const validation = validateFieldResultQcDecision(decisionInput, loaded.run);
      if (!validation.ok) {
        return fail("validation_failed", validation.errors[0]?.message, { details: validation.errors });
      }
      const n = validation.normalized;
      const redriveNeeded = n.decision === "Needs Re-drive";
      if (redriveNeeded && loaded.run.redrive_task_id) {
        // Duplicate re-drive is blocked; keep original linkage.
      }
      const { data, error } = await supabase.rpc("submit_field_test_qc_review", {
        p_field_test_run_id: resultId,
        p_qc_decision: n.decision,
        p_qc_notes: n.notes || null,
        p_missing_evidence: n.missingEvidence.length ? n.missingEvidence : null,
        p_redrive_needed: redriveNeeded,
        p_redrive_reason: redriveNeeded ? n.redriveReason : null,
        p_redrive_task_id: redriveNeeded ? loaded.run.redrive_task_id || null : null,
      });
      if (error) {
        const c = classifyQueryError(error);
        return fail(c.code, c.message, { retryable: c.retryable });
      }
      const after = await loadMapped(resultId);
      if (!after.ok) return after;
      const historyEntry = buildAppendQcHistoryEntry({
        previousHistory: loaded.run.qc_history || [],
        decision: n.decision,
        notes: n.notes,
        missingEvidence: n.missingEvidence,
        redriveReason: n.redriveReason,
        redriveTaskId: after.run.redrive_task_id,
        reviewer: actor,
        decidedAt: data?.reviewed_at || new Date().toISOString(),
      });
      return {
        ok: true,
        status: "success",
        idempotent: false,
        result: buildDetailViewModel(after.run),
        historyEntry,
      };
    },

    async createOrLinkRedrive(resultId, reason, actor = {}) {
      if (!canPerformFieldResultQc(actor.role)) {
        return fail("forbidden_role", "FE cannot create re-drive linkage.");
      }
      const trimmed = String(reason || "").trim();
      if (!trimmed) {
        return fail("redrive_reason_required", "Re-drive reason is required.");
      }
      const loaded = await loadMapped(resultId);
      if (!loaded.ok) return loaded;

      const cacheKey = `${resultId}|${actor.id || ""}`;
      if (loaded.run.redrive_task_id) {
        return {
          ok: true,
          status: "success",
          idempotent: true,
          original_task_id: loaded.run.task_id,
          redrive_task_id: loaded.run.redrive_task_id,
          result: buildDetailViewModel(loaded.run),
        };
      }
      if (redriveIdempotency.has(cacheKey)) {
        return redriveIdempotency.get(cacheKey);
      }

      const original = loaded.run;
      const { data: inserted, error: insertError } = await supabase
        .from("tasks")
        .insert({
          title: `Re-drive: ${original.task_name || original.task_id}`,
          project_id: original.project_id,
          market: original.market || null,
          notes: `Linked re-drive for field_test_run ${original.id}. Reason: ${trimmed}`,
          assigned_to: original.field_engineer?.id || null,
          status: "assigned",
          grid_id: original.grid_id || null,
          test_type: original.scenario_type || "re-drive",
          target_type: "re-drive",
          target_name: original.report_name || original.id,
          priority: "high",
        })
        .select("id")
        .single();

      if (insertError) {
        const c = classifyQueryError(insertError);
        return fail(c.code, c.message, { retryable: false });
      }

      const { error } = await supabase.rpc("submit_field_test_qc_review", {
        p_field_test_run_id: resultId,
        p_qc_decision: "Needs Re-drive",
        p_qc_notes: `Re-drive linked to task ${inserted.id}`,
        p_missing_evidence: null,
        p_redrive_needed: true,
        p_redrive_reason: trimmed,
        p_redrive_task_id: inserted.id,
      });
      if (error) {
        const c = classifyQueryError(error);
        return fail(c.code, c.message, { retryable: c.retryable });
      }

      const after = await loadMapped(resultId);
      if (!after.ok) return after;
      const result = {
        ok: true,
        status: "success",
        idempotent: false,
        original_task_id: original.task_id,
        redrive_task_id: inserted.id,
        result: buildDetailViewModel(after.run),
      };
      redriveIdempotency.set(cacheKey, result);
      return result;
    },

    async requestArtifactAccess(resultId, artifactId, actor = {}) {
      void actor;
      const loaded = await loadMapped(resultId);
      if (!loaded.ok) return loaded;
      const art = (loaded.run.artifacts || []).find((a) => a.artifact_id === artifactId);
      if (!art) return fail("artifact_not_found", "Artifact not found.");
      if (art.missing || art.available === false || art.upload_status !== "uploaded") {
        return fail("artifact_unavailable", "Artifact is not downloadable.", { downloadable: false });
      }
      if (!art.object_key) {
        return fail("artifact_unavailable", "Durable artifact ref is incomplete.");
      }
      if (art.bucket === "task-photos" || art.bucket === "operational-evidence") {
        return fail("artifact_unavailable", "Legacy operational buckets are not the field-result store.");
      }
      if (/^https?:\/\//i.test(art.object_key)) {
        return fail("invalid_manifest", "Signed or public URL is not a durable artifact ref.");
      }

      try {
        const access = await storageProvider.createAuthorizedReadAccess({
          objectKey: art.object_key,
          filename: art.filename,
          mimeType: art.mime_type,
          sizeBytes: art.size_bytes,
        });
        return {
          ok: true,
          status: "success",
          mock: storageProvider.kind === "mock",
          downloadable: true,
          access: {
            ...access,
            public_url: null,
            expires_in_seconds: access.expires_in_seconds || signedTtl,
          },
        };
      } catch (error) {
        const c = classifyQueryError(error);
        return fail(c.code, c.message, { retryable: c.retryable });
      }
    },
  };
}

export default { createSupabaseFieldResultsProvider };
