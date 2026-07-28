/**
 * Derives the two stored representations of every character image:
 * a 1024 master and a 256 thumbnail.
 *
 * Shared verbatim by the write path (`characterImageService`), the legacy-avatar
 * migration, and — later — the Vision upload path. The thumb is not an
 * optimisation detail: the picker renders up to 100 images at once, which is
 * ~15 MB of masters versus ~1.2 MB of thumbs.
 */

import { File } from 'expo-file-system'
import { manipulateAsync } from 'expo-image-manipulator'
import { getEncodeTarget } from '~/utilities/webpSupport'

export const MASTER_DIMENSION = 1024
export const THUMB_DIMENSION = 256

export interface ImageVariant {
  base64: string
  mimeType: string
}

export interface ImageVariants {
  master: ImageVariant
  thumb: ImageVariant
}

export interface VariantSource {
  uri: string
  width: number
  height: number
}

/**
 * Resize on the longest edge, never upscaling — an 800×800 upload stays at 800.
 * Returns [] when the source already fits, so the manipulator only re-encodes.
 */
function resizeActions(width: number, height: number) {
  if (width <= MASTER_DIMENSION && height <= MASTER_DIMENSION) return []
  return [{ resize: width >= height ? { width: MASTER_DIMENSION } : { height: MASTER_DIMENSION } }]
}

export async function prepareImageVariants(source: VariantSource): Promise<ImageVariants> {
  const { format, mimeType } = getEncodeTarget()

  const master = await manipulateAsync(source.uri, resizeActions(source.width, source.height), {
    format,
    compress: 0.85,
  })

  const masterFile = new File(master.uri)
  let thumbFile: File | null = null

  try {
    // Derive the thumb from the already-normalised master, not the raw source:
    // one resize chain, and the thumb is guaranteed to match what is displayed.
    const thumb = await manipulateAsync(master.uri, [{ resize: { width: THUMB_DIMENSION } }], {
      format,
      compress: 0.8,
    })
    thumbFile = new File(thumb.uri)

    const [masterBase64, thumbBase64] = await Promise.all([
      masterFile.base64(),
      thumbFile.base64(),
    ])

    return {
      master: { base64: masterBase64, mimeType },
      thumb: { base64: thumbBase64, mimeType },
    }
  } finally {
    // Temp files from manipulateAsync are ours to clean up; failure to delete
    // must never mask the real error, so each is swallowed independently.
    for (const file of [masterFile, thumbFile]) {
      if (!file) continue
      try {
        file.delete()
      } catch (err) {
        console.warn('Failed to clean up temp image variant file:', err)
      }
    }
  }
}
