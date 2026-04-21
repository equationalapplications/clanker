/**
 * Character sync service - backup/restore characters between local SQLite and Firebase Cloud Functions
 *
 * Strategy:
 * - Local SQLite is the source of truth
 * - Cloud is a backup; sync is unidirectional (local → cloud) for normal use
 * - restoreFromCloud() imports all cloud characters into local (for new device setup)
 * - Conflict resolution: last-write-wins by updated_at timestamp
 * - Messages are NEVER synced to cloud (privacy)
 * - Deletions are soft-deleted locally first, then propagated to cloud on next sync
 */

import { Storage } from '~/utilities/kvStorage'
import { getCurrentUser } from '~/config/firebaseConfig'
import { reportError } from '~/utilities/reportError'
import { syncCharacterFn, deleteCharacterFn, getUserCharactersFn, getPublicCharacterFn } from './apiClient'
import type { CharacterSnapshot } from './apiClient'
import {
    getUnsyncedCharacters,
    getSoftDeletedCharacters,
    getAllCharactersIncludingDeleted,
    markCharacterSynced,
    hardDeleteCharacterLocal,
    batchInsertCharacters,
    LocalCharacter,
} from '../database/characterDatabase'

const LAST_SYNC_KEY = 'character-last-sync'
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function getLastSyncTime(): Promise<string | null> {
    return Storage.getItem(LAST_SYNC_KEY)
}

async function setLastSyncTime(): Promise<void> {
    try {
        await Storage.setItem(LAST_SYNC_KEY, new Date().toISOString())
    } catch (error) {
        console.warn('Failed to persist last sync time:', error)
    }
}

/**
 * Sync all pending local changes to cloud.
 * Safe to call at any time — returns early if user is not authenticated.
 */
export async function syncAllToCloud(userId?: string): Promise<void> {
    const localUserId = userId || getCurrentUser()?.uid
    if (!localUserId) return

    try {
        await Promise.all([
            syncUnsyncedToCloud(localUserId),
            syncDeletionsToCloud(localUserId),
        ])
        await setLastSyncTime()
    } catch (error) {
        reportError(error, 'characterSync')
        throw error
    }
}

/**
 * Restore all characters from cloud into local storage (for new device setup or data recovery).
 * Uses last-write-wins: cloud records overwrite local only if cloud updated_at is newer.
 */
export async function restoreFromCloud(userId?: string): Promise<void> {
    const localUserId = userId || getCurrentUser()?.uid
    if (!localUserId) return

    try {
        const result = await getUserCharactersFn()
        const data = result.data?.characters

        if (!data || data.length === 0) return

        // Build maps from local characters
        const localChars = await getAllCharactersIncludingDeleted(localUserId)
        const localTimestamps = new Map<string, number>()
        const cloudIdToLocalId = new Map<string, string>()
        for (const c of localChars) {
            localTimestamps.set(c.id, c.updated_at)
            if (c.cloud_id) {
                cloudIdToLocalId.set(c.cloud_id, c.id)
                if (c.cloud_id !== c.id) {
                    localTimestamps.set(c.cloud_id, c.updated_at)
                }
            }
        }

        const cloudChars: LocalCharacter[] = data
            .map((cloudChar: CharacterSnapshot) => {
                const localId = cloudIdToLocalId.get(cloudChar.id) ?? cloudChar.id
                return {
                    id: localId,
                    user_id: localUserId,
                    name: cloudChar.name,
                    avatar: cloudChar.avatar,
                    avatar_data: null,
                    avatar_mime_type: null,
                    appearance: cloudChar.appearance,
                    traits: cloudChar.traits,
                    emotions: cloudChar.emotions,
                    context: cloudChar.context,
                    is_public: cloudChar.isPublic ? 1 : 0,
                    created_at: new Date(cloudChar.createdAt).getTime(),
                    updated_at: new Date(cloudChar.updatedAt).getTime(),
                    synced_to_cloud: 1 as number,
                    save_to_cloud: 1 as number,
                    cloud_id: cloudChar.id,
                    deleted_at: null as number | null,
                }
            })
            .filter((c: LocalCharacter) => {
                const localTs = localTimestamps.get(c.id)
                return localTs === undefined || c.updated_at > localTs
            })

        if (cloudChars.length > 0) {
            await batchInsertCharacters(cloudChars)
        }
    } catch (error) {
        reportError(error, 'restoreFromCloud')
        throw error
    }
}

