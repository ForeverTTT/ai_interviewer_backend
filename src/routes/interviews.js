import { Router } from 'express'
import { supabase, supabaseForUser } from '../lib/supabase.js'
import { requireAuth } from '../middleware/auth.js'
import { assertGeminiConfigured, invokeGemini, stripJsonFence } from '../lib/geminiText.js'
import { recordInterviewEvent } from '../lib/interviewEvents.js'
import { errorSummary, logStructured, normalizeRequestId, requestContext } from '../lib/observability.js'
import { selectFinalizeMessages, shouldReuseFinalizedInterview } from '../lib/interviewFinalize.js'
import { normalizeInterviewerStyle } from '../config/interviewerStyles.js'
import { normalizeInterviewerType, getInterviewerTypePolicy } from '../config/interviewerTypes.js'
import {
  claimInterviewRequest,
  commitInterviewTurn,
  InterviewSessionConflictError,
  loadInterviewSession,
  releaseInterviewRequest,
} from '../lib/interviewSessionStore.js'
import { buildCompetencyMatrix, expireFormalInterviewIfDue } from '../lib/interviewLearning.js'

const router = Router()

/** Get user-scoped Supabase client from the request (works with RLS). */
function dbFor(req) {
  return req.accessToken ? supabaseForUser(req.accessToken) : supabase
}

/**
 * Backup helpers — write to interviews_backup using admin client.
 * Non-blocking: failures are logged but never break the main flow.
 */
async function backupInsert(originalId, row) {
  try {
    await supabase.from('interviews_backup').insert({
      original_id: originalId,
      user_id: row.user_id,
      position: row.position,
      job_description: row.job_description ?? '',
      language: row.language,
      duration: row.duration,
      interviewer_style: row.interviewer_style ?? 'balanced',
      interviewer_type: row.interviewer_type ?? 'mixed',
      resume_snapshot: row.resume_snapshot ?? null,
      status: row.status ?? 'in_progress',
      transcript_json: row.transcript_json ?? null,
      report_json: row.report_json ?? null,
    })
  } catch (err) {
    console.error('[interviews_backup] insert failed:', err)
  }
}

async function backupUpdate(originalId, fields) {
  try {
    const {
      updated_at,
      report_markdown,
      report_ui_locale,
      finalize_status,
      finalize_attempts,
      finalize_last_error,
      finalize_last_error_stage,
      finalize_request_id,
      finalize_model,
      finalize_started_at,
      finalized_at,
      completed_at,
      accumulated_seconds,
      active_since,
      ...safeFields
    } = fields
    await supabase
      .from('interviews_backup')
      .update(safeFields)
      .eq('original_id', originalId)
  } catch (err) {
    console.error('[interviews_backup] update failed:', err)
  }
}

const REPORT_JSON_SYSTEM = `You are an expert interview coach for internships and early-career hiring in Germany and Europe.
Read the mock interview transcript and return ONE JSON object only. No markdown code fences. No text before or after the JSON.

FORMATTING RULES:
- Every field is plain UTF-8 text. The ONLY allowed markdown is **bold**: wrap key phrases in double asterisks, e.g. **STAR method** or **quantified result**.
- Use **bold** to highlight: core concepts, action verbs, missing evidence labels, example sentence openers, numbers/metrics, and the most important advice per bullet.
- Do NOT use headers (#), code fences, underscores, or any other markdown.
- Bold use target: 2 to 5 bold spans per string for analysis-heavy fields (qaReview.gaps, qaReview.howToImprove, transcriptLineReview.parse/improvements/modelAnswer). Keep readability.

JSON schema (types only):
{
  "summary": ["string", "..."],
  "strengths": ["string", "..."],
  "toImprove": [
    { "title": "string", "why": "string", "how": "string" }
  ],
  "qaReview": [
    {
      "questionIndex": 0,
      "questionSummary": "string — short topic/category label, e.g. Self-introduction and motivation",
      "questionText": "string — the interviewer's exact full question copied verbatim from the numbered transcript line",
      "yourAnswerSummary": "string — what the candidate actually said; MUST paraphrase or quote ONLY from the transcript, never invent facts",
      "referenceExample": "string — a strong example answer for this type of question (structure STAR for behavioral, clarity for technical). Do NOT claim the candidate said this; it is a model answer outline.",
      "gaps": ["string", "..."],
      "howToImprove": "string — one concrete tip to close the gap"
    }
  ],
  "transcriptLineReview": [
    {
      "index": 0,
      "parse": "string — for ASSISTANT lines: question intent / what is assessed; for USER lines: brief recap of what they actually said (only from transcript)",
      "improvements": ["string", "..."],
      "modelAnswer": "string — for USER lines: concise model / standard answer; for ASSISTANT lines: use empty string \"\""
    }
  ]
}

Content rules:
- summary: 1 to 3 short paragraphs as separate strings (overall performance, role fit).
- strengths: separate string per point; if none, one string explaining why.
- toImprove: 2 to 6 objects; each must have non-empty title, why, and how.
- qaReview: REQUIRED. Walk the transcript in order. Pair substantive interviewer turns with the candidate's reply.
  - Include at least 3 rounds and at most 10 rounds.
  - questionIndex: The exact numbered-line index of the ASSISTANT turn containing this round's question.
  - questionSummary: A concise topic/category label, not a replacement for the original question.
  - questionText: Copy the complete interviewer question verbatim from that ASSISTANT transcript line. Never paraphrase, translate, shorten, or invent it.
  - yourAnswerSummary: Concise summary of the candidate's answer.
  - referenceExample: Realistic model answer for the JD, plain text, no markdown, no bracket placeholders.
  - gaps and howToImprove: Analysis of the performance.
- transcriptLineReview: REQUIRED. Emit EXACTLY one object per numbered line index.
  - parse and improvements: Analytical recap and tips.
  - modelAnswer: For USER lines, provide a polished standard answer (not claiming they said it). For ASSISTANT lines, use "".
  - Keep fields concise (parse < 200 chars, modelAnswer < 600 chars).

ALL string values MUST be written in the "Interview language" specified in the user message. Do NOT translate analysis to any other language.`

