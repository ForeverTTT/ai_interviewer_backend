import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('[Supabase] Missing environment variables. Database features will be unavailable.')
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseServiceKey || 'placeholder-key'
)

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
