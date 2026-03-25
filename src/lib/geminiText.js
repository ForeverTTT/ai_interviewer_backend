import { ChatGoogleGenerativeAI } from '@langchain/google-genai'

function getApiKey() {
  return process.env.GEMINI_API_KEY
}

export function assertGeminiConfigured(res) {
  if (!getApiKey()) {
    res.status(503).json({ error: 'GEMINI_API_KEY not configured', hint: 'Set GEMINI_API_KEY in backend .env' })
    return false
  }
  return true
}

/**
 * Non-streaming completion for JSON / markdown generation.
 */
export async function invokeGemini(system, user, opts = {}) {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('GEMINI_API_KEY missing')

  const llm = new ChatGoogleGenerativeAI({
    model: opts.model || 'gemini-2.0-flash',
    apiKey,
    temperature: opts.temperature ?? 0.35,
    streaming: false,
    maxOutputTokens: opts.maxOutputTokens ?? 8192,
  })

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
