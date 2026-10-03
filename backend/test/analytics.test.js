import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ANALYTICS_SCHEMA_VERSION,
  emitAnalyticsEvent,
  topGallupDomain,
  trackServerEvent,
} from '../src/lib/analytics.js'

function captureLogs(run) {
  const lines = []
  const original = { log: console.log, warn: console.warn, error: console.error }
  const capture = (line) => lines.push(JSON.parse(line))
  console.log = capture
  console.warn = capture
  console.error = capture
  try {
    const result = run()
    return { result, lines }
  } finally {
    Object.assign(console, original)
  }
}

test('emits a registered server event with a stable top-level shape', () => {
  const req = { user: { id: 'user-1' }, requestId: 'req-1' }
  const { result, lines } = captureLogs(() => trackServerEvent(req, 'interview_started', {
    interviewId: 'iv-1',
    props: {
      mode: 'formal',
      source: 'setup',
      interviewerType: 'hr',
      difficulty: 'medium',
      language: 'English',
      durationMin: 20,
      hasJobDescription: true,
    },
  }))

  assert.equal(result, true)
  assert.equal(lines.length, 1)
  const [line] = lines
  assert.equal(line.event, 'analytics.interview_started')
  assert.equal(line.severity, 'INFO')
  assert.equal(line.schemaVersion, ANALYTICS_SCHEMA_VERSION)
  assert.equal(line.source, 'server')
  assert.equal(line.userId, 'user-1')
  assert.equal(line.requestId, 'req-1')
  assert.equal(line.interviewId, 'iv-1')
  assert.equal(line.anonymousId, null)
  assert.equal(line.sessionId, null)
  assert.equal(typeof line.props, 'string')
  assert.deepEqual(JSON.parse(line.props), {
    mode: 'formal',
    source: 'setup',
    interviewerType: 'hr',
    difficulty: 'medium',
    language: 'English',
    durationMin: 20,
    hasJobDescription: true,
  })
})

test('strips unregistered props so free text never reaches analytics', () => {
  const { lines } = captureLogs(() => trackServerEvent({ user: { id: 'user-1' } }, 'resume_tailored', {
    props: {
      hasPosition: true,
      email: 'someone@example.com',
      resumeText: 'Worked at ACME',
    },
  }))

  const props = JSON.parse(lines[0].props)
  assert.deepEqual(props, { hasPosition: true })
  assert.doesNotMatch(JSON.stringify(lines[0]), /someone@example\.com|ACME/)
})

test('drops unknown events and invalid props with a warning instead of throwing', () => {
  const unknown = captureLogs(() => trackServerEvent({}, 'made_up_event', { props: {} }))
  assert.equal(unknown.result, false)
  assert.equal(unknown.lines[0].event, 'analytics_event_rejected')
  assert.equal(unknown.lines[0].reason, 'unknown_event')

  const invalid = captureLogs(() => trackServerEvent({}, 'tokens_spent', {
    props: { feature: 'not_a_feature', amount: 100 },
  }))
  assert.equal(invalid.result, false)
  assert.equal(invalid.lines[0].reason, 'invalid_props')
  assert.ok(!invalid.lines.some((line) => line.event?.startsWith('analytics.')))
})

test('client events are not accepted until a client schema is registered', () => {
  const { result } = captureLogs(() => emitAnalyticsEvent({ source: 'client', name: 'interview_started' }))
  assert.equal(result, false)
})

test('truncates string props and prefers an explicit userId', () => {
  const { lines } = captureLogs(() => trackServerEvent({ user: { id: 'req-user' } }, 'experience_shared', {
    userId: 'explicit-user',
    props: { type: 'x'.repeat(200) },
  }))
  assert.equal(lines[0].userId, 'explicit-user')
  assert.equal(JSON.parse(lines[0].props).type.length, 50)
})

test('picks the highest Gallup domain and ignores unknown keys', () => {
  assert.equal(topGallupDomain([
    { key: 'executing', score: 40 },
    { key: 'strategic', score: 90 },
    { key: 'influencing', score: 60 },
  ]), 'strategic')
  assert.equal(topGallupDomain([{ key: 'unknown', score: 99 }]), undefined)
  assert.equal(topGallupDomain(null), undefined)
})
