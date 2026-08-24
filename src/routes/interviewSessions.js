import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabase, supabaseForUser } from '../lib/supabase.js'
import { normalizeRequestId } from '../lib/observability.js'
import { recordInterviewEvent } from '../lib/interviewEvents.js'
import {
  claimInterviewRequest,
  releaseInterviewRequest,
} from '../lib/interviewSessionStore.js'
import {
  adaptDifficulty,
  analyzePracticeAnswer,
  applyInterviewAction,
  buildCompetencyMatrix,
  generateInterviewQuestion,
  generatePracticeHint,
  limitedReconnectContext,
  loadInterviewWorkspace,
  nextHintLevel,
  practiceLimitState,
  retrieveExperienceContext,
  summarizePracticeProgress,
} from '../lib/interviewLearning.js'

const router = Router()

function dbFor(req) {
  return req.accessToken ? supabaseForUser(req.accessToken) : supabase
}

function requestKey(req) {
  return normalizeRequestId(req.body?.idempotencyKey || req.headers['idempotency-key'] || req.requestId)
}

function sendError(res, error) {
  return res.status(error.statusCode || 500).json({
    error: error.message || 'Interview session operation failed',
    code: error.code,
    currentVersion: error.currentVersion,
  })
}

function limitError(code, message) {
  const error = new Error(message)
  error.statusCode = 409
  error.code = code
  return error
}

function assertPracticeTimeAvailable(workspace) {
  if (workspace.interview.mode !== 'practice') return
  if (practiceLimitState(workspace.interview).timeLimitReached) {
    throw limitError('PRACTICE_TIME_LIMIT', 'Practice time limit reached')
  }
}

async function claimAction(db, req, interviewId) {
  const idempotencyKey = requestKey(req)
  const result = await claimInterviewRequest(db, {
    interviewId,
    userId: req.user.id,
    idempotencyKey,
  })
  return { idempotencyKey, result }
}

async function simpleAction(req, res, action, payload = req.body ?? {}, onSuccess) {
  const db = dbFor(req)
  const interviewId = req.params.id
  let idempotencyKey
  let claimed = false
  try {
    const workspace = await loadInterviewWorkspace(db, interviewId, req.user.id)
    if (['resume', 'retry'].includes(action)) assertPracticeTimeAvailable(workspace)
    const claim = await claimAction(db, req, interviewId)
    idempotencyKey = claim.idempotencyKey
    if (claim.result?.pending) return res.status(409).json({ error: 'Request is already processing' })
    if (claim.result?.replay) return res.json(claim.result)
    claimed = true
    const result = await applyInterviewAction(db, {
      interviewId,
      userId: req.user.id,
      expectedVersion: workspace.stateVersion,
      idempotencyKey,
      action,
      payload,
    })
    await onSuccess?.({ result, idempotencyKey })
    return res.json(result)
  } catch (error) {
    if (claimed) {
      await releaseInterviewRequest(db, { interviewId, userId: req.user.id, idempotencyKey }).catch(() => {})
    }
    return sendError(res, error)
  }
}

router.get('/progress/practice', requireAuth, async (req, res) => {
  const db = dbFor(req)
  try {
    const { data: interviews, error: interviewError } = await db
      .from('interviews')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('mode', 'practice')
    if (interviewError) throw interviewError
    const ids = (interviews || []).map(interview => interview.id)
    if (!ids.length) return res.json(summarizePracticeProgress([]))
    const { data, error } = await db
      .from('interview_competency_evidence')
      .select('interview_id,competency,score,created_at')
      .in('interview_id', ids)
      .order('created_at')
    if (error) throw error
    return res.json(summarizePracticeProgress(data || []))
  } catch (error) {
    return sendError(res, error)
  }
})

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const workspace = await loadInterviewWorkspace(dbFor(req), req.params.id, req.user.id)
    return res.json({
      interview: workspace.interview,
      checkpoint: workspace.checkpoint,
      stateVersion: workspace.stateVersion,
      questions: workspace.questions,
      attempts: workspace.attempts,
      hints: workspace.hints,
      notes: workspace.notes,
      transcript: workspace.transcript,
      practiceLimits: workspace.interview.mode === 'practice'
        ? practiceLimitState(workspace.interview)
        : null,
    })
  } catch (error) {
    return sendError(res, error)
  }
})

