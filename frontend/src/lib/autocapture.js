import { getBackendBaseUrl } from './backendBase'
import {
  flushOnExit,
  hasConsent,
  markActivity,
  normalizePath,
  recordScrollDepth,
  resumePage,
  track,
} from './analytics'

/**
 * Page-independent behaviour capture: clicks, form fields, files, copying,
 * JS errors, Web Vitals, failed or slow API calls and connectivity.
 *
 * Privacy rules enforced here:
 * - Typed values are never read. Only select / radio / checkbox values (UI
 *   options) are recorded, and only their option value or label.
 * - Anything inside [data-track-mask], password/email fields and
 *   contenteditable regions produces events without labels or values.
 * - Labels are masked (emails, long digit runs) and truncated.
 *
 * Markup hooks (optional, all pages work without them):
 * - data-track="stable-id"     stable name for a clickable element or field
 * - data-track-section="name"  groups everything inside it
 * - data-track-mask            container whose text must never be captured
 * - data-track-ignore          skip the element entirely
 */

const CLICKABLE = [
  // Labels are left out: clicking one also clicks its input, which is captured.
  'button', 'a[href]', 'summary', 'select',
  'input[type="button"]', 'input[type="submit"]', 'input[type="reset"]',
  'input[type="checkbox"]', 'input[type="radio"]',
  '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
  '[role="option"]', '[role="switch"]', '[role="checkbox"]', '[role="radio"]',
  '[data-track]',
].join(',')
const FIELDS = 'input, textarea, select'
const LANDMARKS = 'header, nav, main, aside, footer, form, dialog, [role="dialog"], section'
const RAGE_WINDOW_MS = 1000
const RAGE_CLICKS = 3
const SLOW_API_MS = 8000
const MAX_ERRORS_PER_PAGE = 5

let installed = false

const cleanText = (value, max = 60) => {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]')
    .replace(/\d{4,}/g, '#')
    .trim()
  return text ? text.slice(0, max) : undefined
}

/** React useId() ids (":r1:") change between renders and builds; ignore them. */
const stableId = (value) => (value && !String(value).includes(':') ? value : undefined)

const isMasked = (el) => Boolean(
  el.closest('[data-track-mask], [contenteditable="true"], [contenteditable=""]'),
)

function sectionOf(el) {
  const named = el.closest('[data-track-section]')
  if (named) return cleanText(named.getAttribute('data-track-section'), 80)
  const landmark = el.closest(LANDMARKS)
  if (!landmark) return undefined
  const tag = landmark.getAttribute('role') === 'dialog' ? 'dialog' : landmark.tagName.toLowerCase()
  const id = stableId(landmark.id)
  return id ? `${tag}#${cleanText(id, 60)}` : tag
}

const MAX_VISIBLE_LABEL = 40

function labelOf(el) {
  // Checkbox / radio values are not labels; field_changed describes them.
  if (isMasked(el) || el.matches('input[type="checkbox"], input[type="radio"]')) return undefined
  const explicit = el.getAttribute('aria-label') || el.getAttribute('title')
  if (explicit) return cleanText(explicit)
  const visible = String(el.tagName === 'INPUT' ? el.value : el.innerText || el.textContent || '')
    .replace(/\s+/g, ' ')
    .trim()
  // Long text on a clickable element is usually content (a card, a list
  // item, a question), not a UI label — keep the click, drop the text.
  if (visible.length > MAX_VISIBLE_LABEL) return undefined
  return cleanText(visible || el.querySelector?.('img[alt]')?.getAttribute('alt'))
}

function fieldNameOf(el) {
  const labelEl = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : el.closest('label')
  return cleanText(
    el.getAttribute('data-track')
      || el.name
      || stableId(el.id)
      || el.getAttribute('aria-label')
      || (labelEl && !isMasked(labelEl) ? labelEl.innerText : '')
      || el.getAttribute('placeholder')
      || el.type,
    80,
  ) || 'unknown'
}

function fieldTypeOf(el) {
  if (el.tagName === 'TEXTAREA') return 'textarea'
  if (el.tagName === 'SELECT') return 'select'
  return (el.getAttribute('type') || 'text').toLowerCase()
}

function hrefInfo(el) {
  const raw = el.getAttribute?.('href')
  if (!raw || raw.startsWith('javascript:')) return {}
  try {
    const url = new URL(raw, window.location.href)
    if (url.protocol === 'mailto:' || url.protocol === 'tel:') return { href: url.protocol, isExternal: true }
    if (url.origin === window.location.origin) return { href: normalizePath(url.pathname), isExternal: false }
    return { href: url.hostname, isExternal: true }
  } catch {
    return {}
  }
}

/* ── Clicks ── */

