import { QueryClient } from '@tanstack/react-query'
import { Platform } from 'react-native'

/**
 * Enhanced QueryClient with offline capabilities
 *
 * Features:
 * - Aggressive caching for offline use
 * - Automatic retry with backoff
 * - Network-aware refetch behavior
 * - Optimistic updates support
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cache data for 5 minutes (stale after this time but still usable offline)
      staleTime: 1000 * 60 * 5,

      // Keep unused data in cache for 30 minutes for offline access
      gcTime: 1000 * 60 * 30,

      // Retry failed queries with exponential backoff (critical for offline)
      retry: (failureCount, error) => {
        // Don't retry 4xx errors (client errors)
        if (error instanceof Error && 'status' in error) {
          const status = (error as any).status
          if (status >= 400 && status < 500) return false
        }
        // Retry up to 3 times for network errors
        return failureCount < 3
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),

      // Refetch on window focus (web) or app focus (native)
      refetchOnWindowFocus: true,

      // Don't refetch on mount if data is fresh
      refetchOnMount: false,

      // Refetch when network reconnects (critical for offline support)
      refetchOnReconnect: true,

      // Use network status to determine if query should be enabled
      networkMode: 'online',
    },
    mutations: {
      // Retry mutations (will be queued when offline)
      retry: 1,
      retryDelay: 1000,

      // Mutations work differently offline - they're queued
      networkMode: 'offlineFirst',
    },
  },
})
