/**
 * Web image-share seam.
 *
 * `navigator.share` can take real file bytes, but only when handed `File`
 * objects — sharing the raw URL (what expo-sharing's web build does) just
 * posts an expiring, tokenized Storage link to the target app. So the bytes
 * are fetched first; when the browser cannot share files at all, the twin
 * degrades to a plain download. Dismissing the native sheet rejects with
 * `AbortError` — mapped to `cancelled`, not a failure notice.
 */

import type { ImageSharer, ImageShareResult } from './imageSharer.types'

export type { ImageShareResult }

function mimeTypeFor(uri: string): string {
  switch (/\.([A-Za-z0-9]{2,5})(?=[?#]|$)/.exec(uri)?.[1]?.toLowerCase()) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    default:
      return 'image/webp'
  }
}

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

export async function shareImage(uri: string): Promise<ImageShareResult> {
  let blob: Blob
  try {
    const response = await fetch(uri)
    if (!response.ok) return 'failed'
    blob = await response.blob()
  } catch {
    return 'failed'
  }

  // The seam must never reject (its consumer renders the outcome from a
  // notice map), so the File construction and the canShare probe are guarded
  // just like the fetch above: the File constructor throws in some embedded
  // browsers, and canShare has been observed throwing on hostile probe
  // objects. When either fails the bytes are still in hand, so degrade to the
  // plain download instead of failing.
  let file: File | null = null
  let canShareFiles = false
  try {
    file = new File([blob], filenameFor(uri), { type: blob.type || mimeTypeFor(uri) })
    canShareFiles =
      typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] }) === true
  } catch {
    file = null
  }

  if (file && canShareFiles) {
    try {
      await navigator.share({ files: [file] })
      return 'shared'
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return 'cancelled'
      return 'failed'
    }
  }

  try {
    const url = URL.createObjectURL(blob)
    try {
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filenameFor(uri)
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
    } finally {
      URL.revokeObjectURL(url)
    }
    return 'downloaded'
  } catch {
    return 'failed'
  }
}

// Compile-time guard: both platform twins must expose the same surface (same
// pattern as localImageStore).
const _typeCheck: ImageSharer = { shareImage }
void _typeCheck
