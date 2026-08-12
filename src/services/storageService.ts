/**
 * Native Firebase Storage access.
 *
 * Uploads go through `putFile(localPath)` rather than `putString`/`uploadBytes`:
 * React Native's Blob implementation cannot carry binary payloads reliably, and
 * staging to a real file avoids the problem entirely.
 */

import { Directory, File, Paths } from 'expo-file-system'
import {
  deleteObject,
  getDownloadURL,
  getStorage,
  putFile,
  ref,
} from '@react-native-firebase/storage'

/**
 * Download URLs are stable for the lifetime of an object and cost a network
 * round trip each, so the picker rendering 100 thumbs must not re-fetch per
 * render. Failures are never cached — an offline miss must retry.
 */
const downloadUrlCache = new Map<string, string>()

export function __clearDownloadUrlCache(): void {
  downloadUrlCache.clear()
}

function storageRef(path: string) {
  return ref(getStorage(), path)
}

export async function uploadImageBytes(
  path: string,
  base64: string,
  contentType: string,
): Promise<void> {
  // Stage the bytes as a file so putFile can stream them.
  const staged = stageForUpload(base64)
  try {
    await putFile(storageRef(path), staged.uri, { contentType })
  } finally {
    // Cleanup failure must never mask the real upload error (or its absence).
    try {
      staged.delete()
    } catch (err) {
      console.warn('Failed to clean up staged upload file:', err)
    }
  }
}

/**
 * Stages upload bytes as a real file (`putFile` needs one — see module doc).
 * Written under `Paths.cache`, not the `character-images` document directory
 * `localImageStore` uses for actual gallery images: a staged upload is
 * scratch that lives only for the duration of this call, and the cache
 * directory is where the OS is free to reclaim leftovers if a crash mid-upload
 * skips the `finally` cleanup above — the permanent document directory has no
 * such sweeper.
 */
function stageForUpload(base64: string): File {
  const dir = new Directory(Paths.cache, 'image-uploads')
  if (!dir.exists) dir.create()
  const file = new File(dir, `upload_${Date.now()}_${Math.random().toString(36).slice(2)}.webp`)
  file.write(base64, { encoding: 'base64' })
  return file
}

export async function getStorageDownloadUrl(path: string): Promise<string> {
  const cached = downloadUrlCache.get(path)
  if (cached) return cached

  const url = await getDownloadURL(storageRef(path))
  downloadUrlCache.set(path, url)
  return url
}

export async function deleteStorageObject(path: string): Promise<void> {
  try {
    await deleteObject(storageRef(path))
  } catch (err) {
    // Idempotent: the cascade re-runs after partial failures, and an object
    // that is already gone means the work is done.
    const code = (err as { code?: string })?.code ?? ''
    if (code === 'storage/object-not-found') return
    throw err
  } finally {
    downloadUrlCache.delete(path)
  }
}

export async function downloadImageBase64(path: string): Promise<string> {
  const url = await getStorageDownloadUrl(path)
  const dir = new Directory(Paths.cache, 'image-downloads')
  if (!dir.exists) dir.create()
  // Random suffix: two downloads racing in the same millisecond (master +
  // thumb, or two images in the same sync batch) would otherwise collide on
  // one destination file.
  const destination = new File(dir, `dl_${Date.now()}_${Math.random().toString(36).slice(2)}.webp`)

  try {
    await File.downloadFileAsync(url, destination)
    return await destination.base64()
  } finally {
    try {
      destination.delete()
    } catch (err) {
      console.warn('Failed to clean up downloaded image:', err)
    }
  }
}
