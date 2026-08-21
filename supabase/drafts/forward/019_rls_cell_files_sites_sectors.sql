-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: FE read-only for assigned map context; Adm write. Do not invent FK columns.
-- PAIR: 019_rls_cell_files_sites_sectors
-- ROLE: FORWARD

BEGIN;
DROP POLICY IF EXISTS "Authenticated users can delete cell files" ON public.cell_files;
DROP POLICY IF EXISTS "Authenticated users can insert cell files" ON public.cell_files;
DROP POLICY IF EXISTS "Authenticated users can update cell files" ON public.cell_files;
DROP POLICY IF EXISTS "Authenticated users can view cell files" ON public.cell_files;
DROP POLICY IF EXISTS "Admins can manage cell sites" ON public.cell_sites;
DROP POLICY IF EXISTS "Authenticated users can delete cell sites" ON public.cell_sites;
DROP POLICY IF EXISTS "Authenticated users can insert cell sites" ON public.cell_sites;
DROP POLICY IF EXISTS "Authenticated users can update cell sites" ON public.cell_sites;
DROP POLICY IF EXISTS "Authenticated users can view cell sites" ON public.cell_sites;
DROP POLICY IF EXISTS "Authenticated users can delete cell sectors" ON public.cell_sectors;
DROP POLICY IF EXISTS "Authenticated users can insert cell sectors" ON public.cell_sectors;
DROP POLICY IF EXISTS "Authenticated users can update cell sectors" ON public.cell_sectors;
DROP POLICY IF EXISTS "Authenticated users can view cell sectors" ON public.cell_sectors;

CREATE POLICY "cell_files_admin_all" ON public.cell_files AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_admin_or_super_admin()) WITH CHECK (public.is_admin_or_super_admin());
CREATE POLICY "cell_files_fe_select_assigned_maps" ON public.cell_files AS PERMISSIVE FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tasks AS t WHERE t.assigned_to = auth.uid()));

CREATE POLICY "cell_sites_admin_all" ON public.cell_sites AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_admin_or_super_admin()) WITH CHECK (public.is_admin_or_super_admin());
CREATE POLICY "cell_sites_fe_select_assigned_maps" ON public.cell_sites AS PERMISSIVE FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tasks AS t WHERE t.assigned_to = auth.uid()));

CREATE POLICY "cell_sectors_admin_all" ON public.cell_sectors AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_admin_or_super_admin()) WITH CHECK (public.is_admin_or_super_admin());
CREATE POLICY "cell_sectors_fe_select_assigned_maps" ON public.cell_sectors AS PERMISSIVE FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tasks AS t WHERE t.assigned_to = auth.uid()));
COMMIT;
