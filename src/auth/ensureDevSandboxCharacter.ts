import {
  DEV_CLOUD_CHARACTER_ID,
  DEV_CHARACTER_NAME,
  DEV_CHARACTER_TRAITS,
  DEV_FIREBASE_UID,
} from '../../shared/dev-sandbox'
import { DEFAULT_VOICE } from '~/constants/voiceDefaults'
import { getDatabase } from '~/database/index'
import { getCharacter, type LocalCharacter } from '~/database/characterDatabase'

export function isDevSandboxEnabled(): boolean {
  const isDevBuild =
    typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production'
  return isDevBuild && process.env.EXPO_PUBLIC_USE_MOCK_AUTH === 'true'
}

/**
 * Ensures the local SQLite character is linked to the Docker Postgres seed character
 * so mock-auth chat can escalate to the local cloud-agent (`EXPO_PUBLIC_CLOUD_AGENT_URL`,
 * set in `.env.development.local` — never `.env.local`, which Expo loads in all modes).
 */
export async function ensureDevSandboxCharacter(firebaseUid: string): Promise<string | null> {
  if (!isDevSandboxEnabled() || firebaseUid !== DEV_FIREBASE_UID) {
    return null
  }

  const db = await getDatabase()
  const now = Date.now()

  const linked = await db.getFirstAsync<Pick<LocalCharacter, 'id'>>(
    `SELECT id FROM characters
     WHERE user_id = ? AND cloud_id = ? AND (deleted_at IS NULL OR deleted_at = 0)`,
    [firebaseUid, DEV_CLOUD_CHARACTER_ID],
  )

  if (linked) {
    await db.runAsync(
      `UPDATE characters
       SET save_to_cloud = 1, synced_to_cloud = 1, updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [now, linked.id, firebaseUid],
    )
    return linked.id
  }

  const byId = await db.getFirstAsync<Pick<LocalCharacter, 'id'>>(
    `SELECT id FROM characters
     WHERE id = ? AND user_id = ? AND (deleted_at IS NULL OR deleted_at = 0)`,
    [DEV_CLOUD_CHARACTER_ID, firebaseUid],
  )

  if (byId) {
    await db.runAsync(
      `UPDATE characters
       SET cloud_id = ?, save_to_cloud = 1, synced_to_cloud = 1, name = ?, traits = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [DEV_CLOUD_CHARACTER_ID, DEV_CHARACTER_NAME, DEV_CHARACTER_TRAITS, now, byId.id, firebaseUid],
    )
    return byId.id
  }

  // Reuse an existing local-only character so chat history and the chat tab keep working.
  const unlinked = await db.getFirstAsync<Pick<LocalCharacter, 'id'>>(
    `SELECT id FROM characters
     WHERE user_id = ? AND (cloud_id IS NULL OR cloud_id = '')
       AND (deleted_at IS NULL OR deleted_at = 0)
     ORDER BY updated_at DESC
     LIMIT 1`,
    [firebaseUid],
  )

  if (unlinked) {
    await db.runAsync(
      `UPDATE characters
       SET cloud_id = ?, save_to_cloud = 1, synced_to_cloud = 1, updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [DEV_CLOUD_CHARACTER_ID, now, unlinked.id, firebaseUid],
    )
    return unlinked.id
  }

  await db.runAsync(
    `INSERT INTO characters
     (id, user_id, name, avatar, avatar_data, avatar_mime_type, appearance, traits, emotions, context,
      is_public, created_at, updated_at, synced_to_cloud, save_to_cloud, cloud_id, deleted_at,
      summary_checkpoint, owner_user_id, voice)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      DEV_CLOUD_CHARACTER_ID,
      firebaseUid,
      DEV_CHARACTER_NAME,
      null,
      null,
      'image/webp',
      null,
      DEV_CHARACTER_TRAITS,
      null,
      null,
      0,
      now,
      now,
      1,
      1,
      DEV_CLOUD_CHARACTER_ID,
      null,
      0,
      firebaseUid,
      DEFAULT_VOICE,
    ],
  )

  const created = await getCharacter(DEV_CLOUD_CHARACTER_ID, firebaseUid)
  return created?.id ?? DEV_CLOUD_CHARACTER_ID
}
