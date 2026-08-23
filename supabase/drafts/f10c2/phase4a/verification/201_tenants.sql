-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 4A
-- NO DATABASE TARGET AUTHORIZED
-- PAIR: 201_tenants
-- ROLE: VERIFICATION

SELECT c.relname AS table_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'tenants';

SELECT conname
FROM pg_constraint
WHERE conrelid = 'public.tenants'::regclass
  AND contype = 'u'
  AND conname = 'tenants_slug_unique';
