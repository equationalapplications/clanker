/**
 * Web photo-library save seam.
 *
 * A browser has no photo library to grant add-only access to, so Save degrades
 * to an inline notice instead of reaching for a native bridge that does not
 * exist here. This file must never import `expo-media-library` (any specifier):
 * its main entry requires a native module at import time and would crash the
 * web bundle. The crash-class story lives in the native twin's header.
 */

import type { PhotoLibrarySaver, PhotoSaveResult } from './photoLibrarySaver.types'

export type { PhotoSaveResult }

export async function saveToPhotos(_uri: string): Promise<PhotoSaveResult> {
  return 'unavailable'
}

// Compile-time guard: both platform twins must expose the same surface (same
// pattern as localImageStore).
const _typeCheck: PhotoLibrarySaver = { saveToPhotos }
void _typeCheck
