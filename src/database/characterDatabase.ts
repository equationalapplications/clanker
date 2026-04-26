/**
 * Local SQLite character database service
 * Supports local-first storage with optional cloud sync
 */

import { getDatabase } from './index'
import { normalizeVoice } from '~/constants/voiceDefaults'
import { sanitizeImageMimeType } from '~/utilities/imageMimeType'

export interface LocalCharacter {
    id: string
    user_id: string
    name: string
    avatar: string | null
    avatar_data: string | null // base64 image data (local-only, not synced to cloud)
    avatar_mime_type: string | null // MIME type of avatar_data (defaults to image/webp)
    appearance: string | null
    traits: string | null
    emotions: string | null
    context: string | null
    is_public: number // 0 or 1 (SQLite boolean)
    created_at: number
    updated_at: number
    synced_to_cloud: number // 0 or 1
    save_to_cloud: number // 0 or 1
    cloud_id: string | null // remote ID if synced
    deleted_at: number | null // null = active, timestamp = soft-deleted
    summary_checkpoint?: number | null // highest message count included in context summary
    owner_user_id: string
    voice: string
}

export interface CharacterInsert {
    name: string
    avatar?: string | null
    avatar_data?: string | null
    avatar_mime_type?: string | null
    appearance?: string | null
    traits?: string | null
    emotions?: string | null
    context?: string | null
    is_public?: boolean
    save_to_cloud?: boolean
    voice?: string | null
}

export interface CharacterUpdate {
    name?: string
    avatar?: string | null
    appearance?: string | null
    traits?: string | null
    emotions?: string | null
    context?: string | null
    summary_checkpoint?: number
    is_public?: boolean
    save_to_cloud?: boolean
    voice?: string | null
}

/**
 * Convert LocalCharacter to app format
 */
function toAppFormat(char: LocalCharacter) {
    // Prefer avatar_data (local base64) for display; fall back to avatar (cloud URL)
    const displayAvatar = char.avatar_data
        ? `data:${sanitizeImageMimeType(char.avatar_mime_type)};base64,${char.avatar_data}`
        : char.avatar

    return {
        id: char.id,
        user_id: char.user_id,
        name: char.name,
        avatar: displayAvatar,
        appearance: char.appearance,
        traits: char.traits,
        emotions: char.emotions,
        context: char.context,
        is_public: char.save_to_cloud === 1 ? char.is_public === 1 : false,
        created_at: new Date(char.created_at).toISOString(),
        updated_at: new Date(char.updated_at).toISOString(),
        synced_to_cloud: char.synced_to_cloud === 1,
        save_to_cloud: char.save_to_cloud === 1,
        cloud_id: char.cloud_id,
        summary_checkpoint: char.summary_checkpoint ?? 0,
        owner_user_id: char.owner_user_id,
        voice: char.voice,
    }
}

/**
 * Get all characters for a user
 */
export async function getUserCharacters(userId: string) {
    const db = await getDatabase()

    const characters = await db.getAllAsync<LocalCharacter>(
        'SELECT * FROM characters WHERE user_id = ? AND (deleted_at IS NULL OR deleted_at = 0) ORDER BY created_at DESC',
        [userId],
    )

    return characters.map(toAppFormat)
}

/**
 * Get a specific character by ID
 */
export async function getCharacter(characterId: string, userId: string) {
    const db = await getDatabase()

    const character = await db.getFirstAsync<LocalCharacter>(
        'SELECT * FROM characters WHERE id = ? AND user_id = ? AND (deleted_at IS NULL OR deleted_at = 0)',
        [characterId, userId],
    )

    return character ? toAppFormat(character) : null
}

/**
 * Create a new character
 */
