import { WebSocket, WebSocketServer } from 'ws'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { GoogleGenAI, Modality } from '@google/genai'
import {
  getInterviewerStylePrompt,
  getInterviewerVoice,
  normalizeInterviewerStyle,
} from '../config/interviewerStyles.js'
import { interviewerTypeInstruction, normalizeInterviewerType } from '../config/interviewerTypes.js'
import { getMaxQuestions } from '../agents/utils.js'
import { supabaseForUser } from '../lib/supabase.js'
import {
  loadInterviewSession,
  sanitizeMessages,
} from '../lib/interviewSessionStore.js'
import { expireFormalInterviewIfDue } from '../lib/interviewLearning.js'
import { recordInterviewEvent } from '../lib/interviewEvents.js'
import { trackServerEvent } from '../lib/analytics.js'
import { createLiveTurnTimer } from '../lib/liveTurnTiming.js'
import { persistLiveTurn } from '../lib/liveTurnPersistence.js'
import { createLiveDiagnostics, safeLiveMessage as safeErrorMessage } from '../lib/liveDiagnostics.js'

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

function buildSystemInstruction(config = {}, transcript = []) {
  const language = config.language === 'Deutsch'
    ? 'German'
    : config.language === 'Chinese'
      ? 'Mandarin Chinese using Simplified Chinese'
      : 'English'
  const position = String(config.position || 'the target role').slice(0, 500)
  const jobDescription = String(config.jobDescription || '').slice(0, 15_000)
  const resume = String(config.resumeSnapshot || '').slice(0, 25_000)
  const duration = Number(config.duration) || 10
  const plannedQuestions = getMaxQuestions(duration)
  const deadlineMs = config.deadlineAt ? new Date(config.deadlineAt).getTime() : NaN
  const remainingMinutes = Number.isFinite(deadlineMs)
    ? Math.max(0, Math.ceil((deadlineMs - Date.now()) / 60_000))
    : duration
  const interviewerStyle = normalizeInterviewerStyle(config.interviewerStyle)
  const interviewerType = normalizeInterviewerType(config.interviewerType)
  const practiceMode = config.mode === 'practice'
  const context = [
    `Target role: ${position}`,
    jobDescription ? `Job description:\n${jobDescription}` : '',
    resume ? `Candidate resume/context:\n${resume}` : '',
  ].filter(Boolean).join('\n\n').slice(0, MAX_CONTEXT_CHARS)
  const history = sanitizeMessages(transcript)
    .slice(-12)
    .map(message => `${message.role === 'assistant' ? 'Interviewer' : 'Candidate'}: ${message.content}`)
    .join('\n')
    .slice(0, 12_000)

  const speakingStyle = `${getInterviewerStylePrompt(interviewerStyle)}

Voice delivery: sound like a natural face-to-face conversation, with semantic phrasing, subtle pauses, and varied intonation appropriate to the selected interviewer style. Avoid an announcer-like, customer-service, or robotic cadence.`

  // Practice Live only reads questions the application chose, so it needs no resume, job description or history.
  if (practiceMode) {
    return `You are Anna Müller, an experienced interviewer at a German company.
PRACTICE CONTROL MODE: This session is untimed and the application controls the question route. When a control message asks you to read a practice question, read only that question naturally and exactly once. After the candidate answers, remain completely silent and wait for the application's next control message. Never acknowledge the answer, ask a follow-up, or advance to another question on your own.
Speak entirely in ${language}.
Never mention the interview language or tell the candidate which language to answer in; simply speak it.
${speakingStyle}`
  }

  return `You are Anna Müller, an experienced interviewer at a German company.
Conduct a realistic ${duration}-minute interview entirely in ${language}.
The server-enforced deadline is in approximately ${remainingMinutes} minutes. Plan about ${plannedQuestions} core questions, pace the full interview to finish before that deadline, and shorten or skip optional follow-ups when time is running short.
Speak naturally and concisely. Ask exactly one question at a time.
Never mention the interview language or tell the candidate which language to answer in; simply speak it.
${speakingStyle}
${interviewerTypeInstruction(interviewerType)}
${history
    ? 'This is a reconnected interview. Continue from the saved conversation and do not repeat the greeting or earlier questions.'
    : 'Start with a brief greeting and ask the candidate to introduce themselves.'}
Then adapt follow-up questions to their previous answers, resume, target role, and job description.
Stay strictly within the selected interviewer type while adapting follow-up questions.
Do not explain your internal plan. Do not give feedback during the interview.
If the candidate asks to repeat or clarify, respond naturally in ${language}.
Keep most turns below 60 words so the conversation remains interactive.

${context}${history ? `\n\nSaved conversation:\n${history}` : ''}`
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

export function attachInterviewLiveSocket(server, { allowedOrigins = [], services = {} } = {}) {
  const verifyToken = services.verifyToken || verifyAccessToken
  const userDb = services.userDb || supabaseForUser
  const loadSession = services.loadSession || loadInterviewSession
  const expireIfDue = services.expireIfDue || expireFormalInterviewIfDue
  const persistTurn = services.persistTurn || persistLiveTurn
  const connectLive = services.connectLive || (options => new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }).live.connect(options))
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
    let interviewId = null
    let interviewUserId = null
    let sessionDb = null
    let checkpoint = null
    let stateVersion = 0
    let persistedTranscript = []
    let persistChain = Promise.resolve()
    let practiceSpeechAllowed = false
    let browserClosed = false
    let upstreamClosed = false
    let closingLive = false
    let lastPongAt = Date.now()
    let responseTimer = null
    let turnAudioChunks = 0
    const connectionId = randomUUID()
    const diagnostics = createLiveDiagnostics(() => ({
      connectionId, interviewId, userId: interviewUserId, model: LIVE_MODEL,
      mode: checkpoint?.config?.mode, stateVersion,
    }), services.diagnostics)
    diagnostics.emit('live_browser_connected')
    const turnTimer = createLiveTurnTimer()

    const clearResponseTimer = () => {
      clearTimeout(responseTimer)
      responseTimer = null
    }
    const expectResponse = () => {
      clearResponseTimer()
      if (checkpoint?.config?.mode === 'practice' && !practiceSpeechAllowed) return
      responseTimer = setTimeout(() => {
        diagnostics.emit('live_response_timeout', { timeoutMs: 30_000 }, 'warn')
        sendJson(socket, { type: 'error', code: 'LIVE_RESPONSE_TIMEOUT', fatal: false, message: 'The live interview has not returned audio. Please retry the connection.' })
      }, 30_000)
    }

    const authTimer = setTimeout(() => {
      if (!authenticated) {
        diagnostics.emit('live_setup_timeout', { stage: interviewUserId ? 'upstream' : 'auth' }, 'warn')
        socket.close(1008, 'Authentication timeout')
      }
    }, 10_000)

    const closeLive = () => {
      closingLive = true
      clearResponseTimer()
      try { liveSession?.close() } catch { /* ignore */ }
      liveSession = null
    }

    const heartbeat = setInterval(() => {
      if (Date.now() - lastPongAt > 60_000) {
        diagnostics.emit('live_browser_heartbeat_timeout', {}, 'warn')
        socket.terminate()
        return
      }
      if (socket.readyState === WebSocket.OPEN) socket.ping()
      diagnostics.emit('live_connection_health')
    }, 30_000)
    socket.on('pong', () => { lastPongAt = Date.now() })

    socket.on('close', (code, reason) => {
      browserClosed = true
      clearTimeout(authTimer)
      clearInterval(heartbeat)
      diagnostics.emit('live_browser_closed', {
        closeCode: code, closeReason: safeErrorMessage({ message: reason?.toString() }, 'No close reason'),
        upstreamClosed,
      }, code === 1000 ? 'info' : 'warn')
      closeLive()
    })

    socket.on('error', (error) => {
      diagnostics.emit('live_browser_error', { errorMessage: safeErrorMessage(error, 'Browser socket error') }, 'error')
      closeLive()
      socket.terminate()
    })

    socket.on('message', async (raw, isBinary) => {
      try {
        if (!authenticated) {
          if (isBinary || connecting) return
          const message = JSON.parse(raw.toString())
          if (message.type !== 'start') throw new Error('First message must be start')
          connecting = true

          const user = await verifyToken(message.token)
          if (!user) {
            diagnostics.emit('live_auth_rejected', {}, 'warn')
            socket.close(1008, 'Invalid or expired token')
            return
          }

          interviewId = String(message.config?.interviewId || '').trim()
          if (!interviewId) {
            socket.close(1008, 'interviewId is required')
            return
          }
          interviewUserId = user.id
          sessionDb = userDb(message.token)
          await expireIfDue(sessionDb, interviewId, interviewUserId)
          const loaded = await loadSession(sessionDb, interviewId, interviewUserId)
          checkpoint = loaded.checkpoint
          stateVersion = loaded.stateVersion
          persistedTranscript = loaded.transcript
          if (!['active', 'draft'].includes(loaded.interview.status)) {
            diagnostics.emit('live_start_rejected', { interviewStatus: loaded.interview.status }, 'warn')
            socket.close(1008, `Interview is ${loaded.interview.status}`)
            return
          }

          const apiKey = process.env.GEMINI_API_KEY
          if (!apiKey && !services.connectLive) throw new Error('GEMINI_API_KEY is not configured')
          const persistedConfig = checkpoint.config
          const interviewerStyle = normalizeInterviewerStyle(persistedConfig.interviewerStyle)
          const liveVoice = liveVoiceFor(persistedConfig.language, interviewerStyle)

          diagnostics.emit('live_upstream_connecting')
          liveSession = await connectLive({
            model: LIVE_MODEL,
            callbacks: {
              onmessage(serverMessage) {
                if (browserClosed || closingLive) return
                diagnostics.mark('serverMessage')
                if (serverMessage?.goAway) {
                  diagnostics.emit('live_upstream_go_away', { timeLeft: String(serverMessage.goAway.timeLeft || '').slice(0, 40) }, 'warn')
                }
                const content = serverMessage?.serverContent
                if (!content) return
                const practiceMode = checkpoint?.config?.mode === 'practice'
                const relayModelOutput = !practiceMode || practiceSpeechAllowed

                const inputDelta = content.inputTranscription?.text || ''
                if (inputDelta) {
                  diagnostics.mark('inputTranscript')
                  expectResponse()
                  turnTimer.onInputTranscript()
                  inputTranscript = appendTranscript(inputTranscript, inputDelta)
                  sendJson(socket, { type: 'input_transcript', text: inputTranscript })
                }

                const outputDelta = content.outputTranscription?.text || ''
                if (outputDelta && relayModelOutput) {
                  outputTranscript = appendTranscript(outputTranscript, outputDelta)
                  sendJson(socket, { type: 'output_transcript', text: outputTranscript })
                }

                if (relayModelOutput) {
                  for (const part of content.modelTurn?.parts || []) {
                    const inline = part.inlineData || part.inline_data
                    if (inline?.data) {
                      diagnostics.mark('outputAudio')
                      turnAudioChunks++
                      clearResponseTimer()
                      turnTimer.onOutputAudio()
                      sendJson(socket, {
                        type: 'audio',
                        data: inline.data,
                        mimeType: inline.mimeType || inline.mime_type || 'audio/pcm;rate=24000',
                      })
                    }
                  }
                }

                if (content.interrupted) {
                  diagnostics.emit('live_turn_interrupted')
                  sendJson(socket, { type: 'interrupted' })
                }
                if (content.turnComplete) {
                  clearResponseTimer()
                  diagnostics.mark('turnComplete')
                  const timing = turnTimer.onTurnComplete()
                  if (timing && !practiceMode) {
                    // Baseline latency for the formal-interview orchestration
                    // decision (docs/06-决策与方案/进行中/正式模拟对话编排方案.md).
                    void recordInterviewEvent({
                      interviewId,
                      userId: interviewUserId,
                      eventType: 'live_turn_timing',
                      stage: 'live',
                      model: LIVE_MODEL,
                      durationMs: timing.inputToFirstAudioMs,
                      metadata: timing,
                    })
                  }
                  const completedInput = inputTranscript.trim()
                  const completedOutput = outputTranscript.trim()
                  diagnostics.emit('live_turn_complete', {
                    inputChars: completedInput.length, outputChars: completedOutput.length,
                    outputSuppressed: !relayModelOutput, turnAudioChunks,
                    ...(timing || {}),
                  })
                  if (completedInput && relayModelOutput && !turnAudioChunks) diagnostics.emit('live_turn_without_audio', {}, 'warn')
                  turnAudioChunks = 0
                  sendJson(socket, {
                    type: 'turn_complete',
                    inputText: completedInput,
                    outputText: completedOutput,
                  })
                  inputTranscript = ''
                  outputTranscript = ''

                  // Practice answers are submitted through the session API and
                  // tracked there; formal answers only exist on this socket.
                  if (completedInput && !practiceMode) {
                    trackServerEvent(null, 'interview_answer_submitted', {
                      userId: interviewUserId,
                      interviewId,
                      props: { mode: 'formal', channel: 'live' },
                    })
                  }

                  if (practiceMode) {
                    practiceSpeechAllowed = false
                    return
                  }

                  const turnMessages = sanitizeMessages([
                    { role: 'user', content: completedInput },
                    { role: 'assistant', content: completedOutput },
                  ])
                  if (turnMessages.length) {
                    const requestKey = `live-${randomUUID()}`
                    persistChain = persistChain.then(async () => {
                      const result = await persistTurn(sessionDb, {
                        interviewId, userId: interviewUserId, requestKey,
                        inputText: completedInput, outputText: completedOutput,
                        onDiagnostic: (event, fields) => diagnostics.emit(event, { ...fields, requestId: requestKey }, 'warn'),
                      })
                      stateVersion = result.stateVersion ?? stateVersion
                      diagnostics.emit('live_turn_persisted', { requestId: requestKey, stateVersion })
                      if (result.deadlineComplete) sendJson(socket, { type: 'deadline_complete' })
                    }).catch(error => {
                      diagnostics.emit('live_persist_failed', {
                        requestId: requestKey, stage: error.stage || 'load',
                        errorCode: error.code || error.name,
                        errorMessage: safeErrorMessage(error, 'Persistence failed'),
                        currentVersion: error.currentVersion,
                      }, 'error')
                      sendJson(socket, { type: 'error', code: 'LIVE_PERSIST_FAILED', fatal: false, message: 'Interview state could not be saved' })
                    })
                  }
                }
              },
              onerror(event) {
                const message = safeErrorMessage(event, 'Gemini Live connection error')
                diagnostics.emit('live_upstream_error', { errorMessage: message }, 'error')
                if (!closingLive) {
                  sendJson(socket, { type: 'error', code: 'LIVE_UPSTREAM_ERROR', fatal: true, message })
                  socket.close(1011, 'Gemini Live connection error')
                  closeLive()
                }
              },
              onclose(event) {
                upstreamClosed = true
                clearResponseTimer()
                const reason = safeErrorMessage({ message: event?.reason }, 'Gemini Live connection closed')
                diagnostics.emit('live_upstream_closed', {
                  closeCode: event?.code, closeReason: reason, wasClean: event?.wasClean,
                  pendingInputChars: inputTranscript.length, pendingOutputChars: outputTranscript.length,
                  initiatedBy: closingLive || browserClosed ? 'server' : 'upstream',
                }, closingLive || browserClosed ? 'info' : 'warn')
                liveSession = null
                if (!closingLive && !browserClosed) {
                  // Close the browser transport too: older clients ignore the
                  // JSON notification and would otherwise stay falsely connected.
                  sendJson(socket, { type: 'closed', code: 'LIVE_UPSTREAM_CLOSED', closeCode: event?.code, reason })
                  socket.close(1012, 'Gemini Live connection closed')
                }
              },
            },
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: liveVoice } },
              },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              contextWindowCompression: { slidingWindow: {} },
              systemInstruction: buildSystemInstruction(persistedConfig, persistedTranscript),
              thinkingConfig: { thinkingLevel: 'minimal' },
            },
          })

          if (browserClosed || upstreamClosed || closingLive || socket.readyState !== WebSocket.OPEN) {
            closeLive()
            return
          }

          authenticated = true
          connecting = false
          clearTimeout(authTimer)
          diagnostics.emit('live_ready')
          sendJson(socket, { type: 'ready', model: LIVE_MODEL, interviewId, stateVersion, connectionId })
          if (persistedConfig.mode !== 'practice') expectResponse()
          if (persistedConfig.mode !== 'practice') liveSession.sendRealtimeInput({
            text: persistedTranscript.length
              ? 'Resume the saved interview naturally with the next appropriate question.'
              : persistedConfig.language === 'Deutsch'
                ? 'Beginne jetzt das Vorstellungsgespräch.'
                : persistedConfig.language === 'Chinese'
                  ? '现在开始面试，请你全程用普通话主持。'
                  : 'Begin the interview now.',
          })
          return
        }

        if (!liveSession || closingLive || upstreamClosed) return
        if (isBinary) {
          // In practice mode, microphone audio is transcription-only. Gemini may
          // internally detect a pause as a completed turn, but no resulting model
          // speech is allowed through until the application sends a control prompt.
          if (checkpoint?.config?.mode === 'practice') practiceSpeechAllowed = false
          const pcm = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
          diagnostics.mark('inputAudio', pcm.byteLength)
          liveSession.sendRealtimeInput({
            audio: { data: pcm.toString('base64'), mimeType: 'audio/pcm;rate=16000' },
          })
          return
        }

        const message = JSON.parse(raw.toString())
        if (message.type === 'text' && String(message.text || '').trim()) {
          const text = String(message.text).trim()
          if (checkpoint?.config?.mode === 'practice') {
            practiceSpeechAllowed = text.startsWith('[PRACTICE_CONTROL]')
          }
          diagnostics.emit('live_text_input', { inputChars: text.length, speechAllowed: practiceSpeechAllowed })
          expectResponse()
          liveSession.sendRealtimeInput({ text })
        } else if (message.type === 'audio_end') {
          if (checkpoint?.config?.mode === 'practice') practiceSpeechAllowed = false
          liveSession.sendRealtimeInput({ audioStreamEnd: true })
          diagnostics.emit('live_audio_stream_ended')
          expectResponse()
        } else if (message.type === 'interrupt') {
          liveSession.sendRealtimeInput({ activityStart: {} })
        } else if (message.type === 'client_diagnostic') {
          const allowedCodes = ['LIVE_AUDIO_PLAYBACK_FAILED', 'LIVE_AUDIO_CONTEXT_SUSPENDED', 'LIVE_MIC_FAILED']
          if (allowedCodes.includes(message.code)) diagnostics.emit('live_client_audio_error', { errorCode: message.code }, 'warn')
        }
      } catch (error) {
        const message = safeErrorMessage(error, 'Live session error')
        diagnostics.emit('live_message_error', { stage: authenticated ? 'input' : 'setup', errorMessage: message }, 'error')
        sendJson(socket, { type: 'error', code: authenticated ? 'LIVE_INPUT_FAILED' : 'LIVE_SETUP_FAILED', fatal: true, message })
        socket.close(1011, authenticated ? 'Live input failed' : 'Live session setup failed')
        closeLive()
      }
    })
  })

  return wss
}
