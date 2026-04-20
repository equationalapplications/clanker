import { appCheckReady, deleteMyAccountFn } from '~/config/firebaseConfig'
import { getUserState, updateUserProfile } from './apiClient'
import type { BootstrapResponse } from '~/auth/bootstrapSession'

export interface UserProfile {
  user_id: string
  display_name: string | null
  email: string | null
  avatar_url: string | null
  is_profile_public: boolean
  default_character_id: string | null
  created_at: string
  updated_at: string
}

export interface UserProfileUpdate {
  display_name?: string | null
  avatar_url?: string | null
  is_profile_public?: boolean
  default_character_id?: string | null
}

export interface UserPublic {
  uid: string
  name: string
  avatar: string
  email: string
}

export interface UserPrivate {
  credits: number
  isProfilePublic: boolean | null
  defaultCharacter: string
  hasAcceptedTermsDate: Date | null
}

type Callable<Req, Res> = (payload: Req) => Promise<{ data: Res }>

interface DeleteMyAccountResponse {
  success: boolean
  deleted: boolean
  userId: string | null
}

const mapUserProfileFromState = (state: BootstrapResponse | null): UserProfile | null => {
  if (!state?.user) return null

  return {
    user_id: state.user.id,
    display_name: state.user.displayName,
    email: state.user.email,
    avatar_url: state.user.avatarUrl,
    is_profile_public: state.user.isProfilePublic,
    default_character_id: state.user.defaultCharacterId,
    created_at:
      typeof state.user.createdAt === 'string'
        ? state.user.createdAt
        : state.user.createdAt.toISOString(),
    updated_at:
      typeof state.user.updatedAt === 'string'
        ? state.user.updatedAt
        : state.user.updatedAt.toISOString(),
  }
}

/**
 * Get the current user's profile
 */
export const getUserProfile = async (): Promise<UserProfile | null> => {
  try {
    const state = await getUserState()
    return mapUserProfileFromState(state)
  } catch (error) {
    console.error('Error fetching user profile:', error)
    return null
  }
}

/**
 * Create or update user profile
 */
export const upsertUserProfile = async (
  profile: UserProfileUpdate,
): Promise<UserProfile | null> => {
  try {
    const result = await updateUserProfile({
      displayName: profile.display_name,
      avatarUrl: profile.avatar_url,
      isProfilePublic: profile.is_profile_public,
      defaultCharacterId: profile.default_character_id,
    })
    
    const user = result.data
    return {
      user_id: user.id,
      display_name: user.displayName,
      email: user.email,
      avatar_url: user.avatarUrl,
      is_profile_public: user.isProfilePublic,
      default_character_id: user.defaultCharacterId,
      created_at:
        typeof user.createdAt === 'string' ? user.createdAt : user.createdAt.toISOString(),
      updated_at:
        typeof user.updatedAt === 'string' ? user.updatedAt : user.updatedAt.toISOString(),
    }
  } catch (error) {
    console.error('Error upserting user profile:', error)
    throw error
  }
}

/**
 * Get user profile in the legacy format for compatibility
 */
export const getUserPublic = async (): Promise<UserPublic | null> => {
  const profile = await getUserProfile()

  if (!profile) {
    return null
  }

  return {
    uid: profile.user_id,
    name: profile.display_name || '',
    avatar: profile.avatar_url || '',
    email: profile.email || '',
  }
}

/**
 * Get user private data in the legacy format for compatibility
 */
export const getUserPrivate = async (): Promise<UserPrivate | null> => {
  const state = await getUserState()
  const profile = mapUserProfileFromState(state)

  if (!profile || !state) {
    return null
  }

  return {
    credits: state.subscription.currentCredits || 0,
    isProfilePublic: profile.is_profile_public,
    defaultCharacter: profile.default_character_id || '',
    hasAcceptedTermsDate: state.subscription.termsAcceptedAt ? new Date(state.subscription.termsAcceptedAt) : null,
  }
}

/**
 * Delete user account and all associated data
 */
export const deleteUser = async (): Promise<void> => {
  await appCheckReady

  const deleteMyAccountCallable =
    deleteMyAccountFn as Callable<Record<string, never>, DeleteMyAccountResponse>
  const response = await deleteMyAccountCallable({})

  if (!response.data?.success || !response.data.deleted) {
    throw new Error('Account deletion did not complete successfully')
  }
}