export async function createCharacter(userId: string, data: CharacterInsert) {
    const db = await getDatabase()

    const id = `char_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const now = Date.now()

    await db.runAsync(
        `INSERT INTO characters 
     (id, user_id, name, avatar, avatar_data, avatar_mime_type, appearance, traits, emotions, context, is_public, created_at, updated_at, synced_to_cloud, save_to_cloud, cloud_id, deleted_at, summary_checkpoint, owner_user_id, voice)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

        [
            id,
            userId,
            data.name,
            data.avatar || null,
            data.avatar_data || null,
            data.avatar_mime_type || 'image/webp',
            data.appearance || null,
            data.traits || null,
            data.emotions || null,
            data.context || null,
            data.is_public ? 1 : 0,
            now,
            now,
            0, // not synced to cloud initially
            data.save_to_cloud ? 1 : 0, // opt-in cloud save
            null, // no cloud ID initially
            null, // not deleted
            0, // no summarized messages yet
            userId,
            normalizeVoice(data.voice),
        ],
    )

    const character = await db.getFirstAsync<LocalCharacter>(
        'SELECT * FROM characters WHERE id = ?',
        [id],
    )

    return character ? toAppFormat(character) : null
}

/**
 * Update an existing character
 */
export async function updateCharacter(
    characterId: string,
    userId: string,
    updates: CharacterUpdate,
) {
    const db = await getDatabase()
    const existing = await db.getFirstAsync<LocalCharacter>(
        'SELECT * FROM characters WHERE id = ? AND user_id = ?',
        [characterId, userId],
    )

    if (!existing) {
        return null
    }

    const updateFields: string[] = ['updated_at = ?']
    const values: any[] = [Date.now()]

    if (updates.name !== undefined) {
        updateFields.push('name = ?')
        values.push(updates.name)
    }
    if (updates.avatar !== undefined) {
        updateFields.push('avatar = ?')
        values.push(updates.avatar)
    }
    if (updates.appearance !== undefined) {
        updateFields.push('appearance = ?')
        values.push(updates.appearance)
    }
    if (updates.traits !== undefined) {
        updateFields.push('traits = ?')
        values.push(updates.traits)
    }
    if (updates.emotions !== undefined) {
        updateFields.push('emotions = ?')
        values.push(updates.emotions)
    }
    if (updates.context !== undefined) {
        updateFields.push('context = ?')
        values.push(updates.context)
    }
    if (updates.summary_checkpoint !== undefined) {
        updateFields.push('summary_checkpoint = ?')
        values.push(updates.summary_checkpoint)
    }
    if (updates.is_public !== undefined) {
        updateFields.push('is_public = ?')
        values.push(updates.is_public ? 1 : 0)
    }
    if (updates.save_to_cloud !== undefined) {
        updateFields.push('save_to_cloud = ?')
        values.push(updates.save_to_cloud ? 1 : 0)
        if (!updates.save_to_cloud) {
            updateFields.push('is_public = ?')
            values.push(0)
        }
    }
    if (updates.voice !== undefined) {
        updateFields.push('voice = ?')
        values.push(normalizeVoice(updates.voice))
    }

    // Mark as not synced when updated locally
    updateFields.push('synced_to_cloud = ?')
    values.push(0)

    values.push(characterId, userId)

    await db.runAsync(
        `UPDATE characters SET ${updateFields.join(', ')} WHERE id = ? AND user_id = ?`,
        values,
    )

    const character = await db.getFirstAsync<LocalCharacter>(
        'SELECT * FROM characters WHERE id = ? AND user_id = ?',
        [characterId, userId],
    )

    return character ? toAppFormat(character) : null
}

/**
 * Soft-delete a character (marks deleted_at, clears synced flag so sync removes it from cloud)
 */
export async function deleteCharacter(characterId: string, userId: string) {
    const db = await getDatabase()
    const now = Date.now()

    await db.runAsync(
        'UPDATE characters SET deleted_at = ?, updated_at = ?, synced_to_cloud = 0 WHERE id = ? AND user_id = ?',
        [now, now, characterId, userId],
    )
}

/**
 * Hard-delete a character and its messages from local storage.
 * Only called after cloud sync confirms the deletion was propagated.
 */
export async function hardDeleteCharacterLocal(characterId: string, userId: string) {
    const db = await getDatabase()

    await db.runAsync('DELETE FROM characters WHERE id = ? AND user_id = ?', [
        characterId,
        userId,
    ])
    await db.runAsync(
        'DELETE FROM messages WHERE character_id = ? AND (sender_user_id = ? OR recipient_user_id = ?)',
        [characterId, userId, userId],
    )
}

/**
 * Get character count for a user
 */