let lastClick = { target: null, at: 0, count: 0 }

function onClick(event) {
  markActivity({ interaction: true })
  if (!hasConsent()) return
  const el = event.target?.closest?.(CLICKABLE)
  if (!el || el.closest('[data-track-ignore]')) return
  // Text fields are covered by focus / change events.
  if (el.matches('input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"])')) return

  const props = {
    element: el.tagName.toLowerCase(),
    role: el.getAttribute('role') || undefined,
    trackId: cleanText(el.getAttribute('data-track') || stableId(el.id), 80),
    label: labelOf(el),
    section: sectionOf(el),
    ...(el.tagName === 'A' ? hrefInfo(el) : {}),
  }
  track('element_clicked', props)

  const now = Date.now()
  if (lastClick.target === el && now - lastClick.at < RAGE_WINDOW_MS) {
    lastClick.count += 1
    if (lastClick.count === RAGE_CLICKS) {
      const { href: _href, isExternal: _external, ...rest } = props
      track('rage_clicked', { ...rest, clickCount: lastClick.count })
    }
  } else {
    lastClick = { target: el, at: now, count: 1 }
  }
  lastClick.at = now
}

/* ── Form fields ── */

let focusedFields = new WeakSet()

function onFocusIn(event) {
  const el = event.target
  if (!hasConsent() || !el?.matches?.(FIELDS) || el.closest('[data-track-ignore]')) return
  // Once per field per page view is enough to see which fields people use.
  if (focusedFields.has(el)) return
  focusedFields.add(el)
  track('field_focused', { field: fieldNameOf(el), fieldType: fieldTypeOf(el), section: sectionOf(el) })
}

function onChange(event) {
  markActivity({ interaction: true })
  const el = event.target
  if (!hasConsent() || !el?.matches?.(FIELDS) || el.closest('[data-track-ignore]')) return
  const fieldType = fieldTypeOf(el)
  const base = { field: fieldNameOf(el), fieldType, section: sectionOf(el) }

  if (fieldType === 'file') {
    const files = Array.from(el.files || [])
    const first = files[0]
    track('file_selected', {
      ...base,
      fileCount: files.length,
      fileType: first ? cleanText(first.name.split('.').pop()?.toLowerCase(), 20) : undefined,
      sizeKb: first ? first.size / 1024 : undefined,
    })
    return
  }

  const masked = isMasked(el) || ['password', 'email', 'tel'].includes(fieldType)
  if (fieldType === 'checkbox' || fieldType === 'radio') {
    track('field_changed', {
      ...base,
      checked: el.checked,
      value: masked || fieldType === 'checkbox' ? undefined : cleanText(el.value),
    })
    return
  }
  if (fieldType === 'select') {
    const option = el.selectedOptions?.[0]
    track('field_changed', {
      ...base,
      value: masked ? undefined : cleanText(option?.value || option?.text),
    })
    return
  }
  // Free text: only how much was typed, never what.
  track('field_changed', { ...base, length: String(el.value || '').length })
}

function onSubmit(event) {
  if (!hasConsent()) return
  const form = event.target
  if (!form?.tagName || form.tagName !== 'FORM' || form.closest('[data-track-ignore]')) return
  track('form_submitted', {
    formId: cleanText(form.getAttribute('data-track') || stableId(form.id) || form.getAttribute('name'), 80),
    section: sectionOf(form),
  })
}

function onCopy(event) {
  if (!hasConsent()) return
  const selection = String(window.getSelection?.() || '')
  const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement
  track('content_copied', { section: target ? sectionOf(target) : undefined, length: selection.length })
}

/* ── Scroll depth (window and inner scroll containers) ── */

let scrollFrame = 0
function onScroll(event) {
  if (scrollFrame) return
  scrollFrame = window.requestAnimationFrame(() => {
    scrollFrame = 0
    markActivity()
    const target = event.target
    if (target && target !== document && target.scrollHeight > target.clientHeight + 40) {
      recordScrollDepth(((target.scrollTop + target.clientHeight) / target.scrollHeight) * 100)
    } else {
      const doc = document.documentElement
      if (doc.scrollHeight > 0) recordScrollDepth(((window.scrollY + window.innerHeight) / doc.scrollHeight) * 100)
    }
  })
}

/* ── JS errors ── */

let errorsThisPage = 0
let errorPath = ''
const seenErrors = new Set()

function reportError(kind, message, source, line, column) {
  if (!hasConsent()) return
  const path = window.location.pathname
  if (path !== errorPath) {
    errorPath = path
    errorsThisPage = 0
    seenErrors.clear()
  }
  const text = cleanText(message, 200) || 'Unknown error'
  if (seenErrors.has(text) || errorsThisPage >= MAX_ERRORS_PER_PAGE) return
  seenErrors.add(text)
  errorsThisPage += 1
  let file
  try { file = source ? new URL(source, window.location.href).pathname.split('/').pop() : undefined } catch { /* ignore */ }
  track('client_error', { kind, message: text, source: cleanText(file, 120), line, column })
}

