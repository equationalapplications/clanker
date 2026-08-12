/**
 * Derives the two stored representations of every character image:
 * a 1024 master and a 256 thumbnail.
 *
 * Shared verbatim by the write path (`characterImageService`), the legacy-avatar
 * migration, and — later — the Vision upload path. The thumb is not an
 * optimisation detail: the picker renders up to 100 images at once, which is
 * ~15 MB of masters versus ~1.2 MB of thumbs.
 */

import { Platform } from 'react-native'
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

/**
 * Web path: ask the manipulator for base64 directly.
 *
 * `expo-file-system` is a warn-and-noop stub on web — `new File(uri)` returns an
 * object with no `base64()` at all, so the native path below throws a TypeError
 * on every browser upload. The manipulator's own `base64` save option works on
 * both platforms; native still prefers the file read, which avoids holding a
 * second copy of the payload as a JS string alongside the native buffer.
 *
 * There is no temp file to clean up here: on web the manipulator returns an
 * object URL, not a filesystem path.
 */
async function prepareImageVariantsWeb(
  source: VariantSource,
  format: ReturnType<typeof getEncodeTarget>['format'],
  mimeType: ReturnType<typeof getEncodeTarget>['mimeType'],
): Promise<ImageVariants> {
  const master = await manipulateAsync(source.uri, resizeActions(source.width, source.height), {
    format,
    compress: 0.85,
    base64: true,
  })

  const thumb = await manipulateAsync(master.uri, [{ resize: { width: THUMB_DIMENSION } }], {
    format,
    compress: 0.8,
    base64: true,
  })

  if (!master.base64 || !thumb.base64) {
    throw new Error('Image manipulator returned no base64 payload')
  }

  return {
    master: { base64: master.base64, mimeType },
    thumb: { base64: thumb.base64, mimeType },
  }
}

export async function prepareImageVariants(source: VariantSource): Promise<ImageVariants> {
  const { format, mimeType } = getEncodeTarget()

  if (Platform.OS === 'web') {
    return prepareImageVariantsWeb(source, format, mimeType)
  }

  const master = await manipulateAsync(source.uri, resizeActions(source.width, source.height), {
    format,
    compress: 0.85,
  })

  let masterFile: File | null = null
  let thumbFile: File | null = null

  try {
    masterFile = new File(master.uri)

    // Derive the thumb from the already-normalised master, not the raw source:
    // one resize chain, and the thumb is guaranteed to match what is displayed.
    const thumb = await manipulateAsync(master.uri, [{ resize: { width: THUMB_DIMENSION } }], {
      format,
      compress: 0.8,
    })
    thumbFile = new File(thumb.uri)

    const [masterBase64, thumbBase64] = await Promise.all([masterFile.base64(), thumbFile.base64()])

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
