import { Router } from 'express'
import { supabase } from '../lib/supabase.js'
import { requireAuth } from '../middleware/auth.js'
import { assertGeminiConfigured, invokeGemini, stripJsonFence } from '../lib/geminiText.js'

const router = Router()

const REPORT_JSON_SYSTEM = `You are an expert interview coach for internships and early-career hiring in Germany and Europe.
Read the mock interview transcript and return ONE JSON object only. No markdown code fences. No text before or after the JSON.

STRICT FORMATTING RULES:
- Never use asterisks (*), underscores for emphasis, hash marks, or any Markdown.
- Every field must be plain UTF-8 text suitable for UI list rendering.

JSON schema (types only):
{
  "summary": ["string", "..."],
  "strengths": ["string", "..."],
  "toImprove": [
    { "title": "string", "why": "string", "how": "string" }
  ],
  "qaReview": [
    {
      "questionSummary": "string — what the interviewer asked (concise)",
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
- toImprove: 2 to 6 objects; each must have non-empty title, why, and how (concrete, respectful). If inappropriate language occurred, address calmly under toImprove.
- qaReview: REQUIRED. Walk the transcript in order. For each substantive interviewer turn (skip tiny fillers like "thank you" only), pair with the candidate's following reply.
  - Include at least 3 rounds and at most 10 rounds (prioritize technical, behavioral, and experience questions).
  - gaps: 2 to 4 short bullets per round comparing the candidate's answer to referenceExample (missing metrics, unclear role, no STAR result, etc.).
  - referenceExample must be realistic for the job title and job description excerpt; plain text, no markdown symbols.
- transcriptLineReview: REQUIRED. The user message includes numbered transcript lines (0, 1, 2, …). Emit EXACTLY one object per line, same count and order as those indices.
  - Each object: index (integer, 0-based), parse, improvements (array), modelAnswer (string).
  - ASSISTANT / interviewer lines: parse = what this message is driving at (brief); improvements = [] or at most one short note; modelAnswer = "".
  - USER / candidate lines: parse = factual recap of their wording (no invention); improvements = 2 to 4 bullets (concrete gaps vs a strong answer); modelAnswer = a polished standard answer they could give (not claiming they said it).
  - Keep each field concise if the transcript is long (parse under ~200 characters; user modelAnswer under ~600 characters) so the full array fits.

Follow the LANGUAGE instruction in the user message for the language of all string values.`

function reportUiLanguageLine(code) {
  const c = String(code || 'en').toLowerCase()
  if (c.startsWith('zh')) return 'LANGUAGE: Write every string value in Simplified Chinese (简体中文).'
  if (c.startsWith('de')) return 'LANGUAGE: Write every string value in German.'
  return 'LANGUAGE: Write every string value in English.'
}

