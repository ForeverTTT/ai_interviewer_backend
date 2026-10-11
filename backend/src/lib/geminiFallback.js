export const DEFAULT_GEMINI_FALLBACK_MODEL = 'gemini-3.5-flash-lite'
export const DEFAULT_GEMINI_FALLBACK_MODELS = [
  DEFAULT_GEMINI_FALLBACK_MODEL,
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-3.7-flash',
]

function errorChain(error) {
  const chain = []
  const seen = new Set()
  let current = error

  while (current && !seen.has(current)) {
    seen.add(current)
    chain.push(current)
    current = current.cause
  }

  return chain
}

/**
 * Google AI Studio and Vertex AI surface quota exhaustion in several shapes:
 * HTTP 429, gRPC code 8, RESOURCE_EXHAUSTED, or a quota/rate-limit message.
 */
export function isGeminiQuotaError(error) {
  return errorChain(error).some((item) => {
    const numericCodes = [
      item?.status,
      item?.statusCode,
      item?.code,
      item?.response?.status,
      item?.response?.statusCode,
    ].map(Number)

    if (numericCodes.includes(429) || numericCodes.includes(8)) return true

    const text = [
      item?.message,
      item?.statusText,
      item?.response?.statusText,
      item?.details,
    ].filter(Boolean).join(' ')

    return /\b429\b|resource[_\s-]?exhausted|quota|rate[_\s-]?limit|too many requests/i.test(text)
  })
}

export function getGeminiFallbackModel() {
  return getGeminiFallbackModels()[0] || ''
}

export function getGeminiFallbackModels() {
  // An explicitly empty list disables fallback; the singular legacy setting
  // remains the preferred first fallback when no list is configured.
  const configured = process.env.GEMINI_FALLBACK_MODELS
  const models = configured !== undefined
    ? configured.split(',')
    : [process.env.GEMINI_FALLBACK_MODEL || DEFAULT_GEMINI_FALLBACK_MODEL, ...DEFAULT_GEMINI_FALLBACK_MODELS]
  return [...new Set(models.map(model => model.trim()).filter(Boolean))]
}

export function isGeminiRetryableError(error) {
  if (isGeminiQuotaError(error)) return true
  return errorChain(error).some(item => {
    const codes = [item?.status, item?.statusCode, item?.code, item?.response?.status].map(Number)
    // Unavailable/retired models can fall through to another configured model.
    if (codes.some(code => [404, 408, 500, 502, 503, 504, 4, 14].includes(code))) return true
    return ['GEMINI_MODEL_TIMEOUT', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ENOTFOUND'].includes(item?.code)
      || /fetch failed|\bUNAVAILABLE\b|\bDEADLINE_EXCEEDED\b/i.test(String(item?.message || ''))
  })
}

// Gemini 3.x no longer recommends the legacy sampling temperature parameter.
export function supportsSamplingTemperature(model) {
  return !/^gemini-3(?:[.-]|$)/i.test(String(model || ''))
}

/** Try each configured text model once. Authentication/invalid requests fail fast. */
export async function invokeWithGeminiQuotaFallback(primaryModel, invokeForModel, hooks = {}) {
  const models = [...new Set([primaryModel, ...(hooks.fallbackModels ?? getGeminiFallbackModels())])]
  for (const [index, model] of models.entries()) {
    hooks.signal?.throwIfAborted()
    await hooks.onModelAttempt?.({ model, attempt: index + 1, fallback: index > 0 })
    try {
      return await invokeForModel(model)
    } catch (error) {
      hooks.signal?.throwIfAborted()
      const nextModel = models[index + 1]
      if (!nextModel || !isGeminiRetryableError(error)) throw error
      console.warn('[Gemini] %s unavailable; trying %s', model, nextModel)
      await hooks.onFallback?.({ fromModel: model, toModel: nextModel, error })
    }
  }
}
