import { createClient } from '@supabase/supabase-js'
import '../config/env.js'
import { errorSummary, logStructured, requestContext } from '../lib/observability.js'

/**
 * Middleware to verify Supabase JWT token and attach user to request.
 */
export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    logStructured('warn', 'auth_rejected', requestContext(req, { reason: 'missing_authorization' }))
    return res.status(401).json({ error: 'Missing or invalid Authorization header' })
  }

  const token = authHeader.split(' ')[1]

  try {
    // Use anon key to verify the user's JWT
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    const { data: { user }, error } = await supabase.auth.getUser(token)

    if (error || !user) {
      logStructured('warn', 'auth_rejected', requestContext(req, {
        reason: 'invalid_or_expired_token',
        authStatus: error?.status,
        authCode: error?.code,
      }))
      return res.status(401).json({
        error: 'Invalid or expired token',
        code: 'AUTH_TOKEN_INVALID',
      })
    }

    req.user = user
    req.accessToken = token
    logStructured('info', 'auth_succeeded', requestContext(req))
    next()
  } catch (err) {
    logStructured('error', 'auth_error', requestContext(req, { errorMessage: errorSummary(err).message }))
    return res.status(500).json({ error: 'Internal server error' })
  }
}
