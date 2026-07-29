/**
 * Cloud sync for `character_images`.
 *
 * Image history is an append-mostly log with deletions: it cannot ride inside
 * the character snapshot, and last-write-wins on `updated_at` cannot settle a
 * set difference. Hence a dedicated sweeper plus a dedicated callable.
 */

import { File } from 'expo-file-system'
import { Platform } from 'react-native'
import {
  getActiveCharacterImage,
  getAllImagesForCharacter,
  getCharacterImageById,
  getImagesBySyncState,
  getStaleImageReservations,
  hardDeleteCharacterImage,
  incrementSyncAttempts,
  insertCharacterImage,
  setActiveImageId,
  setImageSyncState,
  updateImageRefs,
  type CharacterImageRow,
} from '~/database/characterImageDatabase'
import type { CharacterImageSnapshot } from '~/services/apiClient'
import { getAllCharactersIncludingDeleted, getCharacter } from '~/database/characterDatabase'
import { deleteLocalImageBytes, resolveImageUri, writeLocalImageBytes } from '~/services/localImageStore'
import { deleteStorageObject, downloadImageBase64, uploadImageBytes } from '~/services/storageService'
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

/**
 * How long a reservation must sit before it counts as debris.
 *
 * The only thing separating "a save that is still running" from "a save whose
 * process died" is elapsed time, so this has to comfortably exceed the slowest
 * plausible upload. Reaping early would delete the objects of an in-flight save
 * and leave the user's committed row pointing at nothing; reaping late costs
 * only a little unreferenced storage for one more sweep.
 */
export const RESERVATION_STALE_MS = 30 * 60 * 1000

/**
 * Collect reservations left behind by a process that died mid-save.
 *
 * The ordinary failure paths drop their own reservation, so this only ever sees
 * rows from a hard kill — where no catch block ran at all. Objects before the
 * row, as everywhere else: the row is the only handle to those paths.
 */
export async function reapStaleImageReservations(localUserId: string): Promise<void> {
  const stale = await getStaleImageReservations(localUserId, Date.now() - RESERVATION_STALE_MS)

  for (const row of stale) {
    try {
      // The upload may never have started, so a missing object is the expected
      // case rather than a failure — deleteStorageObject treats 404 as success.
      await deleteStorageObject(row.master_ref)
      if (row.thumb_ref) await deleteStorageObject(row.thumb_ref)
      await hardDeleteCharacterImage(row.id)
    } catch (error) {
      // Leave the row for the next sweep: it is the only record of these paths.
      reportError(error, 'characterImageSync:reapReservation')
    }
  }
}

export async function syncCharacterImages(localUserId: string): Promise<void> {
  await reapStaleImageReservations(localUserId)

  const characters = await getAllCharactersIncludingDeleted(localUserId)

  // Confirmed cloud ids only. pending_cloud_id is deliberately excluded: the
  // server's id is authoritative, and objects written under a guessed id the
  // server later disagrees with are unreachable forever. Waiting one sweep is
  // the cheaper side of that trade.
  const confirmedCloudIds = new Map<string, string>()
  const cloudToLocalId = new Map<string, string>()
  for (const character of characters) {
    if (character.cloud_id && UUID_REGEX.test(character.cloud_id)) {
      confirmedCloudIds.set(character.id, character.cloud_id)
      cloudToLocalId.set(character.cloud_id, character.id)
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
        // Bytes already in Storage, only the server row missing: an earlier sweep
        // uploaded them and its registration call failed. Re-register rather than
        // re-upload — the local bytes were deleted after that upload, so there is
        // nothing left to send anyway.
        if (row.storage_kind === 'cloud') {
          bucket.uploaded.push(row)
          continue
        }

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
          // Deliberately still pending_upload. 'synced' means "the server knows
          // about this row", which is not true until the callable below returns.
          // Marking it here would drop the image out of every future sweep (the
          // sweeper only queries pending_* states), so a failed registration
          // would mean the server never learns about an image whose bytes are
          // already in Storage.
          sync_state: 'pending_upload',
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
          sync_state: 'pending_upload',
        })
      } else {
        // pending_delete: objects before rows. Deleting the row while its
        // objects survive would strand the bytes with nothing left to retry from.
        // deleteStorageObject treats a missing object as success, so a retry
        // after a failed registration is safe.
        await deleteStorageObject(row.master_ref)
        if (row.thumb_ref) await deleteStorageObject(row.thumb_ref)
        // The row stays a pending_delete tombstone until the server acknowledges.
        // Hard-deleting it here would make the deletion unretryable: the cloud row
        // is still live, so the next reconcile would re-insert the image the user
        // just deleted.
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
      // Opportunistically push the active pointer alongside whatever else this
      // character is syncing. Only meaningful once the active row itself is
      // cloud-visible — either an existing 'cloud' row, or one of the rows this
      // same call is registering — otherwise the server would reject an
      // activeImageId it has never heard of.
      const localCharacterId = cloudToLocalId.get(cloudCharacterId)
      const activeRow = localCharacterId ? await getActiveCharacterImage(localCharacterId) : null
      const activeImageId =
        activeRow &&
        (activeRow.storage_kind === 'cloud' || bucket.uploaded.some((row) => row.id === activeRow.id))
          ? activeRow.id
          : undefined

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
        ...(activeImageId ? { activeImageId } : {}),
      })

      // Acknowledged. Only now is it true that the server knows these rows, so
      // only now do the local states settle: uploads become 'synced' and
      // deletions drop their tombstone. Everything above this line is written so
      // that a throw leaves both sets retryable on the next sweep.
      for (const uploaded of bucket.uploaded) {
        await setImageSyncState(uploaded.id, 'synced')
      }
      for (const deletedId of bucket.deleted) {
        await hardDeleteCharacterImage(deletedId)
      }

      // The server owns the cap for cloud characters and returns what it evicted;
      // apply the same deletion locally rather than waiting for the next pull.
      for (const evictedId of result.data?.evictedImageIds ?? []) {
        const evicted = await getCharacterImageById(evictedId)
        if (!evicted) continue
        // Bytes before row: an evicted 'file' row still has local bytes the
        // server cannot reach and has no way to clean up.
        if (evicted.storage_kind === 'file') {
          await deleteLocalImageBytes(evicted.master_ref)
          if (evicted.thumb_ref) await deleteLocalImageBytes(evicted.thumb_ref)
        }
        await hardDeleteCharacterImage(evictedId)
      }
    } catch (error) {
      // Rows stay pending, so the next sweep retries the whole batch. Charge the
      // retry budget for uploads so a permanently-rejected batch (a terminal
      // permission error, say) cannot re-send on every sweep forever.
      //
      // Deletions deliberately get no budget: giving up on one leaves the cloud
      // row live, which resurrects an image the user deleted. Retrying an id
      // costs nothing, so unbounded retry is the safer end of that trade.
      for (const uploaded of bucket.uploaded) {
        await incrementSyncAttempts(uploaded.id)
        if (isTerminalError(error) || uploaded.sync_attempts + 1 >= MAX_SYNC_ATTEMPTS) {
          await setImageSyncState(uploaded.id, 'failed')
        }
      }
      reportError(error, 'characterImageSync:register')
    }
  }
}

