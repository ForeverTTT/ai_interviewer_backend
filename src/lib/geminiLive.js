import { GoogleGenAI, Modality } from '@google/genai'
import { AIMessage } from '@langchain/core/messages'

const DEFAULT_LIVE_MODEL = 'gemini-3.1-flash-live-preview'
const DEFAULT_LIVE_VOICE = 'Kore'
const DEFAULT_TIMEOUT_MS = 45_000

function messageText(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content ?? '')
  return content
    .map((part) => (typeof part === 'string' ? part : part?.text ?? ''))
    .join('')
}

function messageRole(message) {
  const type = message?._getType?.() || message?.type || message?.role
  if (type === 'ai' || type === 'assistant') return 'Interviewer'
  if (type === 'system') return 'System'
  return 'Candidate'
}

function splitMessages(messages) {
  const system = []
  const conversation = []

  for (const message of messages || []) {
    const text = messageText(message).trim()
    if (!text) continue
    if (messageRole(message) === 'System') system.push(text)
    else conversation.push(`${messageRole(message)}: ${text}`)
  }

  return {
    systemInstruction: system.join('\n\n'),
    prompt: conversation.join('\n\n'),
  }
}

/**
 * Run one interview turn through Gemini Live.
 *
 * Gemini 3.1 Flash Live only supports AUDIO output. We enable output audio
 * transcription and return that transcript to the existing LangGraph/SSE UI.
 */
export async function invokeGeminiLive(messages, opts = {}) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is required for Gemini Live')

  const model = opts.model || process.env.GEMINI_LIVE_MODEL || DEFAULT_LIVE_MODEL
  const voice = opts.voice || process.env.GEMINI_LIVE_VOICE || DEFAULT_LIVE_VOICE
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS
  const { systemInstruction, prompt } = splitMessages(messages)
  if (!prompt) throw new Error('Gemini Live requires at least one user message')

  const ai = new GoogleGenAI({ apiKey })
  let session
  let settled = false
  let transcript = ''
  let resolveTurn
  let rejectTurn

  const turn = new Promise((resolve, reject) => {
    resolveTurn = resolve
    rejectTurn = reject
  })

  const finish = (error) => {
    if (settled) return
    settled = true
    if (error) rejectTurn(error)
    else if (transcript.trim()) resolveTurn(transcript.trim())
    else rejectTurn(new Error('Gemini Live completed without an output transcript'))
  }

  const timeout = setTimeout(() => {
    finish(new Error(`Gemini Live timed out after ${timeoutMs}ms`))
    try { session?.close() } catch { /* ignore */ }
  }, timeoutMs)

  try {
    session = await ai.live.connect({
      model,
      callbacks: {
        onmessage(message) {
          const serverContent = message?.serverContent
          const text = serverContent?.outputTranscription?.text || ''
          if (text) transcript += text
          if (serverContent?.turnComplete) finish()
        },
        onerror(event) {
          finish(new Error(event?.message || 'Gemini Live connection error'))
        },
        onclose(event) {
          if (!settled) finish(new Error(event?.reason || 'Gemini Live connection closed before turn completion'))
        },
      },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
        },
        outputAudioTranscription: {},
        systemInstruction: systemInstruction || undefined,
        thinkingConfig: { thinkingLevel: 'minimal' },
      },
    })

    session.sendRealtimeInput({ text: prompt })
    return await turn
  } finally {
    clearTimeout(timeout)
    try { session?.close() } catch { /* ignore */ }
  }
}

export function createGeminiLiveTextModel(opts = {}) {
  return {
    async invoke(messages) {
      const content = await invokeGeminiLive(messages, opts)
      return new AIMessage({
        content,
        response_metadata: {
          model_provider: 'google_genai_live',
          model_name: opts.model || process.env.GEMINI_LIVE_MODEL || DEFAULT_LIVE_MODEL,
        },
      })
    },
  }
}
