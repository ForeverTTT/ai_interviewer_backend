export const DEFAULT_GEMINI_FALLBACK_MODEL = 'gemini-3.5-flash-lite'

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
  return process.env.GEMINI_FALLBACK_MODEL || DEFAULT_GEMINI_FALLBACK_MODEL
}

// Gemini 3.x no longer recommends the legacy sampling temperature parameter.
export function supportsSamplingTemperature(model) {
  return !/^gemini-3(?:[.-]|$)/i.test(String(model || ''))
}

/** Retry once with Flash-Lite, and only when the configured 3.7 Flash is quota-limited. */
export async function invokeWithGeminiQuotaFallback(primaryModel, invokeForModel, hooks = {}) {
  await hooks.onModelAttempt?.({ model: primaryModel, attempt: 1, fallback: false })
  try {
    return await invokeForModel(primaryModel)
  } catch (error) {
    const fallbackModel = getGeminiFallbackModel()
    if (
      primaryModel !== 'gemini-3.7-flash'
      || !fallbackModel
      || fallbackModel === primaryModel
      || !isGeminiQuotaError(error)
    ) {
      throw error
    }

    console.warn(
      '[Gemini] %s quota exhausted; retrying once with %s',
      primaryModel,
      fallbackModel,
    )
    await hooks.onFallback?.({
      fromModel: primaryModel,
      toModel: fallbackModel,
      error,
    })
    await hooks.onModelAttempt?.({ model: fallbackModel, attempt: 2, fallback: true })
    return invokeForModel(fallbackModel)
  }
}
