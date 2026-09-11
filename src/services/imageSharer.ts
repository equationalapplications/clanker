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

// A share sheet left open for this long before another share sweeps its file
// is far outside any real handoff (the target reads the URI within seconds of
// the user completing the share), while keeping cache reclamation prompt.
const STAGED_SHARE_TTL_MS = 60 * 60 * 1000

/**
 * The native share intent carries the file by its name's extension, so keep
 * the URL's when there is one (chat image rows are `.webp`, hence the
 * fallback).
 */
function stagedFileFor(remoteUri: string): File {
  const dir = new Directory(Paths.cache, STAGING_DIR)
  if (!dir.exists) dir.create()
  sweepStaleStagedShares(dir)
  const ext = /\.([A-Za-z0-9]{2,5})(?=[?#]|$)/.exec(remoteUri)?.[1] ?? 'webp'
  // Random suffix: two shares racing in the same millisecond would otherwise
  // collide on one destination file.
  return new File(dir, `share_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`)
}

/**
 * The staged file must NOT be deleted when `shareAsync` resolves: on Android
 * the promise resolves in `OnActivityResult` — the moment the user returns to
 * this app — which can be before the target has finished reading the
 * FileProvider URI (cold start, background upload), handing it a deleted
 * file. (iOS resolves after the sheet's completion handler with the same
 * hazard.) Instead, each staging pass reclaims files from shares that started
 * long enough ago that no target can still be reading them; the OS also
 * reclaims `Paths.cache` under storage pressure. This is why `photoLibrarySaver`
 * may delete eagerly but this seam may not: `saveToLibraryAsync` copies the
 * bytes into MediaStore before its promise resolves.
 */
function sweepStaleStagedShares(dir: Directory): void {
  try {
    const now = Date.now()
    for (const item of dir.list()) {
      const stamped = /share_(\d+)_/.exec(item.uri)
      if (stamped && now - Number(stamped[1]) > STAGED_SHARE_TTL_MS) {
        try {
          item.delete()
        } catch {
          // Best-effort reclamation; the next sweep retries.
        }
      }
    }
  } catch (err) {
    console.warn('Failed to sweep staged image shares:', err)
  }
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
      await File.downloadFileAsync(uri, staged)
      // Deliberately no cleanup here — see sweepStaleStagedShares. Deleting on
      // resolve races the target app's lazy read of the content URI.
      await Sharing.shareAsync(staged.uri, options)
      return 'shared'
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
