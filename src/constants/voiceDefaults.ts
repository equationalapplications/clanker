export const DEFAULT_VOICE = 'Umbriel'

export function normalizeVoice(voice: string | null | undefined): string {
  return voice?.trim() || DEFAULT_VOICE
}
