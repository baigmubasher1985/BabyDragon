-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 4A
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: Idempotent transfer / resume jobs. upload_session_reference is not a signed URL store.
-- NOTE: Composite FK (artifact_id, tenant_id) → field_test_artifacts(id, tenant_id).
-- NOTE: Unique (tenant_id, idempotency_key) and (tenant_id, artifact_id, operation).
-- NOTE: Tenant DELETE is RESTRICT. Artifact row delete may CASCADE jobs only.
-- PAIR: 205_artifact_transfer_jobs
-- ROLE: FORWARD
-- CLASSIFICATION: (a) draftable / apply-candidate

BEGIN;

CREATE TABLE IF NOT EXISTS public.artifact_transfer_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  artifact_id uuid NOT NULL REFERENCES public.field_test_artifacts(id) ON DELETE CASCADE,
  operation text NOT NULL DEFAULT 'request_artifact_upload_plan'
    CHECK (operation IN ('request_artifact_upload_plan')),
  idempotency_key text NOT NULL,
  source text NOT NULL,
  destination text NOT NULL,
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN (
      'queued',
      'planning',
      'uploading',
      'confirming',
      'completed',
      'failed',
      'cancelled'
    )),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NULL,
  last_error_code text NULL,
  bytes_transferred bigint NOT NULL DEFAULT 0 CHECK (bytes_transferred >= 0),
  upload_session_reference text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  CONSTRAINT artifact_transfer_jobs_idempotency_key_present CHECK (
    length(btrim(idempotency_key)) > 0
  ),
  CONSTRAINT artifact_transfer_jobs_idempotency_unique UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT artifact_transfer_jobs_artifact_operation_unique UNIQUE (tenant_id, artifact_id, operation),
  CONSTRAINT artifact_transfer_jobs_artifact_same_tenant
    FOREIGN KEY (artifact_id, tenant_id)
    REFERENCES public.field_test_artifacts (id, tenant_id),
  CONSTRAINT artifact_transfer_jobs_no_http_session CHECK (
    upload_session_reference IS NULL
    OR upload_session_reference !~* '^https?://'
  ),
  CONSTRAINT artifact_transfer_jobs_destination_not_legacy CHECK (
    destination IS DISTINCT FROM 'task-photos'
    AND destination IS DISTINCT FROM 'operational-evidence'
    AND destination !~* '^https?://'
  )
);

CREATE INDEX IF NOT EXISTS artifact_transfer_jobs_artifact_id_idx
  ON public.artifact_transfer_jobs (artifact_id);
CREATE INDEX IF NOT EXISTS artifact_transfer_jobs_state_idx
  ON public.artifact_transfer_jobs (tenant_id, state);

COMMENT ON TABLE public.artifact_transfer_jobs IS
  'F10C2 Phase 4A-R1: tenant-scoped transfer jobs. Idempotency is bound to tenant+artifact+operation.';
COMMENT ON CONSTRAINT artifact_transfer_jobs_artifact_same_tenant ON public.artifact_transfer_jobs IS
  'Job tenant_id must equal the artifact tenant_id. Jobs are not created for legacy NULL-tenant artifacts.';

COMMIT;
