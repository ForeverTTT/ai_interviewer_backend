import i18n from 'i18next'
import { getBackendBaseUrl } from './backendBase'
import { supabase } from './supabase'

/**
 * Product analytics collector. Nothing is stored or sent until the user
 * accepts cookies. Events go to POST /api/ux-events, which validates them
 * against a whitelist and writes `analytics.*` logs (exported to BigQuery).
 * Design: docs/06-决策与方案/进行中/数据埋点与分析方案.md
 *
 * Never put user-entered text into props — only enums, numbers, booleans and
 * UI labels. The backend strips unknown props, but keep it clean here too.
 */

export const CONSENT_KEY = 'cookie-consent'
const ANON_KEY = 'fl_anon_id'
const SESSION_KEY = 'fl_session'
const ATTRIBUTION_KEY = 'fl_attribution'
const SESSION_IDLE_MS = 30 * 60 * 1000
const PAGE_IDLE_CAP_MS = 30 * 1000
const FLUSH_INTERVAL_MS = 5000
const FLUSH_AT = 10
const MAX_BATCH = 20
const MAX_EVENTS_PER_LOAD = 2000

let queue = []
let flushTimer = null
let sentThisLoad = 0
let currentPage = null
let lastActivityAt = Date.now()

const uuid = () => globalThis.crypto?.randomUUID?.()
  ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`

function readJson(storage, key) {
  try { return JSON.parse(storage.getItem(key) || 'null') } catch { return null }
}

export function hasConsent() {
  try { return localStorage.getItem(CONSENT_KEY) === 'accepted' } catch { return false }
}

/** Called by the cookie banner and the cookie settings entry. */
export function setConsent(accepted) {
  try {
    localStorage.setItem(CONSENT_KEY, accepted ? 'accepted' : 'declined')
    if (!accepted) {
      queue = []
      localStorage.removeItem(ANON_KEY)
      localStorage.removeItem(SESSION_KEY)
      sessionStorage.removeItem(ATTRIBUTION_KEY)
      return
    }
  } catch {
    return
  }
  captureAttribution()
  track('consent_granted')
  // Start measuring the page the user is already on.
  currentPage = null
  trackPageView(window.location.pathname)
}

function anonymousId() {
  let id = localStorage.getItem(ANON_KEY)
  if (!id) {
    id = uuid()
    localStorage.setItem(ANON_KEY, id)
  }
  return id
}

/** Shared across tabs; rotates after 30 minutes without any event. */
function sessionId() {
  const now = Date.now()
  let session = readJson(localStorage, SESSION_KEY)
  if (!session?.id || now - Number(session.lastSeen || 0) > SESSION_IDLE_MS) {
    session = { id: uuid(), startedAt: now }
  }
  session.lastSeen = now
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  return session.id
}

function captureAttribution() {
  try {
    if (readJson(sessionStorage, ATTRIBUTION_KEY)) return
    const params = new URLSearchParams(window.location.search)
    let referrerHost = null
    if (document.referrer) {
      const host = new URL(document.referrer).hostname
      if (host && host !== window.location.hostname) referrerHost = host
    }
    sessionStorage.setItem(ATTRIBUTION_KEY, JSON.stringify({
      utmSource: params.get('utm_source')?.slice(0, 100) || null,
      utmMedium: params.get('utm_medium')?.slice(0, 100) || null,
      utmCampaign: params.get('utm_campaign')?.slice(0, 100) || null,
      referrerHost,
    }))
  } catch { /* ignore */ }
}

const UUID_SEGMENT = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi

/** /interview/7f3a…/report → /interview/:id/report */
export function normalizePath(pathname = '') {
  return String(pathname)
    .replace(UUID_SEGMENT, '/:id')
    .replace(/\/\d{2,}(?=\/|$)/g, '/:n')
    .replace(/\/+$/, '') || '/'
}

function interviewIdFromPath(pathname = '') {
  return String(pathname).match(/^\/interview\/([0-9a-f-]{36})/i)?.[1] ?? null
}

/**
 * Record an event. `options.pagePath` overrides the current path (used when
 * reporting a page the user has just left).
 */
export function track(name, props = {}, options = {}) {
  if (!name || !hasConsent()) return
  if (sentThisLoad >= MAX_EVENTS_PER_LOAD) return
  try {
    sentThisLoad += 1
    const attribution = readJson(sessionStorage, ATTRIBUTION_KEY) || {}
    const cleanProps = Object.fromEntries(
      Object.entries(props || {}).filter(([, value]) => value !== undefined && value !== null && value !== ''),
    )
    queue.push({
      name,
      occurredAt: new Date().toISOString(),
      anonymousId: anonymousId(),
      sessionId: sessionId(),
      interviewId: options.interviewId ?? interviewIdFromPath(window.location.pathname),
      pagePath: options.pagePath ?? normalizePath(window.location.pathname),
      uiLocale: i18n.resolvedLanguage || i18n.language || null,
      appVersion: import.meta.env.VITE_APP_VERSION || 'dev',
      ...attribution,
      props: cleanProps,
    })
    if (queue.length >= FLUSH_AT) void flush()
    else if (!flushTimer) flushTimer = window.setTimeout(() => { void flush() }, FLUSH_INTERVAL_MS)
  } catch { /* analytics must never break the app */ }
}

export async function flush({ keepalive = false } = {}) {
  window.clearTimeout(flushTimer)
  flushTimer = null
  while (queue.length) {
    const events = queue.splice(0, MAX_BATCH)
    try {
      const { data } = await supabase.auth.getSession()
      const token = data?.session?.access_token
      await fetch(`${getBackendBaseUrl()}/api/ux-events`, {
        method: 'POST',
        keepalive,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ events }),
      })
    } catch { /* dropped on purpose */ }
  }
}

/* ── Page lifecycle: views, active time, scroll depth ── */

/** Called by interaction listeners; counts towards active time on the page. */
export function markActivity({ interaction = false } = {}) {
  const now = Date.now()
  if (currentPage && document.visibilityState === 'visible') {
    currentPage.activeMs += Math.min(now - lastActivityAt, PAGE_IDLE_CAP_MS)
    if (interaction) currentPage.interactions += 1
  }
  lastActivityAt = now
}

export function recordScrollDepth(pct) {
  if (currentPage && Number.isFinite(pct)) {
    currentPage.maxScrollPct = Math.max(currentPage.maxScrollPct, Math.min(100, Math.max(0, pct)))
  }
}

function startPage(pathname) {
  lastActivityAt = Date.now()
  currentPage = {
    path: normalizePath(pathname),
    interviewId: interviewIdFromPath(pathname),
    startedAt: Date.now(),
    activeMs: 0,
    maxScrollPct: 0,
    interactions: 0,
  }
}

/** exit: navigate (route change) or hidden (tab hidden / closed). */
function endPage(exit) {
  if (!currentPage) return
  markActivity()
  const page = currentPage
  currentPage = null
  track('page_left', {
    activeSec: page.activeMs / 1000,
    totalSec: (Date.now() - page.startedAt) / 1000,
    maxScrollPct: page.maxScrollPct,
    interactions: page.interactions,
    exit,
  }, { pagePath: page.path, interviewId: page.interviewId })
}

export function trackPageView(pathname) {
  if (!hasConsent()) return
  const path = normalizePath(pathname)
  if (currentPage?.path === path) return
  const previousPath = currentPage?.path
  const isLandingPage = !previousPath && !readJson(sessionStorage, 'fl_seen_page')
  endPage('navigate')
  try { sessionStorage.setItem('fl_seen_page', '1') } catch { /* ignore */ }
  startPage(pathname)
  track('page_viewed', {
    previousPath,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    isLandingPage,
  })
  // Short pages never scroll; count what is visible on arrival.
  window.requestAnimationFrame(() => {
    const doc = document.documentElement
    if (doc.scrollHeight > 0) recordScrollDepth(((window.scrollY + window.innerHeight) / doc.scrollHeight) * 100)
  })
}

/**
 * Tab hidden or closing: report the time spent so far and send everything.
 * A page can therefore have several page_left segments; sum them per view.
 */
export function flushOnExit() {
  if (!hasConsent()) return
  endPage('hidden')
  void flush({ keepalive: true })
}

/** Tab visible again: keep measuring the same page without a new page view. */
export function resumePage(pathname) {
  if (!hasConsent()) return
  if (!currentPage) startPage(pathname)
  lastActivityAt = Date.now()
}

if (typeof window !== 'undefined' && hasConsent()) captureAttribution()