router.get('/:id/competencies', requireAuth, async (req, res) => {
  const db = dbFor(req)
  try {
    const workspace = await loadInterviewWorkspace(db, req.params.id, req.user.id)
    const { data, error } = await db
      .from('interview_competency_evidence')
      .select('id,question_id,attempt_id,competency,score,evidence_json,rubric_json,created_at')
      .eq('interview_id', req.params.id)
      .order('created_at')
    if (error) throw error
    const matrix = Array.isArray(workspace.interview.competency_matrix_json)
      && workspace.interview.competency_matrix_json.length
      ? workspace.interview.competency_matrix_json
      : buildCompetencyMatrix(
        workspace.interview.job_description_snapshot,
        workspace.interview.resume_snapshot,
      )
    return res.json({ matrix, evidence: data || [] })
  } catch (error) {
    return sendError(res, error)
  }
})

router.post('/:id/questions/next', requireAuth, async (req, res) => {
  const db = dbFor(req)
  const interviewId = req.params.id
  let idempotencyKey
  let claimed = false
  try {
    const workspace = await loadInterviewWorkspace(db, interviewId, req.user.id)
    assertPracticeTimeAvailable(workspace)
    const limits = practiceLimitState(workspace.interview)
    if (workspace.interview.mode === 'practice' && limits.questionLimitReached) {
      throw limitError('PRACTICE_QUESTION_LIMIT', 'Practice question limit reached')
    }
    if (!['active', 'draft'].includes(workspace.interview.status)) {
      return res.status(409).json({ error: `Interview is ${workspace.interview.status}` })
    }
    const current = workspace.questions.find(question => question.id === workspace.interview.current_question_id)
    if (current && !['mastered', 'skipped'].includes(current.status)) {
      return res.status(409).json({ error: 'Resolve the current question before generating another one', question: current })
    }

    const claim = await claimAction(db, req, interviewId)
    idempotencyKey = claim.idempotencyKey
    if (claim.result?.pending) return res.status(409).json({ error: 'Question generation is already processing' })
    if (claim.result?.replay) return res.json(claim.result)
    claimed = true

    const ragDocuments = await retrieveExperienceContext(db, workspace.checkpoint.config)
    const generated = await generateInterviewQuestion({
      config: workspace.checkpoint.config,
      checkpoint: workspace.checkpoint,
      priorQuestions: workspace.questions.map(question => question.question_text),
      ragDocuments,
    })
    const result = await applyInterviewAction(db, {
      interviewId,
      userId: req.user.id,
      expectedVersion: workspace.stateVersion,
      idempotencyKey,
      action: 'question',
      payload: generated,
    })
    return res.status(201).json(result)
  } catch (error) {
    if (claimed) {
      await releaseInterviewRequest(db, { interviewId, userId: req.user.id, idempotencyKey }).catch(() => {})
    }
    return sendError(res, error)
  }
})

router.post('/:id/questions/:questionId/answer', requireAuth, async (req, res) => {
  const db = dbFor(req)
  const interviewId = req.params.id
  const answerText = String(req.body?.answerText || '').trim()
  if (!answerText) return res.status(400).json({ error: 'answerText is required' })
  let idempotencyKey
  let claimed = false
  try {
    const workspace = await loadInterviewWorkspace(db, interviewId, req.user.id)
    assertPracticeTimeAvailable(workspace)
    const question = workspace.questions.find(item => item.id === req.params.questionId)
    if (!question) return res.status(404).json({ error: 'Question not found' })
    const priorAttempts = workspace.attempts.filter(attempt => attempt.question_id === question.id)
    if (workspace.interview.mode === 'practice' && priorAttempts.length > 0) {
      const latestAttempt = priorAttempts.at(-1)
      const { data: retries, error: retryError } = await db
        .from('interview_events')
        .select('created_at')
        .eq('interview_id', interviewId)
        .eq('event_type', 'answer_retried')
        .gt('created_at', latestAttempt.created_at)
        .order('created_at', { ascending: false })
        .limit(1)
      if (retryError) throw retryError
      if (!retries?.length) {
        return res.status(409).json({
          error: 'Request a retry before submitting another answer',
          code: 'RETRY_REQUIRED',
        })
      }
    }
    const claim = await claimAction(db, req, interviewId)
    idempotencyKey = claim.idempotencyKey
    if (claim.result?.pending) return res.status(409).json({ error: 'Answer is already processing' })
    if (claim.result?.replay) return res.json(claim.result)
    claimed = true

    const internalFeedback = workspace.interview.mode === 'practice' || workspace.interview.difficulty === 'adaptive'
      ? await analyzePracticeAnswer({
        config: workspace.checkpoint.config,
        question,
        attempts: priorAttempts,
        answerText,
      })
      : null
    const nextDifficulty = workspace.interview.difficulty === 'adaptive'
      ? adaptDifficulty(workspace.interview.current_difficulty, internalFeedback?.score)
      : workspace.interview.current_difficulty
    const result = await applyInterviewAction(db, {
      interviewId,
      userId: req.user.id,
      expectedVersion: workspace.stateVersion,
      idempotencyKey,
      action: 'attempt',
      payload: {
        questionId: question.id,
        answerText,
        feedback: internalFeedback,
        nextDifficulty,
      },
    })
    // Formal mode deliberately returns no intermediate feedback.
    if (workspace.interview.mode === 'formal' && result.attempt) result.attempt.feedback_json = null
    return res.status(201).json(result)
  } catch (error) {
    if (claimed) {
      await releaseInterviewRequest(db, { interviewId, userId: req.user.id, idempotencyKey }).catch(() => {})
    }
    return sendError(res, error)
  }
})

