/**
 * Local SQLite character database service
 * Supports local-first storage with optional cloud sync
 */

import { getDatabase } from './index'

export interface LocalCharacter {
    id: string
    user_id: string
    name: string
    avatar: string | null
    appearance: string | null
    traits: string | null
    emotions: string | null
    context: string | null
    is_public: number // 0 or 1 (SQLite boolean)
    created_at: number
    updated_at: number
    synced_to_cloud: number // 0 or 1
    cloud_id: string | null // Supabase ID if synced
}

export interface CharacterInsert {
    name: string
    avatar?: string | null
    appearance?: string | null
    traits?: string | null
    emotions?: string | null
    context?: string | null
    is_public?: boolean
}

export interface CharacterUpdate {
    name?: string
    avatar?: string | null
    appearance?: string | null
    traits?: string | null
    emotions?: string | null
    context?: string | null
    is_public?: boolean
}

/**
 * Convert LocalCharacter to app format
 */
function toAppFormat(char: LocalCharacter) {
    return {
        id: char.id,
        user_id: char.user_id,
        name: char.name,
        avatar: char.avatar,
        appearance: char.appearance,
        traits: char.traits,
        emotions: char.emotions,
        context: char.context,
        is_public: char.is_public === 1,
        created_at: new Date(char.created_at).toISOString(),
        updated_at: new Date(char.updated_at).toISOString(),
        synced_to_cloud: char.synced_to_cloud === 1,
        cloud_id: char.cloud_id,
    }
}

/**
 * Get all characters for a user
 */
export async function getUserCharacters(userId: string) {
    const db = await getDatabase()

    const characters = await db.getAllAsync<LocalCharacter>(
        'SELECT * FROM characters WHERE user_id = ? ORDER BY created_at DESC',
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
        'SELECT * FROM characters WHERE id = ? AND user_id = ?',
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
     (id, user_id, name, avatar, appearance, traits, emotions, context, is_public, created_at, updated_at, synced_to_cloud, cloud_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            id,
            userId,
            data.name,
            data.avatar || null,
            data.appearance || null,
            data.traits || null,
            data.emotions || null,
            data.context || null,
            data.is_public ? 1 : 0,
            now,
            now,
            0, // not synced to cloud initially
            null, // no cloud ID initially
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
    if (updates.is_public !== undefined) {
        updateFields.push('is_public = ?')
        values.push(updates.is_public ? 1 : 0)
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
 * Delete a character
 */
export async function deleteCharacter(characterId: string, userId: string) {
    const db = await getDatabase()

    await db.runAsync('DELETE FROM characters WHERE id = ? AND user_id = ?', [characterId, userId])

    // Also delete all messages for this character
    await db.runAsync('DELETE FROM messages WHERE character_id = ?', [characterId])
}

/**
 * Get character count for a user
 */
export async function getCharacterCount(userId: string): Promise<number> {
    const db = await getDatabase()

    const result = await db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) as count FROM characters WHERE user_id = ?',
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
 * Get characters that need syncing to cloud
 */
export async function getUnsyncedCharacters(userId: string) {
    const db = await getDatabase()

    const characters = await db.getAllAsync<LocalCharacter>(
        'SELECT * FROM characters WHERE user_id = ? AND synced_to_cloud = 0 ORDER BY updated_at DESC',
        [userId],
    )

    return characters.map(toAppFormat)
}

/**
 * Search characters by name
 */
export async function searchCharacters(userId: string, searchText: string) {
    const db = await getDatabase()

    const characters = await db.getAllAsync<LocalCharacter>(
        `SELECT * FROM characters 
     WHERE user_id = ? AND name LIKE ?
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
         (id, user_id, name, avatar, appearance, traits, emotions, context, is_public, created_at, updated_at, synced_to_cloud, cloud_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    char.id,
                    char.user_id,
                    char.name,
                    char.avatar,
                    char.appearance,
                    char.traits,
                    char.emotions,
                    char.context,
                    char.is_public,
                    char.created_at,
                    char.updated_at,
                    char.synced_to_cloud,
                    char.cloud_id,
                ],
            )
        }
    })
}
