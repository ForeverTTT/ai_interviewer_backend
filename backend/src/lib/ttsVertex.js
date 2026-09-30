import textToSpeech from '@google-cloud/text-to-speech'

let client = null

export function getGcpProjectId() {
  return process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || ''
}

function getTtsClient() {
  if (client) return client
  if (!getGcpProjectId()) return null
  try {
    client = new textToSpeech.TextToSpeechClient()
    return client
  } catch (err) {
    console.error('[TTS Service] Failed to init GCP client:', err)
    return null
  }
}

/**
 * High-quality Vertex/GCP Journey Voices
 */
const VOICE_TIERS = {
  Studio: {
    English: 'en-US-Studio-Q',
    Deutsch: 'de-DE-Studio-O',
    Chinese: 'zh-CN-Wavenet-A'
  },
  Journey: {
    English: 'en-US-Journey-F',
    Deutsch: 'de-DE-Journey-F',
    Chinese: 'zh-CN-Standard-A'
  },
  Neural2: {
    English: 'en-US-Neural2-F',
    Deutsch: 'de-DE-Neural2-B',
    Chinese: 'zh-CN-Standard-A'
  }
}

const VOICE_LANG_MAP = {
  English: 'en-US',
  Deutsch: 'de-DE',
  Chinese: 'zh-CN'
}

/**
 * Standard TTS synthesis returning audio buffer
 */
export async function synthesizeSpeechVertex(text, language = 'English', isStream = false, interviewerStyle = 'balanced') {
  const ttsClient = getTtsClient()
  if (!ttsClient) throw new Error('Google Cloud TTS client not initialized. Check GCP_PROJECT_ID.')

  const tier = process.env.GCP_TTS_VOICE_TIER || 'Studio'
  const voices = VOICE_TIERS[tier] || VOICE_TIERS.Studio
  const voiceName = voices[language] || voices.English
  const isJourney = tier === 'Journey'

  let input
  if (isJourney) {
    // Journey voices do NOT support SSML, speakingRate, or pitch parameters
    input = { text }
  } else {
    const escapedText = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    const ssml = `<speak>${escapedText.replace(/(?<!\b(?:Dr|Mr|Mrs|Ms|Sr|Jr|St|i\.e|e\.g|etc|prof|vs))\s*([.?!。？！])\s*/gi, '$1<break time="700ms"/> ')}</speak>`
    input = { ssml }
  }

  const audioConfig = {
    audioEncoding: isStream ? 'LINEAR16' : 'MP3',
    sampleRateHertz: 24000,
  }
  if (!isJourney) {
    const styleTuning = {
      balanced: { speakingRate: 0.95, pitch: 0 },
      supportive: { speakingRate: 0.88, pitch: 0.5 },
      demanding: { speakingRate: 1.02, pitch: -1 },
      analytical: { speakingRate: 0.92, pitch: -0.5 },
    }
    const tuning = styleTuning[interviewerStyle] || styleTuning.balanced
    audioConfig.speakingRate = tuning.speakingRate
    audioConfig.pitch = tuning.pitch
  }

  const request = {
    input,
    voice: {
      languageCode: VOICE_LANG_MAP[language] || 'en-US',
      name: voiceName,
    },
    audioConfig,
  }

  if (isStream) console.log(`[TTS] Streaming audio for ${language} with ${voiceName}`)

  const [response] = await ttsClient.synthesizeSpeech(request)
  return {
    audioContent: response.audioContent,
    contentType: isStream ? 'audio/l16' : 'audio/mpeg'
  }
}