function reportUiLanguageLine(code) {
  const c = String(code || 'en').toLowerCase()
  if (c.startsWith('zh') || c.startsWith('chinese') || c.includes('中文')) return 'LANGUAGE: Write every string value in Simplified Chinese (简体中文).'
  if (c.startsWith('de')) return 'LANGUAGE: Write every string value in German.'
  return 'LANGUAGE: Write every string value in English.'
}

function uiCodeToTargetLang(uiCode) {
  const c = String(uiCode || '').toLowerCase().trim()
  if (c.startsWith('zh') || c.startsWith('chinese') || c.includes('中文')) return 'zh-CN'
  if (c.startsWith('de')) return 'de'
  return 'en'
}

function shouldTranslateText(v) {
  const s = String(v || '').trim()
  if (!s) return false
  if (/^[\d\s.,;:!?()\-–—/\\]+$/.test(s)) return false
  return true
}

async function translateTextViaPlugin(text, targetLang) {
  const q = String(text || '').trim()
  if (!q) return ''
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(q)}`
    const r = await fetch(url)
    if (!r.ok) return q
    const data = await r.json()
    const parts = Array.isArray(data?.[0]) ? data[0].map((x) => x?.[0]).filter(Boolean) : []
    const out = parts.join('').trim()
    return out || q
  } catch {
    return q
  }
}

/**
 * Translate ONLY analysis blocks for report UI locale.
 * Keep qaReview and transcriptLineReview in original language as requested.
 */
async function translateInterviewReportToUi(payload, uiCode) {
  const targetLang = uiCodeToTargetLang(uiCode)
  const cache = new Map()
  const tr = async (v) => {
    const s = String(v || '')
    if (!shouldTranslateText(s)) return s
    const key = `${targetLang}::${s}`
    if (cache.has(key)) return cache.get(key)
    const translated = await translateTextViaPlugin(s, targetLang)
    cache.set(key, translated)
    return translated
  }

  return {
    ...payload,
    summary: await Promise.all((Array.isArray(payload?.summary) ? payload.summary : []).map(tr)),
    strengths: await Promise.all((Array.isArray(payload?.strengths) ? payload.strengths : []).map(tr)),
    toImprove: await Promise.all(
      (Array.isArray(payload?.toImprove) ? payload.toImprove : []).map(async (x) => ({
        ...x,
        title: await tr(x?.title),
        why: await tr(x?.why),
        how: await tr(x?.how),
      })),
    ),
    // Keep only original Q/A summaries unchanged in QA compare.
    qaReview: Array.isArray(payload?.qaReview)
      ? await Promise.all(payload.qaReview.map(async (x) => ({
        ...x,
        questionSummary: await tr(x?.questionSummary),
        questionText: String(x?.questionText || ''),
        yourAnswerSummary: String(x?.yourAnswerSummary || ''),
        referenceExample: String(x?.referenceExample || ''),
        gaps: await Promise.all((Array.isArray(x?.gaps) ? x.gaps : []).map(tr)),
        howToImprove: await tr(x?.howToImprove),
      })))
      : [],
    // Keep raw transcript unchanged on frontend; translate analysis fields only.
    transcriptLineReview: Array.isArray(payload?.transcriptLineReview)
      ? await Promise.all(payload.transcriptLineReview.map(async (x) => ({
        ...x,
        parse: await tr(x?.parse),
        improvements: await Promise.all((Array.isArray(x?.improvements) ? x.improvements : []).map(tr)),
        modelAnswer: String(x?.modelAnswer || ''),
      })))
      : [],
  }
}

function parseJsonObjectOrNull(raw) {
  if (!raw) return null
  if (typeof raw === 'object') return raw
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }
  return null
}

function normalizeReportJson(raw, messages = []) {
  const interviewerTurns = Array.isArray(messages)
    ? messages
      .map((message, index) => ({
        index,
        role: message?.role === 'assistant' ? 'assistant' : 'user',
        content: typeof message?.content === 'string' ? message.content.trim() : '',
      }))
      .filter((message) => message.role === 'assistant' && message.content)
    : []
  const summary = Array.isArray(raw?.summary)
    ? raw.summary.map((s) => String(s || '').trim()).filter(Boolean)
    : (raw?.summary != null && String(raw.summary).trim() ? [String(raw.summary).trim()] : [])

  const strengths = Array.isArray(raw?.strengths)
    ? raw.strengths.map((s) => String(s || '').trim()).filter(Boolean)
    : []

  const toImprove = Array.isArray(raw?.toImprove)
    ? raw.toImprove
      .map((x) => ({
        title: String(x?.title || '').trim(),
        why: String(x?.why || '').trim(),
        how: String(x?.how || x?.suggestion || x?.action || '').trim(),
      }))
      .filter((x) => x.title || x.why || x.how)
    : []

  const qaReview = Array.isArray(raw?.qaReview)
    ? raw.qaReview
      .map((x, reviewIndex) => {
        const requestedIndex = Number(x?.questionIndex)
        const indexedTurn = Number.isInteger(requestedIndex)
          ? interviewerTurns.find((turn) => turn.index === requestedIndex)
          : null
        const transcriptTurn = indexedTurn || interviewerTurns[reviewIndex] || null
        return {
          questionIndex: transcriptTurn?.index ?? (Number.isInteger(requestedIndex) ? requestedIndex : -1),
          questionSummary: String(x?.questionSummary || x?.question || '').trim(),
          questionText: transcriptTurn?.content || String(x?.questionText || x?.exactQuestion || '').trim(),
          yourAnswerSummary: String(x?.yourAnswerSummary || x?.candidateAnswer || x?.yourAnswer || '').trim(),
          referenceExample: String(x?.referenceExample || x?.referenceAnswer || '').trim(),
          gaps: Array.isArray(x?.gaps)
            ? x.gaps.map((g) => String(g || '').trim()).filter(Boolean)
            : [],
          howToImprove: String(x?.howToImprove || x?.improvementTip || '').trim(),
        }
      })
      .filter((x) => x.questionSummary || x.questionText || x.yourAnswerSummary || x.referenceExample)
      .slice(0, 12)
    : []

  const byIdx = new Map()
  if (Array.isArray(raw?.transcriptLineReview)) {
    for (const x of raw.transcriptLineReview) {
      const idx = Number(x?.index)
      if (!Number.isInteger(idx) || idx < 0) continue
      const improvements = Array.isArray(x?.improvements)
        ? x.improvements.map((g) => String(g || '').trim()).filter(Boolean)
        : []
      const parse = String(x?.parse || x?.analysis || '').trim()
      const modelAnswer = String(x?.modelAnswer || x?.referenceAnswer || x?.standardAnswer || '').trim()
      if (!parse && !improvements.length && !modelAnswer) continue
      byIdx.set(idx, { index: idx, parse, improvements, modelAnswer })
    }
  }
  const transcriptLineReview = [...byIdx.values()].sort((a, b) => a.index - b.index).slice(0, 200)

  return { summary, strengths, toImprove, qaReview, transcriptLineReview }
}

function formatMessagesForPrompt(messages) {
  if (!Array.isArray(messages)) return ''
  return messages
    .filter((m) => m && typeof m.content === 'string' && m.content.trim())
    .map((m) => `${String(m.role || 'user').toUpperCase()}: ${m.content.trim()}`)
    .join('\n\n')
}

/** 与 transcript_json 数组下标完全一致（含空条），供 transcriptLineReview.index 对齐前端 */
function formatNumberedTranscriptLines(messages) {
  if (!Array.isArray(messages)) return ''
  return messages
    .map((m, i) => {
      const role = String(m?.role || 'user').toLowerCase() === 'assistant' ? 'assistant' : 'user'
      const raw = typeof m?.content === 'string' ? m.content.trim().replace(/\n+/g, ' ') : ''
      return `${i}|${role}|${raw || '(empty)'}`
    })
    .join('\n')
}

const CLIENT_INTERVIEW_EVENTS = new Set([
  'finalize_clicked',
  'finalize_request_sent',
  'finalize_response_received',
  'finalize_client_error',
  'interview_exit',
])

const FINALIZE_LOCK_MS = 2 * 60 * 1000

function finalizedRecently(interview) {
  if (interview?.finalize_status !== 'processing') return false
  const startedAt = Date.parse(interview.finalize_started_at || '')
  return Number.isFinite(startedAt) && Date.now() - startedAt < FINALIZE_LOCK_MS
}

async function markFinalizeFailed(req, interviewId, stage, error) {
  const summary = errorSummary(error)
  const { error: updateError } = await dbFor(req)
    .from('interviews')
    .update({
      finalize_status: 'failed',
      finalize_last_error: summary.message,
      finalize_last_error_stage: stage,
    })
    .eq('id', interviewId)
    .eq('user_id', req.user.id)

  if (updateError) {
    logStructured('error', 'finalize_failure_state_save_failed', requestContext(req, {
      interviewId,
      stage,
      errorMessage: updateError.message,
    }))
  }
}

/**
 * GET /api/interviews
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const { data, error } = await dbFor(req)
      .from('interviews')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(50)
    console.log(`[Supabase DEBUG] Fetch Interviews for ${req.user.id} count: ${data?.length || 0} error: ${error?.message || 'none'}`)

    if (error) {
      console.error('[GET /interviews]', error)
      return res.status(500).json({ error: 'Failed to fetch interviews' })
    }

    return res.json({ interviews: data || [] })
  } catch (err) {
    console.error('[GET /interviews] Unexpected error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * POST /api/interviews
 */
router.post('/', requireAuth, async (req, res) => {
  const {
    position,
    job_description,
    language,
    duration,
    resume_snapshot,
    interviewer_style,
    interviewerType,
    mode = 'formal',
    difficulty = 'medium',
    role_track = 'work',
  } = req.body ?? {}

  if (!position || !language || !duration) {
    return res.status(400).json({ error: 'position, language, and duration are required' })
  }

  const normalizedMode = ['practice', 'formal'].includes(mode) ? mode : 'formal'
  const normalizedDifficulty = ['easy', 'medium', 'hard', 'adaptive'].includes(difficulty) ? difficulty : 'medium'
  const normalizedJobDescription = job_description != null ? String(job_description).trim() : ''
  const normalizedResume = resume_snapshot != null ? String(resume_snapshot).trim().slice(0, 50_000) : ''
  const idempotencyKey = normalizeRequestId(req.body?.idempotencyKey || req.headers['idempotency-key'] || req.requestId)

  try {
    const { data, error } = await dbFor(req).rpc('create_interview_session', {
      p_user_id: req.user.id,
      p_idempotency_key: idempotencyKey,
      p_position: String(position).trim(),
      p_job_description: normalizedJobDescription,
      p_language: language,
      p_duration: Number(duration),
      p_resume_snapshot: normalizedResume,
      p_interviewer_style: normalizeInterviewerStyle(interviewer_style),
      p_interviewer_type: normalizeInterviewerType(interviewerType),
      p_role_track: ['school', 'work'].includes(role_track) ? role_track : 'work',
      p_mode: normalizedMode,
      p_difficulty: normalizedDifficulty,
      p_competency_matrix: buildCompetencyMatrix(normalizedJobDescription, normalizedResume),
      p_token_cost: 300,
    })

    if (error) {
      console.error('[POST /interviews]', error)
      if (error.code === 'P0001' && /insufficient tokens/i.test(error.message || '')) {
        return res.status(403).json({ error: 'Insufficient tokens', code: 'INSUFFICIENT_TOKENS' })
      }
      const noCol = /column|does not exist|schema cache/i.test(String(error.message || error))
      return res.status(500).json({
        error: 'Failed to create interview record',
        details: error.message,
        hint: noCol
          ? 'Run supabase/migration_interviews_complete.sql in Supabase SQL Editor, wait ~1 min for schema cache.'
          : undefined,
      })
    }

    const interview = data?.interview
    if (!data?.replay) {
      backupInsert(interview.id, interview)
      await recordInterviewEvent({
        interviewId: interview.id,
        userId: req.user.id,
        requestId: idempotencyKey,
        eventType: 'session_created',
        stage: 'created',
      })
    }

    return res.status(data?.replay ? 200 : 201).json(data)
  } catch (err) {
    console.error('[POST /interviews] Unexpected error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

/** POST /api/interviews/:id/events - authenticated client lifecycle events. */
router.post('/:id/events', requireAuth, async (req, res) => {
  const { id } = req.params
  const eventType = String(req.body?.eventType || '')
  if (!CLIENT_INTERVIEW_EVENTS.has(eventType)) {
    return res.status(400).json({ error: 'Unsupported event type', requestId: req.requestId })
  }

  const { data: interview, error } = await dbFor(req)
    .from('interviews')
    .select('id')
    .eq('id', id)
    .eq('user_id', req.user.id)
    .maybeSingle()

  if (error || !interview) {
    return res.status(error ? 500 : 404).json({
      error: error ? 'Database error' : 'Interview not found',
      requestId: req.requestId,
    })
  }

  const eventRequestId = normalizeRequestId(req.body?.requestId || req.requestId)
  await recordInterviewEvent({
    interviewId: id,
    userId: req.user.id,
    requestId: eventRequestId,
    eventType,
    eventSource: 'client',
    stage: req.body?.stage,
    httpStatus: Number.isInteger(req.body?.httpStatus) ? req.body.httpStatus : undefined,
    error: req.body?.errorMessage ? new Error(String(req.body.errorMessage).slice(0, 500)) : undefined,
    messageCount: Number.isInteger(req.body?.messageCount) ? req.body.messageCount : undefined,
    metadata: req.body?.metadata,
  })

  return res.status(202).json({ ok: true, requestId: eventRequestId })
})

/** GET /api/interviews/:id/events - latest diagnostic lifecycle for the owner. */
router.get('/:id/events', requireAuth, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500)
  const db = dbFor(req)
  const [{ data, error }, { data: interview }] = await Promise.all([
    db
    .from('interview_events')
    .select('*')
    .eq('interview_id', req.params.id)
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: true })
    .limit(limit),
    db.from('interviews').select('mode,status').eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle(),
  ])

  if (error) return res.status(500).json({ error: 'Failed to load interview events', requestId: req.requestId })
  const hideFormalScores = interview?.mode === 'formal' && interview?.status !== 'completed'
  const events = hideFormalScores
    ? (data || []).map(event => ({
      ...event,
      metadata: event.metadata && typeof event.metadata === 'object'
        ? Object.fromEntries(Object.entries(event.metadata).filter(([key]) => key !== 'score'))
        : {},
    }))
    : data || []
  return res.json({ events, requestId: req.requestId })
})

/** POST /api/interviews/:id/finalize */
router.post('/:id/finalize', requireAuth, async (req, res) => {
  if (!assertGeminiConfigured(res)) return

  const { id } = req.params
  const requestMessages = req.body?.messages
  const forceRegenerate = req.body?.forceRegenerate === true
  const reportUiLanguage = req.body?.reportUiLanguage
  const finalizeStartedAt = Date.now()
  let stage = 'validation'
  let modelUsed = null
  let messages = Array.isArray(requestMessages) ? requestMessages : []

  try {
    stage = 'database_fetch'
    const { data: iv, error: fetchErr } = await dbFor(req)
      .from('interviews')
      .select('*')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .maybeSingle()

    if (fetchErr || !iv) {
      const status = fetchErr ? 500 : 404
      await recordInterviewEvent({
        interviewId: id,
        userId: req.user.id,
        requestId: req.requestId,
        eventType: 'finalize_failed',
        stage,
        httpStatus: status,
        error: fetchErr || new Error('Interview not found'),
        messageCount: messages.length,
      })
      return res.status(status).json({
        error: fetchErr ? 'Database error' : 'Interview not found',
        requestId: req.requestId,
        stage,
      })
    }

    messages = selectFinalizeMessages(requestMessages, iv.transcript_json)
    if (!messages) {
      await recordInterviewEvent({
        interviewId: id,
        userId: req.user.id,
        requestId: req.requestId,
        eventType: 'finalize_failed',
        stage: 'validation',
        httpStatus: 400,
        error: new Error('No saved interview transcript'),
        messageCount: 0,
        metadata: { forceRegenerate },
      })
      return res.status(400).json({
        error: 'No saved interview transcript',
        requestId: req.requestId,
        stage: 'validation',
        retryable: false,
      })
    }

    await recordInterviewEvent({
      interviewId: id,
      userId: req.user.id,
      requestId: req.requestId,
      eventType: 'finalize_request_received',
      stage: 'request',
      messageCount: messages.length,
      metadata: { forceRegenerate },
    })

    if (shouldReuseFinalizedInterview(iv, forceRegenerate)) {
      await recordInterviewEvent({
        interviewId: id,
        userId: req.user.id,
        requestId: req.requestId,
        eventType: 'finalize_idempotent_replay',
        stage: 'completed',
        model: iv.finalize_model,
        durationMs: Date.now() - finalizeStartedAt,
        messageCount: messages.length,
        metadata: { forceRegenerate },
      })
      return res.json({ interview: iv, requestId: req.requestId, reused: true })
    }

    if (finalizedRecently(iv)) {
      await recordInterviewEvent({
        interviewId: id,
        userId: req.user.id,
        requestId: req.requestId,
        eventType: 'finalize_already_processing',
        stage: 'processing',
        messageCount: messages.length,
      })
      return res.status(202).json({ processing: true, requestId: req.requestId })
    }

    stage = 'claim'
    const { data: claimed, error: claimError } = await dbFor(req)
      .rpc('claim_interview_finalize', {
        p_interview_id: id,
        p_request_id: req.requestId,
        p_lock_seconds: Math.round(FINALIZE_LOCK_MS / 1000),
        p_force: forceRegenerate,
      })
      .maybeSingle()

    if (claimError) throw claimError
    if (!claimed) {
      await recordInterviewEvent({
        interviewId: id,
        userId: req.user.id,
        requestId: req.requestId,
        eventType: 'finalize_already_processing',
        stage,
        messageCount: messages.length,
      })
      return res.status(202).json({ processing: true, requestId: req.requestId })
    }

    const finalizeAttempt = Number(claimed.finalize_attempts || 1)

    await recordInterviewEvent({
      interviewId: id,
      userId: req.user.id,
      requestId: req.requestId,
      eventType: 'finalize_started',
      stage,
      messageCount: messages.length,
      metadata: { attempt: finalizeAttempt, forceRegenerate },
    })

    const transcriptText = formatMessagesForPrompt(messages)
    const numberedLines = formatNumberedTranscriptLines(messages)
    let learningProgress = []
    if (iv.mode === 'practice') {
      const { data: attempts } = await dbFor(req)
        .from('interview_attempts')
        .select('question_id,attempt_number,answer_text,feedback_json,hint_level_used,created_at,interview_questions(question_text,competency,status,difficulty)')
        .eq('interview_id', id)
        .order('created_at')
      learningProgress = attempts || []
    }
    const userPayload = `LANGUAGE: Write every string value in the EXACT "Interview language" specified below. Do NOT translate any part of the report into another language.
 
 Job title: ${iv.position}
 Interview language: ${iv.language}
