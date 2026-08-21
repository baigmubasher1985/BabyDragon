-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: SECURITY DEFINER owner: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION — do not CREATE ROLE or ALTER OWNER to a guessed role.
-- NOTE: Rollback restores exact bodies from 01b_function_definitions.csv.
-- PAIR: 002_harden_existing_functions
-- ROLE: FORWARD

-- STOP until disposable owner decision. Intended hardened bodies:
CREATE OR REPLACE FUNCTION public.is_admin_or_super_admin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles AS p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin', 'super_admin')
      AND p.is_active IS TRUE
  );
$function$;
-- OWNER: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION

CREATE OR REPLACE FUNCTION public.get_field_engineers()
RETURNS TABLE(id uuid, email text, role text)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT p.id, p.email, p.role
  FROM public.profiles AS p
  WHERE public.is_admin_or_super_admin()
    AND p.role = 'fe'
    AND p.is_active IS TRUE
  ORDER BY p.email;
$function$;
-- OWNER: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION

CREATE OR REPLACE FUNCTION public.get_grids_geojson()
RETURNS TABLE(id uuid, name text, market text, geometry json)
LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT g.id, g.name, g.market, g.geometry FROM public.grids AS g;
$function$;

CREATE OR REPLACE FUNCTION public.set_qc_reviews_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;
-- Trigger captured in 05_trigger_definitions.csv — do not recreate unless missing.