router.post('/:id/questions/:questionId/hint', requireAuth, async (req, res) => {
  const db = dbFor(req)
  const interviewId = req.params.id
  let idempotencyKey
  let claimed = false
  try {
    const workspace = await loadInterviewWorkspace(db, interviewId, req.user.id)
    if (workspace.interview.mode !== 'practice') return res.status(409).json({ error: 'Formal interviews do not allow hints' })
    assertPracticeTimeAvailable(workspace)
    const question = workspace.questions.find(item => item.id === req.params.questionId)
    if (!question) return res.status(404).json({ error: 'Question not found' })
    if (!nextHintLevel(workspace.hints.filter(item => item.question_id === question.id))) {
      return res.status(409).json({ error: 'All practice hint levels have already been used', code: 'HINTS_EXHAUSTED' })
    }
    const claim = await claimAction(db, req, interviewId)
    idempotencyKey = claim.idempotencyKey
    if (claim.result?.pending) return res.status(409).json({ error: 'Hint generation is already processing' })
    if (claim.result?.replay) return res.json(claim.result)
    claimed = true
    const hint = await generatePracticeHint({
      config: workspace.checkpoint.config,
      question,
      attempts: workspace.attempts.filter(attempt => attempt.question_id === question.id),
      existingHints: workspace.hints.filter(item => item.question_id === question.id),
    })
    const result = await applyInterviewAction(db, {
      interviewId,
      userId: req.user.id,
      expectedVersion: workspace.stateVersion,
      idempotencyKey,
      action: 'hint',
      payload: { questionId: question.id, ...hint },
    })
    return res.status(201).json(result)
  } catch (error) {
    if (claimed) {
      await releaseInterviewRequest(db, { interviewId, userId: req.user.id, idempotencyKey }).catch(() => {})
    }
    return sendError(res, error)
  }
})

router.post('/:id/pause', requireAuth, (req, res) => simpleAction(req, res, 'pause'))
router.post('/:id/resume', requireAuth, (req, res) => simpleAction(req, res, 'resume'))
router.post('/:id/reconnect', requireAuth, async (req, res) => {
  const result = await simpleAction(req, res, 'reconnect')
  if (res.headersSent) return result
  return result
})
router.post('/:id/questions/:questionId/retry', requireAuth, async (req, res) => {
  try {
    const workspace = await loadInterviewWorkspace(dbFor(req), req.params.id, req.user.id)
    if (workspace.interview.current_question_id !== req.params.questionId) {
      return res.status(409).json({ error: 'Only the current question can be retried', code: 'RETRY_NOT_CURRENT' })
    }
    if (!workspace.attempts.some(attempt => attempt.question_id === req.params.questionId)) {
      return res.status(409).json({ error: 'Submit an answer before retrying', code: 'RETRY_REQUIRES_ATTEMPT' })
    }
    return simpleAction(req, res, 'retry', { questionId: req.params.questionId })
  } catch (error) {
    return sendError(res, error)
  }
})
router.post('/:id/questions/:questionId/master', requireAuth, (req, res) => simpleAction(req, res, 'master', {
  questionId: req.params.questionId,
}))
router.post('/:id/questions/:questionId/skip', requireAuth, (req, res) => simpleAction(
  req,
  res,
  'skip',
  { questionId: req.params.questionId, reason: req.body?.reason },
  ({ idempotencyKey }) => req.body?.reason ? recordInterviewEvent({
    interviewId: req.params.id,
    userId: req.user.id,
    requestId: `${idempotencyKey}:reason`,
    eventType: 'question_skipped',
    stage: 'skip_reason',
    metadata: { reason: String(req.body.reason).slice(0, 200) },
  }) : undefined,
))
router.put('/:id/questions/:questionId/note', requireAuth, (req, res) => simpleAction(req, res, 'note', {
  questionId: req.params.questionId,
  content: String(req.body?.content || '').slice(0, 20_000),
}))

router.get('/:id/reconnect-context', requireAuth, async (req, res) => {
  try {
    const workspace = await loadInterviewWorkspace(dbFor(req), req.params.id, req.user.id)
    return res.json(limitedReconnectContext(workspace))
  } catch (error) {
    return sendError(res, error)
  }
})

export default router
