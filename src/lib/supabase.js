import { createClient } from '@supabase/supabase-js'
import '../config/env.js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('[Supabase] Missing environment variables. Database features will be unavailable.')
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseServiceKey || 'placeholder-key'
)

if (supabaseServiceKey) {
  try {
    const payload = JSON.parse(Buffer.from(supabaseServiceKey.split('.')[1], 'base64').toString())
    console.log(`[Supabase DEBUG] Using key with role: ${payload.role} ref: ${payload.ref}`)
    if (payload.role !== 'service_role') {
      console.warn('⚠️ WARNING: SUPABASE_SERVICE_ROLE_KEY is an ANON key! RLS will block backend operations if not perfectly configured.')
    }
  } catch {
    console.warn('[Supabase DEBUG] Could not decode key payload.')
  }
}

/**
 * Create a Supabase client scoped to the authenticated user's session.
 * This properly satisfies RLS policies (auth.uid() = id) regardless
 * of whether the server key is the service-role key or the anon key.
 */
export function supabaseForUser(accessToken) {
  return createClient(
    supabaseUrl || 'https://placeholder.supabase.co',
    supabaseServiceKey || 'placeholder-key',
    {
      global: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    },
  )
}
