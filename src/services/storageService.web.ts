/**
 * Web Firebase Storage access via the `firebase` JS SDK.
 *
 * Unlike native, `Blob` here is a real Blob, so `uploadBytes` is the direct path
 * and no file staging is involved.
 */

import {
  deleteObject,
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes,
} from 'firebase/storage'
import { firebaseApp } from '~/config/firebaseConfig.web'

const downloadUrlCache = new Map<string, string>()

export function __clearDownloadUrlCache(): void {
  downloadUrlCache.clear()
}

function storageRef(path: string) {
  return ref(getStorage(firebaseApp), path)
}

function base64ToBlob(base64: string, contentType: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: contentType })
}

export async function uploadImageBytes(
  path: string,
  base64: string,
  contentType: string,
): Promise<void> {
  await uploadBytes(storageRef(path), base64ToBlob(base64, contentType), { contentType })
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
    const code = (err as { code?: string })?.code ?? ''
    if (code === 'storage/object-not-found') return
    throw err
  } finally {
    downloadUrlCache.delete(path)
  }
}

export async function downloadImageBase64(path: string): Promise<string> {
  const url = await getStorageDownloadUrl(path)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download ${path}: ${response.status}`)
  }
  const blob = await response.blob()

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read downloaded image'))
    reader.onload = () => {
      const result = String(reader.result)
      // Strip the `data:<mime>;base64,` prefix — callers store bare base64.
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(blob)
  })
}