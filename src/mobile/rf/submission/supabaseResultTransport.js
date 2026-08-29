/**
 * F10C2 Phase 4 — real Supabase result transport behind the Phase 2 adapter.
 * Requires an authenticated session. No service-role. Private bucket uploads only.
 * Mock transport remains the default; this module is selected only by explicit flag.
 */

import { RESULT_ARTIFACTS_BUCKET, coerceDeviceTimestamp } from "../reports/serverSubmissionManifest.js";
import { createSupabaseArtifactStorageProvider } from "../../../storage/providers/supabaseArtifactStorageProvider.js";

export const SUPABASE_TRANSPORT_KIND = "supabase_f10c2_phase4";

function err(code, message, extra = {}) {
  const error = new Error(message || code);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function rpcError(error, fallbackCode = "network") {
  const message = String(error?.message || error?.details || error || fallbackCode);
  const lower = message.toLowerCase();
  if (lower.includes("not_authenticated") || lower.includes("jwt") || lower.includes("session")) {
    return err("auth_expired_retryable", message);
  }
  if (lower.includes("forbidden_inactive_or_not_fe") || lower.includes("forbidden_not_qc")) {
    return err("auth_forbidden", message);
  }
  if (lower.includes("not_assigned") || lower.includes("foreign_task")) {
    return err("not_assigned", message);
  }
  if (lower.includes("not_run_owner") || lower.includes("owned_by_other") || lower.includes("owner")) {
    return err("owner_mismatch", message);
  }
  if (lower.includes("checksum")) return err("checksum_mismatch", message);
  if (lower.includes("mime")) return err("invalid_mime", message);
  if (lower.includes("size_out_of_range") || lower.includes("oversized")) {
    return err("oversized", message);
  }
  if (lower.includes("invalid_manifest") || lower.includes("scenario_type_required")) {
    return err("invalid_manifest", message);
  }
  if (lower.includes("failed to fetch") || lower.includes("network") || lower.includes("timeout")) {
    return err("network", message);
  }
  return err(fallbackCode, message);
}

function isAlreadyExists(error) {
  const text = `${error?.message || ""} ${error?.error || ""} ${error?.statusCode || ""}`.toLowerCase();
  return (
    text.includes("already exists")
    || text.includes("duplicate")
    || text.includes("resource already exists")
    || String(error?.statusCode) === "409"
    || error?.statusCode === 409
  );
}

function mapRun(row) {
  if (!row) return null;
  const status = row.run_status || row.status || null;
  const finalized = status === "ready" || status === "uploaded" || row.finalized === true;
  return {
    ...row,
    status: finalized ? "uploaded" : status,
    finalized,
  };
}

/**
 * @param {object} options
 * @param {object} options.supabase authenticated browser/client supabase
 * @param {(artifact: object) => Promise<Blob|ArrayBuffer|Uint8Array|string|null>} [options.readArtifactBody]
 */
export function createSupabaseResultTransport(options = {}) {
  const supabase = options.supabase;
  if (!supabase) {
    throw err("invalid_manifest", "supabase_client_required");
  }

  const readArtifactBody =
    typeof options.readArtifactBody === "function" ? options.readArtifactBody : async () => null;
  const storageProvider = options.storageProvider
    || createSupabaseArtifactStorageProvider({ supabase });

  const callLog = [];

  async function requireSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw rpcError(error, "auth_expired_retryable");
    if (!data?.session?.user?.id) {
      throw err("auth_expired_retryable", "Authenticated session required");
    }
    return data.session;
  }

  async function registerResult(manifest) {
    await requireSession();
    if (!manifest?.client_run_id) throw err("invalid_manifest", "client_run_id_required");
    const { data, error } = await supabase.rpc("submit_field_test_run", {
      p_client_run_id: manifest.client_run_id,
      p_task_id: manifest.task_id,
      p_project_id: manifest.project_id,
      p_grid_id: manifest.grid_id || null,
      p_scenario_type: manifest.scenario_type,
      p_scenario_version: manifest.scenario_version || null,
      p_run_status: "submitted",
      p_started_at_device: coerceDeviceTimestamp(manifest.started_at_device),
      p_ended_at_device: coerceDeviceTimestamp(manifest.ended_at_device),
      p_device_model: manifest.device?.model || null,
      p_app_version: manifest.device?.app_version || null,
      p_build_number: manifest.device?.build_number || null,
      p_report_name: manifest.report_name || null,
      p_rf_summary: manifest.rf_summary || {},
      p_data_summary: manifest.data_summary || {},
      p_gps_summary: manifest.gps_summary || {},
      p_events_summary: manifest.events_summary || {},
    });
    if (error) throw rpcError(error, "invalid_manifest");
    const row = Array.isArray(data) ? data[0] : data;
    callLog.push({ op: "registerResult", client_run_id: manifest.client_run_id, id: row?.id });
    return {
      ok: true,
      reason: "created_or_idempotent",
      field_test_run_id: row?.id,
      run: mapRun(row),
    };
  }

  async function requestArtifactUpload({ fieldTestRunId, artifact } = {}) {
    await requireSession();
    if (!fieldTestRunId || !artifact?.artifact_id) {
      throw err("invalid_manifest", "artifact_register_args_required");
    }
    const { data, error } = await supabase.rpc("register_field_test_artifact", {
      p_run_id: fieldTestRunId,
      p_artifact_id: artifact.artifact_id,
      p_artifact_type: artifact.artifact_type,
      p_mime_type: artifact.mime_type,
      p_size_bytes: artifact.size_bytes ?? 0,
      p_checksum: artifact.checksum,
      p_safe_extension: artifact.safe_extension,
      p_original_file_name: artifact.original_file_name || null,
    });
    if (error) throw rpcError(error, "invalid_manifest");
    const row = Array.isArray(data) ? data[0] : data;
    const uploadPlan = await storageProvider.createUploadPlan({
      objectKey: row?.object_key,
      mimeType: artifact.mime_type,
      sizeBytes: artifact.size_bytes,
      checksum: artifact.checksum,
      artifactId: artifact.artifact_id,
    });
    return {
      ok: true,
      reason: "created_or_idempotent",
      upload_ticket: `storage:${row?.bucket || RESULT_ARTIFACTS_BUCKET}:${row?.object_key}`,
      object_key: row?.object_key,
      bucket: row?.bucket || RESULT_ARTIFACTS_BUCKET,
      upload_plan: uploadPlan,
      artifact: row,
    };
  }

  async function uploadArtifact({
    artifactId,
    uploadTicket,
    artifact = null,
    body = null,
    objectKey = null,
    mimeType = null,
    resumeFromByte = 0,
  } = {}) {
    await requireSession();
    void resumeFromByte;
    const key = objectKey
      || artifact?.object_key
      || (typeof uploadTicket === "string" && uploadTicket.startsWith("storage:")
        ? uploadTicket.split(":").slice(2).join(":")
        : null);
    if (!key) throw err("invalid_manifest", "object_key_required");
    if (/^https?:\/\//i.test(key)) {
      throw err("invalid_manifest", "signed_or_public_url_not_durable");
    }

    let payload = body;
    if (payload == null && artifact) {
      payload = await readArtifactBody(artifact);
    }
    if (payload == null) {
      throw err("missing_required_local_artifact", "Local artifact bytes are not available for upload");
    }

    const contentType = mimeType || artifact?.mime_type || "application/octet-stream";
    const { error } = await supabase.storage
      .from(RESULT_ARTIFACTS_BUCKET)
      .upload(key, payload, {
        contentType,
        upsert: false,
      });

    if (error && isAlreadyExists(error)) {
      callLog.push({ op: "uploadArtifact", artifactId, reason: "idempotent_exists" });
      return {
        ok: true,
        reason: "idempotent_success",
        artifact_id: artifactId,
        object_key: key,
      };
    }
    if (error) throw rpcError(error, "network");

    const uploadPlan = await storageProvider.createUploadPlan({
      objectKey: key,
      mimeType: contentType,
      artifactId,
    });
    return {
      ok: true,
      reason: "uploaded",
      artifact_id: artifactId,
      object_key: key,
      upload_plan: uploadPlan,
    };
  }

  async function confirmArtifact({ artifactId, checksum } = {}) {
    await requireSession();
    const { data, error } = await supabase.rpc("complete_field_test_artifact_upload", {
      p_artifact_id: artifactId,
      p_checksum: checksum,
    });
    if (error) throw rpcError(error, "checksum_mismatch");
    const row = Array.isArray(data) ? data[0] : data;
    return { ok: true, reason: row?.upload_status === "complete" ? "completed" : "ok", artifact: row };
  }

  async function finalizeResult({ fieldTestRunId, payload = null } = {}) {
    await requireSession();
    if (!fieldTestRunId) throw err("invalid_manifest", "run_not_found");
    const { data, error } = await supabase.rpc("finalize_field_test_run", {
      p_run_id: fieldTestRunId,
    });
    if (error) throw rpcError(error, "finalize_temporary");
    const row = Array.isArray(data) ? data[0] : data;

    if (payload) {
      const { extractCanonicalMeasurements } = await import("../../../acceptance/canonicalIngest.js");
      const extracted = extractCanonicalMeasurements(payload);
      const ingestPayload = {
        package_identity: extracted.identity.package_identity,
        client_package_identity: {
          client_run_id: extracted.identity.client_run_id,
          package_identity: extracted.identity.package_identity,
        },
        iterations: extracted.iterations,
        call_events: extracted.call_events,
        requested_iterations: payload.manifest?.data_summary?.scenarios?.[0]?.attempt_counts?.planned ?? extracted.iterations.length,
        attempted_iterations: extracted.iterations.length,
        completed_iterations: extracted.iterations.filter((i) => i.status === "completed").length,
        failed_iterations: extracted.iterations.filter((i) => i.status === "failed").length,
        upload_state: "uploaded",
        synthetic_call_events: Boolean(payload.synthetic_call_events),
      };
      const ingest = await supabase.rpc("ingest_field_test_canonical_result", {
        p_run_id: fieldTestRunId,
        p_idempotency_key: extracted.identity.idempotency_key,
        p_payload: ingestPayload,
      });
      if (ingest.error) throw rpcError(ingest.error, "invalid_manifest");
    }

    return { ok: true, reason: "finalized", run: mapRun(row) };
  }

  async function fetchSubmissionStatus({ clientRunId } = {}) {
    await requireSession();
    const { data: run, error } = await supabase
      .from("field_test_runs")
      .select("*")
      .eq("client_run_id", clientRunId)
      .maybeSingle();
    if (error) throw rpcError(error, "network");
    if (!run) return { ok: true, reason: "not_found", run: null, artifacts: [] };

    const { data: artifacts, error: artError } = await supabase
      .from("field_test_artifacts")
      .select("*")
      .eq("run_id", run.id);
    if (artError) throw rpcError(artError, "network");

    return {
      ok: true,
      reason: "ok",
      run: mapRun(run),
      artifacts: (artifacts || []).map((a) => ({
        ...a,
        id: a.id,
        field_test_run_id: a.run_id,
      })),
    };
  }

  return {
    kind: SUPABASE_TRANSPORT_KIND,
    registerResult,
    requestArtifactUpload,
    uploadArtifact,
    confirmArtifact,
    finalizeResult,
    fetchSubmissionStatus,
    __callLog: callLog,
  };
}

export default {
  SUPABASE_TRANSPORT_KIND,
  createSupabaseResultTransport,
};
