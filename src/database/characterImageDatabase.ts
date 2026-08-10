/**
 * Persistence layer for the character avatar gallery.
 *
 * Every SQL statement touching `character_images` (and `characters.active_image_id`)
 * lives here. Routing, byte handling, and network work belong to the service layer
 * above — keeping this module SQL-only is what lets those services be tested
 * against a mock of this file instead of a mock of SQLite.
 */

import { getDatabase } from './index'

export type ImageStorageKind = 'cloud' | 'file' | 'inline'
export type ImageSource = 'generated' | 'uploaded' | 'imported' | 'chat'
/**
 * `reserved` is not a sync state so much as a claim: the row exists so that the
 * Storage objects it names are discoverable, but its bytes are not confirmed and
 * the user has never seen it. It is written before a cloud upload begins and
 * leaves that state as soon as the upload resolves either way, so any row still
 * `reserved` minutes later is debris from a process that died mid-save. Every
 * user-facing query excludes it; `reapStaleImageReservations` cleans it up.
 */
export type ImageSyncState =
  | 'local'
  | 'synced'
  | 'pending_upload'
  | 'pending_delete'
  | 'failed'
  | 'reserved'

export interface CharacterImageRow {
  id: string
  character_id: string
  user_id: string
  storage_kind: ImageStorageKind
  master_ref: string
  thumb_ref: string | null
  mime_type: string
  source: ImageSource
  sync_state: ImageSyncState
  sync_attempts: number
  created_at: number
  deleted_at: number | null
  /**
   * The chat message this photo arrived on, for `source: 'chat'` rows; null for
   * avatars. Not a foreign key — see migration 24.
   */
  message_id: string | null
}

export async function insertCharacterImage(row: CharacterImageRow): Promise<void> {
  const db = await getDatabase()
  await db.runAsync(
    `INSERT INTO character_images
     (id, character_id, user_id, storage_kind, master_ref, thumb_ref, mime_type, source, sync_state, sync_attempts, created_at, deleted_at, message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.character_id,
      row.user_id,
      row.storage_kind,
      row.master_ref,
      row.thumb_ref,
      row.mime_type,
      row.source,
      row.sync_state,
      row.sync_attempts,
      row.created_at,
      row.deleted_at,
      row.message_id ?? null,
    ],
  )
}

/** Live images for a character, newest first — what the picker renders. */
export async function getCharacterImages(characterId: string): Promise<CharacterImageRow[]> {
  const db = await getDatabase()
  return db.getAllAsync<CharacterImageRow>(
    `SELECT * FROM character_images
     WHERE character_id = ? AND deleted_at IS NULL AND sync_state != 'reserved'
     ORDER BY created_at DESC`,
    [characterId],
  )
}

/** Includes soft-deleted rows — used by the sync sweeper and cascade deletes. */
export async function getAllImagesForCharacter(characterId: string): Promise<CharacterImageRow[]> {
  const db = await getDatabase()
  return db.getAllAsync<CharacterImageRow>(
    'SELECT * FROM character_images WHERE character_id = ? ORDER BY created_at DESC',
    [characterId],
  )
}

export async function getCharacterImageById(imageId: string): Promise<CharacterImageRow | null> {
  const db = await getDatabase()
  return db.getFirstAsync<CharacterImageRow>('SELECT * FROM character_images WHERE id = ?', [
    imageId,
  ])
}

export async function getActiveCharacterImage(
  characterId: string,
): Promise<CharacterImageRow | null> {
  const db = await getDatabase()
  return db.getFirstAsync<CharacterImageRow>(
    `SELECT i.* FROM character_images i
     JOIN characters c ON c.active_image_id = i.id AND i.character_id = c.id
     WHERE c.id = ? AND i.deleted_at IS NULL AND i.sync_state != 'reserved'`,
    [characterId],
  )
}

export async function setActiveImageId(
  characterId: string,
  imageId: string | null,
): Promise<void> {
  const db = await getDatabase()
  // Deliberately does not touch `updated_at`: the active pointer is synced via the
  // dedicated syncCharacterImages callable, not the character snapshot's last-write-wins.
  // Bumping it without also clearing `synced_to_cloud` would make inbound cloud rows
  // look stale and be discarded, while never being pushed either.
  await db.runAsync('UPDATE characters SET active_image_id = ? WHERE id = ?', [
    imageId,
    characterId,
  ])
}

export async function countCharacterImages(characterId: string): Promise<number> {
  const db = await getDatabase()
  const result = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM character_images
     WHERE character_id = ? AND deleted_at IS NULL AND sync_state != 'reserved'`,
    [characterId],
  )
  return result?.count ?? 0
}

/**
 * Oldest live, locally-capped images for a character, excluding the active one.
 *
 * `activeImageId` is coalesced to '' rather than passed as NULL: `id != NULL`
 * is NULL in SQL, not true, so a NULL parameter would silently match nothing
 * and the cap would never evict.
 *
 * `storage_kind != 'cloud'` is filtered here, not after the LIMIT: cloud rows
 * are excluded from local cap enforcement entirely (their cap is server-side —
 * see enforceLocalCap), so filtering them out post-limit would leave the cap
 * un-enforced whenever the oldest `limit` rows happened to all be cloud-kind,
 * even though older local rows existed further back in the ordering.
 *
 * A non-positive `limit` returns nothing: SQLite treats a negative LIMIT as
 * unbounded, so a caller computing `count - CAP` must not be able to sweep the
 * whole gallery.
 */
