import { supabase, Database } from '../config/supabaseConfig'

// Types for user data
export type UserProfile = Database['public']['Tables']['yours_brightly']['Row']
export type UserProfileInsert = Database['public']['Tables']['yours_brightly']['Insert']
export type UserProfileUpdate = Database['public']['Tables']['yours_brightly']['Update']

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
 * Get the current user's profile from Supabase
 */
export const getUserProfile = async (): Promise<UserProfile | null> => {
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        return null
    }

    const { data, error } = await supabase
        .from('yours_brightly')
        .select('*')
        .eq('user_id', user.id)
        .single()

    if (error) {
        console.error('Error fetching user profile:', error)
        return null
    }

    return data
}

/**
 * Create or update user profile in Supabase
 */
export const upsertUserProfile = async (profile: UserProfileUpdate): Promise<UserProfile | null> => {
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        throw new Error('No authenticated user')
    }

    const { data, error } = await supabase
        .from('yours_brightly')
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

    return {
        credits: profile.credits,
        isProfilePublic: profile.is_profile_public,
        defaultCharacter: profile.default_character_id || '',
        hasAcceptedTermsDate: null, // Will be handled by app permissions check
    }
}

/**
 * Accept terms for the app
 */
export const acceptTerms = async (termsVersion: string = '1.0'): Promise<void> => {
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        throw new Error('No authenticated user')
    }

    const { error } = await supabase.rpc('grant_app_access', {
        p_user_id: user.id,
        p_app_name: 'yours-brightly',
        p_terms_version: termsVersion,
    })

    if (error) {
        console.error('Error accepting terms:', error)
        throw error
    }
}

/**
 * Check if user has accepted current terms
 */
export const checkTermsAcceptance = async (currentVersion: string = '1.0'): Promise<boolean> => {
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        return false
    }

    const { data, error } = await supabase
        .from('user_app_permissions')
        .select('terms_accepted_at, terms_version')
        .eq('user_id', user.id)
        .eq('app_name', 'yours-brightly')
        .single()

    if (error || !data) {
        return false
    }

    return !!(data.terms_accepted_at && data.terms_version === currentVersion)
}

/**
 * Delete user account and all associated data
 */
export const deleteUser = async (): Promise<void> => {
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        throw new Error('No authenticated user')
    }

    // Delete user profile (cascading deletes will handle related data)
    const { error: profileError } = await supabase
        .from('yours_brightly')
        .delete()
        .eq('user_id', user.id)

    if (profileError) {
        console.error('Error deleting user profile:', profileError)
        throw profileError
    }

    // Sign out the user
    const { error: signOutError } = await supabase.auth.signOut()

    if (signOutError) {
        console.error('Error signing out:', signOutError)
        throw signOutError
    }
}

/**
 * Subscribe to user profile changes
 */
export const subscribeToUserProfile = (
    callback: (profile: UserProfile | null) => void
) => {
    let currentUserId: string | null = null

    // Set up auth state listener
    const authSubscription = supabase.auth.onAuthStateChange(async (event, session) => {
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
    const profileSubscription = supabase
        .channel('user-profile-changes')
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'yours_brightly',
                filter: currentUserId ? `user_id=eq.${currentUserId}` : undefined,
            },
            (payload) => {
                if (payload.eventType === 'DELETE') {
                    callback(null)
                } else {
                    callback(payload.new as UserProfile)
                }
            }
        )
        .subscribe()

    // Return cleanup function
    return () => {
        authSubscription.data.subscription?.unsubscribe()
        profileSubscription.unsubscribe()
    }
}