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
import { deleteLocalImageBytes, writeLocalImageBytes } from '~/services/localImageStore'

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
  const stagedRef = await stageForUpload(base64)
  try {
    await putFile(storageRef(path), stagedRef, { contentType })
  } finally {
    await deleteLocalImageBytes(stagedRef)
  }
}

async function stageForUpload(base64: string): Promise<string> {
  return writeLocalImageBytes(`upload_${Date.now()}_${Math.random().toString(36).slice(2)}`, base64, 'master')
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
  const destination = new File(dir, `dl_${Date.now()}.webp`)

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