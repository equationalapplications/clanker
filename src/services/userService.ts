import { supabaseClient, Database } from '~/config/supabaseClient'
import { APP_NAME } from '~/config/constants'

// Types for user data
export type UserProfile = Database['public']['Tables']['profiles']['Row']
export type UserProfileInsert = Database['public']['Tables']['profiles']['Insert']
export type UserProfileUpdate = Database['public']['Tables']['profiles']['Update']

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

/**
 * Get credits from user_app_subscriptions table
 */
async function getUserCredits(): Promise<number> {
  const {
    data: { session },
  } = await supabaseClient.auth.getSession()

  const user = session?.user
  if (!user) {
    return 0
  }

  const { data, error } = await supabaseClient
    .from('user_app_subscriptions')
    .select('current_credits')
    .eq('user_id', user.id)
    .eq('app_name', APP_NAME)
    .maybeSingle()

  if (error) {
    console.error('Error fetching credits:', error)
    return 0
  }

  if (!data) {
    return 0
  }

  return data.current_credits
}

/**
 * Sync Firebase Auth user's photoURL to Supabase profile avatar_url
 * This is useful when user signs in with Google or Apple providers
 */
export const syncFirebasePhotoToProfile = async (
  firebasePhotoURL: string | null | undefined,
): Promise<void> => {
  if (!firebasePhotoURL) {
    return
  }

  try {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession()

    const user = session?.user
    if (!user) {
      return
    }

    // Update the profile with the Firebase photo URL
    await upsertUserProfile({
      avatar_url: firebasePhotoURL,
    })

    console.log('✅ Synced Firebase photo to profile')
  } catch (error) {
    console.error('Error syncing Firebase photo to profile:', error)
  }
}

/**
 * Get the current user's profile from Supabase
 */
export const getUserProfile = async (): Promise<UserProfile | null> => {
  const {
    data: { session },
  } = await supabaseClient.auth.getSession()

  const user = session?.user
  if (!user) {
    return null
  }

  const { data, error } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) {
    console.error('Error fetching user profile:', error)
    return null
  }

  // Lazy-create profile if trigger didn't fire (safety net)
  if (!data) {
    try {
      return await upsertUserProfile({
        user_id: user.id,
        email: user.email ?? null,
      })
    } catch (upsertError) {
      console.error('Error creating missing profile:', upsertError)
      return null
    }
  }

  return data
}

/**
 * Create or update user profile in Supabase
 */
export const upsertUserProfile = async (
  profile: UserProfileUpdate,
): Promise<UserProfile | null> => {
  const {
    data: { session },
  } = await supabaseClient.auth.getSession()

  const user = session?.user
  if (!user) {
    throw new Error('No authenticated user')
  }

  const { data, error } = await supabaseClient
    .from('profiles')
    .upsert({
      ...profile,
      user_id: user.id,
    })
    .select()
    .single()

  if (error) {
    console.error('Error upserting user profile:', error)
    throw error
  }

  return data
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
    name: profile.display_name || profile.email || '',
    avatar: profile.avatar_url || '',
    email: profile.email || '',
  }
}

/**
 * Get user private data in the legacy format for compatibility
 */
export const getUserPrivate = async (): Promise<UserPrivate | null> => {
  const profile = await getUserProfile()

  if (!profile) {
    return null
  }

  // Get credits from user_app_subscriptions
  const credits = await getUserCredits()

  return {
    credits,
    isProfilePublic: profile.is_profile_public,
    defaultCharacter: profile.default_character_id || '',
    hasAcceptedTermsDate: null, // Will be handled by app permissions check
  }
}

/**
 * Delete user account and all associated data
 */
export const deleteUser = async (): Promise<void> => {
  const {
    data: { session },
  } = await supabaseClient.auth.getSession()

  const user = session?.user
  if (!user) {
    throw new Error('No authenticated user')
  }

  // Delete user profile (cascading deletes will handle related data)
  const { error: profileError } = await supabaseClient
    .from('profiles')
    .delete()
    .eq('user_id', user.id)

  if (profileError) {
    console.error('Error deleting user profile:', profileError)
    throw profileError
  }

  // Sign out the user
  const { error: signOutError } = await supabaseClient.auth.signOut()

  if (signOutError) {
    console.error('Error signing out:', signOutError)
    throw signOutError
  }
}

/**
 * Subscribe to user profile changes
 */
export const subscribeToUserProfile = (callback: (profile: UserProfile | null) => void) => {
  let currentUserId: string | null = null

  // Set up auth state listener
  const authSubscription = supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (session?.user) {
      currentUserId = session.user.id

      // Get initial profile data
      const profile = await getUserProfile()
      callback(profile)
    } else {
      currentUserId = null
      callback(null)
    }
  })

  // Set up real-time subscription for profile changes
  const profileSubscription = supabaseClient
    .channel('user-profile-changes')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'profiles',
        filter: currentUserId ? `user_id=eq.${currentUserId}` : undefined,
      },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          callback(null)
        } else {
          callback(payload.new as UserProfile)
        }
      },
    )
    .subscribe()

  // Return cleanup function
  return () => {
    authSubscription.data.subscription?.unsubscribe()
    profileSubscription.unsubscribe()
  }
}
