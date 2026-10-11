import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { ChatVertexAI } from '@langchain/google-vertexai'
import {
  invokeWithGeminiQuotaFallback,
  supportsSamplingTemperature,
} from './geminiFallback.js'

function getApiKey() {
  return process.env.GEMINI_API_KEY
}

export function assertGeminiConfigured(res) {
    // FORCE TRUE since we have a hardcoded fallback for aiinterviewer-491711
    return true
}

/**
 * Non-streaming completion for JSON / markdown generation.
 * Switches between Vertex AI (GCP) and Google AI Studio based on .env
 */
export async function invokeGemini(system, user, opts = {}) {
  // Always use Vertex unless explicitly provided a GEMINI_API_KEY
  const apiKey = getApiKey()
  const primaryModel = opts.model
    || (apiKey ? process.env.GEMINI_MODEL : process.env.GCP_MODEL)
    || 'gemini-3.7-flash'

  const createLlm = (model) => {
    if (!apiKey) {
      const projectId = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'aiinterviewer-491711-7b1cf'
      const location = process.env.GCP_LOCATION || 'us-central1'
      const fields = {
        model,
        project: projectId,
        location,
        maxOutputTokens: opts.maxOutputTokens ?? 8192,
        maxRetries: 0,
      }
      if (supportsSamplingTemperature(model)) fields.temperature = opts.temperature ?? 0.35
      return new ChatVertexAI(fields)
    }

    const fields = {
      model,
      apiKey,
      streaming: false,
      maxOutputTokens: opts.maxOutputTokens ?? 8192,
      maxRetries: 0,
    }
    if (supportsSamplingTemperature(model)) fields.temperature = opts.temperature ?? 0.35
    return new ChatGoogleGenerativeAI(fields)
  }

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
  const timeoutMs = Math.max(1_000, Number(opts.timeoutMs) || 45_000)
  const attemptTimeoutMs = Math.max(1_000, Number(process.env.GEMINI_MODEL_TIMEOUT_MS) || 12_000)
  const controller = new AbortController()
  const timeoutError = Object.assign(new Error(`Gemini request timed out after ${timeoutMs}ms`), { code: 'GEMINI_TIMEOUT' })
  const totalTimer = setTimeout(() => controller.abort(timeoutError), timeoutMs)
  let onTotalAbort
  const totalAbort = new Promise((_, reject) => {
    onTotalAbort = () => reject(controller.signal.reason)
    controller.signal.addEventListener('abort', onTotalAbort, { once: true })
  })
  let res
  try {
    const invocation = invokeWithGeminiQuotaFallback(primaryModel, async model => {
      controller.signal.throwIfAborted()
      const attempt = new AbortController()
      const signal = AbortSignal.any([controller.signal, attempt.signal])
      const attemptError = Object.assign(new Error(`Gemini model ${model} timed out`), { code: 'GEMINI_MODEL_TIMEOUT' })
      const timer = setTimeout(() => attempt.abort(attemptError), attemptTimeoutMs)
      // Race as well as passing signal: some SDK transports ignore cancellation.
      let onAbort
      const aborted = new Promise((_, reject) => {
        onAbort = () => reject(signal.reason)
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      })
      try {
        signal.throwIfAborted()
        return await Promise.race([createLlm(model).invoke(messages, { signal }), aborted])
      } catch (error) {
        if (signal.aborted) throw signal.reason
        throw error
      } finally {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
      }
    }, { signal: controller.signal, onModelAttempt: opts.onModelAttempt, onFallback: opts.onFallback })
    res = await Promise.race([invocation, totalAbort])
  } finally {
    clearTimeout(totalTimer)
    controller.signal.removeEventListener('abort', onTotalAbort)
  }

  const c = res.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('')
  return String(c ?? '')
}

export function stripJsonFence(raw) {
  let s = String(raw || '').trim()
  const m = s.match(/^```(?:json)?\s*([\s\S]*?)```$/i)
  if (m) s = m[1].trim()
  return s
}
