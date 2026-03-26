import { Router }     from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getGraph, RESPONSE_NODES, AGENT_LABELS } from '../agents/interviewGraph.js'
import { sessionStore, getMaxQuestions } from '../agents/utils.js'

const router = Router()

// ── SSE helper ───────────────────────────────────────────────────

function sseWrite(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

// ── POST /api/chat/message ───────────────────────────────────────
/**
 * Body:
 * {
 *   messages:      [{ role: 'user'|'assistant', content: string }],
 *   position:      string,
 *   jobDescription: string,
 *   language:      string,   "English" | "Deutsch"
 *   duration:        number,
 *   resumeSnapshot:  string, optional — resume/CV text for experience-phase questions
 *   sessionId:       string, optional — used to reset session
 * }
 *
 * SSE events:
 *   { type: 'agent',  name, label, emoji }  ← which agent is speaking
 *   { type: 'text',   content }              ← token stream
 *   { type: 'done' }
 *   { type: 'error',  message }
 */
router.post('/message', requireAuth, async (req, res) => {
  const {
    messages      = [],
    position      = '',
    jobDescription = '',
    language      = 'English',
    duration       = 10,
    resumeSnapshot = '',
    sessionId,        // "new" resets the session
  } = req.body

  const userId = req.user.id

  // ── SSE headers ──────────────────────────────────────────────
  res.setHeader('Content-Type',      'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control',     'no-cache, no-transform')
  res.setHeader('Connection',        'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  try {
    const graph = await getGraph()

    // ── Session state management ─────────────────────────────
    const resumeTrim = typeof resumeSnapshot === 'string'
      ? resumeSnapshot.trim().slice(0, 50_000)
      : ''
    const config = { position, jobDescription, language, duration, resumeSnapshot: resumeTrim }
    const isNewSession = sessionId === 'new' || !sessionStore.get(userId)

    let session
    if (isNewSession) {
      session = sessionStore.init(userId, config)
    } else {
      session = sessionStore.get(userId)
      if (session?.phase === 'closed') {
        sseWrite(res, { type: 'done' })
        res.end()
        return
      }
      session = sessionStore.update(userId, { config })
    }

    // ── Build initial graph state ────────────────────────────
    const initialState = {
      rawMessages:     messages,
      messages:        [],          // LangChain message objects (built by nodes)
      config,
      phase:           session.phase,
      questionCount:   session.questionCount,
      technicalCount:  session.technicalCount,
      behavioralCount: session.behavioralCount,
      exploreCount:    session.exploreCount ?? 0,
      plan:            session.plan || [],
      planIndex:       session.planIndex ?? 0,
      analysisNotes:   session.analysisNotes,
      interviewerName: session.interviewerName,
      nextQuestionType: 'continue',
    }

    // ── Stream graph execution ────────────────────────────────
    const stream = await graph.stream(initialState, {
      streamMode: 'messages',
    })

    let currentNode   = null
    let lastResponseNode = null

    for await (const [chunk, metadata] of stream) {
      const node = metadata?.langgraph_node

      if (node && RESPONSE_NODES.has(node) && node !== currentNode) {
        currentNode    = node
        lastResponseNode = node
        const agentInfo = AGENT_LABELS[node] || { name: node, label: node, emoji: '🤖' }
        sseWrite(res, { type: 'agent', ...agentInfo })
      }

      if (node && RESPONSE_NODES.has(node) && chunk?.content) {
        sseWrite(res, { type: 'text', content: chunk.content })
      }
    }

    // ── Persist session counters (mirror graph node outputs) ──
    const sess = sessionStore.get(userId)
    if (sess && lastResponseNode) {
      switch (lastResponseNode) {
        case 'generate_opening':
          sessionStore.update(userId, {
            phase:           'questioning',
            questionCount:   0,
            technicalCount:  0,
            behavioralCount: 0,
            exploreCount:    0,
            planIndex:       0,
          })
          break
        case 'ask_explore':
          sessionStore.update(userId, {
            planIndex:       (sess.planIndex ?? 0) + 1,
            questionCount:   (sess.questionCount ?? 0) + 1,
            exploreCount:    (sess.exploreCount ?? 0) + 1,
            phase:           'questioning',
          })
          break
        case 'ask_technical':
          sessionStore.update(userId, {
            planIndex:       (sess.planIndex ?? 0) + 1,
            questionCount:   (sess.questionCount ?? 0) + 1,
            technicalCount:  (sess.technicalCount ?? 0) + 1,
            phase:           'questioning',
          })
          break
        case 'ask_behavioral':
          sessionStore.update(userId, {
            planIndex:       (sess.planIndex ?? 0) + 1,
            questionCount:   (sess.questionCount ?? 0) + 1,
            behavioralCount: (sess.behavioralCount ?? 0) + 1,
            phase:           'questioning',
          })
          break
        case 'give_feedback':
          sessionStore.update(userId, { phase: 'closed' })
          break
        default:
          break
      }
    }

    sseWrite(res, { type: 'done' })
    res.end()

  } catch (err) {
    console.error('[InterviewGraph] Error:', err)
    if (!res.writableEnded) {
      sseWrite(res, { type: 'error', message: err.message || 'Internal server error' })
      res.end()
    }
  }
})

// ── POST /api/chat/tts ───────────────────────────────────────────
/**
 * Convert text to speech using Gemini's neural TTS.
 * Body: { text: string, language: "English"|"Deutsch" }
 * Returns: audio/wav binary
 *
 * Voice mapping (Gemini built-in voices):
 *   English → Kore  (professional female)
 *   Deutsch → Fenrir (authoritative male — suits German corporate context)
 *
 * Falls back gracefully: if Gemini TTS is unavailable the client should
 * fall back to browser SpeechSynthesis.
 */

// Voices: avoid "Firm"/"Excitable" for long interview playback — use Warm/Smooth (Gemini 2.5 voice library)
const TTS_VOICES = {
  English: process.env.GEMINI_TTS_VOICE_EN || 'Sulafat',   // Warm
  Deutsch: process.env.GEMINI_TTS_VOICE_DE || 'Despina',  // Smooth (better than Fenrir "Excitable" for DE)
}

const TTS_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts'

function buildTtsPrompt(text, language) {
  const clean = String(text || '').trim().slice(0, 4500)
  if (!clean) return clean
  if (language === 'Deutsch') {
    return (
      'Sprich den folgenden Text auf Deutsch mit ruhigem, professionellem Interview-Ton, natürlichem Tempo und kurzen Pausen zwischen den Sätzen. '
      + 'Lies nur den Text vor, ohne einzuleiten oder zu kommentieren:\n\n'
      + clean
    )
  }
  return (
    'Read the following in English with a calm, professional interviewer tone, natural pacing, and short pauses between sentences. '
    + 'Speak only the script—do not add introductions or commentary:\n\n'
    + clean
  )
}

/**
 * Wrap raw PCM bytes from Gemini TTS in a standard WAV container
 * so browsers can play it natively.
 */
function pcmToWav(pcmBase64, sampleRate = 24000) {
  const pcm          = Buffer.from(pcmBase64, 'base64')
  const numChannels  = 1
  const bitsPerSample = 16
  const byteRate     = sampleRate * numChannels * (bitsPerSample / 8)
  const blockAlign   = numChannels * (bitsPerSample / 8)
  const dataSize     = pcm.length

  const hdr = Buffer.allocUnsafe(44)
  hdr.write('RIFF', 0, 'ascii');  hdr.writeUInt32LE(36 + dataSize, 4)
  hdr.write('WAVE', 8, 'ascii')
  hdr.write('fmt ', 12, 'ascii'); hdr.writeUInt32LE(16, 16)
  hdr.writeUInt16LE(1, 20)        // PCM
  hdr.writeUInt16LE(numChannels, 22)
  hdr.writeUInt32LE(sampleRate, 24)
  hdr.writeUInt32LE(byteRate, 28)
  hdr.writeUInt16LE(blockAlign, 32)
  hdr.writeUInt16LE(bitsPerSample, 34)
  hdr.write('data', 36, 'ascii'); hdr.writeUInt32LE(dataSize, 40)

  return Buffer.concat([hdr, pcm])
}

router.post('/tts', requireAuth, async (req, res) => {
  const { text, language = 'English' } = req.body
  if (!text?.trim()) return res.status(400).json({ error: 'text is required' })

  const apiKey    = process.env.GEMINI_API_KEY
  const voiceName = TTS_VOICES[language] || TTS_VOICES.English
  const prompt    = buildTtsPrompt(text, language)

  try {
    const tryModels = [
      { id: TTS_MODEL, camel: true },
      { id: 'gemini-2.5-flash-preview-tts', camel: false },
    ]

    let lastErr = ''

    for (const m of tryModels) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${m.id}:generateContent?key=${apiKey}`
      // Older flash-exp models may not support newer 2.5 voice names — use Kore on fallback
      const vn = m.camel ? voiceName : 'Kore'
      const body = m.camel
        ? {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: vn },
                },
              },
            },
          }
        : {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              response_modalities: ['AUDIO'],
              speech_config: {
                voice_config: { prebuilt_voice_config: { voice_name: vn } },
              },
            },
          }

      const ttsRes = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!ttsRes.ok) {
        lastErr = await ttsRes.text()
        console.warn('[TTS] model', m.id, 'failed', ttsRes.status, lastErr.slice(0, 200))
        continue
      }

      const data = await ttsRes.json()
      const part = data.candidates?.[0]?.content?.parts?.[0]
      const inlineData = part?.inlineData || part?.inline_data
      if (inlineData?.data) {
        const mime = inlineData.mimeType || inlineData.mime_type || ''
        const rateMatch = mime.match(/rate=(\d+)/)
        const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000
        const wav = pcmToWav(inlineData.data, sampleRate)
        res.setHeader('Content-Type',   'audio/wav')
        res.setHeader('Content-Length', wav.length)
        res.send(wav)
        return
      }
      lastErr = 'No inline audio in response'
    }

    console.error('[TTS] all models failed', lastErr)
    return res.status(502).json({ error: 'Gemini TTS unavailable', details: lastErr?.slice?.(0, 500) || lastErr })
  } catch (err) {
    console.error('[TTS] Unexpected error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/chat/reset ─────────────────────────────────────────
/**
 * Reset the user's interview session (call at interview start).
 */
router.post('/reset', requireAuth, (req, res) => {
  const userId = req.user.id
  const { position, jobDescription, language, duration, resumeSnapshot = '' } = req.body ?? {}
  const resumeTrim = typeof resumeSnapshot === 'string'
    ? resumeSnapshot.trim().slice(0, 50_000)
    : ''

  sessionStore.init(userId, {
    position,
    jobDescription,
    language,
    duration,
    resumeSnapshot: resumeTrim,
  })
  res.json({ ok: true, message: 'Session reset' })
})

// ── GET /api/chat/session ────────────────────────────────────────
/**
 * Get current session state (for debugging / frontend status display).
 */
router.get('/session', requireAuth, (req, res) => {
  const session = sessionStore.get(req.user.id)
  if (!session) return res.json({ phase: 'none' })

  const maxQ = getMaxQuestions(session.config?.duration)
  const planLen = Array.isArray(session.plan) && session.plan.length > 0 ? session.plan.length : maxQ
  res.json({
    phase:           session.phase,
    questionCount:   session.questionCount,
    technicalCount:  session.technicalCount,
    behavioralCount: session.behavioralCount,
    exploreCount:    session.exploreCount ?? 0,
    planIndex:       session.planIndex ?? 0,
    planLength:      planLen,
    maxQuestions:    maxQ,
    progress:        planLen ? Math.round(((session.planIndex ?? 0) / planLen) * 100) : 0,
    interviewerName: session.interviewerName,
  })
})

export default router
