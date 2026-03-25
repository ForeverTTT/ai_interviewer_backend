import { Router } from 'express'
import { PDFParse } from 'pdf-parse'
import { supabase } from '../lib/supabase.js'
import { requireAuth } from '../middleware/auth.js'
import { assertGeminiConfigured, invokeGemini, stripJsonFence } from '../lib/geminiText.js'

const router = Router()

function coachUiLanguageLine(code) {
  const c = String(code || 'en').toLowerCase()
  if (c.startsWith('zh')) return 'LANGUAGE: Write every narrative string value in the JSON in Simplified Chinese (简体中文).'
  if (c.startsWith('de')) return 'LANGUAGE: Write every narrative string value in the JSON in German.'
  return 'LANGUAGE: Write every narrative string value in the JSON in English.'
}

const RESUME_COACH_SYSTEM = `You are an expert CV/resume coach for students and early-career candidates applying to internships, Werkstudent roles, and grad roles in Germany and the EU.
Analyze ONLY the resume text provided. Do not invent employers, degrees, or projects that are not implied by the text.
Return a single JSON object (no markdown fences) with this exact shape:
{
  "overallEvaluation": "string, 2-5 sentences",
  "scores": { "overall": number 1-10, "clarity": number, "impact": number, "structure": number, "ats": number },
  "macroInsights": [
    "string — holistic point: e.g. overall substance vs length, project relevance to target role, missing evidence types, section balance, redundancy — NOT micro-formatting or skills list edits"
  ],
  "highlights": ["string", "..."],
  "priorityImprovements": [
    { "title": "string", "problem": "string", "suggestedAction": "string", "rewriteExample": "string (optional)" }
  ],
  "moduleDeepDives": [
    { "moduleTitle": "string", "finding": "string", "whyImportant": "string", "modificationSuggestion": "string", "before": "string", "after": "string" }
  ],
  "positioning": [ { "title": "string", "content": "string" } ],
  "actionChecklist": [ { "priority": number, "title": "string", "expectedOutcome": "string" } ]
}

Priority and method:
- **STAR (Situation, Task, Action, Result)** is the core framework for feedback and rewrites on **work experience** and **projects**. Push for concrete context, your role, actions, and measurable or verifiable outcomes. De-prioritize generic duty-only bullets.
- **Skills / technical-skills blocks**: Usually do **not** need line-by-line rewrites. Do **not** use moduleDeepDive mainly for skills keyword lists unless the section is clearly misleading or harmful. At most one short remark in macroInsights or a single checklist item is enough for skills. Save deep dives for experience and projects.
- **macroInsights**: REQUIRED, 3-5 strings. Cover document-level angles such as: overall content richness vs verbosity; alignment of projects/experience with the target role (if provided); whether impact is visible above the fold; gaps in evidence; structural balance. Avoid repeating micro-edits already covered in moduleDeepDives.

Rules:
- Use integers for scores 1-10. Let "impact" partly reflect STAR-quality of experience/project bullets.
- priorityImprovements: 2-4 items, highest impact first — focus on storytelling and evidence in **experience and projects**, not skills ordering unless ATS-critical.
- moduleDeepDives: **2-4 items**. When the resume has work and/or project sections, **at least two** moduleDeepDives must target **Work experience** and/or **Projects**. before/after examples should illustrate STAR where applicable. Use Education or other sections only if they are the main weakness.
- positioning: 1-3 cards about Germany/EU hiring context vs target role.
- Do NOT output lists of generic interview questions (salary, visa, long-term goals, availability, strengths/weaknesses, etc.). Focus on the CV as a document.
- actionChecklist: 3-5 items with priority starting at 1; prioritize STAR upgrades to experience/projects over skills tweaks.

Follow the LANGUAGE instruction in the user message for all string values.`

