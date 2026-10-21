import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { attachInterviewLiveSocket } from '../src/live/interviewLiveSocket.js'

async function waitFor(predicate) {
  const deadline = Date.now() + 2000
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5))
  assert.ok(predicate(), 'expected socket event within 2 seconds')
}

async function fixture(t, overrides = {}) {
  const logs = []
  const received = []
  const sent = []
  let callbacks
  let closeCount = 0
  const server = http.createServer()
  const wss = attachInterviewLiveSocket(server, { services: {
    verifyToken: async () => ({ id: 'owner' }),
    userDb: () => ({}), expireIfDue: async () => {},
    loadSession: async () => ({
      stateVersion: 4, transcript: [], interview: { status: 'active' },
      checkpoint: { config: { mode: 'practice', language: 'English' } },
    }),
    connectLive: async options => {
      callbacks = options.callbacks
      assert.deepEqual(options.config.contextWindowCompression, { slidingWindow: {} })
      return { sendRealtimeInput: message => received.push(message), close: () => { closeCount++ } }
    },
    diagnostics: { log: (level, event, fields) => logs.push({ level, event, ...fields }) },
    ...overrides,
  } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/api/chat/live`)
  socket.on('message', raw => sent.push(JSON.parse(raw)))
  await once(socket, 'open')
  t.after(async () => {
    const closed = socket.readyState === WebSocket.CLOSED ? Promise.resolve() : once(socket, 'close')
    socket.close()
    await closed
    await new Promise(resolve => wss.close(resolve))
    await new Promise(resolve => server.close(resolve))
  })
  socket.send(JSON.stringify({ type: 'start', token: 'secret-token', config: { interviewId: 'interview-1' } }))
  await once(socket, 'message')
  return { socket, logs, received, sent, callbacks: () => callbacks, closeCount: () => closeCount }
}

test('upstream normal closure closes browser transport and records correlated close details', async t => {
  const f = await fixture(t)
  const closed = once(f.socket, 'close')
  f.callbacks().onclose({ code: 1000, reason: 'Session expired', wasClean: true })
  const [code] = await closed
  assert.equal(code, 1012)
  assert.equal(f.sent.at(-1).type, 'closed')
  const log = f.logs.find(x => x.event === 'live_upstream_closed')
  assert.equal(log.closeCode, 1000)
  assert.equal(log.closeReason, 'Session expired')
  assert.equal(log.initiatedBy, 'upstream')
  assert.equal(log.interviewId, 'interview-1')
  assert.equal(log.userId, 'owner')
  assert.equal(log.connectionId, f.sent[0].connectionId)
})

test('records GoAway even without serverContent, and counts traffic without logging audio or text', async t => {
  const f = await fixture(t)
  f.callbacks().onmessage({ goAway: { timeLeft: '30s' } })
  f.socket.send(Buffer.alloc(320))
  await waitFor(() => f.received.length)
  f.socket.send(JSON.stringify({ type: 'text', text: '[PRACTICE_CONTROL] Private question' }))
  await waitFor(() => f.received.length >= 2)
  f.callbacks().onmessage({ serverContent: {
    inputTranscription: { text: 'Private answer' },
    outputTranscription: { text: 'Private question' },
    modelTurn: { parts: [{ inlineData: { data: 'c2VjcmV0', mimeType: 'audio/pcm;rate=24000' } }] },
    turnComplete: true,
  } })
  const goAway = f.logs.find(x => x.event === 'live_upstream_go_away')
  assert.equal(goAway.timeLeft, '30s')
  const turn = f.logs.find(x => x.event === 'live_turn_complete')
  assert.equal(turn.inputAudioBytes, 320)
  assert.equal(turn.outputAudioChunks, 1)
  assert.equal(turn.completedTurns, 1)
  assert.doesNotMatch(JSON.stringify(f.logs), /Private answer|Private question|c2VjcmV0|secret-token/)
})

test('upstream errors redact request URLs, notify client with specific code and close transport', async t => {
  const f = await fixture(t)
  const closed = once(f.socket, 'close')
  f.callbacks().onerror({ message: 'wss://example.com?key=secret-api-key' })
  await closed
  assert.equal(f.sent.at(-1).code, 'LIVE_UPSTREAM_ERROR')
  assert.equal(f.closeCount(), 1)
  assert.doesNotMatch(JSON.stringify(f.logs), /secret-api-key|wss:/)
})

test('finishing interview closes upstream without marking an upstream failure', async t => {
  const f = await fixture(t)
  const closed = once(f.socket, 'close')
  f.socket.close(1000, 'Interview ended')
  await closed
  await waitFor(() => f.logs.some(x => x.event === 'live_browser_closed'))
  f.callbacks().onclose({ code: 1000, reason: 'Closed' })
  const log = f.logs.find(x => x.event === 'live_upstream_closed')
  assert.equal(log.initiatedBy, 'server')
  assert.equal(log.level, 'info')
  assert.equal(f.closeCount(), 1)
})

test('closed during setup never reports ready or leaves a late upstream connection open', async t => {
  const logs = []
  let closeCount = 0
  let finishConnect
  let startConnect
  const connecting = new Promise(resolve => { startConnect = resolve })
  const server = http.createServer()
  const wss = attachInterviewLiveSocket(server, { services: {
    verifyToken: async () => ({ id: 'owner' }), userDb: () => ({}), expireIfDue: async () => {},
    loadSession: async () => ({ stateVersion: 0, transcript: [], interview: { status: 'active' }, checkpoint: { config: { mode: 'practice' } } }),
    connectLive: () => { startConnect(); return new Promise(resolve => { finishConnect = resolve }) },
    diagnostics: { log: (_, event) => logs.push(event) },
  } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await new Promise(resolve => wss.close(resolve))
    await new Promise(resolve => server.close(resolve))
  })
  const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/api/chat/live`)
  await once(socket, 'open')
  socket.send(JSON.stringify({ type: 'start', token: 'token', config: { interviewId: 'interview-1' } }))
  await connecting
  socket.close()
  await once(socket, 'close')
  finishConnect({ close: () => { closeCount++ } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(closeCount, 1)
  assert.equal(logs.includes('live_ready'), false)
})

test('practice Live gets a compact read-aloud prompt without resume, job description or history', async t => {
  let systemInstruction = ''
  await fixture(t, {
    loadSession: async () => ({
      stateVersion: 1, transcript: [{ role: 'assistant', content: 'EARLIER-QUESTION' }], interview: { status: 'active' },
      checkpoint: { config: { mode: 'practice', language: 'Chinese', jobDescription: 'JD-TEXT', resumeSnapshot: 'RESUME-TEXT' } },
    }),
    connectLive: async options => {
      systemInstruction = options.config.systemInstruction
      return { sendRealtimeInput: () => {}, close: () => {} }
    },
  })
  assert.match(systemInstruction, /PRACTICE CONTROL MODE/)
  assert.match(systemInstruction, /Speak entirely in Mandarin Chinese/)
  assert.doesNotMatch(systemInstruction, /JD-TEXT|RESUME-TEXT|EARLIER-QUESTION/)
})
