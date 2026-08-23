import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getInterviewerStylePrompt,
  getInterviewerVoice,
  getTtsDeliveryPrompt,
  normalizeInterviewerStyle,
} from '../src/config/interviewerStyles.js'

test('normalizes unknown interviewer styles to balanced', () => {
  assert.equal(normalizeInterviewerStyle('demanding'), 'demanding')
  assert.equal(normalizeInterviewerStyle('unknown'), 'balanced')
  assert.equal(normalizeInterviewerStyle(undefined), 'balanced')
})

test('demanding style keeps explicit professional safety boundaries', () => {
  const prompt = getInterviewerStylePrompt('demanding')
  assert.match(prompt, /firm, and direct/i)
  assert.match(prompt, /never insult, mock, shame/i)
})

test('supportive style requests a slightly slower but fluent delivery', () => {
  const stylePrompt = getInterviewerStylePrompt('supportive')
  const chineseTtsPrompt = getTtsDeliveryPrompt('supportive', 'Chinese')
  assert.match(stylePrompt, /about 0\.9x/i)
  assert.match(stylePrompt, /never sound drawn out/i)
  assert.match(chineseTtsPrompt, /约 0\.9 倍/)
  assert.match(chineseTtsPrompt, /不要拖长尾音或显得迟缓/)
})

test('style and language select a deterministic recommended voice', () => {
  assert.equal(getInterviewerVoice('balanced', 'Chinese'), 'Achird')
  assert.equal(getInterviewerVoice('supportive', 'Chinese'), 'Sulafat')
  assert.equal(getInterviewerVoice('demanding', 'Chinese'), 'Kore')
  assert.equal(getInterviewerVoice('analytical', 'Chinese'), 'Sadaltager')
})