/* ── Web Vitals (one report per page load) ── */

const vitals = {}
let vitalsSent = false

function observeVitals() {
  if (typeof PerformanceObserver === 'undefined') return
  const observe = (type, callback, extra = {}) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach(callback))
        .observe({ type, buffered: true, ...extra })
    } catch { /* unsupported entry type */ }
  }
  observe('largest-contentful-paint', (entry) => { vitals.lcpMs = entry.startTime })
  observe('paint', (entry) => { if (entry.name === 'first-contentful-paint') vitals.fcpMs = entry.startTime })
  observe('layout-shift', (entry) => {
    if (!entry.hadRecentInput) vitals.cls = (vitals.cls || 0) + entry.value
  })
  // Approximate INP: the slowest interaction seen on this load.
  observe('event', (entry) => {
    if (entry.interactionId) vitals.inpMs = Math.max(vitals.inpMs || 0, entry.duration)
  }, { durationThreshold: 40 })
}

function sendVitals() {
  if (vitalsSent || !hasConsent()) return
  vitalsSent = true
  const nav = performance.getEntriesByType?.('navigation')?.[0]
  track('web_vitals', {
    ...vitals,
    cls: vitals.cls === undefined ? undefined : Math.round(vitals.cls * 1000) / 1000,
    ttfbMs: nav?.responseStart,
    domContentLoadedMs: nav?.domContentLoadedEventEnd || undefined,
    loadMs: nav?.loadEventEnd || undefined,
    navigationType: nav?.type,
  })
}

/* ── API calls to our backend (wraps window.fetch once) ── */

function wrapFetch() {
  const originalFetch = window.fetch
  if (!originalFetch || originalFetch.__flAnalytics) return
  const wrapped = function analyticsFetch(input, init) {
    const startedAt = performance.now()
    const promise = originalFetch.apply(this, arguments)
    let url
    try {
      url = new URL(typeof input === 'string' ? input : input?.url || String(input), window.location.href)
    } catch {
      return promise
    }
    const backend = new URL(getBackendBaseUrl(), window.location.href)
    if (url.origin !== backend.origin || !url.pathname.startsWith('/api/') || url.pathname.startsWith('/api/ux-events')) {
      return promise
    }
    const method = String(init?.method || input?.method || 'GET').toUpperCase()
    const endpoint = normalizePath(url.pathname)
    promise.then((response) => {
      const durationMs = performance.now() - startedAt
      // 401s are part of the normal token refresh flow.
      if (!response.ok && response.status !== 401) {
        track('api_request_failed', { endpoint, method, status: response.status, durationMs })
      } else if (durationMs > SLOW_API_MS) {
        track('api_request_slow', { endpoint, method, status: response.status, durationMs })
      }
    }, (error) => {
      if (error?.name === 'AbortError') return
      track('api_request_failed', { endpoint, method, status: 0, durationMs: performance.now() - startedAt })
    })
    return promise
  }
  wrapped.__flAnalytics = true
  window.fetch = wrapped
}

/* ── Install ── */

export function installAutocapture() {
  if (installed || typeof window === 'undefined') return
  installed = true

  document.addEventListener('click', onClick, true)
  document.addEventListener('focusin', onFocusIn, true)
  document.addEventListener('change', onChange, true)
  document.addEventListener('submit', onSubmit, true)
  document.addEventListener('copy', onCopy, true)
  document.addEventListener('scroll', onScroll, { capture: true, passive: true })
  document.addEventListener('keydown', () => markActivity(), true)
  document.addEventListener('pointermove', () => markActivity(), { passive: true })

  window.addEventListener('error', (event) => {
    // Resource load failures (img/script) have no message; skip them.
    if (!event.message) return
    reportError('error', event.message, event.filename, event.lineno, event.colno)
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    reportError('unhandledrejection', reason?.message || String(reason || ''))
  })
  window.addEventListener('online', () => track('network_status_changed', { online: true }))
  window.addEventListener('offline', () => track('network_status_changed', { online: false }))

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      sendVitals()
      flushOnExit()
    } else {
      resumePage(window.location.pathname)
    }
  })
  window.addEventListener('pagehide', () => {
    sendVitals()
    flushOnExit()
  })

  observeVitals()
  wrapFetch()
}

/** Reset per-page state; called on route changes. */
export function resetPageCapture() {
  focusedFields = new WeakSet()
}
