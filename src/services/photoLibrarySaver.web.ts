/**
 * Web photo-library save seam.
 *
 * A browser has no photo library to grant add-only access to, so Save degrades
 * to a browser download of the image bytes. This file must never import
 * `expo-media-library` (any specifier): its main entry requires a native
 * module at import time and would crash the web bundle. The crash-class story
 * lives in the native twin's header.
 */

import type { PhotoLibrarySaver, PhotoSaveResult } from './photoLibrarySaver.types'

export type { PhotoSaveResult }

/** Last path segment, decoded (Storage URLs percent-encode `users%2F…`). */
function filenameFor(uri: string): string {
  try {
    const segments = decodeURIComponent(new URL(uri).pathname).split('/')
    const last = segments[segments.length - 1]
    if (last && /\.[A-Za-z0-9]{2,5}$/.test(last)) return last
  } catch {
    // Fall through to the generic name for unparseable URIs.
  }
  return 'image.webp'
}

export async function saveToPhotos(uri: string): Promise<PhotoSaveResult> {
  let blob: Blob
  try {
    const response = await fetch(uri)
    if (!response.ok) return 'failed'
    blob = await response.blob()
  } catch {
    return 'failed'
  }

  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  try {
    anchor.href = url
    anchor.download = filenameFor(uri)
    document.body.appendChild(anchor)
    anchor.click()
  } finally {
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
  }
  return 'downloaded'
}

// Compile-time guard: both platform twins must expose the same surface (same
// pattern as localImageStore).
const _typeCheck: PhotoLibrarySaver = { saveToPhotos }
void _typeCheck
