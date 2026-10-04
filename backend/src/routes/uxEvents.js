import { createHash } from 'node:crypto'
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { supabase } from '../lib/supabase.js'
import { CLIENT_EVENT_NAMES, emitAnalyticsEvent } from '../lib/analytics.js'
import { logStructured } from '../lib/observability.js'

/**
 * POST /api/ux-events — batched browser analytics events.
 * Sent only after the user accepted cookies (frontend/src/lib/analytics.js).
 * Login is optional: the landing page reports anonymously. The user id comes
 * from the bearer token only, never from the request body.
 */
const router = Router()

export const MAX_EVENTS_PER_BATCH = 20
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000
const USER_CACHE_TTL_MS = 5 * 60 * 1000
const USER_CACHE_MAX = 5000
const userCache = new Map()

const id = z.string().trim().min(1).max(100)
const shortText = (max) => z.string().trim().max(max).optional().nullable()

const eventSchema = z.object({
  name: z.string().max(60),
  occurredAt: z.string().max(40).optional(),
  anonymousId: id,
  sessionId: id,
  interviewId: id.optional().nullable(),
  pagePath: shortText(160),
  referrerHost: shortText(120),
  utmSource: shortText(100),
  utmMedium: shortText(100),
  utmCampaign: shortText(100),
  uiLocale: shortText(16),
  appVersion: shortText(64),
  props: z.record(z.string(), z.unknown()).optional(),
})

const batchSchema = z.object({
  events: z.array(z.unknown()).min(1).max(MAX_EVENTS_PER_BATCH),
})

const uxEventsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many analytics requests' },
})

/** Coarse client classification; the raw User-Agent is never logged. */
export function classifyUserAgent(userAgent = '') {
  const ua = String(userAgent)
  const deviceType = /iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)
    ? 'tablet'
    : /Mobi|iPhone|iPod|Android|BlackBerry|Opera Mini|IEMobile/i.test(ua) ? 'mobile' : 'desktop'
  const browser = /Edg\//.test(ua) ? 'edge'
    : /OPR\/|Opera/.test(ua) ? 'opera'
      : /Firefox\/|FxiOS/.test(ua) ? 'firefox'
        : /Chrome\/|CriOS/.test(ua) ? 'chrome'
          : /Safari\//.test(ua) ? 'safari' : 'other'
  const os = /Windows/.test(ua) ? 'windows'
    : /iPhone|iPad|iPod/.test(ua) ? 'ios'
      : /Mac OS X|Macintosh/.test(ua) ? 'macos'
        : /Android/.test(ua) ? 'android'
          : /Linux/.test(ua) ? 'linux' : 'other'
  return { deviceType, browser, os }
}

/** Accept the client clock unless it is clearly wrong. */
export function normalizeOccurredAt(value, now = Date.now()) {
  const parsed = Date.parse(value || '')
  if (!Number.isFinite(parsed) || Math.abs(parsed - now) > MAX_CLOCK_SKEW_MS) {
    return new Date(now).toISOString()
  }
  return new Date(parsed).toISOString()
}

async function resolveOptionalUserId(req) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  if (!token) return null

  const key = createHash('sha256').update(token).digest('base64url')
  const cached = userCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.userId

  try {
    const { data, error } = await supabase.auth.getUser(token)
    const userId = error ? null : data?.user?.id ?? null
    if (userCache.size >= USER_CACHE_MAX) userCache.delete(userCache.keys().next().value)
    userCache.set(key, { userId, expiresAt: Date.now() + USER_CACHE_TTL_MS })
    return userId
  } catch {
    // An expired or unverifiable token still produces an anonymous event.
    return null
  }
}

const KNOWN_EVENTS = new Set(CLIENT_EVENT_NAMES)

router.post('/', uxEventsLimiter, async (req, res) => {
  const batch = batchSchema.safeParse(req.body)
  if (!batch.success) return res.status(400).json({ error: 'Invalid analytics batch' })

  const userId = await resolveOptionalUserId(req)
  const client = classifyUserAgent(req.headers['user-agent'])
  let rejected = 0

  for (const raw of batch.data.events) {
    const parsed = eventSchema.safeParse(raw)
    if (!parsed.success || !KNOWN_EVENTS.has(parsed.data.name)) {
      rejected += 1
      continue
    }
    const event = parsed.data
    const emitted = emitAnalyticsEvent({
      source: 'client',
      name: event.name,
      userId,
      anonymousId: event.anonymousId,
      sessionId: event.sessionId,
      requestId: req.requestId,
      interviewId: event.interviewId,
      occurredAt: normalizeOccurredAt(event.occurredAt),
      context: {
        pagePath: event.pagePath,
        referrerHost: event.referrerHost,
        utmSource: event.utmSource,
        utmMedium: event.utmMedium,
        utmCampaign: event.utmCampaign,
        uiLocale: event.uiLocale,
        appVersion: event.appVersion,
        ...client,
      },
      props: event.props ?? {},
    })
    if (!emitted) rejected += 1
  }

  if (rejected > 0) {
    logStructured('warn', 'ux_events_rejected', {
      requestId: req.requestId,
      rejected,
      received: batch.data.events.length,
    })
  }
  // Same response either way: callers cannot probe which events were kept.
  return res.status(204).end()
})

export default router
