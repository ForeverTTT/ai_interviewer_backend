import textToSpeech from '@google-cloud/text-to-speech'

let client = null

/**
 * Initializes the GCP Text-to-Speech client if configured.
 */
function getTtsClient() {
  if (client) return client
  if (!process.env.GCP_PROJECT_ID) return null
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
export async function synthesizeSpeechVertex(text, language = 'English', isStream = false) {
  const ttsClient = getTtsClient()
  if (!ttsClient) throw new Error('Google Cloud TTS client not initialized. Check GCP_PROJECT_ID.')

  const tier = process.env.GCP_TTS_VOICE_TIER || 'Studio'
  const voices = VOICE_TIERS[tier] || VOICE_TIERS.Studio
  const voiceName = voices[language] || voices.English

  const request = {
    input: { text },
    voice: { 
      languageCode: VOICE_LANG_MAP[language] || 'en-US', 
      name: voiceName,
      ssmlGender: voiceName.includes('Journey-F') ? 'FEMALE' : 'MALE'
    },
    audioConfig: { 
      audioEncoding: isStream ? 'LINEAR16' : 'MP3', 
      sampleRateHertz: 24000,
      speakingRate: 1.05,
      pitch: 0
    },
  }

  if (isStream) console.log(`[TTS] Streaming audio for ${language} with ${voiceName}`)

  const [response] = await ttsClient.synthesizeSpeech(request)
  return {
    audioContent: response.audioContent,
    contentType: isStream ? 'audio/l16' : 'audio/mpeg'
  } 
}
