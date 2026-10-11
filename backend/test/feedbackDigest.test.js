import test from 'node:test'
import assert from 'node:assert/strict'
import { berlinDay, digestConfig, digestEmail, resendSender, runFeedbackDigest } from '../src/lib/feedbackDigest.js'

const current = new Date('2026-10-10T07:00:00Z')
const config = { recipient: 'owner@example.com', sender: 'FlowLab <feedback@example.com>', dashboardUrl: 'https://supabase.com/dashboard/project/test/editor' }
const ready = {
  status: 'ready', id: 'abbec7f8-47a1-4bc4-a2fd-1f9bef7ddf6b', digest_day: '2026-10-10',
  total_count: 3, help_count: 1, interview_count: 2, down_count: 1,
  recipient: config.recipient, sender: config.sender, dashboard_url: config.dashboardUrl,
  first_send_attempt_at: null,
}

function fakeDb({ batch = ready, begin, fail } = {}) {
  const calls = []
  return {
    calls,
    async rpc(name, params) {
      calls.push({ name, params })
      if (name === fail) return { error: { message: 'PRIVATE_SQL_ERROR' } }
      const data = {
        preview_feedback_digest: { total_count: 3, help_count: 1, interview_count: 2, down_count: 1 },
        prepare_feedback_digest: batch,
        begin_feedback_digest_attempt: begin || { ...batch, first_send_attempt_at: current.toISOString() },
        complete_feedback_digest: null,
      }[name]
      return { data, error: null }
    },
  }
}
const run = (db, send, extra = {}) => runFeedbackDigest({ db, config, send, now: () => current, dryRun: false, ...extra })

test('dry run only previews counts: no delivery or database mutation', async () => {
  const db = fakeDb()
  const result = await runFeedbackDigest({ db })
  assert.deepEqual(result, { status: 'dry_run', total_count: 3, help_count: 1, interview_count: 2, down_count: 1 })
  assert.deepEqual(db.calls, [{ name: 'preview_feedback_digest', params: undefined }])
})

test('empty and already delivered days never send', async () => {
  for (const status of ['empty', 'already_sent']) {
    const db = fakeDb({ batch: { status } })
    assert.deepEqual(await run(db, () => assert.fail('must not send')), { status })
    assert.equal(db.calls.length, 1)
  }
})

test('send uses persisted snapshot and stable idempotency key, then acknowledges delivery', async () => {
  const db = fakeDb()
  const result = await run(db, async (body, key) => {
    assert.equal(db.calls.at(-1).name, 'begin_feedback_digest_attempt')
    assert.equal(key, `feedback-digest/${ready.id}`)
    assert.deepEqual(body.to, [config.recipient])
    assert.match(body.text, /3 条尚未通知/)
    assert.match(body.text, /负面评价 1 条/)
    assert.equal(JSON.stringify(body).includes('feedback_ids'), false)
    return 'provider-email-123'
  })
  assert.deepEqual(db.calls.at(-1), {
    name: 'complete_feedback_digest', params: { p_id: ready.id, p_provider_id: 'provider-email-123' },
  })
  assert.deepEqual(result, { status: 'sent', batch_id: ready.id, total_count: 3 })
})

test('delivery failure never marks feedback delivered', async () => {
  const db = fakeDb()
  await assert.rejects(run(db, async () => { throw new Error('provider unavailable') }), /provider unavailable/)
  assert.equal(db.calls.some(call => call.name === 'complete_feedback_digest'), false)
})

test('lost acknowledgement retries the identical email and key', async () => {
  const requests = []
  const send = async (body, key) => { requests.push({ body, key }); return 'same-provider-id' }
  await assert.rejects(run(fakeDb({ fail: 'complete_feedback_digest' }), send), /database step failed/)
  await run(fakeDb(), send)
  assert.deepEqual(requests[0], requests[1])
})