async function syncUnsyncedToCloud(localUserId: string): Promise<void> {
    const unsynced = await getUnsyncedCharacters(localUserId)
    if (unsynced.length === 0) return

    for (const char of unsynced) {
        const cloudId = char.cloud_id && UUID_REGEX.test(char.cloud_id) ? char.cloud_id : null

        try {
            const result = await syncCharacterFn({
                character: {
                    ...(cloudId ? { id: cloudId } : {}),
                    name: char.name,
                    avatar: char.avatar,
                    appearance: char.appearance,
                    traits: char.traits,
                    emotions: char.emotions,
                    context: char.context,
                    isPublic: Boolean(char.is_public),
                    createdAt: new Date(char.created_at).toISOString(),
                    updatedAt: new Date(char.updated_at).toISOString(),
                }
            })
            
            const data = result.data

            if (data?.id) {
                await markCharacterSynced(char.id, data.id)
            }
        } catch (error: any) {
            console.warn('Failed to sync character to cloud:', char.id, error.message)
        }
    }
}

export async function importSharedCharacterFromCloud(
    cloudCharacterId: string,
    userId?: string,
): Promise<{ localCharacterId: string; cloudCharacterId: string }> {
    const localUserId = userId || getCurrentUser()?.uid
    if (!localUserId) {
        throw new Error('User not authenticated')
    }

    const result = await getPublicCharacterFn({ characterId: cloudCharacterId })
    const cloudCharacter = result.data
    if (!cloudCharacter) {
        throw new Error('Shared character not found')
    }

    const localChars = await getAllCharactersIncludingDeleted(localUserId)
    const existingLocal = localChars.find((char) => char.cloud_id === cloudCharacter.id)
    const localCharacterId =
        existingLocal?.id || `char_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    await batchInsertCharacters([
        {
            id: localCharacterId,
            user_id: localUserId,
            name: cloudCharacter.name,
            avatar: cloudCharacter.avatar,
            avatar_data: null,
            avatar_mime_type: null,
            appearance: cloudCharacter.appearance,
            traits: cloudCharacter.traits,
            emotions: cloudCharacter.emotions,
            context: cloudCharacter.context,
            is_public: cloudCharacter.isPublic ? 1 : 0,
            created_at: new Date(cloudCharacter.createdAt).getTime(),
            updated_at: new Date(cloudCharacter.updatedAt).getTime(),
            synced_to_cloud: 1,
            save_to_cloud: 0,
            cloud_id: cloudCharacter.id,
            deleted_at: null,
        },
    ])

    return { localCharacterId, cloudCharacterId: cloudCharacter.id }
}

async function syncDeletionsToCloud(localUserId: string): Promise<void> {
    const deleted = await getSoftDeletedCharacters(localUserId)
    if (deleted.length === 0) return

    for (const char of deleted) {
        const cloudId = char.cloud_id && UUID_REGEX.test(char.cloud_id) ? char.cloud_id : null

        if (!cloudId) {
            await hardDeleteCharacterLocal(char.id, localUserId)
            continue
        }

        try {
            await deleteCharacterFn({ characterId: cloudId })
            
            // Cloud deletion confirmed — hard-delete locally (also removes messages)
            await hardDeleteCharacterLocal(char.id, localUserId)
        } catch (error: any) {
            console.warn('Failed to delete character from cloud:', char.id, error.message)
        }
    }
}
