import test from 'node:test'
import assert from 'node:assert/strict'
import { persistLiveTurn } from '../src/lib/liveTurnPersistence.js'
import { InterviewSessionConflictError } from '../src/lib/interviewSessionStore.js'

function fixture() {
  const state = {
    stateVersion: 7, transcript: [{ role: 'assistant', content: 'Earlier question' }],
    checkpoint: { config: { mode: 'formal', interviewerType: 'technical' }, liveTurnCount: 2, custom: 'preserved' },
    interview: { status: 'active', current_question_id: 'q1', current_difficulty: 'medium' },
  }
  const requests = new Map()
  const calls = []
  const dependencies = {
    load: async () => structuredClone(state),
    claim: async (_, { idempotencyKey: key }) => requests.has(key)
      ? { ...requests.get(key), replay: true } : { claimed: true },
    release: async (_, args) => { calls.push(['release', args.idempotencyKey]) },
    action: async (_, args) => {
      assert.equal(args.expectedVersion, state.stateVersion)
      calls.push([args.action, args])
      if (args.action === 'attempt') state.interview.current_question_id = null
      else state.interview.current_question_id = 'q2'
      const result = { stateVersion: ++state.stateVersion }
      requests.set(args.idempotencyKey, result)
      return result
    },
    commit: async (_, args) => {
      assert.equal(args.expectedVersion, state.stateVersion)
      calls.push(['commit', args])
      state.checkpoint = args.checkpoint
      state.transcript = args.transcript
      const result = { stateVersion: ++state.stateVersion }
      requests.set(args.idempotencyKey, result)
      return result
    },
  }
  const args = { interviewId: 'interview', userId: 'owner', requestKey: 'live-turn-1', inputText: 'My answer', outputText: 'Next question?' }
  return { state, calls, dependencies, args }
}

test('uses current database version and preserves existing transcript/checkpoint', async () => {
  const { state, calls, dependencies, args } = fixture()
  const result = await persistLiveTurn({}, args, dependencies)
  assert.equal(result.stateVersion, 10)
  assert.deepEqual(calls.map(x => x[0]), ['attempt', 'commit', 'question'])
  assert.deepEqual(calls.map(x => x[1].expectedVersion), [7, 8, 9])
  assert.equal(state.transcript.length, 3)
  assert.equal(state.transcript[0].content, 'Earlier question')
  assert.equal(state.checkpoint.custom, 'preserved')
  assert.equal(state.checkpoint.liveTurnCount, 3)
})

test('reloads and retries a concurrent autosave conflict without duplicating the answer', async () => {
  const { state, calls, dependencies, args } = fixture()
  const commit = dependencies.commit
  let conflict = true
  const diagnostics = []
  dependencies.commit = async (db, value) => {
    if (conflict) {
      conflict = false
      state.stateVersion++
      state.checkpoint.custom = 'concurrent update'
      throw new InterviewSessionConflictError(state.stateVersion)
    }
    return commit(db, value)
  }
  await persistLiveTurn({}, { ...args, onDiagnostic: (event, fields) => diagnostics.push({ event, ...fields }) }, dependencies)
  assert.deepEqual(diagnostics, [{ event: 'live_persist_conflict', stage: 'transcript', attempt: 1, expectedVersion: 8, currentVersion: 9 }])
  assert.equal(calls.filter(x => x[0] === 'attempt').length, 1)
  assert.equal(state.transcript.length, 3)
  assert.equal(state.checkpoint.custom, 'concurrent update')
})

test('bounded conflict retry releases the failed claim and reports the failing stage', async () => {
  const { state, calls, dependencies, args } = fixture()
  let attempts = 0
  dependencies.commit = async () => { attempts++; throw new InterviewSessionConflictError(++state.stateVersion) }
  await assert.rejects(persistLiveTurn({}, args, dependencies), error => error.stage === 'transcript')
  assert.equal(attempts, 3)
  assert.deepEqual(calls.at(-1), ['release', args.requestKey])
})

test('idempotent replay does not append messages or submit an answer again', async () => {
  const { state, calls, dependencies, args } = fixture()
  await persistLiveTurn({}, args, dependencies)
  await persistLiveTurn({}, args, dependencies)
  assert.equal(state.transcript.length, 3)
  assert.equal(calls.filter(x => x[0] === 'attempt').length, 1)
  assert.equal(calls.filter(x => x[0] === 'question').length, 1)
})

test('never reopens a finalizing interview after a concurrent end request', async () => {
  const { state, calls, dependencies, args } = fixture()
  state.interview.status = 'finalizing'
  await assert.rejects(persistLiveTurn({}, args, dependencies), { code: 'LIVE_INTERVIEW_LOCKED' })
  assert.equal(calls.some(x => x[0] === 'commit'), false)
})

test('after the formal deadline only saves the final answer, not another question', async () => {
  const { state, calls, dependencies, args } = fixture()
  state.checkpoint.config.deadlineAt = new Date(Date.now() - 1000).toISOString()
  dependencies.deadlineAnswer = async () => ({ stateVersion: 8 })
  assert.deepEqual(await persistLiveTurn({}, args, dependencies), { stateVersion: 8, deadlineComplete: true })
  assert.equal(calls.length, 0)
})
