import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_GEMINI_FALLBACK_MODELS, getGeminiFallbackModels, invokeWithGeminiQuotaFallback, isGeminiRetryableError } from '../src/lib/geminiFallback.js'

const apiError = status => Object.assign(new Error(`API ${status}`), { status })

test('practice model can fail over through several distinct models', async () => {
  const calls = [], attempts = [], transitions = []
  const result = await invokeWithGeminiQuotaFallback('gemini-3.5-flash-lite', async model => {
    calls.push(model)
    if (calls.length === 1) throw apiError(429)
    if (calls.length === 2) throw apiError(503)
    return 'recovered'
  }, {
    fallbackModels: ['gemini-3.5-flash-lite', 'backup-a', 'backup-a', 'backup-b'],
    onModelAttempt: info => attempts.push(info),
    onFallback: info => transitions.push([info.fromModel, info.toModel]),
  })
  assert.equal(result, 'recovered')
  assert.deepEqual(calls, ['gemini-3.5-flash-lite', 'backup-a', 'backup-b'])
  assert.deepEqual(attempts.map(x => [x.attempt, x.fallback]), [[1, false], [2, true], [3, true]])
  assert.deepEqual(transitions, [['gemini-3.5-flash-lite', 'backup-a'], ['backup-a', 'backup-b']])
})

test('bad requests and invalid credentials do not fan out to other models', async () => {
  for (const status of [400, 401, 402, 403]) {
    let calls = 0
    const error = apiError(status)
    await assert.rejects(invokeWithGeminiQuotaFallback('primary', async () => {
      calls++; throw error
    }, { fallbackModels: ['backup'] }), e => e === error)
    assert.equal(calls, 1)
  }
})

test('practice can traverse all verified alternatives and reach the report model last', async () => {
  const calls = []
  const result = await invokeWithGeminiQuotaFallback('gemini-3.5-flash-lite', async model => {
    calls.push(model)
    if (model !== 'gemini-3.7-flash') throw apiError(429)
    return 'recovered'
  }, { fallbackModels: DEFAULT_GEMINI_FALLBACK_MODELS })
  assert.equal(result, 'recovered')
  assert.deepEqual(calls, [
    'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite',
    'gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash',
  ])
})

test('retired model, per-model timeout and network failure can fall through', () => {
  assert.equal(isGeminiRetryableError(apiError(404)), true)
  assert.equal(isGeminiRetryableError({ code: 'GEMINI_MODEL_TIMEOUT' }), true)
  assert.equal(isGeminiRetryableError(new Error('wrapped', { cause: { code: 'ECONNRESET' } })), true)
  assert.equal(isGeminiRetryableError({ code: 'GEMINI_TIMEOUT' }), false)
})

test('chain exhaustion preserves the last provider error, and empty chain makes one attempt', async () => {
  const calls = [], last = apiError(503)
  await assert.rejects(invokeWithGeminiQuotaFallback('primary', async model => {
    calls.push(model); throw model === 'backup' ? last : apiError(429)
  }, { fallbackModels: ['backup'] }), e => e === last)
  assert.deepEqual(calls, ['primary', 'backup'])
  let count = 0
  await assert.rejects(invokeWithGeminiQuotaFallback('primary', async () => {
    count++; throw last
  }, { fallbackModels: [] }), e => e === last)
  assert.equal(count, 1)
})

test('total deadline cancellation prevents late failures starting another request', async () => {
  const controller = new AbortController()
  const deadline = new Error('total deadline')
  let calls = 0
  await assert.rejects(invokeWithGeminiQuotaFallback('primary', async () => {
    calls++; controller.abort(deadline); throw apiError(429)
  }, { signal: controller.signal, fallbackModels: ['backup'] }), e => e === deadline)
  assert.equal(calls, 1)
})

test('ordered env list is trimmed and deduplicated; empty list disables fallback', () => {
  const old = process.env.GEMINI_FALLBACK_MODELS
  try {
    process.env.GEMINI_FALLBACK_MODELS = ' first, second,first, ,third '
    assert.deepEqual(getGeminiFallbackModels(), ['first', 'second', 'third'])
    process.env.GEMINI_FALLBACK_MODELS = ''
    assert.deepEqual(getGeminiFallbackModels(), [])
  } finally {
    if (old === undefined) delete process.env.GEMINI_FALLBACK_MODELS
    else process.env.GEMINI_FALLBACK_MODELS = old
  }
})