function normalizeReportJson(raw) {
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
      .map((x) => ({
        questionSummary: String(x?.questionSummary || x?.question || '').trim(),
        yourAnswerSummary: String(x?.yourAnswerSummary || x?.candidateAnswer || x?.yourAnswer || '').trim(),
        referenceExample: String(x?.referenceExample || x?.referenceAnswer || '').trim(),
        gaps: Array.isArray(x?.gaps)
          ? x.gaps.map((g) => String(g || '').trim()).filter(Boolean)
          : [],
        howToImprove: String(x?.howToImprove || x?.improvementTip || '').trim(),
      }))
      .filter((x) => x.questionSummary || x.yourAnswerSummary || x.referenceExample)
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

/**
 * GET /api/interviews
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('interviews')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(50)

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
  const { position, job_description, language, duration, resume_snapshot } = req.body ?? {}

  if (!position || !language || !duration) {
    return res.status(400).json({ error: 'position, language, and duration are required' })
  }

  const row = {
    user_id: req.user.id,
    position: String(position).trim(),
    job_description: job_description != null ? String(job_description).trim() : '',
    language,
    duration: Number(duration),
  }

  if (resume_snapshot != null && String(resume_snapshot).trim()) {
    row.resume_snapshot = String(resume_snapshot).trim().slice(0, 50_000)
  }

  row.status = 'in_progress'

  try {
    const { data, error } = await supabase.from('interviews').insert(row).select().single()

    if (error) {
      console.error('[POST /interviews]', error)
      const noCol = /column|does not exist|schema cache/i.test(String(error.message || error))
      return res.status(500).json({
        error: 'Failed to create interview record',
        details: error.message,
        hint: noCol
          ? 'Run supabase/migration_interviews_complete.sql in Supabase SQL Editor, wait ~1 min for schema cache.'
          : undefined,
      })
    }

    return res.status(201).json({ interview: data })
  } catch (err) {
    console.error('[POST /interviews] Unexpected error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * POST /api/interviews/:id/finalize
 */
router.post('/:id/finalize', requireAuth, async (req, res) => {
  if (!assertGeminiConfigured(res)) return

  const { id } = req.params
  const messages = req.body?.messages
  const reportUiLanguage = req.body?.reportUiLanguage

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' })
  }

  try {
    const { data: iv, error: fetchErr } = await supabase
      .from('interviews')
      .select('*')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .maybeSingle()

    if (fetchErr || !iv) {
      return res.status(fetchErr ? 500 : 404).json({ error: fetchErr ? 'Database error' : 'Interview not found' })
    }

    const transcriptText = formatMessagesForPrompt(messages)
    const numberedLines = formatNumberedTranscriptLines(messages)
    const userPayload = `${reportUiLanguageLine(reportUiLanguage)}

Job title: ${iv.position}
Interview language: ${iv.language}
Duration (minutes): ${iv.duration}
Job description (excerpt): ${String(iv.job_description || '').slice(0, 4000)}

Transcript:
${transcriptText || '(empty — candidate may not have spoken)'}

Numbered lines (index|role|text) — transcriptLineReview MUST use these indices in order, one object per line below:
${numberedLines || '(none)'}

Return the JSON object now.`

    const raw = await invokeGemini(REPORT_JSON_SYSTEM, userPayload, { temperature: 0.3, maxOutputTokens: 32768 })
    let parsed
    try {
      parsed = JSON.parse(stripJsonFence(raw))
    } catch (e) {
      console.error('[finalize] JSON parse', e, raw?.slice?.(0, 400))
      parsed = {
        summary: ['报告生成格式异常，请稍后点击「重新生成报告」重试。'],
        strengths: [],
        toImprove: [{ title: '说明', why: '模型未返回可解析的结构化 JSON。', how: '请检查 GEMINI 配置后重试。' }],
        qaReview: [],
        transcriptLineReview: [],
      }
    }

    const reportJson = normalizeReportJson(parsed)

    const updateRow = {
      transcript_json: messages,
      report_json: reportJson,
      report_markdown: null,
      status: 'completed',
      report_ui_locale: String(reportUiLanguage ?? 'en').slice(0, 32),
    }

    let updated, upErr
    ;({ data: updated, error: upErr } = await supabase
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
      ;({ data: updated, error: upErr } = await supabase
        .from('interviews')
        .update(updateRowFallback)
        .eq('id', id)
        .eq('user_id', req.user.id)
        .select()
        .single())
    }

    if (upErr) {
      console.error('[finalize] update', upErr)
      const noCol = /column|does not exist|schema cache/i.test(String(upErr.message || upErr))
      return res.status(500).json({
        error: 'Failed to save report',
        details: upErr.message,
        hint: noCol
          ? 'Run supabase/migration_interviews_complete.sql and migration_report_ui_locale.sql in Supabase SQL Editor, wait ~1 min for schema cache.'
          : undefined,
      })
    }

    return res.json({ interview: updated })
  } catch (err) {
    console.error('[finalize]', err)
    return res.status(500).json({ error: 'Finalize failed' })
  }
})

/**
 * POST /api/interviews/:id/transcript
 * Persist conversation during the session (autosave from client).
 */
router.post('/:id/transcript', requireAuth, async (req, res) => {
  const { id } = req.params
  const messages = req.body?.messages

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
    const { data: updated, error } = await supabase
      .from('interviews')
      .update({ transcript_json: sanitized })
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select('id, transcript_json, updated_at')
      .maybeSingle()

    if (error) {
      console.error('[POST /transcript]', error)
      const noCol = /column|does not exist|schema cache/i.test(String(error.message || error))
      return res.status(500).json({
        error: 'Failed to save transcript',
        details: error.message,
        hint: noCol
          ? 'Run supabase/migration_interviews_complete.sql in Supabase SQL Editor, wait ~1 min for schema cache.'
          : undefined,
      })
    }
    if (!updated) return res.status(404).json({ error: 'Interview not found' })
    return res.json({ ok: true, interview: updated })
  } catch (err) {
    console.error('[POST /transcript]', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * GET /api/interviews/:id
 */
router.get('/:id', requireAuth, async (req, res) => {
  const { id } = req.params
  try {
    const { data, error } = await supabase
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
 * DELETE /api/interviews/:id
 */
router.delete('/:id', requireAuth, async (req, res) => {
  const { id } = req.params

  try {
    const { error } = await supabase
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
