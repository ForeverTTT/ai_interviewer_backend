import test from 'node:test'
import assert from 'node:assert/strict'

import {
  errorSummary,
  normalizeRequestId,
} from '../src/lib/observability.js'
import {
  invokeWithGeminiQuotaFallback,
  isGeminiQuotaError,
} from '../src/lib/geminiFallback.js'

test('normalizes request IDs without accepting unsafe input', () => {
  assert.equal(normalizeRequestId('web-123:attempt.1'), 'web-123:attempt.1')
  assert.match(normalizeRequestId('bad request id'), /^[0-9a-f-]{36}$/)
})

test('redacts API keys, JWTs, and bearer tokens from stored errors', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature'
  const apiKey = `AIza${'a'.repeat(30)}`
  const summary = errorSummary(new Error(
    `authorization=Bearer secret-token key=${apiKey} token=${jwt}`,
  ))
  assert.doesNotMatch(summary.message, /secret-token/)
  assert.doesNotMatch(summary.message, /AIza/)
  assert.doesNotMatch(summary.message, /eyJ/)
})

test('recognizes quota errors and retries 3.7 Flash once with Flash-Lite', async () => {
  assert.equal(isGeminiQuotaError({ status: 429 }), true)
  assert.equal(isGeminiQuotaError({ code: 8 }), true)
  assert.equal(isGeminiQuotaError(new Error('RESOURCE_EXHAUSTED: quota exceeded')), true)
  assert.equal(isGeminiQuotaError(new Error('authentication failed')), false)

  const calls = []
  const hooks = []
  const result = await invokeWithGeminiQuotaFallback(
    'gemini-3.7-flash',
    async (model) => {
      calls.push(model)
      if (calls.length === 1) {
        const error = new Error('Too many requests')
        error.status = 429
        throw error
      }
      return 'ok'
    },
    {
      onModelAttempt: ({ model }) => hooks.push(`attempt:${model}`),
      onFallback: ({ toModel }) => hooks.push(`fallback:${toModel}`),
    },
  )

  assert.equal(result, 'ok')
  assert.deepEqual(calls, ['gemini-3.7-flash', 'gemini-3.5-flash-lite'])
  assert.deepEqual(hooks, [
    'attempt:gemini-3.7-flash',
    'fallback:gemini-3.5-flash-lite',
    'attempt:gemini-3.5-flash-lite',
  ])
})

test('does not retry non-quota failures', async () => {
  let attempts = 0
  await assert.rejects(() => invokeWithGeminiQuotaFallback(
    'gemini-3.7-flash',
    async () => {
      attempts += 1
      throw new Error('bad request')
    },
  ))
  assert.equal(attempts, 1)
})
