/**
 * Web resolver seam.
 *
 * There is no file system to write to, so privacy-mode images are `inline`:
 * base64 in the row itself. That is not a compromise — expo-sqlite@56 on web
 * runs on an OPFS sync-access-handle pool, so SQLite here *is* origin-private
 * storage, the same quota bucket and eviction rules IndexedDB draws from.
 * Keeping rows out of list queries (images have their own table) buys the one
 * genuine advantage a separate blob store would have offered.
 */

import type { CharacterImageRow } from '~/database/characterImageDatabase'
import { getStorageDownloadUrl } from '~/services/storageService.web'
import type { ImageVariantName, LocalImageStore } from './localImageStore.types'

export type { ImageVariantName }

function refFor(row: CharacterImageRow, variant: ImageVariantName): string {
  if (variant === 'thumb' && row.thumb_ref) return row.thumb_ref
  return row.master_ref
}

export async function resolveImageUri(
  row: CharacterImageRow,
  variant: ImageVariantName,
): Promise<string> {
  const ref = refFor(row, variant)

  switch (row.storage_kind) {
    case 'inline':
      return `data:${row.mime_type};base64,${ref}`
    case 'file':
      throw new Error('file-backed images are not available on web')
    case 'cloud':
      return getStorageDownloadUrl(ref)
    default: {
      const exhaustive: never = row.storage_kind
      throw new Error(`Unknown storage_kind: ${String(exhaustive)}`)
    }
  }
}

/** On web the "ref" is the payload: the caller stores it directly in the row. */
export async function writeLocalImageBytes(
  _imageId: string,
  base64: string,
  _variant: ImageVariantName,
): Promise<string> {
  return base64
}

/** No-op: deleting the row deletes the bytes. */
export async function deleteLocalImageBytes(_ref: string): Promise<void> {
  return undefined
}

// Compile-time guard: both platform implementations must expose the same surface.
const _typeCheck: LocalImageStore = {
  resolveImageUri,
  writeLocalImageBytes,
  deleteLocalImageBytes,
}
void _typeCheck