const CV_EXTRACT_SYSTEM = `You extract structured profile data from resume/CV plain text only.
Rules:
- Output a single JSON object (no markdown fences). Use the exact keys below.
- Do NOT invent employers, degrees, projects, or papers not supported by the text. Use empty string or empty array if unknown.
- Preserve the candidate's language in free-text fields when the resume is not English (e.g. Chinese or German descriptions).
- Dates can be strings like "2024-10", "Oct 2024", or "至今" / "Present" when appropriate.

Required JSON shape:
{
  "fullName": "string",
  "gender": "string — empty, or male, female, non_binary, other, prefer_not_to_say if clearly stated; else empty",
  "email": "string",
  "phone": "string",
  "location": "string",
  "linkedIn": "string",
  "website": "string",
  "summary": "string — 2-4 sentence professional summary if inferable, else empty",
  "workExperience": [
    { "company": "string", "title": "string", "location": "string", "startDate": "string", "endDate": "string", "highlights": "string — bullets as one text block" }
  ],
  "education": [
    { "institution": "string", "degree": "string", "field": "string", "startDate": "string", "endDate": "string", "gpa": "string", "details": "string" }
  ],
  "projects": [
    { "name": "string", "role": "string", "startDate": "string", "endDate": "string", "description": "string", "technologies": "string" }
  ],
  "publications": [
    { "title": "string", "venue": "string", "year": "string", "authors": "string", "url": "string" }
  ],
  "skills": ["string", "..."],
  "languages": [ { "name": "string", "proficiency": "string" } ],
  "awards": [ { "title": "string", "year": "string", "issuer": "string" } ]
}`

async function fetchProfileRow(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, resume_text, resume_notes, profile_json, resume_coach, resume_updated_at')
    .eq('id', userId)
    .maybeSingle()

  if (error) throw error
  return data
}

async function ensureProfileRow(userId) {
  let row = await fetchProfileRow(userId)
  if (row) return row

  const ins = {
    id: userId,
    resume_text: '',
    resume_notes: '',
    profile_json: {},
  }
  const { error } = await supabase.from('profiles').insert(ins)
  if (error && error.code !== '23505') throw error
  row = await fetchProfileRow(userId)
  if (!row) throw new Error('profile row missing after insert')
  return row
}

/** GET /api/profile — full row for profile page */
router.get('/', requireAuth, async (req, res) => {
  try {
    const row = await ensureProfileRow(req.user.id)
    return res.json({
      resumeText: row.resume_text || '',
      resumeNotes: row.resume_notes ?? '',
      profileJson: row.profile_json ?? {},
      resumeCoach: row.resume_coach ?? null,
      resumeUpdatedAt: row.resume_updated_at ?? null,
    })
  } catch (err) {
    console.error('[GET /profile]', err)
    return res.status(500).json({ error: 'Failed to load profile' })
  }
})

/** GET /api/profile/resume — minimal shape for setup page */
router.get('/resume', requireAuth, async (req, res) => {
  try {
    const row = await ensureProfileRow(req.user.id)
    return res.json({ resumeText: row.resume_text || '' })
  } catch (err) {
    console.error('[GET /profile/resume]', err)
    return res.status(500).json({ error: 'Failed to load resume' })
  }
})

/** PUT /api/profile */
router.put('/', requireAuth, async (req, res) => {
  const { resumeText, resumeNotes, profileJson } = req.body ?? {}

  try {
    const existing = await ensureProfileRow(req.user.id)

    const patch = {
      resume_updated_at: new Date().toISOString(),
    }
    if (typeof resumeText === 'string') patch.resume_text = resumeText
    if (typeof resumeNotes === 'string') patch.resume_notes = resumeNotes
    if (profileJson !== undefined && typeof profileJson === 'object' && profileJson !== null) {
      patch.profile_json = { ...(existing.profile_json || {}), ...profileJson }
    }

    const { data, error } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', req.user.id)
      .select()
      .single()

    if (error) throw error

    return res.json({
      resumeText: data.resume_text || '',
      resumeNotes: data.resume_notes ?? '',
      profileJson: data.profile_json ?? {},
      resumeCoach: data.resume_coach ?? null,
      resumeUpdatedAt: data.resume_updated_at ?? null,
    })
  } catch (err) {
    console.error('[PUT /profile]', err)
    return res.status(500).json({ error: 'Failed to save profile' })
  }
})

/** POST /api/profile/resume/parse-pdf */
router.post('/resume/parse-pdf', requireAuth, async (req, res) => {
  const { pdfBase64 } = req.body ?? {}
  if (!pdfBase64 || typeof pdfBase64 !== 'string') {
    return res.status(400).json({ error: 'pdfBase64 is required' })
  }

  let buf
  try {
    buf = Buffer.from(pdfBase64, 'base64')
  } catch {
    return res.status(400).json({ error: 'Invalid base64' })
  }

  if (buf.length > 12 * 1024 * 1024) {
    return res.status(413).json({ error: 'PDF too large' })
  }

  const parser = new PDFParse({ data: buf })
  try {
    const textResult = await parser.getText()
    const text = (textResult.text || '').replace(/\u0000/g, '').trim()
    return res.json({
      text,
      charCount: text.length,
      warning: text.length < 80 ? 'Very little text extracted—scanned PDF?' : undefined,
    })
  } catch (e) {
    console.error('[parse-pdf]', e)
    return res.status(400).json({ error: 'Could not parse PDF' })
  } finally {
    try {
      await parser.destroy()
    } catch { /* ignore */ }
  }
})

