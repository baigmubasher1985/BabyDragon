-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 1
-- NO DATABASE TARGET AUTHORIZED
-- PAIR: 101_field_test_runs
-- ROLE: VERIFICATION

SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'field_test_runs';

SELECT conname
FROM pg_constraint
WHERE conrelid = 'public.field_test_runs'::regclass
  AND contype = 'u'
  AND conname = 'field_test_runs_client_run_id_unique';
