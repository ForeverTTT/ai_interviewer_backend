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
  claimInterviewRequest,
  commitInterviewTurn,
  loadInterviewSession,
  releaseInterviewRequest,
  sanitizeMessages,
} from '../lib/interviewSessionStore.js'
import { applyInterviewAction, completeFormalAnswerAfterDeadline, expireFormalInterviewIfDue } from '../lib/interviewLearning.js'
import { recordInterviewEvent } from '../lib/interviewEvents.js'
import { createLiveTurnTimer } from '../lib/liveTurnTiming.js'

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

  return `You are Anna Müller, an experienced interviewer at a German company.
${practiceMode
    ? `PRACTICE CONTROL MODE: This session is untimed and the application controls the question route. When a control message asks you to read a practice question, read only that question naturally and exactly once. After the candidate answers, remain completely silent and wait for the application's next control message. Never acknowledge the answer, ask a follow-up, or advance to another question on your own.`
    : `Conduct a realistic ${duration}-minute interview entirely in ${language}.
The server-enforced deadline is in approximately ${remainingMinutes} minutes. Plan about ${plannedQuestions} core questions, pace the full interview to finish before that deadline, and shorten or skip optional follow-ups when time is running short.`}
Speak naturally and concisely. Ask exactly one question at a time.
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
    let interviewId = null
    let interviewUserId = null
    let sessionDb = null
    let checkpoint = null
    let stateVersion = 0
    let persistedTranscript = []
    let currentQuestionId = null
    let currentDifficulty = 'medium'
    let persistChain = Promise.resolve()
    let persistRequestKey = null
    let practiceSpeechAllowed = false
    const turnTimer = createLiveTurnTimer()

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

          interviewId = String(message.config?.interviewId || '').trim()
          if (!interviewId) {
            socket.close(1008, 'interviewId is required')
            return
          }
          interviewUserId = user.id
          sessionDb = supabaseForUser(message.token)
          await expireFormalInterviewIfDue(sessionDb, interviewId, interviewUserId)
          const loaded = await loadInterviewSession(sessionDb, interviewId, interviewUserId)
          checkpoint = loaded.checkpoint
          stateVersion = loaded.stateVersion
          persistedTranscript = loaded.transcript
          currentQuestionId = loaded.interview.current_question_id
          currentDifficulty = loaded.interview.current_difficulty
          if (!['active', 'draft'].includes(loaded.interview.status)) {
            socket.close(1008, `Interview is ${loaded.interview.status}`)
            return
          }

          const apiKey = process.env.GEMINI_API_KEY
          if (!apiKey) throw new Error('GEMINI_API_KEY is not configured')
          const ai = new GoogleGenAI({ apiKey })
          const persistedConfig = checkpoint.config
          const interviewerStyle = normalizeInterviewerStyle(persistedConfig.interviewerStyle)
          const liveVoice = liveVoiceFor(persistedConfig.language, interviewerStyle)

          liveSession = await ai.live.connect({
            model: LIVE_MODEL,
            callbacks: {
              onmessage(serverMessage) {
                const content = serverMessage?.serverContent
                if (!content) return
                const practiceMode = checkpoint?.config?.mode === 'practice'
                const relayModelOutput = !practiceMode || practiceSpeechAllowed

                const inputDelta = content.inputTranscription?.text || ''
                if (inputDelta) {
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
                      turnTimer.onOutputAudio()
                      sendJson(socket, {
                        type: 'audio',
                        data: inline.data,
                        mimeType: inline.mimeType || inline.mime_type || 'audio/pcm;rate=24000',
                      })
                    }
                  }
                }

                if (content.interrupted) sendJson(socket, { type: 'interrupted' })
                if (content.turnComplete) {
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
                  sendJson(socket, {
                    type: 'turn_complete',
                    inputText: completedInput,
                    outputText: completedOutput,
                  })
                  inputTranscript = ''
                  outputTranscript = ''

                  if (practiceMode) {
                    practiceSpeechAllowed = false
                    return
                  }

                  const turnMessages = sanitizeMessages([
                    { role: 'user', content: completedInput },
                    { role: 'assistant', content: completedOutput },
                  ])
                  if (turnMessages.length) {
                    persistChain = persistChain.then(async () => {
                      const requestKey = `live-${randomUUID()}`
                      persistRequestKey = requestKey
                      if (currentQuestionId && completedInput) {
                        const answerKey = `${requestKey}:answer`
                        const deadlineReached = checkpoint.config?.mode === 'formal'
                          && checkpoint.config?.deadlineAt
                          && new Date(checkpoint.config.deadlineAt).getTime() <= Date.now()
                        if (deadlineReached) {
                          const answerResult = await completeFormalAnswerAfterDeadline(sessionDb, {
                            interviewId,
                            userId: interviewUserId,
                            idempotencyKey: `${requestKey}:deadline-answer`,
                            answerText: completedInput,
                          })
                          stateVersion = Number(answerResult.stateVersion)
                          currentQuestionId = null
                          checkpoint = { ...checkpoint, phase: 'closed', closeReason: 'formal_deadline_answer_completed' }
                          persistedTranscript = [...persistedTranscript, { role: 'user', content: completedInput }]
                          sendJson(socket, { type: 'deadline_complete' })
                          return
                        }
                        const answerClaim = await claimInterviewRequest(sessionDb, {
                          interviewId,
                          userId: interviewUserId,
                          idempotencyKey: answerKey,
                        })
                        if (answerClaim?.claimed) {
                          const answerResult = await applyInterviewAction(sessionDb, {
                            interviewId,
                            userId: interviewUserId,
                            expectedVersion: stateVersion,
                            idempotencyKey: answerKey,
                            action: 'attempt',
                            payload: { questionId: currentQuestionId, answerText: completedInput },
                          })
                          stateVersion = Number(answerResult.stateVersion)
                          currentQuestionId = null
                        }
                      }
                      const claim = await claimInterviewRequest(sessionDb, {
                        interviewId,
                        userId: interviewUserId,
                        idempotencyKey: requestKey,
                      })
                      if (!claim?.claimed) return
                      try {
                        const nextCheckpoint = {
                          ...checkpoint,
                          phase: 'questioning',
                          liveTurnCount: (checkpoint.liveTurnCount ?? 0) + 1,
                        }
                        const nextTranscript = [...persistedTranscript, ...turnMessages]
                        const result = await commitInterviewTurn(sessionDb, {
                          interviewId,
                          userId: interviewUserId,
                          expectedVersion: stateVersion,
                          idempotencyKey: requestKey,
                          checkpoint: nextCheckpoint,
                          messages: turnMessages,
                          transcript: nextTranscript,
                        })
                        checkpoint = nextCheckpoint
                        persistedTranscript = nextTranscript
                        stateVersion = Number(result.stateVersion)
                        if (completedOutput) {
                          const questionResult = await applyInterviewAction(sessionDb, {
                            interviewId,
                            userId: interviewUserId,
                            expectedVersion: stateVersion,
                            idempotencyKey: `${requestKey}:question`,
                            action: 'question',
                            payload: {
                              questionText: completedOutput,
                              questionType: normalizeInterviewerType(checkpoint.config?.interviewerType) === 'hr'
                                ? 'behavioral'
                                : normalizeInterviewerType(checkpoint.config?.interviewerType) === 'technical'
                                  ? 'technical'
                                  : 'experience',
                              competency: 'live_interview',
                              source: 'gemini_live',
                              difficulty: currentDifficulty,
                            },
                          })
                          stateVersion = Number(questionResult.stateVersion)
                          currentQuestionId = questionResult.question?.id || currentQuestionId
                        }
                      } catch (error) {
                        await releaseInterviewRequest(sessionDb, {
                          interviewId,
                          userId: interviewUserId,
                          idempotencyKey: requestKey,
                        }).catch(() => {})
                        throw error
                      }
                    }).catch(async error => {
                      // Release any action claim left pending by a failed model,
                      // database, or connection operation so a reconnect can retry.
                      const failedBase = persistRequestKey
                      if (failedBase) {
                        await Promise.all([
                          failedBase,
                          `${failedBase}:answer`,
                          `${failedBase}:question`,
                        ].map(idempotencyKey => releaseInterviewRequest(sessionDb, {
                          interviewId,
                          userId: interviewUserId,
                          idempotencyKey,
                        }).catch(() => {})))
                      }
                      console.error('[Live WS] Persist turn failed:', safeErrorMessage(error, 'Persistence failed'))
                      sendJson(socket, { type: 'error', message: 'Interview state could not be saved' })
                    })
                  }
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
              systemInstruction: buildSystemInstruction(persistedConfig, persistedTranscript),
              thinkingConfig: { thinkingLevel: 'minimal' },
            },
          })

          authenticated = true
          connecting = false
          clearTimeout(authTimer)
          sendJson(socket, { type: 'ready', model: LIVE_MODEL, interviewId, stateVersion })
          if (persistedConfig.mode !== 'practice') liveSession.sendRealtimeInput({
            text: persistedTranscript.length
              ? 'Resume the saved interview naturally with the next appropriate question.'
              : persistedConfig.language === 'Deutsch'
                ? 'Beginne jetzt das Vorstellungsgespräch.'
                : persistedConfig.language === 'Chinese'
                  ? '现在开始面试。请全程使用普通话和简体中文。'
                  : 'Begin the interview now.',
          })
          return
        }

        if (!liveSession) return
        if (isBinary) {
          // In practice mode, microphone audio is transcription-only. Gemini may
          // internally detect a pause as a completed turn, but no resulting model
          // speech is allowed through until the application sends a control prompt.
          if (checkpoint?.config?.mode === 'practice') practiceSpeechAllowed = false
          const pcm = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
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
          liveSession.sendRealtimeInput({ text })
        } else if (message.type === 'audio_end') {
          if (checkpoint?.config?.mode === 'practice') practiceSpeechAllowed = false
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