Interview mode: ${iv.mode || 'formal'}
Interviewer type: ${normalizeInterviewerType(iv.interviewer_type)}
Duration (minutes): ${iv.duration}
Job description (excerpt): ${String(iv.job_description || '').slice(0, 4000)}

${iv.mode === 'practice'
    ? `PRACTICE REPORT: Focus on the learning process, hint usage, first-versus-final attempt improvement, mastered/skipped questions, and concrete next practice steps. Normalized practice evidence:\n${JSON.stringify(learningProgress).slice(0, 20_000)}`
    : 'FORMAL REPORT: Produce a holistic hiring-style evaluation. Do not imply that hidden intermediate scores or coaching were shown during the interview.'}

Transcript:
${transcriptText || '(empty — candidate may not have spoken)'}

Numbered lines (index|role|text) — transcriptLineReview MUST use these indices in order, one object per line below:
${numberedLines || '(none)'}

Return the JSON object now.`

    stage = 'gemini'
    const geminiStartedAt = Date.now()
    const interviewerEvaluation = getInterviewerTypePolicy(iv.interviewer_type).evaluation
    const modeReportSystem = `${REPORT_JSON_SYSTEM}\n\nINTERVIEWER TYPE: ${normalizeInterviewerType(iv.interviewer_type)}. ${interviewerEvaluation}\n\n${iv.mode === 'practice'
      ? 'This is a PRACTICE learning report. Explicitly compare early and later attempts where evidence exists.'
      : 'This is a FORMAL simulation report. Evaluate the completed interview as a whole.'}`
    const raw = await invokeGemini(modeReportSystem, userPayload, {
      temperature: 0.3,
      maxOutputTokens: 32768,
      onModelAttempt: async ({ model, attempt, fallback }) => {
        modelUsed = model
        await recordInterviewEvent({
          interviewId: id,
          userId: req.user.id,
          requestId: req.requestId,
          eventType: fallback ? 'gemini_fallback_started' : 'gemini_started',
          stage,
          model,
          messageCount: messages.length,
          metadata: { attempt },
        })
      },
      onFallback: async ({ fromModel, toModel, error }) => {
        await recordInterviewEvent({
          interviewId: id,
          userId: req.user.id,
          requestId: req.requestId,
          eventType: 'gemini_quota_exhausted',
          stage,
          model: fromModel,
          error,
          messageCount: messages.length,
          metadata: { fallbackFrom: fromModel, fallbackTo: toModel },
        })
      },
    })

    await recordInterviewEvent({
      interviewId: id,
      userId: req.user.id,
      requestId: req.requestId,
      eventType: 'gemini_completed',
      stage,
      model: modelUsed,
      durationMs: Date.now() - geminiStartedAt,
      messageCount: messages.length,
    })

    stage = 'report_parse'
    let parsed
    try {
      parsed = JSON.parse(stripJsonFence(raw))
    } catch (e) {
      console.error('[finalize] JSON parse', e, raw?.slice?.(0, 400))
      await recordInterviewEvent({
        interviewId: id,
        userId: req.user.id,
        requestId: req.requestId,
        eventType: 'report_parse_failed',
        stage,
        model: modelUsed,
        error: e,
        messageCount: messages.length,
      })
      throw new Error('Gemini returned an invalid structured report', { cause: e })
    }

    const reportJson = normalizeReportJson(parsed, messages)
    stage = 'database_save'

    const updateRow = {
      transcript_json: messages,
      report_json: reportJson,
      report_markdown: null,
      status: 'completed',
      report_ui_locale: String(reportUiLanguage || iv.language || 'en').slice(0, 32),
      finalize_status: 'completed',
      finalize_last_error: null,
      finalize_last_error_stage: null,
      finalize_request_id: req.requestId,
      finalize_model: modelUsed,
      finalized_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }
    if (iv.mode === 'practice') {
      const activeStartedMs = iv.active_since ? new Date(iv.active_since).getTime() : NaN
      const activeSeconds = Number.isFinite(activeStartedMs)
        ? Math.max(0, Math.floor((Date.now() - activeStartedMs) / 1000))
        : 0
      updateRow.accumulated_seconds = Number(iv.accumulated_seconds || 0) + activeSeconds
      updateRow.active_since = null
    }

    let updated, upErr
    ;({ data: updated, error: upErr } = await dbFor(req)
      .from('interviews')
      .update(updateRow)
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select()
      .single())

    // If the column doesn't exist yet in the schema, retry without it so the
    // report is still saved. The migration can be applied independently.
    if (upErr && /column|does not exist|schema cache/i.test(String(upErr.message || upErr))) {
      console.warn('[finalize] report_ui_locale column missing — retrying without it. Run migration_report_ui_locale.sql in Supabase SQL Editor.')
      const { report_ui_locale: _dropped, ...updateRowFallback } = updateRow
      ;({ data: updated, error: upErr } = await dbFor(req)
        .from('interviews')
        .update(updateRowFallback)
        .eq('id', id)
        .eq('user_id', req.user.id)
        .select()
        .single())
    }

    if (upErr) {
      throw upErr
    }

    await backupUpdate(id, updateRow)

    await recordInterviewEvent({
      interviewId: id,
      userId: req.user.id,
      requestId: req.requestId,
      eventType: 'finalize_completed',
      stage: 'completed',
      model: modelUsed,
      httpStatus: 200,
      durationMs: Date.now() - finalizeStartedAt,
      messageCount: messages.length,
    })

    return res.json({ interview: updated, requestId: req.requestId })
  } catch (err) {
    const httpStatus = stage === 'gemini' ? 502 : 500
    await markFinalizeFailed(req, id, stage, err)
    await recordInterviewEvent({
      interviewId: id,
      userId: req.user.id,
      requestId: req.requestId,
      eventType: 'finalize_failed',
      stage,
      model: modelUsed,
      httpStatus,
      error: err,
      durationMs: Date.now() - finalizeStartedAt,
      messageCount: messages.length,
    })
    return res.status(httpStatus).json({
      error: 'Finalize failed',
      requestId: req.requestId,
      stage,
      retryable: ['gemini', 'report_parse', 'database_save'].includes(stage),
    })
  }
})

/**
 * POST /api/interviews/:id/transcript
 * Persist conversation during the session (autosave from client).
 */
router.post('/:id/transcript', requireAuth, async (req, res) => {
  const { id } = req.params
  const messages = req.body?.messages
  const idempotencyKey = normalizeRequestId(req.body?.idempotencyKey || req.requestId)
  const db = dbFor(req)
  let claimed = false

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' })
  }

  const sanitized = messages
    .filter((m) => m && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content).trim(),
    }))

  try {
    await expireFormalInterviewIfDue(db, id, req.user.id)
    const loaded = await loadInterviewSession(db, id, req.user.id)
    if (['finalizing', 'completed', 'abandoned'].includes(loaded.interview.status)) {
      return res.status(409).json({ error: `Interview is ${loaded.interview.status}` })
    }
    const claim = await claimInterviewRequest(db, {
      interviewId: id,
      userId: req.user.id,
      idempotencyKey,
    })
    if (claim?.pending) return res.status(409).json({ error: 'This request is already being processed' })
    if (claim?.replay) return res.json({ ok: true, replay: true, stateVersion: claim.stateVersion })
    claimed = true

    const result = await commitInterviewTurn(db, {
      interviewId: id,
      userId: req.user.id,
      expectedVersion: loaded.stateVersion,
      idempotencyKey,
      checkpoint: loaded.checkpoint,
      transcript: sanitized,
    })

    backupUpdate(id, { transcript_json: sanitized })

    return res.json({ ok: true, stateVersion: result.stateVersion })
  } catch (err) {
    console.error('[POST /transcript]', err)
    if (claimed) {
      await releaseInterviewRequest(db, {
        interviewId: id,
        userId: req.user.id,
        idempotencyKey,
      }).catch(() => {})
    }
    return res.status(err.statusCode || 500).json({
      error: err.message || 'Internal server error',
      currentVersion: err instanceof InterviewSessionConflictError ? err.currentVersion : undefined,
    })
  }
})

/**
 * GET /api/interviews/:id
 */
router.get('/:id', requireAuth, async (req, res) => {
  const { id } = req.params
  try {
    const { data, error } = await dbFor(req)
      .from('interviews')
      .select('*')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .maybeSingle()

    if (error) {
      console.error('[GET /interviews/:id]', error)
      return res.status(500).json({ error: 'Failed to load interview' })
    }
    if (!data) return res.status(404).json({ error: 'Not found' })
    return res.json({ interview: data })
  } catch (err) {
    console.error('[GET /interviews/:id]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * POST /api/interviews/:id/report/translate
 * Translate report analysis blocks to current UI language.
 * NOTE: Keeps qaReview + transcript-related content in original language.
 */
router.post('/:id/report/translate', requireAuth, async (req, res) => {
  const { id } = req.params
  const reportUiLanguage = req.body?.reportUiLanguage
  const reportInput = parseJsonObjectOrNull(req.body?.report)

  try {
    const { data: iv, error: fetchErr } = await dbFor(req)
      .from('interviews')
      .select('*')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .maybeSingle()

    if (fetchErr || !iv) {
      return res.status(fetchErr ? 500 : 404).json({ error: fetchErr ? 'Database error' : 'Interview not found' })
    }

    const base = reportInput || parseJsonObjectOrNull(iv.report_json)
    if (!base) return res.status(400).json({ error: 'report_json not found for translation' })

    const uiLocale = String(reportUiLanguage ?? 'en').slice(0, 32)
    const normalizedBase = normalizeReportJson(base)
    
    // Check persistent cache inside report_json
    const cache = base._translations || {}
    if (cache[uiLocale]) {
      // If we have it, only update the top-level report and locale in DB
      const resultReport = { ...cache[uiLocale], _translations: cache }
      await dbFor(req)
        .from('interviews')
        .update({ report_json: resultReport, report_ui_locale: uiLocale })
        .eq('id', id)
        .eq('user_id', req.user.id)
      
      return res.json({ interview: { ...iv, report_json: resultReport, report_ui_locale: uiLocale }, report: resultReport })
    }

    // Miss: Translate and persist to cache
    const translated = await translateInterviewReportToUi(normalizedBase, reportUiLanguage)
    
    // We also want to cache the "original" (pre-translation) if not already cached
    // and if the current top-level is different from the target
    const currentLocale = iv.report_ui_locale || iv.language || 'en'
    if (!cache[currentLocale]) {
      cache[currentLocale] = normalizedBase
    }
    cache[uiLocale] = translated

    const nextReportJson = { ...translated, _translations: cache }

    let updated, upErr
    ;({ data: updated, error: upErr } = await dbFor(req)
      .from('interviews')
      .update({ report_json: nextReportJson, report_ui_locale: uiLocale })
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select('*')
      .single())

    if (upErr && /column|does not exist|schema cache/i.test(String(upErr.message || upErr))) {
      const { data: fallbackUpdated, error: fallbackErr } = await dbFor(req)
        .from('interviews')
        .update({ report_json: nextReportJson })
        .eq('id', id)
        .eq('user_id', req.user.id)
        .select('*')
        .single()
      updated = fallbackUpdated
      upErr = fallbackErr
    }

    if (upErr) {
      console.error('[POST /interviews/:id/report/translate] update', upErr)
      return res.status(500).json({ error: 'Failed to save translated report', details: upErr.message })
    }

    backupUpdate(id, { report_json: nextReportJson, report_ui_locale: uiLocale })

    return res.json({ interview: updated, report: nextReportJson })
  } catch (err) {
    console.error('[POST /interviews/:id/report/translate]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * DELETE /api/interviews/:id
 */
router.delete('/:id', requireAuth, async (req, res) => {
  const { id } = req.params

  try {
    const { error } = await dbFor(req)
      .from('interviews')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id)

    if (error) {
      console.error('[DELETE /interviews/:id]', error)
      return res.status(500).json({ error: 'Failed to delete interview' })
    }

    return res.json({ success: true })
  } catch (err) {
    console.error('[DELETE /interviews/:id] Unexpected error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
