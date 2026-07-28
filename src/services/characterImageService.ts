/**
 * The only public write path for character images.
 *
 * Governing rule: never lose an image the user spent credits on. Every generated
 * image costs IMAGE_GENERATION_COST, so failures degrade (keep the local copy,
 * keep the row) rather than discard.
 */

import { Platform } from 'react-native'
import { getCharacter } from '~/database/characterDatabase'
import {
  countCharacterImages,
  getActiveCharacterImage,
  getAllImagesForCharacter,
  getCharacterImageById,
  getEvictionCandidates,
  hardDeleteCharacterImage,
  insertCharacterImage,
  setActiveImageId,
  type CharacterImageRow,
  type ImageSource,
} from '~/database/characterImageDatabase'
import { prepareImageVariants } from '~/services/imageVariants'
import { deleteLocalImageBytes, writeLocalImageBytes } from '~/services/localImageStore'
import { deleteStorageObject, uploadImageBytes } from '~/services/storageService'
import { generateSecureUuid } from '~/utilities/generateSecureUuid'

export const IMAGE_CAP_PER_CHARACTER = 100

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface SaveCharacterImageInput {
  characterId: string
  userId: string
  /** Source image URI — a picker result, a manipulator output, or a data: URI. */
  uri: string
  width: number
  height: number
  source: ImageSource
}

/**
 * Privacy-mode storage kind for this platform.
 *
 * Native writes files under the document directory. Web has no file system, so
 * bytes stay inline in the row — origin-private either way (see localImageStore.web).
 */
function localStorageKind(): 'file' | 'inline' {
  return Platform.OS === 'web' ? 'inline' : 'file'
}

/**
 * Storage paths are keyed on the **confirmed** cloud id, never the local
 * `char_…` id and never `pending_cloud_id`.
 *
 * The local id is device-private: a second device restoring the same character
 * holds a different one, so a path built from it is unresolvable there. And the
 * server's returned id is authoritative — building a path from a locally-guessed
 * id the server then disagrees with would strand objects at a location nothing
 * can reach. Waiting one sweep cycle is the cheaper side of that trade.
 */
export function buildStoragePath(
  userId: string,
  cloudCharacterId: string,
  imageId: string,
  variant: 'master' | 'thumb',
): string {
  const suffix = variant === 'thumb' ? '_thumb' : ''
  return `users/${userId}/characters/${cloudCharacterId}/${imageId}${suffix}.webp`
}

export async function saveCharacterImage(
  input: SaveCharacterImageInput,
): Promise<CharacterImageRow> {
  const character = await getCharacter(input.characterId, input.userId)
  if (!character) {
    throw new Error(`Character not found: ${input.characterId}`)
  }

  const variants = await prepareImageVariants({
    uri: input.uri,
    width: input.width,
    height: input.height,
  })

  const imageId = generateSecureUuid()

  const cloudId =
    character.save_to_cloud && character.cloud_id && UUID_REGEX.test(character.cloud_id)
      ? character.cloud_id
      : null

  let storageKind: 'cloud' | 'file' | 'inline' = localStorageKind()
  let masterRef: string
  let thumbRef: string | null
  let syncState: CharacterImageRow['sync_state'] = 'local'

  // Refs written so far. If anything between the first write and the committed
  // row insert throws, these bytes would be orphaned — no row references them,
  // so nothing could ever find or sweep them.
  const writtenRefs: string[] = []
  let row: CharacterImageRow

  try {
    if (cloudId) {
      const masterPath = buildStoragePath(input.userId, cloudId, imageId, 'master')
      const thumbPath = buildStoragePath(input.userId, cloudId, imageId, 'thumb')
      try {
        await uploadImageBytes(masterPath, variants.master.base64, variants.master.mimeType)
        await uploadImageBytes(thumbPath, variants.thumb.base64, variants.thumb.mimeType)
        storageKind = 'cloud'
        masterRef = masterPath
        thumbRef = thumbPath
        syncState = 'synced'
      } catch (err) {
        // Never lose an image the user spent credits on: fall back to a local copy
        // marked for the sweeper. The avatar still displays and the credits are not
        // wasted even if the upload never succeeds — only cloud redundancy is lost.
        console.warn('[characterImages] upload failed, keeping local copy:', err)
        storageKind = localStorageKind()
        masterRef = await writeLocalImageBytes(imageId, variants.master.base64, 'master')
        thumbRef = await writeLocalImageBytes(imageId, variants.thumb.base64, 'thumb')
        syncState = 'pending_upload'
      }
    } else {
      masterRef = await writeLocalImageBytes(imageId, variants.master.base64, 'master')
      thumbRef = await writeLocalImageBytes(imageId, variants.thumb.base64, 'thumb')
      // A cloud character with no confirmed cloud_id yet has no path to write to.
      // Marking it pending_upload lets the sweeper pick it up after the next
      // character sync confirms the id.
      syncState = character.save_to_cloud ? 'pending_upload' : 'local'
    }

    if (storageKind !== 'cloud') writtenRefs.push(masterRef, ...(thumbRef ? [thumbRef] : []))

    row = {
      id: imageId,
      character_id: input.characterId,
      user_id: input.userId,
      storage_kind: storageKind,
      master_ref: masterRef,
      thumb_ref: thumbRef,
      mime_type: variants.master.mimeType,
      source: input.source,
      sync_state: syncState,
      sync_attempts: 0,
      created_at: Date.now(),
      deleted_at: null,
    }

    // Commit point: once the row exists, the image is safely recorded.
    await insertCharacterImage(row)
  } catch (err) {
    if (storageKind !== 'cloud') {
      // Best-effort rollback. Cleanup failure must never mask the real error,
      // so each delete is swallowed independently.
      for (const ref of writtenRefs) {
        try {
          await deleteLocalImageBytes(ref)
        } catch (cleanupErr) {
          console.warn('Failed to clean up orphaned image bytes:', cleanupErr)
        }
      }
    }
    throw err
  }

  try {
    await setActiveImageId(input.characterId, imageId)
    await enforceLocalCap(input.characterId)
  } catch (err) {
    // The row is already committed. Reporting a failure here would make callers
    // retry and duplicate the image, which costs the user credits again.
    console.warn('Image saved, but post-save bookkeeping failed:', err)
  }

  return row
}

