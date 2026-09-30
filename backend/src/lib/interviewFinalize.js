export function selectFinalizeMessages(requestMessages, storedTranscript) {
  if (Array.isArray(requestMessages) && requestMessages.length > 0) return requestMessages
  if (Array.isArray(storedTranscript)) return storedTranscript
  if (Array.isArray(requestMessages)) return requestMessages
  return null
}

export function shouldReuseFinalizedInterview(interview, forceRegenerate = false) {
  return !forceRegenerate && interview?.status === 'completed' && Boolean(interview?.report_json)
}
