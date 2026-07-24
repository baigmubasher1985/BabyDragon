import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const SUPABASE_PROBE_TIMEOUT_MS = 9000

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export function getSupabaseConfigStatus() {
  let urlHost = ''
  try {
    urlHost = supabaseUrl ? new URL(supabaseUrl).hostname : ''
  } catch {
    urlHost = ''
  }

  return {
    configured: isSupabaseConfigured,
    urlConfigured: Boolean(supabaseUrl),
    anonKeyConfigured: Boolean(supabaseAnonKey),
    urlHost,
  }
}

async function runSupabaseProbe(label, url, options = {}, timeoutMs = SUPABASE_PROBE_TIMEOUT_MS) {
  const startedAt = performance.now()

  try {
    const response = await Promise.race([
      fetch(url, options),
      new Promise((_, reject) => {
        window.setTimeout(() => reject(new Error('Probe timed out.')), timeoutMs)
      }),
    ])

    return {
      label,
      ok: true,
      status: response.status,
      statusText: response.statusText || '',
      elapsedMs: Math.round(performance.now() - startedAt),
      errorName: '',
      errorMessage: '',
    }
  } catch (probeError) {
    return {
      label,
      ok: false,
      status: null,
      statusText: '',
      elapsedMs: Math.round(performance.now() - startedAt),
      errorName: String(probeError?.name || 'Error'),
      errorMessage: String(probeError?.message || probeError || 'Unknown probe error'),
    }
  }
}

export async function probeSupabaseLoginServer(timeoutMs = SUPABASE_PROBE_TIMEOUT_MS) {
  const config = getSupabaseConfigStatus()

  if (!config.configured) {
    return {
      config,
      probes: [
        {
          label: 'config',
          ok: false,
          status: null,
          statusText: '',
          elapsedMs: 0,
          errorName: 'ConfigError',
          errorMessage: 'Supabase URL or anon key is missing in app config.',
        },
      ],
    }
  }

  const probes = [
    await runSupabaseProbe('A host GET', supabaseUrl, { method: 'GET' }, timeoutMs),
    await runSupabaseProbe('B auth health', `${supabaseUrl}/auth/v1/health`, { method: 'GET' }, timeoutMs),
    await runSupabaseProbe(
      'C auth settings',
      `${supabaseUrl}/auth/v1/settings`,
      {
        method: 'GET',
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
        },
      },
      timeoutMs,
    ),
  ]

  return { config, probes }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)