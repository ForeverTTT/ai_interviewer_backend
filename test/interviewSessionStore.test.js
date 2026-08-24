import test from 'node:test'
import assert from 'node:assert/strict'
import {
  claimInterviewRequest,
  checkpointFromGraphState,
  commitInterviewTurn,
  InterviewSessionConflictError,
  loadInterviewSession,
  nextCheckpoint,
} from '../src/lib/interviewSessionStore.js'

const USER_ID = '00000000-0000-0000-0000-000000000001'
const INTERVIEW_A = '10000000-0000-0000-0000-000000000001'
const INTERVIEW_B = '20000000-0000-0000-0000-000000000002'

function interview(id, position) {
  return {
    id,
    user_id: USER_ID,
    position,
    job_description: `${position} legacy JD`,
    job_description_snapshot: `${position} snapshot`,
    language: 'English',
    duration: 10,
    resume_snapshot: `${position} resume`,
    interviewer_style: 'balanced',
    mode: 'formal',
    difficulty: 'medium',
    status: 'active',
    graph_state_json: {},
    state_version: 0,
    transcript_json: [],
  }
}

class FakeDb {
  constructor(state) {
    this.state = state
  }

  from(table) {
    assert.equal(table, 'interviews')
    const filters = {}
    const query = {
      select: () => query,
      eq: (field, value) => {
        filters[field] = value
        return query
      },
      maybeSingle: async () => {
        const row = this.state.interviews.get(filters.id)
        return {
          data: row?.user_id === filters.user_id ? structuredClone(row) : null,
          error: null,
        }
      },
    }
    return query
  }

  async rpc(name, args) {
    const row = this.state.interviews.get(args.p_interview_id)
    if (!row || row.user_id !== args.p_user_id) return { data: null, error: { code: 'P0002' } }
    const requestKey = `${args.p_interview_id}:${args.p_idempotency_key}`

    if (name === 'claim_interview_request') {
      const existing = this.state.requests.get(requestKey)
      if (!existing) {
        this.state.requests.set(requestKey, { pending: true })
        return { data: { claimed: true }, error: null }
      }
      return existing.pending
        ? { data: { claimed: false, pending: true }, error: null }
        : { data: { ...existing, claimed: false, replay: true }, error: null }
    }

    if (name === 'release_interview_request') {
      if (this.state.requests.get(requestKey)?.pending) this.state.requests.delete(requestKey)
      return { data: null, error: null }
    }

    assert.equal(name, 'commit_interview_turn')
    const existing = this.state.requests.get(requestKey)
    if (existing && !existing.pending) return { data: { ...existing, replay: true }, error: null }
    if (row.state_version !== args.p_expected_version) {
      return {
        data: { conflict: true, currentVersion: row.state_version },
        error: null,
      }
    }
    row.graph_state_json = structuredClone(args.p_graph_state)
    row.transcript_json = structuredClone(args.p_transcript ?? row.transcript_json)
    row.state_version += 1
    const result = {
      ok: true,
      conflict: false,
      replay: false,
      stateVersion: row.state_version,
      ...(args.p_response || {}),
    }
    this.state.requests.set(requestKey, result)
    this.state.messages.push(...args.p_messages.map(message => ({ interviewId: row.id, ...message })))
    return { data: result, error: null }
  }
}

function fixture() {
  const state = {
    interviews: new Map([
      [INTERVIEW_A, interview(INTERVIEW_A, 'Backend Engineer')],
      [INTERVIEW_B, interview(INTERVIEW_B, 'Data Analyst')],
    ]),
    requests: new Map(),
    messages: [],
  }
  return { state, db: new FakeDb(state) }
}

test('two interviews owned by one user remain completely isolated', async () => {
  const { state, db } = fixture()
  const a = await loadInterviewSession(db, INTERVIEW_A, USER_ID)
  const b = await loadInterviewSession(db, INTERVIEW_B, USER_ID)
  assert.equal(a.checkpoint.config.position, 'Backend Engineer')
  assert.equal(b.checkpoint.config.position, 'Data Analyst')

  await claimInterviewRequest(db, { interviewId: INTERVIEW_A, userId: USER_ID, idempotencyKey: 'turn-a' })
  await commitInterviewTurn(db, {
    interviewId: INTERVIEW_A,
    userId: USER_ID,
    expectedVersion: a.stateVersion,
    idempotencyKey: 'turn-a',
    checkpoint: nextCheckpoint(a.checkpoint, 'generate_opening'),
    messages: [{ role: 'assistant', content: 'Welcome A' }],
    transcript: [{ role: 'assistant', content: 'Welcome A' }],
  })

  assert.equal(state.interviews.get(INTERVIEW_A).state_version, 1)
  assert.equal(state.interviews.get(INTERVIEW_B).state_version, 0)
  assert.deepEqual(state.interviews.get(INTERVIEW_B).transcript_json, [])
})

