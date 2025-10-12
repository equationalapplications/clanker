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
  acceptTerms,
  checkTermsAcceptance,
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
  terms: (userId: string | undefined, version: string) =>
    [...userKeys.all, 'terms', userId, version] as const,
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
 * Hook to get public user data (legacy format)
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
 * Hook to get private user data (legacy format)
 */
export function useUserPrivateData() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: userKeys.private(user?.uid),
    queryFn: getUserPrivate,
    enabled: !!user,
    staleTime: 1000 * 30, // 30 seconds - credits change frequently
  })

  // Set up real-time subscription for credits changes
  useEffect(() => {
    if (!user?.uid) return

    const channel = supabaseClient
      .channel(`user-credits-${user.uid}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_app_subscriptions',
          filter: `user_id=eq.${user.uid}`,
        },
        (payload) => {
          console.log('📡 Real-time credits change')
          queryClient.invalidateQueries({ queryKey: userKeys.private(user.uid) })
        },
      )
      .subscribe()

    return () => {
      supabaseClient.removeChannel(channel)
    }
  }, [user?.uid, queryClient])

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

/**
 * Mutation hook to accept terms with optimistic update
 */
export function useAcceptTerms() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: (termsVersion: string = '1.0') => acceptTerms(termsVersion),

    // Optimistic update - assume success immediately
    onMutate: async (termsVersion) => {
      // Update terms acceptance in cache immediately
      queryClient.setQueryData(userKeys.terms(user?.uid, termsVersion), true)

      return { termsVersion }
    },

    onSuccess: (data, termsVersion) => {
      console.log('✅ Terms accepted successfully')

      // Invalidate related queries to refetch with updated data
      queryClient.invalidateQueries({ queryKey: userKeys.private(user?.uid) })
      queryClient.setQueryData(userKeys.terms(user?.uid, termsVersion), true)
    },

    onError: (error, termsVersion, context) => {
      console.error('❌ Failed to accept terms:', error)

      // Rollback optimistic update
      if (context?.termsVersion) {
        queryClient.setQueryData(userKeys.terms(user?.uid, context.termsVersion), false)
      }
    },
  })
}

/**
 * Hook to check if user has accepted current terms
 */
export function useTermsAcceptance(currentVersion: string = '1.0') {
  const { user } = useAuth()

  return useQuery({
    queryKey: userKeys.terms(user?.uid, currentVersion),
    queryFn: () => checkTermsAcceptance(currentVersion),
    enabled: !!user,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
