import test from 'node:test'
import assert from 'node:assert/strict'
import { FINALIZE_LOCK_MS, reportGenerationPolicy } from '../src/lib/interviewFinalize.js'

test('report allows 30 seconds per model inside a 90 second budget and preserves the finalize lease', () => {
  const policy = reportGenerationPolicy({})
  assert.equal(policy.attemptTimeoutMs, 30_000)
  assert.equal(policy.timeoutMs, 90_000)
  assert.equal(FINALIZE_LOCK_MS - policy.timeoutMs, 30_000)
  assert.deepEqual(policy.fallbackModels, ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'])
  assert.equal(policy.retryDelayBaseMs, 1000)
})

test('generic practice settings cannot silently shorten report attempts', () => {
  const policy = reportGenerationPolicy({ GEMINI_MODEL_TIMEOUT_MS: '12000', GEMINI_FALLBACK_MODELS: 'slow-model' })
  assert.equal(policy.attemptTimeoutMs, 30_000)
  assert.equal(policy.fallbackModels[0], 'gemini-3.1-flash-lite')
})

test('report overrides remain bounded by the lease and an explicitly empty list disables fallback', () => {
  const policy = reportGenerationPolicy({
    GEMINI_REPORT_TIMEOUT_MS: '180000', GEMINI_REPORT_MODEL_TIMEOUT_MS: '120000', GEMINI_REPORT_FALLBACK_MODELS: '',
  })
  assert.equal(policy.timeoutMs, 90_000)
  assert.equal(policy.attemptTimeoutMs, 90_000)
  assert.deepEqual(policy.fallbackModels, [])
  assert.deepEqual(reportGenerationPolicy({ GEMINI_REPORT_FALLBACK_MODELS: ' a, b,a, ' }).fallbackModels, ['a', 'b'])
})
