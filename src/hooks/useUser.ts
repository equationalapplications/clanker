/**
 * User profile hooks backed by auth machine context.
 *
 * Read hooks derive snapshot data from `authMachine`, and `refetch` triggers
 * an explicit bootstrap refresh event instead of query polling.
 */

import { useMutation } from '@tanstack/react-query'
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
 * Hook to get user profile from auth machine context
 */
export function useUserProfile() {
  const authService = useAuthMachine()
  const user = useSelector(authService, (state) => state.context.user)
  const dbUser = useSelector(authService, (state) => state.context.dbUser)
  const isLoading = useSelector(
    authService,
    (state) =>
      state.matches('initializing') ||
      state.matches('signingIn') ||
      state.matches('bootstrapping')
  )

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
 * Hook to get public user data from auth machine context
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
 * Hook to get private user data from auth machine context
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
 * Mutation hook to update user profile with auth-machine optimistic update
 */
export function useUpdateProfile() {
  const authService = useAuthMachine()
  const dbUser = useSelector(authService, (state) => state.context.dbUser)

  return useMutation({
    mutationFn: (updates: UserProfileUpdate) => upsertUserProfile(updates),

    onMutate: (updates) => {
      if (!dbUser) return { previousDbUser: null }
      authService.send({
        type: 'DB_USER_PATCHED_LOCAL',
        updates: {
          displayName: updates.display_name ?? dbUser.displayName,
          avatarUrl: updates.avatar_url ?? dbUser.avatarUrl,
          isProfilePublic: updates.is_profile_public ?? dbUser.isProfilePublic,
          defaultCharacterId: updates.default_character_id ?? dbUser.defaultCharacterId,
          updatedAt: new Date().toISOString(),
        },
      })

      return { previousDbUser: dbUser }
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
      }
    },

    onError: (error, variables, context: { previousDbUser: typeof dbUser } | undefined) => {
      console.error('❌ Failed to update profile:', error)

      if (context?.previousDbUser) {
        authService.send({
          type: 'DB_USER_PATCHED_LOCAL',
          updates: {
            displayName: context.previousDbUser.displayName,
            avatarUrl: context.previousDbUser.avatarUrl,
            isProfilePublic: context.previousDbUser.isProfilePublic,
            defaultCharacterId: context.previousDbUser.defaultCharacterId,
            updatedAt: context.previousDbUser.updatedAt,
          },
        })
      }
    },
  })
}