test('a fresh store instance restores checkpoint and transcript after restart', async () => {
  const { state, db } = fixture()
  const loaded = await loadInterviewSession(db, INTERVIEW_A, USER_ID)
  await claimInterviewRequest(db, { interviewId: INTERVIEW_A, userId: USER_ID, idempotencyKey: 'restore-turn' })
  await commitInterviewTurn(db, {
    interviewId: INTERVIEW_A,
    userId: USER_ID,
    expectedVersion: 0,
    idempotencyKey: 'restore-turn',
    checkpoint: nextCheckpoint(loaded.checkpoint, 'ask_technical'),
    transcript: [{ role: 'user', content: 'My answer' }],
  })

  const afterRestart = await loadInterviewSession(new FakeDb(state), INTERVIEW_A, USER_ID)
  assert.equal(afterRestart.stateVersion, 1)
  assert.equal(afterRestart.checkpoint.technicalCount, 1)
  assert.equal(afterRestart.transcript[0].content, 'My answer')
})

test('optimistic locking rejects a stale concurrent turn', async () => {
  const { db } = fixture()
  const first = await loadInterviewSession(db, INTERVIEW_A, USER_ID)
  const second = await loadInterviewSession(db, INTERVIEW_A, USER_ID)
  await claimInterviewRequest(db, { interviewId: INTERVIEW_A, userId: USER_ID, idempotencyKey: 'concurrent-1' })
  await claimInterviewRequest(db, { interviewId: INTERVIEW_A, userId: USER_ID, idempotencyKey: 'concurrent-2' })

  await commitInterviewTurn(db, {
    interviewId: INTERVIEW_A,
    userId: USER_ID,
    expectedVersion: first.stateVersion,
    idempotencyKey: 'concurrent-1',
    checkpoint: nextCheckpoint(first.checkpoint, 'ask_explore'),
  })
  await assert.rejects(
    commitInterviewTurn(db, {
      interviewId: INTERVIEW_A,
      userId: USER_ID,
      expectedVersion: second.stateVersion,
      idempotencyKey: 'concurrent-2',
      checkpoint: nextCheckpoint(second.checkpoint, 'ask_behavioral'),
    }),
    InterviewSessionConflictError,
  )
})

test('an idempotency key replays the committed result without a second mutation', async () => {
  const { state, db } = fixture()
  const loaded = await loadInterviewSession(db, INTERVIEW_A, USER_ID)
  const args = {
    interviewId: INTERVIEW_A,
    userId: USER_ID,
    expectedVersion: loaded.stateVersion,
    idempotencyKey: 'same-request',
    checkpoint: nextCheckpoint(loaded.checkpoint, 'generate_opening'),
  }
  assert.deepEqual(
    await claimInterviewRequest(db, { interviewId: INTERVIEW_A, userId: USER_ID, idempotencyKey: 'same-request' }),
    { claimed: true },
  )
  await commitInterviewTurn(db, args)
  const replay = await claimInterviewRequest(db, {
    interviewId: INTERVIEW_A,
    userId: USER_ID,
    idempotencyKey: 'same-request',
  })
  assert.equal(replay.replay, true)
  assert.equal(state.interviews.get(INTERVIEW_A).state_version, 1)
})

test('full LangGraph values become a serializable checkpoint including analysis notes', () => {
  const base = {
    phase: 'questioning',
    questionCount: 1,
    technicalCount: 1,
    behavioralCount: 0,
    exploreCount: 0,
    plan: ['technical', 'behavioral'],
    planIndex: 1,
    analysisNotes: [],
    interviewerName: 'Anna',
    config: { duration: 10, currentDifficulty: 'medium' },
  }
  const checkpoint = checkpointFromGraphState(base, {
    ...base,
    questionCount: 2,
    planIndex: 2,
    analysisNotes: ['Evidence: quantified latency improvement'],
    messages: [{ complex: 'LangChain objects are intentionally excluded' }],
    rawMessages: [{ role: 'user', content: 'excluded transcript' }],
  }, 'ask_behavioral')
  assert.equal(checkpoint.questionCount, 2)
  assert.equal(checkpoint.planIndex, 2)
  assert.deepEqual(checkpoint.analysisNotes, ['Evidence: quantified latency improvement'])
  assert.equal('messages' in checkpoint, false)
  assert.equal('rawMessages' in checkpoint, false)
})
