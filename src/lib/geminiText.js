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
      const projectId = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '530979174916'
      const location = process.env.GCP_LOCATION || 'us-central1'
      const fields = {
        model,
        project: projectId,
        location,
        maxOutputTokens: opts.maxOutputTokens ?? 8192,
      }
      if (supportsSamplingTemperature(model)) fields.temperature = opts.temperature ?? 0.35
      return new ChatVertexAI(fields)
    }

    const fields = {
      model,
      apiKey,
      streaming: false,
      maxOutputTokens: opts.maxOutputTokens ?? 8192,
    }
    if (supportsSamplingTemperature(model)) fields.temperature = opts.temperature ?? 0.35
    return new ChatGoogleGenerativeAI(fields)
  }

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
  const res = await invokeWithGeminiQuotaFallback(
    primaryModel,
    (model) => createLlm(model).invoke(messages),
    {
      onModelAttempt: opts.onModelAttempt,
      onFallback: opts.onFallback,
    },
  )

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
