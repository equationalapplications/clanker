import { getDatabase } from '~/database/index'

/**
 * Save a base64-encoded image to SQLite avatar_data column for a character.
 * Returns a data URI suitable for rendering in Image components.
 */
export async function saveCharacterImageLocally(
    characterId: string,
    base64Data: string,
): Promise<string> {
    const db = await getDatabase()

    await db.runAsync(
        'UPDATE characters SET avatar_data = ? WHERE id = ?',
        [base64Data, characterId],
    )

    const dataUri = `data:image/webp;base64,${base64Data}`
    console.log('✅ Character image saved to SQLite avatar_data:', characterId)
    return dataUri
}

/**
 * Read the avatar_data from SQLite and return a data URI, or null if none.
 */
export async function getLocalCharacterImageUri(
    characterId: string,
): Promise<string | null> {
    const db = await getDatabase()

    const row = await db.getFirstAsync<{ avatar_data: string | null }>(
        'SELECT avatar_data FROM characters WHERE id = ?',
        [characterId],
    )

    if (row?.avatar_data) {
        return `data:image/webp;base64,${row.avatar_data}`
    }
    return null
}

/**
 * Delete the local avatar image for a character by setting avatar_data to null.
 */
export async function deleteLocalCharacterImage(
    characterId: string,
): Promise<void> {
    const db = await getDatabase()

    await db.runAsync(
        'UPDATE characters SET avatar_data = NULL WHERE id = ?',
        [characterId],
    )
    console.log('🗑️ Local character image deleted from SQLite:', characterId)
}
