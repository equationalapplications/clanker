export const DEFAULT_VOICE = 'Aoede'

export function normalizeVoice(voice: string | null | undefined): string {
  return voice?.trim() || DEFAULT_VOICE
}
