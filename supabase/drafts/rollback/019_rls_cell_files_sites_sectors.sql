-- DRAFT / UNAPPLIED / DO NOT RUN
-- F10C1I PHASE 2
-- NO DATABASE TARGET AUTHORIZED
-- NOTE: FE read-only for assigned map context; Adm write. Do not invent FK columns.
-- PAIR: 019_rls_cell_files_sites_sectors
-- ROLE: ROLLBACK

DROP POLICY IF EXISTS "Authenticated users can delete cell files" ON public.cell_files;
DROP POLICY IF EXISTS "Authenticated users can insert cell files" ON public.cell_files;
DROP POLICY IF EXISTS "Authenticated users can update cell files" ON public.cell_files;
DROP POLICY IF EXISTS "Authenticated users can view cell files" ON public.cell_files;
DROP POLICY IF EXISTS "cell_files_admin_all" ON public.cell_files;
DROP POLICY IF EXISTS "cell_files_fe_select_assigned_maps" ON public.cell_files;
CREATE POLICY "Authenticated users can delete cell files" ON public.cell_files AS PERMISSIVE FOR DELETE TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert cell files" ON public.cell_files AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update cell files" ON public.cell_files AS PERMISSIVE FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can view cell files" ON public.cell_files AS PERMISSIVE FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins can manage cell sites" ON public.cell_sites;
DROP POLICY IF EXISTS "Authenticated users can delete cell sites" ON public.cell_sites;
DROP POLICY IF EXISTS "Authenticated users can insert cell sites" ON public.cell_sites;
DROP POLICY IF EXISTS "Authenticated users can update cell sites" ON public.cell_sites;
DROP POLICY IF EXISTS "Authenticated users can view cell sites" ON public.cell_sites;
DROP POLICY IF EXISTS "cell_sites_admin_all" ON public.cell_sites;
DROP POLICY IF EXISTS "cell_sites_fe_select_assigned_maps" ON public.cell_sites;
CREATE POLICY "Admins can manage cell sites" ON public.cell_sites AS PERMISSIVE FOR ALL TO public USING (is_admin_or_super_admin());
CREATE POLICY "Authenticated users can delete cell sites" ON public.cell_sites AS PERMISSIVE FOR DELETE TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert cell sites" ON public.cell_sites AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update cell sites" ON public.cell_sites AS PERMISSIVE FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can view cell sites" ON public.cell_sites AS PERMISSIVE FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can delete cell sectors" ON public.cell_sectors;
DROP POLICY IF EXISTS "Authenticated users can insert cell sectors" ON public.cell_sectors;
DROP POLICY IF EXISTS "Authenticated users can update cell sectors" ON public.cell_sectors;
DROP POLICY IF EXISTS "Authenticated users can view cell sectors" ON public.cell_sectors;
DROP POLICY IF EXISTS "cell_sectors_admin_all" ON public.cell_sectors;
DROP POLICY IF EXISTS "cell_sectors_fe_select_assigned_maps" ON public.cell_sectors;
CREATE POLICY "Authenticated users can delete cell sectors" ON public.cell_sectors AS PERMISSIVE FOR DELETE TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert cell sectors" ON public.cell_sectors AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update cell sectors" ON public.cell_sectors AS PERMISSIVE FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can view cell sectors" ON public.cell_sectors AS PERMISSIVE FOR SELECT TO authenticated USING (true);