/**
 * Push the current local active-image pointer for one character to the cloud
 * immediately, outside the regular sweep cadence.
 *
 * `setActiveImageId` deliberately never bumps `updated_at` (see
 * characterImageDatabase.ts), so the character snapshot's own sync never
 * carries this pointer — this callable is the only vehicle. Call this right
 * after a user activates an image so a second device sees the change without
 * waiting for the next full sweep.
 */
export async function pushActiveImageId(
  localCharacterId: string,
  localUserId: string,
  options: { allowClear?: boolean } = {},
): Promise<void> {
  const character = await getCharacter(localCharacterId, localUserId)
  if (!character?.cloud_id || !UUID_REGEX.test(character.cloud_id)) return

  const active = await getActiveCharacterImage(localCharacterId)

  // No active image is ambiguous on its own: it is either a cleared pointer the
  // other devices need to see, or simply a character whose pointer has not been
  // set yet. Only the delete path knows it is the former, so it opts in — a
  // blind null push could otherwise clear a pointer another device just set.
  if (!active) {
    if (!options.allowClear) return
    try {
      await syncCharacterImagesFn({
        characterId: character.cloud_id,
        images: [],
        deletedImageIds: [],
        activeImageId: null,
      })
    } catch (error) {
      reportError(error, 'characterImageSync:pushActiveImageId')
    }
    return
  }

  // Pushing a 'file'/'inline' id the server has never seen would fail its
  // ownership check; that image is still mid-upload and will carry the
  // pointer itself once the sweep promotes it to 'cloud'.
  if (active.storage_kind !== 'cloud') return

  try {
    await syncCharacterImagesFn({
      characterId: character.cloud_id,
      images: [],
      deletedImageIds: [],
      activeImageId: active.id,
    })
  } catch (error) {
    reportError(error, 'characterImageSync:pushActiveImageId')
  }
}

/**
 * Apply the cloud's image set for one character onto local storage.
 *
 * Three rules, in order of how much damage getting them wrong does:
 *
 * 1. Insert rows we do not have.
 * 2. Hard-delete local rows whose cloud counterpart carries `deleted_at`.
 * 3. Leave everything else alone — in particular, a local `cloud` row merely
 *    ABSENT from the response is not deleted. Absence is ambiguous (truncated
 *    response, partial server failure, genuine delete) and acting on it destroys
 *    paid-for images in bulk and silently. An explicit `deleted_at` cannot be
 *    produced by a bug in the read path.
 *
 * `pending_upload` rows are excluded entirely: by definition they have no cloud
 * counterpart yet.
 */
