import test from 'node:test'
import assert from 'node:assert/strict'
import { invokeGemini } from '../src/lib/geminiText.js'

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
