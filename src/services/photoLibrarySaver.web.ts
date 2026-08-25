/**
 * Web photo-library save seam.
 *
 * A browser has no photo library to grant add-only access to, so Save degrades
 * to an inline notice instead of reaching for a native bridge that does not
 * exist here. This file must never import `expo-media-library`: its main entry
 * requires a native module at import time and would crash the web bundle.
 */

import type { PhotoSaveResult } from './photoLibrarySaver.types'

export type { PhotoSaveResult }

export async function saveToPhotos(_uri: string): Promise<PhotoSaveResult> {
  return 'unavailable'
}