export async function reconcileCharacterImages(
  localCharacterId: string,
  localUserId: string,
  cloudImages: CharacterImageSnapshot[],
  cloudActiveImageId: string | null,
): Promise<void> {
  const localRows = await getAllImagesForCharacter(localCharacterId)
  const localById = new Map(localRows.map((row) => [row.id, row]))

  for (const snapshot of cloudImages) {
    const existing = localById.get(snapshot.id)

    if (snapshot.deletedAt) {
      // The tombstone is the authoritative delete signal.
      if (existing && existing.sync_state !== 'pending_upload') {
        // A 'failed' file-backed row still has real on-device bytes (by design —
        // see syncCharacterImages); clean them up so a tombstone doesn't just
        // orphan the file while removing the row that pointed at it.
        if (existing.storage_kind === 'file') {
          await deleteLocalImageBytes(existing.master_ref)
          if (existing.thumb_ref) await deleteLocalImageBytes(existing.thumb_ref)
        }
        await hardDeleteCharacterImage(snapshot.id)
      }
      continue
    }

    if (existing) continue

    await insertCharacterImage({
      id: snapshot.id,
      // Image ids need no translation — they are bare uuids minted on the device
      // that created the image and reused verbatim as the cloud PK. Character ids
      // DO need translation, which the caller has already done.
      character_id: localCharacterId,
      user_id: localUserId,
      storage_kind: 'cloud',
      master_ref: snapshot.storagePath,
      thumb_ref: snapshot.thumbPath,
      mime_type: snapshot.mimeType,
      source: snapshot.source,
      sync_state: 'synced',
      sync_attempts: 0,
      created_at: snapshot.createdAt ? new Date(snapshot.createdAt).getTime() : Date.now(),
      deleted_at: null,
    })
  }

  if (cloudActiveImageId) {
    const active = cloudImages.find((image) => image.id === cloudActiveImageId)
    if (active && !active.deletedAt) {
      await setActiveImageId(localCharacterId, cloudActiveImageId)
    }
  }
}

/**
 * Toggle ON: hand every local row to the sweeper.
 *
 * `save_to_cloud` flips at runtime but write-path routing (file/inline vs cloud)
 * is decided per image at creation time, so flipping the flag alone strands
 * existing images in the mode they were created under. Marking them
 * `pending_upload` here lets `syncCharacterImages` pick them up on the next sweep
 * using its existing upload path — no separate upload logic to keep in sync.
 */
export async function promoteCharacterImagesToCloud(localCharacterId: string): Promise<void> {
  const rows = await getAllImagesForCharacter(localCharacterId)
  for (const row of rows) {
    if (row.deleted_at) continue
    if (row.storage_kind === 'cloud') continue
    await setImageSyncState(row.id, 'pending_upload')
  }
}

/**
 * Toggle OFF: pull every cloud row back to local storage BEFORE destroying anything.
 *
 * Requires network. Offline it refuses outright rather than partially proceeding:
 * a half-completed demotion leaves rows whose bytes are gone and whose cloud
 * copy is also gone.
 */
export async function demoteCharacterImagesToLocal(
  localCharacterId: string,
  localUserId: string,
  cloudCharacterId?: string,
): Promise<void> {
  const rows = await getAllImagesForCharacter(localCharacterId)
  const cloudRows = rows.filter((row) => row.storage_kind === 'cloud' && !row.deleted_at)
  if (cloudRows.length === 0) return

  // Phase 1 — download everything. Any failure aborts before a single byte is
  // destroyed, so the character is left exactly as it was.
  const downloaded: { row: CharacterImageRow; master: string; thumb: string | null }[] = []
  for (const row of cloudRows) {
    const master = await downloadImageBase64(row.master_ref)
    const thumb = row.thumb_ref ? await downloadImageBase64(row.thumb_ref) : null
    downloaded.push({ row, master, thumb })
  }

  // Phase 2 — write locally. Native gets files; web has no file system, so bytes
  // go inline in the row. Same platform split the write path already encodes.
  const localKind = Platform.OS === 'web' ? 'inline' : 'file'
  const rewritten: { row: CharacterImageRow; masterRef: string; thumbRef: string | null }[] = []
  for (const item of downloaded) {
    const masterRef =
      localKind === 'inline' ? item.master : await writeLocalImageBytes(item.row.id, item.master, 'master')
    const thumbRef = item.thumb
      ? localKind === 'inline'
        ? item.thumb
        : await writeLocalImageBytes(item.row.id, item.thumb, 'thumb')
      : null
    rewritten.push({ row: item.row, masterRef, thumbRef })
  }

  // Phase 3 — only now is it safe to destroy the cloud copies.
  for (const item of rewritten) {
    await updateImageRefs(item.row.id, {
      storage_kind: localKind,
      master_ref: item.masterRef,
      thumb_ref: item.thumbRef,
      mime_type: item.row.mime_type,
      sync_state: 'local',
    })
    await deleteStorageObject(item.row.master_ref)
    if (item.row.thumb_ref) await deleteStorageObject(item.row.thumb_ref)
  }

  if (cloudCharacterId) {
    try {
      await syncCharacterImagesFn({
        characterId: cloudCharacterId,
        images: [],
        deletedImageIds: cloudRows.map((row) => row.id),
      })
    } catch (error) {
      reportError(error, 'characterImageSync:demote')
    }
  }
}
