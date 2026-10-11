import test from 'node:test'
import assert from 'node:assert/strict'
import { createDashboardStore } from '../src/lib/dashboardStore.js'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const tick = () => new Promise(resolve => setImmediate(resolve))

test('latest report renders before the slow growth overview finishes', async () => {
  const store = createDashboardStore(), overview = deferred()
  await store.load('a', { interviews: async () => [{ id: 'report' }], overview: () => overview.promise })
  assert.equal(store.get('a').hasInterviews, true)
  assert.equal(store.get('a').interviews[0].id, 'report')
  assert.equal(store.get('a').growthOverview, null)
  overview.resolve({ score: 80 }); await tick()
  assert.deepEqual(store.get('a').growthOverview, { score: 80 })
})

test('returning to dashboard retains old content during revalidation and after network error', async () => {
  const store = createDashboardStore()
  await store.load('a', { interviews: async () => [{ id: 'cached' }], overview: async () => ({}) })
  await tick()
  const next = deferred()
  const pending = store.load('a', { interviews: () => next.promise, overview: async () => ({}) })
  assert.equal(store.get('a').hasInterviews, true)
  assert.equal(store.get('a').interviews[0].id, 'cached')
  next.reject(new Error('offline')); await pending
  assert.equal(store.get('a').loadError, true)
  assert.equal(store.get('a').interviews[0].id, 'cached')
})

test('concurrent mounts share requests, but slow overview does not prevent later interview refresh', async () => {
  const store = createDashboardStore(), interviews = deferred(), overview = deferred()
  let interviewCalls = 0, overviewCalls = 0
  const loaders = {
    interviews: () => { interviewCalls++; return interviews.promise },
    overview: () => { overviewCalls++; return overview.promise },
  }
  const first = store.load('a', loaders), second = store.load('a', loaders)
  assert.equal(first, second)
  interviews.resolve([{ id: 'old' }]); await first
  await store.load('a', { ...loaders, interviews: async () => [{ id: 'new' }] })
  assert.equal(interviewCalls, 1)
  assert.equal(overviewCalls, 1)
  assert.equal(store.get('a').interviews[0].id, 'new')
  overview.resolve({}); await tick()
})

test('account data stays isolated and late responses cannot repopulate signed-out cache', async () => {
  const store = createDashboardStore(), old = deferred()
  const pending = store.load('a', { interviews: () => old.promise, overview: async () => ({ private: true }) })
  assert.deepEqual(store.get('b').interviews, [])
  store.clear()
  await store.load('b', { interviews: async () => [{ id: 'b-only' }], overview: async () => ({}) })
  old.resolve([{ id: 'a-private' }]); await pending
  store.update('a', { interviews: [{ id: 'late-mutation' }] })
  assert.deepEqual(store.get('a').interviews, [])
  assert.equal(store.get('b').interviews[0].id, 'b-only')
})

test('deletion updates cached content and subscribers see immutable snapshots', async () => {
  const store = createDashboardStore()
  await store.load('a', { interviews: async () => [{ id: 'delete-me' }], overview: async () => ({}) })
  await tick()
  const before = store.get('a')
  let changes = 0
  const unsubscribe = store.subscribe(() => changes++)
  store.update('a', { interviews: [] })
  assert.equal(changes, 1)
  assert.notEqual(before, store.get('a'))
  assert.equal(before.interviews.length, 1)
  assert.equal(store.get('a').interviews.length, 0)
  unsubscribe()
})
