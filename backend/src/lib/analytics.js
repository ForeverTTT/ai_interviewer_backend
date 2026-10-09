import { z } from 'zod'
import { logStructured } from './observability.js'

/**
 * Product analytics events. Each event is one structured log line named
 * `analytics.<event>`; a Cloud Logging sink exports them to BigQuery.
 * Design: docs/06-决策与方案/进行中/数据埋点与分析方案.md
 *
 * Every event must be registered below. Unknown events are dropped and
 * unknown props are stripped, so free text (resumes, JDs, answers, emails)
 * can never reach the analytics pipeline by accident.
 */

export const ANALYTICS_SCHEMA_VERSION = 1
const MAX_PROPS_BYTES = 2048

const text = (max = 80) => z.string().transform((value) => value.trim().slice(0, max))
const count = z.number().int().min(0)
// Browser-measured numbers (durations, sizes) may be fractional.
const measure = z.number().finite().min(0).max(1e9).transform((value) => Math.round(value))
const mode = z.enum(['practice', 'formal'])
const GALLUP_DOMAINS = ['executing', 'influencing', 'relationship', 'strategic']
const tokenFeature = z.enum([
  'interview',
  'resume_parse',
  'resume_diagnose',
  'resume_tailor',
  'cover_letter',
  'gallup',
  'experience_share',
  'experience_delete',
])

export const FEEDBACK_FEATURES = ['interview_report', 'resume_tailor', 'cover_letter', 'resume_diagnose', 'gallup']
export const FEEDBACK_REASONS = {
  up: ['accurate', 'actionable', 'clear', 'saves_time'],
  down: ['inaccurate', 'too_generic', 'hard_to_understand', 'missing_info', 'too_slow'],
}

const SERVER_EVENTS = {
  // Explicit 👍/👎 on an AI result (POST /api/feedback). The same feedbackId
  // is sent again when reasons are added; keep the latest event per id.
  feedback_submitted: z.object({
    feedbackId: text(64),
    feature: z.enum(FEEDBACK_FEATURES),
    rating: z.enum(['up', 'down']),
    reasons: text(200).optional(),
  }),
  jd_analyzed: z.object({
    jdLength: count,
  }),
  interview_started: z.object({
    mode,
    source: z.enum(['setup', 'collection']),
    interviewerType: text(40),
    difficulty: text(20),
    language: text(40),
    durationMin: count,
    roleTrack: text(20).optional(),
    hasJobDescription: z.boolean(),
  }),
  interview_answer_submitted: z.object({
    mode,
    channel: z.enum(['api', 'live']),
    attemptNumber: count.optional(),
  }),
  practice_action_used: z.object({
    action: z.enum(['hint', 'retry', 'master', 'skip', 'pause', 'resume', 'reconnect']),
  }),
  interview_completed: z.object({
    mode,
    interviewerType: text(40),
    language: text(40),
    durationMin: count,
    messageCount: count,
    latencyMs: count,
    attempt: count,
  }),
  report_regenerated: z.object({
    mode,
    latencyMs: count,
  }),
  report_translated: z.object({
    targetLocale: text(32),
    cached: z.boolean(),
  }),
  resume_parsed: z.object({
    resumeLength: count,
  }),
  resume_diagnosed: z.object({
    hasTargetRole: z.boolean(),
    persisted: z.boolean(),
  }),
  resume_tailored: z.object({
    hasPosition: z.boolean(),
  }),
  cover_letter_generated: z.object({
    targetLength: count,
  }),
  gallup_completed: z.object({
    topDomain: z.enum(GALLUP_DOMAINS).optional(),
  }),
  experience_shared: z.object({
    type: text(50),
    visibility: z.enum(['private', 'public']).optional(),
  }),
  experience_deleted: z.object({}),
  offer_plan_saved: z.object({
    weeklyTargetDays: count,
    hasNextInterviewDate: z.boolean(),
    hasTargetOfferDate: z.boolean(),
  }),
  growth_task_completed: z.object({
    linkedToInterview: z.boolean(),
  }),
  tokens_spent: z.object({
    feature: tokenFeature,
    amount: count,
    balanceAfter: count.optional(),
  }),
  tokens_earned: z.object({
    feature: tokenFeature,
    amount: count,
  }),
  tokens_insufficient: z.object({
    feature: tokenFeature,
    required: count,
    balance: count.optional(),
  }),
}

