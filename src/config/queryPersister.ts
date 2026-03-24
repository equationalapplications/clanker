/**
 * TanStack Query cache persister using expo-sqlite/kv-store
 *
 * Persists the full React Query cache to SQLite key-value storage so
 * previously-fetched data survives app restarts and is available offline.
 */

import { Storage } from 'expo-sqlite/kv-store'
import type { Persister } from '@tanstack/react-query-persist-client'

const CACHE_KEY = 'tanstack-query-cache'

export const kvStorePersister: Persister = {
    persistClient: async (client) => {
        try {
            Storage.setItem(CACHE_KEY, JSON.stringify(client))
        } catch (error) {
            console.warn('Failed to persist query cache:', error)
        }
    },

    restoreClient: async () => {
        try {
            const data = Storage.getItem(CACHE_KEY)
            if (!data) return undefined
            return JSON.parse(data)
        } catch (error) {
            console.warn('Failed to restore query cache:', error)
            return undefined
        }
    },

    removeClient: async () => {
        try {
            Storage.removeItem(CACHE_KEY)
        } catch (error) {
            console.warn('Failed to remove query cache:', error)
        }
    },
}
