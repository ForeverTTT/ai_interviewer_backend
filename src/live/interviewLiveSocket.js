import { WebSocket, WebSocketServer } from 'ws'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI, Modality } from '@google/genai'
import {
  getInterviewerStylePrompt,
  getInterviewerVoice,
  normalizeInterviewerStyle,
} from '../config/interviewerStyles.js'

const LIVE_PATH = '/api/chat/live'
const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview'
const MAX_CONTEXT_CHARS = 50_000

const LIVE_VOICE_OVERRIDES = {
  English: process.env.GEMINI_LIVE_VOICE_EN || process.env.GEMINI_LIVE_VOICE,
  Deutsch: process.env.GEMINI_LIVE_VOICE_DE,
  Chinese: process.env.GEMINI_LIVE_VOICE_ZH,
}

function liveVoiceFor(language, interviewerStyle) {
  return LIVE_VOICE_OVERRIDES[language] || getInterviewerVoice(interviewerStyle, language)
}

function safeErrorMessage(error, fallback) {
  const message = typeof error?.message === 'string' ? error.message.trim() : ''
  // SDK WebSocket ErrorEvent objects can contain the full request URL, including
  // the API key. Only accept a short plain message and never stringify the event.
  if (message && !/https?:|wss?:|[?&]key=/i.test(message)) return message.slice(0, 300)
  return fallback
}

function sendJson(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload))
}

function appendTranscript(current, delta) {
  const next = String(delta || '')
  if (!next) return current
  if (!current) return next
  if (next.startsWith(current)) return next
  return current + next
}

function buildSystemInstruction(config = {}) {
  const language = config.language === 'Deutsch'
    ? 'German'
    : config.language === 'Chinese'
      ? 'Mandarin Chinese using Simplified Chinese'
      : 'English'
  const position = String(config.position || 'the target role').slice(0, 500)
  const jobDescription = String(config.jobDescription || '').slice(0, 15_000)
  const resume = String(config.resumeSnapshot || '').slice(0, 25_000)
  const duration = Number(config.duration) || 10
  const interviewerStyle = normalizeInterviewerStyle(config.interviewerStyle)
  const context = [
    `Target role: ${position}`,
    jobDescription ? `Job description:\n${jobDescription}` : '',
    resume ? `Candidate resume/context:\n${resume}` : '',
  ].filter(Boolean).join('\n\n').slice(0, MAX_CONTEXT_CHARS)

  const speakingStyle = `${getInterviewerStylePrompt(interviewerStyle)}

Voice delivery: sound like a natural face-to-face conversation, with semantic phrasing, subtle pauses, and varied intonation appropriate to the selected interviewer style. Avoid an announcer-like, customer-service, or robotic cadence.`

  return `You are Anna Müller, an experienced interviewer at a German company.
Conduct a realistic ${duration}-minute interview entirely in ${language}.
Speak naturally and concisely. Ask exactly one question at a time.
${speakingStyle}
Start with a brief greeting and ask the candidate to introduce themselves.
Then adapt follow-up questions to their previous answers, resume, target role, and job description.
Cover experience, role-specific or technical depth, and behavioral competencies.
Do not explain your internal plan. Do not give feedback during the interview.
If the candidate asks to repeat or clarify, respond naturally in ${language}.
Keep most turns below 60 words so the conversation remains interactive.

${context}`
}

async function verifyAccessToken(token) {
  if (!token) return null
  const client = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const { data: { user }, error } = await client.auth.getUser(token)
  if (error || !user) return null
  return user
}

