/**
 * Native resolver seam: turns a `character_images` row into a URI a component
 * can render, and owns the on-device byte store for privacy-mode characters.
 *
 * Dispatching on `storage_kind` in exactly one place is what keeps the storage
 * backend swappable. Consumers never branch on kind themselves.
 */

import { Directory, File, Paths } from 'expo-file-system'
import type { CharacterImageRow } from '~/database/characterImageDatabase'

export type ImageVariantName = 'master' | 'thumb'

const IMAGE_DIR_NAME = 'character-images'

function imageDirectory(): Directory {
  const dir = new Directory(Paths.document, IMAGE_DIR_NAME)
  if (!dir.exists) dir.create()
  return dir
}

function fileNameFor(imageId: string, variant: ImageVariantName): string {
  return variant === 'thumb' ? `${imageId}_thumb.webp` : `${imageId}.webp`
}

/**
 * Pick the ref for the requested variant.
 *
 * A NULL `thumb_ref` is not an error: legacy migrated rows have no thumb until
 * the background pass derives one, so 'thumb' degrades to the master.
 */
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
    case 'file':
      return ref
    case 'inline':
      return `data:${row.mime_type};base64,${ref}`
    case 'cloud':
      // Filled in by the Firebase Storage seam in Stage B.
      throw new Error('Cloud image resolution is not available yet')
    default: {
      const exhaustive: never = row.storage_kind
      throw new Error(`Unknown storage_kind: ${String(exhaustive)}`)
    }
  }
}

export async function writeLocalImageBytes(
  imageId: string,
  base64: string,
  variant: ImageVariantName,
): Promise<string> {
  const dir = imageDirectory()
  const file = new File(dir, fileNameFor(imageId, variant))
  file.write(base64)
  return file.uri
}

/**
 * Idempotent by design: the deletion cascade re-runs after partial failures and
 * an already-missing file means the work is done, not that it failed.
 */
export async function deleteLocalImageBytes(ref: string): Promise<void> {
  try {
    new File(ref).delete()
  } catch (err) {
    console.warn('Failed to delete local image bytes (already gone?):', ref, err)
  }
}
