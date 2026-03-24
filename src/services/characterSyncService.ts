/**
 * Character sync service - backup/restore characters between local SQLite and Supabase cloud
 *
 * Strategy:
 * - Local SQLite is the source of truth
 * - Cloud is a backup; sync is unidirectional (local → cloud) for normal use
 * - restoreFromCloud() imports all cloud characters into local (for new device setup)
 * - Conflict resolution: last-write-wins by updated_at timestamp
 * - Messages are NEVER synced to cloud (privacy)
 * - Deletions are soft-deleted locally first, then propagated to cloud on next sync
 */

import { Storage } from 'expo-sqlite/kv-store'
import { supabaseClient } from '~/config/supabaseClient'
import { getCurrentUser } from '~/config/firebaseConfig'
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

export async function getLastSyncTime(): Promise<string | null> {
    return Storage.getItem(LAST_SYNC_KEY)
}

function setLastSyncTime(): void {
    try {
        Storage.setItem(LAST_SYNC_KEY, new Date().toISOString())
    } catch (error) {
        console.warn('Failed to persist last sync time:', error)
    }
}

/**
 * Sync all pending local changes to Supabase cloud.
 * Safe to call at any time — returns early if user is not authenticated.
 */
export async function syncAllToCloud(userId?: string): Promise<void> {
    const uid = userId || getCurrentUser()?.uid
    if (!uid) return

    try {
        await Promise.all([syncUnsyncedToCloud(uid), syncDeletionsToCloud(uid)])
        setLastSyncTime()
    } catch (error) {
        console.warn('Character sync error:', error)
        throw error
    }
}

/**
 * Restore all characters from cloud into local storage (for new device setup or data recovery).
 * Uses last-write-wins: cloud records overwrite local only if cloud updated_at is newer.
 */
export async function restoreFromCloud(userId?: string): Promise<void> {
    const uid = userId || getCurrentUser()?.uid
    if (!uid) return

    const { data, error } = await supabaseClient
        .from('clanker_characters')
        .select('*')
        .eq('user_id', uid)
        .order('updated_at', { ascending: false })

    if (error) {
        console.error('Failed to restore characters from cloud:', error)
        throw error
    }

    if (!data || data.length === 0) return

    // Build a map of local updated_at timestamps keyed by both id and cloud_id
    // so we correctly detect already-synced records even when cloud_id differs from id
    const localChars = await getAllCharactersIncludingDeleted(uid)
    const localTimestamps = new Map<string, number>()
    for (const c of localChars) {
        localTimestamps.set(c.id, c.updated_at)
        if (c.cloud_id && c.cloud_id !== c.id) {
            localTimestamps.set(c.cloud_id, c.updated_at)
        }
    }

    const cloudChars: LocalCharacter[] = data
        .map((cloudChar) => ({
            id: cloudChar.id,
            user_id: uid,
            name: cloudChar.name,
            avatar: cloudChar.avatar,
            appearance: cloudChar.appearance,
            traits: cloudChar.traits,
            emotions: cloudChar.emotions,
            context: cloudChar.context,
            is_public: cloudChar.is_public ? 1 : 0,
            created_at: new Date(cloudChar.created_at).getTime(),
            updated_at: new Date(cloudChar.updated_at).getTime(),
            synced_to_cloud: 1 as number,
            cloud_id: cloudChar.id,
            deleted_at: null as number | null,
        }))
        .filter((c) => {
            const localTs = localTimestamps.get(c.id)
            // Insert if no local record exists, or if cloud is strictly newer
            return localTs === undefined || c.updated_at > localTs
        })

    if (cloudChars.length > 0) {
        await batchInsertCharacters(cloudChars)
    }
}

async function syncUnsyncedToCloud(userId: string): Promise<void> {
    const unsynced = await getUnsyncedCharacters(userId)
    if (unsynced.length === 0) return

    for (const char of unsynced) {
        const cloudId = char.cloud_id || char.id

        const { data, error } = await supabaseClient
            .from('clanker_characters')
            .upsert(
                {
                    id: cloudId,
                    user_id: userId,
                    name: char.name,
                    avatar: char.avatar,
                    appearance: char.appearance,
                    traits: char.traits,
                    emotions: char.emotions,
                    context: char.context,
                    is_public: char.is_public,
                    updated_at: char.updated_at,
                },
                { onConflict: 'id' },
            )
            .select('id')
            .single()

        if (error) {
            console.warn('Failed to sync character to cloud:', char.id, error.message)
            continue
        }

        if (data) {
            await markCharacterSynced(char.id, data.id)
        }
    }
}

async function syncDeletionsToCloud(userId: string): Promise<void> {
    const deleted = await getSoftDeletedCharacters(userId)
    if (deleted.length === 0) return

    for (const char of deleted) {
        const cloudId = char.cloud_id || char.id

        const { error } = await supabaseClient
            .from('clanker_characters')
            .delete()
            .eq('id', cloudId)
            .eq('user_id', userId)

        if (error) {
            console.warn('Failed to delete character from cloud:', char.id, error.message)
            continue
        }

        // Cloud deletion confirmed — hard-delete locally (also removes messages)
        await hardDeleteCharacterLocal(char.id, userId)
    }
}