test('stale uncertain delivery is blocked before sending to avoid duplicates beyond provider retention', async () => {
  const db = fakeDb({ begin: { ...ready, first_send_attempt_at: '2026-10-09T07:00:00Z' } })
  await assert.rejects(run(db, () => assert.fail('must not resend')), /needs delivery reconciliation/)
  assert.equal(db.calls.some(call => call.name === 'complete_feedback_digest'), false)
})

test('a pending batch cannot silently switch recipient or payload', async () => {
  const db = fakeDb({ batch: { ...ready, recipient: 'previous@example.com' } })
  await assert.rejects(run(db, () => assert.fail('must not send')), /settings differ/)
  assert.equal(db.calls.length, 1)
})

test('concurrent completion skips sending and invalid provider result never acknowledges', async () => {
  assert.deepEqual(await run(fakeDb({ begin: { status: 'already_sent' } }), () => assert.fail('must not send')), { status: 'already_sent' })
  const db = fakeDb()
  await assert.rejects(run(db, async () => null), /no email ID/)
  assert.equal(db.calls.some(call => call.name === 'complete_feedback_digest'), false)
})

test('Berlin calendar day handles summer time, winter time and local midnight', () => {
  for (const [date, expected] of [
    ['2026-07-01T22:30:00Z', '2026-07-02'],
    ['2026-12-01T22:30:00Z', '2026-12-01'],
    ['2026-12-01T23:30:00Z', '2026-12-02'],
    ['2026-03-29T01:00:00Z', '2026-03-29'],
    ['2026-10-25T01:00:00Z', '2026-10-25'],
  ]) assert.equal(berlinDay(new Date(date)), expected)
})

test('configuration validates addresses and links; infers the production Table Editor URL', () => {
  const env = { SUPABASE_URL: 'https://exampleproject.supabase.co', FEEDBACK_DIGEST_TO: config.recipient, FEEDBACK_DIGEST_FROM: config.sender }
  assert.equal(digestConfig(env).dashboardUrl, 'https://supabase.com/dashboard/project/exampleproject/editor')
  for (const changes of [
    { FEEDBACK_DIGEST_TO: '' }, { FEEDBACK_DIGEST_TO: 'two@example.com,other@example.com' },
    { FEEDBACK_DIGEST_FROM: 'invalid' }, { FEEDBACK_DIGEST_FROM: 'FlowLab\n<feedback@example.com>' },
    { FEEDBACK_DIGEST_DASHBOARD_URL: 'javascript:alert(1)' }, { SUPABASE_URL: 'http://127.0.0.1:54321' },
  ]) assert.throws(() => digestConfig({ ...env, ...changes }), /Configure/)
})

test('email escapes HTML and includes only summary information', () => {
  const result = digestEmail({ ...ready, dashboard_url: 'https://example.com/?a="<&b=1' })
  assert.match(result.html, /&quot;&lt;&amp;b=1/)
  assert.equal(result.html.includes(ready.id), false)
  assert.equal(result.text.includes('user_feedback'), true)
})

test('provider adapter sends authentication, JSON and idempotency; hides error response details', async () => {
  const body = digestEmail(ready)
  const send = resendSender('test-secret', async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails')
    assert.equal(options.method, 'POST')
    assert.equal(options.headers.Authorization, 'Bearer test-secret')
    assert.equal(options.headers['Idempotency-Key'], 'test-key')
    assert.deepEqual(JSON.parse(options.body), body)
    return { ok: true, json: async () => ({ id: 'email-id' }) }
  })
  assert.equal(await send(body, 'test-key'), 'email-id')
  const reject = resendSender('test-secret', async () => ({ ok: false, status: 429, json: () => assert.fail('do not echo private provider details') }))
  await assert.rejects(reject(body, 'key'), { message: 'Email provider rejected request (HTTP 429)' })
  const timeout = resendSender('test-secret', async () => { throw new Error('private connection details') })
  await assert.rejects(timeout(body, 'key'), { message: 'Email provider request failed; retry this batch within 23 hours' })
  assert.throws(() => resendSender(''), /Configure RESEND_API_KEY/)
})
