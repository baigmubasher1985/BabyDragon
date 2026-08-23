-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 4A
-- NO DATABASE TARGET AUTHORIZED
-- PAIR: 202_storage_connections
-- ROLE: ROLLBACK
-- NOTE: Roll back 205–203 first. CASCADE here is explicit draft-rollback cleanup.

BEGIN;
DROP TABLE IF EXISTS public.storage_connections CASCADE;
COMMIT;