export async function getEvictionCandidates(
  characterId: string,
  activeImageId: string | null,
  limit: number,
): Promise<CharacterImageRow[]> {
  if (limit <= 0) return []
  const db = await getDatabase()
  return db.getAllAsync<CharacterImageRow>(
    `SELECT * FROM character_images
     WHERE character_id = ? AND deleted_at IS NULL AND id != ? AND storage_kind != 'cloud'
       AND sync_state != 'reserved'
     ORDER BY created_at ASC
     LIMIT ?`,
    [characterId, activeImageId ?? '', limit],
  )
}

export async function softDeleteCharacterImage(
  imageId: string,
  syncState: ImageSyncState,
): Promise<void> {
  const db = await getDatabase()
  await db.runAsync('UPDATE character_images SET deleted_at = ?, sync_state = ? WHERE id = ?', [
    Date.now(),
    syncState,
    imageId,
  ])
}

export async function hardDeleteCharacterImage(imageId: string): Promise<void> {
  const db = await getDatabase()
  await db.runAsync('DELETE FROM character_images WHERE id = ?', [imageId])
}

export async function setImageSyncState(
  imageId: string,
  syncState: ImageSyncState,
): Promise<void> {
  const db = await getDatabase()
  await db.runAsync('UPDATE character_images SET sync_state = ? WHERE id = ?', [syncState, imageId])
}

export async function incrementSyncAttempts(imageId: string): Promise<void> {
  const db = await getDatabase()
  await db.runAsync('UPDATE character_images SET sync_attempts = sync_attempts + 1 WHERE id = ?', [
    imageId,
  ])
}

export async function updateImageRefs(
  imageId: string,
  refs: {
    storage_kind: ImageStorageKind
    master_ref: string
    thumb_ref: string | null
    mime_type: string
    sync_state: ImageSyncState
  },
): Promise<void> {
  const db = await getDatabase()
  await db.runAsync(
    `UPDATE character_images
     SET storage_kind = ?, master_ref = ?, thumb_ref = ?, mime_type = ?, sync_state = ?
     WHERE id = ?`,
    [refs.storage_kind, refs.master_ref, refs.thumb_ref, refs.mime_type, refs.sync_state, imageId],
  )
}

/**
 * Reservations left behind by a process that died mid-save.
 *
 * `olderThan` is what keeps this from racing a save that is simply still running:
 * a reservation is only debris once it has outlived any plausible upload. There is
 * no partial index for this state — `character_images` holds at most a few hundred
 * rows per user, so a scan once per sweep is cheaper than the migration.
 */
export async function getStaleImageReservations(
  userId: string,
  olderThan: number,
): Promise<CharacterImageRow[]> {
  const db = await getDatabase()
  return db.getAllAsync<CharacterImageRow>(
    `SELECT * FROM character_images
     WHERE user_id = ? AND sync_state = 'reserved' AND created_at < ?
     ORDER BY created_at ASC`,
    [userId, olderThan],
  )
}

/**
 * Inline rows for a user still missing a thumbnail — what the migration's
 * background pass (step 3) backfills.
 *
 * Queried fresh rather than driven from an in-memory list of rows this run
 * just inserted: a migration interrupted after inserting rows but before this
 * pass runs is skipped on retry by the per-character idempotency check (the
 * character already has gallery rows), so a caller relying only on "what did
 * this pass insert" would leave those rows without a thumbnail forever.
 */
export async function getInlineImagesMissingThumbForUser(
  userId: string,
): Promise<CharacterImageRow[]> {
  const db = await getDatabase()
  return db.getAllAsync<CharacterImageRow>(
    `SELECT * FROM character_images
     WHERE user_id = ? AND storage_kind = 'inline' AND thumb_ref IS NULL AND deleted_at IS NULL`,
    [userId],
  )
}

export async function getImagesBySyncState(
  userId: string,
  states: ImageSyncState[],
): Promise<CharacterImageRow[]> {
  // An empty list would build `sync_state IN ()`, which SQLite rejects as a
  // syntax error. Same defensive shape as getEvictionCandidates' limit guard.
  if (states.length === 0) return []

  const db = await getDatabase()
  const placeholders = states.map(() => '?').join(',')
  return db.getAllAsync<CharacterImageRow>(
    `SELECT * FROM character_images
     WHERE user_id = ? AND sync_state IN (${placeholders})
     ORDER BY created_at ASC`,
    [userId, ...states],
  )
}

/**
 * The live image a message carries, if any.
 *
 * Used by the retry path: a retried vision turn must reuse the existing row
 * rather than write a second one, which would consume two slots against the
 * FIFO cap for one photo. Soft-deleted and reserved rows are excluded — a photo
 * the user deleted must not come back on retry, and a reservation's bytes are
 * not confirmed.
 */
export async function findCharacterImageByMessageId(
  messageId: string,
): Promise<CharacterImageRow | null> {
  const db = await getDatabase()
  return db.getFirstAsync<CharacterImageRow>(
    `SELECT * FROM character_images
     WHERE message_id = ? AND deleted_at IS NULL AND sync_state != 'reserved'
     ORDER BY created_at DESC
     LIMIT 1`,
    [messageId],
  )
}
