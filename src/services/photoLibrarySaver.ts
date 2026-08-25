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
 *
 * The functions come from the package's `legacy` subpath on purpose: the main
 * entry re-exports `saveToLibraryAsync` only as a deprecation shim that THROWS
 * at call time ("Use Asset.create() or import this method from
 * expo-media-library/legacy"), so the bare specifier can prompt for permission
 * and then never actually save. `expo-media-library/legacy` exposes the real
 * implementations backed by the same native modules. eslint's
 * no-restricted-imports rule keeps both specifiers confined to this file.
 *
 * Remote masters are staged into cache first: `saveToLibraryAsync` only
 * accepts local file URIs (the package docs require Android paths to start
 * with `file:///`), while `resolveImageUri` hands back Firebase Storage
 * `https://` download URLs for every `cloud` row — the dominant kind once sync
 * promotes and evicts local bytes. Same staging pattern as
 * `storageService.downloadImageBase64`.
 */

import { Directory, File, Paths } from 'expo-file-system'
import { requestPermissionsAsync, saveToLibraryAsync } from 'expo-media-library/legacy'
import type { PhotoLibrarySaver, PhotoSaveResult } from './photoLibrarySaver.types'

export type { PhotoSaveResult }

const STAGING_DIR = 'photo-save'

/**
 * The native saver rejects extension-less files, so keep the URL's extension
 * when there is one (chat image rows are `.webp`, hence the fallback).
 */
function stagedFileFor(remoteUri: string): File {
  const dir = new Directory(Paths.cache, STAGING_DIR)
  if (!dir.exists) dir.create()
  const ext = /\.([A-Za-z0-9]{2,5})(?=[?#]|$)/.exec(remoteUri)?.[1] ?? 'webp'
  // Random suffix: two saves racing in the same millisecond would otherwise
  // collide on one destination file.
  return new File(dir, `save_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`)
}

export async function saveToPhotos(uri: string): Promise<PhotoSaveResult> {
  try {
    // writeOnly → the add-only prompt backed by NSPhotoLibraryAddUsageDescription.
    const perm = await requestPermissionsAsync(true)
    if (!perm.granted) return 'denied'

    if (/^https?:/i.test(uri)) {
      // Prompt first, then pay the download cost only on a grant.
      const staged = stagedFileFor(uri)
      try {
        await File.downloadFileAsync(uri, staged)
        await saveToLibraryAsync(staged.uri)
        return 'saved'
      } finally {
        try {
          staged.delete()
        } catch (err) {
          console.warn('Failed to clean up staged photo save:', err)
        }
      }
    }

    await saveToLibraryAsync(uri)
    return 'saved'
  } catch {
    return 'failed'
  }
}

// Compile-time guard: both platform twins must expose the same surface (same
// pattern as localImageStore).
const _typeCheck: PhotoLibrarySaver = { saveToPhotos }
void _typeCheck
