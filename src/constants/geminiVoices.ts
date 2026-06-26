export { DEFAULT_VOICE, normalizeVoice } from './voiceDefaults'

export const GEMINI_LIVE_VOICES = ['Aoede', 'Charon', 'Fenrir', 'Kore', 'Puck'] as const
export type GeminiLiveVoice = typeof GEMINI_LIVE_VOICES[number]
