export function selectFinalizeMessages(requestMessages, storedTranscript) {
  if (Array.isArray(requestMessages) && requestMessages.length > 0) return requestMessages
  if (Array.isArray(storedTranscript)) return storedTranscript
  if (Array.isArray(requestMessages)) return requestMessages
  return null
}

export function shouldReuseFinalizedInterview(interview, forceRegenerate = false) {
  return !forceRegenerate && interview?.status === 'completed' && Boolean(interview?.report_json)
}

export const FINALIZE_LOCK_MS = 120_000

export function reportGenerationPolicy(env = process.env) {
  // Leave 30 seconds inside the finalize lease for hooks, parsing and storage.
  // Do not change latency budgets for practice questions or other text tools.
  const timeoutMs = Math.min(FINALIZE_LOCK_MS - 30_000, Math.max(1000, Number(env.GEMINI_REPORT_TIMEOUT_MS) || 90_000))
  const attemptTimeoutMs = Math.min(timeoutMs, Math.max(1000, Number(env.GEMINI_REPORT_MODEL_TIMEOUT_MS) || 30_000))
  const fallbackModels = (env.GEMINI_REPORT_FALLBACK_MODELS ?? 'gemini-3.1-flash-lite,gemini-3.5-flash-lite')
    .split(',').map(model => model.trim()).filter(Boolean)
  return { timeoutMs, attemptTimeoutMs, fallbackModels: [...new Set(fallbackModels)], retryDelayBaseMs: 1000 }
}
