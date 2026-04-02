/**
 * TanStack Query cache persister using expo-sqlite/kv-store
 * 
 * Properly serializes the PersistedClient state and filters out:
 * - Non-serializable Promises
 * - Function closures
 * 
 * This fixes the "[object Promise]" bug that causes the app to crash on resume
 * with "Failed to restore query cache: SyntaxError: Unexpected token 'o'"
 */

import Storage from 'expo-sqlite/kv-store'
import type { Persister, PersistedClient } from '@tanstack/react-query-persist-client'

const CACHE_KEY = 'tanstack-query-cache'

/**
 * Custom replacer function for JSON.stringify that filters out non-serializable items.
 * Prevents Promise objects and functions from being serialized.
 */
function cacheReplacer(_key: string, value: any): any {
    // Skip Promise objects - they can't be serialized and cause the "[object Promise]" error
    if (value instanceof Promise) {
        if (__DEV__) console.debug(`[QueryCache] Skipping Promise during serialization`)
        return undefined
    }

    // Skip functions and callbacks - they can't be serialized
    if (typeof value === 'function') {
        if (__DEV__) console.debug(`[QueryCache] Skipping function during serialization`)
        return undefined
    }

    return value
}

export const kvStorePersister: Persister = {
    persistClient: async (persistedClient: PersistedClient) => {
        try {
            // CRITICAL FIX: Use the custom replacer when serializing to filter out non-JSON-serializable items
            // (Promises, functions, etc.) that would cause "[object Promise]" errors on restore.
            // The persistedClient is already prepared by PersistQueryClientProvider, but the replacer
            // ensures any stray non-serializable values are stripped before writing to storage.

            const serialized = JSON.stringify(persistedClient, cacheReplacer)

            // Safety check: prevent storing Promise-stringified values that would corrupt the cache
            if (serialized.includes('[object Promise]')) {
                console.error(
                    '[QueryCache] Found serialized Promise in cache - preventing persistence to avoid corruption'
                )
                return
            }

            await Storage.setItem(CACHE_KEY, serialized)
        } catch (error) {
            console.warn('[QueryCache] Failed to persist:', error)
        }
    },

    restoreClient: async (): Promise<PersistedClient | undefined> => {
        try {
            const data = await Storage.getItem(CACHE_KEY)
            if (!data) {
                return undefined
            }

            // Attempt to parse - distinguish between serialization and corruption
            let cacheState: PersistedClient | null = null
            try {
                cacheState = JSON.parse(data)
            } catch (parseError) {
                // Cache is corrupted - clear it and return undefined so app refetches from server
                console.error(
                    '[QueryCache] Cache corrupted (JSON parse failed). Clearing cache to allow recovery. Error:',
                    parseError instanceof Error ? parseError.message : String(parseError)
                )
                await Storage.removeItem(CACHE_KEY)
                return undefined
            }

            // Validate structure - check for required PersistedClient fields
            if (!cacheState || typeof cacheState !== 'object' || !('clientState' in cacheState)) {
                console.warn('[QueryCache] Cache has invalid structure, discarding')
                await Storage.removeItem(CACHE_KEY)
                return undefined
            }

            if (__DEV__) console.debug(`[QueryCache] Restored cache successfully`)
            return cacheState as PersistedClient
        } catch (error) {
            console.warn('[QueryCache] Failed to restore:', error)
            // On any error, clear to prevent repeated failures
            try {
                await Storage.removeItem(CACHE_KEY)
            } catch {
                // Ignore cleanup errors
            }
            return undefined
        }
    },

    removeClient: async () => {
        try {
            await Storage.removeItem(CACHE_KEY)
            console.debug('[QueryCache] Cache cleared')
        } catch (error) {
            console.warn('[QueryCache] Failed to remove cache:', error)
        }
    },
}
