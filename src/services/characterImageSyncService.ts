/**
 * Cloud sync for `character_images`.
 *
 * Image history is an append-mostly log with deletions: it cannot ride inside
 * the character snapshot, and last-write-wins on `updated_at` cannot settle a
 * set difference. Hence a dedicated sweeper plus a dedicated callable.
 */

import { File } from 'expo-file-system'
import {
  getCharacterImageById,
  getImagesBySyncState,
  hardDeleteCharacterImage,
  incrementSyncAttempts,
  setImageSyncState,
  updateImageRefs,
  type CharacterImageRow,
} from '~/database/characterImageDatabase'
import { getAllCharactersIncludingDeleted } from '~/database/characterDatabase'
import { deleteLocalImageBytes, resolveImageUri } from '~/services/localImageStore'
import { deleteStorageObject, uploadImageBytes } from '~/services/storageService'
import { buildStoragePath } from '~/services/characterImageService'
import { syncCharacterImagesFn } from '~/services/apiClient'
import { reportError } from '~/utilities/reportError'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Unbounded retry is not the safe default here: it burns battery and quota
 * re-attempting an upload a Storage rule will reject every time, and it buries
 * the one signal that tells the user cloud backup is not happening.
 */
export const MAX_SYNC_ATTEMPTS = 5

/** Errors retrying cannot fix — fail immediately rather than spending the budget. */
// NOTE: `buildStoragePath` is imported from characterImageService rather than
// redefined here — one definition of the path format, or the sweeper and the
// write path can drift and write the same image to two different locations.
const TERMINAL_ERROR_CODES = new Set([
  'storage/unauthorized',
  'storage/unauthenticated',
  'storage/quota-exceeded',
  'storage/invalid-argument',
  'permission-denied',
])

function isTerminalError(error: unknown): boolean {
  const code = (error as { code?: string })?.code ?? ''
  return TERMINAL_ERROR_CODES.has(code)
}

async function readBase64(row: CharacterImageRow, variant: 'master' | 'thumb'): Promise<string | null> {
  if (row.storage_kind === 'inline') {
    return variant === 'thumb' ? row.thumb_ref ?? row.master_ref : row.master_ref
  }
  const uri = await resolveImageUri(row, variant)
  return new File(uri).base64()
}

export async function syncCharacterImages(localUserId: string): Promise<void> {
  const characters = await getAllCharactersIncludingDeleted(localUserId)

  // Confirmed cloud ids only. pending_cloud_id is deliberately excluded: the
  // server's id is authoritative, and objects written under a guessed id the
  // server later disagrees with are unreachable forever. Waiting one sweep is
  // the cheaper side of that trade.
  const confirmedCloudIds = new Map<string, string>()
  for (const character of characters) {
    if (character.cloud_id && UUID_REGEX.test(character.cloud_id)) {
      confirmedCloudIds.set(character.id, character.cloud_id)
    }
  }

  const rows = await getImagesBySyncState(localUserId, ['pending_upload', 'pending_delete'])
  const perCharacter = new Map<string, { uploaded: CharacterImageRow[]; deleted: string[] }>()

  for (const row of rows) {
    const cloudCharacterId = confirmedCloudIds.get(row.character_id)
    // No confirmed cloud id yet — stay pending for one more sweep. This is not
    // a failure, so the retry budget is untouched.
    if (!cloudCharacterId) continue

    const bucket = perCharacter.get(cloudCharacterId) ?? { uploaded: [], deleted: [] }
    perCharacter.set(cloudCharacterId, bucket)

    try {
      if (row.sync_state === 'pending_upload') {
        const masterPath = buildStoragePath(localUserId, cloudCharacterId, row.id, 'master')
        const thumbPath = buildStoragePath(localUserId, cloudCharacterId, row.id, 'thumb')

        const masterBytes = await readBase64(row, 'master')
        if (!masterBytes) throw new Error(`No master bytes for image ${row.id}`)
        await uploadImageBytes(masterPath, masterBytes, row.mime_type)

        const thumbBytes = row.thumb_ref ? await readBase64(row, 'thumb') : null
        if (thumbBytes) await uploadImageBytes(thumbPath, thumbBytes, row.mime_type)

        // Rows before local bytes: the DB write pointing at the new cloud paths
        // must land first, since it's the one thing that must not silently fail
        // after cleanup already happened. If this throws, the row is untouched,
        // local bytes are still present, and the row stays pending_upload for
        // retry — nothing was deleted that shouldn't have been.
        await updateImageRefs(row.id, {
          storage_kind: 'cloud',
          master_ref: masterPath,
          thumb_ref: thumbBytes ? thumbPath : null,
          mime_type: row.mime_type,
          sync_state: 'synced',
        })

        // The row is now durably pointing at the cloud copies, so the local
        // bytes are redundant. Deleting them is best-effort: a failure here
        // just orphans a local file (the image still resolves via the cloud
        // row), so it must not be treated as this row's sync failure.
        if (row.storage_kind === 'file') {
          try {
            await deleteLocalImageBytes(row.master_ref)
            if (row.thumb_ref) await deleteLocalImageBytes(row.thumb_ref)
          } catch (cleanupError) {
            reportError(cleanupError, 'characterImageSync:cleanupLocalBytes')
          }
        }

        bucket.uploaded.push({
          ...row,
          storage_kind: 'cloud',
          master_ref: masterPath,
          thumb_ref: thumbBytes ? thumbPath : null,
          sync_state: 'synced',
        })
      } else {
        // pending_delete: objects before rows. Deleting the row while its
        // objects survive would strand the bytes with nothing left to retry from.
        await deleteStorageObject(row.master_ref)
        if (row.thumb_ref) await deleteStorageObject(row.thumb_ref)
        await hardDeleteCharacterImage(row.id)
        bucket.deleted.push(row.id)
      }
    } catch (error) {
      await incrementSyncAttempts(row.id)
      if (isTerminalError(error) || row.sync_attempts + 1 >= MAX_SYNC_ATTEMPTS) {
        // A failed row keeps kind='file' and its local bytes, so the image still
        // resolves and still displays — only cloud redundancy is lost.
        await setImageSyncState(row.id, 'failed')
      }
      reportError(error, 'characterImageSync')
    }
  }

  for (const [cloudCharacterId, bucket] of perCharacter) {
    if (bucket.uploaded.length === 0 && bucket.deleted.length === 0) continue

    try {
      const result = await syncCharacterImagesFn({
        characterId: cloudCharacterId,
        images: bucket.uploaded.map((row) => ({
          id: row.id,
          storagePath: row.master_ref,
          thumbPath: row.thumb_ref,
          mimeType: row.mime_type,
          source: row.source,
        })),
        deletedImageIds: bucket.deleted,
      })

      // The server owns the cap for cloud characters and returns what it evicted;
      // apply the same deletion locally rather than waiting for the next pull.
      for (const evictedId of result.data?.evictedImageIds ?? []) {
        const evicted = await getCharacterImageById(evictedId)
        if (!evicted) continue
        await hardDeleteCharacterImage(evictedId)
      }
    } catch (error) {
      reportError(error, 'characterImageSync:register')
    }
  }
}
