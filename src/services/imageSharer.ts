/**
 * Native image-share seam.
 *
 * `Sharing.shareAsync` only accepts local `file://` URIs — the Android bridge
 * throws `Only local file URLs are supported` for anything else. But
 * `resolveImageUri` hands back Firebase Storage `https://` download URLs for
 * every `cloud` row (the dominant kind once sync promotes and evicts local
 * bytes), so remote masters are staged into cache first. Same staging pattern
 * as `photoLibrarySaver`.
 */

import { Directory, File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import type { ImageSharer, ImageShareResult } from './imageSharer.types'

export type { ImageShareResult }

const STAGING_DIR = 'photo-share'

/**
 * The native share intent carries the file by its name's extension, so keep
 * the URL's when there is one (chat image rows are `.webp`, hence the
 * fallback).
 */
function stagedFileFor(remoteUri: string): File {
  const dir = new Directory(Paths.cache, STAGING_DIR)
  if (!dir.exists) dir.create()
  const ext = /\.([A-Za-z0-9]{2,5})(?=[?#]|$)/.exec(remoteUri)?.[1] ?? 'webp'
  // Random suffix: two shares racing in the same millisecond would otherwise
  // collide on one destination file.
  return new File(dir, `share_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`)
}

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

export async function shareImage(uri: string): Promise<ImageShareResult> {
  try {
    if (!(await Sharing.isAvailableAsync())) return 'unavailable'

    const options = { mimeType: mimeTypeFor(uri), dialogTitle: 'Share image' }

    if (/^https?:/i.test(uri)) {
      const staged = stagedFileFor(uri)
      try {
        await File.downloadFileAsync(uri, staged)
        await Sharing.shareAsync(staged.uri, options)
        return 'shared'
      } finally {
        try {
          staged.delete()
        } catch (err) {
          console.warn('Failed to clean up staged image share:', err)
        }
      }
    }

    await Sharing.shareAsync(uri, options)
    return 'shared'
  } catch {
    return 'failed'
  }
}

// Compile-time guard: both platform twins must expose the same surface (same
// pattern as localImageStore).
const _typeCheck: ImageSharer = { shareImage }
void _typeCheck
