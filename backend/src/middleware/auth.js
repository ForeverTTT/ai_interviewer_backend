import { createHash } from 'node:crypto'
import '../config/env.js'
import { supabase } from '../lib/supabase.js'
import { errorSummary, logStructured, requestContext } from '../lib/observability.js'

const AUTH_CACHE_TTL_MS = 60 * 1000
const AUTH_CACHE_MAX_ENTRIES = 1000
const verifiedUsers = new Map()

function tokenCacheKey(token) {
  return createHash('sha256').update(token).digest('base64url')
}

function tokenExpiresAt(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    return Number(payload.exp) * 1000
  } catch {
    return 0
  }
}

async function verifiedUser(token) {
  const now = Date.now()
  const key = tokenCacheKey(token)
  const cached = verifiedUsers.get(key)
  if (cached?.expiresAt > now) return cached.promise
  if (cached) verifiedUsers.delete(key)

  // 同一页面会并发请求主体和筛选项；缓存进行中的 Promise，避免重复远程验签。
  const promise = supabase.auth.getUser(token).then(({ data: { user }, error }) => {
    if (error || !user) {
      const authError = error || Object.assign(new Error('Invalid token'), { name: 'AuthInvalidUserError', status: 401 })
      verifiedUsers.delete(key)
      throw authError
    }
    return user
  })
  const jwtExpiry = tokenExpiresAt(token)
  const expiresAt = Math.min(now + AUTH_CACHE_TTL_MS, jwtExpiry || now + AUTH_CACHE_TTL_MS)
  verifiedUsers.set(key, { expiresAt, promise })
  if (verifiedUsers.size > AUTH_CACHE_MAX_ENTRIES) verifiedUsers.delete(verifiedUsers.keys().next().value)
  return promise
}

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
    const user = await verifiedUser(token)

    req.user = user
    req.accessToken = token
    logStructured('info', 'auth_succeeded', requestContext(req))
    next()
  } catch (err) {
    if (err?.status === 400 || err?.status === 401 || err?.name?.startsWith('Auth')) {
      logStructured('warn', 'auth_rejected', requestContext(req, {
        reason: 'invalid_or_expired_token',
        authStatus: err?.status,
        authCode: err?.code,
      }))
      return res.status(401).json({
        error: 'Invalid or expired token',
        code: 'AUTH_TOKEN_INVALID',
      })
    }
    logStructured('error', 'auth_error', requestContext(req, { errorMessage: errorSummary(err).message }))
    return res.status(500).json({ error: 'Internal server error' })
  }
}
