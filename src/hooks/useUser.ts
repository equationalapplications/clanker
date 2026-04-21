/**
 * React Query hooks for user profile management with offline support
 *
 * Features:
 * - Automatic caching and background updates
 * - Optimistic updates for profile changes
 * - Offline mutation queuing
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSelector } from '@xstate/react'
import { useAuthMachine } from '~/hooks/useMachines'
import { requestBootstrapRefresh } from '~/hooks/useBootstrapRefresh'
import {
  upsertUserProfile,
  UserProfile,
  UserProfileUpdate,
} from '~/services/userService'

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
  const authService = useAuthMachine()
  const { user, dbUser, isLoading } = useSelector(authService, (state) => ({
    user: state.context.user,
    dbUser: state.context.dbUser,
    isLoading:
      state.matches('initializing') ||
      state.matches('signingIn') ||
      state.matches('bootstrapping'),
  }))

  const profile: UserProfile | null = dbUser
    ? {
        user_id: dbUser.id,
        display_name: dbUser.displayName,
        email: dbUser.email,
        avatar_url: dbUser.avatarUrl,
        is_profile_public: dbUser.isProfilePublic,
        default_character_id: dbUser.defaultCharacterId,
        created_at: dbUser.createdAt,
        updated_at: dbUser.updatedAt,
      }
    : null

  return {
    data: user ? profile : null,
    profile: user ? profile : null,
    isLoading,
    error: null,
    refetch: async () => {
      if (user) {
        requestBootstrapRefresh(authService, 'manual')
      }
      return Promise.resolve({ data: user ? profile : null })
    },
  }
}

/**
 * Hook to get public user data
 */
export function useUserPublicData() {
  const authService = useAuthMachine()
  const { user, dbUser, isLoading } = useSelector(authService, (state) => ({
    user: state.context.user,
    dbUser: state.context.dbUser,
    isLoading:
      state.matches('initializing') ||
      state.matches('signingIn') ||
      state.matches('bootstrapping'),
  }))

  const userPublic = dbUser
    ? {
        uid: dbUser.id,
        name: dbUser.displayName || '',
        avatar: dbUser.avatarUrl || '',
        email: dbUser.email || '',
      }
    : null

  return {
    data: user ? userPublic : null,
    userPublic: user ? userPublic : null,
    isLoading,
    error: null,
    refetch: async () => {
      if (user) {
        requestBootstrapRefresh(authService, 'manual')
      }
      return Promise.resolve({ data: user ? userPublic : null })
    },
  }
}

/**
 * Hook to get private user data
 */
export function useUserPrivateData() {
  const authService = useAuthMachine()
  const { user, dbUser, subscription, isLoading } = useSelector(authService, (state) => ({
    user: state.context.user,
    dbUser: state.context.dbUser,
    subscription: state.context.subscription,
    isLoading:
      state.matches('initializing') ||
      state.matches('signingIn') ||
      state.matches('bootstrapping'),
  }))

  const userPrivate = user
    ? {
        credits: Math.max(0, subscription?.currentCredits ?? 0),
        isProfilePublic: dbUser?.isProfilePublic ?? null,
        defaultCharacter: dbUser?.defaultCharacterId || '',
        hasAcceptedTermsDate: subscription?.termsAcceptedAt || null,
      }
    : null

  return {
    data: userPrivate,
    userPrivate,
    isLoading,
    error: null,
    refetch: async () => {
      if (user) {
        requestBootstrapRefresh(authService, 'manual')
      }
      return Promise.resolve({ data: userPrivate })
    },
  }
}

/**
 * Mutation hook to update user profile with optimistic update
 */
export function useUpdateProfile() {
  const queryClient = useQueryClient()
  const authService = useAuthMachine()
  const user = useSelector(authService, (state) => state.context.user)

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
        const mappedUpdates = {
          displayName: data.display_name,
          avatarUrl: data.avatar_url,
          isProfilePublic: data.is_profile_public,
          defaultCharacterId: data.default_character_id,
          updatedAt: data.updated_at,
        }
        authService.send({ type: 'DB_USER_PATCHED_LOCAL', updates: mappedUpdates })
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
