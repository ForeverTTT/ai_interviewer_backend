import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getGraph, RESPONSE_NODES, AGENT_LABELS } from '../agents/interviewGraph.js'
import { sessionStore, getMaxQuestions } from '../agents/utils.js'
import { synthesizeSpeechVertex, getGcpProjectId } from '../lib/ttsVertex.js'
import {
  getInterviewerVoice,
  getTtsDeliveryPrompt,
  normalizeInterviewerStyle,
} from '../config/interviewerStyles.js'

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
    messages = [],
    position = '',
    jobDescription = '',
    language = 'English',
    duration = 10,
    resumeSnapshot = '',
    roleTrack = 'work',
    interviewerStyle = 'balanced',
    sessionId,        // "new" resets the session
  } = req.body

  const userId = req.user.id
  console.log('[Chat /message] roleTrack received:', roleTrack)

  // ── SSE headers ──────────────────────────────────────────────
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  try {
    const graph = await getGraph()

    // ── Session state management ─────────────────────────────
    const resumeTrim = typeof resumeSnapshot === 'string'
      ? resumeSnapshot.trim().slice(0, 50_000)
      : ''
    const config = {
      position,
      jobDescription,
      language,
      duration,
      resumeSnapshot: resumeTrim,
      roleTrack,
      interviewerStyle: normalizeInterviewerStyle(interviewerStyle),
    }
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
      rawMessages: messages,
      messages: [],          // LangChain message objects (built by nodes)
      config,
      phase: session.phase,
      questionCount: session.questionCount,
      technicalCount: session.technicalCount,
      behavioralCount: session.behavioralCount,
      exploreCount: session.exploreCount ?? 0,
      plan: session.plan || [],
      planIndex: session.planIndex ?? 0,
      analysisNotes: session.analysisNotes,
      interviewerName: session.interviewerName,
      nextQuestionType: 'continue',
    }

    // ── Stream graph execution ────────────────────────────────
    const stream = await graph.stream(initialState, {
      streamMode: 'messages',
    })

    let currentNode = null
    let lastResponseNode = null

    for await (const [chunk, metadata] of stream) {
      const node = metadata?.langgraph_node

      if (node && RESPONSE_NODES.has(node) && node !== currentNode) {
        currentNode = node
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
            phase: 'questioning',
            questionCount: 0,
            technicalCount: 0,
            behavioralCount: 0,
            exploreCount: 0,
            planIndex: 0,
          })
          break
        case 'ask_explore':
          sessionStore.update(userId, {
            planIndex: (sess.planIndex ?? 0) + 1,
            questionCount: (sess.questionCount ?? 0) + 1,
            exploreCount: (sess.exploreCount ?? 0) + 1,
            phase: 'questioning',
          })
          break
        case 'ask_technical':
          sessionStore.update(userId, {
            planIndex: (sess.planIndex ?? 0) + 1,
            questionCount: (sess.questionCount ?? 0) + 1,
            technicalCount: (sess.technicalCount ?? 0) + 1,
            phase: 'questioning',
          })
          break
        case 'ask_behavioral':
          sessionStore.update(userId, {
            planIndex: (sess.planIndex ?? 0) + 1,
            questionCount: (sess.questionCount ?? 0) + 1,
            behavioralCount: (sess.behavioralCount ?? 0) + 1,
            phase: 'questioning',
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
 * Body: { text: string, language: "English"|"Deutsch"|"Chinese" }
 * Returns: audio/wav binary
 *
 * Voice mapping is selected from the interviewer style and language, with
 * optional per-language environment overrides.
 *
 * Falls back gracefully: if Gemini TTS is unavailable the client should
 * fall back to browser SpeechSynthesis.
 */

// Explicit environment values override the style-based recommended voices.
const TTS_VOICE_OVERRIDES = {
  English: process.env.GEMINI_TTS_VOICE_EN,
  Deutsch: process.env.GEMINI_TTS_VOICE_DE,
  Chinese: process.env.GEMINI_TTS_VOICE_ZH,
}

const TTS_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts'

const TTS_SCRIPT_LABELS = {
  Chinese: '只朗读以下面试台词：',
  Deutsch: 'Sprich nur den folgenden Interviewtext:',
  English: 'Speak only the following interview line:',
}

function buildTtsPrompt(text, language = 'English', interviewerStyle = 'balanced') {
  const script = String(text || '')
    .replace(/(?<!\b(?:Dr|Mr|Mrs|Ms|Sr|Jr|St|i\.e|e\.g|etc|prof|vs))\s*([.?!。？！])\s+/gi, '$1   ') 
    .trim()
    .slice(0, 4500)
  const persona = getTtsDeliveryPrompt(interviewerStyle, language)
  const scriptLabel = TTS_SCRIPT_LABELS[language] || TTS_SCRIPT_LABELS.English
  return `${persona}\n\n${scriptLabel}\n${script}`
}

// ── API Key rotation pool ─────────────────────────────────────────
// Supports GEMINI_TTS_KEYS=key1,key2,key3 for multi-key rotation.
// Falls back to GEMINI_API_KEY if GEMINI_TTS_KEYS is not set.
// Keys that hit 429 are temporarily disabled for a cooldown period.
const TTS_KEY_COOLDOWN_MS = 60 * 60 * 1000 // 1 hour cooldown after 429

const ttsKeyPool = (() => {
  const raw = process.env.GEMINI_TTS_KEYS || process.env.GEMINI_API_KEY || ''
  const keys = raw.split(',').map(k => k.trim()).filter(Boolean)
  const state = keys.map(key => ({ key, exhaustedUntil: 0 }))
  let idx = 0

  return {
    size: keys.length,
    next() {
      const now = Date.now()
      const len = state.length
      for (let i = 0; i < len; i++) {
        const slot = state[(idx + i) % len]
        if (slot.exhaustedUntil <= now) {
          idx = ((idx + i) % len) + 1
          return slot.key
        }
      }
      return null
    },
    markExhausted(key) {
      const slot = state.find(s => s.key === key)
      if (slot) slot.exhaustedUntil = Date.now() + TTS_KEY_COOLDOWN_MS
    },
    anyAvailable() {
      const now = Date.now()
      return state.some(s => s.exhaustedUntil <= now)
    },
  }
})()

/**
 * Wrap raw PCM bytes from Gemini TTS in a standard WAV container
 * so browsers can play it natively.
 */
function pcmToWav(pcmBase64, sampleRate = 24000) {
  const pcm = Buffer.from(pcmBase64, 'base64')
  const numChannels = 1
  const bitsPerSample = 16
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8)
  const blockAlign = numChannels * (bitsPerSample / 8)
  const dataSize = pcm.length

  const hdr = Buffer.allocUnsafe(44)
  hdr.write('RIFF', 0, 'ascii'); hdr.writeUInt32LE(36 + dataSize, 4)
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
  const { text, language = 'English', interviewerStyle = 'balanced' } = req.body
  if (!text?.trim()) return res.status(400).json({ error: 'text is required' })

  const style = normalizeInterviewerStyle(interviewerStyle)
  const voiceName = TTS_VOICE_OVERRIDES[language] || getInterviewerVoice(style, language)
  const prompt = buildTtsPrompt(text, language, style)
  const modelId = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts'
  const isTtsModel = modelId.includes('tts')

  // --- Enterprise Vertex TTS Fallback ---
  if (getGcpProjectId()) {
    try {
      const { audioContent, contentType } = await synthesizeSpeechVertex(text, language, false, style)
      console.log(`[TTS Provider: VertexAI] Synthesized "${text.slice(0, 30)}..." in ${language} (${audioContent.length} bytes, MP3)`)
      return res.set({
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioContent.length,
        'X-TTS-Source': 'VertexAI'
      }).send(audioContent)
    } catch (err) {
      console.warn('[TTS Vertex] Enterprise fallback failed, trying generic:', err.message)
      // gracefully continue to Gemini logic
    }
  }

  try {
    let lastErr = ''
    const maxAttempts = Math.max(ttsKeyPool.size, 1)

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const apiKey = ttsKeyPool.next()
      if (!apiKey) break

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`
      const body = isTtsModel
        ? {
          contents: [{ role: 'user', parts: [
            { text: 'TTS Instruction: Output the following text as audio. No extra text.' },
            { text: prompt },
          ] }],
          generationConfig: {
            response_modalities: ['AUDIO'],
            speech_config: { voice_config: { prebuilt_voice_config: { voice_name: voiceName } } },
          },
        }
        : {
          contents: [{ role: 'user', parts: [
            { text: 'TTS Instruction: Output the following text as audio. No extra text.' },
            { text: prompt },
          ] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          },
        }

      const ttsRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      
      console.log(`[TTS Provider: Gemini] Using key ...${apiKey.slice(-6)} on model ${modelId}`)
      
      if (ttsRes.status === 429) {
        ttsKeyPool.markExhausted(apiKey)
        lastErr = await ttsRes.text()
        console.warn(`[TTS] Key ...${apiKey.slice(-6)} hit 429, rotating to next key`)
        continue
      }

      if (!ttsRes.ok) {
        lastErr = await ttsRes.text()
        console.warn('[TTS] model', modelId, 'failed', ttsRes.status, lastErr.slice(0, 200))
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
        res.setHeader('Content-Type', 'audio/wav')
        res.setHeader('Content-Length', wav.length)
        res.send(wav)
        return
      }
      lastErr = 'No inline audio in response'
    }

    console.error('[TTS] all keys/models exhausted', lastErr.slice?.(0, 200))
    return res.status(429).json({ error: 'Gemini TTS quota exhausted across all keys', details: lastErr?.slice?.(0, 500) || lastErr })
  } catch (err) {
    console.error('[TTS] Unexpected error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/chat/tts-stream ─────────────────────────────────────
/**
 * Streaming TTS: returns raw PCM chunks via chunked transfer encoding
 * as soon as Gemini produces them, instead of waiting for the full audio.
 * Body: { text: string, language: "English"|"Deutsch"|"Chinese" }
 * Returns: audio/pcm (16-bit mono), sample rate in X-Sample-Rate header
 */
router.post('/tts-stream', requireAuth, async (req, res) => {
  const { text, language = 'English', interviewerStyle = 'balanced' } = req.body
  if (!text?.trim()) return res.status(400).json({ error: 'text is required' })

  const style = normalizeInterviewerStyle(interviewerStyle)
  const modelId = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts'
  const isTtsModel = modelId.includes('tts')

  // --- Enterprise Vertex TTS Fallback ---
  if (getGcpProjectId()) {
    try {
      const { audioContent, contentType } = await synthesizeSpeechVertex(text, language, true, style)
      console.log(`[TTS Stream Provider: VertexAI] Full buffer response in ${language} (${audioContent.length} bytes, PCM)`)
      
      return res.set({
        'Content-Type': 'audio/pcm',
        'Content-Length': audioContent.length,
        'X-Sample-Rate': '24000',
        'X-TTS-Source': 'VertexAI'
      }).send(audioContent)
    } catch (err) {
      console.warn('[TTS Vertex Stream] Enterprise fallback failed:', err.message)
      // continue to generic
    }
  }

  const voiceName = TTS_VOICE_OVERRIDES[language] || getInterviewerVoice(style, language)
  const prompt = buildTtsPrompt(text, language, style)

  const reqBody = isTtsModel
    ? {
      contents: [{ role: 'user', parts: [
        { text: 'TTS Instruction: Output the following text as audio. No extra text.' },
        { text: prompt },
      ] }],
      generationConfig: {
        response_modalities: ['AUDIO'],
        speech_config: { voice_config: { prebuilt_voice_config: { voice_name: voiceName } } },
      },
    }
    : {
      contents: [{ role: 'user', parts: [
        { text: 'TTS Instruction: Output the following text as audio. No extra text.' },
        { text: prompt },
      ] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
      },
    }

  const maxAttempts = Math.max(ttsKeyPool.size, 1)

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const apiKey = ttsKeyPool.next()
    if (!apiKey) break

    const streamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?alt=sse&key=${apiKey}`

    try {
      const upstream = await fetch(streamUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody),
      })

      if (upstream.status === 429) {
        ttsKeyPool.markExhausted(apiKey)
        console.warn(`[TTS-stream] Key ...${apiKey.slice(-6)} hit 429, rotating to next key`)
        continue
      }

      if (!upstream.ok) {
        const errText = await upstream.text()
        console.warn('[TTS-stream] upstream failed', upstream.status, errText.slice(0, 300))
        return res.status(502).json({ error: 'Gemini TTS stream unavailable', details: errText.slice(0, 500) })
      }

      const reader = upstream.body.getReader()
      const decoder = new TextDecoder()
      let sseBuf = ''
      let headersSent = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        sseBuf += decoder.decode(value, { stream: true })
        const lines = sseBuf.split('\n')
        sseBuf = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (!raw || raw === '[DONE]') continue

          let parsed
          try { parsed = JSON.parse(raw) } catch { continue }

          const part = parsed.candidates?.[0]?.content?.parts?.[0]
          const inlineData = part?.inlineData || part?.inline_data
          if (!inlineData?.data) continue

          if (!headersSent) {
            const mime = inlineData.mimeType || inlineData.mime_type || ''
            const rateMatch = mime.match(/rate=(\d+)/)
            const sampleRate = rateMatch ? rateMatch[1] : '24000'
            res.setHeader('Content-Type', 'audio/pcm')
            res.setHeader('X-Sample-Rate', sampleRate)
            res.setHeader('Transfer-Encoding', 'chunked')
            res.setHeader('Cache-Control', 'no-cache, no-transform')
            res.setHeader('X-Accel-Buffering', 'no')
            res.flushHeaders()
            headersSent = true
          }

          const pcmBytes = Buffer.from(inlineData.data, 'base64')
          if (!res.writableEnded) {
            res.write(pcmBytes)
          }
        }
      }

      if (!headersSent) {
        return res.status(502).json({ error: 'No audio data received from Gemini TTS stream' })
      }

      if (!res.writableEnded) res.end()
      return
    } catch (err) {
      console.error('[TTS-stream] Unexpected error:', err)
      if (!res.headersSent) {
        res.status(500).json({ error: err.message })
      } else if (!res.writableEnded) {
        res.end()
      }
      return
    }
  }

  return res.status(429).json({ error: 'All TTS API keys quota exhausted' })
})

