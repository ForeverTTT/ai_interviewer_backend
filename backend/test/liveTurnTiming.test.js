import test from 'node:test'
import assert from 'node:assert/strict'
import { createLiveTurnTimer } from '../src/lib/liveTurnTiming.js'

function clock(start = 1_000) {
  let current = start
  return {
    now: () => current,
    advance: (ms) => { current += ms },
  }
}

test('measures last input to first audio and audio to turn completion', () => {
  const c = clock()
  const timer = createLiveTurnTimer(c.now)
  timer.onInputTranscript()
  c.advance(300)
  timer.onInputTranscript()
  c.advance(900)
  timer.onOutputAudio()
  c.advance(50)
  timer.onOutputAudio()
  c.advance(2_000)
  assert.deepEqual(timer.onTurnComplete(), {
    turnIndex: 1,
    inputToFirstAudioMs: 900,
    firstAudioToTurnCompleteMs: 2_050,
  })
})

test('ignores turns without candidate input or without model audio', () => {
  const c = clock()
  const timer = createLiveTurnTimer(c.now)
  timer.onOutputAudio()
  assert.equal(timer.onTurnComplete(), null, 'greeting before any candidate speech')

  timer.onInputTranscript()
  c.advance(500)
  assert.equal(timer.onTurnComplete(), null, 'candidate spoke but the model stayed silent')
})

test('input after the model started speaking starts a new measurement', () => {
  const c = clock()
  const timer = createLiveTurnTimer(c.now)
  timer.onInputTranscript()
  c.advance(800)
  timer.onOutputAudio()
  c.advance(200)
  timer.onInputTranscript()
  c.advance(1_100)
  timer.onOutputAudio()
  c.advance(400)
  const result = timer.onTurnComplete()
  assert.equal(result.inputToFirstAudioMs, 1_100)
  assert.equal(result.turnIndex, 1)

  timer.onInputTranscript()
  c.advance(700)
  timer.onOutputAudio()
  assert.equal(timer.onTurnComplete().turnIndex, 2)
})
