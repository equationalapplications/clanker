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

import Storage from 'expo-sqlite/kv-store'
import { supabaseClient } from '~/config/supabaseClient'
import { getCurrentUser } from '~/config/firebaseConfig'
import { reportError } from '~/utilities/reportError'
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

/**
 * Returns the Supabase Auth UUID for the currently authenticated user,
 * or null if no Supabase session is active.
 * Cloud operations (upsert / delete / select on `clanker_characters`) must use
 * this id, NOT the Firebase UID, to satisfy RLS and match existing rows.
 */
async function getCloudUserId(): Promise<string | null> {
    const {
        data: { session },
        error,
    } = await supabaseClient.auth.getSession()

    if (error) {
        // Real auth error (storage failure, corrupt session, etc.) —
        // surface it so callers' .catch() handlers can log / retry.
        throw new Error(`Failed to resolve Supabase user: ${error.message}`)
    }

    if (!session?.user) {
        // No active Supabase session yet (e.g. exchangeToken hasn't run).
        // This is expected during early startup; warn rather than throw.
        console.warn('getCloudUserId: No Supabase session active — skipping cloud operation')
        return null
    }

    return session.user.id
}

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
 * Sync all pending local changes to Supabase cloud.
 * Safe to call at any time — returns early if user is not authenticated.
 */
export async function syncAllToCloud(userId?: string): Promise<void> {
    // localUserId (Firebase UID) partitions the local SQLite database.
    // cloudUserId (Supabase Auth UUID) is the owner key used in Supabase tables.
    const localUserId = userId || getCurrentUser()?.uid
    if (!localUserId) return

    const cloudUserId = await getCloudUserId()
    if (!cloudUserId) return

    try {
        await Promise.all([
            syncUnsyncedToCloud(localUserId, cloudUserId),
            syncDeletionsToCloud(localUserId, cloudUserId),
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
    // localUserId: Firebase UID — used for local SQLite reads/writes.
    // cloudUserId: Supabase UUID — used for Supabase queries (matches RLS).
    const localUserId = userId || getCurrentUser()?.uid
    if (!localUserId) return

    const cloudUserId = await getCloudUserId()
    if (!cloudUserId) return

    const { data, error } = await supabaseClient
        .from('clanker_characters')
        .select('*')
        .eq('user_id', cloudUserId)
        .order('updated_at', { ascending: false })

    if (error) {
        reportError(error, 'restoreFromCloud')
        throw error
    }

    if (!data || data.length === 0) return

    // Build maps from local characters:
    // - localTimestamps: keyed by both id and cloud_id for timestamp comparison
    // - cloudIdToLocalId: maps cloud_id → local id so we update existing rows
    //   instead of inserting duplicates when IDs differ
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
        .map((cloudChar) => {
            // Use the existing local id when this cloud record was previously
            // synced under a different local id, to avoid creating duplicates
            const localId = cloudIdToLocalId.get(cloudChar.id) ?? cloudChar.id
            return {
                id: localId,
                user_id: localUserId, // Store Firebase UID locally (matches local SQLite partition key)
                name: cloudChar.name,
                avatar: cloudChar.avatar,
                avatar_data: null, // avatar_data is local-only; cloud restore never populates it
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
            }
        })
        .filter((c) => {
            const localTs = localTimestamps.get(c.id)
            // Insert if no local record exists, or if cloud is strictly newer
            return localTs === undefined || c.updated_at > localTs
        })

    if (cloudChars.length > 0) {
        await batchInsertCharacters(cloudChars)
    }
}

async function syncUnsyncedToCloud(localUserId: string, cloudUserId: string): Promise<void> {
    const unsynced = await getUnsyncedCharacters(localUserId)
    if (unsynced.length === 0) return

    for (const char of unsynced) {
        const cloudId = char.cloud_id || char.id

        const { data, error } = await supabaseClient
            .from('clanker_characters')
            .upsert(
                {
                    id: cloudId,
                    user_id: cloudUserId, // Supabase Auth UUID — matches RLS and existing cloud rows
                    name: char.name,
                    avatar: char.avatar,
                    appearance: char.appearance,
                    traits: char.traits,
                    emotions: char.emotions,
                    context: char.context,
                    is_public: char.is_public,
                    created_at: char.created_at,
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

async function syncDeletionsToCloud(localUserId: string, cloudUserId: string): Promise<void> {
    const deleted = await getSoftDeletedCharacters(localUserId)
    if (deleted.length === 0) return

    for (const char of deleted) {
        const cloudId = char.cloud_id || char.id

        const { error } = await supabaseClient
            .from('clanker_characters')
            .delete()
            .eq('id', cloudId)
            .eq('user_id', cloudUserId) // Supabase Auth UUID — matches RLS

        if (error) {
            console.warn('Failed to delete character from cloud:', char.id, error.message)
            continue
        }

        // Cloud deletion confirmed — hard-delete locally (also removes messages)
        await hardDeleteCharacterLocal(char.id, localUserId)
    }
}
