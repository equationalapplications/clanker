export const DEFAULT_VOICE = 'Umbriel'

export function normalizeVoice(voice: string | null | undefined): string {
  if (typeof voice !== 'string') {
    return DEFAULT_VOICE
  }
  const trimmed = voice.trim()
  return trimmed.length > 0 ? trimmed : DEFAULT_VOICE
}
