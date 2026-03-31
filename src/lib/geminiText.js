import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { ChatVertexAI } from '@langchain/google-vertexai'

function getApiKey() {
  return process.env.GEMINI_API_KEY
}

export function assertGeminiConfigured(res) {
    const projectId = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT
    const hasVertex = projectId && process.env.GCP_LOCATION
    const hasKey = !!getApiKey()
    
    if (!hasKey && !hasVertex) {
      const debugInfo = `[V3-VERTEX-FIX] (IDs: GCP=${!!process.env.GCP_PROJECT_ID}, GOOGLE=${!!process.env.GOOGLE_CLOUD_PROJECT}, LOC=${!!process.env.GCP_LOCATION})`
      res.status(503).json({ 
        error: 'LLM not configured', 
        hint: `Set GCP_PROJECT_ID & GCP_LOCATION in Cloud Run. ${debugInfo}` 
      })
    return false
  }
  return true
}

/**
 * Non-streaming completion for JSON / markdown generation.
 * Switches between Vertex AI (GCP) and Google AI Studio based on .env
 */
export async function invokeGemini(system, user, opts = {}) {
  const isVertex = !!(process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT)
  let llm

  if (isVertex) {
    const projectId = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT
    const location = process.env.GCP_LOCATION || 'us-central1'
    // Enterprise stable (Vertex AI)
    llm = new ChatVertexAI({
      model: opts.model || process.env.GCP_MODEL || 'gemini-1.5-flash-002',
      project: projectId,
      location: location,
      temperature: opts.temperature ?? 0.35,
      maxOutputTokens: opts.maxOutputTokens ?? 8192,
    })
  } else {
    // Consumer / Free tier (AI Studio)
    const apiKey = getApiKey()
    if (!apiKey) {
      const debug = `[isVertex=${isVertex}, GCP=${!!process.env.GCP_PROJECT_ID}, GOOGLE=${!!process.env.GOOGLE_CLOUD_PROJECT}, LOC=${!!process.env.GCP_LOCATION}]`
      throw new Error(`GEMINI_API_KEY missing and no Vertex config found. Debug: ${debug}`)
    }
    
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
