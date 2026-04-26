export const DEFAULT_VOICE = 'Umbriel'

export function normalizeVoice(voice: string | null | undefined): string {
  return voice || DEFAULT_VOICE
}
