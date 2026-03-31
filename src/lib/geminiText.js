import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { ChatVertexAI } from '@langchain/google-vertexai'

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
  let llm

  if (!apiKey) {
    const projectId = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '530979174916'
    const location = process.env.GCP_LOCATION || 'us-central1'
    // Force Enterprise stable (Vertex AI)
    llm = new ChatVertexAI({
      model: opts.model || process.env.GCP_MODEL || 'gemini-1.5-flash-001',
      project: projectId,
      location: location,
      temperature: opts.temperature ?? 0.35,
      maxOutputTokens: opts.maxOutputTokens ?? 8192,
    })
  } else {
    // Fallback to Consumer / Free tier only if key exists
    llm = new ChatGoogleGenerativeAI({
      model: opts.model || process.env.GEMINI_MODEL || 'gemini-2.0-flash',
      apiKey,
      temperature: opts.temperature ?? 0.35,
      streaming: false,
      maxOutputTokens: opts.maxOutputTokens ?? 8192,
    })
  }

  const res = await llm.invoke([
    { role: 'system', content: system },
    { role: 'user', content: user },
  ])

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
