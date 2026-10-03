import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'

import uxEventsRouter, {
  MAX_EVENTS_PER_BATCH,
  classifyUserAgent,
  normalizeOccurredAt,
} from '../src/routes/uxEvents.js'

async function withServer(run) {
  const app = express()
  app.use(express.json())
  app.use('/api/ux-events', uxEventsRouter)
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
  })
  const { port } = server.address()
  const lines = []
  const original = { log: console.log, warn: console.warn }
  console.log = (line) => lines.push(JSON.parse(line))
  console.warn = (line) => lines.push(JSON.parse(line))
  try {
    await run(`http://127.0.0.1:${port}/api/ux-events`, lines)
  } finally {
    Object.assign(console, original)
    await new Promise((resolve) => server.close(resolve))
  }
}

const baseEvent = {
  anonymousId: 'anon-1',
  sessionId: 'session-1',
  occurredAt: new Date().toISOString(),
  pagePath: '/setup',
  uiLocale: 'zh',
  appVersion: 'abc123',
  utmSource: 'linkedin',
}

const post = (url, body, headers = {}) => fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
    ...headers,
  },
  body: JSON.stringify(body),
})

test('accepts an anonymous batch and logs whitelisted client events', async () => {
  await withServer(async (url, lines) => {
    const response = await post(url, {
      events: [
        { ...baseEvent, name: 'page_viewed', props: { viewport: '390x844', isLandingPage: true } },
        {
          ...baseEvent,
          name: 'element_clicked',
          userId: 'forged-user',
          props: { element: 'button', label: 'Start', section: 'main', answerText: 'my secret answer' },
        },
      ],
    })
    assert.equal(response.status, 204)

    const events = lines.filter((line) => line.event?.startsWith('analytics.'))
    assert.deepEqual(events.map((line) => line.event), ['analytics.page_viewed', 'analytics.element_clicked'])
    for (const line of events) {
      assert.equal(line.source, 'client')
      assert.equal(line.userId, null, 'user id must only come from a verified token')
      assert.equal(line.anonymousId, 'anon-1')
      assert.equal(line.pagePath, '/setup')
      assert.equal(line.utmSource, 'linkedin')
      assert.equal(line.deviceType, 'mobile')
      assert.equal(line.os, 'ios')
      assert.equal(line.browser, 'safari')
    }
    assert.deepEqual(JSON.parse(events[1].props), { element: 'button', label: 'Start', section: 'main' })
    assert.doesNotMatch(JSON.stringify(lines), /my secret answer|forged-user|iPhone OS 17_0/)
  })
})

test('drops unknown and malformed events but still answers 204', async () => {
  await withServer(async (url, lines) => {
    const response = await post(url, {
      events: [
        { ...baseEvent, name: 'interview_started', props: {} },
        { ...baseEvent, name: 'login_started', props: { provider: 'facebook' } },
        { name: 'page_viewed' },
        { ...baseEvent, name: 'network_status_changed', props: { online: false } },
      ],
    })
    assert.equal(response.status, 204)
    const events = lines.filter((line) => line.event?.startsWith('analytics.'))
    assert.deepEqual(events.map((line) => line.event), ['analytics.network_status_changed'])
    assert.ok(lines.some((line) => line.event === 'ux_events_rejected' && line.rejected === 3))
  })
})

test('rejects empty and oversized batches', async () => {
  await withServer(async (url) => {
    assert.equal((await post(url, { events: [] })).status, 400)
    const tooMany = Array.from({ length: MAX_EVENTS_PER_BATCH + 1 }, () => ({ ...baseEvent, name: 'page_viewed' }))
    assert.equal((await post(url, { events: tooMany })).status, 400)
    assert.equal((await post(url, { nope: true })).status, 400)
  })
})

test('classifies user agents coarsely', () => {
  assert.deepEqual(
    classifyUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36 Edg/128.0'),
    { deviceType: 'desktop', browser: 'edge', os: 'windows' },
  )
  assert.deepEqual(
    classifyUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36'),
    { deviceType: 'mobile', browser: 'chrome', os: 'android' },
  )
  assert.equal(classifyUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari/604.1').deviceType, 'tablet')
  assert.deepEqual(classifyUserAgent(''), { deviceType: 'desktop', browser: 'other', os: 'other' })
})

test('keeps plausible client timestamps and replaces broken ones', () => {
  const now = Date.parse('2026-10-03T12:00:00.000Z')
  assert.equal(normalizeOccurredAt('2026-10-03T11:59:00.000Z', now), '2026-10-03T11:59:00.000Z')
  assert.equal(normalizeOccurredAt('not a date', now), '2026-10-03T12:00:00.000Z')
  assert.equal(normalizeOccurredAt('2030-01-01T00:00:00.000Z', now), '2026-10-03T12:00:00.000Z')
})