// Browser events, accepted through POST /api/ux-events. Labels and field
// names come from the UI, never from what the user typed; the frontend
// collector (frontend/src/lib/analytics.js) masks and truncates them first.
const element = {
  element: text(20),
  role: text(30).optional(),
  trackId: text(80).optional(),
  label: text(60).optional(),
  section: text(80).optional(),
}
const field = {
  field: text(80),
  fieldType: text(20),
  section: text(80).optional(),
}
const optionalMode = z.enum(['practice', 'formal']).optional()

const CLIENT_EVENTS = {
  page_viewed: z.object({
    previousPath: text(160).optional(),
    viewport: text(20).optional(),
    isLandingPage: z.boolean().optional(),
  }),
  page_left: z.object({
    activeSec: measure,
    totalSec: measure,
    maxScrollPct: z.number().min(0).max(100).transform((value) => Math.round(value)),
    interactions: count,
    exit: z.enum(['navigate', 'hidden']).optional(),
  }),
  element_clicked: z.object({
    ...element,
    href: text(160).optional(),
    isExternal: z.boolean().optional(),
  }),
  rage_clicked: z.object({
    ...element,
    clickCount: count,
  }),
  field_focused: z.object(field),
  field_changed: z.object({
    ...field,
    value: text(60).optional(),
    checked: z.boolean().optional(),
    length: count.optional(),
  }),
  form_submitted: z.object({
    formId: text(80).optional(),
    section: text(80).optional(),
  }),
  file_selected: z.object({
    ...field,
    fileType: text(20).optional(),
    sizeKb: measure.optional(),
    fileCount: count,
  }),
  content_copied: z.object({
    section: text(80).optional(),
    length: count,
  }),
  client_error: z.object({
    kind: z.enum(['error', 'unhandledrejection']),
    message: text(200),
    source: text(120).optional(),
    line: count.optional(),
    column: count.optional(),
  }),
  web_vitals: z.object({
    lcpMs: measure.optional(),
    fcpMs: measure.optional(),
    ttfbMs: measure.optional(),
    inpMs: measure.optional(),
    cls: z.number().finite().min(0).max(100).optional(),
    domContentLoadedMs: measure.optional(),
    loadMs: measure.optional(),
    navigationType: text(20).optional(),
  }),
  api_request_failed: z.object({
    endpoint: text(160),
    method: text(10),
    status: count,
    durationMs: measure,
  }),
  api_request_slow: z.object({
    endpoint: text(160),
    method: text(10),
    status: count,
    durationMs: measure,
  }),
  network_status_changed: z.object({
    online: z.boolean(),
  }),
  consent_granted: z.object({}),
  login_started: z.object({
    provider: z.enum(['google', 'linkedin', 'email', 'local']),
  }),
  login_completed: z.object({
    provider: text(30).optional(),
    isNewUser: z.boolean(),
  }),
  login_failed: z.object({
    reason: text(60),
  }),
  logged_out: z.object({}),
  language_changed: z.object({
    from: text(8).optional(),
    to: text(8),
  }),
  theme_changed: z.object({
    scope: z.enum(['app', 'interview']),
    theme: z.enum(['light', 'dark']),
  }),
  setup_submitted: z.object({
    mode: optionalMode,
    interviewerType: text(40).optional(),
    interviewerStyle: text(40).optional(),
    difficulty: text(20).optional(),
    language: text(40).optional(),
    durationMin: count.optional(),
    employmentType: text(40).optional(),
    hasJobDescription: z.boolean(),
    hasResume: z.boolean(),
  }),
  setup_validation_failed: z.object({
    fields: text(160),
  }),
  setup_blocked: z.object({
    reason: z.enum(['insufficient_tokens', 'auth_expired', 'error']),
  }),
  interview_lobby_started: z.object({
    mode: optionalMode,
    cameraOn: z.boolean(),
  }),
  interview_camera_toggled: z.object({
    on: z.boolean(),
  }),
  interview_end_requested: z.object({
    mode: optionalMode,
  }),
  interview_finalize_triggered: z.object({
    mode: optionalMode,
    trigger: text(40),
    messageCount: count,
  }),
  interview_abandoned: z.object({
    mode: optionalMode,
    messageCount: count,
    elapsedSec: measure.optional(),
  }),
  interview_live_error: z.object({
    code: text(60),
  }),
}

