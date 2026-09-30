import { randomUUID } from 'node:crypto'

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/

export function normalizeRequestId(value) {
  const candidate = String(value || '').trim()
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID()
}

export function requestContext(req, extra = {}) {
  return {
    requestId: req?.requestId,
    method: req?.method,
    path: req?.originalUrl || req?.path,
    userId: req?.user?.id,
    ...extra,
  }
}

function redactSecrets(value) {
  return String(value || '')
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:key|api_key|access_token)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[REDACTED_API_KEY]')
    .replace(/\beyJ[0-9A-Za-z_-]+\.[0-9A-Za-z_-]+\.[0-9A-Za-z_-]+\b/g, '[REDACTED_JWT]')
}

export function errorSummary(error) {
  const message = redactSecrets(error?.message || error || 'Unknown error').slice(0, 2000)
  const code = String(error?.code || error?.status || error?.statusCode || '').slice(0, 100) || null
  return { code, message }
}

export function logStructured(level, event, fields = {}) {
  const severity = level === 'error' ? 'ERROR' : level === 'warn' ? 'WARNING' : 'INFO'
  const payload = {
    severity,
    event,
    timestamp: new Date().toISOString(),
    ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
  }
  const writer = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  writer(JSON.stringify(payload))
}

export function requestIdMiddleware(req, res, next) {
  req.requestId = normalizeRequestId(req.headers['x-request-id'])
  res.setHeader('X-Request-Id', req.requestId)
  next()
}