/**
 * FIFO cap for locally-stored images.
 *
 * Cloud characters get their cap enforced server-side instead (Stage C): two
 * devices can each hold fewer than 100 while the cloud total exceeds it, so a
 * client-only cap cannot be correct there.
 */
export async function enforceLocalCap(characterId: string): Promise<void> {
  const count = await countCharacterImages(characterId)
  const excess = count - IMAGE_CAP_PER_CHARACTER
  if (excess <= 0) return

  const active = await getActiveCharacterImage(characterId)
  const candidates = await getEvictionCandidates(characterId, active?.id ?? null, excess)

  for (const candidate of candidates) {
    await removeImageBytesThenRow(candidate)
  }
}

/**
 * Bytes first, then the row.
 *
 * A failure partway leaves a row pointing at possibly-missing bytes, which the
 * resolver degrades gracefully. The reverse order would strand bytes in storage
 * with nothing left referencing them — unfindable and unbillable-for.
 */
async function removeImageBytesThenRow(
  row: Pick<CharacterImageRow, 'id' | 'storage_kind' | 'master_ref' | 'thumb_ref'>,
): Promise<void> {
  if (row.storage_kind === 'file') {
    await deleteLocalImageBytes(row.master_ref)
    if (row.thumb_ref) await deleteLocalImageBytes(row.thumb_ref)
  } else if (row.storage_kind === 'cloud') {
    await deleteStorageObject(row.master_ref)
    if (row.thumb_ref) await deleteStorageObject(row.thumb_ref)
  }
  // 'inline' needs no byte deletion — the bytes are the row.
  await hardDeleteCharacterImage(row.id)
}

export async function deleteCharacterImage(imageId: string, userId: string): Promise<void> {
  const row = await getCharacterImageById(imageId)
  if (!row) return
  // TODO: assert row.user_id === userId once cloud ownership lands (Stage B);
  // until then a mismatched caller is silently accepted.
  void userId

  const active = await getActiveCharacterImage(row.character_id)

  if (active?.id === imageId) {
    // Repoint before removing the row so a failure in between can never leave
    // active_image_id pointing at a row that no longer exists. Promotes the next
    // newest surviving image; falls back to the bundled default when none remain.
    const remaining = (await getAllImagesForCharacter(row.character_id)).filter(
      (candidate) => candidate.id !== imageId && !candidate.deleted_at,
    )
    await setActiveImageId(row.character_id, remaining[0]?.id ?? null)
  }

  await removeImageBytesThenRow(row)
}

/** Full cascade for character hard-delete and purge. Includes tombstoned rows. */
export async function deleteAllImagesForCharacter(
  characterId: string,
  userId: string,
): Promise<void> {
  void userId
  const rows = await getAllImagesForCharacter(characterId)
  for (const row of rows) {
    await removeImageBytesThenRow(row)
  }
  await setActiveImageId(characterId, null)
}
