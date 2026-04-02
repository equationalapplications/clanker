/**
 * React Query hooks for user profile management with offline support
 *
 * Features:
 * - Automatic caching and background updates
 * - Optimistic updates for profile changes
 * - Real-time subscriptions via query invalidation
 * - Offline mutation queuing
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useAuth } from '~/auth/useAuth'
import {
  getUserProfile,
  upsertUserProfile,
  getUserPublic,
  getUserPrivate,
  UserProfile,
  UserProfileUpdate,
} from '~/services/userService'
import { supabaseClient } from '~/config/supabaseClient'

/**
 * Query key factory for user data
 */
export const userKeys = {
  all: ['user'] as const,
  profile: (userId: string | undefined) => [...userKeys.all, 'profile', userId] as const,
  public: (userId: string | undefined) => [...userKeys.all, 'public', userId] as const,
  private: (userId: string | undefined) => [...userKeys.all, 'private', userId] as const,
}

/**
 * Hook to get user profile with React Query
 */
export function useUserProfile() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: userKeys.profile(user?.uid),
    queryFn: getUserProfile,
    enabled: !!user,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })

  // Set up real-time subscription
  useEffect(() => {
    if (!user?.uid) return

    const channel = supabaseClient
      .channel(`user-profile-${user.uid}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
          filter: `user_id=eq.${user.uid}`,
        },
        (payload) => {
          console.log('📡 Real-time profile change:', payload.eventType)
          queryClient.invalidateQueries({ queryKey: userKeys.profile(user.uid) })
        },
      )
      .subscribe()

    return () => {
      supabaseClient.removeChannel(channel)
    }
  }, [user?.uid, queryClient])

  return {
    ...query,
    profile: query.data,
  }
}

/**
 * Hook to get public user data
 */
export function useUserPublicData() {
  const { user } = useAuth()

  const query = useQuery({
    queryKey: userKeys.public(user?.uid),
    queryFn: getUserPublic,
    enabled: !!user,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })

  return {
    ...query,
    userPublic: query.data,
  }
}

/**
 * Hook to get private user data
 */
export function useUserPrivateData() {
  const { user } = useAuth()

  const query = useQuery({
    queryKey: userKeys.private(user?.uid),
    queryFn: getUserPrivate,
    enabled: !!user,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })

  return {
    ...query,
    userPrivate: query.data,
  }
}

/**
 * Mutation hook to update user profile with optimistic update
 */
export function useUpdateProfile() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: (updates: UserProfileUpdate) => upsertUserProfile(updates),

    // Optimistic update
    onMutate: async (updates) => {
      await queryClient.cancelQueries({ queryKey: userKeys.profile(user?.uid) })

      const previousProfile = queryClient.getQueryData<UserProfile>(userKeys.profile(user?.uid))

      // Optimistically update the profile
      queryClient.setQueryData<UserProfile>(userKeys.profile(user?.uid), (old) => {
        if (!old) return old
        return { ...old, ...updates, updated_at: new Date().toISOString() }
      })

      return { previousProfile }
    },

    onSuccess: (data) => {
      console.log('✅ Profile updated successfully')

      // Update with real data from server
      if (data) {
        queryClient.setQueryData(userKeys.profile(user?.uid), data)

        // Invalidate related queries
        queryClient.invalidateQueries({ queryKey: userKeys.public(user?.uid) })
        queryClient.invalidateQueries({ queryKey: userKeys.private(user?.uid) })
      }
    },

    onError: (error, variables, context) => {
      console.error('❌ Failed to update profile:', error)

      // Rollback optimistic update
      if (context?.previousProfile) {
        queryClient.setQueryData(userKeys.profile(user?.uid), context.previousProfile)
      }
    },
  })
}


