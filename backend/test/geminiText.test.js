import test from 'node:test'
import assert from 'node:assert/strict'
import { invokeGemini } from '../src/lib/geminiText.js'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'

function fakeApiKey(t) {
  const original = process.env.GEMINI_API_KEY
  process.env.GEMINI_API_KEY = 'test-key'
  t.after(() => {
    if (original === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = original
  })
}

test('per-call model budget lets a slower successful report finish despite a shorter global budget', async t => {
  fakeApiKey(t)
  const previous = process.env.GEMINI_MODEL_TIMEOUT_MS
  process.env.GEMINI_MODEL_TIMEOUT_MS = '1000'
  t.after(() => {
    if (previous === undefined) delete process.env.GEMINI_MODEL_TIMEOUT_MS
    else process.env.GEMINI_MODEL_TIMEOUT_MS = previous
  })
  t.mock.method(ChatGoogleGenerativeAI.prototype, 'invoke', async () => {
    await new Promise(resolve => setTimeout(resolve, 1200))
    return { content: 'report completed' }
  })
  assert.equal(await invokeGemini('system', 'user', {
    model: 'test-report-model', timeoutMs: 3000, attemptTimeoutMs: 2000, fallbackModels: [],
  }), 'report completed')
})

test('total budget cancels backoff and prevents late fallback calls', async t => {
  fakeApiKey(t)
  let calls = 0
  t.mock.method(ChatGoogleGenerativeAI.prototype, 'invoke', async () => {
    calls++
    throw Object.assign(new Error('Temporarily overloaded'), { status: 503 })
  })
  await assert.rejects(invokeGemini('system', 'user', {
    model: 'test-primary', timeoutMs: 1000, attemptTimeoutMs: 2000,
    fallbackModels: ['test-backup'], retryDelayBaseMs: 4000,
  }), { code: 'GEMINI_TIMEOUT' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 1)
})

test('total timeout also bounds slow hooks, and late hook completion never starts a provider request', async () => {
  let finishHook
  const hook = new Promise(resolve => { finishHook = resolve })
  let attempts = 0
  const call = invokeGemini('test', 'test', {
    model: 'never-call-this-model', timeoutMs: 1000,
    onModelAttempt: () => { attempts++; return hook },
  })
  await assert.rejects(call, error => error.code === 'GEMINI_TIMEOUT')
  finishHook()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(attempts, 1)
  // Any unhandled late rejection also fails node:test automatically.
})
