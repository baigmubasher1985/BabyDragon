-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C2 PHASE 4A
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: Tenant / organization residency boundary. New connectors, policies,
-- NOTE: artifacts and transfer jobs must be tenant-scoped. No production apply.
-- NOTE: Operational child tables use ON DELETE RESTRICT. Deactivate via is_active.
-- NOTE: Accidental CASCADE of storage config or evidence is not permitted at runtime.
-- PAIR: 201_tenants
-- ROLE: FORWARD
-- CLASSIFICATION: (a) draftable / apply-candidate

BEGIN;

CREATE TABLE IF NOT EXISTS public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  display_name text NOT NULL,
  residency_region text NULL,
  deployment_mode text NOT NULL DEFAULT 'mobbitech_saas'
    CHECK (deployment_mode IN (
      'mobbitech_saas',
      'hybrid_customer_storage',
      'customer_hosted_data_plane',
      'fully_private'
    )),
  is_active boolean NOT NULL DEFAULT true,
  deactivated_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenants_slug_unique UNIQUE (slug)
);

CREATE INDEX IF NOT EXISTS tenants_is_active_idx
  ON public.tenants (is_active);

COMMENT ON TABLE public.tenants IS
  'F10C2 Phase 4A-R1 draft: tenant residency boundary. Soft-deactivate; do not CASCADE-delete operational data.';
COMMENT ON COLUMN public.tenants.is_active IS
  'Runtime deletion is forbidden while child storage/evidence rows exist. Set false instead of DELETE.';

COMMIT;
