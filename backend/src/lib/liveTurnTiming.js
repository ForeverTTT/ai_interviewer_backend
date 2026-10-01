/**
 * Per-turn latency of a Gemini Live interview, measured on the server.
 *
 * The browser streams microphone audio continuously (including silence), so
 * the end of the candidate's speech is approximated by the last input
 * transcription delta. That runs slightly behind the real end of speech, so
 * the reported latency is a lower bound of what the candidate perceives.
 *
 * A turn is reported only when the candidate spoke and the model answered
 * with audio; greetings, control prompts and silent turns are ignored.
 */
export function createLiveTurnTimer(now = () => Date.now()) {
  let lastInputAt = null
  let firstAudioAt = null
  let turnIndex = 0

  return {
    onInputTranscript() {
      lastInputAt = now()
      // A new input delta after the model started speaking belongs to the
      // next turn (the candidate interrupted or continued).
      firstAudioAt = null
    },
    onOutputAudio() {
      if (lastInputAt !== null && firstAudioAt === null) firstAudioAt = now()
    },
    onTurnComplete() {
      const completedAt = now()
      const result = lastInputAt !== null && firstAudioAt !== null
        ? {
          turnIndex: turnIndex + 1,
          inputToFirstAudioMs: Math.max(0, firstAudioAt - lastInputAt),
          firstAudioToTurnCompleteMs: Math.max(0, completedAt - firstAudioAt),
        }
        : null
      if (result) turnIndex = result.turnIndex
      lastInputAt = null
      firstAudioAt = null
      return result
    },
  }
}
