import { useEffect, useState } from 'react'
import { UserProfile, UserPrivate, subscribeToUserProfile } from '../services/userService'

/**
 * Hook to get user private data from Supabase
 */
export function useUserPrivate(): UserPrivate | null {
  const [profile, setProfile] = useState<UserProfile | null>(null)

  useEffect(() => {
    const unsubscribe = subscribeToUserProfile((newProfile) => {
      setProfile(newProfile)
    })

    return unsubscribe
  }, [])

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
