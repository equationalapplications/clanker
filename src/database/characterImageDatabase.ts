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
export type ImageSource = 'generated' | 'uploaded' | 'imported'
export type ImageSyncState = 'local' | 'synced' | 'pending_upload' | 'pending_delete' | 'failed'

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
}

export async function insertCharacterImage(row: CharacterImageRow): Promise<void> {
  const db = await getDatabase()
  await db.runAsync(
    `INSERT INTO character_images
     (id, character_id, user_id, storage_kind, master_ref, thumb_ref, mime_type, source, sync_state, sync_attempts, created_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    ],
  )
}

/** Live images for a character, newest first — what the picker renders. */
export async function getCharacterImages(characterId: string): Promise<CharacterImageRow[]> {
  const db = await getDatabase()
  return db.getAllAsync<CharacterImageRow>(
    'SELECT * FROM character_images WHERE character_id = ? AND deleted_at IS NULL ORDER BY created_at DESC',
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
     JOIN characters c ON c.active_image_id = i.id
     WHERE c.id = ? AND i.deleted_at IS NULL`,
    [characterId],
  )
}

export async function setActiveImageId(
  characterId: string,
  imageId: string | null,
): Promise<void> {
  const db = await getDatabase()
  await db.runAsync('UPDATE characters SET active_image_id = ?, updated_at = ? WHERE id = ?', [
    imageId,
    Date.now(),
    characterId,
  ])
}

export async function countCharacterImages(characterId: string): Promise<number> {
  const db = await getDatabase()
  const result = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM character_images WHERE character_id = ? AND deleted_at IS NULL',
    [characterId],
  )
  return result?.count ?? 0
}

/**
 * Oldest live images for a character, excluding the active one.
 *
 * `activeImageId` is coalesced to '' rather than passed as NULL: `id != NULL`
 * is NULL in SQL, not true, so a NULL parameter would silently match nothing
 * and the cap would never evict.
 */
export async function getEvictionCandidates(
  characterId: string,
  activeImageId: string | null,
  limit: number,
): Promise<CharacterImageRow[]> {
  const db = await getDatabase()
  return db.getAllAsync<CharacterImageRow>(
    `SELECT * FROM character_images
     WHERE character_id = ? AND deleted_at IS NULL AND id != ?
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

export async function getImagesBySyncState(
  userId: string,
  states: ImageSyncState[],
): Promise<CharacterImageRow[]> {
  const db = await getDatabase()
  const placeholders = states.map(() => '?').join(',')
  return db.getAllAsync<CharacterImageRow>(
    `SELECT * FROM character_images
     WHERE user_id = ? AND sync_state IN (${placeholders})
     ORDER BY created_at ASC`,
    [userId, ...states],
  )
}