export async function getCharacterCount(userId: string): Promise<number> {
    const db = await getDatabase()

    const result = await db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) as count FROM characters WHERE user_id = ? AND (deleted_at IS NULL OR deleted_at = 0)',
        [userId],
    )

    return result?.count || 0
}

/**
 * Mark a character as synced to cloud
 */
export async function markCharacterSynced(localId: string, cloudId: string) {
    const db = await getDatabase()

    await db.runAsync(
        'UPDATE characters SET synced_to_cloud = ?, cloud_id = ? WHERE id = ?',
        [1, cloudId, localId],
    )
}

/**
 * Clear cloud link for a character (used when unsyncing from cloud)
 * Sets cloud_id = NULL, synced_to_cloud = 0, save_to_cloud = 0, is_public = 0,
 * and refreshes updated_at.
 * Does NOT delete the local record.
 */
export async function clearCharacterCloudLink(characterId: string, userId: string) {
    const db = await getDatabase()

    await db.runAsync(
        'UPDATE characters SET cloud_id = NULL, synced_to_cloud = 0, save_to_cloud = 0, is_public = 0, updated_at = ? WHERE id = ? AND user_id = ?',
        [Date.now(), characterId, userId],
    )
}

/**
 * Get characters that need syncing to cloud
 */
export async function getUnsyncedCharacters(userId: string) {
    const db = await getDatabase()

    const characters = await db.getAllAsync<LocalCharacter>(
        'SELECT * FROM characters WHERE user_id = ? AND synced_to_cloud = 0 AND save_to_cloud = 1 AND (deleted_at IS NULL OR deleted_at = 0) ORDER BY updated_at DESC',
        [userId],
    )

    return characters.map(toAppFormat)
}

/**
 * Get characters that have been soft-deleted and need their deletion synced to cloud
 */
export async function getSoftDeletedCharacters(userId: string) {
    const db = await getDatabase()

    const characters = await db.getAllAsync<LocalCharacter>(
        'SELECT * FROM characters WHERE user_id = ? AND deleted_at IS NOT NULL AND deleted_at > 0 AND synced_to_cloud = 0 ORDER BY deleted_at DESC',
        [userId],
    )

    return characters.map(toAppFormat)
}

/**
 * Get all characters for a user including soft-deleted ones (for sync comparison)
 */
export async function getAllCharactersIncludingDeleted(userId: string): Promise<LocalCharacter[]> {
    const db = await getDatabase()

    return db.getAllAsync<LocalCharacter>(
        'SELECT * FROM characters WHERE user_id = ?',
        [userId],
    )
}

/**
 * Search characters by name
 */
export async function searchCharacters(userId: string, searchText: string) {
    const db = await getDatabase()

    const characters = await db.getAllAsync<LocalCharacter>(
        `SELECT * FROM characters 
     WHERE user_id = ? AND name LIKE ? AND (deleted_at IS NULL OR deleted_at = 0)
     ORDER BY created_at DESC`,
        [userId, `%${searchText}%`],
    )

    return characters.map(toAppFormat)
}

/**
 * Batch insert characters (for cloud sync/import)
 */
export async function batchInsertCharacters(characters: LocalCharacter[]) {
    const db = await getDatabase()

    await db.withTransactionAsync(async () => {
        for (const char of characters) {
            await db.runAsync(
                `INSERT OR REPLACE INTO characters 
         (id, user_id, name, avatar, avatar_data, avatar_mime_type, appearance, traits, emotions, context, is_public, created_at, updated_at, synced_to_cloud, save_to_cloud, cloud_id, deleted_at, summary_checkpoint, owner_user_id, voice)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

                [
                    char.id,
                    char.user_id,
                    char.name,
                    char.avatar,
                    char.avatar_data ?? null,
                    char.avatar_mime_type ?? 'image/webp',
                    char.appearance,
                    char.traits,
                    char.emotions,
                    char.context,
                    char.is_public,
                    char.created_at,
                    char.updated_at,
                    char.synced_to_cloud,
                    char.save_to_cloud,
                    char.cloud_id,
                    char.deleted_at ?? null,
                    char.summary_checkpoint ?? 0,
                    char.owner_user_id || char.user_id,
                    normalizeVoice(char.voice),
                ],
            )
        }
    })
}
