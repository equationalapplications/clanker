export { DEFAULT_VOICE, normalizeVoice } from './voiceDefaults'

export const GEMINI_LIVE_VOICES = ['Aoede', 'Charon', 'Fenrir', 'Kore', 'Puck'] as const
export type GeminiLiveVoice = typeof GEMINI_LIVE_VOICES[number]

export const LIVE_VOICE_FALLBACK: GeminiLiveVoice = 'Aoede'

const LIVE_VOICE_SET = new Set<string>(GEMINI_LIVE_VOICES)

export function resolveLiveVoice(raw: string | null | undefined): GeminiLiveVoice {
  const trimmed = raw?.trim()
  if (trimmed && LIVE_VOICE_SET.has(trimmed)) return trimmed as GeminiLiveVoice
  return LIVE_VOICE_FALLBACK
}