/** POST /api/profile/extract-cv — structured fields from resume text (Gemini JSON) */
router.post('/extract-cv', requireAuth, async (req, res) => {
  if (!assertGeminiConfigured(res)) return

  const draft = typeof req.body?.resumeText === 'string' ? req.body.resumeText.trim() : ''

  try {
    const row = await ensureProfileRow(req.user.id)
    const saved = String(row.resume_text || '').trim()
    const resume = draft.length >= 80 ? draft : saved
    if (resume.length < 80) {
      return res.status(400).json({
        error: 'Resume text too short',
        details: 'Need at least ~80 characters of resume text (paste, upload PDF first, or apply extracted text).',
      })
    }

    const userBlock = `Resume plain text:\n---\n${resume.slice(0, 48_000)}\n---`

    const raw = await invokeGemini(CV_EXTRACT_SYSTEM, userBlock, { temperature: 0.2, maxOutputTokens: 8192 })
    const jsonStr = stripJsonFence(raw)
    let parsed
    try {
      parsed = JSON.parse(jsonStr)
    } catch (e) {
      console.error('[extract-cv] JSON parse', e, jsonStr.slice(0, 400))
      return res.status(502).json({ error: 'Model returned invalid JSON', details: 'Try again or shorten resume.' })
    }

    return res.json({ cvProfile: parsed })
  } catch (err) {
    console.error('[extract-cv]', err)
    return res.status(500).json({ error: 'Extract CV failed' })
  }
})

/** POST /api/profile/resume-coach */
router.post('/resume-coach', requireAuth, async (req, res) => {
  if (!assertGeminiConfigured(res)) return

  const targetRole = typeof req.body?.targetRole === 'string' ? req.body.targetRole.trim() : ''
  const draftResume = typeof req.body?.resumeText === 'string' ? req.body.resumeText.trim() : ''
  const coachUiLanguage = typeof req.body?.coachUiLanguage === 'string' ? req.body.coachUiLanguage : ''

  try {
    const row = await ensureProfileRow(req.user.id)
    const saved = String(row.resume_text || '').trim()
    const resume = draftResume.length >= 80 ? draftResume : saved
    if (resume.length < 80) {
      return res.status(400).json({
        error: 'Resume text too short',
        details: 'Paste or upload a resume with at least ~80 characters in the profile editor (or save to account), then run the coach again.',
      })
    }

    const userBlock = `${coachUiLanguageLine(coachUiLanguage)}

Target role / direction (may be empty): ${targetRole || '— not specified —'}

Resume text:
---
${resume.slice(0, 48_000)}
---`

    const raw = await invokeGemini(RESUME_COACH_SYSTEM, userBlock, { temperature: 0.25, maxOutputTokens: 8192 })
    const jsonStr = stripJsonFence(raw)
    let parsed
    try {
      parsed = JSON.parse(jsonStr)
    } catch (e) {
      console.error('[resume-coach] JSON parse', e, jsonStr.slice(0, 400))
      return res.status(502).json({ error: 'Model returned invalid JSON', details: 'Try again or shorten resume.' })
    }

    const macroInsights = Array.isArray(parsed.macroInsights)
      ? parsed.macroInsights.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 8)
      : []

    const payload = {
      generatedAt: new Date().toISOString(),
      targetRole: targetRole || null,
      overallEvaluation: parsed.overallEvaluation || '',
      scores: parsed.scores || {},
      macroInsights,
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights : [],
      priorityImprovements: Array.isArray(parsed.priorityImprovements) ? parsed.priorityImprovements : [],
      moduleDeepDives: Array.isArray(parsed.moduleDeepDives) ? parsed.moduleDeepDives : [],
      positioning: Array.isArray(parsed.positioning) ? parsed.positioning : [],
      actionChecklist: Array.isArray(parsed.actionChecklist) ? parsed.actionChecklist : [],
    }

    const { error } = await supabase
      .from('profiles')
      .update({ resume_coach: payload, resume_updated_at: new Date().toISOString() })
      .eq('id', req.user.id)

    if (error) {
      console.error('[resume-coach] save', error)
      return res.json({ coach: payload, persisted: false })
    }

    return res.json({ coach: payload, persisted: true })
  } catch (err) {
    console.error('[resume-coach]', err)
    return res.status(500).json({ error: 'Resume coach failed' })
  }
})

export default router
