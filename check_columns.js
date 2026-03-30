import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function checkColumns() {
  const { data, error } = await supabase.from('profiles').select('*').limit(1)
  if (error) {
    console.error('Error selecting from profiles:', error.message)
    if (error.message.includes('tokens')) {
        console.log('CONFIRMED: Column "tokens" is missing.')
    }
  } else {
    console.log('Columns found in profiles row:', Object.keys(data?.[0] || {}))
  }
}

checkColumns()
