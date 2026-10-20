import { errorSummary, logStructured } from './observability.js'

export function safeLiveMessage(error, fallback) {
  const message = typeof error?.message === 'string' ? error.message.trim() : ''
  // SDK errors may embed the request URL/API key; never serialize ErrorEvent.
  if (!message || /https?:|wss?:|[?&]key=/i.test(message)) return fallback
  return errorSummary({ message }).message.slice(0, 300)
}

export function createLiveDiagnostics(context, { now = Date.now, log = logStructured } = {}) {
  const startedAt = now()
  const counters = { inputAudioChunks: 0, inputAudioBytes: 0, inputTranscripts: 0, outputAudioChunks: 0, serverMessages: 0, completedTurns: 0 }
  const last = {}
  return {
    mark(kind, bytes = 0) {
      last[kind] = now()
      if (kind === 'inputAudio') { counters.inputAudioChunks++; counters.inputAudioBytes += bytes }
      if (kind === 'inputTranscript') counters.inputTranscripts++
      if (kind === 'outputAudio') counters.outputAudioChunks++
      if (kind === 'serverMessage') counters.serverMessages++
      if (kind === 'turnComplete') counters.completedTurns++
    },
    emit(event, fields = {}, level = 'info') {
      const time = now()
      log(level, event, {
        ...context(), durationMs: time - startedAt, ...counters,
        ...Object.fromEntries(Object.entries(last).map(([key, value]) => [`${key}AgeMs`, time - value])),
        ...fields,
      })
    },
  }
}
