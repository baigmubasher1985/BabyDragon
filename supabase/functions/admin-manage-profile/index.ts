// F10C1I Phase 2 R1 — undeployed Edge Function entry: admin-manage-profile

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { parseAllowedOrigins } from '../_shared/cors.ts'
import { createDefaultManageProfileDeps, handleAdminManageProfile } from './handler.ts'

Deno.serve(async (req) => {
  const deps = createDefaultManageProfileDeps({
    SUPABASE_URL: Deno.env.get('SUPABASE_URL') ?? undefined,
    SUPABASE_ANON_KEY: Deno.env.get('SUPABASE_ANON_KEY') ?? undefined,
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? undefined,
    ALLOWED_ORIGINS: Deno.env.get('ALLOWED_ORIGINS') ?? undefined,
    createClient: createClient as never,
  })
  deps.getAllowedOrigins = () => parseAllowedOrigins(Deno.env.get('ALLOWED_ORIGINS'))
  return handleAdminManageProfile(req, deps)
})
