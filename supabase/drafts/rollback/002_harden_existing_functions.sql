-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: SECURITY DEFINER owner: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION — do not CREATE ROLE or ALTER OWNER to a guessed role.
-- NOTE: Rollback restores exact bodies from 01b_function_definitions.csv.
-- PAIR: 002_harden_existing_functions
-- ROLE: ROLLBACK

CREATE OR REPLACE FUNCTION public.is_admin_or_super_admin()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('admin', 'super_admin')
      and coalesce(is_active, true) = true
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_field_engineers()
 RETURNS TABLE(id uuid, email text, role text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id, p.email, p.role
  from public.profiles p
  where p.role = 'fe'
  order by p.email;
$function$;

CREATE OR REPLACE FUNCTION public.get_grids_geojson()
 RETURNS TABLE(id uuid, name text, market text, geometry json)
 LANGUAGE sql
AS $function$
  select id, name, market, geometry
  from grids;
$function$;

CREATE OR REPLACE FUNCTION public.set_qc_reviews_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;
