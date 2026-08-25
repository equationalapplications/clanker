/**
 * Native photo-library save seam.
 *
 * `expo-media-library@57`'s main entry evaluates
 * `requireNativeModule('ExpoMediaLibraryNext')` at import time and SDK 57 ships
 * no web implementation of that module — importing the package anywhere in a
 * module graph the web bundle evaluates crashes the app on load. Keeping the
 * import inside this native-only file (its `.web.ts` twin never touches it) is
 * what lets `ChatImageBubble` render on web while save-to-Photos stays fully
 * native.
 */

import * as MediaLibrary from 'expo-media-library'
import type { PhotoSaveResult } from './photoLibrarySaver.types'

export type { PhotoSaveResult }

export async function saveToPhotos(uri: string): Promise<PhotoSaveResult> {
  try {
    // writeOnly → the add-only prompt backed by NSPhotoLibraryAddUsageDescription.
    const perm = await MediaLibrary.requestPermissionsAsync(true)
    if (!perm.granted) return 'denied'
    await MediaLibrary.saveToLibraryAsync(uri)
    return 'saved'
  } catch {
    return 'failed'
  }
}
