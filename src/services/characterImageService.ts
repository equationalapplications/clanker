/**
 * The only public write path for character images.
 *
 * Governing rule: never lose an image the user spent credits on. Every generated
 * image costs IMAGE_GENERATION_COST, so failures degrade (keep the local copy,
 * keep the row) rather than discard.
 */

import { Platform } from 'react-native'
import { isDevSandboxEnabled } from '~/auth/devSandboxFlag'
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
  softDeleteCharacterImage,
  updateImageRefs,
  type CharacterImageRow,
  type ImageSource,
} from '~/database/characterImageDatabase'
import { prepareImageVariants, type ImageVariants } from '~/services/imageVariants'
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
  /**
   * The chat message this photo arrived on. Only meaningful for `source: 'chat'`.
   * Not a foreign key in either database (see migration 24).
   */
  messageId?: string
  /**
   * Pre-minted row id. The chat path needs the id *before* the save so the
   * message it writes can carry the render hint; everything else lets the
   * service mint one. Must be a UUID — the sync callable validates it.
   */
  imageId?: string
  /**
   * Already-derived variants. The chat path encodes once to obtain the master
   * base64 it sends to the model and hands the result here rather than paying
   * for a second identical encode.
   */
  variants?: ImageVariants
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

  const variants =
    input.variants ??
    (await prepareImageVariants({
      uri: input.uri,
      width: input.width,
      height: input.height,
    }))

  // A caller-supplied imageId is what lets the chat path write the message's
  // render hint before the image row is committed (§6.1). The sync callable
  // validates it as a UUID, so an invalid value would create a local row that
  // silently never makes it to the cloud — reject up front instead of writing
  // bytes the user will never see reconcile.
  if (input.imageId && !UUID_REGEX.test(input.imageId)) {
    throw new Error('imageId must be a valid UUID')
  }
  const imageId = input.imageId ?? generateSecureUuid()

  // The mock-auth sandbox has no real Firebase identity, so Storage rules deny
  // every upload (403) and the sweeper would keep retrying the failed rows.
  // Write the local kind directly there; the chat attachment path carries the
  // bytes inline, so nothing is lost.
  const cloudId =
    character.save_to_cloud &&
    character.cloud_id &&
    UUID_REGEX.test(character.cloud_id) &&
    !isDevSandboxEnabled()
      ? character.cloud_id
      : null

  let storageKind: 'cloud' | 'file' | 'inline' = localStorageKind()
  let masterRef: string
  let thumbRef: string | null
  let syncState: CharacterImageRow['sync_state'] = 'local'

  // Refs written so far, by where they live. If anything between the first
  // write and the committed row insert throws, these bytes would be orphaned —
  // no row references them, so nothing could ever find or sweep them.
  const writtenLocalRefs: string[] = []
  const writtenCloudRefs: string[] = []
  let row: CharacterImageRow
  // Set once a reservation row exists, so the failure paths know to update that
  // row rather than insert a second one.
  let reserved = false

  try {
    if (cloudId) {
      const masterPath = buildStoragePath(input.userId, cloudId, imageId, 'master')
      const thumbPath = buildStoragePath(input.userId, cloudId, imageId, 'thumb')

      // Durable reservation, written *before* the first upload.
      //
      // Storage paths are derived from ids we already hold, so they are known in
      // advance — which means the row that names them can exist before the bytes
      // do. That closes the one window compensating cleanup cannot: a process
      // killed between a successful upload and the row insert runs no catch
      // block at all, and would leave objects in Storage that nothing references
      // and no sweep could ever find. Reserved rows are invisible to the picker
      // and the cap; `reapStaleImageReservations` collects any that outlive a
      // plausible upload.
      //
      // Local kinds get no reservation: `inline` refs *are* the payload, so there
      // is nothing to name in advance, and a stranded `file` write is addressable
      // on-device rather than invisible and billable.
      await insertCharacterImage({
        id: imageId,
        character_id: input.characterId,
        user_id: input.userId,
        storage_kind: 'cloud',
        master_ref: masterPath,
        thumb_ref: thumbPath,
        mime_type: variants.master.mimeType,
        source: input.source,
        sync_state: 'reserved',
        sync_attempts: 0,
        created_at: Date.now(),
        deleted_at: null,
        message_id: input.messageId ?? null,
      })
      reserved = true

      try {
        await uploadImageBytes(masterPath, variants.master.base64, variants.master.mimeType)
        writtenCloudRefs.push(masterPath)
        await uploadImageBytes(thumbPath, variants.thumb.base64, variants.thumb.mimeType)
        writtenCloudRefs.push(thumbPath)
        storageKind = 'cloud'
        masterRef = masterPath
        thumbRef = thumbPath
        // Bytes are in Storage but Postgres has no row yet. `synced` only
        // becomes true after `syncCharacterImagesFn` runs and the callable
        // acknowledges the row — leaving this as `pending_upload` lets the
        // sweeper register it on its next pass. Marking it `synced` here
        // would drop it out of every future sweep (the sweeper only queries
        // `pending_*` states), so a failed or never-attempted registration
        // would leave other devices with reachable Storage objects and no
        // Postgres row to point at them from.
        syncState = 'pending_upload'
      } catch (err) {
        // Never lose an image the user spent credits on: fall back to a local copy
        // marked for the sweeper. The avatar still displays and the credits are not
        // wasted even if the upload never succeeds — only cloud redundancy is lost.
        console.warn('[characterImages] upload failed, keeping local copy:', err)

        // The master commonly uploads before the thumb fails. This branch then
        // commits a `file` row that references neither object, so nothing will
        // ever point at the uploaded master again — the outer catch does not run
        // on a successful fallback. Drop the partial upload here instead of
        // leaving bytes in Storage that no row can find. Cleared from
        // writtenCloudRefs so the outer catch cannot double-delete them.
        for (const ref of writtenCloudRefs.splice(0)) {
          try {
            await deleteStorageObject(ref)
          } catch (cleanupErr) {
            console.warn('Failed to clean up partially uploaded cloud image object:', cleanupErr)
          }
        }

        storageKind = localStorageKind()
        // Tracked as each write lands, not after both: a master that succeeds
        // before the thumb throws would otherwise leave bytes on disk that the
        // outer catch never deletes and no row ever references.
        masterRef = await writeLocalImageBytes(imageId, variants.master.base64, 'master')
        writtenLocalRefs.push(masterRef)
        thumbRef = await writeLocalImageBytes(imageId, variants.thumb.base64, 'thumb')
        writtenLocalRefs.push(thumbRef)
        syncState = 'pending_upload'
      }
    } else {
      masterRef = await writeLocalImageBytes(imageId, variants.master.base64, 'master')
      writtenLocalRefs.push(masterRef)
      thumbRef = await writeLocalImageBytes(imageId, variants.thumb.base64, 'thumb')
      writtenLocalRefs.push(thumbRef)
      // A cloud character with no confirmed cloud_id yet has no path to write to.
      // Marking it pending_upload lets the sweeper pick it up after the next
      // character sync confirms the id.
      syncState = character.save_to_cloud ? 'pending_upload' : 'local'
    }

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
      message_id: input.messageId ?? null,
    }

    // Commit point: the image is safely recorded once the row reaches a real
    // state. A reservation already exists on the cloud path, so that is an
    // update — inserting again would violate the primary key.
    if (reserved) {
      await updateImageRefs(imageId, {
        storage_kind: row.storage_kind,
        master_ref: row.master_ref,
        thumb_ref: row.thumb_ref,
        mime_type: row.mime_type,
        sync_state: row.sync_state,
      })
    } else {
      await insertCharacterImage(row)
    }
  } catch (err) {
    // Best-effort rollback, on whichever side the bytes actually landed.
    // Cleanup failure must never mask the real error, so each delete is
    // swallowed independently.
    //
    // The reservation goes too: it exists only to make in-flight objects
    // findable, so once they are deleted it is debris. Dropping it here is what
    // keeps the reaper's queue empty in the ordinary failure case.
    if (reserved) {
      try {
        await hardDeleteCharacterImage(imageId)
      } catch (cleanupErr) {
        console.warn('Failed to drop image reservation row:', cleanupErr)
      }
    }
    for (const ref of writtenLocalRefs) {
      try {
        await deleteLocalImageBytes(ref)
      } catch (cleanupErr) {
        console.warn('Failed to clean up orphaned local image bytes:', cleanupErr)
      }
    }
    for (const ref of writtenCloudRefs) {
      try {
        await deleteStorageObject(ref)
      } catch (cleanupErr) {
        console.warn('Failed to clean up orphaned cloud image object:', cleanupErr)
      }
    }
    throw err
  }

  try {
    // A chat photo is a gallery row, not an avatar choice. Promoting it would
    // silently change the character's face every time the user sends a picture;
    // the user can still pick it later from the Avatar Picker, which is the
    // whole reason it lands in the shared gallery.
    if (input.source !== 'chat') {
      await setActiveImageId(input.characterId, imageId)
    }
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
 * client-only cap cannot be correct there. `cloud`-kind rows are now excluded
 * from the candidate set in `getEvictionCandidates` itself (in SQL, before the
 * LIMIT) — filtering only after the LIMIT under-evicts whenever the oldest
 * `excess` rows happen to include cloud ones. The filter below is a second,
 * redundant layer: "never hard-delete a cloud row locally" is load-bearing
 * enough (it would race the server's cap and delete a row the sweeper hasn't
 * reconciled) to defend even against a future bug in the SQL query.
 */
export async function enforceLocalCap(characterId: string): Promise<void> {
  const count = await countCharacterImages(characterId)
  const excess = count - IMAGE_CAP_PER_CHARACTER
  if (excess <= 0) return

  const active = await getActiveCharacterImage(characterId)
  const candidates = (await getEvictionCandidates(characterId, active?.id ?? null, excess)).filter(
    (candidate) => candidate.storage_kind !== 'cloud',
  )

  for (const candidate of candidates) {
    await removeImageBytesThenRow(candidate)
  }
}

/**
 * Bytes first, then the row. `file` and `inline` only — a `cloud` row must go
 * through `retireImage` instead, since its bytes and cloud row need the sweeper.
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
  }
  // 'inline' needs no byte deletion — the bytes are the row.
  await hardDeleteCharacterImage(row.id)
}

/**
 * Removes one row regardless of `storage_kind`.
 *
 * A `cloud` row has a server-side counterpart other devices reconcile against
 * (§13.3): hard-deleting it here would let the next pull re-insert it, since
 * absence is not a tombstone. It is instead soft-deleted and marked
 * `pending_delete`, and `syncCharacterImages` (characterImageSyncService) reaps
 * the Storage objects, the cloud row, and finally this local row. `file` and
 * `inline` rows have no cloud counterpart to reconcile, so they are removed
 * immediately.
 */
async function retireImage(
  row: Pick<CharacterImageRow, 'id' | 'storage_kind' | 'master_ref' | 'thumb_ref'>,
): Promise<void> {
  if (row.storage_kind === 'cloud') {
    await softDeleteCharacterImage(row.id, 'pending_delete')
    return
  }
  await removeImageBytesThenRow(row)
}

export async function deleteCharacterImage(imageId: string, userId: string): Promise<void> {
  const row = await getCharacterImageById(imageId)
  // Treated the same as "row not found": the local DB is scoped to the
  // device's signed-in user, so a mismatch means a stale caller from a
  // previous session, not an attacker — but the check still keeps a leftover
  // reference from one account from ever touching another's row.
  if (!row || row.user_id !== userId) return

  const active = await getActiveCharacterImage(row.character_id)

  if (active?.id === imageId) {
    // Repoint before removing the row so a failure in between can never leave
    // active_image_id pointing at a row that no longer exists. Promotes the next
    // newest surviving image; falls back to the bundled default when none remain.
    // 'reserved' rows are excluded: their bytes are not confirmed and the user
    // has never seen one, so it must never become the active pointer.
    const remaining = (await getAllImagesForCharacter(row.character_id)).filter(
      (candidate) =>
        candidate.id !== imageId && !candidate.deleted_at && candidate.sync_state !== 'reserved',
    )
    await setActiveImageId(row.character_id, remaining[0]?.id ?? null)
  }

  await retireImage(row)
}

/** Full cascade for character hard-delete and purge. Includes tombstoned rows. */
export async function deleteAllImagesForCharacter(
  characterId: string,
  userId: string,
): Promise<void> {
  const rows = (await getAllImagesForCharacter(characterId)).filter((row) => row.user_id === userId)
  for (const row of rows) {
    await retireImage(row)
  }
  await setActiveImageId(characterId, null)
}
