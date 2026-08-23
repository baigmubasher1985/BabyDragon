-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 4A
-- NO DATABASE TARGET AUTHORIZED
-- PAIR: 201_tenants
-- ROLE: ROLLBACK
-- NOTE: Roll back 205–202 before this file if those drafts were applied.
-- NOTE: CASCADE here is explicit draft-rollback cleanup, not a runtime delete path.

BEGIN;
DROP TABLE IF EXISTS public.tenants CASCADE;
COMMIT;
