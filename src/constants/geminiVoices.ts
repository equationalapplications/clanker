export { DEFAULT_VOICE, normalizeVoice } from './voiceDefaults'

// All prebuilt voices supported by Gemini native-audio live models.
// https://ai.google.dev/gemini-api/docs/speech-generation#voices
export const GEMINI_LIVE_VOICES = [
  'Achernar',
  'Achird',
  'Algenib',
  'Algieba',
  'Alnilam',
  'Aoede',
  'Autonoe',
  'Callirrhoe',
  'Charon',
  'Despina',
  'Enceladus',
  'Erinome',
  'Fenrir',
  'Gacrux',
  'Iapetus',
  'Kore',
  'Laomedeia',
  'Leda',
  'Orus',
  'Puck',
  'Pulcherrima',
  'Rasalgethi',
  'Sadachbia',
  'Sadaltager',
  'Schedar',
  'Sulafat',
  'Umbriel',
  'Vindemiatrix',
  'Zephyr',
  'Zubenelgenubi',
] as const
export type GeminiLiveVoice = typeof GEMINI_LIVE_VOICES[number]

export const GEMINI_LIVE_VOICE_STYLES: Record<GeminiLiveVoice, string> = {
  Achernar: 'Soft',
  Achird: 'Friendly',
  Algenib: 'Gravelly',
  Algieba: 'Smooth',
  Alnilam: 'Firm',
  Aoede: 'Breezy',
  Autonoe: 'Bright',
  Callirrhoe: 'Easy-going',
  Charon: 'Informative',
  Despina: 'Smooth',
  Enceladus: 'Breathy',
  Erinome: 'Clear',
  Fenrir: 'Excitable',
  Gacrux: 'Mature',
  Iapetus: 'Clear',
  Kore: 'Firm',
  Laomedeia: 'Upbeat',
  Leda: 'Youthful',
  Orus: 'Firm',
  Puck: 'Upbeat',
  Pulcherrima: 'Forward',
  Rasalgethi: 'Informative',
  Sadachbia: 'Lively',
  Sadaltager: 'Knowledgeable',
  Schedar: 'Even',
  Sulafat: 'Warm',
  Umbriel: 'Easy-going',
  Vindemiatrix: 'Gentle',
  Zephyr: 'Bright',
  Zubenelgenubi: 'Casual',
}

export const LIVE_VOICE_FALLBACK: GeminiLiveVoice = 'Aoede'

const LIVE_VOICE_SET = new Set<string>(GEMINI_LIVE_VOICES)

export function resolveLiveVoice(raw: string | null | undefined): GeminiLiveVoice {
  const trimmed = raw?.trim()
  if (trimmed && LIVE_VOICE_SET.has(trimmed)) return trimmed as GeminiLiveVoice
  return LIVE_VOICE_FALLBACK
}
