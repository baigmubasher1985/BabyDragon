-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: OWNER: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION
-- NOTE: Boolean helpers only; no dynamic SQL.
-- PAIR: 003_security_helpers
-- ROLE: FORWARD

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles AS p
    WHERE p.id = auth.uid() AND p.role = 'super_admin' AND p.is_active IS TRUE
  );
$function$;
-- OWNER: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION

CREATE OR REPLACE FUNCTION public.is_assigned_to_task(p_task_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.tasks AS t
    WHERE t.id = p_task_id AND t.assigned_to = auth.uid()
  );
$function$;
-- OWNER: BLOCKED_PENDING_DISPOSABLE_OWNER_DECISION
