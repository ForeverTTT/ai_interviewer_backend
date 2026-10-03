import test from 'node:test'
import assert from 'node:assert/strict'

import { feedbackSchema } from '../src/routes/feedback.js'

const base = { feedbackId: 'f0e1d2c3-b4a5-4697-8899-aabbccddeeff', feature: 'interview_report', rating: 'up' }

test('accepts a rating with reasons that match it', () => {
  assert.equal(feedbackSchema.safeParse(base).success, true)
  assert.equal(feedbackSchema.safeParse({ ...base, reasons: ['accurate', 'clear'] }).success, true)
  assert.equal(feedbackSchema.safeParse({
    ...base,
    rating: 'down',
    reasons: ['too_generic'],
    interviewId: '7f3a2b1c-0d4e-4f5a-8b6c-1d2e3f4a5b6c',
  }).success, true)
})

test('rejects free text, mismatched reasons and unknown features', () => {
  assert.equal(feedbackSchema.safeParse({ ...base, reasons: ['the report was wrong about my job'] }).success, false)
  assert.equal(feedbackSchema.safeParse({ ...base, reasons: ['inaccurate'] }).success, false, 'down reason on an up rating')
  assert.equal(feedbackSchema.safeParse({ ...base, feature: 'landing_page' }).success, false)
  assert.equal(feedbackSchema.safeParse({ ...base, rating: 'meh' }).success, false)
  assert.equal(feedbackSchema.safeParse({ ...base, interviewId: 'not-a-uuid' }).success, false)
  assert.equal(feedbackSchema.safeParse({ ...base, feedbackId: 'bad id with spaces' }).success, false)
})