const EVENT_SCHEMAS = { server: SERVER_EVENTS, client: CLIENT_EVENTS }
export const CLIENT_EVENT_NAMES = Object.freeze(Object.keys(CLIENT_EVENTS))

function cleanId(value, max = 100) {
  if (value == null) return null
  const id = String(value).trim()
  return id ? id.slice(0, max) : null
}

/**
 * Validate an event and write it as one `analytics.<name>` log line.
 * Returns true when the event was emitted. Never throws.
 */
export function emitAnalyticsEvent({
  source,
  name,
  userId,
  anonymousId,
  sessionId,
  requestId,
  interviewId,
  occurredAt,
  context = {},
  props = {},
}) {
  try {
    const schema = EVENT_SCHEMAS[source]?.[name]
    if (!schema) {
      logStructured('warn', 'analytics_event_rejected', { source, analyticsEvent: name, reason: 'unknown_event' })
      return false
    }
    const parsed = schema.safeParse(props ?? {})
    if (!parsed.success) {
      logStructured('warn', 'analytics_event_rejected', {
        source,
        analyticsEvent: name,
        reason: 'invalid_props',
        issues: parsed.error.issues.map((issue) => issue.path.join('.')).slice(0, 10),
      })
      return false
    }
    const serializedProps = JSON.stringify(parsed.data)
    if (serializedProps.length > MAX_PROPS_BYTES) {
      logStructured('warn', 'analytics_event_rejected', { source, analyticsEvent: name, reason: 'props_too_large' })
      return false
    }

    // Top-level fields are always present (null when unknown) so the BigQuery
    // sink infers one stable schema. Props stay a JSON string for the same
    // reason: different events use the same key with different types.
    logStructured('info', `analytics.${name}`, {
      schemaVersion: ANALYTICS_SCHEMA_VERSION,
      source,
      userId: cleanId(userId),
      anonymousId: cleanId(anonymousId),
      sessionId: cleanId(sessionId),
      requestId: cleanId(requestId),
      interviewId: cleanId(interviewId),
      occurredAt: occurredAt || new Date().toISOString(),
      pagePath: cleanId(context.pagePath, 160),
      referrerHost: cleanId(context.referrerHost, 120),
      utmSource: cleanId(context.utmSource),
      utmMedium: cleanId(context.utmMedium),
      utmCampaign: cleanId(context.utmCampaign),
      uiLocale: cleanId(context.uiLocale, 16),
      appVersion: cleanId(context.appVersion, 64),
      deviceType: cleanId(context.deviceType, 16),
      browser: cleanId(context.browser, 32),
      os: cleanId(context.os, 32),
      service: process.env.K_SERVICE || 'local',
      revision: process.env.K_REVISION || null,
      props: serializedProps,
    })
    return true
  } catch {
    return false
  }
}

/** Record a server-side analytics event for the request's user. Never throws. */
export function trackServerEvent(req, name, { userId, interviewId, props } = {}) {
  return emitAnalyticsEvent({
    source: 'server',
    name,
    userId: userId ?? req?.user?.id,
    requestId: req?.requestId,
    interviewId,
    props,
  })
}

/** Highest-scoring Gallup domain key from the client-computed results. */
export function topGallupDomain(results) {
  if (!Array.isArray(results)) return undefined
  const best = results
    .filter((domain) => Number.isFinite(Number(domain?.score)))
    .sort((a, b) => Number(b.score) - Number(a.score))[0]
  return GALLUP_DOMAINS.includes(best?.key) ? best.key : undefined
}
