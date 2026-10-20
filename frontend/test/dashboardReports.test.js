import test from 'node:test'
import assert from 'node:assert/strict'
import { generateDashboardReport, mayAutoGenerateReport, reportGenerationState } from '../src/lib/dashboardReports.js'

const response = (status, interview) => ({ status, ok: status >= 200 && status < 300, json: async () => ({ interview }) })
const original = { id: 'interview', mode: 'formal', status: 'active', finalize_status: 'not_started' }

test('a failed generation response replaces optimistic processing with the actual failed state', async () => {
  const values = []
  const failed = { ...original, finalize_status: 'failed' }
  await generateDashboardReport(original, {
    generate: async () => response(502), load: async () => response(200, failed), update: value => values.push(value),
  })
  assert.equal(reportGenerationState(values[0]), 'processing')
  assert.deepEqual(values.at(-1), failed)
  assert.equal(mayAutoGenerateReport(values.at(-1)), false, 'revisiting must not retry automatically')
})

test('a lost final response is reconciled to the saved report instead of marking it failed', async () => {
  const values = []
  const completed = { ...original, status: 'completed', finalize_status: 'completed', report_json: { summary: ['Report'] } }
  await generateDashboardReport(original, {
    generate: async () => { throw new Error('Lost response') },
    load: async () => response(200, completed), update: value => values.push(value),
  })
  assert.deepEqual(values.at(-1), completed)
})

test('a network error cannot leave processing permanently in the shared cache', async () => {
  const values = []
  await generateDashboardReport(original, {
    generate: async () => { throw new Error('Offline') },
    load: async () => { throw new Error('Offline') }, update: value => values.push(value),
  })
  assert.equal(values.at(-1).status, 'active')
  assert.equal(reportGenerationState(values.at(-1)), 'unknown')
  assert.equal(mayAutoGenerateReport(values.at(-1)), false)
})

test('202 reconciles to current processing and success uses the returned report', async () => {
  const values = []
  const processing = { ...original, finalize_status: 'processing', finalize_started_at: new Date().toISOString() }
  await generateDashboardReport(original, {
    generate: async () => response(202), load: async () => response(200, processing), update: value => values.push(value),
  })
  assert.deepEqual(values.at(-1), processing)
  let loads = 0
  const completed = { ...original, status: 'completed', finalize_status: 'completed' }
  await generateDashboardReport(original, {
    generate: async () => response(200, completed), load: async () => { loads++; }, update: value => values.push(value),
  })
  assert.equal(loads, 0)
  assert.deepEqual(values.at(-1), completed)
})

test('failed state wins over finalizing and expired or missing leases do not spin forever', () => {
  const now = Date.now()
  assert.equal(reportGenerationState({ status: 'finalizing', finalize_status: 'failed' }, now), 'failed')
  assert.equal(reportGenerationState({ status: 'finalizing' }, now), 'unknown')
  assert.equal(reportGenerationState({ finalize_status: 'processing', finalize_started_at: new Date(now - 121_000).toISOString() }, now), 'unknown')
  assert.equal(reportGenerationState({ finalize_status: 'processing', finalize_started_at: new Date(now).toISOString() }, now), 'processing')
})

test('an unmounted dashboard ignores late report responses', async () => {
  const values = []
  let active = true
  await generateDashboardReport(original, {
    generate: async () => { active = false; return response(200, { ...original, status: 'completed' }) },
    load: async () => assert.fail('must not load after unmount'), update: value => values.push(value), active: () => active,
  })
  assert.equal(values.length, 1)
})
