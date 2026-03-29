import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function checkInterviews() {
  const { data, error } = await supabase.from('interviews').select('*').limit(5)
  if (error) {
    console.error('Error fetching interviews:', error.message)
  } else {
    console.log('Sample interviews found:', data.length)
    if (data.length > 0) {
      console.log('Sample interview user_id:', data[0].user_id)
    }
  }
}

checkInterviews()
