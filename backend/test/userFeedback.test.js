import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import feedbackRouter from '../src/routes/feedback.js'
import { createFeedbackMessageHandler, feedbackMessageSchema } from '../src/lib/userFeedback.js'

const interviewId = '7f3a2b1c-0d4e-4f5a-8b6c-1d2e3f4a5b6c'
const base = { feedbackId: 'feedback-test-123', source: 'help', message: '  希望增加更多岗位题目  ', pagePath: '/setup' }

test('validates written feedback and optional interview experience rating', () => {
  assert.equal(feedbackMessageSchema.parse(base).message, '希望增加更多岗位题目')
  assert.equal(feedbackMessageSchema.safeParse({ ...base, source: 'interview', interviewId, message: '', rating: 'down' }).success, true)
  assert.equal(feedbackMessageSchema.safeParse({ ...base, source: 'interview', interviewId }).success, true)
  for (const body of [
    { ...base, message: '   ' },
    { ...base, message: 'x'.repeat(2001) },
    { ...base, message: '', rating: 'up' },
    { ...base, source: 'interview' },
    { ...base, source: 'interview', interviewId, message: '' },
    { ...base, interviewId: 'invalid' },
    { ...base, rating: 'meh' },
    { ...base, source: 'unknown' },
    { ...base, pagePath: '/setup?email=private@example.com' },
    { ...base, pagePath: '//external.example' },
    { ...base, feedbackId: 'bad id' },
  ]) assert.equal(feedbackMessageSchema.safeParse(body).success, false, JSON.stringify(body))
})

function fakeDb({ owner = true, readError = null, writeError = null, throws = false } = {}) {
  const writes = []
  const filters = []
  return {
    writes, filters,
    from(table) {
      if (throws) throw new Error('private database failure')
      if (table === 'user_feedback') return { insert: async row => { writes.push(row); return { error: writeError } } }
      assert.equal(table, 'interviews')
      return {
        select() { return this },
        eq(key, value) { filters.push([key, value]); return this },
        async maybeSingle() { return { data: owner ? { id: interviewId } : null, error: readError } },
      }
    },
  }
}

async function submit(body, db) {
  const response = {
    statusCode: 200,
    status(value) { this.statusCode = value; return this },
    json(value) { this.body = value; return this },
    end() { return this },
  }
  await createFeedbackMessageHandler(token => { assert.equal(token, 'verified-token'); return db })({
    body, user: { id: 'authenticated-user' }, accessToken: 'verified-token',
  }, response)
  return response
}

test('persists the authenticated identity, trims text, and ignores forged fields', async () => {
  const db = fakeDb()
  assert.equal((await submit({ ...base, userId: 'forged', user_id: 'forged' }, db)).statusCode, 204)
  assert.deepEqual(db.writes, [{
    feedback_id: base.feedbackId, user_id: 'authenticated-user', source: 'help',
    message: '希望增加更多岗位题目', rating: null, interview_id: null, page_path: '/setup',
  }])
})

test('checks interview ownership before persisting a rating', async () => {
  const db = fakeDb()
  assert.equal((await submit({ ...base, source: 'interview', interviewId, rating: 'up' }, db)).statusCode, 204)
  assert.deepEqual(db.filters, [['id', interviewId], ['user_id', 'authenticated-user']])
  assert.equal(db.writes[0].interview_id, interviewId)
  const deniedDb = fakeDb({ owner: false })
  assert.equal((await submit({ ...base, source: 'interview', interviewId }, deniedDb)).statusCode, 404)
  assert.equal(deniedDb.writes.length, 0)
})

test('rejects invalid requests before accessing storage', async () => {
  const db = fakeDb()
  assert.equal((await submit({ ...base, message: '' }, db)).statusCode, 400)
  assert.equal(db.writes.length, 0)
})

test('returns a failure on database errors without echoing private details', async () => {
  for (const options of [
    { writeError: { code: '42P01', message: 'private schema detail' } },
    { throws: true },
    { readError: { message: 'private ownership query error' } },
  ]) {
    const db = fakeDb(options)
    const response = await submit({ ...base, source: 'interview', interviewId }, db)
    assert.equal(response.statusCode, 503)
    assert.deepEqual(response.body, { error: 'Feedback temporarily unavailable' })
  }
})

test('treats duplicate id retries as success', async () => {
  const response = await submit(base, fakeDb({ writeError: { code: '23505' } }))
  assert.equal(response.statusCode, 204)
})

test('the text feedback route requires authentication', async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/feedback', feedbackRouter)
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/feedback/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(base),
    })
    assert.equal(response.status, 401)
  } finally { await new Promise(resolve => server.close(resolve)) }
})