// ── POST /api/chat/reset ─────────────────────────────────────────
/**
 * Reset the user's interview session (call at interview start).
 */
router.post('/reset', requireAuth, (req, res) => {
  const userId = req.user.id
  const {
    position,
    jobDescription,
    language,
    duration,
    resumeSnapshot = '',
    roleTrack = 'work',
    interviewerStyle = 'balanced',
  } = req.body ?? {}
  const resumeTrim = typeof resumeSnapshot === 'string'
    ? resumeSnapshot.trim().slice(0, 50_000)
    : ''

  sessionStore.init(userId, {
    position,
    jobDescription,
    language,
    duration,
    resumeSnapshot: resumeTrim,
    roleTrack,
    interviewerStyle: normalizeInterviewerStyle(interviewerStyle),
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
    phase: session.phase,
    questionCount: session.questionCount,
    technicalCount: session.technicalCount,
    behavioralCount: session.behavioralCount,
    exploreCount: session.exploreCount ?? 0,
    planIndex: session.planIndex ?? 0,
    planLength: planLen,
    maxQuestions: maxQ,
    progress: planLen ? Math.round(((session.planIndex ?? 0) / planLen) * 100) : 0,
    interviewerName: session.interviewerName,
    interviewerStyle: session.config?.interviewerStyle || 'balanced',
  })
})

export default router
