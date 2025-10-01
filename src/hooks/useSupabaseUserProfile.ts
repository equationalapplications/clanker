import { useEffect, useState } from 'react'
import { UserProfile, UserPublic, UserPrivate, subscribeToUserProfile } from '../services/userService'

/**
 * Hook to get the current user's Supabase profile
 */
export function useSupabaseUserProfile(): UserProfile | null {
    const [profile, setProfile] = useState<UserProfile | null>(null)

    useEffect(() => {
        const unsubscribe = subscribeToUserProfile((newProfile) => {
            setProfile(newProfile)
        })

        return unsubscribe
    }, [])

    return profile
}

/**
 * Hook to get user public data in legacy format for compatibility
 */
export function useSupabaseUserPublic(): UserPublic | null {
    const profile = useSupabaseUserProfile()

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
 * Hook to get user private data in legacy format for compatibility
 */
export function useSupabaseUserPrivate(): UserPrivate | null {
    const profile = useSupabaseUserProfile()

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