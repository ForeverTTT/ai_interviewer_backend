import { normalizeInterviewerType } from '../config/interviewerTypes.js'
import {
  claimInterviewRequest, commitInterviewTurn, InterviewSessionConflictError,
  loadInterviewSession, releaseInterviewRequest, sanitizeMessages,
} from './interviewSessionStore.js'
import { applyInterviewAction, completeFormalAnswerAfterDeadline } from './interviewLearning.js'

// Reload before each mutation: autosave, another connection, or the deadline
// handler may have advanced the version since this WebSocket was opened.
export async function persistLiveTurn(db, {
  interviewId, userId, requestKey, inputText, outputText, onDiagnostic = () => {},
}, dependencies = {}) {
  const load = dependencies.load || loadInterviewSession
  const claim = dependencies.claim || claimInterviewRequest
  const release = dependencies.release || releaseInterviewRequest
  const commit = dependencies.commit || commitInterviewTurn
  const action = dependencies.action || applyInterviewAction
  const deadlineAnswer = dependencies.deadlineAnswer || completeFormalAnswerAfterDeadline
  const owner = { interviewId, userId }

  async function stage(name, key, mutate) {
    const args = { ...owner, idempotencyKey: key }
    const claimed = await claim(db, args)
    if (claimed?.replay) return claimed
    if (!claimed?.claimed) throw Object.assign(new Error('Live turn is already being saved'), { code: 'LIVE_PERSIST_PENDING', stage: name })
    try {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const latest = await load(db, interviewId, userId)
        if (!['active', 'draft'].includes(latest.interview.status)) {
          throw Object.assign(new Error(`Interview is ${latest.interview.status}`), { code: 'LIVE_INTERVIEW_LOCKED', stage: name })
        }
        try {
          return await mutate(latest, args)
        } catch (error) {
          if (!(error instanceof InterviewSessionConflictError)) throw error
          onDiagnostic('live_persist_conflict', {
            stage: name, attempt, expectedVersion: latest.stateVersion, currentVersion: error.currentVersion,
          })
          if (attempt === 3) throw error
        }
      }
    } catch (error) {
      error.stage ||= name
      await release(db, args).catch(() => {})
      throw error
    }
  }

  const initial = await load(db, interviewId, userId)
  const questionId = initial.interview.current_question_id
  const deadlineAt = initial.checkpoint.config?.deadlineAt
  if (initial.checkpoint.config?.mode === 'formal' && deadlineAt && new Date(deadlineAt).getTime() <= Date.now()) {
    if (questionId && inputText) {
      const result = await deadlineAnswer(db, { ...owner, idempotencyKey: `${requestKey}:deadline-answer`, answerText: inputText })
      return { ...result, deadlineComplete: true }
    }
    return { deadlineComplete: true }
  }

  if (questionId && inputText) {
    await stage('answer', `${requestKey}:answer`, (latest, args) => action(db, {
      ...args, expectedVersion: latest.stateVersion, action: 'attempt',
      payload: { questionId, answerText: inputText },
    }))
  }
  const messages = sanitizeMessages([
    { role: 'user', content: inputText }, { role: 'assistant', content: outputText },
  ])
  await stage('transcript', requestKey, (latest, args) => commit(db, {
    ...args, expectedVersion: latest.stateVersion,
    checkpoint: { ...latest.checkpoint, phase: 'questioning', liveTurnCount: (latest.checkpoint.liveTurnCount ?? 0) + 1 },
    messages, transcript: [...latest.transcript, ...messages],
  }))
  if (outputText) {
    await stage('question', `${requestKey}:question`, (latest, args) => {
      const type = normalizeInterviewerType(latest.checkpoint.config?.interviewerType)
      return action(db, {
        ...args, expectedVersion: latest.stateVersion, action: 'question',
        payload: {
          questionText: outputText, questionType: type === 'hr' ? 'behavioral' : type === 'technical' ? 'technical' : 'experience',
          competency: 'live_interview', source: 'gemini_live', difficulty: latest.interview.current_difficulty,
        },
      })
    })
  }
  return { stateVersion: (await load(db, interviewId, userId)).stateVersion }
}
