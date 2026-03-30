import { Router } from 'express'
import { supabase, supabaseForUser } from '../lib/supabase.js'
import { requireAuth } from '../middleware/auth.js'
import { assertGeminiConfigured, invokeGemini, stripJsonFence } from '../lib/geminiText.js'
import { checkTokens, deductTokens } from '../middleware/tokens.js'

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
    const { updated_at, report_markdown, report_ui_locale, ...safeFields } = fields
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
- toImprove: 2 to 6 objects; each must have non-empty title, why, and how.
- qaReview: REQUIRED. Walk the transcript in order. Pair substantive interviewer turns with the candidate's reply.
  - Include at least 3 rounds and at most 10 rounds.
  - questionSummary and yourAnswerSummary: Concise summary of the round.
  - referenceExample: Realistic model answer for the JD, plain text, no markdown, no bracket placeholders.
  - gaps and howToImprove: Analysis of the performance.
- transcriptLineReview: REQUIRED. Emit EXACTLY one object per numbered line index.
  - parse and improvements: Analytical recap and tips.
  - modelAnswer: For USER lines, provide a polished standard answer (not claiming they said it). For ASSISTANT lines, use "".
  - Keep fields concise (parse < 200 chars, modelAnswer < 600 chars).

ALL string values MUST be written in the "Interview language" specified in the user message. Do NOT translate analysis to any other language.`

function reportUiLanguageLine(code) {
  const c = String(code || 'en').toLowerCase()
  if (c.startsWith('zh')) return 'LANGUAGE: Write every string value in Simplified Chinese (简体中文).'
  if (c.startsWith('de')) return 'LANGUAGE: Write every string value in German.'
  return 'LANGUAGE: Write every string value in English.'
}

function uiCodeToTargetLang(uiCode) {
  const c = String(uiCode || '').toLowerCase().trim()
  if (c.startsWith('zh')) return 'zh-CN'
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
router.post('/', requireAuth, (req, _, next) => { req.tokenCost = 300; next(); }, checkTokens, async (req, res) => {
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
    const { data, error } = await dbFor(req).from('interviews').insert(row).select().single()

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

    await deductTokens(req.user.id, 300)

    backupInsert(data.id, data)

    return res.status(201).json({ interview: data, tokensDeducted: 300 })
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
    const { data: iv, error: fetchErr } = await dbFor(req)
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
    const userPayload = `LANGUAGE: Write every string value in the EXACT "Interview language" specified below. Do NOT translate any part of the report into another language.
 
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
      report_ui_locale: String(iv.language || 'en').slice(0, 32),
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

    backupUpdate(id, updateRow)

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
    const { data: updated, error } = await dbFor(req)
      .from('interviews')
      .update({ transcript_json: sanitized })
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select('id, transcript_json, created_at')
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

    backupUpdate(id, { transcript_json: sanitized })

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
