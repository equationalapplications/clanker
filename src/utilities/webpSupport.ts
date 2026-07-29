import { SaveFormat } from 'expo-image-manipulator'

export interface EncodeTarget {
  format: SaveFormat
  mimeType: 'image/webp' | 'image/jpeg'
}

let cached: boolean | null = null

/**
 * Whether this runtime can actually encode WebP.
 *
 * Native always can: expo-image-manipulator@56 ships SDImageWebPCoder on iOS and
 * Android has encoded WebP for years, so the historical "WEBP is Android-only"
 * limitation no longer applies.
 *
 * On web the check must inspect the returned prefix. Browsers without WebP canvas
 * encoding (Safari < 17) return a PNG data URI from `toDataURL('image/webp')`
 * instead of throwing, so a try/catch would report false success.
 */
export function isWebpSupported(): boolean {
  if (cached !== null) return cached

  if (typeof document === 'undefined') {
    cached = true
    return cached
  }

  try {
    const canvas = document.createElement('canvas')
    const supported =
      typeof canvas.getContext === 'function' && canvas.getContext('2d')
        ? canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0
        : false
    cached = supported
  } catch {
    cached = false
  }

  return cached
}

/** The format/MIME pair to hand to the manipulator and record on the row. */
export function getEncodeTarget(): EncodeTarget {
  return isWebpSupported()
    ? { format: SaveFormat.WEBP, mimeType: 'image/webp' }
    : { format: SaveFormat.JPEG, mimeType: 'image/jpeg' }
}

/** Test seam: clears the memoized probe result. */
export function __resetWebpProbeForTests(): void {
  cached = null
}
