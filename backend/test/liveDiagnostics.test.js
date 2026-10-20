import test from 'node:test'
import assert from 'node:assert/strict'
import { createLiveDiagnostics, safeLiveMessage } from '../src/lib/liveDiagnostics.js'

test('diagnostic snapshots correlate audio, transcription and upstream activity without content', () => {
  const lines = []
  let time = 1000
  const diagnostics = createLiveDiagnostics(() => ({ connectionId: 'c1', interviewId: 'i1' }), {
    now: () => time, log: (level, event, fields) => lines.push({ level, event, ...fields }),
  })
  diagnostics.mark('inputAudio', 8192)
  time += 200
  diagnostics.mark('inputTranscript')
  diagnostics.mark('serverMessage')
  time += 30000
  diagnostics.emit('live_response_timeout', {}, 'warn')
  assert.equal(lines[0].inputAudioBytes, 8192)
  assert.equal(lines[0].inputAudioAgeMs, 30200)
  assert.equal(lines[0].inputTranscriptAgeMs, 30000)
  assert.equal(lines[0].outputAudioChunks, 0)
  assert.equal(lines[0].connectionId, 'c1')
  assert.equal(lines[0].interviewId, 'i1')
})

test('sanitizes URLs, keys and bearer tokens in errors and close reasons', () => {
  assert.equal(safeLiveMessage({ message: 'wss://example.com?key=secret' }, 'Connection error'), 'Connection error')
  assert.equal(safeLiveMessage({ message: 'authorization: Bearer secret' }, 'Error'), 'authorization: Bearer [REDACTED]')
  assert.equal(safeLiveMessage({ message: 'Quota exceeded' }, 'Error'), 'Quota exceeded')
  assert.equal(safeLiveMessage({ target: { url: 'secret' } }, 'Error'), 'Error')
})