export function attachInterviewLiveSocket(server, { allowedOrigins = [] } = {}) {
  const wss = new WebSocketServer({ server, path: LIVE_PATH })

  wss.on('connection', (socket, request) => {
    const origin = request.headers.origin || ''
    if (origin && allowedOrigins.length && !allowedOrigins.includes(origin)) {
      socket.close(1008, 'Origin not allowed')
      return
    }

    let liveSession = null
    let authenticated = false
    let connecting = false
    let inputTranscript = ''
    let outputTranscript = ''

    const authTimer = setTimeout(() => {
      if (!authenticated) socket.close(1008, 'Authentication timeout')
    }, 10_000)

    const closeLive = () => {
      try { liveSession?.close() } catch { /* ignore */ }
      liveSession = null
    }

    socket.on('close', () => {
      clearTimeout(authTimer)
      closeLive()
    })

    socket.on('error', (error) => {
      console.error('[Live WS] Browser socket error:', error.message)
      closeLive()
    })

    socket.on('message', async (raw, isBinary) => {
      try {
        if (!authenticated) {
          if (isBinary || connecting) return
          const message = JSON.parse(raw.toString())
          if (message.type !== 'start') throw new Error('First message must be start')
          connecting = true

          const user = await verifyAccessToken(message.token)
          if (!user) {
            socket.close(1008, 'Invalid or expired token')
            return
          }

          const apiKey = process.env.GEMINI_API_KEY
          if (!apiKey) throw new Error('GEMINI_API_KEY is not configured')
          const ai = new GoogleGenAI({ apiKey })
          const interviewerStyle = normalizeInterviewerStyle(message.config?.interviewerStyle)
          const liveVoice = liveVoiceFor(message.config?.language, interviewerStyle)

          liveSession = await ai.live.connect({
            model: LIVE_MODEL,
            callbacks: {
              onmessage(serverMessage) {
                const content = serverMessage?.serverContent
                if (!content) return

                const inputDelta = content.inputTranscription?.text || ''
                if (inputDelta) {
                  inputTranscript = appendTranscript(inputTranscript, inputDelta)
                  sendJson(socket, { type: 'input_transcript', text: inputTranscript })
                }

                const outputDelta = content.outputTranscription?.text || ''
                if (outputDelta) {
                  outputTranscript = appendTranscript(outputTranscript, outputDelta)
                  sendJson(socket, { type: 'output_transcript', text: outputTranscript })
                }

                for (const part of content.modelTurn?.parts || []) {
                  const inline = part.inlineData || part.inline_data
                  if (inline?.data) {
                    sendJson(socket, {
                      type: 'audio',
                      data: inline.data,
                      mimeType: inline.mimeType || inline.mime_type || 'audio/pcm;rate=24000',
                    })
                  }
                }

                if (content.interrupted) sendJson(socket, { type: 'interrupted' })
                if (content.turnComplete) {
                  sendJson(socket, {
                    type: 'turn_complete',
                    inputText: inputTranscript.trim(),
                    outputText: outputTranscript.trim(),
                  })
                  inputTranscript = ''
                  outputTranscript = ''
                }
              },
              onerror(event) {
                const message = safeErrorMessage(event, 'Gemini Live connection error')
                console.error('[Live WS] Gemini error:', message)
                sendJson(socket, { type: 'error', message })
              },
              onclose(event) {
                sendJson(socket, { type: 'closed', reason: event?.reason || 'Gemini Live connection closed' })
              },
            },
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: liveVoice } },
              },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              systemInstruction: buildSystemInstruction(message.config),
              thinkingConfig: { thinkingLevel: 'minimal' },
            },
          })

          authenticated = true
          connecting = false
          clearTimeout(authTimer)
          sendJson(socket, { type: 'ready', model: LIVE_MODEL, userId: user.id })
          liveSession.sendRealtimeInput({
            text: message.config?.language === 'Deutsch'
              ? 'Beginne jetzt das Vorstellungsgespräch.'
              : message.config?.language === 'Chinese'
                ? '现在开始面试。请全程使用普通话和简体中文。'
                : 'Begin the interview now.',
          })
          return
        }

        if (!liveSession) return
        if (isBinary) {
          const pcm = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
          liveSession.sendRealtimeInput({
            audio: { data: pcm.toString('base64'), mimeType: 'audio/pcm;rate=16000' },
          })
          return
        }

        const message = JSON.parse(raw.toString())
        if (message.type === 'text' && String(message.text || '').trim()) {
          liveSession.sendRealtimeInput({ text: String(message.text).trim() })
        } else if (message.type === 'audio_end') {
          liveSession.sendRealtimeInput({ audioStreamEnd: true })
        } else if (message.type === 'interrupt') {
          liveSession.sendRealtimeInput({ activityStart: {} })
        }
      } catch (error) {
        const message = safeErrorMessage(error, 'Live session error')
        console.error('[Live WS] Message error:', message)
        sendJson(socket, { type: 'error', message })
        if (!authenticated) socket.close(1011, 'Live session setup failed')
      }
    })
  })

  return wss
}
