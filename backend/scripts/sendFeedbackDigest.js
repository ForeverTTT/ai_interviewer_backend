import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { digestConfig, digestSetupEmail, resendSender, runFeedbackDigest } from '../src/lib/feedbackDigest.js'

async function main() {
  const args = process.argv.slice(2)
  if (args.length > 1 || args.some(arg => !['--send', '--dry-run', '--test-email'].includes(arg))) {
    throw new Error('Usage: node scripts/sendFeedbackDigest.js [--dry-run|--send|--test-email] (default: --dry-run)')
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  }
  const testEmail = args.includes('--test-email')
  const dryRun = !args.includes('--send') && !testEmail
  const config = dryRun ? undefined : digestConfig(process.env)
  const send = dryRun ? undefined : resendSender(process.env.RESEND_API_KEY)
  if (testEmail) {
    const runId = process.env.GITHUB_RUN_ID || new Date().toISOString().slice(0, 10)
    const id = await send(digestSetupEmail(config), `feedback-digest/setup/${runId}`)
    console.log(JSON.stringify({ status: 'test_email_sent', provider_email_id: id }))
    return
  }
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(30_000) }) },
  })
  const result = await runFeedbackDigest({ db, config, send, dryRun })
  console.log(JSON.stringify(result))
}

main().catch(error => {
  // Schema issues can include values: never print the raw error or stack.
  console.error(error?.name === 'ZodError' ? 'Invalid digest data; check database migration and configuration' : error.message)
  process.exitCode = 1
})
