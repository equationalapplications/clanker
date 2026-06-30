/** Public marketing URLs — set matching EXPO_PUBLIC_* vars at build time. */

export const realTimeVoiceDemoVideoUrl =
  process.env.EXPO_PUBLIC_REAL_TIME_VOICE_DEMO_URL?.trim() || ''

/** Parse a YouTube watch or share URL into an embeddable iframe URL. */
export function getYouTubeEmbedUrl(watchUrl: string): string | null {
  const trimmed = watchUrl.trim()
  if (!trimmed) return null

  try {
    const parsed = new URL(trimmed)
    const host = parsed.hostname.replace(/^www\./, '')

    if (host === 'youtu.be') {
      const videoId = parsed.pathname.replace(/^\//, '')
      return videoId ? `https://www.youtube.com/embed/${videoId}` : null
    }

    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const videoId = parsed.searchParams.get('v')
      if (videoId) return `https://www.youtube.com/embed/${videoId}`

      const shortsMatch = parsed.pathname.match(/^\/shorts\/([^/?]+)/)
      if (shortsMatch?.[1]) return `https://www.youtube.com/embed/${shortsMatch[1]}`
    }
  } catch {
    return null
  }

  return null
}
