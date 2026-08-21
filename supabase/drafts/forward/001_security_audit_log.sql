-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: New table — proposed columns (not from live capture).
-- NOTE: Append-only; no authenticated INSERT/UPDATE/DELETE policies.
-- PAIR: 001_security_audit_log
-- ROLE: FORWARD

CREATE TABLE IF NOT EXISTS public.security_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid NULL,
  action text NOT NULL,
  target_type text NULL,
  target_id text NULL,
  outcome text NOT NULL,
  detail jsonb NULL
);
COMMENT ON TABLE public.security_audit_log IS 'F10C1I draft append-only security audit; writers = Edge/DEFINER only';
ALTER TABLE public.security_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "security_audit_log_sa_select"
  ON public.security_audit_log AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE p.id = auth.uid() AND p.role = 'super_admin' AND p.is_active IS TRUE
    )
  );
REVOKE ALL ON TABLE public.security_audit_log FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.security_audit_log FROM authenticated;
GRANT SELECT ON TABLE public.security_audit_log TO authenticated;
