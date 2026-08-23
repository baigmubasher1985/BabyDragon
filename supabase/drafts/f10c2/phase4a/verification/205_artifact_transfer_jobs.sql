-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 4A
-- NO DATABASE TARGET AUTHORIZED
-- PAIR: 205_artifact_transfer_jobs
-- ROLE: VERIFICATION

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'artifact_transfer_jobs'
  AND column_name IN (
    'tenant_id',
    'artifact_id',
    'operation',
    'idempotency_key',
    'source',
    'destination',
    'state',
    'attempt_count',
    'upload_session_reference'
  );

SELECT conname
FROM pg_constraint
WHERE conrelid = 'public.artifact_transfer_jobs'::regclass
  AND conname IN (
    'artifact_transfer_jobs_idempotency_unique',
    'artifact_transfer_jobs_artifact_operation_unique',
    'artifact_transfer_jobs_artifact_same_tenant',
    'artifact_transfer_jobs_no_http_session',
    'artifact_transfer_jobs_destination_not_legacy',
    'artifact_transfer_jobs_idempotency_key_present'
  );
