import { supabase } from './supabase.js'
import { errorSummary, logStructured } from './observability.js'

function cleanText(value, maxLength) {
  if (value == null) return null
  const text = String(value).trim()
  return text ? text.slice(0, maxLength) : null
}

function cleanMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {}
  const allowed = [
    'trigger',
    'reason',
    'online',
    'visibilityState',
    'attempt',
    'fallbackFrom',
    'fallbackTo',
    'responseRequestId',
    'turnIndex',
    'inputToFirstAudioMs',
    'firstAudioToTurnCompleteMs',
  ]
  return Object.fromEntries(
    allowed
      .filter((key) => metadata[key] !== undefined)
      .map((key) => [key, typeof metadata[key] === 'string'
        ? metadata[key].slice(0, 200)
        : metadata[key]]),
  )
}

/**
 * Persist and emit the same structured event. Database failures never break
 * the interview flow; Cloud Logging remains a second diagnostic copy.
 */
export async function recordInterviewEvent({
  interviewId,
  userId,
  requestId,
  eventType,
  eventSource = 'backend',
  stage,
  model,
  httpStatus,
  error,
  durationMs,
  messageCount,
  metadata,
}) {
  const errorInfo = error ? errorSummary(error) : { code: null, message: null }
  const row = {
    interview_id: interviewId,
    user_id: userId,
    request_id: cleanText(requestId, 100),
    event_type: cleanText(eventType, 80),
    event_source: eventSource === 'client' ? 'client' : 'backend',
    stage: cleanText(stage, 80),
    model: cleanText(model, 100),
    http_status: Number.isInteger(httpStatus) ? httpStatus : null,
    error_code: cleanText(errorInfo.code, 100),
    error_message: cleanText(errorInfo.message, 2000),
    duration_ms: Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : null,
    message_count: Number.isInteger(messageCount) ? Math.max(0, messageCount) : null,
    metadata: cleanMetadata(metadata),
  }

  logStructured(error ? 'error' : 'info', row.event_type, {
    interviewId: row.interview_id,
    userId: row.user_id,
    requestId: row.request_id,
    source: row.event_source,
    stage: row.stage,
    model: row.model,
    httpStatus: row.http_status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    durationMs: row.duration_ms,
    messageCount: row.message_count,
    metadata: row.metadata,
  })

  try {
    const { error: insertError } = await supabase.from('interview_events').insert(row)
    if (insertError) {
      logStructured('warn', 'interview_event_persist_failed', {
        interviewId,
        userId,
        requestId,
        eventType,
        errorMessage: insertError.message,
      })
      return false
    }
    return true
  } catch (insertError) {
    logStructured('warn', 'interview_event_persist_failed', {
      interviewId,
      userId,
      requestId,
      eventType,
      errorMessage: errorSummary(insertError).message,
    })
    return false
  }
}
